export const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const PATTERN_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
export const STEPS = 16;
export const SCALES = {
  minor: { name: 'MINOR', notes: [0, 2, 3, 5, 7, 8, 10, 12] },
  dorian: { name: 'DORIAN', notes: [0, 2, 3, 5, 7, 9, 10, 12] },
  phrygian: { name: 'PHRYGIAN', notes: [0, 1, 3, 5, 7, 8, 10, 12] },
  harmonic: { name: 'HARM MIN', notes: [0, 2, 3, 5, 7, 8, 11, 12] },
  pentatonic: { name: 'MIN PENTA', notes: [0, 3, 5, 7, 10, 12] },
  major: { name: 'MAJOR', notes: [0, 2, 4, 5, 7, 9, 11, 12] },
};

export const CHORDS = [
  { name: 'MIN', iv: [0, 3, 7] },
  { name: 'MIN7', iv: [0, 3, 7, 10] },
  { name: 'MIN9', iv: [0, 3, 7, 10, 14] },
  { name: 'DUB', iv: [0, 7, 10, 15, 19] },
  { name: 'SUS2', iv: [0, 2, 7, 12] },
  { name: 'SUS4', iv: [0, 5, 7, 10] },
  { name: '5TH', iv: [0, 7, 12] },
  { name: 'MAJ7', iv: [0, 4, 7, 11] },
  { name: 'DIM', iv: [0, 3, 6, 9] },
  { name: 'MAJ9', iv: [0, 4, 7, 11, 14] },
  { name: 'ADD9', iv: [0, 4, 7, 14] },
];

export const DELAY_TIMES = [
  { name: '1/16', steps: 1 },
  { name: '1/8', steps: 2 },
  { name: '3/16', steps: 3 },
  { name: '1/4', steps: 4 },
  { name: '3/8', steps: 6 },
];

const p = (id, label, min, max, def, opts = {}) => ({ id, label, min, max, def, ...opts });

export const MIX_PARAMS = [
  p('level', 'LEVEL', 0, 1.2, 0.8),
  p('pan', 'PAN', -1, 1, 0, { bipolar: true }),
  p('rev', 'REVERB', 0, 1, 0),
  p('dly', 'DELAY', 0, 1, 0),
];

export const TRACKS = [
  {
    id: 'kick', name: 'KICK', kind: 'drum', color: '#ff2b2b',
    params: [
      p('tune', 'TUNE', 32, 80, 46, { unit: 'Hz', step: 0.5 }),
      p('punch', 'PUNCH', 0, 1, 0.55),
      p('decay', 'DECAY', 0.12, 1.8, 0.55, { curve: 'exp', unit: 's' }),
      p('click', 'CLICK', 0, 1, 0.35),
      p('drive', 'DRIVE', 0, 1, 0.45),
      p('rumble', 'RUMBLE', 0, 1, 0.35),
    ],
    mix: { level: 0.9 },
  },
  {
    id: 'clap', name: 'CLAP', kind: 'drum', color: '#ff7a2b',
    params: [
      p('tone', 'TONE', 500, 3500, 1150, { curve: 'exp', unit: 'Hz' }),
      p('decay', 'DECAY', 0.05, 0.9, 0.24, { curve: 'exp', unit: 's' }),
      p('spread', 'SPREAD', 0, 1, 0.5),
    ],
    mix: { level: 0.55, rev: 0.25 },
  },
  {
    id: 'snare', name: 'SNARE', kind: 'drum', color: '#ffb02b',
    params: [
      p('tune', 'TUNE', 110, 320, 185, { unit: 'Hz' }),
      p('snappy', 'SNAPPY', 0, 1, 0.6),
      p('decay', 'DECAY', 0.05, 0.7, 0.2, { curve: 'exp', unit: 's' }),
    ],
    mix: { level: 0.5, rev: 0.15 },
  },
  {
    id: 'ch', name: 'C-HAT', kind: 'drum', color: '#e8e8e8',
    params: [
      p('tune', 'TUNE', 0.6, 1.6, 1),
      p('decay', 'DECAY', 0.015, 0.3, 0.05, { curve: 'exp', unit: 's' }),
      p('tone', 'TONE', 2500, 12000, 7200, { curve: 'exp', unit: 'Hz' }),
    ],
    mix: { level: 0.42, pan: 0.12 },
  },
  {
    id: 'oh', name: 'O-HAT', kind: 'drum', color: '#c8c8c8',
    params: [
      p('tune', 'TUNE', 0.6, 1.6, 1),
      p('decay', 'DECAY', 0.08, 1.4, 0.32, { curve: 'exp', unit: 's' }),
      p('tone', 'TONE', 2500, 12000, 6500, { curve: 'exp', unit: 'Hz' }),
    ],
    mix: { level: 0.38, pan: -0.1, dly: 0.05 },
  },
  {
    id: 'ride', name: 'RIDE', kind: 'drum', color: '#a8a8a8',
    params: [
      p('tune', 'TUNE', 0.6, 1.5, 1),
      p('decay', 'DECAY', 0.25, 3, 1.1, { curve: 'exp', unit: 's' }),
      p('tone', 'TONE', 2500, 11000, 5200, { curve: 'exp', unit: 'Hz' }),
    ],
    mix: { level: 0.3, pan: 0.25, rev: 0.1 },
  },
  {
    id: 'perc', name: 'PERC', kind: 'drum', color: '#7ad7ff',
    params: [
      p('tune', 'TUNE', 70, 900, 240, { curve: 'exp', unit: 'Hz' }),
      p('decay', 'DECAY', 0.04, 1, 0.22, { curve: 'exp', unit: 's' }),
      p('bend', 'BEND', 0, 1, 0.45),
      p('noise', 'NOISE', 0, 1, 0.2),
      p('metal', 'METAL', 0, 1, 0.3),
    ],
    mix: { level: 0.45, pan: -0.3, rev: 0.2, dly: 0.25 },
  },
  {
    id: 'acid', name: 'ACID', kind: 'acid', color: '#c6ff2b',
    params: [
      p('wave', 'SAW/SQR', 0, 1, 0),
      p('tune', 'TUNE', -12, 12, 0, { unit: 'st', step: 1, bipolar: true }),
      p('cutoff', 'CUTOFF', 60, 6000, 380, { curve: 'exp', unit: 'Hz' }),
      p('reso', 'RESO', 0, 28, 18, { unit: 'dB' }),
      p('envmod', 'ENV MOD', 0, 1, 0.6),
      p('decay', 'DECAY', 0.04, 1.2, 0.24, { curve: 'exp', unit: 's' }),
      p('accent', 'ACCENT', 0, 1, 0.65),
      p('drive', 'DRIVE', 0, 1, 0.5),
      p('voice', 'VOICE', 0, 1, 0, { step: 1, list: ['303', 'BASS'] }),
    ],
    mix: { level: 0.55, dly: 0.12, rev: 0.05 },
  },
  {
    id: 'stab', name: 'STAB', kind: 'stab', color: '#b98cff',
    params: [
      p('chord', 'CHORD', 0, CHORDS.length - 1, 3, { step: 1, list: CHORDS.map((c) => c.name) }),
      p('octave', 'OCTAVE', -2, 2, 0, { step: 1, bipolar: true }),
      p('cutoff', 'CUTOFF', 150, 9000, 1400, { curve: 'exp', unit: 'Hz' }),
      p('reso', 'RESO', 0, 20, 5, { unit: 'dB' }),
      p('env', 'ENV', 0, 1, 0.45),
      p('decay', 'DECAY', 0.05, 2.5, 0.28, { curve: 'exp', unit: 's' }),
      p('detune', 'DETUNE', 0, 40, 12, { unit: 'ct' }),
      p('voice', 'VOICE', 0, 1, 0, { step: 1, list: ['SAW', 'KEYS'] }),
    ],
    mix: { level: 0.42, rev: 0.35, dly: 0.42 },
  },
  {
    id: 'vox', name: 'VOX', kind: 'sampler', color: '#ff7ad9',
    params: [
      p('slice', 'SLICE', 0, 7, 0, { step: 1 }),
      p('scatter', 'SCATTER', 0, 1, 0.5),
      p('pitch', 'PITCH', -12, 12, 0, { step: 1, unit: 'st', bipolar: true }),
      p('melody', 'MELODY', 0, 1, 0.4),
      p('length', 'LENGTH', 0.25, 4, 1, { step: 0.25 }),
      p('tone', 'TONE', 300, 12000, 7000, { curve: 'exp', unit: 'Hz' }),
    ],
    mix: { level: 0.6, rev: 0.3, dly: 0.22 },
  },
];

export const TRACK_IDS = TRACKS.map((t) => t.id);
export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]));

export const MASTER_PARAMS = [
  p('dj', 'FILTER', -1, 1, 0, { bipolar: true }),
  p('duck', 'SIDECHAIN', 0, 1, 0.5),
  p('drive', 'DRIVE', 0, 1, 0.3),
  p('volume', 'MASTER', 0, 1.2, 0.85),
  p('revLevel', 'REV RTN', 0, 1, 0.7),
  p('revTone', 'REV TONE', 800, 12000, 4500, { curve: 'exp', unit: 'Hz' }),
  p('dlyTime', 'DLY TIME', 0, DELAY_TIMES.length - 1, 2, { step: 1, list: DELAY_TIMES.map((d) => d.name) }),
  p('dlyFb', 'FEEDBACK', 0, 0.92, 0.45),
  p('dlyLevel', 'DLY RTN', 0, 1, 0.65),
  p('humanize', 'HUMANIZE', 0, 1, 0),
];

export function defaultParams() {
  const out = {};
  for (const t of TRACKS) {
    const o = {};
    for (const q of t.params) o[q.id] = q.def;
    for (const q of MIX_PARAMS) o[q.id] = t.mix[q.id] ?? q.def;
    out[t.id] = o;
  }
  return out;
}

export function defaultMaster() {
  return Object.fromEntries(MASTER_PARAMS.map((q) => [q.id, q.def]));
}

export function formatValue(q, v) {
  if (q.list) return q.list[Math.round(v)];
  if (q.unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(2) + 'k' : Math.round(v) + '';
  if (q.unit === 's') return v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's';
  if (q.unit === 'st') return (v > 0 ? '+' : '') + Math.round(v);
  if (q.unit === 'dB') return v.toFixed(1);
  if (q.unit === 'ct') return Math.round(v) + 'c';
  if (q.step && !q.unit) return q.step < 1 ? v.toFixed(2) : (q.bipolar && v > 0 ? '+' : '') + Math.round(v);
  if (q.bipolar) return (v > 0 ? '+' : '') + Math.round(v * 100);
  return Math.round(v * 100) + '';
}
