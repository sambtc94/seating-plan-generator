'use strict';

/* ============================================================
   VERSION
============================================================ */
const APP_COMMIT = 'a45c662';
const APP_VERSION = '1.0 (' + APP_COMMIT + ')';

/* ============================================================
   CONSTANTS
============================================================ */
const CLUSTER_COLOURS = [
  '#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c',
  '#3498db','#9b59b6','#e91e63','#ff5722','#00bcd4',
  '#795548','#607d8b'
];

const STUDENT_FLAGS = [
  { key: 'SEN',       label: 'SEN',       colour: '#e74c3c' },
  { key: 'EAL',       label: 'EAL',       colour: '#3498db' },
  { key: 'Gifted',    label: 'Gifted',    colour: '#f1c40f' },
  { key: 'Behaviour', label: 'Behaviour', colour: '#e67e22' }
];

const SEAT_LABELS = {
  teacher:    { icon: '👨‍🏫', name: "Teacher's Desk" },
  whiteboard: { icon: '📋',  name: 'Whiteboard'      },
  bookshelf:  { icon: '📚',  name: 'Bookshelf'       },
  projector:  { icon: '📽',  name: 'Projector'       },
  computer:   { icon: '💻',  name: 'Computer Desk'   }
};

const CELL_SIZE              = 84;  // 78px seat + 6px gap — used for grid↔freeform conversion
const FREEFORM_PAD           = 42;  // padding inside the freeform canvas (= CELL_SIZE/2, aligns with the 42px background grid)
const SEAT_WIDTH             = 78;  // seat cell width/height in px
const SEAT_HALF              = 39;  // half of SEAT_WIDTH (for centring click position)
const FREEFORM_ADJACENCY_PX  = 170; // pixel proximity for cluster auto-detect in freeform mode
const MAX_FREEFORM_SEATS     = 200; // hard cap on desks in a freeform room
