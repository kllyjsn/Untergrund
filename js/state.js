import { TRACK_IDS, TRACK_BY_ID, MIX_PARAMS, MASTER_PARAMS, STEPS, SCALES, defaultParams, defaultMaster } from './params.js';
import { rng } from './dsp.js';

export const STYLES = {
  hypnotic: { name: 'HYPNOTIC', bpm: [130, 134] },
  industrial: { name: 'INDUSTRIAL', bpm: [136, 142] },
  acid: { name: 'ACID', bpm: [132, 138] },
  dub: { name: 'DUB', bpm: [122, 127] },
  peak: { name: 'PEAK TIME', bpm: [142, 150] },
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
  const params = { kick: {}, acid: {}, stab: {}, perc: {}, ch: {}, oh: {}, ride: {}, clap: {} };
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
  }
  return { pattern: P, params, master, bpm };
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
