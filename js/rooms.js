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
