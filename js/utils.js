'use strict';

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
