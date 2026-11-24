import { CHORDS } from './params.js';
import { rng } from './dsp.js';

// Relative to C; points are [sixteenth, length in sixteenths, semitones above the tonic].
const A = [
  [[2, 2, 4], [6, 2, 7], [8, 5, 9], [14, 1.8, 7]],
  [[0, 4, 4], [6, 2, 2], [10, 4, 4]],
  [[2, 2, 4], [6, 2, 6], [8, 5.4, 9]],
  [[0, 3.5, 11], [4, 1.6, 9], [6, 3, 6], [10, 4, 4]],
  [[1, 2.5, 5], [4, 1.7, 9], [6, 6, 12], [14, 1.7, 9]],
  [[0, 4.8, 11], [6, 2, 9], [10, 3.5, 7]],
  [[2, 2.5, 7], [6, 2, 11], [8, 5, 14]],
  [[0, 4, 13], [6, 3, 12], [10, 4.5, 7]],
  [[2, 2, 5], [6, 2, 9], [8, 5.5, 12], [14, 1.7, 9]],
  [[0, 3.2, 11], [4, 1.7, 9], [6, 3.2, 7], [10, 3.5, 4]],
  [[2, 3.3, 7], [6, 2.8, 4], [10, 4.7, 2]],
  [[0, 4.4, 4], [6, 2, 7], [8, 5.5, 10], [14, 1.6, 7]],
  [[2, 2, 9], [6, 2, 12], [8, 5.3, 16], [14, 1.8, 12]],
  [[0, 4.2, 8], [6, 2, 7], [8, 2.6, 5], [12, 2.3, 2]],
  [[0, 4.7, 4], [6, 2.6, 2], [10, 5.5, 0]],
  [[0, 6, 0]],
];

const B = [
  [[2, 4, 12], [8, 6, 16]],
  [[2, 2.6, 19], [6, 7, 17]],
  [[0, 3.3, 17], [4, 1.7, 15], [6, 5, 12]],
  [[2, 4, 14], [8, 5.4, 12], [14, 1.6, 10]],
  [[0, 4.4, 7], [6, 2, 10], [8, 6.2, 15]],
  [[2, 3, 17], [6, 2.8, 15], [10, 4, 14]],
  [[0, 3, 10], [4, 1.6, 7], [6, 5, 5]],
  [[2, 4, 13], [8, 3, 12], [12, 2.2, 10]],
  [[0, 4.8, 9], [6, 2, 5], [10, 4.5, 4]],
  [[2, 3, 5], [6, 2.8, 9], [10, 4, 12]],
  [[0, 4.5, 14], [6, 2, 12], [8, 5, 9]],
  [[1, 2.1, 8], [4, 1.6, 9], [6, 5, 6], [14, 1.8, 4]],
  [[0, 4.5, 5], [6, 2, 9], [8, 5.5, 12]],
  [[2, 2, 13], [6, 2, 10], [8, 3, 8], [12, 3, 5]],
  [[0, 5.5, 4], [8, 4.6, 2], [14, 1.8, 0]],
  [[2, 4.5, -1], [12, 2.8, 2]],
];

const SOLO = [
  [[3, 2.2, 7], [6, 5, 11]],
  [[2, 2.4, 9], [6, 1.6, 7], [8, 3.5, 4], [12, 2, 2]],
  [[4, 2, 6], [7, 2, 9], [10, 3.5, 12]],
  [[1, 1.8, 11], [4, 1.5, 9], [6, 2.5, 6], [10, 4, 4]],
  [[0, 2.3, 5], [3, 2.2, 7], [6, 2, 9], [8, 3, 14], [12, 2, 12]],
  [[0, 3.5, 11], [4, 1.7, 9], [6, 3.5, 7], [12, 2.5, 5]],
  [[2, 2, 4], [6, 2, 7], [8, 2.7, 11], [12, 2, 14]],
  [[0, 2.7, 15], [4, 1.5, 16], [6, 2.7, 17], [10, 4, 13]],
  [[0, 3.7, 12], [6, 2, 9], [8, 3.6, 5], [14, 1.5, 6]],
  [[0, 3.7, 7], [4, 1.6, 9], [6, 2, 11], [8, 4, 14], [14, 1.6, 16]],
  [[0, 5, 19], [6, 2, 16], [8, 5, 14]],
  [[2, 2, 10], [6, 2, 12], [8, 4, 16], [14, 1.7, 15]],
  [[0, 5, 16], [6, 2, 12], [10, 3.5, 9]],
  [[2, 2.5, 8], [6, 2.5, 7], [10, 3.6, 5]],
  [[0, 6, 4], [10, 4.7, 2]],
  [],
];

const SOLO_ANSWERS = {
  1: [[1, 2.6, 9], [4, 1.7, 11], [6, 3.4, 9], [12, 2.8, 4]],
  6: [[2, 2.6, 7], [6, 3.1, 4], [10, 4.5, 11]],
  12: [[0, 3.6, 12], [4, 1.5, 14], [6, 4, 16], [12, 2.8, 17]],
  15: [[6, 2, 4], [10, 4, 7]],
};

const HEAD = [[0, 9], [0, 18], [2, 13], [2, 13], [2, 2], [7, 14], [4, 1], [9, 15],
  [2, 2], [7, 14], [0, 9], [0, 13], [5, 9], [5, 19], [0, 18], [0, 18]];
const BRIDGE = [[5, 9], [5, 9], [5, 19], [10, 14], [3, 9], [3, 9], [4, 20], [9, 15],
  [2, 2], [2, 2], [2, 13], [2, 13], [2, 2], [7, 15], [0, 18], [7, 14]];
const INTRO = [[0, 18], [0, 9], [5, 9], [5, 19], [0, 18], [9, 15], [2, 2], [7, 14]];
const CODA = [[5, 9], [5, 19], [0, 18], [9, 15], [2, 2], [7, 14], [0, 18], [0, 18]];
const TAG = [A[12], A[13], A[14], [[6, 2, 1], [10, 3.5, 4]], A[4], A[9],
  [[0, 4.6, 4], [6, 3, 2], [10, 5, 0]], [[0, 9, 0]]];
const PARTS = {
  intro: [INTRO, [[], [], [], [], [], [], [[8, 2, 5], [12, 3.5, 9]], [[2, 5, 7], [10, 4, 2]]]],
  coda: [CODA, TAG], solo: [HEAD, SOLO], bridge: [BRIDGE, B], head: [HEAD, A], reprise: [HEAD, A],
  interlude: [BRIDGE, [[], [], [], [], B[4], B[5], [], [], B[8], [], B[10], B[11], B[12], B[13], B[14], []]],
};
export const BOSSA_PARTS = ['intro', 'coda', 'solo', 'solo', 'bridge', 'interlude', 'head', 'reprise'];
export const isBossaPart = (part) => Object.hasOwn(PARTS, part);
export const bossaChart = (part) => PARTS[part][0].map(([r, c]) => ({ r, c }));

export function bossaForm(length, bpm) {
  const run = (id, bars) => id.repeat(bars);
  if (length === 'sketch') return run('G', 8) + run('E', 8) + run('H', 8) + run('B', 8);
  return run('A', 8) + run('G', 16) + run('E', 16) + run('H', 16) + run('C', 16) +
    run('F', 16) + (bpm > 112 * 240 / 190 ? run('C', 16) : '') + run('H', 16) + run('B', 8);
}

const pc = (n) => ((n % 12) + 12) % 12;
function fit(n, h) {
  const tones = CHORDS[h.c].iv;
  for (let d = 0; d <= 6; d++) for (const p of d ? [n - d, n + d] : [n]) {
    if (tones.some((v) => pc(v + h.r) === pc(p))) return p;
  }
  return n;
}

export function bossaLine(part, bar, h, seed, turn = 0) {
  const [chart, melody] = PARTS[part], j = bar % chart.length;
  const [r, c] = chart[j], own = h.r === r && h.c === c;
  let phrase = melody[j];
  // The head is recognizable on return; only its pickups and answers change.
  if (part === 'reprise' && j === 1) phrase = [[0, 2.8, 4], [4, 1.7, 7], [6, 3.3, 9], [10, 4.8, 7]];
  if (part === 'reprise' && j === 15) phrase = [[0, 7.2, 0], [12, 2.8, 4]];
  if (part === 'solo' && ((seed >>> 5) + turn) % 3 !== 0) phrase = SOLO_ANSWERS[j] || phrase;
  const rVel = rng(seed ^ Math.imul(bar + 1 + turn * 16, 0x45d9f3b));
  const dynamic = part === 'solo' || part === 'interlude' ? 0.89 : part === 'reprise' ? 1.03 : 1;
  return phrase.map(([at, dur, n], i) => {
    const v = 0.46 + Math.min(dur, 6) * 0.049 + (i === 0 ? 0.06 : 0) + rVel() * 0.08;
    return [at, dur, own ? n : fit(n, h), v * dynamic];
  });
}

export function bossaPreview(part, seed, prog) {
  const notes = (role) => prog.slice(0, 8).flatMap((h, b) =>
    bossaLine(role, b, h, seed).map(([at, dur, n, v], i) => [16 * b + at, Math.round(dur), n, v, b >> 2, (b % 4) * 8 + i]));
  const n = notes(part);
  return { bars: 8, n, v: notes('solo'), b: notes('bridge') };
}

const shells = {
  1: [3, 7, 10], 2: [3, 10, 14], 9: [4, 11, 14], 13: [4, 10, 14], 14: [4, 10, 21],
  15: [4, 10, 20], 18: [4, 9, 14], 19: [3, 9, 14], 20: [3, 6, 10],
};

export function bossaGrip(h, key, { thumb, chord }) {
  const root = key + h.r;
  const bottom = thumb == null ? [] : [48 + pc(root + thumb - 48)];
  if (!chord) return bottom;
  const iv = CHORDS[h.c].iv, tones = shells[h.c] || iv.slice(1);
  let best, distance = Infinity;
  const notes = tones.map((v) => [53 + pc(root + v - 53), 65 + pc(root + v - 65)]);
  for (const grip of notes.reduce((rows, xs) => rows.flatMap((row) => xs.map((n) => [...row, n])), [[]])) {
    grip.sort((a, b) => a - b);
    const cost = grip.reduce((s, n, i) => s + Math.abs(n - (55 + i * 5)) + (n - grip[i - 1] === 1 ? 3 : 0), 0);
    if (cost < distance) { best = grip; distance = cost; }
  }
  return [...new Set([...bottom, ...best])].sort((a, b) => a - b);
}

export const BOSSA_KICK = [0, 3, 8, 11];
export const BOSSA_HAT = [0, 2, 4, 6, 8, 10, 12, 14];
export const BOSSA_BASS = [0, 6, 8, 14];

export function bossaRhythm(part, bar, step, boundary) {
  const odd = bar % 2 === 1, answer = bar % 4 === 3;
  const airy = (part === 'intro' || part === 'interlude') && bar < 4 || part === 'coda' && bar >= 6;
  const bridge = part === 'bridge' || part === 'interlude', solo = part === 'solo', turn = answer || boundary;
  const kicks = airy ? [] : bridge ? [0, 8] : odd ? [0, 8, 11] : [0, 3, 8];
  const hats = airy ? [] : bridge ? [2, 6, 10, 14] : odd && turn ? [...BOSSA_HAT, 15] : BOSSA_HAT;
  const rim = airy ? [] : bridge && odd ? [4, 10] : odd ? (turn ? [4, 10, 15] : [4, 10]) : [0, 6, 12];
  const chords = airy ? [0, 10] : bridge ? (odd ? [0, 6, 11] : [0, 6, 14]) :
    odd ? (turn ? [0, 3, 8, 14] : [0, 3, 8, 10, 14]) : [0, 3, 6, 10, 12];
  const thumb = step === 0 ? 0 : step === 8 && !airy ? 7 : null;
  return {
    kick: kicks.includes(step) ? (step % 8 === 0 ? 0.18 : 0.085) : 0,
    ch: hats.includes(step) ? ([2, 6, 10, 14].includes(step) ? 0.32 : step === 15 ? 0.14 : 0.21) : 0,
    snare: rim.includes(step) ? (step === 15 ? 0.13 : (step === 6 || step === 10 ? 0.29 : 0.24)) : 0,
    comp: chords.includes(step) ? (airy || bridge ? 0.57 : solo ? 0.46 : step === 3 || step === 10 ? 0.63 : 0.54) : 0,
    thumb, airy, turn,
  };
}

export function bossaPocket(id, bar, step, sd, seed) {
  const push = { kick: 0, acid: -0.03, ch: -0.016, snare: 0.09, thumb: -0.055, stab: 0.06, hook: 0.08 }[id];
  const drift = Math.sin((bar + (seed & 3)) * Math.PI / 4) * 0.017;
  const off = step % 2 ? 0.011 : step % 4 ? 0.026 : 0;
  return sd * (push + drift + off);
}
