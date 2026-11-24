import { CHORDS, TRACK_IDS, defaultParams } from './params.js';
import { rng } from './dsp.js';

export const FUNK_PROGS = [
  [[0, 16], [5, 14], [0, 16], [5, 14], [10, 13], [5, 14], [0, 16], [0, 16]],
  [[0, 15], [0, 15], [0, 15], [0, 15], [5, 14], [10, 13], [0, 15], [0, 15]],
  [[10, 13], [5, 14], [10, 13], [5, 14], [2, 16], [7, 14], [10, 13], [5, 14]],
];
export const FUNK_KICK = [[0, 3, 6, 10, 14], [0, 2, 7, 10, 15]];
export const FUNK_SNARE = [4, 7, 11, 12, 15];
export const FUNK_COMP = [[2, 7, 10, 15], [3, 6, 11, 14]];
const pc = (n) => (n % 12 + 12) % 12;
const near = (notes, n) => notes.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a);

export function funkBass(key, h, bar) {
  const root = 28 + pc(key + h.r - 28), iv = CHORDS[h.c].iv;
  const fifth = iv.includes(7) ? 7 : iv.includes(6) ? 6 : 0;
  return (bar % 2 ? [[0, 1.5, 0, 0.9], [3, 0.45, 0, 0.3], [6, 1.4, 12, 0.8], [8, 1.6, 0, 0.88], [11, 0.45, fifth, 0.3], [14, 1.2, 10, 0.7]] :
    [[0, 1.8, 0, 0.9], [3, 1.2, 12, 0.8], [6, 0.45, 0, 0.3], [8, 1.5, fifth, 0.85], [10, 1.3, 10, 0.72], [15, 0.5, 12, 0.5]])
    .map(([at, dur, n, v]) => [at, dur, root + n, v]);
}

export function funkNotes(seed, bar, h, solo) {
  const r = rng(seed ^ Math.imul((solo ? bar + 47 : bar % 8) + 1, 0x45d9f3b));
  const rhythms = [[0, 3, 6], [1, 4, 8], [0, 3, 7, 8], []];
  const at = bar % 4 === 3 && solo ? [1, 5, 8] : rhythms[bar % 4];
  const iv = CHORDS[h.c].iv, mode = iv.includes(3) || h.c === 15 ? [0, 3, 5, 6, 7, 10, 12, 15] : [0, 2, 4, 5, 7, 9, 10, 12, 14];
  const tones = iv.map((n) => n % 12).concat(iv.map((n) => n % 12 + 12)).filter((n) => n <= 19);
  return at.map((step, i) => [step, Math.min(2.2, (at[i + 1] ?? 11) - step - 0.2), h.r + near(step % 4 === 0 ? tones : mode, [7, 10, 12, 7][i] + (solo && r() > 0.7 ? 3 : 0)), 0.7 + r() * 0.1]);
}

export function generateFunk(seed, bpm, palette, pocket, choose = null) {
  const r = rng(seed), params = defaultParams(), master = {};
  const ensemble = palette[Math.floor(rng(Math.imul((seed | 0) ^ 0x6d2b79f5, 0x85ebca6b))() * palette.length)];
  const roll = r(), prog = choose ? choose(roll) : FUNK_PROGS[Math.floor(roll * FUNK_PROGS.length)].map(([r, c]) => ({ r, c }));
  const steps = Object.fromEntries(TRACK_IDS.map((id) => [id, Array.from({ length: 16 }, (_, i) => id === 'acid' ? { on: funkBass(0, prog[0], 0).some(([at]) => at === i), n: 0, a: false, s: false } : 0)]));
  for (const i of FUNK_KICK[0]) steps.kick[i] = 1;
  for (const i of FUNK_SNARE) steps.snare[i] = i % 8 === 4 ? 2 : 1;
  for (let i = 0; i < 16; i++) if (i !== 6 && i !== 14) steps.ch[i] = 1;
  for (const i of [6, 14]) steps.oh[i] = 1;
  for (const i of FUNK_COMP[0]) steps.stab[i] = 1;
  Object.assign(master, { kit: 1, swing8: 0, duck: 0, drive: 0.02, dust: 0, arr: 0, vary: 0.4, pocket, humanize: 0.08, room: 0.14, revLevel: 0.22, dlyLevel: 0 });
  Object.assign(params.stab, { voice: 1, chord: prog[0].c, octave: 0, level: 0.65, decay: +(ensemble[3] * (0.98 + rng(Math.imul(seed ^ 0x4e67c6a7, 0x85ebca6b))() * 0.04)).toFixed(3), env: 0.12, cutoff: 1700, detune: 0.6, dly: 0, rev: 0.08, reso: 0.5 });
  Object.assign(params.acid, { voice: 5, level: 0.8, tune: 0, decay: 0.12, cutoff: 1700, drive: 0, dly: 0, rev: 0.02 });
  Object.assign(params.kick, { level: 0.7, drive: 0, dly: 0, rev: 0.03 });
  Object.assign(params.snare, { level: 0.65, decay: 0.22, tone: 4000, snappy: 0.32, dly: 0, rev: 0.06 });
  Object.assign(params.ch, { level: 0.35, decay: 0.045, tone: 4200, dly: 0, rev: 0.02 });
  Object.assign(params.oh, { level: 0.22, decay: 0.14, tone: 4000, dly: 0, rev: 0.03 });
  for (const id of ['ride', 'clap', 'perc', 'vox']) params[id].level = 0;
  const part = (solo) => Array.from({ length: 8 }, (_, bar) => funkNotes(seed, bar, prog[Math.floor(bar / 2) % prog.length], solo).map(([at, dur, n, v], i) => [16 * bar + at, Math.round(dur), n, v, Math.floor(bar / 4), bar % 4 * 8 + i])).flat();
  const m = { bars: 8, n: part(false), v: part(true), b: part(true) }, preview = Array(32).fill(0);
  for (const [at, dur, n, v] of m.n) if (at < 32) preview[at] = [n, dur, v];
  return { pattern: { jazz: { style: 'jazzfunk', seed }, steps, len: Object.fromEntries(TRACK_IDS.map((id) => [id, 16])), prog, hook: { v: 'tpt', o: 0, s: preview, m, x: { feel: 0.15, risk: 0, space: 0.5, warmth: 0.75 } }, hm: 2 }, params, master, bpm, key: Math.floor(r() * 12), swing: 0.15, scale: prog[0].c === 16 ? 'dorian' : 'mixolydian' };
}
