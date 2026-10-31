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
    master.humanize = 0.25; master.warmth = 0.4;
    Object.assign(params.acid, { wave: 0.05, cutoff: 260, reso: 2, envmod: 0.12, decay: 0.4, drive: 0.1, accent: 0.2 });
    Object.assign(params.ride, { tone: 4200, decay: 0.6 });
    master.duck = 0.6; master.revLevel = 0.6;
    swing = 0.16;
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
    S.snare = pad16([0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2]).map((v, i) => v || ([7, 15].includes(i) && r() < 0.6 ? 1 : 0));
    S.clap = soul ? range(STEPS, () => 0) : pad16([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    S.ch = range(STEPS, (i) => (i % 2 === 0 ? (i % 4 === 0 ? 2 : 1) : (r() < 0.35 ? 1 : 0)));
    S.ride = soul && r() < 0.5 ? range(STEPS, (i) => (i % 4 === 0 || i % 4 === 3 ? 1 : 0)) : range(STEPS, () => 0);
    S.stab = pad16(pick(r, [[1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]]));
    S.acid = range(STEPS, (i) => (i % 4 === 0 || (i % 4 === 3 && r() < 0.5) ? { on: true, n: pick(r, [0, musicalScale[2], musicalScale[4], musicalScale[6] ?? 10]), a: i === 0, s: r() < 0.25 } : emptyAcidStep()));
    if (soul) S.vox = pad16([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    Object.assign(params.kick, { tune: 52, decay: soul ? 0.5 : 0.35, drive: soul ? 0.2 : 0.45, rumble: 0, punch: 0.55, click: soul ? 0.15 : 0.4 });
    Object.assign(params.snare, { tune: soul ? 200 : 170, snappy: soul ? 0.4 : 0.75, decay: 0.22 });
    Object.assign(params.ch, { decay: 0.05, tone: soul ? 3600 : 4800, level: 0.5 });
    Object.assign(params.ride, { tone: 3800, decay: 1.4 });
    Object.assign(params.stab, { voice: 1, chord: pick(r, soul ? [2, 9, 10, 7] : [1, 2, 7]), octave: 0, cutoff: soul ? 1500 : 1100, reso: 1, decay: 1.4, env: soul ? 0.35 : 0.2, detune: soul ? 14 : 6, rev: 0.3, dly: 0.1 });
    Object.assign(params.acid, { voice: 1, wave: 0.05, tune: -12, cutoff: 320, reso: 1, envmod: 0.1, decay: 0.5, drive: 0.1, accent: 0.15 });
    Object.assign(params.vox, { scatter: 0.6, melody: 0.8, length: 2, tone: 4500 });
    master.humanize = soul ? 0.9 : 0.6; master.warmth = soul ? 0.85 : 0.7;
    master.duck = 0.25; master.drive = soul ? 0.25 : 0.45; master.revLevel = 0.5;
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
  }
  return { pattern: P, params, master, bpm, swing };
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

// Turn one full pattern into an 8-pattern arrangement: intro → build → peak → breakdown → return.
export function arrangement(full, seed) {
  const strip = (p, keep) => {
    const q = clone(p);
    for (const id of TRACK_IDS) if (!keep.includes(id)) q.steps[id] = id === 'acid' ? range(STEPS, emptyAcidStep) : range(STEPS, () => 0);
    return q;
  };
  const all = TRACK_IDS;
  const without = (...ids) => all.filter((x) => !ids.includes(x));
  const fill = clone(full);
  fill.steps.snare = pad16([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2]);
  return [
    strip(full, ['kick', 'ch', 'perc']),
    strip(full, ['kick', 'ch', 'oh', 'perc', 'acid']),
    strip(full, without('stab')),
    mutate(fill, seed + 1),
    strip(full, ['ride', 'perc', 'stab', 'ch']),
    strip(full, ['ride', 'perc', 'stab', 'acid', 'oh']),
    clone(full),
    mutate(full, seed + 2),
  ];
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
    patterns: arrangement(full, 1337),
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
