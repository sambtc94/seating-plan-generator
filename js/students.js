'use strict';

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
