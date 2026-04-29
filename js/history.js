'use strict';

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
