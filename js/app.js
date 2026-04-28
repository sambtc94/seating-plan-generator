'use strict';

/* ============================================================
   CONSTANTS
============================================================ */
const CLUSTER_COLORS = [
  '#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c',
  '#3498db','#9b59b6','#e91e63','#ff5722','#00bcd4',
  '#795548','#607d8b'
];

/* ============================================================
   STATE
============================================================ */
const state = {
  rooms:         [],   // Room[]
  students:      [],   // Student[]
  currentRoomId: null, // string | null

  // UI-only (not persisted)
  mode:            'move',   // 'move' | 'toggle' | 'cluster'
  activeClusterId: null,     // string | null
  drag: { studentId: null, fromSeatId: null }
};

// Transient edit context for modals
let editCtx = { type: null, id: null };
let pendingPhoto = null; // base64 string | null

/* ============================================================
   UTILITIES
============================================================ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Euclidean distance between two seat objects {row, col} */
function seatDist(s1, s2) {
  const dr = s1.row - s2.row, dc = s1.col - s2.col;
  return Math.sqrt(dr * dr + dc * dc);
}

function currentRoom() {
  return state.rooms.find(r => r.id === state.currentRoomId) ?? null;
}

function studentById(id) {
  return state.students.find(s => s.id === id) ?? null;
}

function seatById(room, id) {
  return room.seats.find(s => s.id === id) ?? null;
}

function seatByStudentId(room, studentId) {
  return room.seats.find(s => s.studentId === studentId) ?? null;
}

function avatarColor(gender) {
  if (gender === 'male')   return '#0984e3';
  if (gender === 'female') return '#e84393';
  if (gender === 'other')  return '#6c5ce7';
  return '#636e72';
}

/* ============================================================
   ROOM MANAGEMENT
============================================================ */

/**
 * Create a new room and add it to state.
 * @param {string} name
 * @param {number} rows
 * @param {number} cols
 * @returns {Room}
 */
function roomCreate(name = 'New Room', rows = 5, cols = 6) {
  const id = uid();
  const room = { id, name, rows, cols, seats: [], clusters: [] };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      room.seats.push(makeSeat(id, r, c));
    }
  }
  state.rooms.push(room);
  return room;
}

function makeSeat(roomId, r, c) {
  return {
    id: `${roomId}_${r}_${c}`,
    row: r, col: c,
    enabled: true,
    clusterId: null,
    studentId: null
  };
}

function roomDelete(id) {
  state.rooms = state.rooms.filter(r => r.id !== id);
  if (state.currentRoomId === id) {
    state.currentRoomId = state.rooms[0]?.id ?? null;
  }
}

/**
 * Resize the room grid.  Existing seat state (enabled, cluster, student)
 * is preserved for seats that remain within bounds.
 */
function roomResize(room, newRows, newCols) {
  const oldMap = {};
  room.seats.forEach(s => { oldMap[`${s.row}_${s.col}`] = s; });

  const newSeats = [];
  for (let r = 0; r < newRows; r++) {
    for (let c = 0; c < newCols; c++) {
      newSeats.push(oldMap[`${r}_${c}`] ?? makeSeat(room.id, r, c));
    }
  }

  // Remove clusters whose every seat is now gone
  const newSeatIds = new Set(newSeats.map(s => s.id));
  room.clusters = room.clusters.filter(cl =>
    newSeats.some(s => s.clusterId === cl.id)
  );

  room.rows  = newRows;
  room.cols  = newCols;
  room.seats = newSeats;
}

/* ============================================================
   STUDENT MANAGEMENT
============================================================ */

function studentCreate(data = {}) {
  const s = {
    id:            uid(),
    name:          (data.name  || '').trim() || 'Unnamed Student',
    gender:        data.gender || '',
    marks:         data.marks  != null ? Number(data.marks) : null,
    photo:         data.photo  || null,
    sitNear:       Array.isArray(data.sitNear)      ? [...data.sitNear]      : [],
    doNotSitNear:  Array.isArray(data.doNotSitNear) ? [...data.doNotSitNear] : []
  };
  state.students.push(s);
  return s;
}

function studentUpdate(id, data) {
  const s = studentById(id);
  if (s) Object.assign(s, data);
}

function studentDelete(id) {
  state.students = state.students.filter(s => s.id !== id);
  // Remove from seats
  state.rooms.forEach(room =>
    room.seats.forEach(seat => { if (seat.studentId === id) seat.studentId = null; })
  );
  // Remove from constraint lists
  state.students.forEach(s => {
    s.sitNear      = s.sitNear.filter(x => x !== id);
    s.doNotSitNear = s.doNotSitNear.filter(x => x !== id);
  });
}

/* ============================================================
   CLUSTER MANAGEMENT
============================================================ */

function clusterCreate(room, name = 'Cluster', color = null) {
  const cl = {
    id:    uid(),
    name,
    color: color || CLUSTER_COLORS[room.clusters.length % CLUSTER_COLORS.length]
  };
  room.clusters.push(cl);
  return cl;
}

function clusterDelete(room, id) {
  room.clusters = room.clusters.filter(c => c.id !== id);
  room.seats.forEach(s => { if (s.clusterId === id) s.clusterId = null; });
  if (state.activeClusterId === id) state.activeClusterId = null;
}

/**
 * BFS auto-detect: group all mutually 8-connected enabled seats into clusters.
 * Components of size 1 are left without a cluster (isolated seats).
 */
function autoDetectClusters(room) {
  room.clusters = [];
  room.seats.forEach(s => { s.clusterId = null; });
  if (state.activeClusterId) state.activeClusterId = null;

  const enabled = room.seats.filter(s => s.enabled);
  const visited = new Set();
  let colorIdx  = 0;

  enabled.forEach(seed => {
    if (visited.has(seed.id)) return;

    // BFS
    const component = [];
    const queue = [seed];
    visited.add(seed.id);

    while (queue.length) {
      const cur = queue.shift();
      component.push(cur);
      enabled.forEach(n => {
        if (
          !visited.has(n.id) &&
          Math.abs(n.row - cur.row) <= 1 &&
          Math.abs(n.col - cur.col) <= 1
        ) {
          visited.add(n.id);
          queue.push(n);
        }
      });
    }

    if (component.length >= 2) {
      const cl = clusterCreate(
        room,
        `Group ${room.clusters.length + 1}`,
        CLUSTER_COLORS[colorIdx++ % CLUSTER_COLORS.length]
      );
      component.forEach(s => { s.clusterId = cl.id; });
    }
  });
}

/* ============================================================
   SEATING ASSIGNMENT
============================================================ */

/**
 * Assign all students to seats in the current room using the chosen method.
 * Respects sitNear / doNotSitNear constraints via greedy scoring.
 *
 * @param {'random'|'ability'|'gender'} method
 */
function assignStudents(method) {
  const room = currentRoom();
  if (!room) return;

  // Clear existing
  room.seats.forEach(s => { s.studentId = null; });

  const seats = room.seats.filter(s => s.enabled);
  if (!seats.length) { alert('No seats available in this room.'); return; }

  let students = [...state.students];
  if (!students.length) { alert('No students to assign.'); return; }

  // ── Sort students ──────────────────────────────────────────
  if (method === 'random') {
    students = shuffle(students);

  } else if (method === 'ability') {
    students.sort((a, b) => {
      const bm = b.marks ?? -Infinity;
      const am = a.marks ?? -Infinity;
      return bm - am; // highest marks first
    });

  } else if (method === 'gender') {
    // Interleave male / female, append other/unspecified
    const m = shuffle(students.filter(s => s.gender === 'male'));
    const f = shuffle(students.filter(s => s.gender === 'female'));
    const o = shuffle(students.filter(s => s.gender !== 'male' && s.gender !== 'female'));
    students = [];
    const mx = Math.max(m.length, f.length);
    for (let i = 0; i < mx; i++) {
      if (i < m.length) students.push(m[i]);
      if (i < f.length) students.push(f[i]);
    }
    students.push(...o);
  }

  // ── Greedy placement with constraint scoring ───────────────
  const pool = [...seats];

  for (const student of students) {
    const available = pool.filter(s => !s.studentId);
    if (!available.length) break;

    let best = available[0], bestScore = -Infinity;

    for (const seat of available) {
      // Small random noise avoids always picking top-left on ties
      let score = Math.random() * 0.02;

      (student.sitNear || []).forEach(nearId => {
        const ns = pool.find(s => s.studentId === nearId);
        if (ns) score += 10 / (1 + seatDist(seat, ns));
      });

      (student.doNotSitNear || []).forEach(awayId => {
        const ns = pool.find(s => s.studentId === awayId);
        if (ns) score -= 15 / (1 + seatDist(seat, ns));
      });

      if (score > bestScore) { bestScore = score; best = seat; }
    }

    best.studentId = student.id;
  }
}

/* ============================================================
   DRAG & DROP
============================================================ */

function handleDrop(targetSeatId) {
  const room = currentRoom();
  if (!room) return;

  const target = seatById(room, targetSeatId);
  if (!target || !target.enabled) return;

  const { studentId, fromSeatId } = state.drag;
  if (!studentId) return;
  if (target.studentId === studentId) { resetDrag(); return; }

  const displacedId = target.studentId; // may be null

  if (fromSeatId) {
    // ── Inter-seat drag (move or swap) ──────────────────────
    const from = seatById(room, fromSeatId);
    if (from) from.studentId = displacedId; // null = clear, or swap
  } else {
    // ── Drag from student list ───────────────────────────────
    // If student is already in a seat, vacate it (swap with displaced)
    const existing = seatByStudentId(room, studentId);
    if (existing) existing.studentId = displacedId;
    // else displaced student just becomes unassigned
  }

  target.studentId = studentId;
  resetDrag();
  renderGrid();
  renderStudentList(); // update "seated" indicators
}

function resetDrag() {
  state.drag = { studentId: null, fromSeatId: null };
}

/* ============================================================
   SAVE / LOAD
============================================================ */

function saveJSON() {
  const data = {
    version: 1,
    rooms:         state.rooms,
    students:      state.students,
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
  if (!data || data.version !== 1) {
    throw new Error('Unsupported or invalid file format (expected version 1).');
  }
  state.rooms         = data.rooms    || [];
  state.students      = data.students || [];
  state.currentRoomId = data.currentRoomId ?? state.rooms[0]?.id ?? null;
  state.mode          = 'move';
  state.activeClusterId = null;
  renderAll();
}

/**
 * Import students from a JSON array.
 * Supports constraint references by student name (resolved to IDs).
 */
function importStudents(arr) {
  if (!Array.isArray(arr)) throw new Error('Expected a JSON array of student objects.');

  const nameMap = {};

  // Pass 1: create students
  const pairs = arr.map(raw => {
    const s = studentCreate({
      name:   raw.name,
      gender: raw.gender,
      marks:  raw.marks,
      photo:  raw.photo
    });
    nameMap[raw.name] = s.id;
    return { s, raw };
  });

  // Pass 2: resolve constraint references (by name or existing ID)
  pairs.forEach(({ s, raw }) => {
    if (Array.isArray(raw.sitNear)) {
      s.sitNear = raw.sitNear
        .map(n => nameMap[n] ?? (state.students.find(x => x.id === n)?.id))
        .filter(Boolean);
    }
    if (Array.isArray(raw.doNotSitNear)) {
      s.doNotSitNear = raw.doNotSitNear
        .map(n => nameMap[n] ?? (state.students.find(x => x.id === n)?.id))
        .filter(Boolean);
    }
  });
}

/* ============================================================
   RENDER — TABS
============================================================ */
function renderTabs() {
  const el = document.getElementById('room-tabs');
  el.innerHTML = '';

  state.rooms.forEach(room => {
    const btn = document.createElement('button');
    btn.className = 'room-tab' + (room.id === state.currentRoomId ? ' active' : '');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = room.name;

    const editIcon = document.createElement('span');
    editIcon.className = 'tab-edit';
    editIcon.textContent = '✏';
    editIcon.title = 'Rename room';
    editIcon.addEventListener('click', e => { e.stopPropagation(); openModal('room', room.id); });

    btn.appendChild(nameSpan);
    btn.appendChild(editIcon);
    btn.addEventListener('click', () => {
      state.currentRoomId = room.id;
      renderAll();
    });
    el.appendChild(btn);
  });
}

/* ============================================================
   RENDER — STUDENT LIST
============================================================ */
function renderStudentList() {
  const el = document.getElementById('student-list');
  el.innerHTML = '';

  if (!state.students.length) {
    el.innerHTML = '<div class="empty-msg">No students yet.<br>Click "＋ Add" to add students,<br>or "📥 Import" to import from JSON.</div>';
    return;
  }

  const room = currentRoom();
  state.students.forEach(student => {
    const seatedHere = room ? !!seatByStudentId(room, student.id) : false;
    el.appendChild(buildStudentCard(student, seatedHere));
  });
}

function buildStudentCard(student, isSeated) {
  const card = document.createElement('div');
  card.className = 'student-card' + (isSeated ? ' is-seated' : '');
  card.dataset.studentId = student.id;
  card.draggable = true;

  card.addEventListener('dragstart', e => {
    state.drag.studentId  = student.id;
    state.drag.fromSeatId = null; // from list, not from a seat
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', student.id);
  });

  // Avatar
  const av = document.createElement('div');
  av.className = 'avatar ' + (student.gender || '');
  if (student.photo) {
    av.style.backgroundImage = `url(${student.photo})`;
  } else {
    av.style.backgroundColor = avatarColor(student.gender);
    av.textContent = student.name.charAt(0).toUpperCase();
  }

  // Info
  const info = document.createElement('div');
  info.className = 's-info';

  const nameEl = document.createElement('div');
  nameEl.className = 's-name';
  nameEl.textContent = student.name;

  const det = document.createElement('div');
  det.className = 's-details';
  const parts = [];
  if (student.gender) parts.push(student.gender.charAt(0).toUpperCase() + student.gender.slice(1));
  if (student.marks != null) parts.push(`${student.marks}%`);
  if (student.sitNear.length)     parts.push(`↑${student.sitNear.length}`);
  if (student.doNotSitNear.length) parts.push(`↓${student.doNotSitNear.length}`);
  det.textContent = parts.join(' · ');

  info.appendChild(nameEl);
  info.appendChild(det);

  // Actions
  const actions = document.createElement('div');
  actions.className = 's-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-icon';
  editBtn.textContent = '✏️';
  editBtn.title = 'Edit student';
  editBtn.addEventListener('click', e => { e.stopPropagation(); openModal('student', student.id); });

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-icon';
  delBtn.textContent = '🗑';
  delBtn.title = 'Delete student';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (confirm(`Delete "${student.name}"?`)) {
      studentDelete(student.id);
      renderAll();
    }
  });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  card.appendChild(av);
  card.appendChild(info);
  card.appendChild(actions);
  return card;
}

/* ============================================================
   RENDER — GRID
============================================================ */
function renderGrid() {
  const grid    = document.getElementById('room-grid');
  const wrapper = document.getElementById('grid-wrapper');
  grid.innerHTML = '';

  const room = currentRoom();
  if (!room) {
    grid.innerHTML = '<div class="no-room-msg">No room selected.<br>Create a room using "＋ New Room".</div>';
    document.getElementById('room-name-display').textContent = 'No room selected';
    return;
  }

  document.getElementById('room-name-display').textContent = room.name;
  document.getElementById('rows-input').value = room.rows;
  document.getElementById('cols-input').value = room.cols;

  grid.style.gridTemplateColumns = `repeat(${room.cols}, 78px)`;
  grid.style.gridTemplateRows    = `repeat(${room.rows}, 78px)`;

  for (let r = 0; r < room.rows; r++) {
    for (let c = 0; c < room.cols; c++) {
      const seat = room.seats.find(s => s.row === r && s.col === c);
      const cell = document.createElement('div');
      cell.className = 'seat-cell';

      if (!seat || !seat.enabled) {
        cell.classList.add('seat-disabled');
        if (state.mode === 'toggle') cell.classList.add('toggleable');

        cell.addEventListener('click', () => {
          if (state.mode !== 'toggle') return;
          if (!seat) {
            // create a new seat here
            room.seats.push(makeSeat(room.id, r, c));
          } else {
            seat.enabled = true;
          }
          renderGrid();
        });

        grid.appendChild(cell);
        continue;
      }

      // ── Enabled seat ────────────────────────────────────────
      cell.dataset.seatId = seat.id;

      // Cluster styling
      if (seat.clusterId) {
        const cl = room.clusters.find(x => x.id === seat.clusterId);
        if (cl) {
          cell.classList.add('in-cluster');
          cell.style.borderColor     = cl.color;
          cell.style.backgroundColor = cl.color + '22';
        }
      }

      // Mode-specific classes
      if (state.mode === 'toggle')  cell.classList.add('toggleable');
      if (state.mode === 'cluster') cell.classList.add('cluster-mode');

      if (state.mode === 'cluster' &&
          state.activeClusterId &&
          seat.clusterId === state.activeClusterId) {
        const cl = room.clusters.find(x => x.id === state.activeClusterId);
        if (cl) {
          cell.style.borderColor     = cl.color;
          cell.style.backgroundColor = cl.color + '44';
        }
      }

      // Student in seat
      if (seat.studentId) {
        cell.classList.add('has-student');
        const student = studentById(seat.studentId);
        if (student) cell.appendChild(buildMiniStudent(student, seat.id));
      }

      // ── Event: click ────────────────────────────────────────
      cell.addEventListener('click', () => {
        if (state.mode === 'toggle') {
          seat.enabled    = false;
          seat.studentId  = null;
          seat.clusterId  = null;
          renderGrid();

        } else if (state.mode === 'cluster') {
          if (!state.activeClusterId) {
            showInfoBar('Select a cluster in the right panel first, or create one.');
            return;
          }
          seat.clusterId = (seat.clusterId === state.activeClusterId)
            ? null
            : state.activeClusterId;
          renderGrid();
          renderClusterPanel();
        }
      });

      // ── Drag-and-drop drop target (only in move mode) ───────
      if (state.mode === 'move') {
        cell.addEventListener('dragover', e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          cell.classList.add('drag-over');
        });
        cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
        cell.addEventListener('drop', e => {
          e.preventDefault();
          cell.classList.remove('drag-over');
          handleDrop(seat.id);
        });
      }

      // ── Hover info ──────────────────────────────────────────
      cell.addEventListener('mouseenter', () => {
        if (seat.studentId) {
          const s = studentById(seat.studentId);
          if (s) {
            const parts = [`${s.name}`];
            if (s.gender) parts.push(s.gender);
            if (s.marks != null) parts.push(`Marks: ${s.marks}%`);
            if (s.sitNear.length)
              parts.push(`Sit near: ${s.sitNear.map(id => studentById(id)?.name ?? id).join(', ')}`);
            if (s.doNotSitNear.length)
              parts.push(`Separate from: ${s.doNotSitNear.map(id => studentById(id)?.name ?? id).join(', ')}`);
            showInfoBar(parts.join('  |  '));
          }
        } else {
          showInfoBar(`Seat row ${r + 1}, col ${c + 1} — empty`);
        }
      });
      cell.addEventListener('mouseleave', () => showInfoBar(''));

      grid.appendChild(cell);
    }
  }
}

function showInfoBar(text) {
  const el = document.getElementById('seat-info-bar');
  if (el) el.textContent = text;
}

function buildMiniStudent(student, seatId) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-student';
  wrap.draggable = true;

  wrap.addEventListener('dragstart', e => {
    e.stopPropagation();
    state.drag.studentId  = student.id;
    state.drag.fromSeatId = seatId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', student.id);
  });

  const av = document.createElement('div');
  av.className = 'mini-avatar ' + (student.gender || '');
  if (student.photo) {
    av.style.backgroundImage = `url(${student.photo})`;
  } else {
    av.style.backgroundColor = avatarColor(student.gender);
    av.textContent = student.name.charAt(0).toUpperCase();
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'mini-name';
  // Show first name only (or full if short enough)
  const firstName = student.name.split(' ')[0];
  nameEl.textContent = firstName.length > 8 ? firstName.slice(0, 7) + '…' : firstName;

  wrap.appendChild(av);
  wrap.appendChild(nameEl);
  return wrap;
}

/* ============================================================
   RENDER — CLUSTER PANEL
============================================================ */
function renderClusterPanel() {
  const list   = document.getElementById('cluster-list');
  const select = document.getElementById('active-cluster-select');
  const legend = document.getElementById('cluster-legend');

  list.innerHTML   = '';
  legend.innerHTML = '';

  // Rebuild the dropdown too
  const prevVal = select.value;
  select.innerHTML = '<option value="">── Select cluster ──</option>';

  const room = currentRoom();
  if (!room) return;

  if (!room.clusters.length) {
    list.innerHTML = '<div class="empty-msg">No clusters.<br>Click "＋ Add" or use Auto-Detect.</div>';
    return;
  }

  room.clusters.forEach(cl => {
    const seatCount = room.seats.filter(s => s.clusterId === cl.id).length;

    // List item
    const item = document.createElement('div');
    item.className = 'cluster-item';

    const dot = document.createElement('div');
    dot.className = 'cluster-dot';
    dot.style.backgroundColor = cl.color;

    const name = document.createElement('span');
    name.className = 'cluster-name';
    name.textContent = cl.name;

    const cnt = document.createElement('span');
    cnt.className = 'cluster-count';
    cnt.textContent = `${seatCount} seat${seatCount !== 1 ? 's' : ''}`;

    const acts = document.createElement('div');
    acts.className = 'cluster-actions';

    const eBtn = document.createElement('button');
    eBtn.className = 'btn-icon';
    eBtn.textContent = '✏️';
    eBtn.title = 'Edit cluster';
    eBtn.addEventListener('click', () => openModal('cluster', cl.id));

    const dBtn = document.createElement('button');
    dBtn.className = 'btn-icon';
    dBtn.textContent = '🗑';
    dBtn.title = 'Delete cluster';
    dBtn.addEventListener('click', () => {
      if (confirm(`Delete cluster "${cl.name}"?`)) {
        clusterDelete(room, cl.id);
        renderClusterPanel();
        renderGrid();
      }
    });

    acts.appendChild(eBtn);
    acts.appendChild(dBtn);

    item.appendChild(dot);
    item.appendChild(name);
    item.appendChild(cnt);
    item.appendChild(acts);
    list.appendChild(item);

    // Dropdown option
    const opt = document.createElement('option');
    opt.value = cl.id;
    opt.textContent = cl.name;
    select.appendChild(opt);
  });

  // Restore previous selection if still valid
  if (prevVal && [...select.options].some(o => o.value === prevVal)) {
    select.value = prevVal;
  }

  // Legend
  legend.textContent = 'Click seats in "Edit Clusters" mode to assign them.';
}

/* ============================================================
   RENDER — ALL
============================================================ */
function renderAll() {
  renderTabs();
  renderStudentList();
  renderGrid();
  renderClusterPanel();
}

/* ============================================================
   MODALS
============================================================ */

/**
 * Open a modal.
 * @param {'room'|'student'|'cluster'} type
 * @param {string|null} id  - existing object id to edit, or null to create
 */
function openModal(type, id = null) {
  editCtx = { type, id };
  pendingPhoto = null;

  if (type === 'room') {
    document.getElementById('room-modal-title').textContent = id ? 'Rename Room' : 'New Room';
    const room = id ? state.rooms.find(r => r.id === id) : null;
    document.getElementById('room-name-input').value = room?.name ?? '';
    showModalEl('room-modal');

  } else if (type === 'student') {
    document.getElementById('student-modal-title').textContent = id ? 'Edit Student' : 'Add Student';
    const s = id ? studentById(id) : null;

    document.getElementById('s-name').value   = s?.name   ?? '';
    document.getElementById('s-gender').value = s?.gender ?? '';
    document.getElementById('s-marks').value  = s?.marks  != null ? s.marks : '';

    // Photo preview
    const preview = document.getElementById('photo-preview');
    if (s?.photo) {
      preview.style.backgroundImage  = `url(${s.photo})`;
      preview.style.backgroundSize   = 'cover';
      preview.style.backgroundPosition = 'center';
      preview.textContent = '';
    } else {
      preview.style.backgroundImage = '';
      preview.textContent = s ? s.name.charAt(0).toUpperCase() : '?';
      preview.style.backgroundColor = s ? avatarColor(s.gender) : '#636e72';
    }

    // Constraint lists
    buildConstraintLists(id, s?.sitNear ?? [], s?.doNotSitNear ?? []);

    showModalEl('student-modal');

  } else if (type === 'cluster') {
    const room = currentRoom();
    if (!room) return;
    document.getElementById('cluster-modal-title').textContent = id ? 'Edit Cluster' : 'New Cluster';
    const cl = id ? room.clusters.find(c => c.id === id) : null;
    document.getElementById('cluster-name-input').value  = cl?.name  ?? '';
    document.getElementById('cluster-color-input').value =
      cl?.color ?? CLUSTER_COLORS[room.clusters.length % CLUSTER_COLORS.length];
    showModalEl('cluster-modal');
  }
}

function showModalEl(modalId) {
  document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; });
  document.getElementById(modalId).style.display = 'flex';
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editCtx    = { type: null, id: null };
  pendingPhoto = null;
}

function buildConstraintLists(excludeId, sitNear, doNotSitNear) {
  const snEl  = document.getElementById('sit-near-list');
  const nsnEl = document.getElementById('no-sit-near-list');
  snEl.innerHTML = nsnEl.innerHTML = '';

  const others = state.students.filter(s => s.id !== excludeId);
  if (!others.length) {
    snEl.innerHTML = nsnEl.innerHTML =
      '<div class="empty-msg">No other students yet.</div>';
    return;
  }

  others.forEach(s => {
    // Sit near
    const snLabel = document.createElement('label');
    snLabel.className = 'chk-label';
    const snCb = document.createElement('input');
    snCb.type = 'checkbox'; snCb.value = s.id; snCb.name = 'sit-near';
    snCb.checked = sitNear.includes(s.id);
    snLabel.appendChild(snCb);
    snLabel.appendChild(document.createTextNode(s.name));
    snEl.appendChild(snLabel);

    // Do not sit near
    const nsnLabel = document.createElement('label');
    nsnLabel.className = 'chk-label';
    const nsnCb = document.createElement('input');
    nsnCb.type = 'checkbox'; nsnCb.value = s.id; nsnCb.name = 'no-sit-near';
    nsnCb.checked = doNotSitNear.includes(s.id);
    nsnLabel.appendChild(nsnCb);
    nsnLabel.appendChild(document.createTextNode(s.name));
    nsnEl.appendChild(nsnLabel);
  });
}

/* ── MODAL SAVE HANDLERS ─────────────────────────────────── */

function saveRoomModal() {
  const name = document.getElementById('room-name-input').value.trim();
  if (!name) { alert('Please enter a room name.'); return; }

  if (editCtx.id) {
    const room = state.rooms.find(r => r.id === editCtx.id);
    if (room) room.name = name;
  } else {
    const room = roomCreate(name);
    state.currentRoomId = room.id;
  }

  closeModal();
  renderAll();
}

function saveStudentModal() {
  const name = document.getElementById('s-name').value.trim();
  if (!name) { alert('Please enter the student\'s name.'); return; }

  const marksRaw = document.getElementById('s-marks').value;
  const marks    = marksRaw !== '' ? parseFloat(marksRaw) : null;

  const sitNear = [...document.querySelectorAll('#sit-near-list input[name="sit-near"]:checked')]
    .map(cb => cb.value);
  const doNotSitNear = [...document.querySelectorAll('#no-sit-near-list input[name="no-sit-near"]:checked')]
    .map(cb => cb.value);

  const persist = (photo) => {
    const data = {
      name,
      gender: document.getElementById('s-gender').value,
      marks,
      photo,
      sitNear,
      doNotSitNear
    };
    if (editCtx.id) {
      studentUpdate(editCtx.id, data);
    } else {
      studentCreate(data);
    }
    closeModal();
    renderAll();
  };

  // Photo: use pending (newly selected) or keep existing
  if (pendingPhoto) {
    persist(pendingPhoto);
  } else {
    const existing = editCtx.id ? (studentById(editCtx.id)?.photo ?? null) : null;
    persist(existing);
  }
}

function saveClusterModal() {
  const room = currentRoom();
  if (!room) return;

  const name  = document.getElementById('cluster-name-input').value.trim();
  if (!name) { alert('Please enter a cluster name.'); return; }
  const color = document.getElementById('cluster-color-input').value;

  if (editCtx.id) {
    const cl = room.clusters.find(c => c.id === editCtx.id);
    if (cl) { cl.name = name; cl.color = color; }
  } else {
    const cl = clusterCreate(room, name, color);
    state.activeClusterId = cl.id;
    // Switch to cluster mode to make it easy to assign seats
    setMode('cluster');
  }

  closeModal();
  renderAll();
}

/* ============================================================
   MODE SWITCHING
============================================================ */
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  const ct = document.getElementById('cluster-toolbar');
  ct.style.display = (mode === 'cluster') ? 'flex' : 'none';
  renderGrid();
}

/* ============================================================
   EVENT LISTENERS
============================================================ */
function initEvents() {

  // ── Save / Load ──────────────────────────────────────────
  document.getElementById('save-btn').addEventListener('click', saveJSON);

  document.getElementById('load-btn').addEventListener('click', () =>
    document.getElementById('load-file').click()
  );
  document.getElementById('load-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        loadJSON(JSON.parse(evt.target.result));
      } catch (err) {
        alert('Error loading file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ── Room ────────────────────────────────────────────────
  document.getElementById('add-room-btn').addEventListener('click',
    () => openModal('room'));

  document.getElementById('resize-btn').addEventListener('click', () => {
    const room = currentRoom();
    if (!room) return;
    const rows = parseInt(document.getElementById('rows-input').value, 10);
    const cols = parseInt(document.getElementById('cols-input').value, 10);
    if (rows < 1 || cols < 1 || rows > 30 || cols > 30) {
      alert('Rows and columns must be between 1 and 30.'); return;
    }
    roomResize(room, rows, cols);
    renderGrid();
    renderClusterPanel();
  });

  document.getElementById('delete-room-btn').addEventListener('click', () => {
    const room = currentRoom();
    if (!room) return;
    if (confirm(`Delete room "${room.name}"? This cannot be undone.`)) {
      roomDelete(room.id);
      renderAll();
    }
  });

  // ── Mode buttons ─────────────────────────────────────────
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // ── Assign / Clear ───────────────────────────────────────
  document.getElementById('assign-btn').addEventListener('click', () => {
    const method = document.getElementById('sort-method').value;
    assignStudents(method);
    renderGrid();
    renderStudentList();
  });

  document.getElementById('clear-btn').addEventListener('click', () => {
    const room = currentRoom();
    if (!room) return;
    if (confirm('Clear all student assignments in this room?')) {
      room.seats.forEach(s => { s.studentId = null; });
      renderGrid();
      renderStudentList();
    }
  });

  // ── Students ─────────────────────────────────────────────
  document.getElementById('add-student-btn').addEventListener('click',
    () => openModal('student'));

  document.getElementById('import-btn').addEventListener('click',
    () => document.getElementById('import-file').click()
  );
  document.getElementById('import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        importStudents(JSON.parse(evt.target.result));
        renderStudentList();
        alert('Students imported successfully.');
      } catch (err) {
        alert('Import error: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ── Photo selection ──────────────────────────────────────
  document.getElementById('s-photo').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      pendingPhoto = evt.target.result;
      const preview = document.getElementById('photo-preview');
      preview.style.backgroundImage  = `url(${pendingPhoto})`;
      preview.style.backgroundSize   = 'cover';
      preview.style.backgroundPosition = 'center';
      preview.textContent = '';
    };
    reader.readAsDataURL(file);
  });

  // ── Clusters ─────────────────────────────────────────────
  document.getElementById('add-cluster-btn').addEventListener('click', () => {
    if (!currentRoom()) { alert('Please create a room first.'); return; }
    openModal('cluster');
  });

  document.getElementById('detect-clusters-btn').addEventListener('click', () => {
    const room = currentRoom();
    if (!room) return;
    if (confirm('Auto-detect clusters from adjacent seats?\nThis will replace all existing clusters.')) {
      autoDetectClusters(room);
      renderClusterPanel();
      renderGrid();
    }
  });

  document.getElementById('active-cluster-select').addEventListener('change', e => {
    state.activeClusterId = e.target.value || null;
    renderGrid();
  });

  // ── Modal saves ──────────────────────────────────────────
  document.getElementById('room-modal-save').addEventListener('click',    saveRoomModal);
  document.getElementById('student-modal-save').addEventListener('click', saveStudentModal);
  document.getElementById('cluster-modal-save').addEventListener('click', saveClusterModal);

  // ── Modal close (✕ buttons & Cancel) ────────────────────
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  // Close modal when clicking the dark overlay background
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Enter key submits the active modal
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (!document.getElementById('modal-overlay').classList.contains('open')) return;
    if (e.target.tagName === 'TEXTAREA') return;
    if (editCtx.type === 'room')    saveRoomModal();
    if (editCtx.type === 'student') saveStudentModal();
    if (editCtx.type === 'cluster') saveClusterModal();
  });

  // Escape key closes modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

/* ============================================================
   INITIALIZATION
============================================================ */
function init() {
  initEvents();

  // Create a default room so the app is immediately usable
  const room = roomCreate('Classroom A', 5, 6);
  state.currentRoomId = room.id;

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
