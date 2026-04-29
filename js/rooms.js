'use strict';

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
    layoutMode:     'freeform', // all rooms are freeform
    frontDirection: 'top',      // 'top' | 'right' | 'bottom' | 'left'
    canvasW: 900,
    canvasH: 700,
    snapGrid: 0,                // 0 = off; positive integer = snap size in px (freeform only)
    classSetId:     null        // class set selected for this room
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      room.seats.push(makeSeat(id, r, c));
    }
  }
  // Place seats at grid positions in freeform canvas
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
