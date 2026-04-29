'use strict';

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

  const others = visibleStudents().filter(s => s.id !== excludeId);
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
      // Sync bidirectional constraints: update all other students' lists to mirror
      // this student's sit-near and do-not-sit-near selections.
      state.students.forEach(other => {
        if (other.id === editCtx.id) return;
        // sitNear
        if (sitNear.includes(other.id)) {
          if (!other.sitNear.includes(editCtx.id)) other.sitNear.push(editCtx.id);
        } else {
          other.sitNear = other.sitNear.filter(x => x !== editCtx.id);
        }
        // doNotSitNear
        if (doNotSitNear.includes(other.id)) {
          if (!other.doNotSitNear.includes(editCtx.id)) other.doNotSitNear.push(editCtx.id);
        } else {
          other.doNotSitNear = other.doNotSitNear.filter(x => x !== editCtx.id);
        }
      });
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
