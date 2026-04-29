'use strict';

/** Returns built-in + custom flag definitions. */
function allFlags() {
  return [...STUDENT_FLAGS, ...(state.customFlags || [])];
}

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
