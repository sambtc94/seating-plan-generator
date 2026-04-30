'use strict';

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

  // Do not displace a pinned student from their seat
  if (target.pinned && target.studentId) { resetDrag(); return; }

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
  scheduleAutosave();
}

function resetDrag() {
  state.drag = { studentId: null, fromSeatId: null };
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

  if (state.auditMode) {
    const room = currentRoom();
    const seat = room?.seats.find(s => s.studentId === studentId);
    if (seat) {
      const reasons = getSeatViolationReasons(seat, student, room);
      if (reasons.length) {
        tooltip.innerHTML +=
          `<div class="tt-violations">` +
          reasons.map(r => `<div class="tt-violation">⚠ ${r}</div>`).join('') +
          `</div>`;
      }
    }
  }

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

  // All rooms are freeform after normaliseRoom migration
  renderFreeformGrid(room, grid);
  if (state.mode === 'layout') {
    showInfoBar('Click canvas to add desk  ·  Drag to move  ·  Right-click to delete');
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
 * Returns an array of human-readable violation strings for a seated student.
 * Checks: doNotSitNear proximity, sitNear not satisfied, position preference.
 */
function getSeatViolationReasons(seat, student, room) {
  const seats = room.seats.filter(isSeatAssignable);
  const reasons = [];
  // doNotSitNear violations
  (student.doNotSitNear || []).forEach(awayId => {
    const ns = seats.find(s => s.studentId === awayId);
    if (ns && seatDist(seat, ns) <= 2) {
      const name = studentById(awayId)?.name ?? awayId;
      reasons.push(`Separated from ${name}`);
    }
  });
  // sitNear unsatisfied
  (student.sitNear || []).forEach(nearId => {
    const ns = seats.find(s => s.studentId === nearId);
    if (ns && seatDist(seat, ns) > 2) {
      const name = studentById(nearId)?.name ?? nearId;
      reasons.push(`Not near ${name}`);
    }
  });
  // Position preference
  if (student.position && seatPositionScore(seat, student, room) < 50)
    reasons.push(`Position preference (${student.position}) not met`);
  return reasons;
}

/**
 * Returns true if the seated student violates any constraint in audit mode.
 * Checks: doNotSitNear proximity, sitNear not satisfied, position preference.
 */
function hasSeatViolation(seat, student, room) {
  return getSeatViolationReasons(seat, student, room).length > 0;
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
  if (state.auditMode) {
    const room = currentRoom();
    const seat = room?.seats.find(st => st.studentId === studentId);
    if (seat) {
      const reasons = getSeatViolationReasons(seat, s, room);
      if (reasons.length) parts.push(`⚠ ${reasons.join('; ')}`);
    }
  }
  showInfoBar(parts.join('  |  '));
}

function showInfoBar(text) {
  const el = document.getElementById('seat-info-bar');
  if (el) el.textContent = text;
}

function buildMiniStudent(student, seatId) {
  const room   = currentRoom();
  const seat   = seatId && room ? seatById(room, seatId) : null;
  const pinned = seat ? !!seat.pinned : false;

  const wrap = document.createElement('div');
  wrap.className = 'mini-student' + (student.absent ? ' mini-absent' : '') + (pinned ? ' mini-pinned' : '');
  wrap.draggable = !pinned;

  if (!pinned) {
    wrap.addEventListener('dragstart', e => {
      e.stopPropagation();
      state.drag.studentId  = student.id;
      state.drag.fromSeatId = seatId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', student.id);
    });
  }

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
  // Show full name, truncated only if very long; CSS wraps it to 2 lines
  nameEl.textContent = student.name.length > 20 ? student.name.slice(0, 19) + '\u2026' : student.name;

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

  let dragSrcIndex = null;

  room.clusters.forEach((cl, idx) => {
    const seatCount = room.seats.filter(s => s.clusterId === cl.id).length;

    // List item
    const item = document.createElement('div');
    item.className = 'cluster-item';
    item.draggable = true;
    item.dataset.clusterIdx = idx;

    // ── Drag-to-reorder handles ──────────────────────────────
    item.addEventListener('dragstart', e => {
      dragSrcIndex = idx;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', idx);
      item.classList.add('cluster-dragging');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('cluster-dragging');
      list.querySelectorAll('.cluster-item').forEach(el => el.classList.remove('cluster-drag-over'));
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.querySelectorAll('.cluster-item').forEach(el => el.classList.remove('cluster-drag-over'));
      item.classList.add('cluster-drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('cluster-drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('cluster-drag-over');
      if (dragSrcIndex === null || dragSrcIndex === idx) return;
      const moved = room.clusters.splice(dragSrcIndex, 1)[0];
      room.clusters.splice(idx, 0, moved);
      dragSrcIndex = null;
      scheduleAutosave();
      renderClusterPanel();
    });

    const handle = document.createElement('span');
    handle.className = 'cluster-drag-handle';
    handle.textContent = '⠿';
    handle.title = 'Drag to reorder';
    handle.setAttribute('aria-label', 'Drag to reorder cluster');

    const dot = document.createElement('div');
    dot.className = 'cluster-dot';
    dot.style.backgroundColor = cl.colour;

    const name = document.createElement('span');
    name.className = 'cluster-name';
    name.textContent = cl.name;

    const cnt = document.createElement('span');
    cnt.className = 'cluster-count';
    cnt.textContent = `${seatCount} seat${seatCount !== 1 ? 's' : ''}`;

    item.appendChild(handle);
    item.appendChild(dot);
    item.appendChild(name);
    item.appendChild(cnt);

    if (cl.abilityLevel != null) {
      const badge = document.createElement('span');
      badge.className = 'cluster-ability-badge';
      badge.title = 'Ability level (1 = highest)';
      badge.textContent = `L${cl.abilityLevel}`;
      item.appendChild(badge);
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
