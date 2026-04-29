'use strict';

/* ============================================================
   VERSION
============================================================ */
const APP_COMMIT = 'a45c662';
const APP_VERSION = '1.0 (' + APP_COMMIT + ')';

/* ============================================================
   CONSTANTS
============================================================ */
const CLUSTER_COLOURS = [
  '#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c',
  '#3498db','#9b59b6','#e91e63','#ff5722','#00bcd4',
  '#795548','#607d8b'
];

const STUDENT_FLAGS = [
  { key: 'SEN',       label: 'SEN',       colour: '#e74c3c' },
  { key: 'EAL',       label: 'EAL',       colour: '#3498db' },
  { key: 'Gifted',    label: 'Gifted',    colour: '#f1c40f' },
  { key: 'Behaviour', label: 'Behaviour', colour: '#e67e22' }
];

/** Returns built-in + custom flag definitions. */
function allFlags() {
  return [...STUDENT_FLAGS, ...(state.customFlags || [])];
}

const SEAT_LABELS = {
  teacher:    { icon: '👨‍🏫', name: "Teacher's Desk" },
  whiteboard: { icon: '📋',  name: 'Whiteboard'      },
  bookshelf:  { icon: '📚',  name: 'Bookshelf'       },
  projector:  { icon: '📽',  name: 'Projector'       },
  computer:   { icon: '💻',  name: 'Computer Desk'   }
};

const CELL_SIZE              = 84;  // 78px seat + 6px gap — used for grid↔freeform conversion
const FREEFORM_PAD           = 42;  // padding inside the freeform canvas (= CELL_SIZE/2, aligns with the 42px background grid)
const SEAT_WIDTH             = 78;  // seat cell width/height in px
const SEAT_HALF              = 39;  // half of SEAT_WIDTH (for centring click position)
const FREEFORM_ADJACENCY_PX  = 170; // pixel proximity for cluster auto-detect in freeform mode
const MAX_FREEFORM_SEATS     = 200; // hard cap on desks in a freeform room

/* ============================================================
   STATE
============================================================ */
const state = {
  rooms:         [],   // Room[]
  students:      [],   // Student[]
  classSets:     [],   // ClassSet[]
  customFlags:   [],   // { key, label, colour }[]  — teacher-defined extra flags
  roomTemplates: [],   // RoomTemplate[]
  currentRoomId: null, // string | null

  // UI-only (not persisted)
  mode:              'move',   // 'move' | 'toggle' | 'cluster'
  activeClusterId:   null,     // string | null
  activeClassSetId:  null,     // string | null — filter for student panel
  showArchived:      false,    // show archived room tabs
  auditMode:         false,    // highlight constraint violations
  drag: { studentId: null, fromSeatId: null }
};

// Transient edit context for modals
let editCtx = { type: null, id: null };
let pendingPhoto = null; // base64 string | null
let editingClassSetId = null; // class set currently open in editor

/** Returns true if a seat can receive a student assignment. */
function isSeatAssignable(seat) {
  return seat.enabled && !seat.label;
}

/* ============================================================
   UNDO / REDO
============================================================ */
const MAX_HISTORY = 20;
let undoStack = []; // array of {rooms, students} snapshots (BEFORE the mutation)
let redoStack = []; // forward stack (cleared on new mutation)

function snapshotState() {
  return {
    rooms:    JSON.parse(JSON.stringify(state.rooms)),
    students: JSON.parse(JSON.stringify(state.students))
  };
}

function pushHistory() {
  undoStack.push(snapshotState());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  updateUndoRedoBtns();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshotState());
  const prev = undoStack.pop();
  state.rooms    = prev.rooms.map(normaliseRoom);
  state.students = prev.students.map(normaliseStudent);
  if (!state.rooms.find(r => r.id === state.currentRoomId)) {
    state.currentRoomId = state.rooms.find(r => !r.archived)?.id ?? null;
  }
  updateUndoRedoBtns();
  renderAll();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshotState());
  const next = redoStack.pop();
  state.rooms    = next.rooms.map(normaliseRoom);
  state.students = next.students.map(normaliseStudent);
  if (!state.rooms.find(r => r.id === state.currentRoomId)) {
    state.currentRoomId = state.rooms.find(r => !r.archived)?.id ?? null;
  }
  updateUndoRedoBtns();
  renderAll();
}

function updateUndoRedoBtns() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

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

/** Euclidean distance between two seat objects.
 *  Uses pixel x/y for freeform seats, row/col for grid seats.
 *  Returns a grid-unit equivalent (grid seats: 1 unit = one cell). */
function seatDist(s1, s2) {
  if (s1.x !== null && s1.x !== undefined && s2.x !== null && s2.x !== undefined) {
    const dx = s1.x - s2.x, dy = s1.y - s2.y;
    return Math.sqrt(dx * dx + dy * dy) / CELL_SIZE;
  }
  const dr = s1.row - s2.row, dc = s1.col - s2.col;
  return Math.sqrt(dr * dr + dc * dc);
}

function currentRoom() {
  return state.rooms.find(r => r.id === state.currentRoomId) ?? null;
}

/**
 * Snap a pixel coordinate to the nearest multiple of `gridSize`.
 * If `gridSize` is 0 or falsy, returns the value unchanged.
 */
function snapCoord(value, gridSize) {
  if (!gridSize) return value;
  return Math.round(value / gridSize) * gridSize;
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

function avatarColour(gender) {
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
function roomCreate(name = 'New Class', rows = 5, cols = 6) {
  const id = uid();
  const room = {
    id, name, rows, cols,
    seats: [], clusters: [],
    archived:       false,
    layoutMode:     'grid',   // will be converted to freeform below
    frontDirection: 'top',    // 'top' | 'right' | 'bottom' | 'left'
    canvasW: 900,
    canvasH: 700,
    snapGrid: 0,              // 0 = off; positive integer = snap size in px (freeform only)
    classSetId:     null      // class set selected for this room
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      room.seats.push(makeSeat(id, r, c));
    }
  }
  // All rooms are freeform — convert immediately
  roomSwitchToFreeform(room);
  state.rooms.push(room);
  return room;
}

function makeSeat(roomId, r, c) {
  return {
    id: `${roomId}_${r}_${c}`,
    row: r, col: c,
    enabled: true,
    clusterId: null,
    studentId: null,
    label: null,
    pinned: false
  };
}

/** Create a seat at arbitrary pixel coordinates (freeform mode). */
function makeFreeformSeat(roomId, x, y) {
  return { id: uid(), row: -1, col: -1, x, y, enabled: true, clusterId: null, studentId: null, label: null, pinned: false };
}

function roomDelete(id) {
  state.rooms = state.rooms.filter(r => r.id !== id);
  if (state.currentRoomId === id) {
    state.currentRoomId = state.rooms.find(r => !r.archived)?.id ?? state.rooms[0]?.id ?? null;
  }
}

function roomArchive(id) {
  const room = state.rooms.find(r => r.id === id);
  if (room) room.archived = true;
  if (state.currentRoomId === id) {
    state.currentRoomId = state.rooms.find(r => !r.archived)?.id ?? null;
  }
}

function roomUnarchive(id) {
  const room = state.rooms.find(r => r.id === id);
  if (room) room.archived = false;
}

/**
 * Duplicate a room: copies layout, clusters, and seat enabled/cluster state,
 * but does NOT copy student assignments.
 */
function roomDuplicate(room) {
  // Map old cluster IDs → new cluster IDs so seat references stay correct
  const clusterIdMap = {};
  const newClusters = room.clusters.map(cl => {
    const newId = uid();
    clusterIdMap[cl.id] = newId;
    return { ...cl, id: newId };
  });

  const newSeats = room.seats.map(s => ({
    ...s,
    id:        uid(),
    studentId: null, // clear assignments
    clusterId: s.clusterId ? (clusterIdMap[s.clusterId] ?? null) : null
  }));

  const newRoom = {
    id:             uid(),
    name:           room.name + ' (copy)',
    rows:           room.rows,
    cols:           room.cols,
    seats:          newSeats,
    clusters:       newClusters,
    archived:       false,
    layoutMode:     room.layoutMode,
    frontDirection: room.frontDirection,
    canvasW:        room.canvasW,
    canvasH:        room.canvasH
  };

  state.rooms.push(newRoom);
  return newRoom;
}

/** Convert a grid-layout room to freeform, placing seats at their grid pixel positions. */
function roomSwitchToFreeform(room) {
  room.seats.forEach(s => {
    s.x = FREEFORM_PAD + s.col * CELL_SIZE;
    s.y = FREEFORM_PAD + s.row * CELL_SIZE;
  });
  room.canvasW = FREEFORM_PAD + room.cols * CELL_SIZE + FREEFORM_PAD;
  room.canvasH = FREEFORM_PAD + room.rows * CELL_SIZE + FREEFORM_PAD;
  room.layoutMode = 'freeform';
  // Enable snap-to-grid by default so seats align with the background dot grid
  room.snapGrid = FREEFORM_PAD;
}

/** Snap all freeform seats to the nearest grid position and rebuild as a grid room. */
function roomSwitchToGrid(room) {
  const seen    = new Set();
  const snapped = [];

  // Sort by position so top-left seats "win" duplicates
  const sorted = [...room.seats].filter(s => s.enabled).sort((a, b) =>
    ((a.y ?? 0) - (b.y ?? 0)) || ((a.x ?? 0) - (b.x ?? 0))
  );

  for (const s of sorted) {
    const col = Math.max(0, Math.round(((s.x ?? 0) - FREEFORM_PAD) / CELL_SIZE));
    const row = Math.max(0, Math.round(((s.y ?? 0) - FREEFORM_PAD) / CELL_SIZE));
    const key = `${row}_${col}`;
    if (seen.has(key)) continue; // discard duplicate position
    seen.add(key);
    snapped.push(Object.assign({}, s, { row, col, x: undefined, y: undefined }));
  }

  if (!snapped.length) { alert('No seats to convert.'); return; }

  const maxRow = Math.max(...snapped.map(s => s.row));
  const maxCol = Math.max(...snapped.map(s => s.col));
  room.rows = maxRow + 1;
  room.cols = maxCol + 1;

  // Build full grid: snapped seats enabled; gaps disabled
  const seatMap = {};
  snapped.forEach(s => { seatMap[`${s.row}_${s.col}`] = s; });

  room.seats = [];
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= maxCol; c++) {
      const key = `${r}_${c}`;
      if (seatMap[key]) {
        room.seats.push(seatMap[key]);
      } else {
        const empty = makeSeat(room.id, r, c);
        empty.enabled = false;
        room.seats.push(empty);
      }
    }
  }
  room.layoutMode = 'grid';
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
    notes:         data.notes  || '',
    flags:         Array.isArray(data.flags) ? [...data.flags] : [],
    sitNear:       Array.isArray(data.sitNear)      ? [...data.sitNear]      : [],
    doNotSitNear:  Array.isArray(data.doNotSitNear) ? [...data.doNotSitNear] : [],
    absent:        data.absent   || false,
    position:      data.position || ''   // '' | 'front' | 'back' | 'left' | 'right'
  };
  state.students.push(s);
  return s;
}

/** Ensure a student object has all expected fields (backwards-compat). */
function normaliseStudent(s) {
  return Object.assign({
    notes:        '',
    flags:        [],
    sitNear:      [],
    doNotSitNear: [],
    absent:       false,
    position:     ''
  }, s);
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

function clusterCreate(room, name = 'Cluster', colour = null, abilityLevel = null) {
  const cl = {
    id:    uid(),
    name,
    colour:       colour || CLUSTER_COLOURS[room.clusters.length % CLUSTER_COLOURS.length],
    abilityLevel: abilityLevel != null ? Number(abilityLevel) : null
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
 * BFS auto-detect: group all mutually adjacent enabled seats into clusters.
 * Grid mode: 8-connected adjacency. Freeform mode: within FREEFORM_ADJACENCY_PX pixels.
 */
function autoDetectClusters(room) {
  room.clusters = [];
  room.seats.forEach(s => { s.clusterId = null; });
  if (state.activeClusterId) state.activeClusterId = null;

  const enabled = room.seats.filter(s => s.enabled);
  const visited = new Set();
  let colourIdx  = 0;

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
        if (visited.has(n.id)) return;
        const adjacent = room.layoutMode === 'freeform'
          ? Math.hypot((n.x ?? 0) - (cur.x ?? 0), (n.y ?? 0) - (cur.y ?? 0)) <= FREEFORM_ADJACENCY_PX
          : Math.abs(n.row - cur.row) <= 1 && Math.abs(n.col - cur.col) <= 1;
        if (adjacent) {
          visited.add(n.id);
          queue.push(n);
        }
      });
    }

    if (component.length >= 2) {
      const cl = clusterCreate(
        room,
        `Group ${room.clusters.length + 1}`,
        CLUSTER_COLOURS[colourIdx++ % CLUSTER_COLOURS.length]
      );
      component.forEach(s => { s.clusterId = cl.id; });
    }
  });
}

/* ============================================================
   CLASS SET MANAGEMENT
============================================================ */

function classSetCreate(name = 'New Class Set', studentIds = []) {
  const cs = { id: uid(), name, studentIds: [...studentIds] };
  state.classSets.push(cs);
  return cs;
}

function classSetUpdate(id, data) {
  const cs = state.classSets.find(x => x.id === id);
  if (cs) Object.assign(cs, data);
}

function classSetDelete(id) {
  state.classSets = state.classSets.filter(x => x.id !== id);
  if (state.activeClassSetId === id) state.activeClassSetId = null;
  if (editingClassSetId === id) editingClassSetId = null;
}

/** Return the students that belong to the active class set, or all students. */
function visibleStudents() {
  if (!state.activeClassSetId) return state.students;
  const cs = state.classSets.find(x => x.id === state.activeClassSetId);
  if (!cs) return state.students;
  return state.students.filter(s => cs.studentIds.includes(s.id));
}

/* ============================================================
   SEATING ASSIGNMENT
============================================================ */

/**
 * Assign all students to seats in the current room using the chosen method.
 * Respects sitNear / doNotSitNear / position / pinned / absent constraints.
 *
 * @param {'random'|'ability'|'gender'} method
 */
function assignStudents(method) {
  const room = currentRoom();
  if (!room) return;

  // ── Capture previous neighbour pairs before clearing (Feature 8) ──
  const prevPairs = computeNeighbourPairs(room);
  room.prevNeighbourPairs = [...prevPairs];
  const prevSet = new Set(prevPairs);
  const varyNeighbours = document.getElementById('vary-neighbours-cb')?.checked ?? true;

  // ── Preserve pinned assignments (Feature 9) ──
  const pinnedMap = {};
  room.seats.filter(s => s.pinned && s.studentId).forEach(s => { pinnedMap[s.id] = s.studentId; });

  // Clear existing (non-pinned restored below)
  room.seats.forEach(s => { s.studentId = null; });

  // Restore pinned
  Object.entries(pinnedMap).forEach(([seatId, stuId]) => {
    const s = seatById(room, seatId);
    if (s) s.studentId = stuId;
  });

  // Only assignable seats (enabled and not labelled as a room object)
  const seats = room.seats.filter(s => isSeatAssignable(s));
  if (!seats.length) { alert('No seats available in this room.'); return; }

  const pinnedStudentIds = new Set(Object.values(pinnedMap));
  const availableSeats   = seats.filter(s => !s.pinned);

  // Exclude absent and already-pinned students
  let students = visibleStudents().filter(s => !s.absent && !pinnedStudentIds.has(s.id));
  if (!students.length && !Object.keys(pinnedMap).length) { alert('No students to assign.'); return; }

  // ── Sort students ──────────────────────────────────────────
  if (method === 'random') {
    students = shuffle(students);

  } else if (method === 'ability') {
    students.sort((a, b) => {
      const bm = b.marks ?? -Infinity;
      const am = a.marks ?? -Infinity;
      return bm - am; // highest marks first
    });

    // If any clusters have ability levels set, distribute students into those
    // clusters in order (level 1 = highest ability, level 2 = next, …).
    const levelledClusters = room.clusters.filter(c => c.abilityLevel != null);
    if (levelledClusters.length) {
      // Unique levels in ascending order (1 first → highest ability)
      const levels = [...new Set(levelledClusters.map(c => c.abilityLevel))].sort((a, b) => a - b);

      // Seats partitioned by ability level (single pass)
      const seatsByLevel = {};
      levels.forEach(lvl => { seatsByLevel[lvl] = []; });
      const levelClusterToLevel = {};
      levelledClusters.forEach(c => { levelClusterToLevel[c.id] = c.abilityLevel; });
      availableSeats.forEach(s => {
        if (s.clusterId && levelClusterToLevel[s.clusterId] != null) {
          seatsByLevel[levelClusterToLevel[s.clusterId]].push(s);
        }
      });

      // Seats not covered by any levelled cluster
      const levelledIds = new Set(levelledClusters.map(c => c.id));
      const unlevelledSeats = availableSeats.filter(s => !s.clusterId || !levelledIds.has(s.clusterId));

      // Partition students: each levelled pool gets as many students as it has seats
      const studentsByLevel = {};
      let idx = 0;
      levels.forEach(lvl => {
        const count = seatsByLevel[lvl].length;
        studentsByLevel[lvl] = students.slice(idx, idx + count);
        idx += count;
      });
      const remainingStudents = students.slice(idx);

      // ── Enforce sitNear constraints across ability levels ───
      // If two students who must sit near each other would be placed in
      // different ability-level groups, move the partner into the same
      // group as the student who references them (taking priority over
      // pure ability-rank ordering).  Repeat until stable.
      let changed = true;
      // +2 gives two extra passes to resolve chains of constraints without
      // risking an infinite loop on pathological data.
      let passLimit = levels.length + 2;
      while (changed && passLimit-- > 0) {
        changed = false;
        for (const lvl of levels) {
          // Shallow copy to avoid modifying the list while we splice into it
          for (const student of [...studentsByLevel[lvl]]) {
            for (const nearId of (student.sitNear || [])) {
              const nearStudent = studentById(nearId);
              if (!nearStudent) continue;
              // Find which levelled group nearStudent is currently in.
              // If not found in any level (!nearLevel) they are in the
              // remaining/unlabelled pool — leave them there.
              const nearLevel = levels.find(l => studentsByLevel[l].includes(nearStudent));
              if (!nearLevel || nearLevel === lvl) continue; // already together, or unlevelled
              // Move nearStudent to this level, right after 'student'
              studentsByLevel[nearLevel].splice(studentsByLevel[nearLevel].indexOf(nearStudent), 1);
              const afterIdx = studentsByLevel[lvl].indexOf(student);
              studentsByLevel[lvl].splice(afterIdx + 1, 0, nearStudent);
              // If this level now has more students than seats, overflow
              // the last student (lowest marks in the group) to remaining
              while (studentsByLevel[lvl].length > seatsByLevel[lvl].length) {
                remainingStudents.push(studentsByLevel[lvl].pop());
              }
              changed = true;
            }
          }
        }
      }

      // Helper: greedy placement of a student list into a seat pool
      const greedyPlace = (studentList, seatPool) => {
        for (const student of studentList) {
          const available = seatPool.filter(s => !s.studentId);
          if (!available.length) break;
          let best = available[0], bestScore = -Infinity;
          for (const seat of available) {
            let score = Math.random() * 0.02;
            (student.sitNear || []).forEach(nearId => {
              const ns = seats.find(s => s.studentId === nearId);
              if (ns) score += 500 / (1 + seatDist(seat, ns));
            });
            (student.doNotSitNear || []).forEach(awayId => {
              const ns = seats.find(s => s.studentId === awayId);
              if (ns) score -= 1000 / (1 + seatDist(seat, ns));
            });
            score += seatPositionScore(seat, student, room);
            if (varyNeighbours && prevSet.size) {
              seats.filter(s => s.studentId && seatDist(seat, s) <= 1.5).forEach(ns => {
                const key = [student.id, ns.studentId].sort().join(':');
                if (prevSet.has(key)) score -= 50;
              });
            }
            if (score > bestScore) { bestScore = score; best = seat; }
          }
          best.studentId = student.id;
        }
      };

      // Place each ability group into its designated seats
      levels.forEach(lvl => greedyPlace(studentsByLevel[lvl], seatsByLevel[lvl]));
      // Remaining students (overflow from sitNear adjustments, or extras beyond
      // levelled-cluster capacity) go into any still-empty available seat.
      greedyPlace(remainingStudents, availableSeats);

      // Skip the default greedy loop below
      room.assignmentHistory = room.assignmentHistory || [];
      room.assignmentHistory.unshift({
        id:    uid(),
        ts:    Date.now(),
        method,
        seats: room.seats.map(s => ({ id: s.id, studentId: s.studentId }))
      });
      if (room.assignmentHistory.length > 10) room.assignmentHistory.pop();
      return;
    }

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
  const pool = [...availableSeats];

  for (const student of students) {
    const available = pool.filter(s => !s.studentId);
    if (!available.length) break;

    let best = available[0], bestScore = -Infinity;

    for (const seat of available) {
      // Small random noise avoids always picking top-left on ties
      let score = Math.random() * 0.02;

      (student.sitNear || []).forEach(nearId => {
        const ns = pool.find(s => s.studentId === nearId);
        if (ns) score += 500 / (1 + seatDist(seat, ns));
      });

      (student.doNotSitNear || []).forEach(awayId => {
        const ns = pool.find(s => s.studentId === awayId);
        if (ns) score -= 1000 / (1 + seatDist(seat, ns));
      });

      score += seatPositionScore(seat, student, room);

      if (varyNeighbours && prevSet.size) {
        seats.filter(s => s.studentId && seatDist(seat, s) <= 1.5).forEach(ns => {
          const key = [student.id, ns.studentId].sort().join(':');
          if (prevSet.has(key)) score -= 50;
        });
      }

      if (score > bestScore) { bestScore = score; best = seat; }
    }

    best.studentId = student.id;
  }

  // ── Save to per-room assignment history ────────────────────
  room.assignmentHistory = room.assignmentHistory || [];
  room.assignmentHistory.unshift({
    id:     uid(),
    ts:     Date.now(),
    method,
    seats:  room.seats.map(s => ({ id: s.id, studentId: s.studentId }))
  });
  if (room.assignmentHistory.length > 10) room.assignmentHistory.pop();
}

/* ============================================================
   POSITION SCORING (Feature 5)
============================================================ */
/**
 * Returns a score bonus (0–200) for placing a student with a position
 * preference into a given seat, based on the room's front direction.
 */
function seatPositionScore(seat, student, room) {
  if (!student.position) return 0;
  const seats = room.seats.filter(isSeatAssignable);
  if (!seats.length) return 0;
  const fd = room.frontDirection || 'top';

  const sRow = seat.row >= 0 ? seat.row : (seat.y != null ? seat.y / CELL_SIZE : 0);
  const sCol = seat.col >= 0 ? seat.col : (seat.x != null ? seat.x / CELL_SIZE : 0);

  const minR = Math.min(...seats.map(s => s.row >= 0 ? s.row : (s.y != null ? s.y / CELL_SIZE : 0)));
  const maxR = Math.max(...seats.map(s => s.row >= 0 ? s.row : (s.y != null ? s.y / CELL_SIZE : 0)));
  const minC = Math.min(...seats.map(s => s.col >= 0 ? s.col : (s.x != null ? s.x / CELL_SIZE : 0)));
  const maxC = Math.max(...seats.map(s => s.col >= 0 ? s.col : (s.x != null ? s.x / CELL_SIZE : 0)));

  const rowRatio = maxR > minR ? (sRow - minR) / (maxR - minR) : 0.5;
  const colRatio = maxC > minC ? (sCol - minC) / (maxC - minC) : 0.5;

  let frontRatio;
  if      (fd === 'top')    frontRatio = rowRatio;
  else if (fd === 'bottom') frontRatio = 1 - rowRatio;
  else if (fd === 'left')   frontRatio = colRatio;
  else                      frontRatio = 1 - colRatio;

  if (student.position === 'front') return 200 * (1 - frontRatio);
  if (student.position === 'back')  return 200 * frontRatio;
  if (student.position === 'left')  return 200 * (1 - colRatio);
  if (student.position === 'right') return 200 * colRatio;
  return 0;
}

/* ============================================================
   NEIGHBOUR PAIR TRACKING (Feature 8)
============================================================ */
function computeNeighbourPairs(room) {
  const seats = room.seats.filter(isSeatAssignable);
  const pairs = new Set();
  seats.forEach(s => {
    if (!s.studentId) return;
    seats.forEach(n => {
      if (!n.studentId || n.id === s.id) return;
      if (seatDist(s, n) <= 1.5) {
        const key = [s.studentId, n.studentId].sort().join(':');
        pairs.add(key);
      }
    });
  });
  return pairs;
}

/* ============================================================
   ROOM TEMPLATES (Feature 10)
============================================================ */
function saveRoomAsTemplate(room) {
  const name = window.prompt('Template name:', room.name + ' layout');
  if (!name || !name.trim()) return;
  const tmpl = {
    id: uid(),
    name: name.trim(),
    rows: room.rows, cols: room.cols,
    layoutMode: room.layoutMode,
    canvasW: room.canvasW, canvasH: room.canvasH,
    clusters: JSON.parse(JSON.stringify(room.clusters)),
    seats: room.seats.map(s => ({
      id: s.id, row: s.row, col: s.col, x: s.x, y: s.y,
      enabled: s.enabled, clusterId: s.clusterId, label: s.label,
      pinned: false
    }))
  };
  state.roomTemplates.push(tmpl);
  scheduleAutosave();
  alert('Template "' + tmpl.name + '" saved. Apply it to any room via "\u{1F4D0} Apply Template".');
}

function applyTemplateToRoom(room) {
  if (!state.roomTemplates.length) {
    alert('No templates saved yet. Save a layout template from another room first using "\u{1F4BE} Template".');
    return;
  }
  const names = state.roomTemplates.map((t, i) => (i + 1) + '. ' + t.name).join('\n');
  const choice = window.prompt('Choose a template (enter number):\n\n' + names);
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= state.roomTemplates.length) {
    if (choice !== null) alert('Invalid choice.');
    return;
  }
  if (!confirm('Apply template? The current room layout will be replaced (student assignments will be cleared).')) return;
  const tmpl = state.roomTemplates[idx];
  pushHistory();
  const clusterIdMap = {};
  room.clusters = tmpl.clusters.map(cl => {
    const newId = uid();
    clusterIdMap[cl.id] = newId;
    return Object.assign({}, cl, { id: newId });
  });
  room.rows = tmpl.rows; room.cols = tmpl.cols;
  room.layoutMode = tmpl.layoutMode;
  room.canvasW = tmpl.canvasW; room.canvasH = tmpl.canvasH;
  room.seats = tmpl.seats.map(s => Object.assign({}, s, {
    id: uid(),
    studentId: null,
    clusterId: s.clusterId ? (clusterIdMap[s.clusterId] || null) : null
  }));
  scheduleAutosave();
  renderAll();
}

/* ============================================================
   DRAG & DROP
============================================================ */

function handleDrop(targetSeatId) {
  const room = currentRoom();
  if (!room) return;

  const target = seatById(room, targetSeatId);
  if (!target || !isSeatAssignable(target)) return;

  const { studentId, fromSeatId } = state.drag;
  if (!studentId) return;
  if (target.studentId === studentId) { resetDrag(); return; }

  pushHistory();

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

/** Ensure a room object has all expected fields (backwards-compat). */
function normaliseRoom(room) {
  const r = Object.assign({
    archived:           false,
    clusters:           [],
    seats:              [],
    layoutMode:         'grid',
    frontDirection:     'top',
    canvasW:            900,
    canvasH:            700,
    assignmentHistory:  [],
    snapGrid:           0,    // 0 = off; positive integer = snap size in px
    prevNeighbourPairs: [],   // serialised Set of "id1:id2" strings from last assignment
    classSetId:         null  // remembered class set for this room
  }, room);
  // Migrate any legacy grid-layout rooms to freeform
  if (r.layoutMode === 'grid') roomSwitchToFreeform(r);
  return r;
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

/* ============================================================
   STATISTICS
============================================================ */
function computeStats(room) {
  if (!room) return null;
  const seats    = room.seats.filter(isSeatAssignable);
  const assigned = seats.filter(s => s.studentId);
  const students = visibleStudents();
  const seatedIds = new Set(assigned.map(s => s.studentId));
  const unseated  = students.filter(s => !seatedIds.has(s.id));

  const seatedStudents = assigned.map(s => studentById(s.studentId)).filter(Boolean);
  const gender = { male: 0, female: 0, other: 0 };
  seatedStudents.forEach(s => {
    if (s.gender === 'male') gender.male++;
    else if (s.gender === 'female') gender.female++;
    else gender.other++;
  });

  let sitNearTotal = 0, sitNearSatisfied = 0;
  let doNotTotal   = 0, doNotViolations  = 0;
  // Avoid double-counting (each pair once)
  const checked = new Set();
  seatedStudents.forEach(student => {
    const seat = seats.find(s => s.studentId === student.id);
    if (!seat) return;
    (student.sitNear || []).forEach(nearId => {
      const pairKey = [student.id, nearId].sort().join(':');
      if (checked.has('sn:' + pairKey)) return;
      checked.add('sn:' + pairKey);
      const nearSeat = seats.find(s => s.studentId === nearId);
      if (!nearSeat) return;
      sitNearTotal++;
      if (seatDist(seat, nearSeat) <= 2) sitNearSatisfied++;
    });
    (student.doNotSitNear || []).forEach(awayId => {
      const pairKey = [student.id, awayId].sort().join(':');
      if (checked.has('dn:' + pairKey)) return;
      checked.add('dn:' + pairKey);
      const awaySeat = seats.find(s => s.studentId === awayId);
      if (!awaySeat) return;
      doNotTotal++;
      if (seatDist(seat, awaySeat) <= 2) doNotViolations++;
    });
  });

  const clusterStats = room.clusters.map(cl => {
    const clSeats    = seats.filter(s => s.clusterId === cl.id);
    const clStudents = clSeats.map(s => studentById(s.studentId)).filter(Boolean);
    const cg = { male: 0, female: 0, other: 0 };
    clStudents.forEach(s => {
      if (s.gender === 'male') cg.male++;
      else if (s.gender === 'female') cg.female++;
      else cg.other++;
    });
    return { name: cl.name, colour: cl.colour, count: clStudents.length, gender: cg };
  });

  return {
    totalSeats: seats.length, assigned: assigned.length,
    empty: seats.length - assigned.length, unseated: unseated.length,
    gender, sitNearTotal, sitNearSatisfied,
    doNotTotal, doNotViolations, clusterStats
  };
}

function showStatsModal() {
  const room = currentRoom();
  const body = document.getElementById('stats-body');
  body.innerHTML = '';

  if (!room) {
    body.innerHTML = '<p class="empty-msg">No room selected.</p>';
    showModalEl('stats-modal'); return;
  }

  const st = computeStats(room);
  if (!st) return;

  const pct = (n, d) => d ? Math.round(n / d * 100) : 0;

  body.innerHTML = `
    <div class="stats-grid">
      <div class="stats-card">
        <div class="stats-number">${st.assigned}</div>
        <div class="stats-label">Assigned</div>
      </div>
      <div class="stats-card">
        <div class="stats-number">${st.empty}</div>
        <div class="stats-label">Empty seats</div>
      </div>
      <div class="stats-card">
        <div class="stats-number">${st.unseated}</div>
        <div class="stats-label">Unseated students</div>
      </div>
    </div>

    <div class="stats-section">
      <h4>Gender Distribution</h4>
      <div class="stats-grid">
        <div class="stats-card">
          <div class="stats-number stats-male">${st.gender.male}</div>
          <div class="stats-label">Male</div>
        </div>
        <div class="stats-card">
          <div class="stats-number stats-female">${st.gender.female}</div>
          <div class="stats-label">Female</div>
        </div>
        <div class="stats-card">
          <div class="stats-number stats-other">${st.gender.other}</div>
          <div class="stats-label">Other/Unspec.</div>
        </div>
      </div>
    </div>

    ${st.sitNearTotal > 0 || st.doNotTotal > 0 ? `
    <div class="stats-section">
      <h4>Constraints</h4>
      ${st.sitNearTotal > 0 ? `
      <div class="stats-constraint">
        <span class="stats-constraint-label">✅ Sit-near satisfied</span>
        <span class="stats-constraint-value">${st.sitNearSatisfied} / ${st.sitNearTotal}</span>
        <div class="stats-constraint-bar">
          <div class="stats-bar-fill stats-bar-success" style="width:${pct(st.sitNearSatisfied, st.sitNearTotal)}%"></div>
        </div>
      </div>` : ''}
      ${st.doNotTotal > 0 ? `
      <div class="stats-constraint">
        <span class="stats-constraint-label">⚠️ Separation violations</span>
        <span class="stats-constraint-value ${st.doNotViolations > 0 ? 'stats-danger' : ''}">${st.doNotViolations} / ${st.doNotTotal}</span>
      </div>` : ''}
    </div>` : ''}

    ${st.clusterStats.length > 0 ? `
    <div class="stats-section">
      <h4>Clusters</h4>
      ${st.clusterStats.map(cs => `
      <div class="stats-cluster">
        <span class="cluster-dot" style="background:${cs.colour}"></span>
        <span class="stats-cluster-name">${cs.name}</span>
        <span class="stats-cluster-count">${cs.count} students</span>
        <span class="stats-cluster-gender">${cs.gender.male}M · ${cs.gender.female}F · ${cs.gender.other}O</span>
      </div>`).join('')}
    </div>` : ''}
  `;

  showModalEl('stats-modal');
}

/* ============================================================
   ASSIGNMENT HISTORY
============================================================ */
function showHistoryModal() {
  const room = currentRoom();
  const body = document.getElementById('history-body');
  body.innerHTML = '';

  if (!room) {
    body.innerHTML = '<p class="empty-msg">No room selected.</p>';
    showModalEl('history-modal'); return;
  }

  const history = room.assignmentHistory || [];
  if (!history.length) {
    body.innerHTML = '<p class="empty-msg">No assignment history yet.<br>Use "▶ Assign" to generate a seating plan.</p>';
    showModalEl('history-modal'); return;
  }

  history.forEach((snap, idx) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const date    = new Date(snap.ts).toLocaleString();
    const count   = snap.seats.filter(s => s.studentId).length;
    const mLabel  = document.createElement('span');
    mLabel.className = 'history-date';
    mLabel.textContent = date;
    const mMethod = document.createElement('span');
    mMethod.className = 'history-method';
    mMethod.textContent = snap.method;
    const mCount  = document.createElement('span');
    mCount.className = 'history-count';
    mCount.textContent = `${count} assigned`;
    meta.appendChild(mLabel);
    meta.appendChild(mMethod);
    meta.appendChild(mCount);

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn btn-secondary btn-sm';
    if (idx === 0) {
      restoreBtn.textContent = '✔ Current';
      restoreBtn.disabled = true;
    } else {
      restoreBtn.textContent = '↩ Restore';
      restoreBtn.addEventListener('click', () => {
        if (confirm('Restore this seating assignment? Current layout will be saved to undo history.')) {
          pushHistory();
          restoreAssignment(room, snap);
          closeModal();
          renderGrid();
          renderStudentList();
          scheduleAutosave();
        }
      });
    }

    item.appendChild(meta);
    item.appendChild(restoreBtn);
    body.appendChild(item);
  });

  showModalEl('history-modal');
}

function restoreAssignment(room, snapshot) {
  const seatMap = {};
  room.seats.forEach(s => { seatMap[s.id] = s; });
  snapshot.seats.forEach(({ id, studentId }) => {
    if (seatMap[id]) seatMap[id].studentId = studentId;
  });
}

/* ============================================================
   HELP GUIDE
============================================================ */
function openHelpModal() {
  const body = document.getElementById('help-body');
  if (!body) return;
  body.innerHTML = `
<div class="help-toc">
  <strong>Contents:</strong>
  <a href="#h-overview">Overview</a>
  <a href="#h-classes">Managing Classes</a>
  <a href="#h-students">Managing Students</a>
  <a href="#h-classsets">Class Sets</a>
  <a href="#h-layout">Seating Layout</a>
  <a href="#h-assign">Assigning Students</a>
  <a href="#h-clusters">Clusters / Groups</a>
  <a href="#h-save">Saving &amp; Loading</a>
  <a href="#h-shortcuts">Keyboard Shortcuts</a>
</div>

<section id="h-overview" class="help-section">
  <h4>🎓 Overview</h4>
  <p>Seating Plan Generator lets you create and manage flexible seating plans for your classes.
  Each <em>class</em> has its own freeform canvas where you can place desks, assign students, and organise groups.</p>
  <ul>
    <li><strong>Left panel</strong> — student roster, filtered by class set</li>
    <li><strong>Centre panel</strong> — the seating plan canvas for the current class</li>
    <li><strong>Right panel</strong> — clusters / groups for the current class</li>
  </ul>
</section>

<section id="h-classes" class="help-section">
  <h4>🏫 Managing Classes</h4>
  <ul>
    <li><strong>＋ New Class</strong> — creates a new class with a blank freeform canvas.</li>
    <li><strong>✏ (pencil icon on tab)</strong> — rename the class.</li>
    <li><strong>⧉ Duplicate</strong> — copies the current class layout (without student assignments).</li>
    <li><strong>📦 Archive</strong> — hides the class from the tab bar. Click <em>📦 Archived</em> to toggle visibility of archived classes.</li>
    <li><strong>🗑 Delete Class</strong> — permanently deletes the class and its layout.</li>
    <li><strong>💾 Template / 📐 Apply</strong> — save the current layout as a reusable template, then apply it to another class.</li>
  </ul>
  <p>Each class remembers which <em>Class Set</em> was last active, so switching tabs restores your student filter automatically.</p>
</section>

<section id="h-students" class="help-section">
  <h4>👥 Managing Students</h4>
  <ul>
    <li><strong>＋ Add</strong> — open the student form to add a new student.</li>
    <li><strong>📥 CSV</strong> — import students from a CSV file. Required column: <em>name</em>. Optional: <em>gender</em>, <em>marks</em>.</li>
    <li><strong>📤 Export</strong> — download the student list as a CSV file.</li>
    <li><strong>✏️ (edit icon)</strong> — edit a student's details, flags, photo, and seating constraints.</li>
    <li><strong>🏠 / ✅ (absent toggle)</strong> — mark a student absent; they will be skipped during assignment.</li>
    <li><strong>🗑 (delete icon)</strong> — remove the student from all classes.</li>
  </ul>
  <h5>Student fields</h5>
  <ul>
    <li><strong>Gender</strong> — used by the "By Gender" assignment method to alternate male/female.</li>
    <li><strong>Marks / Ability</strong> — used by the "By Ability" method to seat highest achievers in ability-levelled clusters.</li>
    <li><strong>Preferred position</strong> — Front, Back, Left, or Right of class. The algorithm scores seats accordingly.</li>
    <li><strong>Flags</strong> — SEN, EAL, Gifted, Behaviour, or custom flags shown as coloured pills on each desk.</li>
    <li><strong>Sit near / Do not sit near</strong> — hard constraints respected during assignment scoring.</li>
    <li><strong>Photo</strong> — optional portrait shown in the student card and desk tile.</li>
  </ul>
</section>

<section id="h-classsets" class="help-section">
  <h4>📋 Class Sets</h4>
  <p>Class Sets let you define named subsets of students (e.g. "Year 10 Maths", "Period 3") so that each class tab shows only the relevant students.</p>
  <ul>
    <li>Click <strong>⚙️</strong> (gear icon) in the Students panel to open <em>Manage Class Sets</em>.</li>
    <li>Create a class set, give it a name, and tick the students who belong to it.</li>
    <li>Use the dropdown at the top of the Students panel to filter by a class set.</li>
    <li>Each class (tab) remembers which class set was last selected — switching tabs restores your filter automatically.</li>
    <li>Assignments only include students visible in the current filter.</li>
  </ul>
</section>

<section id="h-layout" class="help-section">
  <h4>🖊 Seating Layout</h4>
  <p>All classes use a <strong>freeform</strong> canvas where desks can be placed anywhere.</p>
  <ul>
    <li>Switch to <strong>⊞ Edit Layout</strong> mode (toolbar or press <kbd>4</kbd>) to add, move, or delete desks.</li>
    <li><strong>Click an empty area</strong> of the canvas to add a new desk.</li>
    <li><strong>Drag a desk</strong> to reposition it. The snap grid helps alignment.</li>
    <li><strong>Right-click a desk</strong> in Edit Layout mode to delete it.</li>
    <li>Use the <strong>W / H</strong> inputs to resize the canvas.</li>
    <li>Set the <strong>Snap</strong> value (pixels) to align desks to a grid; set to 0 to disable snapping.</li>
    <li>The <strong>Front ↑→↓←</strong> buttons set which side of the canvas is the front of the class; this affects the "Preferred position" scoring during assignment.</li>
    <li><strong>Right-click any desk</strong> (in Move mode) to label it as a Teacher's Desk, Whiteboard, Bookshelf, Projector, or Computer — labelled desks are excluded from student assignment.</li>
    <li>Use <strong>📌 Pin</strong> (right-click menu) to pin a student to a specific desk; pinned students are not moved when re-assigning.</li>
  </ul>
</section>

<section id="h-assign" class="help-section">
  <h4>▶ Assigning Students</h4>
  <ul>
    <li><strong>▶ Assign</strong> — places all visible (non-absent) students into available desks using the chosen method.</li>
    <li><strong>✕ Clear</strong> — removes all student assignments from the current class.</li>
    <li><strong>🔄 Vary</strong> — when checked, the algorithm penalises placing the same neighbours together as last time, encouraging variety across assignments.</li>
  </ul>
  <h5>Assignment methods</h5>
  <ul>
    <li><strong>Random</strong> — shuffles students and places them randomly.</li>
    <li><strong>By Ability (Marks)</strong> — sorts students by marks (highest first) and places them into ability-levelled clusters if configured; otherwise fills seats in order.</li>
    <li><strong>By Gender</strong> — interleaves male and female students, appending others.</li>
  </ul>
  <p>All methods respect <em>Sit near</em>, <em>Do not sit near</em>, and <em>Preferred position</em> constraints via a greedy scoring algorithm.</p>
  <ul>
    <li><strong>↩ Undo / ↪ Redo</strong> — step back or forward through changes (up to 20 steps).</li>
    <li><strong>📊 Stats</strong> — summary of seat usage, gender balance, and constraint satisfaction.</li>
    <li><strong>🕐 History</strong> — view and restore previous assignment snapshots (up to 10 per class).</li>
    <li><strong>🔍 Audit</strong> — highlights desks where a student's constraints are violated.</li>
  </ul>
</section>

<section id="h-clusters" class="help-section">
  <h4>🔲 Clusters / Groups</h4>
  <p>Clusters are named groups of desks (e.g. "Table 1", "High Ability"). They are shown with a coloured border and can be used to direct the ability-based assignment.</p>
  <ul>
    <li><strong>＋ Add</strong> — create a cluster with a name, colour, and optional ability level.</li>
    <li><strong>🔲 Edit Clusters</strong> mode — click desks to assign or remove them from the selected cluster.</li>
    <li><strong>🔍 Auto-Detect</strong> — automatically groups adjacent desks into clusters.</li>
    <li><strong>Ability level</strong> — set 1 = highest ability on a cluster. The "By Ability" assignment method fills level-1 clusters with the highest-marks students first.</li>
  </ul>
</section>

<section id="h-save" class="help-section">
  <h4>💾 Saving &amp; Loading</h4>
  <ul>
    <li>Your work is <strong>auto-saved</strong> to your browser's local storage after every change (indicated by the ✔ Saved badge).</li>
    <li><strong>💾 Save JSON</strong> — download a full backup as a <code>.json</code> file.</li>
    <li><strong>📂 Load JSON</strong> — restore from a previously saved <code>.json</code> file.</li>
    <li><strong>📊 CSV</strong> — export the current seating plan (assigned students, rows/cols, clusters) as a spreadsheet.</li>
    <li><strong>🖨 Print</strong> — opens the browser print dialog. The UI chrome is hidden; only the seating plan is printed. Use "Save as PDF" for a digital copy.</li>
  </ul>
</section>

<section id="h-shortcuts" class="help-section">
  <h4>⌨ Keyboard Shortcuts</h4>
  <table class="help-table">
    <tr><td><kbd>A</kbd></td><td>Assign students (uses current method)</td></tr>
    <tr><td><kbd>C</kbd></td><td>Clear all assignments</td></tr>
    <tr><td><kbd>1</kbd></td><td>Switch to Move mode</td></tr>
    <tr><td><kbd>2</kbd></td><td>Switch to Edit Seats mode</td></tr>
    <tr><td><kbd>3</kbd></td><td>Switch to Edit Clusters mode</td></tr>
    <tr><td><kbd>4</kbd></td><td>Switch to Edit Layout mode</td></tr>
    <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd></td><td>Undo</td></tr>
    <tr><td><kbd>Ctrl</kbd>+<kbd>Y</kbd></td><td>Redo</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Close modal / menu</td></tr>
    <tr><td><kbd>Enter</kbd></td><td>Submit open modal form</td></tr>
  </table>
</section>
`;
  showModalEl('help-modal');
}


function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('spg_dark_mode', isDark ? '1' : '0');
  const btn = document.getElementById('dark-mode-btn');
  if (btn) btn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
}

function applyDarkModePreference() {
  if (localStorage.getItem('spg_dark_mode') === '1') {
    document.body.classList.add('dark-mode');
    const btn = document.getElementById('dark-mode-btn');
    if (btn) btn.textContent = '☀️ Light';
  }
}

/* ============================================================
   CAPACITY BADGE
============================================================ */
function updateCapacityBadge(room) {
  const badge = document.getElementById('capacity-badge');
  if (!badge) return;
  if (!room) { badge.textContent = ''; return; }
  const seats  = room.seats.filter(isSeatAssignable);
  const filled = seats.filter(s => s.studentId).length;
  const total  = seats.length;
  badge.textContent = `${filled} / ${total} seats`;
  badge.className = 'capacity-badge' + (total > 0 && filled === total ? ' full' : '');
}

/* ============================================================
   SEAT TOOLTIP
============================================================ */
function showSeatTooltip(studentId, anchorEl) {
  const student = studentById(studentId);
  if (!student) return;
  const tooltip = document.getElementById('seat-tooltip');
  if (!tooltip) return;

  const flags = (student.flags || []).map(key => {
    const f = allFlags().find(x => x.key === key);
    return f ? `<span class="tt-flag" style="background:${f.colour}">${f.label}</span>` : '';
  }).join('');

  const detParts = [];
  if (student.gender) detParts.push(student.gender.charAt(0).toUpperCase() + student.gender.slice(1));
  if (student.marks != null) detParts.push(`${student.marks}%`);

  tooltip.innerHTML =
    `<div class="tt-name">${student.name}</div>` +
    (detParts.length ? `<div class="tt-details">${detParts.join(' · ')}</div>` : '') +
    (flags ? `<div class="tt-flags">${flags}</div>` : '') +
    (student.notes ? `<div class="tt-notes">${student.notes}</div>` : '');

  const rect = anchorEl.getBoundingClientRect();
  const ttW  = 210;
  let left = rect.right + 8;
  let top  = rect.top;
  if (left + ttW > window.innerWidth) left = rect.left - ttW - 8;
  if (left < 8) left = 8;
  tooltip.style.left    = left + 'px';
  tooltip.style.top     = Math.max(8, top) + 'px';
  tooltip.style.display = 'block';
}

function hideSeatTooltip() {
  const tooltip = document.getElementById('seat-tooltip');
  if (tooltip) tooltip.style.display = 'none';
}

/* ============================================================
   SEAT CONTEXT MENU
============================================================ */
let ctxMenuSeatId = null;
let ctxMenuRoomId = null;

function showSeatContextMenu(clientX, clientY, seat, room) {
  ctxMenuSeatId = seat.id;
  ctxMenuRoomId = room.id;
  const menu = document.getElementById('seat-ctx-menu');
  if (!menu) return;

  // Show "Clear student" option only when a student is currently seated here
  const hasStu = !!(seat.studentId && !seat.label);
  const clearBtn = document.getElementById('seat-ctx-clear-btn');
  const divider  = menu.querySelector('.seat-ctx-divider');
  if (clearBtn) clearBtn.style.display = hasStu ? '' : 'none';
  if (divider)  divider.style.display  = hasStu ? '' : 'none';

  // Show pin/unpin button only when a student is seated
  const pinBtn = document.getElementById('seat-ctx-pin-btn');
  if (pinBtn) {
    pinBtn.style.display = hasStu ? '' : 'none';
    pinBtn.textContent   = seat.pinned ? '\u{1F4CC} Unpin seat' : '\u{1F4CC} Pin student here';
  }

  menu.style.left    = clientX + 'px';
  menu.style.top     = clientY + 'px';
  menu.style.display = 'block';
}

function hideSeatContextMenu() {
  const menu = document.getElementById('seat-ctx-menu');
  if (menu) menu.style.display = 'none';
  ctxMenuSeatId = null;
  ctxMenuRoomId = null;
}

/* ============================================================
   LABELED SEAT RENDERING HELPER
============================================================ */
function buildLabeledSeat(seat) {
  const info = SEAT_LABELS[seat.label] || { icon: '📌', name: seat.label };
  const wrap = document.createElement('div');
  wrap.className = 'labeled-seat-content';
  const icon = document.createElement('div');
  icon.className = 'labeled-seat-icon';
  icon.textContent = info.icon;
  const txt = document.createElement('div');
  txt.className = 'labeled-seat-name';
  txt.textContent = info.name;
  wrap.appendChild(icon);
  wrap.appendChild(txt);
  return wrap;
}
function renderTabs() {
  const el = document.getElementById('room-tabs');
  el.innerHTML = '';

  const archivedCount = state.rooms.filter(r => r.archived).length;
  const toggleBtn = document.getElementById('toggle-archived-btn');
  if (toggleBtn) {
    toggleBtn.textContent = `📦 Archived${archivedCount ? ` (${archivedCount})` : ''}`;
    toggleBtn.classList.toggle('active-archived', state.showArchived);
  }

  state.rooms.forEach(room => {
    if (room.archived && !state.showArchived) return;

    const btn = document.createElement('button');
    btn.className = 'room-tab' +
      (room.id === state.currentRoomId ? ' active' : '') +
      (room.archived ? ' archived-tab' : '');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = (room.archived ? '📦 ' : '') + room.name;

    const editIcon = document.createElement('span');
    editIcon.className = 'tab-edit';
    editIcon.textContent = '✏';
    editIcon.title = 'Rename class';
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
   RENDER — STUDENT LIST + CLASS SET BAR
============================================================ */
function renderClassSetBar() {
  const sel = document.getElementById('class-set-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">All Students</option>';
  state.classSets.forEach(cs => {
    const opt = document.createElement('option');
    opt.value = cs.id;
    opt.textContent = `${cs.name} (${cs.studentIds.length})`;
    sel.appendChild(opt);
  });
  // Restore class set from the current room
  const room = currentRoom();
  const roomClassSetId = room?.classSetId ?? null;
  if (roomClassSetId && [...sel.options].some(o => o.value === roomClassSetId)) {
    sel.value = roomClassSetId;
    state.activeClassSetId = roomClassSetId;
  } else {
    sel.value = '';
    state.activeClassSetId = null;
  }
}

function renderStudentList() {
  const el = document.getElementById('student-list');
  el.innerHTML = '';

  const query = (document.getElementById('student-search').value ?? '').toLowerCase().trim();
  const visible = visibleStudents();
  // Apply search filter on top of class-set filter
  const shown = query
    ? visible.filter(s => s.name.toLowerCase().includes(query))
    : visible;

  if (!state.students.length) {
    el.innerHTML = '<div class="empty-msg">No students yet.<br>Click "＋ Add" to add students,<br>or "📥 CSV" to import.<br><br>Tip: Use <strong>Class Sets</strong> (⚙️) to filter students per class.</div>';
    return;
  }

  if (!shown.length) {
    const msg = query
      ? 'No students match your search.'
      : 'No students in this class set.<br>Manage class sets using ⚙️.';
    el.innerHTML = `<div class="empty-msg">${msg}</div>`;
    return;
  }

  const room = currentRoom();
  shown.forEach(student => {
    const seatedHere = room ? !!seatByStudentId(room, student.id) : false;
    el.appendChild(buildStudentCard(student, seatedHere));
  });
}

function buildStudentCard(student, isSeated) {
  const card = document.createElement('div');
  card.className = 'student-card' + (isSeated ? ' is-seated' : '') + (student.absent ? ' student-absent' : '');
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
    av.style.backgroundColor = avatarColour(student.gender);
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
  if (student.marks != null) parts.push(student.marks + '%');
  if (student.position) parts.push({ front: '\u2191Front', back: '\u2193Back', left: '\u2190Left', right: '\u2192Right' }[student.position] || student.position);
  if (student.sitNear.length)     parts.push('\u2191' + student.sitNear.length);
  if (student.doNotSitNear.length) parts.push('\u2193' + student.doNotSitNear.length);
  det.textContent = parts.join(' \u00b7 ');

  info.appendChild(nameEl);
  info.appendChild(det);

  // Flag pills — use allFlags() so custom flags also render
  const flags = student.flags || [];
  if (flags.length) {
    const flagsRow = document.createElement('div');
    flagsRow.className = 'student-flags';
    flags.forEach(key => {
      const def = allFlags().find(f => f.key === key);
      if (!def) return;
      const pill = document.createElement('span');
      pill.className = 'flag-pill';
      pill.textContent = def.label;
      pill.style.backgroundColor = def.colour;
      flagsRow.appendChild(pill);
    });
    info.appendChild(flagsRow);
  }

  // Actions
  const actions = document.createElement('div');
  actions.className = 's-actions';

  // Absent toggle (Feature 2)
  const absentBtn = document.createElement('button');
  absentBtn.className = 'btn-icon';
  absentBtn.textContent = student.absent ? '\u2705' : '\u{1F3E0}';
  absentBtn.title = student.absent ? 'Mark present' : 'Mark absent';
  absentBtn.addEventListener('click', e => {
    e.stopPropagation();
    student.absent = !student.absent;
    scheduleAutosave();
    renderStudentList();
    renderGrid();
  });

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-icon';
  editBtn.textContent = '\u270F\uFE0F';
  editBtn.title = 'Edit student';
  editBtn.addEventListener('click', e => { e.stopPropagation(); openModal('student', student.id); });

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-icon';
  delBtn.textContent = '\u{1F5D1}';
  delBtn.title = 'Delete student';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (confirm('Delete "' + student.name + '"?')) {
      studentDelete(student.id);
      renderAll();
    }
  });

  actions.appendChild(absentBtn);
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  card.appendChild(av);
  card.appendChild(info);
  card.appendChild(actions);
  return card;
}

/* ============================================================
   RENDER — GRID (dispatcher)
============================================================ */
function renderGrid() {
  // Replace the element with a fresh clone to remove any accumulated event listeners
  // (e.g. pointerdown / contextmenu added by renderFreeformGrid on every render).
  const oldGrid = document.getElementById('room-grid');
  const grid = oldGrid.cloneNode(false);
  oldGrid.parentNode.replaceChild(grid, oldGrid);
  grid.className = 'room-grid'; // reset any added classes

  const room = currentRoom();
  if (!room) {
    grid.innerHTML = '<div class="no-room-msg">No class selected.<br>Create a class using "＋ New Class".</div>';
    document.getElementById('room-name-display').textContent = 'No class selected';
    updateRoomControls(null);
    updateFrontLabel(null);
    updateCapacityBadge(null);
    return;
  }

  document.getElementById('room-name-display').textContent = room.name;
  updateRoomControls(room);
  updateFrontLabel(room);
  updateCapacityBadge(room);

  if (room.layoutMode === 'freeform') {
    renderFreeformGrid(room, grid);
    if (state.mode === 'layout') {
      showInfoBar('Click canvas to add desk  ·  Drag to move  ·  Right-click to delete');
    }
  } else {
    // Legacy fallback: should not normally occur since normaliseRoom converts all grid rooms
    renderRegularGrid(room, grid);
  }
}

/* ── Front label & direction ─────────────────────────────── */
function updateFrontLabel(room) {
  const wrapper = document.getElementById('grid-wrapper');
  const label   = document.getElementById('front-label');
  const dir     = room?.frontDirection ?? 'top';

  if (wrapper) wrapper.dataset.frontDir = dir;
  const arrows = { top: '▲', right: '►', bottom: '▼', left: '◄' };
  if (label) label.textContent = (arrows[dir] ?? '▲') + ' FRONT OF CLASS';
}

/* ── Room header controls ────────────────────────────────── */
function updateRoomControls(room) {
  // Archive button label
  const archBtn = document.getElementById('archive-room-btn');
  if (archBtn) {
    archBtn.textContent = room?.archived ? '📤 Unarchive' : '📦 Archive';
    archBtn.title       = room?.archived ? 'Restore this class' : 'Archive this class';
  }

  // Always show canvas size group (all rooms are freeform)
  const gridGroup   = document.getElementById('grid-size-group');
  const canvasGroup = document.getElementById('canvas-size-group');
  if (gridGroup)   gridGroup.style.display   = 'none';
  if (canvasGroup) canvasGroup.style.display = 'flex';

  if (room) {
    document.getElementById('canvas-w-input').value = room.canvasW ?? 900;
    document.getElementById('canvas-h-input').value = room.canvasH ?? 700;
    document.getElementById('snap-grid-input').value = room.snapGrid ?? 0;
  }

  // "Edit Layout" mode button: always visible (all rooms are freeform)
  const layoutModeBtn = document.getElementById('mode-layout');
  if (layoutModeBtn) layoutModeBtn.style.display = '';

  // Direction buttons highlight
  document.querySelectorAll('.dir-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.dir === (room?.frontDirection ?? 'top'));
  });
}

/* ── Regular (grid) rendering ────────────────────────────── */
function renderRegularGrid(room, grid) {
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
          pushHistory();
          if (!seat) {
            room.seats.push(makeSeat(room.id, r, c));
          } else {
            seat.enabled = true;
          }
          scheduleAutosave();
          renderGrid();
        });

        grid.appendChild(cell);
        continue;
      }

      // Enabled seat
      cell.dataset.seatId = seat.id;
      applyClusterStyling(cell, seat, room);

      if (state.mode === 'toggle')  cell.classList.add('toggleable');
      if (state.mode === 'cluster') cell.classList.add('cluster-mode');

      // Labeled seat (teacher desk, whiteboard, etc.)
      if (seat.label) {
        cell.classList.add('labeled-seat');
        cell.appendChild(buildLabeledSeat(seat));
        const lInfo = SEAT_LABELS[seat.label];
        cell.addEventListener('mouseenter', () => showInfoBar(lInfo ? lInfo.name : seat.label));
        cell.addEventListener('mouseleave', () => showInfoBar(''));
        cell.addEventListener('contextmenu', e => {
          e.preventDefault();
          showSeatContextMenu(e.clientX, e.clientY, seat, room);
        });
        grid.appendChild(cell);
        continue;
      }

      if (seat.studentId) {
        cell.classList.add('has-student');
        const student = studentById(seat.studentId);
        if (student) cell.appendChild(buildMiniStudent(student, seat.id));
        // Audit mode (Feature 20)
        if (state.auditMode && student) {
          if (hasSeatViolation(seat, student, room)) cell.classList.add('audit-violation');
        }
        // Pin badge (Feature 9)
        if (seat.pinned) {
          const pb = document.createElement('span');
          pb.className = 'pin-badge';
          pb.textContent = '\u{1F4CC}';
          pb.title = 'Pinned';
          cell.appendChild(pb);
        }
      }

      cell.addEventListener('click', () => {
        if (state.mode === 'toggle') {
          pushHistory();
          seat.enabled   = false;
          seat.studentId = null;
          seat.clusterId = null;
          scheduleAutosave();
          renderGrid();
        } else if (state.mode === 'cluster') {
          handleClusterClick(seat, room);
        }
      });

      cell.addEventListener('contextmenu', e => {
        e.preventDefault();
        showSeatContextMenu(e.clientX, e.clientY, seat, room);
      });

      if (state.mode === 'move') attachDropTarget(cell, seat.id);

      cell.addEventListener('mouseenter', () => {
        if (seat.studentId) {
          showStudentHover(seat.studentId);
          showSeatTooltip(seat.studentId, cell);
        } else {
          showInfoBar(`Seat row ${r + 1}, col ${c + 1} — empty`);
        }
      });
      cell.addEventListener('mouseleave', () => {
        showInfoBar('');
        hideSeatTooltip();
      });

      grid.appendChild(cell);
    }
  }
}

/* ── Freeform rendering ──────────────────────────────────── */
function renderFreeformGrid(room, grid) {
  grid.classList.add('freeform');
  grid.style.cssText = `width:${room.canvasW}px; height:${room.canvasH}px;`;

  room.seats.forEach(seat => {
    const cell = document.createElement('div');
    cell.className = 'seat-cell freeform-seat';
    cell.dataset.seatId = seat.id;
    cell.style.left = (seat.x ?? 0) + 'px';
    cell.style.top  = (seat.y ?? 0) + 'px';

    applyClusterStyling(cell, seat, room);

    if (state.mode === 'cluster') cell.classList.add('cluster-mode');

    // Labeled seat
    if (seat.label) {
      cell.classList.add('labeled-seat');
      cell.appendChild(buildLabeledSeat(seat));
      const lInfo = SEAT_LABELS[seat.label];
      cell.addEventListener('mouseenter', () => showInfoBar(lInfo ? lInfo.name : seat.label));
      cell.addEventListener('mouseleave', () => { if (state.mode !== 'layout') showInfoBar(''); });
      if (state.mode !== 'layout') {
        cell.addEventListener('contextmenu', e => {
          e.preventDefault();
          showSeatContextMenu(e.clientX, e.clientY, seat, room);
        });
      }
      if (state.mode === 'layout') {
        cell.classList.add('layout-draggable');
        attachFreeformDrag(cell, seat, room);
      }
      grid.appendChild(cell);
      return;
    }

    if (seat.studentId) {
      cell.classList.add('has-student');
      const student = studentById(seat.studentId);
      if (student) {
        const mini = buildMiniStudent(student, seat.id);
        if (state.mode === 'layout') mini.draggable = false;
        cell.appendChild(mini);
        // Audit mode (Feature 20)
        if (state.auditMode) {
          if (hasSeatViolation(seat, student, room)) cell.classList.add('audit-violation');
        }
        // Pin badge (Feature 9)
        if (seat.pinned) {
          const pb = document.createElement('span');
          pb.className = 'pin-badge';
          pb.textContent = '\u{1F4CC}';
          pb.title = 'Pinned';
          cell.appendChild(pb);
        }
      }
    }

    if (state.mode === 'layout') {
      cell.classList.add('layout-draggable');
      attachFreeformDrag(cell, seat, room);
    }

    cell.addEventListener('click', () => {
      if (state.mode === 'cluster') handleClusterClick(seat, room);
    });

    cell.addEventListener('contextmenu', e => {
      if (state.mode === 'layout') return; // layout mode handles its own right-click
      e.preventDefault();
      showSeatContextMenu(e.clientX, e.clientY, seat, room);
    });

    if (state.mode === 'move') attachDropTarget(cell, seat.id);

    cell.addEventListener('mouseenter', () => {
      if (seat.studentId) {
        showStudentHover(seat.studentId);
        showSeatTooltip(seat.studentId, cell);
      } else {
        showInfoBar('Desk — empty');
      }
    });
    cell.addEventListener('mouseleave', () => {
      if (state.mode !== 'layout') showInfoBar('');
      hideSeatTooltip();
    });

    grid.appendChild(cell);
  });

  // Left-click on empty canvas in layout mode → add a desk
  if (state.mode === 'layout') {
    grid.classList.add('layout-canvas');

    // Prevent the browser context menu appearing over the canvas
    grid.addEventListener('contextmenu', e => e.preventDefault());

    grid.addEventListener('pointerdown', e => {
      if (e.target !== grid) return;
      if (e.button !== 0) return; // left button only — ignore right-click
      e.preventDefault();
      if (room.seats.length >= MAX_FREEFORM_SEATS) {
        showInfoBar(`Maximum of ${MAX_FREEFORM_SEATS} desks reached — delete some desks first.`);
        return;
      }
      const rect = grid.getBoundingClientRect();
      const rawX = Math.max(0, Math.min(room.canvasW - SEAT_WIDTH, e.clientX - rect.left - SEAT_HALF));
      const rawY = Math.max(0, Math.min(room.canvasH - SEAT_WIDTH, e.clientY - rect.top  - SEAT_HALF));
      const x = snapCoord(Math.round(rawX), room.snapGrid || 0);
      const y = snapCoord(Math.round(rawY), room.snapGrid || 0);
      // Prevent stacking: if a seat already occupies the same area, ignore this event.
      // (DOM replacement via cloneNode can cause browsers to re-fire pointerdown on the
      // new element while the pointer is still physically held down, producing duplicates.)
      const tooClose = room.seats.some(s =>
        Math.abs((s.x ?? 0) - x) < SEAT_HALF && Math.abs((s.y ?? 0) - y) < SEAT_HALF
      );
      if (tooClose) return;
      room.seats.push(makeFreeformSeat(room.id, x, y));
      scheduleAutosave();
      renderGrid();
    });
  }
}

/* ── Freeform seat drag (pointer events) ─────────────────── */
function attachFreeformDrag(cell, seat, room) {
  cell.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; // left button only
    e.stopPropagation();

    const startClientX = e.clientX, startClientY = e.clientY;
    const origX = seat.x ?? 0, origY = seat.y ?? 0;
    let moved = false;

    cell.setPointerCapture(e.pointerId);
    cell.classList.add('dragging');

    const onMove = ev => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const rawX = Math.max(0, Math.min(room.canvasW - SEAT_WIDTH, origX + dx));
      const rawY = Math.max(0, Math.min(room.canvasH - SEAT_WIDTH, origY + dy));
      seat.x = snapCoord(rawX, room.snapGrid || 0);
      seat.y = snapCoord(rawY, room.snapGrid || 0);
      cell.style.left = seat.x + 'px';
      cell.style.top  = seat.y + 'px';
    };

    const onUp = () => {
      cell.removeEventListener('pointermove', onMove);
      cell.removeEventListener('pointerup',   onUp);
      cell.classList.remove('dragging');
      if (moved) {
        pushHistory();
        // seat.x/y are already snapped (applied in onMove); just round to whole pixels
        seat.x = Math.round(seat.x);
        seat.y = Math.round(seat.y);
        scheduleAutosave();
      }
    };

    cell.addEventListener('pointermove', onMove);
    cell.addEventListener('pointerup',   onUp);
  });

  // Right-click to delete in layout mode
  cell.addEventListener('contextmenu', e => {
    if (state.mode !== 'layout') return;
    e.preventDefault();
    if (seat.studentId && !confirm('This desk has a student assigned. Delete it anyway?')) return;
    if (seat.studentId) {
      const existing = seatByStudentId(currentRoom(), seat.studentId);
      if (existing) existing.studentId = null;
    }
    room.seats = room.seats.filter(s => s.id !== seat.id);
    scheduleAutosave();
    renderGrid();
    renderStudentList();
  });
}

/* ── Shared seat helpers ─────────────────────────────────── */

/**
 * Returns true if the seated student violates any constraint in audit mode.
 * Checks: doNotSitNear proximity, sitNear not satisfied, position preference.
 */
function hasSeatViolation(seat, student, room) {
  const seats = room.seats.filter(isSeatAssignable);
  // doNotSitNear violation
  const doNotViolated = (student.doNotSitNear || []).some(awayId => {
    const ns = seats.find(s => s.studentId === awayId);
    return ns && seatDist(seat, ns) <= 2;
  });
  if (doNotViolated) return true;
  // sitNear unsatisfied
  const sitNearMissed = (student.sitNear || []).some(nearId => {
    const ns = seats.find(s => s.studentId === nearId);
    return ns && seatDist(seat, ns) > 2;
  });
  if (sitNearMissed) return true;
  // Position preference (rough check via score threshold)
  if (student.position && seatPositionScore(seat, student, room) < 50) return true;
  return false;
}

function applyClusterStyling(cell, seat, room) {
  if (!seat.clusterId) return;
  const cl = room.clusters.find(x => x.id === seat.clusterId);
  if (!cl) return;
  cell.classList.add('in-cluster');
  cell.style.borderColor     = cl.colour;
  cell.style.backgroundColor = cl.colour + '22';

  if (state.mode === 'cluster' && state.activeClusterId === seat.clusterId) {
    cell.style.borderColor     = cl.colour;
    cell.style.backgroundColor = cl.colour + '44';
  }
}

function handleClusterClick(seat, room) {
  if (!state.activeClusterId) {
    showInfoBar('Select a cluster in the right panel first, or create one.');
    return;
  }
  pushHistory();
  seat.clusterId = (seat.clusterId === state.activeClusterId) ? null : state.activeClusterId;
  scheduleAutosave();
  renderGrid();
  renderClusterPanel();
}

function attachDropTarget(cell, seatId) {
  cell.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    cell.classList.add('drag-over');
  });
  cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
  cell.addEventListener('drop', e => {
    e.preventDefault();
    cell.classList.remove('drag-over');
    handleDrop(seatId);
  });
}

function showStudentHover(studentId) {
  const s = studentById(studentId);
  if (!s) return;
  const parts = [s.name];
  if (s.gender) parts.push(s.gender);
  if (s.marks != null) parts.push(`Marks: ${s.marks}%`);
  if ((s.flags || []).length) parts.push(s.flags.join(', '));
  if (s.sitNear.length)
    parts.push(`Sit near: ${s.sitNear.map(id => studentById(id)?.name ?? id).join(', ')}`);
  if (s.doNotSitNear.length)
    parts.push(`Separate from: ${s.doNotSitNear.map(id => studentById(id)?.name ?? id).join(', ')}`);
  showInfoBar(parts.join('  |  '));
}

function showInfoBar(text) {
  const el = document.getElementById('seat-info-bar');
  if (el) el.textContent = text;
}

function buildMiniStudent(student, seatId) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-student' + (student.absent ? ' mini-absent' : '');
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
    av.style.backgroundColor = avatarColour(student.gender);
    av.textContent = student.name.charAt(0).toUpperCase();
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'mini-name';
  // Show first name only (or full if short enough)
  const firstName = student.name.split(' ')[0];
  nameEl.textContent = firstName.length > 8 ? firstName.slice(0, 7) + '\u2026' : firstName;

  wrap.appendChild(av);
  wrap.appendChild(nameEl);

  // Notes indicator dot (Feature 3)
  if (student.notes && student.notes.trim()) {
    const nd = document.createElement('span');
    nd.className = 'notes-dot';
    nd.title = 'Has notes';
    nd.textContent = '\u{1F4DD}';
    wrap.appendChild(nd);
  }

  // Flag dots — use allFlags() so custom flags also render
  const flags = student.flags || [];
  if (flags.length) {
    const flagsRow = document.createElement('div');
    flagsRow.className = 'mini-flags';
    flags.forEach(key => {
      const def = allFlags().find(f => f.key === key);
      if (!def) return;
      const dot = document.createElement('span');
      dot.className = 'mini-flag-dot';
      dot.style.backgroundColor = def.colour;
      dot.title = def.label;
      flagsRow.appendChild(dot);
    });
    wrap.appendChild(flagsRow);
  }

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
    dot.style.backgroundColor = cl.colour;

    const name = document.createElement('span');
    name.className = 'cluster-name';
    name.textContent = cl.name;

    const cnt = document.createElement('span');
    cnt.className = 'cluster-count';
    cnt.textContent = `${seatCount} seat${seatCount !== 1 ? 's' : ''}`;

    if (cl.abilityLevel != null) {
      const badge = document.createElement('span');
      badge.className = 'cluster-ability-badge';
      badge.title = 'Ability level (1 = highest)';
      badge.textContent = `L${cl.abilityLevel}`;
      item.appendChild(dot);
      item.appendChild(name);
      item.appendChild(cnt);
      item.appendChild(badge);
    } else {
      item.appendChild(dot);
      item.appendChild(name);
      item.appendChild(cnt);
    }

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
  renderClassSetBar();
  renderStudentList();
  renderGrid();
  renderClusterPanel();
  scheduleAutosave();
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
    document.getElementById('room-modal-title').textContent = id ? 'Rename Class' : 'New Class';
    const room = id ? state.rooms.find(r => r.id === id) : null;
    document.getElementById('room-name-input').value = room?.name ?? '';
    showModalEl('room-modal');

  } else if (type === 'student') {
    document.getElementById('student-modal-title').textContent = id ? 'Edit Student' : 'Add Student';
    const s = id ? studentById(id) : null;

    document.getElementById('s-name').value   = s?.name   ?? '';
    document.getElementById('s-gender').value = s?.gender ?? '';
    document.getElementById('s-marks').value  = s?.marks  != null ? s.marks : '';
    document.getElementById('s-notes').value  = s?.notes  ?? '';
    document.getElementById('s-position').value = s?.position ?? '';

    // Flags checkboxes — built-in + custom
    renderFlagCheckboxes(s);

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
      preview.style.backgroundColor = s ? avatarColour(s.gender) : '#636e72';
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
    document.getElementById('cluster-colour-input').value =
      cl?.colour ?? CLUSTER_COLOURS[room.clusters.length % CLUSTER_COLOURS.length];
    document.getElementById('cluster-ability-input').value = cl?.abilityLevel ?? '';
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

/* ── Custom flags (Feature 4) ────────────────────────────── */
function renderFlagCheckboxes(student) {
  const flagsDiv = document.getElementById('flag-checkboxes');
  flagsDiv.innerHTML = '';
  allFlags().forEach(f => {
    const label = document.createElement('label');
    label.className = 'flag-chk-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = f.key;
    cb.name  = 'student-flag';
    cb.checked = student ? (student.flags || []).includes(f.key) : false;
    const dot = document.createElement('span');
    dot.className = 'flag-dot';
    dot.style.backgroundColor = f.colour;
    label.appendChild(cb);
    label.appendChild(dot);
    label.appendChild(document.createTextNode(' ' + f.label));
    flagsDiv.appendChild(label);
  });
  // "＋ Add flag" button
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-secondary btn-sm';
  addBtn.style.marginTop = '6px';
  addBtn.textContent = '\uFF0B Custom flag\u2026';
  addBtn.addEventListener('click', () => {
    addCustomFlag(student);
  });
  flagsDiv.appendChild(addBtn);
}

function addCustomFlag(student) {
  const name = window.prompt('New flag name (e.g. "LAC", "EHC"):');
  if (!name || !name.trim()) return;
  const key = name.trim().replace(/\s+/g, '_');
  if (allFlags().find(f => f.key === key)) {
    alert('A flag with this name already exists.'); return;
  }
  const colour = window.prompt('Flag colour (hex, e.g. #9b59b6):', '#9b59b6');
  if (!colour || !/^#[0-9a-fA-F]{3,6}$/.test(colour.trim())) {
    alert('Invalid colour — please enter a hex colour like #9b59b6.'); return;
  }
  state.customFlags.push({ key, label: name.trim(), colour: colour.trim() });
  scheduleAutosave();
  renderFlagCheckboxes(student);
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
  if (!name) { alert('Please enter a class name.'); return; }

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
  if (marks !== null && (isNaN(marks) || marks < 0 || marks > 100)) {
    alert('Marks must be a number between 0 and 100.'); return;
  }

  const sitNear = [...document.querySelectorAll('#sit-near-list input[name="sit-near"]:checked')]
    .map(cb => cb.value);
  const doNotSitNear = [...document.querySelectorAll('#no-sit-near-list input[name="no-sit-near"]:checked')]
    .map(cb => cb.value);

  const flags = [...document.querySelectorAll('#flag-checkboxes input[name="student-flag"]:checked')]
    .map(cb => cb.value);

  const notes = document.getElementById('s-notes').value.trim();
  const position = document.getElementById('s-position').value;

  const persist = (photo) => {
    const existingAbsent = editCtx.id ? (studentById(editCtx.id)?.absent ?? false) : false;
    const data = {
      name,
      gender: document.getElementById('s-gender').value,
      marks,
      photo,
      notes,
      flags,
      sitNear,
      doNotSitNear,
      position,
      absent: existingAbsent
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
  const colour = document.getElementById('cluster-colour-input').value;
  const abilityRaw = document.getElementById('cluster-ability-input').value;
  const abilityLevel = abilityRaw !== '' ? parseInt(abilityRaw, 10) : null;
  if (abilityLevel !== null && (isNaN(abilityLevel) || abilityLevel < 1)) {
    alert('Ability level must be a whole number of 1 or greater.'); return;
  }

  if (editCtx.id) {
    const cl = room.clusters.find(c => c.id === editCtx.id);
    if (cl) { cl.name = name; cl.colour = colour; cl.abilityLevel = abilityLevel; }
  } else {
    const cl = clusterCreate(room, name, colour, abilityLevel);
    state.activeClusterId = cl.id;
    // Switch to cluster mode to make it easy to assign seats
    setMode('cluster');
  }

  closeModal();
  renderAll();
}

/* ============================================================
   CLASS SET MODAL
============================================================ */
function openClassSetModal() {
  editingClassSetId = null;
  renderClassSetModalList();
  showModalEl('classset-modal');
}

function renderClassSetModalList() {
  const list = document.getElementById('classset-list');
  list.innerHTML = '';

  if (!state.classSets.length) {
    list.innerHTML = '<div class="empty-msg">No class sets yet.<br>Click "＋ New" to create one.</div>';
  }

  state.classSets.forEach(cs => {
    const item = document.createElement('div');
    item.className = 'classset-list-item' + (cs.id === editingClassSetId ? ' active' : '');
    item.textContent = cs.name;
    item.dataset.id = cs.id;
    item.addEventListener('click', () => {
      editingClassSetId = cs.id;
      renderClassSetModalList();
      openClassSetEditor(cs.id);
    });
    list.appendChild(item);
  });
}

function openClassSetEditor(id) {
  const cs = state.classSets.find(x => x.id === id);
  document.getElementById('classset-no-selection').style.display = 'none';
  const editor = document.getElementById('classset-editor');
  editor.style.display = 'block';

  document.getElementById('classset-name-input').value = cs?.name ?? '';

  // Student checkboxes
  const sl = document.getElementById('classset-student-list');
  sl.innerHTML = '';
  if (!state.students.length) {
    sl.innerHTML = '<div class="empty-msg">No students yet.</div>';
    return;
  }
  state.students.forEach(s => {
    const label = document.createElement('label');
    label.className = 'chk-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = s.id;
    cb.checked = cs ? cs.studentIds.includes(s.id) : false;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(s.name));
    sl.appendChild(label);
  });
}

function saveClassSetEditor() {
  const name = document.getElementById('classset-name-input').value.trim();
  if (!name) { alert('Please enter a class set name.'); return; }
  const studentIds = [
    ...document.querySelectorAll('#classset-student-list input[type="checkbox"]:checked')
  ].map(cb => cb.value);

  if (editingClassSetId) {
    classSetUpdate(editingClassSetId, { name, studentIds });
  } else {
    const cs = classSetCreate(name, studentIds);
    editingClassSetId = cs.id;
  }
  renderClassSetModalList();
  renderClassSetBar();
  renderStudentList();
  scheduleAutosave();
  // Update editor to reflect saved state
  openClassSetEditor(editingClassSetId);
}

function newClassSetFromModal() {
  editingClassSetId = null;
  document.getElementById('classset-no-selection').style.display = 'none';
  const editor = document.getElementById('classset-editor');
  editor.style.display = 'block';
  document.getElementById('classset-name-input').value = '';
  const sl = document.getElementById('classset-student-list');
  sl.innerHTML = '';
  state.students.forEach(s => {
    const label = document.createElement('label');
    label.className = 'chk-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = s.id;
    cb.checked = false;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(s.name));
    sl.appendChild(label);
  });
  renderClassSetModalList();
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

  // ── Help Guide ───────────────────────────────────────────
  document.getElementById('help-btn').addEventListener('click', openHelpModal);

  // ── Save / Load ──────────────────────────────────────────
  document.getElementById('print-btn').addEventListener('click', printSeatingPlan);

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

  document.getElementById('toggle-archived-btn').addEventListener('click', () => {
    state.showArchived = !state.showArchived;
    renderTabs();
  });

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
    scheduleAutosave();
  });

  document.getElementById('archive-room-btn').addEventListener('click', () => {
    const room = currentRoom();
    if (!room) return;
    if (room.archived) {
      roomUnarchive(room.id);
      renderAll();
    } else {
      if (confirm(`Archive class "${room.name}"?\nIt will be hidden from the tabs but can be restored.`)) {
        roomArchive(room.id);
        renderAll();
      }
    }
  });

  document.getElementById('delete-room-btn').addEventListener('click', () => {
    const room = currentRoom();
    if (!room) return;
    if (confirm(`Delete class "${room.name}"? This cannot be undone.`)) {
      roomDelete(room.id);
      renderAll();
    }
  });

  document.getElementById('duplicate-room-btn').addEventListener('click', () => {
    const room = currentRoom();
    if (!room) return;
    const copy = roomDuplicate(room);
    state.currentRoomId = copy.id;
    renderAll();
    scheduleAutosave();
  });

  // ── Front direction buttons ───────────────────────────────
  document.querySelectorAll('.dir-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const room = currentRoom();
      if (!room) return;
      room.frontDirection = btn.dataset.dir;
      updateFrontLabel(room);
      updateRoomControls(room);
      scheduleAutosave();
    });
  });

  // ── Layout mode toggle (grid ↔ freeform) — retained for backwards compatibility
  // Layout toggle button is hidden; all rooms are now freeform.
  const layoutToggleBtn = document.getElementById('layout-toggle-btn');
  if (layoutToggleBtn) layoutToggleBtn.style.display = 'none';

  // ── Canvas resize (freeform mode) ─────────────────────────
  document.getElementById('resize-canvas-btn').addEventListener('click', () => {
    const room = currentRoom();
    if (!room) return;
    const w = parseInt(document.getElementById('canvas-w-input').value, 10);
    const h = parseInt(document.getElementById('canvas-h-input').value, 10);
    if (isNaN(w) || isNaN(h) || w < 300 || h < 200 || w > 3000 || h > 2000) {
      alert('Canvas width must be 300–3000 and height 200–2000.'); return;
    }
    room.canvasW = w;
    room.canvasH = h;
    renderGrid();
    scheduleAutosave();
  });

  // ── Snap-grid (freeform mode) ─────────────────────────────
  document.getElementById('snap-grid-btn').addEventListener('click', () => {
    const room = currentRoom();
    if (!room) return;
    const snap = parseInt(document.getElementById('snap-grid-input').value, 10);
    if (isNaN(snap) || snap < 0 || snap > 200) {
      alert('Snap size must be 0 (off) to 200 pixels.'); return;
    }
    room.snapGrid = snap;
    scheduleAutosave();
    showInfoBar(snap ? `Snap to ${snap}px grid enabled` : 'Snap to grid disabled');
  });

  // ── Mode buttons ─────────────────────────────────────────
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // ── Assign / Clear ───────────────────────────────────────
  document.getElementById('assign-btn').addEventListener('click', () => {
    const method = document.getElementById('sort-method').value;
    pushHistory();
    assignStudents(method);
    renderGrid();
    renderStudentList();
    scheduleAutosave();
  });

  document.getElementById('clear-btn').addEventListener('click', () => {
    const room = currentRoom();
    if (!room) return;
    if (confirm('Clear all student assignments in this room?')) {
      pushHistory();
      room.seats.forEach(s => { s.studentId = null; });
      renderGrid();
      renderStudentList();
      scheduleAutosave();
    }
  });

  // ── Students ─────────────────────────────────────────────
  document.getElementById('add-student-btn').addEventListener('click',
    () => openModal('student'));

  document.getElementById('import-csv-btn').addEventListener('click',
    () => document.getElementById('import-csv-file').click()
  );
  document.getElementById('export-students-btn').addEventListener('click', exportStudentsCSV);
  document.getElementById('import-csv-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const count = importStudentsCSV(evt.target.result);
        renderAll();
        alert(`${count} student${count !== 1 ? 's' : ''} imported from CSV.`);
      } catch (err) {
        alert('CSV import error: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ── Class set selector ───────────────────────────────────
  document.getElementById('class-set-select').addEventListener('change', e => {
    state.activeClassSetId = e.target.value || null;
    // Remember this choice on the current room
    const room = currentRoom();
    if (room) {
      room.classSetId = state.activeClassSetId;
      scheduleAutosave();
    }
    renderStudentList();
  });

  // ── Student search ───────────────────────────────────────
  document.getElementById('student-search').addEventListener('input', () => {
    renderStudentList();
  });

  document.getElementById('manage-class-sets-btn').addEventListener('click', () => {
    openClassSetModal();
  });

  // Class set modal buttons
  document.getElementById('new-classset-btn').addEventListener('click', newClassSetFromModal);
  document.getElementById('classset-save-btn').addEventListener('click', saveClassSetEditor);
  document.getElementById('classset-delete-btn').addEventListener('click', () => {
    if (!editingClassSetId) return;
    const cs = state.classSets.find(x => x.id === editingClassSetId);
    if (confirm(`Delete class set "${cs?.name}"?`)) {
      classSetDelete(editingClassSetId);
      editingClassSetId = null;
      document.getElementById('classset-editor').style.display = 'none';
      document.getElementById('classset-no-selection').style.display = '';
      renderClassSetModalList();
      renderClassSetBar();
      renderStudentList();
      scheduleAutosave();
    }
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
      scheduleAutosave();
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

  // ── Undo / Redo ──────────────────────────────────────────
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('redo-btn').addEventListener('click', redo);

  // ── Stats / History ──────────────────────────────────────
  document.getElementById('stats-btn').addEventListener('click', showStatsModal);
  document.getElementById('history-btn').addEventListener('click', showHistoryModal);

  // ── Dark mode ────────────────────────────────────────────
  document.getElementById('dark-mode-btn').addEventListener('click', toggleDarkMode);

  // ── CSV Export ───────────────────────────────────────────
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);

  // ── Seat context menu ────────────────────────────────────
  // Only attach the label-change handler to items that carry a data-label attribute;
  // the clear and pin buttons have their own dedicated handlers below.
  document.querySelectorAll('.seat-ctx-item[data-label]').forEach(btn => {
    btn.addEventListener('click', () => {
      const room = state.rooms.find(r => r.id === ctxMenuRoomId);
      const seat = room?.seats.find(s => s.id === ctxMenuSeatId);
      if (seat) {
        pushHistory();
        const newLabel = btn.dataset.label || null;
        seat.label = newLabel;
        if (seat.label && seat.studentId) seat.studentId = null;
        renderGrid();
        renderStudentList();
        scheduleAutosave();
      }
      hideSeatContextMenu();
    });
  });

  // ── Clear-student button in seat context menu ────────────
  document.getElementById('seat-ctx-clear-btn').addEventListener('click', () => {
    const room = state.rooms.find(r => r.id === ctxMenuRoomId);
    const seat = room?.seats.find(s => s.id === ctxMenuSeatId);
    if (seat && seat.studentId) {
      pushHistory();
      seat.studentId = null;
      seat.pinned    = false;
      renderGrid();
      renderStudentList();
      scheduleAutosave();
    }
    hideSeatContextMenu();
  });

  // ── Pin/unpin button in seat context menu (Feature 9) ─────
  document.getElementById('seat-ctx-pin-btn').addEventListener('click', () => {
    const room = state.rooms.find(r => r.id === ctxMenuRoomId);
    const seat = room?.seats.find(s => s.id === ctxMenuSeatId);
    if (seat) {
      seat.pinned = !seat.pinned;
      renderGrid();
      scheduleAutosave();
    }
    hideSeatContextMenu();
  });

  // ── Audit mode button (Feature 20) ───────────────────────
  document.getElementById('audit-btn').addEventListener('click', () => {
    state.auditMode = !state.auditMode;
    document.getElementById('audit-btn').classList.toggle('active-archived', state.auditMode);
    renderGrid();
  });

  // ── Room template buttons (Feature 10) ───────────────────
  document.getElementById('save-template-btn').addEventListener('click', () => {
    const room = currentRoom();
    if (!room) { alert('Please select a room first.'); return; }
    saveRoomAsTemplate(room);
  });
  document.getElementById('apply-template-btn').addEventListener('click', () => {
    const room = currentRoom();
    if (!room) { alert('Please select a room first.'); return; }
    applyTemplateToRoom(room);
  });

  // Hide seat context menu on any outside click
  document.addEventListener('click', e => {
    const menu = document.getElementById('seat-ctx-menu');
    if (menu && !menu.contains(e.target)) hideSeatContextMenu();
  });

  // ── Global keyboard shortcuts ────────────────────────────
  document.addEventListener('keydown', e => {
    // Undo / Redo (work even inside inputs)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
      e.preventDefault(); redo(); return;
    }

    const inInput  = ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);
    const modalOpen = document.getElementById('modal-overlay').classList.contains('open');
    if (inInput || modalOpen) return;

    // A = Assign
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      const method = document.getElementById('sort-method').value;
      pushHistory();
      assignStudents(method);
      renderGrid(); renderStudentList(); scheduleAutosave();
    }
    // C = Clear (only if Ctrl not held, to avoid blocking Ctrl+C)
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const room = currentRoom();
      if (room && confirm('Clear all student assignments in this room?')) {
        pushHistory();
        room.seats.forEach(s => { s.studentId = null; });
        renderGrid(); renderStudentList(); scheduleAutosave();
      }
    }
    // 1-4 = switch mode
    if (e.key === '1') setMode('move');
    if (e.key === '2') setMode('toggle');
    if (e.key === '3') setMode('cluster');
    if (e.key === '4') setMode('layout');
  });
}

/* ============================================================
   MOBILE NAVIGATION
============================================================ */
function initMobileNav() {
  const appBody = document.querySelector('.app-body');
  const tabs = document.querySelectorAll('.mobile-tab');

  // Set default active panel
  appBody.dataset.activePanel = 'room';

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const panel = tab.dataset.panel;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      appBody.dataset.activePanel = panel;
    });
  });
}

/* ============================================================
   INITIALISATION
============================================================ */
function init() {
  applyDarkModePreference();
  initEvents();
  initMobileNav();
  updateUndoRedoBtns();

  // Try to restore from localStorage; fall back to a default room
  const restored = loadFromStorage();
  if (!restored) {
    const room = roomCreate('Classroom A', 5, 6);
    state.currentRoomId = room.id;
  }

  // Show version in footer
  const versionEl = document.getElementById('app-version');
  if (versionEl) versionEl.textContent = 'v' + APP_VERSION;

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
