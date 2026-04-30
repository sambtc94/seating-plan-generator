'use strict';

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

  document.getElementById('share-btn').addEventListener('click', generateShareURL);

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

  // ── Room template tab (Templates modal) ──────────────────
  document.getElementById('templates-tab-btn').addEventListener('click', openTemplatesModal);

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
async function init() {
  applyDarkModePreference();
  initEvents();
  initMobileNav();
  updateUndoRedoBtns();

  // Try to restore from a shared URL hash first, then fall back to localStorage
  const restoredFromHash = await loadFromURLHash();
  if (!restoredFromHash) {
    const restored = loadFromStorage();
    if (!restored) {
      const room = roomCreate('Classroom A', 5, 6);
      state.currentRoomId = room.id;
    }
  }

  // Show version in footer — try to sync with latest GitHub release
  const versionEl = document.getElementById('app-version');
  if (versionEl) {
    versionEl.textContent = 'v' + APP_VERSION;
  }

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
