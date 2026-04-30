'use strict';

/* ============================================================
   SAVE / LOAD
============================================================ */

const AUTOSAVE_KEY          = 'spg_autosave_v2';
const AUTOSAVE_DELAY_MS     = 600;
const BADGE_FADE_DURATION_MS = 2500;
// Most browsers cap URLs at ~2 MB; 200 KB keeps clipboard/sharing practical
// and avoids issues with email clients that truncate long links.
const MAX_SHARE_URL_LENGTH   = 200000;

function autosave() {
  try {
    const data = {
      version:       2,
      rooms:         state.rooms,
      students:      state.students,
      classSets:     state.classSets,
      customFlags:   state.customFlags,
      roomTemplates: state.roomTemplates,
      currentRoomId: state.currentRoomId
    };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
    showAutosaveBadge('✔ Saved');
  } catch (e) {
    // localStorage may be full or unavailable — silently ignore
  }
}

let _autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(autosave, AUTOSAVE_DELAY_MS);
}

function showAutosaveBadge(text) {
  const badge = document.getElementById('autosave-badge');
  if (!badge) return;
  badge.textContent = text;
  badge.classList.add('visible');
  clearTimeout(badge._fadeTimer);
  badge._fadeTimer = setTimeout(() => badge.classList.remove('visible'), BADGE_FADE_DURATION_MS);
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return applyStateData(data);
  } catch (e) {
    return false;
  }
}

/** Apply a serialised state object (v1 or v2) — returns true on success. */
function applyStateData(data) {
  if (!data || (data.version !== 1 && data.version !== 2)) return false;
  state.rooms         = (data.rooms    || []).map(normaliseRoom);
  state.students      = (data.students || []).map(normaliseStudent);
  state.classSets     = data.classSets     || [];
  state.customFlags   = data.customFlags   || [];
  state.roomTemplates = data.roomTemplates || [];
  state.currentRoomId = data.currentRoomId ?? state.rooms.find(r => !r.archived)?.id ?? null;
  state.mode              = 'move';
  state.activeClusterId   = null;
  state.activeClassSetId  = null;
  state.auditMode         = false;
  return true;
}

function saveJSON() {
  const data = {
    version:       2,
    rooms:         state.rooms,
    students:      state.students,
    classSets:     state.classSets,
    customFlags:   state.customFlags,
    roomTemplates: state.roomTemplates,
    currentRoomId: state.currentRoomId
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'seating-plan.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadJSON(data) {
  if (!applyStateData(data)) {
    throw new Error('Unsupported or invalid file format (expected version 1 or 2).');
  }
  renderAll();
}

/**
 * Open the browser's print/save-as-PDF dialog for the current seating plan.
 * The @media print CSS rules in styles.css hide the UI chrome so only the
 * room grid is visible in the printed output.
 */
function printSeatingPlan() {
  if (!currentRoom()) {
    alert('Please select a room to print.');
    return;
  }
  window.print();
}

/* ============================================================
   URL-BASED SHARING
============================================================ */

/** Encode a Uint8Array to base64url (URL-safe, no padding). */
function _bytesToBase64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Decode a base64url string to Uint8Array. */
function _base64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '=='.slice(0, (4 - b64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Compress a UTF-8 string to gzip bytes via the CompressionStream API. */
async function _gzipEncode(text) {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(text));
  writer.close();
  const chunks = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/** Decompress gzip bytes to a UTF-8 string via the DecompressionStream API. */
async function _gzipDecode(bytes) {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return new TextDecoder().decode(out);
}

/**
 * Serialise the current state into the URL hash and copy the link to the
 * clipboard.  The hash format is:
 *   #share=gz.<base64url-of-gzip-compressed-json>   (modern browsers)
 *   #share=b64.<base64url-of-plain-json>             (fallback)
 */
async function generateShareURL() {
  const data = {
    version:       2,
    rooms:         state.rooms,
    students:      state.students,
    classSets:     state.classSets,
    customFlags:   state.customFlags,
    roomTemplates: state.roomTemplates,
    currentRoomId: state.currentRoomId
  };
  const json = JSON.stringify(data);
  let fragment;
  try {
    if (typeof CompressionStream !== 'undefined') {
      fragment = 'gz.' + _bytesToBase64url(await _gzipEncode(json));
    } else {
      fragment = 'b64.' + _bytesToBase64url(new TextEncoder().encode(json));
    }
  } catch (e) {
    alert('Could not generate share link: ' + e.message);
    return;
  }

  const url = window.location.href.split('#')[0] + '#share=' + fragment;

  if (url.length > MAX_SHARE_URL_LENGTH) {
    alert(
      'The share URL is very large (' + Math.round(url.length / 512) + ' KB).\n' +
      'This is usually caused by student photos stored in the plan.\n\n' +
      'Consider using "Save JSON" to share large plans instead.'
    );
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    showAutosaveBadge('🔗 Link copied!');
  } catch (e) {
    // Clipboard API unavailable (e.g. non-HTTPS context) — show prompt as fallback
    console.warn('Clipboard write failed:', e);
    prompt('Copy this share link:', url);
  }
}

/**
 * Check the URL hash for embedded share data and load it into state.
 * Returns true if share data was found and successfully applied.
 * The hash is cleared from the address bar after a successful load.
 */
async function loadFromURLHash() {
  const hash = window.location.hash;
  if (!hash.startsWith('#share=')) return false;

  const payload = hash.slice('#share='.length);
  if (!payload) return false;

  try {
    let json;
    if (payload.startsWith('gz.')) {
      json = await _gzipDecode(_base64urlToBytes(payload.slice(3)));
    } else if (payload.startsWith('b64.')) {
      json = new TextDecoder().decode(_base64urlToBytes(payload.slice(4)));
    } else {
      return false;
    }
    const data = JSON.parse(json);
    if (!applyStateData(data)) return false;
    // Clean up the address bar without triggering a page reload
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return true;
  } catch (e) {
    console.warn('Failed to load state from URL hash:', e);
    return false;
  }
}

/* ============================================================
   CSV EXPORT (STUDENTS)
============================================================ */
function exportStudentsCSV() {
  const rows = [['name', 'gender', 'marks']];
  state.students.forEach(s => {
    rows.push([s.name, s.gender || '', s.marks != null ? String(s.marks) : '']);
  });
  const csv = rows.map(r =>
    r.map(f => (/[,"\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(',')
  ).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'students.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Import students from a CSV string.
 * Expected header row: name[,gender[,marks]]
 * Supports RFC 4180-style quoted fields (commas inside quotes are preserved).
 * Extra columns are ignored.
 */
/**
 * Normalise a gender string from CSV to one of the canonical values
 * ('male', 'female', 'other') accepted by the rest of the app.
 * Returns '' for blank or unrecognised values.
 */
function normaliseGender(raw) {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'male'   || v === 'm' || v === 'boy'  || v === 'man')  return 'male';
  if (v === 'female' || v === 'f' || v === 'girl' || v === 'woman') return 'female';
  if (v === 'other'  || v === 'o' || v === 'x')                     return 'other';
  return '';
}

function importStudentsCSV(csvText) {
  const rows = parseCSVRows(csvText);
  if (rows.length < 2) throw new Error('CSV must have a header row and at least one data row.');

  // Find column indices (case-insensitive, strip surrounding quotes)
  const headers = rows[0].map(h => h.toLowerCase());
  const col = name => headers.indexOf(name);
  const iName   = col('name');
  const iGender = col('gender');
  const iMarks  = col('marks');

  if (iName === -1) throw new Error('CSV must have a "name" column.');

  let imported = 0;
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const name = cells[iName];
    if (!name) continue;
    const marksRaw = iMarks !== -1 ? parseFloat(cells[iMarks]) : NaN;
    studentCreate({
      name,
      gender: iGender !== -1 ? normaliseGender(cells[iGender]) : '',
      marks:  !isNaN(marksRaw) ? marksRaw : null
    });
    imported++;
  }
  if (!imported) throw new Error('No valid student rows found in CSV.');
  return imported;
}

/**
 * Parse a CSV string into a 2-D array of strings.
 * Handles RFC 4180-style double-quoted fields (including commas and newlines inside quotes).
 */
function parseCSVRows(csvText) {
  const rows = [];
  let row = [];
  let i = 0;
  const len = csvText.length;

  while (i < len) {
    if (csvText[i] === '"') {
      // Quoted field
      let field = '';
      i++; // skip opening quote
      while (i < len) {
        if (csvText[i] === '"' && csvText[i + 1] === '"') {
          field += '"'; i += 2; // escaped quote
        } else if (csvText[i] === '"') {
          i++; break; // closing quote
        } else {
          field += csvText[i++];
        }
      }
      row.push(field); // quoted fields: preserve content as-is (no trim)
      // Skip comma or newline after closing quote
      if (csvText[i] === ',') i++;
    } else if (csvText[i] === ',') {
      row.push('');
      i++;
    } else if (csvText[i] === '\r' || csvText[i] === '\n') {
      // End of row
      if (csvText[i] === '\r' && csvText[i + 1] === '\n') i++;
      i++;
      if (row.length) rows.push(row);
      row = [];
    } else {
      // Unquoted field
      let field = '';
      while (i < len && csvText[i] !== ',' && csvText[i] !== '\r' && csvText[i] !== '\n') {
        field += csvText[i++];
      }
      row.push(field.trim());
      if (csvText[i] === ',') i++;
    }
  }
  if (row.length) rows.push(row);
  return rows.filter(r => r.some(c => c !== ''));
}

/* ============================================================
   CSV EXPORT (SEATING)
============================================================ */
function exportCSV() {
  const room = currentRoom();
  if (!room) { alert('Please select a room first.'); return; }

  const assignedSeats = room.seats.filter(s => isSeatAssignable(s) && s.studentId);
  if (!assignedSeats.length) { alert('No students are assigned in this room.'); return; }

  const rows = [['Name', 'Row', 'Col', 'Cluster', 'Marks', 'Flags', 'Notes']];
  assignedSeats.forEach(seat => {
    const student = studentById(seat.studentId);
    if (!student) return;
    const cluster = seat.clusterId
      ? (room.clusters.find(c => c.id === seat.clusterId)?.name ?? '') : '';
    const r = seat.row >= 0 ? seat.row + 1 : '-';
    const c = seat.col >= 0 ? seat.col + 1 : '-';
    rows.push([
      student.name,
      r, c,
      cluster,
      student.marks ?? '',
      (student.flags || []).join('; '),
      student.notes || ''
    ]);
  });

  const csvContent = rows.map(r => r.map(cell => {
    const s = String(cell);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${room.name.replace(/[^a-z0-9]/gi, '_')}_seating.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
