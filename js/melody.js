// Vocal-length melodies: sung-style lead lines for the groove and pop genres.
// A melody is an 8-bar cycle of 4-bar phrases (the bridge may sing one 8-bar phrase). Each phrase has a planned
// contour (an arch or a climb to one peak note, then a resolution), syllable-friendly rhythm (mostly 8ths and
// quarters, a pickup into the phrase, a held last note) and a breath before the next phrase. The chorus states one
// hook bar that returns in every phrase. Notes are stored so a singer can sing them later (docs/melody.md):
//   m = { bars, n: hook/chorus, v: verse, b: bridge }, each a list of [start, dur, semi, vel, phrase, slot]
// start/dur in 16th steps inside the cycle (a pickup into the first phrase starts below 0, in the bar before),
// semi in semitones above the key root (like hook.s), phrase is the line number and slot the syllable in it.
import { CHORDS } from './params.js';

export const MELODY_BARS = 8;
export const PARTS = { n: 'hook', v: 'verse', b: 'bridge' };
const mod = (x, n) => ((x % n) + n) % n;
const pick = (r, a) => a[Math.floor(r() * a.length)];

// Per genre: syllables per bar, articulation (how much of the gap to the next syllable a note holds), level, offbeat
// and 16th syncopation, leap appetite, how high the chorus peaks.
// A new song genre sings once it has an entry here.
export const SING_PROFILES = {
  deephouse: { k: [3, 5], art: 0.85, off: 0.35, six: 0.05, leap: 0.25, hi: 0 },
  ukg: { k: [4, 6], art: 0.7, off: 0.5, six: 0.3, leap: 0.3, hi: 0 },
  euphoric: { k: [3, 5], art: 0.9, off: 0.25, six: 0, leap: 0.35, hi: 1 },
  trance: { k: [3, 4], art: 0.9, off: 0.2, six: 0, leap: 0.35, hi: 1 },
  neosoul: { k: [3, 5], art: 0.85, gain: 0.6, comp: 1, off: 0.5, six: 0.15, leap: 0.3, hi: 0, v: ['vocal', 'reed', 'warm'], x: { space: 0.5, risk: 0.35, feel: 0.7, warmth: 0.7 } },
  boombap: { k: [4, 5], art: 0.75, gain: 0.8, off: 0.4, six: 0.15, leap: 0.2, hi: 0, v: ['reed', 'vocal', 'warm'], x: { space: 0.55, risk: 0.3, feel: 0.6, warmth: 0.65 } },
  amapiano: { k: [3, 5], art: 0.75, off: 0.45, six: 0.1, leap: 0.25, hi: 0 },
  afrobeats: { k: [4, 6], art: 0.7, off: 0.5, six: 0.2, leap: 0.25, hi: 0 },
  reggaeton: { k: [4, 6], art: 0.6, gain: 0.85, off: 0.45, six: 0.2, leap: 0.2, hi: 0 },
  trap: { k: [4, 5], art: 0.7, off: 0.4, six: 0.25, leap: 0.25, hi: 0 },
  drill: { k: [4, 5], art: 0.65, gain: 0.7, off: 0.45, six: 0.3, leap: 0.25, hi: 0 },
  hyperpop: { k: [5, 6], art: 0.8, gain: 0.85, off: 0.3, six: 0.15, leap: 0.45, hi: 1 },
};
export const sings = (style) => !!SING_PROFILES[style];

// A sung note leans on beats 1 and 3, and on anything held: those land on chord tones (the engine snaps them too).
export const strongNote = (start, dur) => mod(start, 8) === 0 || dur >= 6;

// One bar of syllables on the 8th-note grid: a downbeat (or its anticipation), weighted beats, a few offbeats,
// and now and then one 16th push.
function barRhythm(r, P, k) {
  const w = (i) => (i === 0 ? 0 : i === 8 ? 1 : i % 4 === 0 ? 0.8 : P.off);
  const set = new Set([r() < P.off * 0.5 ? 2 : 0]);
  for (let g = 0; set.size < k && g < 200; g++) { const i = 2 * Math.floor(r() * 8); if (r() < w(i)) set.add(i); }
  const on = [...set].sort((a, b) => a - b);
  if (r() < P.six) {
    const j = on.findIndex((i, q) => i % 4 === 2 && !on.includes(i + 1) && q > 0);
    if (j >= 0) on[j] += 1;
  }
  return on;
}

// The last bar of a phrase: one or two syllables into a held note, then a breath of at least a beat.
const cadence = (r) => pick(r, [[0], [0], [-2], [0, 4], [0, 2]]);

// A phrase's rhythm: hook bar, answer bar, hook bar again, cadence. Pickups lead into the downbeat.
function phraseRhythm(r, P, hookBar, bars, pickup) {
  const out = [];
  if (pickup) for (const i of pickup) out.push(i);
  for (let b = 0; b < bars - 1; b++) {
    const rh = b % 2 === 0 ? hookBar : barRhythm(r, P, P.k[0] + Math.floor(r() * (P.k[1] - P.k[0] + 1)));
    for (const i of rh) out.push(b * 16 + i);
  }
  for (const i of cadence(r)) out.push((bars - 1) * 16 + i);
  const at = [...new Set(out)].sort((a, b) => a - b);
  const hold = Math.max(at.at(-1) + 4, (bars - 1) * 16 + pick(r, [6, 8, 8]));
  return at.map((s, j) => {
    const next = at[j + 1];
    // Inside a phrase syllables connect: at most a 16th of air between them, so a rest is a choice.
    const dur = next === undefined ? hold - s : Math.max(Math.min(next - s - 1, 15), Math.round(Math.min(next - s, 8) * P.art));
    return [s, Math.max(1, dur)];
  });
}

// Pitches for one phrase by dynamic programming over scale degrees: follow the planned contour, move by step,
// recover every leap by a step back, land strong notes on chord tones, touch the peak exactly once, end on `end`.
function phrasePitches(r, P, rh, plan, ctAt, forced) {
  const { lo, hi, start, peak, peakAt, end } = plan, J = rh.length;
  const span = rh[J - 1][0] - rh[0][0] || 1;
  const f = (j) => (rh[j][0] - rh[0][0]) / span;
  let kp = 0;
  for (let j = 1; j < J - 1; j++) {
    const score = (q) => Math.abs(f(q) - peakAt) - (strongNote(...rh[q]) ? 0.08 : 0) - rh[q][1] * 0.01;
    if (forced[j] === undefined && (forced[kp] !== undefined || score(j) < score(kp))) kp = j;
  }
  const target = (j) => {
    const x = f(j);
    if (x <= peakAt) return start + (peak - start) * Math.sin((x / (peakAt || 1)) * Math.PI / 2);
    return peak + (end - peak) * ((x - peakAt) / (1 - peakAt || 1));
  };
  const leapCost = 1.4 - P.leap;
  const step = (a) => [0.7, 0, 0.45, 2.4 * leapCost, 3 * leapCost, 4 * leapCost][a] ?? 12;
  const D = hi - lo + 1, INF = 1e9;
  // cost[d][m]: best cost ending on degree lo+d whose last move was m-7.
  let cost = Array.from({ length: D }, () => Array(15).fill(INF)), back = [];
  const local = (j, deg) => {
    if (forced[j] !== undefined) return deg === forced[j] ? 0 : INF;
    if (j === kp && deg !== peak) return INF;
    if (j !== kp && deg >= peak) return INF;
    if (j === J - 1 && deg !== end) return INF;
    const s = rh[j];
    return Math.abs(deg - target(j)) * 0.7 + (strongNote(...s) && !ctAt(s[0], deg) ? 6 : 0) + r() * 0.5;
  };
  for (let d = 0; d < D; d++) cost[d][7] = local(0, lo + d);
  for (let j = 1; j < J; j++) {
    const nc = Array.from({ length: D }, () => Array(15).fill(INF)), bk = Array.from({ length: D }, () => Array(15).fill(null));
    for (let d = 0; d < D; d++) {
      const lc = local(j, lo + d);
      if (lc >= INF) continue;
      for (let p = 0; p < D; p++) for (let m = 0; m < 15; m++) {
        const c0 = cost[p][m];
        if (c0 >= INF) continue;
        const mv = d - p, last = m - 7;
        if (Math.abs(mv) > 7) continue;
        let c = c0 + lc + step(Math.abs(mv));
        if (Math.abs(last) >= 3 && !(Math.abs(mv) >= 1 && Math.abs(mv) <= 2 && Math.sign(mv) === -Math.sign(last))) c += 6;
        if (mv === 0 && last === 0) c += 1.5;
        if (c < nc[d][mv + 7]) { nc[d][mv + 7] = c; bk[d][mv + 7] = [p, m]; }
      }
    }
    cost = nc; back.push(bk);
  }
  let best = [0, 7], bc = INF;
  for (let d = 0; d < D; d++) for (let m = 0; m < 15; m++) if (cost[d][m] < bc) { bc = cost[d][m]; best = [d, m]; }
  if (bc >= INF) return null;
  const out = Array(J);
  for (let j = J - 1, s = best; j >= 0; j--) { out[j] = lo + s[0]; if (j) s = back[j - 1][s[0]][s[1]]; }
  return out;
}

// Write one part (hook, verse or bridge): phrases of 4 bars (or one 8-bar phrase) over an 8-bar cycle.
function writePart(r, P, kind, deg, chordTones, hookHead) {
  const N = deg.length, semi = (d) => deg[mod(d, N)] + 12 * Math.floor(d / N);
  const lens = kind === 'b' && r() < 0.4 ? [8] : [4, 4];
  const hookBar = barRhythm(r, P, P.k[0] + Math.floor(r() * (P.k[1] - P.k[0] + 1)));
  const top = 6 + P.hi;
  const notes = [];
  let bar0 = 0, head = null;
  lens.forEach((bars, ph) => {
    const pickup = r() < 0.6 ? pick(r, [[-2], [-4, -2], [-3]]) : null;
    const rh = phraseRhythm(r, P, kind === 'n' && hookHead ? hookHead.rh : hookBar, bars, pickup);
    const last = ph === lens.length - 1;
    const plan = kind === 'v'
      ? { lo: -3, hi: 6, start: pick(r, [0, 2]), peak: pick(r, [3, 4, 5]), peakAt: 0.4 + r() * 0.2, end: last ? pick(r, [4, 1]) : pick(r, [2, 0]) }
      : kind === 'b'
        ? { lo: -3, hi: top + 3, start: pick(r, [-1, 0, 1]), peak: last ? top + 2 : top, peakAt: 0.65 + r() * 0.2, end: last ? 4 : 2 }
        : { lo: -3, hi: top + 2, start: pick(r, [2, 4]), peak: ph ? top + (r() < 0.5 ? 1 : 0) : top, peakAt: ph ? 0.55 + r() * 0.2 : 0.4 + r() * 0.2, end: last ? pick(r, [0, 0, 2]) : pick(r, [4, 1]) };
    const ctAt = (s, d) => chordTones(Math.floor(mod(bar0 * 16 + s, MELODY_BARS * 16) / 16)).has(mod(semi(d), 12));
    // Strong-beat peaks and endings move to the nearest chord tone so the plan itself is singable.
    const snap = (d, s) => [0, 1, -1, 2, -2].map((x) => d + x).find((q) => ctAt(s, q)) ?? d;
    plan.end = snap(plan.end, rh[rh.length - 1][0]);
    const forced = {};
    // The chorus hook: every phrase opens with the same first bar, note for note.
    if (kind === 'n' && head) rh.forEach(([s0], j) => { const q = head.at.indexOf(s0); if (q >= 0 && s0 >= 0 && s0 < 16) forced[j] = head[q]; });
    plan.peak = Math.max(plan.peak, ...Object.values(forced).map((d) => d + 1), plan.end + 1);
    plan.peak = [0, 1, 2].map((x) => plan.peak + x).find((q) => chordTones(bar0 + Math.floor((bars * 16 * plan.peakAt) / 16)).has(mod(semi(q), 12))) ?? plan.peak;
    plan.hi = Math.max(plan.hi, plan.peak);
    const ds = phrasePitches(r, P, rh, plan, ctAt, forced) || phrasePitches(r, P, rh, { ...plan, peak: plan.peak + 1, hi: plan.hi + 1 }, () => true, {});
    if (!ds) { bar0 += bars; return; }
    if (kind === 'n' && !head) {
      const k = rh.filter(([s]) => s >= 0 && s < 16).length + rh.filter(([s]) => s < 0).length;
      head = ds.slice(0, k); head.at = rh.slice(0, k).map(([s]) => s); head.rh = hookBar;
    }
    const peakJ = ds.indexOf(Math.max(...ds));
    rh.forEach(([s, d], j) => {
      const x = (s - rh[0][0]) / ((rh[rh.length - 1][0] - rh[0][0]) || 1), pk = peakJ / Math.max(1, rh.length - 1);
      const arc = 0.76 + 0.18 * Math.max(0, 1 - Math.abs(x - pk) * 1.6) + (mod(s, 16) === 0 ? 0.04 : 0) - (s < 0 || mod(s, 16) >= 12 && j < 2 ? 0.08 : 0);
      notes.push([bar0 * 16 + s, d, semi(ds[j]), +(Math.min(1, j === peakJ ? 0.98 : arc) * (P.gain || 1)).toFixed(3), ph, j]);
    });
    bar0 += bars;
  });
  return { notes, head };
}

// The whole melody for a song. `prog` is the main changes (one chord per bar), `alt` the bridge's.
export function writeMelody(r, style, scale, { prog, alt, chord = 0 } = {}) {
  const P = SING_PROFILES[style];
  if (!P) return null;
  const deg = scale.length >= 7 ? scale.slice(0, 7) : scale.slice(0, scale.length - 1);
  const tones = (pr) => (bar) => {
    const h = pr?.length ? pr[mod(bar, pr.length)] : { r: 0, c: chord };
    return new Set((CHORDS[h.c] || CHORDS[0]).iv.map((x) => mod(h.r + x, 12)));
  };
  const n = writePart(r, P, 'n', deg, tones(prog), null);
  const v = writePart(r, P, 'v', deg, tones(prog), null);
  const b = writePart(r, P, 'b', deg, tones(alt?.length ? alt : prog), null);
  return { bars: MELODY_BARS, n: n.notes, v: v.notes, b: b.notes, ...(SING_PROFILES[style].comp ? { c: 1 } : {}) };
}

// The chorus's first two bars in the 32-step hook format, for code that only knows hook.s.
export function melodySteps(notes) {
  const s = Array(32).fill(0);
  const on = notes.filter((x) => x[0] >= 0 && x[0] < 32);
  on.forEach((x, j) => {
    const end = Math.min(on[j + 1]?.[0] ?? 32, (Math.floor(x[0] / 16) + 1) * 16);
    s[x[0]] = [x[2], Math.max(1, Math.min(x[1], end - x[0], 16)), x[3]];
  });
  return s;
}

// A song hook that sings: the 2-bar hook gains a vocal-length melody (styles without a hook profile get a voice).
export function withMelody(hook, r, style, scale, opts) {
  const P = SING_PROFILES[style];
  if (!P) return hook;
  const h = hook ? { ...hook } : { v: pick(r, P.v || ['vocal']), o: 0, s: [], x: { ...(P.x || { space: 0.45, risk: 0.4, feel: 0.5, warmth: 0.55 }) } };
  const m = writeMelody(r, style, scale, opts);
  if (!m?.n.length) return hook;
  h.m = m; h.s = melodySteps(m.n);
  return h;
}

// The singer's view (docs/melody.md): every part as phrases of syllable slots with MIDI pitch and times in beats.
export function melodyScore(hook, { key = 0, bpm = 120 } = {}) {
  const m = hook?.m;
  if (!m) return null;
  const k = key > 6 ? key - 12 : key, base = 60 + k + 12 * (hook.o || 0);
  const parts = {};
  for (const [id, name] of Object.entries(PARTS)) {
    const phrases = [];
    for (const [start, dur, semi, vel, ph, slot] of m[id] || []) {
      (phrases[ph] ??= { phrase: ph, notes: [] }).notes.push({ slot, midi: base + semi, start: start / 4, dur: dur / 4, vel, strong: strongNote(start, dur) });
    }
    parts[name] = phrases.filter(Boolean).map((p) => ({ ...p, start: p.notes[0].start, end: p.notes.at(-1).start + p.notes.at(-1).dur, syllables: p.notes.length }));
  }
  return { format: 'untergrund-melody/1', bpm, bars: m.bars, beatsPerBar: 4, parts };
}
