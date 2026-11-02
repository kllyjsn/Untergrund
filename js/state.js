import { TRACK_IDS, TRACK_BY_ID, MIX_PARAMS, MASTER_PARAMS, STEPS, SCALES, defaultParams, defaultMaster } from './params.js';
import { rng } from './dsp.js';

export const STYLES = {
  hypnotic: { name: 'HYPNOTIC', bpm: [130, 134], family: 'TECHNO', tag: 'deep · rolling' },
  industrial: { name: 'INDUSTRIAL', bpm: [136, 142], family: 'TECHNO', tag: 'hard · metallic' },
  acid: { name: 'ACID', bpm: [132, 138], family: 'TECHNO', tag: '303 · elastic' },
  dub: { name: 'DUB TECHNO', bpm: [122, 127], family: 'TECHNO', tag: 'spacious · low' },
  peak: { name: 'PEAK TIME', bpm: [142, 150], family: 'TECHNO', tag: 'urgent · main room' },
  hardtechno: { name: 'HARD TECHNO', bpm: [150, 158], family: 'TECHNO', tag: 'distorted · relentless' },
  deephouse: { name: 'DEEP HOUSE', bpm: [120, 124], family: 'HOUSE', tag: 'warm · minor 9ths' },
  minimal: { name: 'MINIMAL', bpm: [124, 128], family: 'HOUSE', tag: 'clicks · space' },
  ukg: { name: 'UK GARAGE', bpm: [130, 134], family: 'HOUSE', tag: '2-step · shuffled' },
  euphoric: { name: 'EUPHORIC', bpm: [126, 134], family: 'HOUSE', tag: 'emotional · vocal chops' },
  neosoul: { name: 'NEO-SOUL', bpm: [84, 94], family: 'JAZZ & HIP-HOP', tag: 'Glasper · Dilla swing' },
  boombap: { name: 'BOOM BAP', bpm: [88, 96], family: 'JAZZ & HIP-HOP', tag: 'dusty · jazz chords' },
  breaks: { name: 'BREAKS', bpm: [128, 136], family: 'BREAKS & BASS', tag: 'broken · funky' },
  electro: { name: 'ELECTRO', bpm: [124, 130], family: 'BREAKS & BASS', tag: '808 · robotic' },
  dnb: { name: 'DRUM & BASS', bpm: [170, 176], family: 'BREAKS & BASS', tag: 'rolling · sub' },
  trance: { name: 'TRANCE', bpm: [136, 140], family: 'TRANCE & AMBIENT', tag: 'supersaws · lift' },
  ambient: { name: 'AMBIENT', bpm: [92, 104], family: 'TRANCE & AMBIENT', tag: 'beatless · drifting' },
  amapiano: { name: 'AMAPIANO', bpm: [112, 116], family: 'AFRO & LATIN', tag: 'log drum · shakers' },
  afrobeats: { name: 'AFROBEATS', bpm: [100, 110], family: 'AFRO & LATIN', tag: 'bounce · marimba' },
  reggaeton: { name: 'REGGAETON', bpm: [90, 98], family: 'AFRO & LATIN', tag: 'dembow · 808' },
  bailefunk: { name: 'BAILE FUNK', bpm: [128, 134], family: 'AFRO & LATIN', tag: 'tamborzão · Rio' },
  trap: { name: 'TRAP', bpm: [138, 148], family: 'TRAP & POP', tag: 'half-time · 808 slides' },
  drill: { name: 'DRILL', bpm: [140, 146], family: 'TRAP & POP', tag: 'sliding 808 · skippy' },
  jerseyclub: { name: 'JERSEY CLUB', bpm: [136, 144], family: 'TRAP & POP', tag: 'triplet kicks · chops' },
  hyperpop: { name: 'HYPERPOP', bpm: [150, 162], family: 'TRAP & POP', tag: 'K-pop sugar · distorted' },
};

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

export function emptyAcidStep() { return { on: false, n: 0, a: false, s: false }; }

export function emptyPattern() {
  const steps = {};
  const len = {};
  for (const id of TRACK_IDS) {
    steps[id] = id === 'acid' ? range(STEPS, emptyAcidStep) : range(STEPS, () => 0);
    len[id] = STEPS;
  }
  return { steps, len };
}

export const clone = (o) => JSON.parse(JSON.stringify(o));

export function euclid(k, n, rot = 0) {
  return range(n, (i) => {
    const j = (i + rot) % n;
    return Math.floor((j * k) / n) !== Math.floor(((j - 1) * k) / n) || j === 0 ? 1 : 0;
  });
}

const pad16 = (arr) => range(STEPS, (i) => arr[i] || 0);
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function acidLine(r, { density = 0.65, accent = 0.3, slide = 0.22, scale = [0, 0, 0, 3, 5, 7, 10, 12], jump = 0.18 } = {}) {
  return range(STEPS, (i) => {
    const on = i === 0 || r() < density;
    if (!on) return emptyAcidStep();
    let n = pick(r, scale);
    if (r() < jump) n += r() < 0.5 ? 12 : -12;
    n = Math.max(-12, Math.min(12, n));
    return { on: true, n, a: r() < accent, s: r() < slide };
  });
}

function rollingBass(r) {
  const alt = r() < 0.5;
  return range(STEPS, (i) => {
    if (i % 4 === 0) return emptyAcidStep();
    const n = alt && i % 4 === 3 ? 12 : 0;
    return { on: true, n, a: i % 4 === 2, s: false };
  });
}

// Seeded groove bass: root on the one, then syncopated chord tones from a genre's slot grammar.
function grooveBass(r, slots, k, scale, slide = 0.15) {
  const pos = new Set([0]);
  for (let g = 0; pos.size < k && g < 64; g++) pos.add(pick(r, slots));
  const d = (i) => scale[i] ?? 12;
  const tones = [0, 0, 0, 12, d(4), d(4) - 12, d(6) - 12, d(2), d(3)];
  return range(STEPS, (i) => (pos.has(i) ? { on: true, n: i === 0 ? 0 : pick(r, tones), a: i === 0 || r() < 0.25, s: r() < slide } : emptyAcidStep()));
}

// The generator's musician model. These are constraints, not slogans: every
// hook below keeps one identity, breathes, answers the harmony, develops over
// time, and saves its biggest risk for a peak.
export const MUSICIAN_PRINCIPLES = Object.freeze({
  listen: 'land important notes on the current chord',
  respond: 'write an answer instead of repeating the call',
  space: 'leave rests so the groove can speak',
  develop: 'return to one motif with controlled changes',
  risk: 'save the widest leap and octave lift for the peak',
  remember: 'keep the same motif identity through the song',
});

// Hook profiles (NEO-SOUL and BOOM BAP keep their Rhodes licks instead):
// voice, octave, notes per bar, rhythm weighting, lengths, range and expression.
const HOOKS = {
  techno: { v: ['pulse'], o: 0, hits: [3, 5], w: (i) => (i % 2 ? 0.9 : i % 4 === 2 ? 0.6 : 0.25), len: [1, 1, 2], lo: -2, hi: 5, leap: 0.2, x: [0.35, 0.45, 0.35, 0.62] },
  dub: { v: ['mallet'], o: 0, hits: [2, 3], w: (i) => (i % 4 === 2 || i % 4 === 3 ? 0.8 : 0.2), len: [3, 4, 6], lo: -1, hi: 5, leap: 0.3, x: [0.62, 0.28, 0.55, 0.48] },
  house: { v: ['vocal', 'reed'], o: 0, hits: [3, 5], w: (i) => (i % 4 === 3 || i % 4 === 2 ? 0.8 : i % 4 === 0 ? 0.4 : 0.3), len: [1, 2, 2, 3], lo: -2, hi: 5, leap: 0.2, x: [0.48, 0.35, 0.52, 0.55] },
  anthem: { v: ['analog'], o: 0, hits: [4, 7], w: (i) => (i % 2 === 0 ? 0.8 : 0.35), len: [1, 2, 2, 3, 4], lo: 0, hi: 9, leap: 0.3, x: [0.25, 0.62, 0.26, 0.65] },
  ambient: { v: ['mallet'], o: 0, hits: [2, 3], w: (i) => (i % 4 === 0 ? 0.8 : 0.15), len: [4, 6, 8], lo: 0, hi: 9, leap: 0.4, x: [0.7, 0.32, 0.7, 0.38] },
  afro: { v: ['vocal', 'reed'], o: 0, hits: [3, 5], w: (i) => ([0, 3, 6, 8, 10, 11, 14].includes(i) ? 0.85 : 0.15), len: [1, 1, 2], lo: -2, hi: 5, leap: 0.25, x: [0.46, 0.4, 0.55, 0.52] },
  trap: { v: ['mallet', 'reed'], o: 1, hits: [3, 5], w: (i) => ([0, 3, 6, 8, 10, 12, 14].includes(i) ? 0.85 : 0.1), len: [2, 2, 3], lo: -2, hi: 5, leap: 0.3, x: [0.58, 0.45, 0.48, 0.4] },
  // UK garage: skippy, chopped vocal phrases on the off-16ths.
  garage: { v: ['vocal'], o: 0, hits: [5, 7], w: (i) => (i % 2 ? 0.85 : 0.25), len: [1, 1, 1, 2], lo: -2, hi: 5, leap: 0.3, x: [0.42, 0.45, 0.6, 0.42] },
  // Liquid drum & bass: few long notes floating over fast drums.
  dnb: { v: ['analog'], o: 0, hits: [2, 3], w: (i) => (i % 8 === 0 ? 0.8 : i % 4 === 2 ? 0.5 : 0.15), len: [4, 6, 8], lo: 0, hi: 7, leap: 0.35, x: [0.6, 0.5, 0.4, 0.6] },
  // Amapiano: short offbeat piano-like figures; the log drum carries the weight.
  piano: { v: ['mallet'], o: 0, hits: [4, 6], w: (i) => (i % 4 === 3 || i % 4 === 1 ? 0.8 : 0.2), len: [1, 1, 2], lo: -2, hi: 6, leap: 0.3, x: [0.45, 0.4, 0.6, 0.45] },
  // Hyperpop: busy, high, wide leaps.
  pop: { v: ['pulse'], o: 1, hits: [6, 9], w: (i) => (i % 2 === 0 ? 0.8 : 0.5), len: [1, 1, 2], lo: 0, hi: 9, leap: 0.45, x: [0.2, 0.8, 0.3, 0.25] },
};
const HOOK_STYLE = {
  hypnotic: 'techno', industrial: 'techno', acid: 'techno', peak: 'techno', hardtechno: 'techno', minimal: 'techno', electro: 'techno', dub: 'dub',
  deephouse: 'house', ukg: 'garage', breaks: 'house', jerseyclub: 'garage', euphoric: 'anthem', trance: 'anthem', hyperpop: 'pop', dnb: 'dnb',
  ambient: 'ambient', amapiano: 'piano', afrobeats: 'afro', reggaeton: 'afro', bailefunk: 'afro', trap: 'trap', drill: 'trap',
};
export const HOOK_VOICES = ['pulse', 'analog', 'warm', 'vocal', 'reed', 'mallet', 'sq', 'saw', 'pluck', 'flute', 'bell'];

// Every genre has several plausible ensembles. The seed chooses a player,
// register and articulation while the genre keeps its drum, harmony and room identity.
const INSTRUMENTS = {
  // voice, bass, octave, release, articulation
  hypnotic: [[0, 0, 0, 0.7, 0.25], [6, 0, 1, 0.45, 0.7], [3, 0, -1, 0.8, 0.2], [5, 3, 0, 0.3, 0.8]],
  industrial: [[6, 3, 0, 0.35, 0.75], [4, 3, -1, 0.5, 0.65], [0, 3, 0, 0.24, 0.55], [10, 3, 0, 0.8, 0.85]],
  acid: [[0, 0, 0, 0.35, 0.45], [5, 0, 1, 0.28, 0.8], [3, 0, -1, 0.5, 0.3], [6, 0, 1, 0.4, 0.75]],
  dub: [[2, 2, 0, 1.4, 0.15], [3, 1, -1, 0.9, 0.25], [5, 2, 0, 0.65, 0.7], [9, 1, 0, 0.45, 0.55]],
  peak: [[4, 0, 0, 0.5, 0.65], [6, 3, 1, 0.35, 0.75], [0, 0, 1, 0.22, 0.6], [10, 3, 1, 1, 0.8]],
  hardtechno: [[0, 3, 0, 0.2, 0.65], [4, 3, -1, 0.4, 0.7], [6, 0, 1, 0.3, 0.8], [5, 3, 0, 0.22, 0.9]],
  deephouse: [[7, 1, 0, 1.5, 0.25], [3, 1, 0, 0.9, 0.35], [8, 1, 0, 0.65, 0.75], [10, 1, 0, 1.4, 0.2]],
  minimal: [[6, 2, 0, 0.3, 0.65], [5, 1, 0, 0.25, 0.8], [3, 2, -1, 0.55, 0.25], [8, 1, 0, 0.45, 0.7]],
  ukg: [[3, 3, 0, 0.55, 0.45], [7, 1, 0, 0.75, 0.5], [5, 3, 1, 0.25, 0.85], [8, 2, 1, 0.4, 0.8]],
  euphoric: [[7, 1, 0, 1.6, 0.25], [10, 1, 0, 1.8, 0.2], [2, 3, 1, 2.1, 0.15], [9, 0, 0, 0.65, 0.7]],
  neosoul: [[7, 1, 0, 1.6, 0.2], [3, 1, 0, 1.1, 0.25], [8, 1, 0, 0.75, 0.7], [9, 1, 0, 0.65, 0.55]],
  boombap: [[9, 1, 0, 0.7, 0.6], [7, 1, 0, 1.2, 0.2], [8, 1, 0, 0.6, 0.75], [10, 1, 0, 1.1, 0.3]],
  breaks: [[8, 0, 0, 0.6, 0.75], [5, 1, 1, 0.25, 0.85], [3, 2, 0, 0.55, 0.35], [7, 0, 1, 0.7, 0.5]],
  electro: [[0, 2, 0, 0.25, 0.7], [6, 3, 1, 0.45, 0.75], [5, 2, 0, 0.2, 0.9], [4, 3, 0, 0.4, 0.65]],
  dnb: [[10, 3, 0, 1.6, 0.25], [2, 3, 1, 1.8, 0.2], [7, 2, 1, 1.2, 0.45], [9, 3, 1, 0.55, 0.75]],
  trance: [[5, 1, 0, 0.35, 0.85], [2, 3, 1, 1.6, 0.2], [7, 1, 1, 1.1, 0.35], [10, 3, 1, 1.8, 0.15]],
  ambient: [[2, 2, 0, 2.4, 0.1], [10, 1, 1, 2.8, 0.15], [6, 2, 1, 2.2, 0.3], [7, 1, 1, 2.5, 0.15]],
  amapiano: [[7, 4, 0, 0.7, 0.35], [3, 4, 1, 0.55, 0.45], [8, 4, 0, 0.55, 0.8], [5, 4, 1, 0.25, 0.85]],
  afrobeats: [[8, 2, 0, 0.55, 0.8], [9, 1, 0, 0.55, 0.65], [7, 1, 1, 0.7, 0.45], [3, 2, 0, 0.5, 0.5]],
  reggaeton: [[8, 2, 0, 0.45, 0.8], [5, 2, 1, 0.22, 0.9], [9, 1, 0, 0.45, 0.7], [7, 2, 1, 0.55, 0.45]],
  bailefunk: [[4, 2, 0, 0.3, 0.75], [6, 2, 0, 0.25, 0.85], [8, 2, 0, 0.4, 0.8], [5, 3, 1, 0.2, 0.9]],
  trap: [[7, 2, 1, 0.75, 0.4], [6, 2, 0, 0.8, 0.7], [10, 2, 1, 1.5, 0.2], [8, 2, 1, 0.5, 0.8]],
  drill: [[10, 2, 1, 1.4, 0.2], [7, 2, 0, 0.9, 0.45], [9, 2, 0, 0.5, 0.75], [6, 2, 1, 0.65, 0.8]],
  jerseyclub: [[0, 2, 1, 0.2, 0.75], [4, 2, 0, 0.2, 0.7], [8, 2, 1, 0.4, 0.8], [6, 2, 1, 0.5, 0.85]],
  hyperpop: [[8, 3, 1, 0.4, 0.85], [6, 2, 0, 0.3, 0.75], [10, 3, 1, 1.2, 0.2], [7, 2, 2, 0.65, 0.55]],
};

// A 2-bar call and answer: same rhythm both bars, the answer bends its ending (resolve or leave open).
export function hookLine(r, style, scale) {
  const H = HOOKS[HOOK_STYLE[style]];
  if (!H) return null;
  const deg = scale.length >= 7 ? scale.slice(0, 7) : scale.slice(0, scale.length - 1);
  const N = deg.length;
  const semi = (d) => deg[((d % N) + N) % N] + 12 * Math.floor(d / N);
  const k = H.hits[0] + Math.floor(r() * (H.hits[1] - H.hits[0] + 1));
  const slots = new Set([r() < 0.6 ? 0 : pick(r, [2, 3, 6])]);
  for (let g = 0; slots.size < k && g < 200; g++) { const i = Math.floor(r() * 16); if (r() < H.w(i)) slots.add(i); }
  const pos = [...slots].sort((a, b) => a - b);
  let d = pick(r, [0, 2, 4]);
  const call = pos.map((i, j) => {
    if (j) d = Math.max(H.lo, Math.min(H.hi, d + (r() < H.leap ? pick(r, [-3, 3, 4, -4, 5]) : pick(r, [-1, 1, 1, -2, 2]))));
    const room = (pos[j + 1] ?? 16) - i;
    return [i, d, Math.max(1, Math.min(room, pick(r, H.len)))];
  });
  const s = range(32, () => 0);
  const lastD = call[call.length - 1][1];
  call.forEach(([i, dd, l], j) => {
    const arc = 0.72 + 0.22 * Math.sin(((j + 1) / (call.length + 1)) * Math.PI);
    s[i] = [semi(dd), l, j === 0 ? 0.86 : i % 4 === 0 ? 0.96 : arc];
    let a = dd;
    if (j === call.length - 1) a = lastD % N === 0 ? pick(r, [4, 2, -1]) : pick(r, [0, N]);
    else if (j === call.length - 2 && r() < 0.5) a = dd + pick(r, [1, -1]);
    const l2 = j === call.length - 1 ? Math.min(16 - i, l + pick(r, [0, 2, 4])) : l;
    s[16 + i] = [semi(a), Math.max(1, l2), j === call.length - 1 ? 0.98 : Math.max(0.68, arc - 0.04)];
  });
  const [space, risk, feel, warmth] = H.x;
  return { v: pick(r, H.v), o: H.o, s, x: { space, risk, feel, warmth } };
}

// Returns { pattern, params, master, bpm } — params/master are partial overrides.
export function generate(style, seed = Date.now(), scaleName = 'minor') {
  const r = rng(seed);
  const musicalScale = SCALES[scaleName]?.notes || SCALES.minor.notes;
  const P = emptyPattern();
  const S = P.steps;
  const params = { kick: {}, acid: {}, stab: {}, perc: {}, ch: {}, oh: {}, ride: {}, clap: {}, snare: {}, vox: {} };
  let swing;
  const master = {};
  const [lo, hi] = STYLES[style].bpm;
  const bpm = Math.round(lo + r() * (hi - lo));

  S.kick = range(STEPS, (i) => (i % 4 === 0 ? (i === 0 ? 2 : 1) : 0));
  const offbeatOH = range(STEPS, (i) => (i % 4 === 2 ? 1 : 0));
  const hatTemplates = [
    range(STEPS, (i) => (i % 4 === 2 ? 2 : 1)),
    range(STEPS, (i) => (i % 4 === 0 ? 0 : i % 4 === 2 ? 2 : 1)),
    range(STEPS, (i) => (i % 2 === 1 ? 1 : 0)),
    range(STEPS, (i) => ([1, 3, 6, 7, 9, 11, 14, 15].includes(i) ? (i % 4 === 3 ? 2 : 1) : 0)),
  ];

  if (style === 'hypnotic') {
    S.ch = pick(r, hatTemplates);
    S.oh = offbeatOH;
    S.ride = r() < 0.6 ? range(STEPS, (i) => (i % 4 === 2 ? 1 : 0)) : range(STEPS, (i) => (i % 2 === 0 ? 0 : 1));
    S.perc = pad16(euclid(pick(r, [3, 5, 7]), 16, Math.floor(r() * 8)));
    P.len.perc = pick(r, [12, 14, 15, 16]);
    S.acid = rollingBass(r);
    S.stab = pad16([0, 0, 0, 1]);
    P.len.stab = pick(r, [7, 11, 13]);
    if (r() < 0.5) S.clap[12] = 1;
    Object.assign(params.kick, { tune: 44 + r() * 6, decay: 0.5 + r() * 0.25, drive: 0.35, rumble: 0.45, punch: 0.5 });
    Object.assign(params.acid, { wave: 0.15, cutoff: 180 + r() * 120, reso: 8, envmod: 0.35, decay: 0.18, accent: 0.4, drive: 0.35 });
    Object.assign(params.stab, { chord: pick(r, [1, 3, 4]), cutoff: 1100, decay: 0.22, env: 0.4 });
    Object.assign(params.perc, { tune: 180 + r() * 300, metal: 0.4, bend: 0.3 });
    master.duck = 0.55;
  } else if (style === 'industrial') {
    if (r() < 0.5) S.kick[14] = 1; else S.kick[15] = 1;
    S.ch = range(STEPS, (i) => (i % 4 === 2 ? 2 : 1));
    S.oh = offbeatOH;
    S.ride = range(STEPS, (i) => (i % 2 ? 1 : 0));
    S.clap = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    for (let k = 0; k < 3; k++) S.snare[pick(r, [3, 7, 10, 11, 13, 15])] = 1;
    S.perc = pad16(euclid(5, 16, Math.floor(r() * 16)));
    P.len.perc = pick(r, [15, 16]);
    if (r() < 0.5) S.acid = acidLine(r, { density: 0.45, scale: [0, 0, ...musicalScale], accent: 0.5, slide: 0.1 });
    Object.assign(params.kick, { tune: 40 + r() * 6, decay: 0.75, drive: 0.85, rumble: 0.7, punch: 0.7, click: 0.5 });
    Object.assign(params.clap, { tone: 900, decay: 0.35 });
    Object.assign(params.perc, { tune: 90 + r() * 120, metal: 0.8, noise: 0.5, bend: 0.7 });
    Object.assign(params.acid, { wave: 1, cutoff: 260, reso: 14, envmod: 0.55, drive: 0.95, decay: 0.2 });
    master.duck = 0.6; master.drive = 0.55;
  } else if (style === 'acid') {
    S.ch = pick(r, hatTemplates);
    S.oh = offbeatOH;
    S.clap = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.perc = pad16(euclid(3, 16, Math.floor(r() * 8)));
    S.acid = acidLine(r, { density: 0.75, accent: 0.35, slide: 0.25, scale: [0, 0, ...musicalScale] });
    Object.assign(params.kick, { tune: 48, decay: 0.45, drive: 0.4, rumble: 0.25 });
    Object.assign(params.acid, { wave: r() < 0.7 ? 0 : 1, cutoff: 300 + r() * 300, reso: 20, envmod: 0.65, decay: 0.26, accent: 0.75, drive: 0.6 });
    master.duck = 0.45;
  } else if (style === 'dub') {
    S.ch = range(STEPS, (i) => (i % 4 === 2 ? 1 : 0));
    S.ride = range(STEPS, (i) => (i % 2 ? 1 : 0));
    S.perc = pad16(euclid(3, 16, 2));
    P.len.perc = 12;
    S.stab = pad16(pick(r, [[0, 0, 0, 1, 0, 0, 1], [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1], [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1]]));
    S.acid = range(STEPS, (i) => (i % 4 === 2 ? { on: true, n: 0, a: false, s: false } : emptyAcidStep()));
    Object.assign(params.kick, { tune: 47, decay: 0.6, drive: 0.15, rumble: 0.5, click: 0.15 });
    Object.assign(params.stab, { chord: pick(r, [1, 2, 3]), cutoff: 900 + r() * 600, reso: 6, decay: 0.35, env: 0.5, detune: 10 });
    Object.assign(params.acid, { wave: 0.4, cutoff: 140, reso: 4, envmod: 0.2, decay: 0.3, drive: 0.2, accent: 0.2 });
    master.duck = 0.65; master.dlyTime = 2; master.dlyFb = 0.62;
  } else if (style === 'peak') {
    S.kick[0] = 2;
    S.ch = range(STEPS, (i) => (i % 4 === 2 ? 2 : 1));
    S.oh = offbeatOH;
    S.ride = range(STEPS, () => 1);
    S.clap = pad16([0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2]);
    S.snare = pad16([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
    S.perc = pad16(euclid(7, 16, Math.floor(r() * 16)));
    S.acid = acidLine(r, { density: 0.8, scale: [0, 0, ...musicalScale], accent: 0.4, slide: 0.15, jump: 0.3 });
    Object.assign(params.kick, { tune: 50, decay: 0.42, drive: 0.75, punch: 0.75, rumble: 0.4, click: 0.45 });
    Object.assign(params.acid, { wave: 0.3, cutoff: 500, reso: 22, envmod: 0.7, decay: 0.2, accent: 0.8, drive: 0.8 });
    master.duck = 0.5; master.drive = 0.45;
  } else if (style === 'euphoric') {
    const twoStep = r() < 0.5;
    S.kick = twoStep ? pad16([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]) : S.kick;
    S.clap = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    if (twoStep) S.snare = pad16([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.ch = range(STEPS, (i) => (i % 4 === 2 ? 2 : i % 2 ? 1 : 0));
    if (r() < 0.5) S.oh = offbeatOH;
    S.perc = pad16(euclid(3, 16, Math.floor(r() * 8)));
    S.stab = pad16(pick(r, [[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 0, 1]]));
    S.vox = pad16(pick(r, [[0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [2, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1], [0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 1]]));
    S.acid = range(STEPS, (i) => ([2, 6, 10, 14].includes(i) || (i === 11 && r() < 0.6)
      ? { on: true, n: i === 10 ? pick(r, [0, musicalScale[3], musicalScale[4]]) : 0, a: false, s: false } : emptyAcidStep()));
    Object.assign(params.kick, { tune: 50, decay: 0.5, drive: 0.2, rumble: 0.1, punch: 0.6, click: 0.3 });
    Object.assign(params.stab, { chord: pick(r, [2, 4, 7, 9, 10]), octave: 0, cutoff: 2400 + r() * 1600, reso: 3, decay: 0.9 + r() * 0.6, env: 0.25, detune: 18, rev: 0.5, dly: 0.3 });
    Object.assign(params.vox, { slice: Math.floor(r() * 8), scatter: 0.4 + r() * 0.5, melody: 0.5 + r() * 0.4, length: pick(r, [0.5, 1, 1.5]), tone: 6500, rev: 0.35, dly: 0.28 });
    Object.assign(params.acid, { wave: 0.1, cutoff: 220, reso: 2, envmod: 0.15, decay: 0.35, drive: 0.15, accent: 0.2 });
    master.duck = 0.8; master.revLevel = 0.8; master.dlyTime = 1; master.dlyFb = 0.38;
    swing = twoStep ? 0.28 : 0.14;
  } else if (style === 'hardtechno') {
    S.kick = range(STEPS, (i) => (i % 4 === 0 ? 2 : 0));
    S.oh = offbeatOH;
    S.ch = range(STEPS, (i) => (i % 2 ? 1 : 0));
    S.clap = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.perc = pad16(euclid(5, 16, Math.floor(r() * 16)));
    S.acid = range(STEPS, (i) => (i % 4 === 2 || i % 4 === 3 ? { on: true, n: 0, a: i % 4 === 2, s: false } : emptyAcidStep()));
    Object.assign(params.kick, { tune: 52, decay: 0.38, drive: 1, punch: 0.9, click: 0.7, rumble: 0.85 });
    Object.assign(params.perc, { tune: 420, metal: 0.9, noise: 0.6, bend: 0.8 });
    Object.assign(params.acid, { wave: 0.9, cutoff: 300, reso: 10, envmod: 0.5, decay: 0.12, drive: 1 });
    master.duck = 0.7; master.drive = 0.8;
  } else if (style === 'deephouse') {
    S.ch = range(STEPS, (i) => (i % 4 === 2 ? 1 : 0));
    S.oh = range(STEPS, (i) => (i % 4 === 2 && r() < 0.4 ? 1 : 0));
    S.ride = range(STEPS, (i) => (i % 2 ? 1 : 0));
    S.clap = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.stab = pad16(pick(r, [[0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1], [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]]));
    S.acid = range(STEPS, (i) => ([0, 3, 7, 10].includes(i) ? { on: true, n: i === 7 ? musicalScale[4] : i === 10 ? musicalScale[2] : 0, a: false, s: i === 3 } : emptyAcidStep()));
    Object.assign(params.kick, { tune: 48, decay: 0.55, drive: 0.15, rumble: 0.15, punch: 0.45, click: 0.2 });
    Object.assign(params.stab, { voice: 1, chord: pick(r, [1, 2]), cutoff: 1300 + r() * 500, reso: 2, decay: 0.7, env: 0.3, detune: 8, rev: 0.4, dly: 0.25 });
    master.humanize = 0.32; master.warmth = 0.4; master.room = 0.2;
    Object.assign(params.acid, { wave: 0.05, cutoff: 260, reso: 2, envmod: 0.12, decay: 0.4, drive: 0.1, accent: 0.2 });
    Object.assign(params.ride, { tone: 4200, decay: 0.6 });
    master.duck = 0.6; master.revLevel = 0.6;
    swing = 0.3;
  } else if (style === 'minimal') {
    S.kick = range(STEPS, (i) => (i % 4 === 0 ? 1 : 0));
    S.ch = range(STEPS, (i) => (i % 4 === 2 ? 1 : 0));
    S.perc = pad16(euclid(pick(r, [5, 7]), 16, Math.floor(r() * 16)));
    P.len.perc = pick(r, [11, 13, 15]);
    S.snare = pad16([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    S.clap[12] = 1;
    S.acid = range(STEPS, (i) => ([2, 11].includes(i) ? { on: true, n: i === 11 ? musicalScale[3] : 0, a: false, s: false } : emptyAcidStep()));
    S.stab = pad16([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    P.len.stab = 13;
    Object.assign(params.kick, { tune: 54, decay: 0.28, drive: 0.1, rumble: 0, punch: 0.7, click: 0.55 });
    Object.assign(params.perc, { tune: 700 + r() * 150, decay: 0.05, metal: 0.2, noise: 0.1, bend: 0.1 });
    Object.assign(params.snare, { tune: 300, snappy: 0.2, decay: 0.06 });
    Object.assign(params.acid, { wave: 0.6, cutoff: 420, reso: 6, envmod: 0.3, decay: 0.09, drive: 0.1 });
    Object.assign(params.stab, { chord: 6, cutoff: 2500, decay: 0.08, env: 0.6, dly: 0.5 });
    master.duck = 0.3; master.revLevel = 0.3;
    swing = 0.1;
  } else if (style === 'ukg') {
    S.kick = pad16([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
    S.snare = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.clap = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.ch = range(STEPS, (i) => (i % 2 ? (i % 4 === 3 ? 2 : 1) : 0));
    S.oh = range(STEPS, (i) => (i === 6 || i === 14 ? 1 : 0));
    S.perc = pad16([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
    S.stab = pad16(pick(r, [[0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1], [1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1]]));
    S.vox = pad16(pick(r, [[0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1]]));
    S.acid = range(STEPS, (i) => ([0, 7, 10].includes(i) ? { on: true, n: i === 7 ? musicalScale[4] : 0, a: i === 0, s: i === 7 } : emptyAcidStep()));
    Object.assign(params.kick, { tune: 50, decay: 0.45, drive: 0.25, rumble: 0.2 });
    Object.assign(params.snare, { tune: 220, snappy: 0.8, decay: 0.15 });
    Object.assign(params.stab, { chord: pick(r, [1, 2, 7]), cutoff: 2200, reso: 4, decay: 0.25, env: 0.5, detune: 6 });
    Object.assign(params.vox, { scatter: 0.8, melody: 0.7, length: 0.5, tone: 7000 });
    Object.assign(params.acid, { wave: 0.95, cutoff: 500, reso: 8, envmod: 0.45, decay: 0.3, drive: 0.4 });
    master.duck = 0.65;
    swing = 0.34;
  } else if (style === 'neosoul' || style === 'boombap') {
    const soul = style === 'neosoul';
    S.kick = pad16(pick(r, soul ? [[2, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1], [2, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1]] : [[2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1], [2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]]));
    S.snare = pad16([0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2]).map((v, i) => v || ([3, 7, 10, 15].includes(i) && r() < 0.55 ? 1 : 0));
    S.clap = soul ? range(STEPS, () => 0) : pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.ch = range(STEPS, (i) => (i % 2 === 0 ? (i % 4 === 0 ? 2 : 1) : (r() < 0.35 ? 1 : 0)));
    S.ride = soul && r() < 0.5 ? range(STEPS, (i) => (i % 4 === 0 || i % 4 === 3 ? 1 : 0)) : range(STEPS, () => 0);
    S.stab = pad16(pick(r, [[1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]]));
    S.acid = range(STEPS, (i) => (i % 4 === 0 || (i % 4 === 3 && r() < 0.5) ? { on: true, n: pick(r, [0, musicalScale[2], musicalScale[4], musicalScale[6] ?? 10]), a: i === 0, s: r() < 0.25 } : emptyAcidStep()));
    if (soul) S.vox = pad16([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    Object.assign(params.kick, { tune: 52, decay: soul ? 0.5 : 0.35, drive: soul ? 0.2 : 0.45, rumble: 0, punch: 0.55, click: soul ? 0.15 : 0.4 });
    Object.assign(params.snare, { tune: soul ? 200 : 170, snappy: soul ? 0.4 : 0.75, decay: 0.22 });
    Object.assign(params.ch, { decay: 0.05, tone: soul ? 3600 : 4800, level: 0.62, rev: 0.1 });
    Object.assign(params.ride, { tone: 3800, decay: 1.4, level: 0.5, rev: 0.15 });
    Object.assign(params.kick, { level: 1.05 });
    Object.assign(params.snare, { level: 0.8, rev: 0.22 });
    Object.assign(params.stab, { voice: 1, chord: pick(r, soul ? [2, 9, 10, 7] : [1, 2, 7]), octave: 0, cutoff: soul ? 1500 : 1100, reso: 1, decay: 1.4, env: soul ? 0.35 : 0.2, detune: soul ? 14 : 6, rev: 0.3, dly: 0.1, level: 0.55 });
    Object.assign(params.acid, { voice: 1, wave: 0.05, tune: -12, cutoff: 320, reso: 1, envmod: 0.1, decay: 0.5, drive: 0.3, accent: 0.15, level: 0.95, dly: 0 });
    Object.assign(params.vox, { scatter: 0.6, melody: 0.8, length: 2, tone: 4500 });
    master.humanize = soul ? 0.9 : 0.6; master.warmth = soul ? 0.4 : 0.35; master.kit = 1; master.room = soul ? 0.5 : 0.4;
    master.duck = 0; master.drive = soul ? 0.08 : 0.15; master.revLevel = 0.5;
    swing = soul ? 0.58 : 0.42;
  } else if (style === 'breaks') {
    S.kick = pad16([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.snare = pad16([0, 0, 0, 0, 2, 0, 0, 1, 0, 1, 0, 0, 2, 0, 0, 0]);
    S.ch = range(STEPS, (i) => (i % 2 === 0 ? 1 : 0));
    S.oh = pad16([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.perc = pad16(euclid(3, 16, 3));
    S.acid = acidLine(r, { density: 0.45, scale: [0, 0, ...musicalScale], accent: 0.3, slide: 0.2 });
    S.stab = pad16([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    Object.assign(params.kick, { tune: 50, decay: 0.4, drive: 0.5, punch: 0.75, rumble: 0.1 });
    Object.assign(params.snare, { tune: 190, snappy: 0.85, decay: 0.2 });
    Object.assign(params.stab, { chord: pick(r, [0, 5, 6]), cutoff: 2600, decay: 0.15, env: 0.6 });
    Object.assign(params.acid, { wave: 0.4, cutoff: 600, reso: 14, envmod: 0.55, decay: 0.18, drive: 0.6 });
    master.duck = 0.45; master.drive = 0.4;
    swing = 0.12;
  } else if (style === 'electro') {
    S.kick = pad16(pick(r, [[2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1], [2, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1]]));
    S.clap = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.ch = range(STEPS, () => 1);
    S.perc = pad16([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
    S.acid = acidLine(r, { density: 0.6, scale: [0, 0, 0, ...musicalScale], accent: 0.4, slide: 0.05, jump: 0.35 });
    Object.assign(params.kick, { tune: 42, decay: 1.2, drive: 0.35, punch: 0.6, rumble: 0, click: 0.6 });
    Object.assign(params.ch, { decay: 0.02, tone: 9000 });
    Object.assign(params.perc, { tune: 900, decay: 0.08, metal: 0.95, bend: 0.2 });
    Object.assign(params.acid, { wave: 1, cutoff: 700, reso: 12, envmod: 0.4, decay: 0.14, drive: 0.5 });
    master.duck = 0.2; master.dlyTime = 0;
  } else if (style === 'dnb') {
    S.kick = pad16([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.snare = pad16([0, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 1]);
    S.ch = range(STEPS, (i) => (i % 2 === 0 ? 1 : r() < 0.3 ? 1 : 0));
    S.ride = range(STEPS, (i) => (i % 4 === 2 ? 1 : 0));
    S.perc = range(STEPS, (i) => (i % 2 ? 1 : 0));
    S.acid = range(STEPS, (i) => ([0, 6, 10].includes(i) ? { on: true, n: i === 6 ? musicalScale[2] : 0, a: false, s: i === 6 } : emptyAcidStep()));
    S.stab = pad16([1]);
    Object.assign(params.kick, { tune: 55, decay: 0.3, drive: 0.4, punch: 0.85, rumble: 0, click: 0.6 });
    Object.assign(params.snare, { tune: 240, snappy: 0.9, decay: 0.18 });
    Object.assign(params.acid, { wave: 0, tune: -12, cutoff: 160, reso: 1, envmod: 0.05, decay: 0.9, drive: 0.25 });
    Object.assign(params.stab, { chord: 1, cutoff: 1800, decay: 2.2, env: 0.1, rev: 0.6 });
    master.duck = 0.5; master.revLevel = 0.5;
  } else if (style === 'trance') {
    S.oh = offbeatOH;
    S.ch = range(STEPS, () => 1);
    S.clap = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.acid = range(STEPS, (i) => (i % 4 === 0 ? emptyAcidStep() : { on: true, n: i >= 8 ? musicalScale[5] - 12 : 0, a: i % 4 === 2, s: false }));
    S.stab = range(STEPS, (i) => (i % 2 === 0 ? (i % 4 === 0 ? 2 : 1) : 0));
    Object.assign(params.kick, { tune: 49, decay: 0.45, drive: 0.4, punch: 0.65 });
    Object.assign(params.stab, { chord: pick(r, [0, 4, 7]), octave: 1, cutoff: 3200, reso: 6, decay: 0.12, env: 0.4, detune: 34, rev: 0.45, dly: 0.35 });
    Object.assign(params.acid, { wave: 0, cutoff: 380, reso: 4, envmod: 0.3, decay: 0.1, drive: 0.3 });
    master.duck = 0.75; master.revLevel = 0.75; master.dlyTime = 2; master.dlyFb = 0.45;
  } else if (style === 'ambient') {
    S.kick = range(STEPS, () => 0);
    S.ch = range(STEPS, (i) => (i % 8 === 6 ? 1 : 0));
    S.perc = pad16(euclid(2, 16, 5));
    S.stab = pad16([1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.vox = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.acid = range(STEPS, (i) => (i === 0 ? { on: true, n: 0, a: false, s: false } : emptyAcidStep()));
    Object.assign(params.stab, { chord: pick(r, [2, 4, 9, 10]), cutoff: 900, reso: 2, decay: 2.5, env: 0.1, detune: 20, rev: 0.8, dly: 0.5 });
    Object.assign(params.vox, { scatter: 0.9, melody: 0.9, length: 4, tone: 3000, rev: 0.7 });
    Object.assign(params.perc, { tune: 600, decay: 0.6, metal: 0.7, noise: 0.1, rev: 0.6 });
    Object.assign(params.acid, { wave: 0, tune: -12, cutoff: 120, reso: 0, envmod: 0, decay: 1.2, drive: 0 });
    master.duck = 0; master.revLevel = 1; master.dlyFb = 0.7;
  } else if (style === 'amapiano') {
    S.kick = range(STEPS, (i) => (i % 4 === 0 ? (i === 0 ? 2 : 1) : 0));
    S.clap = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.ch = range(STEPS, (i) => (i % 4 === 2 ? 1 : 0));
    S.perc = range(STEPS, (i) => (i % 4 === 2 ? 2 : 1));
    const log = pick(r, [[3, 6, 10, 14], [2, 6, 9, 12, 14], [3, 7, 10, 11, 15]]);
    S.acid = range(STEPS, (i) => (log.includes(i) ? { on: true, n: pick(r, [0, 0, musicalScale[2], musicalScale[4], 12]), a: i === log[0], s: r() < 0.2 } : emptyAcidStep()));
    S.stab = pad16([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    Object.assign(params.kick, { tune: 48, decay: 0.4, drive: 0.1, punch: 0.4, click: 0.15, rumble: 0 });
    Object.assign(params.clap, { level: 0.6 });
    Object.assign(params.perc, { tune: 320, decay: 0.09, noise: 0.5 });
    Object.assign(params.stab, { chord: pick(r, [2, 9]), octave: 0, cutoff: 1600, decay: 1.1, env: 0.3, detune: 8, rev: 0.35 });
    Object.assign(params.acid, { tune: 0, cutoff: 700, decay: 0.45, drive: 0.2, accent: 0.5, level: 0.5 });
    master.duck = 0.3; master.humanize = 0.3; master.revLevel = 0.5;
    swing = 0.22;
  } else if (style === 'afrobeats') {
    S.kick = pad16(pick(r, [[2, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1], [2, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1]]));
    S.clap = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.snare = pad16([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1]);
    S.ch = range(STEPS, (i) => (i % 4 === 2 ? 2 : 1));
    S.perc = pad16(euclid(5, 16, 2));
    S.stab = pad16(pick(r, [[0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1], [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1]]));
    S.acid = range(STEPS, (i) => ([0, 6, 8, 11].includes(i) ? { on: true, n: i === 8 ? musicalScale[4] - 12 : i === 11 ? musicalScale[2] : 0, a: i === 0, s: false } : emptyAcidStep()));
    Object.assign(params.kick, { tune: 50, decay: 0.42, drive: 0.15, punch: 0.55, click: 0.25, rumble: 0 });
    Object.assign(params.snare, { tune: 420, snappy: 0.15, decay: 0.05, level: 0.55 });
    Object.assign(params.ch, { decay: 0.03, tone: 7000, level: 0.5 });
    Object.assign(params.perc, { tune: 240, decay: 0.2, noise: 0.35, bend: 0.2 });
    Object.assign(params.stab, { chord: pick(r, [7, 10]), octave: 0, cutoff: 3000, decay: 0.5, env: 0.4, rev: 0.3, dly: 0.25, level: 0.4 });
    Object.assign(params.acid, { tune: 0, cutoff: 300, decay: 0.6, drive: 0.2, level: 0.85 });
    master.duck = 0.25; master.humanize = 0.35;
    swing = 0.36;
  } else if (style === 'reggaeton') {
    S.kick = range(STEPS, (i) => (i % 4 === 0 ? (i === 0 ? 2 : 1) : 0));
    S.snare = pad16([0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 1, 0]);
    S.ch = range(STEPS, (i) => (i % 2 === 0 ? 1 : 0));
    S.perc = pad16([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1]);
    S.stab = pad16([1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.acid = range(STEPS, (i) => ([0, 3, 8, 11].includes(i) ? { on: true, n: 0, a: i === 0, s: false } : emptyAcidStep()));
    Object.assign(params.kick, { tune: 46, decay: 0.6, drive: 0.3, punch: 0.6, click: 0.3, rumble: 0 });
    Object.assign(params.snare, { tune: 300, snappy: 0.55, decay: 0.09, level: 1 });
    Object.assign(params.perc, { tune: 260, decay: 0.15 });
    Object.assign(params.stab, { chord: pick(r, [0, 1]), octave: 1, cutoff: 2200, decay: 0.6, env: 0.3, dly: 0.2, level: 0.35 });
    Object.assign(params.acid, { tune: 0, cutoff: 500, decay: 0.35, drive: 0.35 });
    master.duck = 0.4;
    swing = 0.04;
  } else if (style === 'bailefunk') {
    S.kick = pad16(pick(r, [[2, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], [2, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 1, 0, 0, 1]]));
    S.clap = pad16([0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1]);
    S.ch = range(STEPS, (i) => (i % 2 === 0 ? 1 : 0));
    S.perc = pad16(euclid(7, 16, 0));
    S.vox = pad16(pick(r, [[0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1], [1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]]));
    S.acid = range(STEPS, (i) => (i === 0 || i === 8 ? { on: true, n: 0, a: true, s: false } : emptyAcidStep()));
    Object.assign(params.kick, { tune: 46, decay: 0.7, drive: 0.6, punch: 0.8, click: 0.4, rumble: 0.3 });
    Object.assign(params.clap, { tone: 1400, decay: 0.2 });
    Object.assign(params.perc, { tune: 220, decay: 0.18, noise: 0.6, bend: 0.3 });
    Object.assign(params.vox, { scatter: 0.9, melody: 0.3, length: 0.5, tone: 6000 });
    Object.assign(params.acid, { tune: 0, cutoff: 300, decay: 0.8, drive: 0.6 });
    master.duck = 0.3; master.drive = 0.35;
    swing = 0.1;
  } else if (style === 'trap') {
    S.kick = pad16(pick(r, [[2, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1], [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]]));
    S.clap = pad16([0, 0, 0, 0, 0, 0, 0, 0, 2]);
    S.snare = pad16([0, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.ch = range(STEPS, (i) => (i % 4 === 0 ? 2 : r() < 0.88 ? 1 : 0));
    S.stab = pad16([1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.acid = range(STEPS, (i) => ([0, 7, 10].includes(i) ? { on: true, n: i === 10 ? 12 : 0, a: i === 0, s: i >= 7 } : emptyAcidStep()));
    Object.assign(params.kick, { tune: 52, decay: 0.3, drive: 0.4, punch: 0.8, click: 0.5, rumble: 0 });
    Object.assign(params.clap, { tone: 1200, decay: 0.25 });
    Object.assign(params.ch, { decay: 0.025, tone: 8000, level: 0.5 });
    Object.assign(params.stab, { chord: pick(r, [0, 8]), octave: 1, cutoff: 3000, decay: 0.8, env: 0.2, rev: 0.4, dly: 0.3 });
    Object.assign(params.acid, { tune: 0, cutoff: 400, decay: 0.9, drive: 0.4, accent: 0.4 });
    master.duck = 0.2;
    swing = 0.02;
  } else if (style === 'drill') {
    S.kick = pad16(pick(r, [[2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1], [2, 0, 0, 0, 0, 0, 0, 0, 0, 1]]));
    S.snare = pad16([0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1]).map((v, i) => v || (i === 11 && r() < 0.5 ? 1 : 0));
    S.clap = pad16([0, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.ch = pad16([2, 0, 0, 1, 0, 0, 1, 0, 2, 0, 0, 1, 0, 0, 1]);
    S.perc = pad16([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.stab = pad16([1]);
    S.acid = range(STEPS, (i) => ([0, 3, 6, 10, 12].includes(i) ? { on: true, n: pick(r, [0, 0, musicalScale[2], 12, musicalScale[4] - 12]), a: i === 0, s: i === 6 || i === 12 } : emptyAcidStep()));
    Object.assign(params.kick, { tune: 50, decay: 0.28, drive: 0.35, punch: 0.75, click: 0.45, rumble: 0 });
    Object.assign(params.snare, { tune: 230, snappy: 0.85, decay: 0.16 });
    Object.assign(params.perc, { tune: 800, decay: 0.05, metal: 0.6 });
    Object.assign(params.stab, { chord: pick(r, [0, 8]), cutoff: 1400, decay: 2, env: 0.3, rev: 0.6 });
    Object.assign(params.acid, { tune: 0, cutoff: 350, decay: 1, drive: 0.2, level: 0.45 });
    master.duck = 0.15;
    swing = 0;
  } else if (style === 'jerseyclub') {
    S.kick = pad16(pick(r, [[2, 0, 0, 0, 2, 0, 0, 1, 0, 0, 1, 0, 2], [2, 0, 0, 1, 0, 0, 1, 0, 2, 0, 0, 0, 1, 0, 1]]));
    S.clap = pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.ch = range(STEPS, (i) => (i % 2 === 0 ? 1 : 0));
    S.vox = pad16(pick(r, [[0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1], [1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1]]));
    S.stab = pad16([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.acid = range(STEPS, (i) => (i === 0 || i === 7 ? { on: true, n: 0, a: i === 0, s: false } : emptyAcidStep()));
    Object.assign(params.kick, { tune: 54, decay: 0.3, drive: 0.5, punch: 0.85, click: 0.6, rumble: 0 });
    Object.assign(params.clap, { tone: 1500, decay: 0.15 });
    Object.assign(params.vox, { scatter: 0.95, melody: 0.5, length: 0.5, tone: 7500 });
    Object.assign(params.stab, { chord: 1, cutoff: 2000, decay: 0.15, env: 0.6 });
    Object.assign(params.acid, { tune: 0, cutoff: 400, decay: 0.25, drive: 0.4 });
    master.duck = 0.35;
    swing = 0.08;
  } else if (style === 'hyperpop') {
    S.kick = pad16([2, 0, 0, 0, 0, 0, 1, 0, 1]);
    S.clap = pad16([0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2]);
    S.snare = pad16([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
    S.ch = range(STEPS, (i) => (i % 4 === 2 ? 2 : 1));
    S.stab = range(STEPS, (i) => (i % 2 === 0 ? (i % 4 === 0 ? 2 : 1) : 0));
    S.vox = pad16(pick(r, [[0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1], [1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1]]));
    S.acid = range(STEPS, (i) => ([0, 6, 8, 14].includes(i) ? { on: true, n: i === 14 ? 12 : 0, a: i === 0, s: i === 14 } : emptyAcidStep()));
    Object.assign(params.kick, { tune: 54, decay: 0.35, drive: 0.7, punch: 0.9, click: 0.7, rumble: 0 });
    Object.assign(params.clap, { tone: 1600, decay: 0.2 });
    Object.assign(params.snare, { tune: 320, snappy: 0.9, decay: 0.1 });
    Object.assign(params.stab, { chord: pick(r, [7, 9, 10]), octave: 1, cutoff: 4500, decay: 0.2, env: 0.5, detune: 22, rev: 0.4, dly: 0.3 });
    Object.assign(params.vox, { scatter: 0.9, melody: 1, length: 0.5, tone: 9000 });
    Object.assign(params.acid, { wave: 0.6, cutoff: 900, reso: 6, envmod: 0.4, decay: 0.3, drive: 0.45, level: 0.45 });
    master.duck = 0.55; master.drive = 0.5;
    swing = 0;
  }
  const PROGS = {
    neosoul: [[[0, 2], [5, 2], [10, 9], [3, 9]], [[0, 2], [8, 9], [3, 9], [10, 10]], [[0, 2], [3, 9], [5, 1], [7, 1]], [[0, 2], [10, 9], [8, 9], [7, 1]], [[0, 2], [1, 7], [10, 2], [8, 9]]],
    boombap: [[[0, 1], [0, 1], [8, 7], [7, 1]], [[0, 2], [5, 1], [0, 2], [8, 7]], [[0, 1], [3, 7], [5, 1], [8, 9]]],
    deephouse: [[[0, 2], [5, 1], [3, 9], [10, 10]], [[0, 2], [8, 7], [5, 2], [7, 1]], [[0, 1], [0, 5], [8, 7], [7, 5]], [[0, 0], [10, 0], [8, 7], [7, 1]], [[0, 3], [0, 3], [5, 1], [3, 4]]],
    ukg: [[[0, 2], [5, 1], [8, 7], [7, 1]], [[0, 1], [3, 9], [10, 10], [5, 2]], [[0, 1], [7, 5], [8, 7], [5, 1]], [[0, 0], [3, 7], [10, 6], [8, 7]]],
    euphoric: [[[0, 9], [7, 10], [9, 2], [5, 9]], [[5, 9], [7, 10], [0, 9], [9, 2]], [[0, 9], [4, 1], [5, 9], [7, 5]], [[9, 1], [5, 9], [0, 10], [7, 10]]],
    trance: [[[0, 0], [8, 7], [3, 10], [10, 10]], [[0, 0], [5, 0], [8, 7], [10, 10]]],
    amapiano: [[[0, 2], [5, 1], [3, 9], [10, 10]], [[0, 1], [8, 7], [3, 9], [7, 1]], [[0, 2], [0, 2], [5, 5], [7, 1]], [[0, 1], [10, 6], [8, 7], [5, 1]]],
    afrobeats: [[[0, 1], [8, 7], [3, 10], [10, 10]], [[0, 2], [5, 1], [8, 9], [10, 10]], [[0, 1], [5, 1], [10, 10], [8, 7]], [[0, 0], [8, 7], [10, 6], [7, 5]]],
    reggaeton: [[[0, 0], [8, 10], [3, 10], [10, 10]], [[0, 1], [5, 0], [8, 10], [7, 0]]],
    trap: [[[0, 0], [8, 7], [0, 0], [7, 0]], [[0, 0], [5, 0], [8, 7], [7, 8]]],
    drill: [[[0, 0], [8, 7], [5, 0], [7, 0]], [[0, 0], [1, 7], [0, 0], [8, 7]]],
    hyperpop: [[[3, 10], [10, 10], [0, 1], [8, 7]], [[8, 9], [10, 10], [3, 9], [0, 1]]],
  };
  if (PROGS[style]) {
    const progs = PROGS[style].map((pr) => pr.map(([root, c]) => ({ r: root, c })));
    const main = Math.floor(r() * progs.length);
    P.prog = progs[main];
    P.alt = progs[(main + 1 + Math.floor(r() * (progs.length - 1))) % progs.length];
  }
  const VARY = { neosoul: 0.8, boombap: 0.6, deephouse: 0.4, ukg: 0.45, breaks: 0.5, euphoric: 0.3, dnb: 0.4, amapiano: 0.4, afrobeats: 0.4, reggaeton: 0.25, bailefunk: 0.35, trap: 0.35, drill: 0.4, jerseyclub: 0.3, hyperpop: 0.3 };
  if (VARY[style]) master.vary = VARY[style];
  const dm = defaultMaster();
  for (const k of Object.keys(dm)) if (k !== 'volume' && k !== 'dj') master[k] ??= dm[k];
  // Each scene has its own room. Urban and club-pop records are dry and in your face; only the
  // ambient, dub and trance worlds get the big shared reverb.
  const ROOM = {
    trap: 0.22, drill: 0.22, bailefunk: 0.2, jerseyclub: 0.25, reggaeton: 0.28, boombap: 0.3, hyperpop: 0.35,
    ukg: 0.35, dnb: 0.35, afrobeats: 0.38, amapiano: 0.4, deephouse: 0.42, breaks: 0.4, neosoul: 0.4,
  };
  if (ROOM[style] != null) {
    master.revLevel = ROOM[style];
    params.stab.rev = +((params.stab.rev ?? 0.3) * (0.4 + ROOM[style])).toFixed(3);
  }
  const instrumentRng = rng(Math.imul((seed | 0) ^ 0x6d2b79f5, 0x85ebca6b));
  const ensemble = pick(instrumentRng, INSTRUMENTS[style]);
  const [stabVoice, bassVoice, octave, decay, articulation] = ensemble;
  params.stab.voice = stabVoice;
  params.stab.octave = octave;
  params.stab.decay = decay;
  params.stab.env = articulation;
  const ensembleLevel = [0.75, 0.78, 0.72, 0.78, 0.78, 0.8, 0.75, 0.9, 0.9, 0.9, 0.9][stabVoice];
  params.stab.level = Math.max(params.stab.level ?? 0.42, ensembleLevel);
  const closeLevel = { 'jerseyclub:0': 0.52, 'jerseyclub:4': 0.55, 'hyperpop:6': 0.5 }[`${style}:${stabVoice}`];
  if (closeLevel) {
    params.stab.level = closeLevel;
    params.stab.cutoff = Math.min(params.stab.cutoff ?? 2400, style === 'hyperpop' ? 2200 : 1800);
  }
  // Recorded players sit in the room, not in a delay: echoes on held strings and piano read as a synth chorus.
  if (stabVoice >= 7) {
    params.stab.dly = Math.min(params.stab.dly ?? 0.42, 0.08);
    params.stab.rev = Math.min(params.stab.rev ?? 0.3, 0.2);
  }
  params.acid.voice = bassVoice;
  for (const t of ['acid', 'stab']) params[t].voice ??= 0;
  const PERC = { dnb: 3, deephouse: 1, ukg: 3, boombap: 3, neosoul: 3, breaks: 2, minimal: 4, dub: 4, euphoric: 3, ambient: 2, amapiano: 3, afrobeats: 1, reggaeton: 2, bailefunk: 1 };
  params.perc.voice = PERC[style] ?? 0;
  const DUST = { boombap: 0.45, neosoul: 0.25, dub: 0.3, ambient: 0.2, deephouse: 0.12, minimal: 0.1 };
  master.dust = DUST[style] ?? 0;
  master.arr = { neosoul: 0, boombap: 0, ambient: 0 }[style] ?? (GROOVE.has(style) ? 0.5 : 1);
  // Per-seed identity on its own RNG so the genre grammar above stays stable.
  const r2 = rng(Math.imul((seed | 0) ^ 0x5bd1e995, 0x9e3779b1) ^ 0x2545f491);
  for (let k = 0; k < 4; k++) r2();
  const key = Math.floor(r2() * 12);
  const BASS = { deephouse: [[3, 6, 7, 10, 11, 13, 14], 4, 6], ukg: [[3, 6, 7, 10, 13, 14], 3, 5], afrobeats: [[3, 6, 8, 10, 11, 14], 4, 5] };
  if (BASS[style]) { const [slots, a, b] = BASS[style]; S.acid = grooveBass(r2, slots, a + Math.floor(r2() * (b - a + 1)), musicalScale); }
  if (['deephouse', 'ukg', 'afrobeats', 'amapiano', 'euphoric'].includes(style)) {
    for (let g = 0, n = 1 + Math.floor(r2() * 3); g < n; g++) { const i = 1 + 2 * Math.floor(r2() * 8); if (!S.ch[i]) S.ch[i] = 1; }
  }
  if (params.stab.cutoff) params.stab.cutoff = Math.round(params.stab.cutoff * (0.75 + r2() * 0.6));
  if (params.stab.decay) params.stab.decay = +(params.stab.decay * (0.8 + r2() * 0.4)).toFixed(3);
  const PUNCH = { deephouse: 0.72, ukg: 0.7, afrobeats: 0.7, amapiano: 0.65, euphoric: 0.72, trance: 0.72, reggaeton: 0.7 };
  if (PUNCH[style]) {
    params.kick.punch = Math.max(params.kick.punch ?? 0, PUNCH[style]);
    params.kick.drive = Math.max(params.kick.drive ?? 0, 0.3);
    params.acid.level = Math.max(params.acid.level ?? 0.55, 0.98);
  }
  const hook = hookLine(r2, style, musicalScale);
  if (hook) { P.hook = hook; P.hm = 2; }
  // One seeded idea per track, chosen from moves that fit any groove: an octave pop at the end of
  // the bass phrase, displaced percussion, or a chord that anticipates the beat. Sometimes restraint.
  const idea = Math.floor(r2() * 4);
  const on = S.acid.map((st, i) => (st.on ? i : -1)).filter((i) => i >= 0);
  if (idea === 0 && on.length > 2) S.acid[on[on.length - 1]].n += 12;
  else if (idea === 1 && S.perc.some(Boolean)) { const k = 1 + Math.floor(r2() * 3), q = S.perc.slice(); S.perc = q.map((_, i) => q[(i - k + STEPS) % STEPS]); }
  else if (idea === 2 && S.stab.some(Boolean) && !['neosoul', 'boombap'].includes(style)) { const q = S.stab.slice(); S.stab = q.map((_, i) => q[(i + 1) % STEPS]); }
  return { pattern: P, params, master, bpm, key, swing: swing ?? 0.06 };
}

export function mutate(pat, seed = Date.now(), amount = 0.2, scale = SCALES.minor.notes) {
  const r = rng(seed);
  const P = clone(pat);
  const edits = Math.max(1, Math.round(amount * 10));
  for (let k = 0; k < edits; k++) {
    const id = pick(r, ['ch', 'perc', 'ride', 'snare', 'oh']);
    const i = Math.floor(r() * STEPS);
    P.steps[id][i] = P.steps[id][i] ? 0 : 1;
  }
  const ac = P.steps.acid;
  if (ac.some((s) => s.on)) {
    for (let k = 0; k < edits; k++) {
      const i = Math.floor(r() * STEPS);
      const s = ac[i];
      const roll = r();
      if (roll < 0.4) s.n = pick(r, [...scale, -12]);
      else if (roll < 0.6) s.a = !s.a;
      else if (roll < 0.8) s.s = !s.s;
      else s.on = !s.on;
    }
  }
  for (let k = 0; k < Math.max(1, Math.floor(edits / 2)); k++) {
    const i = Math.floor(r() * STEPS);
    P.steps.stab[i] = P.steps.stab[i] ? 0 : (r() < 0.25 ? 2 : 1);
  }
  return P;
}

// One-bar half-time switch: kick on the one, backbeat moved to beat 3
function halfTime(full) {
  const q = clone(full);
  q.steps.kick = pad16([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, full.steps.kick[10] ? 1 : 0]);
  q.steps.clap = pad16([0, 0, 0, 0, 0, 0, 0, 0, 2]);
  q.steps.snare = pad16([0, 0, 0, 0, 0, 0, 0, 0, 1]);
  q.steps.ch = range(STEPS, (i) => (i % 2 === 0 ? 1 : 0));
  q.steps.oh = range(STEPS, () => 0);
  return q;
}

// Turn one full pattern into an 8-pattern arrangement: intro → build → peak → breakdown → return.
export function arrangement(full, seed, half = false) {
  const strip = (p, keep) => {
    const q = clone(p);
    for (const id of TRACK_IDS) if (!keep.includes(id)) q.steps[id] = id === 'acid' ? range(STEPS, emptyAcidStep) : range(STEPS, () => 0);
    return q;
  };
  const all = TRACK_IDS;
  const without = (...ids) => all.filter((x) => !ids.includes(x));
  const fill = clone(full);
  delete fill.alt;
  fill.steps.snare = pad16([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2]);
  const scenes = [
    strip(full, ['kick', 'ch', 'perc']),
    strip(full, ['kick', 'ch', 'oh', 'perc', 'acid']),
    strip(full, without('stab')),
    mutate(fill, seed + 1),
    strip(full, ['ride', 'perc', 'stab', 'ch']),
    strip(full, ['ride', 'perc', 'stab', 'acid', 'oh']),
    clone(full),
    half ? halfTime(full) : mutate(full, seed + 2),
  ];
  for (const p of scenes) delete p.alt;
  // Hook: absent in the intro, teased (call only) in the verse and deep breakdown, full in the fill, breakdown and peaks.
  [0, 0, 1, 2, 2, 1, 2, 2].forEach((m, i) => { if (full.hook) scenes[i].hm = m; else delete scenes[i].hm; });
  if (full.alt) for (const i of [4, 5]) scenes[i].prog = clone(full.alt);
  return scenes;
}

const GROOVE = new Set(['neosoul', 'boombap', 'deephouse', 'ukg', 'euphoric', 'amapiano', 'afrobeats', 'reggaeton', 'trap', 'drill']);
// Song forms in 4-bar sections. Groove styles: intro, verse x2, bridge (alt changes), verse/hook x2, outro. A D fill closes the bridge.
const SONG_FORMS = {
  groove: ['AABBCCCDCCCDEEFDGGGHGGGHBBAA', 'AABBCCCDEEFDCCCDGGGHGGGHEEAA', 'ABBBCCCDCCCDEEFFEEFDGGGHGGGHBBAA'],
  ambient: ['AAAAEEEEFFFFEEEEFFFFAAAA', 'AAEEEEFFFFGGGGEEFFAAAA'],
  techno: ['AAAABBBBCCCCCCCDEEEEFFFFGGGGGGGHBBBBAAAA', 'AAAABBBBCCCDCCCDEEFFGGGHGGGHBBAA', 'AABBBBCCCCCCCDEEEEFFGGGGGGGHGGGHAAAA'],
};

export function songChain(style, seed) {
  const forms = SONG_FORMS[GROOVE.has(style) ? 'groove' : style === 'ambient' ? 'ambient' : 'techno'];
  return pick(rng(seed + 9), forms);
}

export function defaultState() {
  const g = generate('hypnotic', 1337);
  const full = g.pattern;
  full.steps.clap = pad16([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  const s = {
    version: 1,
    bpm: 133,
    swing: 0.06,
    key: 9,
    scale: 'minor',
    current: 0,
    chainOn: false,
    chain: 'AABBCCCDEFGGGH',
    params: defaultParams(),
    master: defaultMaster(),
    mutes: {},
    solos: {},
    locks: {},
    patterns: arrangement(full, 1337, true),
  };
  applyOverrides(s, g, false);
  return s;
}

export function applyOverrides(state, g, withBpm = true) {
  for (const [tid, o] of Object.entries(g.params)) Object.assign(state.params[tid], o);
  Object.assign(state.master, g.master);
  if (withBpm) state.bpm = g.bpm;
  if (withBpm && g.swing != null) state.swing = g.swing;
}

const KEY = 'untergrund.v1';
export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return sanitize(JSON.parse(raw));
  } catch { return null; }
}

// Fill any missing fields so older/foreign saves don't break the app.
export function sanitize(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object' || !Array.isArray(s.patterns)) return d;
  const out = d;
  const safeNumber = (value, q) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(q.min, Math.min(q.max, n)) : q.def;
  };
  out.params = defaultParams();
  for (const id of TRACK_IDS) {
    const source = (s.params || {})[id] || {};
    for (const q of [...TRACK_BY_ID[id].params, ...MIX_PARAMS]) {
      if (source[q.id] != null) out.params[id][q.id] = safeNumber(source[q.id], q);
    }
  }
  out.master = defaultMaster();
  for (const q of MASTER_PARAMS) if ((s.master || {})[q.id] != null) out.master[q.id] = safeNumber(s.master[q.id], q);
  out.bpm = Math.max(40, Math.min(240, Number.isFinite(+s.bpm) ? +s.bpm : d.bpm));
  out.swing = Math.max(0, Math.min(.6, Number.isFinite(+s.swing) ? +s.swing : d.swing));
  out.key = Math.max(0, Math.min(11, Number.isFinite(+s.key) ? Math.round(+s.key) : d.key));
  out.current = Math.max(0, Math.min(7, Number.isFinite(+s.current) ? Math.round(+s.current) : 0));
  out.chainOn = !!s.chainOn;
  out.chain = String(s.chain || d.chain).toUpperCase().replace(/[^A-H]/g, '').slice(0, 128) || d.chain;
  out.mutes = Object.fromEntries(TRACK_IDS.map((id) => [id, !!s.mutes?.[id]]));
  out.solos = Object.fromEntries(TRACK_IDS.map((id) => [id, !!s.solos?.[id]]));
  out.locks = Object.fromEntries(TRACK_IDS.map((id) => [id, !!s.locks?.[id]]));
  out.scale = SCALES[s.scale] ? s.scale : 'minor';
  out.patterns = range(8, (i) => {
    const p = s.patterns[i];
    const e = emptyPattern();
    if (!p) return e;
    for (const id of TRACK_IDS) {
      if (Array.isArray(p.steps?.[id])) {
        e.steps[id] = pad16(p.steps[id]).map((v, j) => {
          if (id !== 'acid') return v === 2 ? 2 : v ? 1 : 0;
          const step = p.steps[id][j] || {};
          return {
            on: !!step.on,
            n: Math.max(-24, Math.min(24, Number.isFinite(+step.n) ? Math.round(+step.n) : 0)),
            a: !!step.a,
            s: !!step.s,
          };
        });
      }
      if (p.len?.[id]) e.len[id] = Math.max(1, Math.min(STEPS, p.len[id] | 0));
    }
    if (p.hook && Array.isArray(p.hook.s)) {
      const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));
      e.hook = {
        v: HOOK_VOICES.includes(p.hook.v) ? p.hook.v : 'pluck',
        o: Math.round(cl(p.hook.o, -1, 1)),
        s: range(32, (j) => { const x = p.hook.s[j]; return Array.isArray(x) ? [Math.round(cl(x[0], -24, 36)), Math.round(cl(x[1], 1, 16)), cl(x[2], 0, 1)] : 0; }),
        x: {
          space: cl(p.hook.x?.space ?? 0.4, 0, 1),
          risk: cl(p.hook.x?.risk ?? 0.4, 0, 1),
          feel: cl(p.hook.x?.feel ?? 0.4, 0, 1),
          warmth: cl(p.hook.x?.warmth ?? 0.5, 0, 1),
        },
      };
      e.hm = Math.round(cl(p.hm ?? 2, 0, 2));
    }
    if (Array.isArray(p.prog) && p.prog.length) e.prog = p.prog.slice(0, 8).map((c) => ({ r: Math.max(-12, Math.min(12, c?.r | 0)), c: Math.max(0, Math.min(10, c?.c | 0)) }));
    return e;
  });
  if (s.artist && typeof s.artist === 'object') {
    out.artist = {
      name: String(s.artist.name || 'UNTERGRUND').slice(0, 40),
      title: String(s.artist.title || 'Live Machine Set').slice(0, 80),
      style: STYLES[s.artist.style] ? s.artist.style : 'hypnotic',
      seed: Number.isFinite(+s.artist.seed) ? +s.artist.seed : 0,
      created: String(s.artist.created || '').slice(0, 40),
    };
  } else delete out.artist;
  return out;
}
