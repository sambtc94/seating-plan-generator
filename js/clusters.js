'use strict';

/* ============================================================
   CLUSTER MANAGEMENT
============================================================ */

function clusterCreate(room, name = 'Cluster', colour = null, abilityLevel = null) {
  const cl = {
    id:    uid(),
    name,
    colour:       colour || CLUSTER_COLOURS[room.clusters.length % CLUSTER_COLOURS.length],
    abilityLevel: abilityLevel != null ? Number(abilityLevel) : null
  };
  room.clusters.push(cl);
  return cl;
}

function clusterDelete(room, id) {
  room.clusters = room.clusters.filter(c => c.id !== id);
  room.seats.forEach(s => { if (s.clusterId === id) s.clusterId = null; });
  if (state.activeClusterId === id) state.activeClusterId = null;
}

/**
 * BFS auto-detect: group all mutually adjacent enabled seats into clusters.
 * Grid mode: 8-connected adjacency. Freeform mode: within FREEFORM_ADJACENCY_PX pixels.
 */
function autoDetectClusters(room) {
  room.clusters = [];
  room.seats.forEach(s => { s.clusterId = null; });
  if (state.activeClusterId) state.activeClusterId = null;

  const enabled = room.seats.filter(s => s.enabled);
  const visited = new Set();
  let colourIdx  = 0;

  enabled.forEach(seed => {
    if (visited.has(seed.id)) return;

    // BFS
    const component = [];
    const queue = [seed];
    visited.add(seed.id);

    while (queue.length) {
      const cur = queue.shift();
      component.push(cur);
      enabled.forEach(n => {
        if (visited.has(n.id)) return;
        const adjacent = room.layoutMode === 'freeform'
          ? Math.hypot((n.x ?? 0) - (cur.x ?? 0), (n.y ?? 0) - (cur.y ?? 0)) <= FREEFORM_ADJACENCY_PX
          : Math.abs(n.row - cur.row) <= 1 && Math.abs(n.col - cur.col) <= 1;
        if (adjacent) {
          visited.add(n.id);
          queue.push(n);
        }
      });
    }

    if (component.length >= 2) {
      const cl = clusterCreate(
        room,
        `Group ${room.clusters.length + 1}`,
        CLUSTER_COLOURS[colourIdx++ % CLUSTER_COLOURS.length]
      );
      component.forEach(s => { s.clusterId = cl.id; });
    }
  });
}

/* ============================================================
   CLASS SET MANAGEMENT
============================================================ */

function classSetCreate(name = 'New Class Set', studentIds = []) {
  const cs = { id: uid(), name, studentIds: [...studentIds] };
  state.classSets.push(cs);
  return cs;
}

function classSetUpdate(id, data) {
  const cs = state.classSets.find(x => x.id === id);
  if (cs) Object.assign(cs, data);
}

function classSetDelete(id) {
  state.classSets = state.classSets.filter(x => x.id !== id);
  if (state.activeClassSetId === id) state.activeClassSetId = null;
  if (editingClassSetId === id) editingClassSetId = null;
}

/** Return the students that belong to the active class set, or all students. */
function visibleStudents() {
  if (!state.activeClassSetId) return state.students;
  const cs = state.classSets.find(x => x.id === state.activeClassSetId);
  if (!cs) return state.students;
  return state.students.filter(s => cs.studentIds.includes(s.id));
}
