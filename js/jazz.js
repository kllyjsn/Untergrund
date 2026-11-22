import { CHORDS, defaultParams, TRACK_IDS } from './params.js';
import { rng } from './dsp.js';
import { generateFunk, funkNotes, FUNK_PROGS } from './jazzfunk.js';

export const isJazz = (style) => style === 'swing' || style === 'modal' || style === 'bossa' || style === 'jazzfunk';
export const JAZZ_MIX = {
  jazzfunk: { lead: 8, comp: 6.5, bass: 0.5, kick: -4.5, snare: 6.5, hat: 26.5, oh: 20, output: -0.65 },
  bossa: { lead: 2, trumpetLead: 14.3, comp: 7, nylonComp: 1.5, guitarComp: 3.2, pianoComp: 4.5, bass: 1, guitarBass: 3.5, pianoBass: 4.5, hat: 24, rim: 12, output: -2, guitarOutput: -2.5, pianoOutput: -4.25 },
  swing: { lead: 6, comp: -1.5, bass: -4, ride: 15.5, hat: 16, output: -2 },
  modal: { lead: 8, comp: -2, bass: -2, ride: 17.5, hat: 16, output: -2 },
};
export const jazzStyle = (s, pattern = s.patterns?.[s.current || 0]) => pattern ? (isJazz(pattern.jazz?.style) ? pattern.jazz.style : null) : (isJazz(s.artist?.style) ? s.artist.style : null);
const RESONANCES = {
  tpt: { 57: [2645, 30, -7], 60: [2616, 30, -7], 63: [2795, 30, -7], 67: [2745, 30, -8], 70: [[2795, 30, -9], [2336, 50, -12]], 74: [2910, 30, -10], 77: [2790, 30, -12], 81: [2643, 30, -10] },
  fl: { 60: [2619, 35, -12], 64: [2636, 35, -16], 69: [[2644, 40, -18], [3088, 60, -14]], 72: [[2623, 35, -33], [3151, 50, -16]], 76: [2640, 30, -9], 81: [2650, 30, -8], 84: [3140, 30, -8] },
  flb: { 60: [2910, 30, -6], 64: [2625, 30, -8], 69: [2640, 30, -10], 72: [2620, 30, -8], 76: [2640, 30, -9], 81: [2643, 30, -8], 84: [3140, 30, -8] },
  jazz: { 63: [3126, 32, -14], 66: [2967, 32, -12], 69: [2640, 32, -10] },
};
export function jazzNotches(kind, center, rate = 1) {
  const peak = RESONANCES[kind]?.[Math.round(center)];
  return peak && Number.isFinite(rate) && rate > 0 ? (Array.isArray(peak[0]) ? peak : [peak]).map(([freq, q, db]) => [freq * rate, q, db]) : [];
}
export const JAZZ_PROGS = {
  jazzfunk: FUNK_PROGS,
  bossa: [
    [[0, 9], [2, 13], [2, 2], [1, 13]],
    [[0, 18], [9, 2], [2, 2], [7, 14]],
    [[0, 9], [11, 13], [10, 9], [9, 13], [2, 2], [7, 13], [0, 18], [7, 14]],
  ],
  swing: [
    [[2, 1], [7, 14], [0, 7], [0, 18]],
    [[0, 18], [9, 1], [2, 1], [7, 15]],
    [[2, 20], [7, 15], [0, 2], [0, 19]],
    [[0, 13], [5, 13], [0, 13], [7, 14]],
  ],
  modal: [
    [[0, 17], [0, 17], [1, 17], [1, 17], [0, 17], [0, 17], [1, 17], [1, 17]],
    [[0, 16], [0, 17], [5, 13], [5, 13], [0, 17], [0, 17], [1, 5], [0, 17]],
  ],
};
const pc = (n) => ((n % 12) + 12) % 12;
const near = (notes, to) => notes.reduce((a, n) => Math.abs(n - to) < Math.abs(a - to) ? n : a);
const pitches = (root, iv, lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((n) => iv.some((v) => pc(root + v) === pc(n)));

export function jazzHarmony(pat, bar) {
  const prog = pat.prog || [];
  const span = pat.jazz?.progBars === 1 ? 1 : pat.jazz?.style === 'modal' ? 4 : pat.jazz?.style === 'jazzfunk' ? 2 : 1;
  return prog.length ? prog[Math.floor(bar / span) % prog.length] : { r: 0, c: 17 };
}

export function jazzVoicing(h, key, style) {
  const iv = CHORDS[h.c].iv;
  if (style === 'jazzfunk') {
    const tones = h.c === 16 ? [3, 10, 14, 17] : iv.includes(4) ? [4, iv.includes(11) ? 11 : 10, iv.includes(15) ? 15 : 14, iv.includes(21) ? 21 : iv.includes(20) ? 20 : 7] : iv.includes(3) ? [3, 7, 10, 14] : [5, 7, 10];
    const candidates = tones.flatMap((n) => [48, 60, 72].map((oct) => oct + pc(key + h.r + n))).filter((n) => n >= 67 && n <= 79);
    const top = near(candidates, 73);
    return tones.map((n) => top - pc(top - key - h.r - n)).sort((a, b) => a - b);
  }
  const shape = style === 'jazzfunk' && h.c === 16 ? [3, 10, 17] : style === 'bossa' && h.r === 2 && h.c === 13 ? [4, 10, 18] : style === 'modal' && h.c === 17 || h.c === 5 ? iv :
    iv.includes(4) ? [4, iv.includes(11) ? 11 : iv.includes(10) ? 10 : 9, iv.includes(21) ? 21 : iv.includes(15) ? 15 : 14] :
      [3, iv.includes(9) ? 9 : 10, iv.includes(6) ? 6 : 14];
  let notes = shape.map((n) => 48 + key + h.r + n).sort((a, b) => a - b);
  while (notes.at(-1) > 76) notes = notes.map((n) => n - 12);
  while (notes[0] < 48) notes = notes.map((n) => n + 12);
  return style === 'bossa' ? notes.map((n) => n > 72 ? n - 12 : n).sort((a, b) => a - b) : notes;
}

export function jazzBass(style, key, h, next, bar) {
  const root = near(pitches(key + h.r, [0], 28, 43), 35);
  const target = near(pitches(key + next.r, [0], 28, 43), 35);
  const tones = pitches(key + h.r, CHORDS[h.c].iv, 28, 50);
  const direction = target >= root ? 1 : -1;
  const second = near(tones.filter((n) => n !== root), root + direction * 2);
  const middle = style === 'modal' ? [near(tones, root + 7), near(tones, root + (bar % 4 === 2 ? 10 : 12))] :
    [second, near(tones.filter((n) => n !== second), (root + target) / 2 + direction * 2)];
  const approach = target === 28 ? 29 : target + (bar % 2 ? 1 : -1);
  return [root, ...middle, approach];
}

export const BOSSA_RIM = [[0, 6, 12], [4, 10]];
export const BOSSA_BATIDA = [[0, 3, 6, 10, 12], [0, 3, 8, 10, 14]];
export const jazzChordTones = (style, h) => style === 'bossa' ? [...CHORDS[h.c].iv, 7] : CHORDS[h.c].iv;
export function bossaBass(key, h, next) {
  const root = near(pitches(key + h.r, [0], 28, 43), 35);
  const fifth = near(pitches(key + h.r, [7], 28, 50), root + 7);
  const target = near(pitches(key + next.r, [0], 28, 43), 35);
  return [[0, 5.5, root, 0.78], [6, 1.5, fifth, 0.6], [8, 5.5, fifth, 0.72], [14, 1.75, target, 0.58]];
}

export function jazzNotes(style, seed, bar, h, solo = false) {
  if (style === 'jazzfunk') return funkNotes(seed, bar, h, solo);
  if (style === 'bossa') {
    const r = rng(seed ^ Math.imul((solo ? bar + 31 : bar % 8) + 1, 0x45d9f3b));
    const rhythms = [[0, 6], [2, 8], [0], []], at = rhythms[bar % 4];
    const chord = pitches(h.r, CHORDS[h.c].iv, 0, 19);
    const mode = pitches(h.r, CHORDS[h.c].iv.includes(3) ? [0, 2, 3, 5, 7, 9, 10] : [0, 2, 4, 6, 7, 9, CHORDS[h.c].iv.includes(10) ? 10 : 11], 0, 19);
    let last = near(chord, 7 + bar % 3);
    return at.map((step, i) => {
      const n = near(step % 8 === 0 ? chord : mode, last + (solo && bar % 8 === 5 ? 9 : i ? 2 : -1)); last = n;
      return [step, Math.min(16 - step, (at[i + 1] ?? 15) - step - 0.5), n, 0.56 + r() * 0.1];
    });
  }
  const r = rng((seed | 0) ^ Math.imul((solo ? bar + 97 : bar % 8) + 1, 0x45d9f3b));
  const rhythms = style === 'modal' ? [[0, 8], [2, 10], [0], []] : [[0, 2, 4, 6, 8, 10, 14], [0, 2, 6, 8, 10], [2, 4, 6, 8, 10, 14], [0, 2, 6]];
  const at = [...rhythms[bar % 4]];
  if (solo && style === 'swing' && bar % 4 === 1) at.push(12, 14);
  if (solo && style === 'modal' && bar % 4 === 3) at.push(2, 8);
  const iv = CHORDS[h.c].iv, chord = pitches(h.r, iv, 0, 19);
  const mode = pitches(h.r, [0, 2, 3, 5, 7, 9, 10], 0, 19);
  let last = chord[(bar + Math.floor(r() * 3)) % chord.length];
  return at.map((step, i) => {
    const strong = step % 8 === 0;
    const aim = last + (style === 'modal' ? [5, -5, 2][i % 3] : [2, -1, 2, -2][i % 4]);
    let n = near(strong || style === 'swing' ? chord : mode, aim);
    if (style === 'swing' && !strong && step % 4 === 2 && i + 1 < at.length && r() < 0.38) n = near(chord, aim) - 1;
    last = n;
    const gap = (at[i + 1] ?? (style === 'modal' ? 15 : Math.min(16, step + 4))) - step;
    return [step, Math.max(1, gap - (style === 'modal' ? 1 : 0.25)), n, (style === 'modal' ? 0.68 : 0.72) + r() * 0.12];
  });
}

export function jazzMelody(style, seed, prog) {
  const pat = { jazz: { style }, prog: prog || JAZZ_PROGS[style][0].map(([r, c]) => ({ r, c })) };
  const part = (solo) => Array.from({ length: 8 }, (_, b) => jazzNotes(style, seed, b, jazzHarmony(pat, b), solo).map(([at, dur, n, v], i) => [16 * b + at, Math.round(dur), n, v, Math.floor(b / 4), (b % 4) * 8 + i])).flat();
  return { bars: 8, n: part(false), v: part(true), b: part(true) };
}

export function generateJazz(style, seed, bpm, palette, pocket) {
  if (style === 'jazzfunk') return generateFunk(seed, bpm, palette, pocket);
  if (style === 'bossa') return generateBossa(seed, bpm, palette, pocket);
  const r = rng(seed), params = defaultParams(), master = {};
  const ensemble = palette[Math.floor(rng(Math.imul((seed | 0) ^ 0x6d2b79f5, 0x85ebca6b))() * palette.length)];
  const prog = JAZZ_PROGS[style][Math.floor(r() * JAZZ_PROGS[style].length)].map(([r, c]) => ({ r, c }));
  const steps = Object.fromEntries(TRACK_IDS.map((id) => [id, Array.from({ length: 16 }, (_, i) => id === 'acid' ? { on: i % 4 === 0, n: 0, a: false, s: false } : 0)]));
  for (const i of [0, 4, 6, 8, 12, 14]) steps.ride[i] = i === 4 || i === 12 ? 2 : 1;
  for (const i of [4, 12]) steps.ch[i] = 1;
  for (const i of [0, 4, 8, 12]) steps.kick[i] = 1;
  for (const i of style === 'modal' ? [2, 10, 14] : [6, 14]) steps.snare[i] = 1;
  for (const i of ensemble[0] === 13 ? [0, 4, 8, 12] : style === 'modal' ? [0, 6, 14] : [0, 6]) steps.stab[i] = 1;
  Object.assign(master, { kit: 1, swing8: style === 'modal' ? 0.7 : 0.85 - (bpm - 132) / 44 * 0.2, duck: 0, drive: 0.025, dust: 0, arr: 0, vary: style === 'modal' ? 0.55 : 0.65, pocket, humanize: 0.15, room: style === 'modal' ? 0.2 : 0.15, revLevel: style === 'modal' ? 0.32 : 0.26, dlyLevel: 0 });
  Object.assign(params.stab, { voice: ensemble[0], octave: 0, chord: prog[0].c, level: 0.58, decay: +(ensemble[3] * (0.9 + r() * 0.2)).toFixed(3), env: ensemble[4], cutoff: 2200, dly: 0, rev: 0.12, reso: 0.5 });
  Object.assign(params.acid, { voice: 1, level: 0.92, tune: 0, decay: 0.38, cutoff: 1400, drive: 0, dly: 0, rev: 0.05 });
  Object.assign(params.ride, { level: 0.58, decay: 1.4, tone: 3800, dly: 0, rev: 0.12 });
  Object.assign(params.ch, { level: 0.3, decay: 0.045, tone: 3500, dly: 0, rev: 0.03 });
  Object.assign(params.kick, { level: 0.48, drive: 0, dly: 0, rev: 0.03 });
  Object.assign(params.snare, { level: 0.55, dly: 0, rev: 0.1 });
  Object.assign(params.perc, { voice: 0, level: 0 });
  params.clap.level = 0; params.vox.level = 0;
  const voices = ensemble[0] === 7 && style === 'swing' ? ['tpt', 'tpt', 'vocal', 'airflute'] : ['tpt', 'tpt', 'airflute'];
  const m = jazzMelody(style, seed, prog), preview = Array(32).fill(0);
  for (const [at, dur, n, v] of m.n) if (at < 32) preview[at] = [n, dur, v];
  const hook = { v: voices[Math.floor(r() * voices.length)], o: 0, s: preview, m, x: { feel: 0.2, risk: 0, space: 0.7, warmth: 0.7 } };
  return { pattern: { jazz: { style, seed }, steps, len: Object.fromEntries(TRACK_IDS.map((id) => [id, 16])), prog, hook, hm: 2 }, params, master, bpm, key: Math.floor(r() * 12), swing: 0, scale: style === 'modal' ? 'dorian' : prog[0].c === 20 ? 'minor' : 'major' };
}

function generateBossa(seed, bpm, palette, pocket) {
  const r = rng(seed), params = defaultParams(), master = {};
  const ensemble = palette[Math.floor(rng(Math.imul((seed | 0) ^ 0x6d2b79f5, 0x85ebca6b))() * palette.length)];
  const prog = JAZZ_PROGS.bossa[Math.floor(r() * JAZZ_PROGS.bossa.length)].map(([r, c]) => ({ r, c }));
  const steps = Object.fromEntries(TRACK_IDS.map((id) => [id, Array.from({ length: 16 }, (_, i) => id === 'acid' ? { on: [0, 6, 8, 14].includes(i), n: 0, a: false, s: false } : 0)]));
  for (const i of [0, 3, 8, 11]) steps.kick[i] = 1;
  for (let i = 0; i < 16; i += 2) steps.ch[i] = 1;
  for (const i of BOSSA_RIM[0]) steps.snare[i] = 1;
  for (const i of new Set([0, 8, ...BOSSA_BATIDA[0]])) steps.stab[i] = 1;
  Object.assign(master, { kit: 1, swing8: 0, duck: 0, drive: 0.015, dust: 0, arr: 0, vary: 0.45, pocket, humanize: 0.08, room: 0.1, revLevel: 0.18, dlyLevel: 0 });
  Object.assign(params.stab, { voice: ensemble[0] === 7 ? 7 : 18, chord: prog[0].c, octave: 0, level: 0.58, decay: +(ensemble[3] * (0.9 + r() * 0.2)).toFixed(3), env: ensemble[4], cutoff: 1800, dly: 0, rev: 0.08, reso: 0.5 });
  Object.assign(params.acid, { voice: 1, level: 0.92, tune: 0, decay: 0.38, cutoff: 1200, drive: 0, dly: 0, rev: 0.03 });
  Object.assign(params.ch, { level: 0.3, decay: 0.05, tone: 3200, dly: 0, rev: 0.02 });
  Object.assign(params.kick, { level: 0.38, drive: 0, dly: 0, rev: 0.02 });
  Object.assign(params.snare, { level: 0.32, decay: 0.1, tone: 2800, snappy: 0.1, dly: 0, rev: 0.04 });
  for (const id of ['ride', 'clap', 'perc', 'vox', 'oh']) params[id].level = 0;
  const m = jazzMelody('bossa', seed, prog), preview = Array(32).fill(0);
  for (const [at, dur, n, v] of m.n) if (at < 32) preview[at] = [n, dur, v];
  const hook = { v: r() < 0.75 ? 'airflute' : 'tpt', o: 0, s: preview, m, x: { feel: 0.1, risk: 0, space: 0.8, warmth: 0.8 } };
  return { pattern: { jazz: { style: 'bossa', seed }, steps, len: Object.fromEntries(TRACK_IDS.map((id) => [id, 16])), prog, hook, hm: 2 }, params, master, bpm, key: Math.floor(r() * 12), swing: 0.03, scale: 'major' };
}
