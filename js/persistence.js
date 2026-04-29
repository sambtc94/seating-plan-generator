'use strict';

/* ============================================================
   SAVE / LOAD
============================================================ */

const AUTOSAVE_KEY          = 'spg_autosave_v2';
const AUTOSAVE_DELAY_MS     = 600;
const BADGE_FADE_DURATION_MS = 2500;

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

/**
 * Import students from a JSON array.
 * Supports constraint references by student name (resolved to IDs).
 */
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
