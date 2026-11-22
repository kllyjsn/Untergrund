import { CHORDS, TRACK_IDS, defaultParams } from './params.js';
import { rng } from './dsp.js';

export const FUNK_PROGS = [
  [[0, 16], [5, 14], [0, 16], [5, 14], [8, 9], [7, 15], [0, 16], [10, 13]],
  [[2, 2], [7, 14], [2, 2], [7, 14], [4, 2], [9, 15], [2, 2], [7, 5]],
  [[0, 16], [5, 13], [0, 16], [5, 13], [3, 9], [2, 2], [1, 9], [0, 16]],
];
export const FUNK_KICK = [[0, 3, 6, 10, 14], [0, 2, 7, 10, 15], [0, 3, 8, 10], [0, 6, 9, 14], [0, 6, 10, 13], [0, 3, 7, 12], [0, 2, 8, 11], [0, 7, 10, 14]];
export const FUNK_SNARE = [4, 7, 11, 12, 15];
export const FUNK_COMP = [[2, 6, 10, 14], [2, 7, 10, 14], [3, 6, 10, 15], [2, 6, 11, 14]];
export const FUNK_GUITAR = [1, 3, 5, 7, 9, 11, 13, 15];
const pc = (n) => (n % 12 + 12) % 12;
const near = (notes, n) => notes.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a);
const choose = (r, xs) => xs[Math.floor(r() * xs.length)];
const headPhrases = new Map();

function funkHead(seed, rhythm, tones, passing, top, shape, variation) {
  const id = JSON.stringify([seed, rhythm.map(([at]) => at), tones, passing, top, shape, variation]);
  if (headPhrases.has(id)) return headPhrases.get(id);
  const cells = [[5, 2, 4, 1, 5, 1], [4, 1, 3, 0, 4, 2], [2, 5, 3, 1, 4, 1], [5, 3, 0, 2, 4, 1], [3, 0, 4, 1, 3, 1], [4, 2, 5, 1, 4, 2]];
  const cell = cells[shape], count = rhythm.length, paths = [];
  for (const width of [64, 256]) {
    for (let leap = Math.ceil(count / 2); leap <= count - 3; leap++) {
      let beam = [{ notes: [], cost: 0 }];
      for (let i = 0; i < count; i++) {
        const target = i < leap ? top - 8 + cell[i % cell.length] : top - 2 * (i - leap);
        const pool = (i === 0 || rhythm[i][0] % 4 === 0 ? tones : passing).filter((m) => m <= top);
        const next = [];
        for (const path of beam) for (const n of pool) {
          const prev = path.notes.at(-1), d = n - prev;
          if (i && (i === leap ? d < 5 || d > 9 : Math.abs(d) < 1 || Math.abs(d) > 4)) continue;
          if (i > leap && i <= leap + 2 && (d > -1 || d < -3)) continue;
          if (i < leap && n > top - 2) continue;
          if (i === leap && Math.min(...path.notes, n) > n - 7) continue;
          next.push({ notes: [...path.notes, n], cost: path.cost + (n - target) ** 2 });
        }
        beam = next.sort((a, b) => a.cost - b.cost).slice(0, width);
      }
      for (const path of beam) {
        const intervals = path.notes.slice(1).map((n, i) => Math.abs(n - path.notes[i])).sort((a, b) => a - b);
        const mid = (intervals[(intervals.length - 1) >> 1] + intervals[intervals.length >> 1]) / 2;
        if (mid >= 2 && mid <= 3 && intervals[intervals.length >> 1] <= 3) paths.push(path);
      }
    }
    if (paths.length) break;
  }
  if (!paths.length) {
    let previous;
    const notes = rhythm.map(([at], i) => {
      const pool = (i === 0 || at % 4 === 0 ? tones : passing).filter((m) => m <= top);
      const moving = pool.filter((m) => m !== previous && (previous == null || Math.abs(m - previous) <= 5));
      previous = near(moving.length ? moving : pool, top - 8 + cell[i % cell.length]);
      return previous;
    });
    paths.push({ notes, cost: 0 });
  }
  const ranked = paths.sort((a, b) => a.cost - b.cost), opening = ranked[0].notes;
  const endings = ranked.filter((p) => p.notes.slice(0, 4).every((n, i) => n === opening[i]) && p.notes.some((n, i) => i >= 4 && n !== opening[i]));
  const notes = variation && endings.length ? endings[(variation - 1) % endings.length].notes : opening;
  if (headPhrases.size >= 256) headPhrases.delete(headPhrases.keys().next().value);
  headPhrases.set(id, notes);
  return notes;
}

export function funkGroove(seed, bar, solo = false) {
  const r = rng(seed ^ Math.imul(Math.floor(bar / 2) + 1, 0x45d9f3b));
  const kick = [...FUNK_KICK[2 * Math.floor(r() * 4) + bar % 2]];
  const touch = rng(seed ^ Math.imul(bar + 1, 0x27d4eb2d));
  const fill = bar % 4 === 3, big = bar % 8 === 7;
  if (fill) kick.push(choose(touch, big ? [13, 14, 15] : [11, 15]));
  const ghosts = choose(touch, [[1, 7], [3, 11], [7, 15], [1, 9, 15]]);
  const snare = [4, 12, ...ghosts];
  if (fill) snare.push(...choose(touch, big ? [[10, 13, 14, 15], [11, 14, 15], [9, 10, 13, 15]] : [[13, 15], [10, 15], [11, 14]]));
  const comp = [...choose(touch, FUNK_COMP)].filter((at, k) => !solo || k === 0 || touch() > 0.3);
  const oh = touch() < (fill ? 0.85 : 0.4) ? [choose(touch, [14, 15])] : [];
  const ch = Array.from({ length: 16 }, (_, i) => i).filter((i) => !oh.includes(i) && !(big && i >= 14));
  const guitar = FUNK_GUITAR.filter((i) => !comp.includes(i) && touch() > 0.22);
  const chank = [6, 14].filter((i) => !comp.includes(i) && touch() < 0.45);
  return { kick: [...new Set(kick)].sort((a, b) => a - b), snare: [...new Set(snare)].sort((a, b) => a - b), ch, oh, comp, guitar, chank, fill, big };
}

export function funkBass(key, h, bar, seed = 0, next = h) {
  const root = 28 + pc(key + h.r - 28), iv = CHORDS[h.c].iv;
  const fifth = iv.includes(7) ? 7 : iv.includes(6) ? 6 : 0, third = iv.includes(3) ? 3 : iv.includes(4) ? 4 : 5;
  const r = rng(seed ^ Math.imul(bar + 1, 0x85ebca6b)), groove = funkGroove(seed, bar);
  const notes = new Map(groove.kick.map((at) => [at, [at, at === 0 ? 1.8 : 1.1, root + (at === 0 ? 0 : choose(r, [0, fifth, iv.includes(11) ? 11 : 10, third])), at === 0 ? 0.9 : 0.72 + r() * 0.12]]));
  const pop = choose(r, bar % 2 ? [3, 7, 11] : [3, 9, 13]);
  notes.set(pop, [pop, 0.65, root + 12, 0.78]);
  for (const at of choose(r, [[1, 11], [5, 15], [7, 13]])) if (!notes.has(at)) notes.set(at, [at, 0.22, root, 0.26 + r() * 0.03]);
  if (bar % 2) {
    const target = 28 + pc(key + next.r - 28), direction = target >= root ? -1 : 1;
    const at = groove.kick.includes(15) ? 15 : 14;
    notes.set(at, [at, 0.6, target + direction, 0.56]);
    if (groove.big) notes.set(13, [13, 0.4, target + 2 * direction, 0.42]);
  }
  if (![...notes.values()].some((n) => n[3] < 0.3)) {
    const at = choose(r, [1, 3, 5, 7, 9, 11, 13, 15].filter((n) => !notes.has(n)));
    notes.set(at, [at, 0.22, root, 0.27]);
  }
  return [...notes.values()].sort((a, b) => a[0] - b[0]).map((n, i, ns) => [n[0], Math.min(n[1], (ns[i + 1]?.[0] ?? 16) - n[0] - 0.08), n[2], n[3]]);
}

export function funkNotes(seed, bar, h, solo = false, { headOut = false, sectionBars = 48, key = 0 } = {}) {
  const phase = bar % 16, pair = Math.floor(phase / 2), chorus = Math.floor(bar / 16);
  const r = rng(seed ^ Math.imul(pair + 1, 0x45d9f3b));
  const motifs = [
    [[2, 1], [3, 1], [4, 6], [10, 1], [11, 1], [12, 2], [14, 7], [21, 3], [24, 4], [28, 2]],
    [[1, 1], [2, 1], [3, 5], [8, 2], [10, 1], [11, 1], [12, 2], [14, 8], [22, 2], [24, 5]],
    [[2, 1], [3, 1], [4, 7], [11, 1], [12, 2], [14, 6], [20, 4], [24, 2], [26, 3]],
    [[0, 4], [4, 2], [6, 1], [7, 1], [8, 6], [14, 6], [20, 2], [22, 2], [24, 5]],
    [[3, 1], [4, 4], [8, 3], [11, 1], [12, 2], [14, 7], [21, 1], [22, 2], [24, 6]],
    [[1, 1], [2, 2], [4, 6], [10, 2], [12, 3], [15, 7], [22, 2], [24, 4], [28, 3]],
    [[0, 6], [6, 1], [7, 1], [8, 4], [12, 2], [14, 8], [22, 4], [26, 3]],
    [[2, 2], [4, 4], [8, 2], [10, 1], [11, 1], [12, 3], [15, 5], [20, 4], [24, 7]],
  ];
  let mixed = Math.imul(seed ^ seed >>> 16, 0x7feb352d);
  mixed = Math.imul(mixed ^ mixed >>> 15, 0x846ca68b);
  const plan = rng(mixed ^ mixed >>> 16 ^ 0x735a2d97);
  const theme = Math.floor(plan() * motifs.length * 4), answer = 1 + Math.floor(plan() * 3);
  const contrast = Math.floor(plan() * 3), cadence = plan() < 0.5;
  const crest = [22, 24, 26][Math.floor(plan() * 3)];
  const shape = Math.floor(plan() * 6), motif = motifs[theme % motifs.length].map((n) => [...n]);
  if (theme & 8) motif[0][0] += motif[0][0] ? -1 : 1;
  if (theme & 16) motif.at(-1)[0]--;
  let rhythm = motif.map((n) => [...n]), peak = false;
  if (pair % 2 || phase >= 4 && phase < 8) {
    const at = rhythm.length - 2;
    if (answer === 1) rhythm[at][0]++;
    else if (answer === 2) rhythm[at][0]--;
    else rhythm[at][0] = Math.ceil((rhythm[at - 1][0] + rhythm[at][0]) / 2);
    rhythm[at][0] = Math.max(rhythm[at - 1][0] + 1, Math.min(rhythm[at + 1][0] - 1, rhythm[at][0]));
  }
  if (solo) {
    const peakBar = sectionBars - 4;
    if (bar > peakBar || bar >= sectionBars - 2) return [];
    peak = bar === peakBar;
    if (peak) rhythm = [[bar % 2 * 16, 18]];
    else if (chorus === 0) {
      const sparse = rhythm.filter((_, i) => i % 2 === 0 || i === rhythm.length - 1);
      if (sparse.length < Math.ceil(rhythm.length * 0.6)) sparse.splice(1, 0, rhythm[1]);
      rhythm = sparse;
    }
    else if (chorus >= 2) {
      const extra = Math.floor(rhythm.length / 2);
      const gaps = [3, 7, 11, 15, 19, 23, 27, 9, 17].filter((at) => at > rhythm[0][0] && at < rhythm.at(-1)[0] && !rhythm.some(([n]) => n === at));
      rhythm.push(...gaps.slice(0, extra).map((at) => [at, 0.8]));
      rhythm.sort((a, b) => a[0] - b[0]);
    }
  } else if (phase >= 12) {
    rhythm = rhythm.filter(([at]) => at < 16);
    if (headOut !== cadence) rhythm = rhythm.filter((_, i) => i !== rhythm.length - 2);
    rhythm.push([16, 18]);
    if (phase >= 14) return [];
  } else if (phase >= 8) rhythm = rhythm.filter((_, i) => i !== 1 + contrast && i !== 5 + contrast);
  const iv = CHORDS[h.c].iv;
  const mode = iv.includes(3) ? [0, 2, 3, 5, 7, 9, 10] : iv.includes(11) ? [0, 2, 4, headOut ? 5 : 6, 7, 9, 11] : h.c === 15 ? [0, 1, 3, 4, 6, 8, 10] : [0, 2, 4, 5, 7, 9, 10];
  const register = Array.from({ length: 12 }, (_, i) => 69 + i);
  const tones = register.filter((m) => iv.some((n) => pc(m - key - h.r) === pc(n)));
  const passing = register.filter((m) => mode.includes(pc(m - key - h.r)));
  const colors = register.filter((m) => tones.includes(m) || mode.includes(pc(m - key - h.r)) && [0, 2, 7, 9, iv.includes(3) ? 5 : 6, ...(h.c === 15 ? [1, 3, 8] : [])].includes(pc(m - key - h.r)));
  const head = solo ? null : funkHead(seed, phase < 8 ? motif : rhythm, colors, passing, headOut && phase >= 8 && phase < 12 ? 80 : 78, shape, (phase >= 4 && phase < 8 ? 1 : 0) + (headOut ? 2 : 0));
  const lift = solo ? Math.min(2, chorus) * 0.5 : phase >= 8 && phase < 12 ? headOut ? 3 : 1 : 0;
  const top = headOut && phase >= 8 && phase < 12 ? 80 : 78;
  const home = (solo ? 69 : 71) + lift + (pair % 2 ? 3 : 0), apex = pair % 2 ? 14 : crest;
  let previous;
  const notes = rhythm.map(([at, dur], index) => {
    const step = at % 16, strong = step % 4 === 0 || dur >= 4;
    const arc = at <= apex ? at / apex : Math.max(0, (32 - at) / (32 - apex));
    const target = Math.min(top, home + 5 * arc);
    let pool = (strong ? tones : passing).filter((m) => m <= top);
    if (previous != null) {
      const close = pool.filter((m) => Math.abs(m - previous) <= 5);
      if (close.length) pool = close;
    }
    let n = near(pool, target);
    if (solo && chorus > 0 && !strong && step % 4 === 3 && rhythm[index + 1]?.[0] === at + 1)
      n = Math.max(69, near(tones.filter((m) => m <= top), target) - 1);
    else if (!strong && dur <= 1 && r() < (headOut ? 0.3 : 0.12)) {
      const blue = register.filter((m) => m <= top && pc(m - key - h.r) === (iv.includes(3) ? 6 : 3) && Math.abs(m - n) <= 2);
      if (blue.length) n = near(blue, n);
    }
    if (head) n = head[index];
    previous = n;
    if (!peak && (solo || phase < 12 || index < rhythm.length - 1)) {
      const end = rhythm[index + 1]?.[0] ?? 32 + motif[0][0] - (pair % 2 ? 4 : 2);
      dur = end - at;
    }
    const length = solo && !peak ? Math.min(dur, (sectionBars - 4 - bar) * 16 - step) : dur;
    const envelope = Math.sin(Math.PI * (at + 2) / 34);
    return [at, length, n - 60 - (key > 6 ? key - 12 : key), peak ? 0.92 : 0.61 + 0.2 * Math.max(0, envelope) + r() * 0.035];
  });
  return notes.filter(([at, length]) => Math.floor(at / 16) === bar % 2 && length > 0).map(([at, ...note]) => [at % 16, ...note]);
}

export function generateFunk(seed, bpm, palette, pocket) {
  const r = rng(seed), params = defaultParams(), master = {};
  const ensemble = palette[Math.floor(rng(Math.imul((seed | 0) ^ 0x6d2b79f5, 0x85ebca6b))() * palette.length)];
  const prog = FUNK_PROGS[Math.floor(r() * FUNK_PROGS.length)].map(([r, c]) => ({ r, c }));
  const steps = Object.fromEntries(TRACK_IDS.map((id) => [id, Array.from({ length: 16 }, (_, i) => id === 'acid' ? { on: funkBass(0, prog[0], 0).some(([at]) => at === i), n: 0, a: false, s: false } : 0)]));
  for (const i of FUNK_KICK[0]) steps.kick[i] = 1;
  for (const i of FUNK_SNARE) steps.snare[i] = i % 8 === 4 ? 2 : 1;
  for (let i = 0; i < 16; i++) steps.ch[i] = 1;
  steps.oh[14] = 1;
  for (const i of FUNK_COMP[0]) steps.stab[i] = 1;
  for (const i of FUNK_GUITAR) steps.perc[i] = 1;
  Object.assign(master, { kit: 1, swing8: 0.5, duck: 0, drive: 0.02, dust: 0, arr: 0, vary: 0.4, pocket, humanize: 0.08, room: 0.14, revLevel: 0.22, dlyLevel: 0 });
  Object.assign(params.stab, { voice: 1, chord: prog[0].c, octave: 0, level: 0.65, decay: +(ensemble[3] * (0.98 + rng(Math.imul(seed ^ 0x4e67c6a7, 0x85ebca6b))() * 0.04)).toFixed(3), env: 0.12, cutoff: 1700, detune: 0.6, dly: 0, rev: 0.08, reso: 0.5 });
  Object.assign(params.acid, { voice: 5, level: 0.8, tune: 0, decay: 0.12, cutoff: 1700, drive: 0, dly: 0, rev: 0.02 });
  Object.assign(params.kick, { level: 0.7, drive: 0, dly: 0, rev: 0.03 });
  Object.assign(params.snare, { level: 0.65, decay: 0.22, tone: 6500, snappy: 0.5, dly: 0, rev: 0.06 });
  Object.assign(params.ch, { level: 0.35, decay: 0.045, tone: 6500, dly: 0, rev: 0.02 });
  Object.assign(params.oh, { level: 0.22, decay: 0.14, tone: 6500, dly: 0, rev: 0.03 });
  Object.assign(params.perc, { level: 0.48, pan: 0.45, dly: 0, rev: 0.04 });
  for (const id of ['ch', 'oh']) params[id].pan = 0.25;
  params.stab.pan = -0.15;
  for (const id of ['kick', 'snare', 'acid']) params[id].pan = 0;
  for (const id of ['ride', 'clap', 'vox']) params[id].level = 0;
  const part = (solo) => Array.from({ length: 8 }, (_, bar) => funkNotes(seed, bar, prog[Math.floor(bar / 2) % prog.length], solo).map(([at, dur, n, v], i) => [16 * bar + at, Math.round(dur), n, v, Math.floor(bar / 4), bar % 4 * 8 + i])).flat();
  const m = { bars: 8, n: part(false), v: part(true), b: part(true) }, preview = Array(32).fill(0);
  for (const [at, dur, n, v] of m.n) if (at < 32) preview[at] = [n, dur, v];
  return { pattern: { jazz: { style: 'jazzfunk', seed }, steps, len: Object.fromEntries(TRACK_IDS.map((id) => [id, 16])), prog, hook: { v: 'tpt', o: 0, s: preview, m, x: { feel: 0.15, risk: 0, space: 0.5, warmth: 0.75 } }, hm: 2 }, params, master, bpm, key: Math.floor(r() * 12), swing: 0.15, scale: prog[0].c === 16 ? 'dorian' : 'major' };
}
