'use strict';

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
