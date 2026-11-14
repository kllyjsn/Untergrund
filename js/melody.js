// Vocal-length melodies: sung-style lead lines for the groove and pop genres.
// A melody is an 8-bar cycle of 4-bar phrases (the bridge may sing one 8-bar phrase). Each phrase has a planned
// contour (an arch or a climb to one peak note, then a resolution), syllable-friendly rhythm (mostly 8ths and
// quarters, a pickup into the phrase, a held last note) and a breath before the next phrase. The chorus states one
// hook bar that returns in every phrase. Notes are stored so a singer can sing them later (docs/melody.md):
//   m = { bars, n: hook/chorus, v: verse, b: bridge }, each a list of [start, dur, semi, vel, phrase, slot]
// start/dur in 16th steps inside the cycle (a pickup into the first phrase starts below 0, in the bar before),
// semi in semitones above the key root (like hook.s), phrase is the line number and slot the syllable in it.
import { CHORDS } from './params.js';
import { lineStress } from './prosody.js';

export const MELODY_BARS = 8;
export const PARTS = { n: 'hook', v: 'verse', b: 'bridge' };
const mod = (x, n) => ((x % n) + n) % n;
const pick = (r, a) => a[Math.floor(r() * a.length)];

// Per genre: syllables per bar, articulation (how much of the gap to the next syllable a note holds), level, offbeat
// and 16th syncopation, leap appetite, how high the chorus peaks. Optional: pk/pks pickup chance and shapes, jump the
// chance a pickup leaps up a 4th/5th into the line, mel the
// chance a held note opens with a melisma (one syllable over a turn to the note above), belt a louder, flatter line.
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
  // Song genres. Pop: a hook you can sing back, square and repeated, lifting to the chorus top.
  pop: { song: 1, k: [3, 5], art: 0.85, off: 0.3, six: 0.05, leap: 0.3, hi: 1, v: ['vocal', 'reed'] },
  // R&B: few syllables, long and laid back, held notes ornamented with melismas.
  rnb: { song: 1, k: [3, 4], art: 0.9, off: 0.55, six: 0.2, leap: 0.3, hi: 0, mel: 0.6, v: ['vocal', 'warm'], x: { space: 0.55, risk: 0.35, feel: 0.75, warmth: 0.7 } },
  // Rock: belted on the beat in a middle register, no falsetto lift.
  rock: { song: 1, k: [4, 5], art: 0.8, off: 0.25, six: 0.05, leap: 0.25, hi: -1, belt: 1 },
  // Folk: a story, many syllables, almost all steps.
  folk: { song: 1, k: [4, 6], art: 0.8, off: 0.3, six: 0.05, leap: 0.1, hi: 0 },
  // Country: twang, leaps of a fourth or more, and pickups into nearly every line.
  country: { song: 1, k: [4, 5], art: 0.75, off: 0.35, six: 0.1, leap: 0.5, hi: 0, pk: 0.9, jump: 0.8, pks: [[-2], [-4, -2], [-3, -2], [-4, -3, -2]] },
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
function phrasePitches(r, P, rh, plan, ctAt, forced, opt = {}) {
  const { lo, hi, start, peak, peakAt, end } = plan, J = rh.length;
  const span = rh[J - 1][0] - rh[0][0] || 1;
  const f = (j) => (rh[j][0] - rh[0][0]) / span;
  const strong = (j) => (opt.strong ? opt.strong[j] : false) || strongNote(...rh[j]);
  let kp = 0;
  if (opt.kp !== undefined) kp = opt.kp;
  else for (let j = 1; j < J - 1; j++) {
    const score = (q) => Math.abs(f(q) - peakAt) - (strong(q) ? 0.08 : 0) - rh[q][1] * 0.01;
    if (forced[j] === undefined && (forced[kp] !== undefined || score(j) < score(kp))) kp = j;
  }
  const peakX = opt.kp !== undefined ? f(kp) : peakAt;
  const target = (j) => {
    const x = f(j), peakAt = peakX;
    if (x <= peakAt) return start + (peak - start) * Math.sin((x / (peakAt || 1)) * Math.PI / 2);
    return peak + (end - peak) * ((x - peakAt) / (1 - peakAt || 1));
  };
  const leapCost = (1.4 - P.leap) * (opt.leapMul || 1);
  const step = (a) => [0.7, 0, 0.45, 2.4 * leapCost, 3 * leapCost, 4 * leapCost][a] ?? 12;
  const D = hi - lo + 1, INF = 1e9;
  // cost[d][m]: best cost ending on degree lo+d whose last move was m-7.
  let cost = Array.from({ length: D }, () => Array(15).fill(INF)), back = [];
  const local = (j, deg) => {
    if (forced[j] !== undefined) return deg === forced[j] ? 0 : INF;
    if (j === kp && deg !== peak) return INF;
    if (j !== kp && deg >= peak) return INF;
    if (j === J - 1 && deg !== end) return INF;
    const s = rh[j], ct = ctAt(s[0], deg);
    // A weak syllable between chord tones may pass or lean (a non-chord tone) when the line asks for colour.
    const hard = strongNote(...s), lean = opt.strong?.[j];
    return Math.abs(deg - target(j)) * 0.7 + (!ct ? (hard ? 6 : lean ? 1 : opt.colour ? -opt.colour : 0) : 0) + r() * 0.5;
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
        if (opt.jump?.has(j) && mv >= 3) c -= opt.jumpBonus;
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
    const pickup = r() < (P.pk ?? 0.6) ? pick(r, P.pks || [[-2], [-4, -2], [-3]]) : null;
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
    // Country twang: the pickup starts a fourth or fifth under the line and leaps up into it.
    if (P.jump && pickup && r() < P.jump) forced[pickup.length - 1] = Math.max(plan.lo, plan.start - pick(r, [3, 4]));
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
      const arc = (P.belt ? 0.86 : 0.76) + (P.belt ? 0.1 : 0.18) * Math.max(0, 1 - Math.abs(x - pk) * 1.6) + (mod(s, 16) === 0 ? 0.04 : 0) - (s < 0 || mod(s, 16) >= 12 && j < 2 ? 0.08 : 0);
      const at = bar0 * 16 + s, v = +(Math.min(1, j === peakJ ? 0.98 : arc) * (P.gain || 1)).toFixed(3);
      // A melisma keeps the syllable's slot: the note, a 16th on the step above, back to the note and hold (never in the
      // hook bar, which must return note for note).
      if (P.mel && d >= 6 && ds[j] + 1 < ds[peakJ] && !(kind === 'n' && s < 16) && r() < P.mel) notes.push([at, 1, semi(ds[j]), v, ph, j], [at + 1, 1, semi(ds[j] + 1), +(v * 0.9).toFixed(3), ph, j], [at + 2, d - 2, semi(ds[j]), v, ph, j]);
      else notes.push([at, d, semi(ds[j]), v, ph, j]);
    });
    bar0 += bars;
  });
  return { notes, head };
}

// ---------------- text setting (the song genres, and any part sung to words) ----------------
// A part is 4 lines of 2 bars, two lines to a 4-bar phrase. Each line's rhythm comes from its words: stressed syllables
// take the beats, weak ones the 8ths between, leading weak syllables a pickup (dynamic programming over positions).
// The verse talks (8ths, now and then a 16th, lines landing anywhere in bar 2); the chorus sings (quarters and held
// half-bar beats, every line landing on bar 2's downbeat). The chorus's first and third lines are the title: it starts
// on the chorus downbeat, leaps a signature interval up to the phrase's peak and holds it, and returns note for note.
const METER = (p) => { const q = mod(p, 16); return q === 0 ? 4 : q === 8 ? 3 : q % 4 === 0 ? 2 : q % 2 === 0 ? 1 : 0; };
const MAX_SYL = 18;

function gapCost(g, stressed, chorus) {
  if (chorus) return g === 4 ? 0 : g === 6 || g === 8 ? 0.15 : g === 2 ? (stressed ? 0.8 : 0.55) : g === 1 || g === 3 ? 1.4 : 0.5 + 0.1 * Math.abs(g - 8);
  return g === 2 ? 0 : g === 1 ? 0.25 : g === 3 ? 0.3 : g === 4 ? 0.45 : 0.8 + 0.15 * (g - 5);
}

// Onsets (16th steps from the line's downbeat) for one line's stress pattern. `last` lists where the last syllable
// may land; `down` forces the first stressed syllable onto the downbeat.
function lineRhythm(r, P, chorus, stress, { last, down = false, six = false, from = -6 }) {
  const L = stress.length, f = Math.max(0, stress.indexOf(1));
  const top = Math.max(...last), pos = [];
  for (let p = from; p <= top; p++) if (six || p % 2 === 0) pos.push(p);
  const local = (j, p) => {
    const w = METER(p), s = stress[j];
    let c = s ? (4 - w) * (chorus ? 1.6 : 1.1) : w >= 3 ? 2.5 : w === 2 ? (chorus ? 0.9 : 0.4) : 0;
    if (p < 0 && j >= f) c += 6;
    if (j === f && f > 0 === false && p < 0) c += 6;
    if (j === f && down && p !== 0) c += 40;
    if (j === f && !down && p > 4) c += 1;
    if (s && P.off && !chorus && mod(p, 4) === 2) c -= P.off;
    if (j === L - 1 && !last.includes(p)) return Infinity;
    return c + r() * 0.35;
  };
  const N = pos.length, INF = Infinity;
  let cost = pos.map((p) => local(0, p)), back = [];
  for (let j = 1; j < L; j++) {
    const nc = Array(N).fill(INF), bk = Array(N).fill(-1);
    for (let i = 0; i < N; i++) {
      const lc = local(j, pos[i]);
      if (lc === INF) continue;
      for (let k = 0; k < i; k++) {
        if (cost[k] === INF) continue;
        const c = cost[k] + lc + gapCost(pos[i] - pos[k], stress[j], chorus);
        if (c < nc[i]) { nc[i] = c; bk[i] = k; }
      }
    }
    cost = nc; back.push(bk);
  }
  let bi = -1;
  for (let i = 0; i < N; i++) if (cost[i] < INF && (bi < 0 || cost[i] < cost[bi])) bi = i;
  if (bi < 0) return null;
  const out = Array(L);
  for (let j = L - 1, i = bi; j >= 0; j--) { out[j] = pos[i]; if (j) i = back[j - 1][i]; }
  return out;
}

// Stress patterns for a part sung without words: the chorus a short title line and a longer answer (T B T B'),
// the verse an AABA of conversational lines. Pickup genres (country) start lines on a weak syllable.
function virtualLines(r, P, kind) {
  const k = (P.k[0] + P.k[1]) / 2;
  const line = (n, iamb) => Array.from({ length: n }, (_, i) => ((i + (iamb ? 1 : 0)) % 2 === 0 ? 1 : 0));
  const vary = (a) => { const b = a.slice(); const i = 1 + Math.floor(r() * (b.length - 2)); if (!b[i] && !b[i + 1]) return b; b.splice(i, 0, 0); return b; };
  if (kind === 'n') {
    const t = pick(r, [[1, 0, 1], [1, 0, 0, 1], [1, 0, 1, 0, 1], [1, 1, 0, 1], [0, 1, 0, 1]]);
    const T = P.pk && t[0] && r() < P.pk ? [0, ...t] : t, B = line(Math.round(k) + (r() < 0.5 ? 1 : 2), r() < (P.pk ?? 0.5));
    return [T, B, T, r() < 0.5 ? B : vary(B)];
  }
  const A = line(Math.max(5, Math.min(10, Math.round(k * 1.7))), r() < (P.pk ?? 0.6)), B = vary(line(A.length - 1, r() < (P.pk ?? 0.5)));
  return kind === 'b' ? [A, vary(A), B, B] : [A, A, B, A];
}

// One part set to `words` (up to 4 lines) or to a virtual meter.
function setPart(r, P, kind, deg, chordTones, words, sig, ceil = Infinity) {
  const N = deg.length, semi = (d) => deg[mod(d, N)] + 12 * Math.floor(d / N);
  const virt = virtualLines(r, P, kind);
  const lines = [0, 1, 2, 3].map((i) => {
    const w = words?.[i] && lineStress(words[i]).slice(0, MAX_SYL);
    return w?.length ? w : virt[i];
  });
  const chorus = kind === 'n', top = 6 + P.hi, notes = [];
  const six = !chorus && r() < Math.min(0.95, 0.5 + P.six * 4 + P.off * 0.5);
  const seen = new Map(), titleAt = [];
  let head = null;
  const rhythmOf = (i, opts) => {
    const key = `${lines[i].join('')}:${i % 2}:${words?.[i] ?? ''}`;
    if (!seen.has(key)) seen.set(key, lineRhythm(r, P, chorus, lines[i], opts) || lineRhythm(r, P, chorus, lines[i], { ...opts, six: true, down: false, from: -8 }));
    return seen.get(key);
  };
  for (let ph = 0; ph < 2; ph++) {
    const ia = 2 * ph, ib = ia + 1, bar0 = ph * 4;
    const ra = rhythmOf(ia, { last: chorus ? [lines[ia].length > 1 ? 16 : 0] : [14, 16, 18, 20], down: chorus || r() < 0.5, six });
    const rb = rhythmOf(ib, { last: [16], six, from: Math.max(-6, Math.max(...(ra || [0])) + 4 - 32) });
    if (!ra || !rb) continue;
    const at = [...ra, ...rb.map((x) => x + 32)], la = ra.length;
    const nextFirst = (ph === 0 ? 64 : 128) + -6;
    const rh = at.map((s, j) => {
      const next = at[j + 1];
      if (j === la - 1) return [s, Math.max(1, Math.min(16, next - s - 1))];
      if (next === undefined) return [s, Math.max(4, Math.min(pick(r, [6, 8, 8]), nextFirst - 4 - s))];
      return [s, Math.max(1, Math.max(Math.min(next - s - 1, 15), Math.round(Math.min(next - s, 8) * P.art)))];
    });
    const stress = [...lines[ia], ...lines[ib]].map((x) => !!x);
    const last = ph === 1;
    const plan = kind === 'v'
      ? { lo: -2, hi: 6, start: pick(r, [0, 1, 2]), peak: pick(r, [2, 3, 4]), peakAt: 0.35 + r() * 0.25, end: last ? pick(r, [4, 1]) : pick(r, [2, 0]) }
      : kind === 'b'
        ? { lo: -2, hi: top + 3, start: pick(r, [-1, 0, 1]), peak: last ? top + 1 : top, peakAt: 0.65 + r() * 0.2, end: last ? 4 : 2 }
        : { lo: -1, hi: top + 2, start: pick(r, [2, 4]), peak: last ? top + 1 : top, peakAt: 0.5, end: last ? 0 : pick(r, [4, 1]) };
    const ctAt = (s, d) => chordTones(Math.floor(mod(bar0 * 16 + s, MELODY_BARS * 16) / 16)).has(mod(semi(d), 12));
    const snap = (d, s) => [0, 1, -1, 2, -2].map((x) => d + x).find((q) => ctAt(s, q)) ?? d;
    plan.end = snap(plan.end, at.at(-1));
    const forced = {}, opt = { strong: stress, colour: chorus ? 0.25 : 0.15, leapMul: P.jump ? 1 : 1.6 };
    // Pickup genres leap up from the pickup onto the line's first downbeat (country's "and-a HOME").
    if (P.jump) { const fa = lines[ia].indexOf(1), fb = lines[ib].indexOf(1); opt.jump = new Set([fa, la + fb].filter((j) => j > 0 && j !== la)); opt.jumpBonus = P.jump * 8; }
    if (chorus && ph === 0) {
      // The title: its held last note is the phrase's peak, reached by the song's signature leap.
      opt.kp = la - 1;
      plan.peak = [0, 1, -1].map((x) => plan.peak + x).find((q) => ctAt(at[la - 1], q)) ?? plan.peak;
      if (plan.end >= plan.peak) plan.end = [2, 3, 4, 1].map((x) => plan.peak - x).find((q) => ctAt(at.at(-1), q)) ?? plan.peak - 2;
      plan.lo = Math.min(plan.lo, plan.end);
      if (la >= 2) {
        const q = plan.peak - sig;
        if (!(stress[la - 2] || strongNote(...rh[la - 2])) || ctAt(at[la - 2], q)) forced[la - 2] = Math.max(plan.lo, q);
      }
      titleAt.push(bar0 * 16 + at[0]);
    } else if (head && (chorus || kind === 'v') && lines[ia].join('') === head.stress && head.n === la) {
      // The title (or the verse's first line) returns note for note.
      head.ds.forEach((d, j) => { forced[j] = d; });
      if (chorus) titleAt.push(bar0 * 16 + at[0]);
    }
    if (opt.kp === undefined) plan.peak = Math.max(plan.peak, ...Object.values(forced).map((d) => d + 1), plan.end + 1);
    plan.hi = Math.max(plan.hi, plan.peak);
    let ds = null;
    if (kind === 'v') {
      // A verse phrase climbs a 4th to a 6th above its floor, and stays under the chorus title.
      const fits = (xs) => { const t = semi(Math.max(...xs)), sp = t - semi(Math.min(...xs)); return sp >= 5 && sp <= 9 && t < ceil; };
      // It widens from below first (a lower start or ending keeps the chorus above it), then moves the peak.
      const p0 = plan.peak;
      const ends = [...new Set([plan.end, snap(plan.end - 2, at.at(-1)), snap(plan.end - 3, at.at(-1))])];
      search: for (const fz of [forced, {}]) for (const p of [p0, p0 - 1, p0 + 1, p0 - 2, p0 + 2, p0 - 3]) {
        if (semi(p) >= ceil) continue;
        for (const st of [plan.start, plan.start - 1, plan.start - 2, plan.start - 3, plan.start + 1]) for (const end of ends) {
          if (p < Math.max(end + 1, st + 1, ...Object.values(fz))) continue;
          const xs = phrasePitches(r, P, rh, { ...plan, start: st, end, peak: p, hi: Math.max(plan.hi, p), lo: Math.min(plan.lo, end, st - 1) }, ctAt, fz, opt);
          if (xs && !ds) ds = xs;
          if (xs && fits(xs)) { ds = xs; break search; }
        }
      }
    }
    ds ||= phrasePitches(r, P, rh, plan, ctAt, forced, opt) || phrasePitches(r, P, rh, { ...plan, peak: plan.peak + 1, hi: plan.hi + 1 }, () => true, {}, { kp: opt.kp });
    if (!ds) continue;
    if (!head) head = { ds: ds.slice(0, la), stress: lines[ia].join(''), n: la };
    const peakJ = ds.indexOf(Math.max(...ds));
    rh.forEach(([s, d], j) => {
      const x = (s - rh[0][0]) / ((rh.at(-1)[0] - rh[0][0]) || 1), pk = peakJ / Math.max(1, rh.length - 1);
      const arc = (P.belt ? 0.86 : 0.76) + (P.belt ? 0.1 : 0.18) * Math.max(0, 1 - Math.abs(x - pk) * 1.6) + (stress[j] ? 0.05 : 0) - (s < 0 ? 0.08 : 0);
      const a = bar0 * 16 + s, v = +(Math.min(1, j === peakJ ? 0.98 : arc) * (P.gain || 1)).toFixed(3);
      if (P.mel && d >= 6 && ds[j] + 1 < ds[peakJ] && !(chorus && j < la) && r() < P.mel) notes.push([a, 1, semi(ds[j]), v, ph, j], [a + 1, 1, semi(ds[j] + 1), +(v * 0.9).toFixed(3), ph, j], [a + 2, d - 2, semi(ds[j]), v, ph, j]);
      else notes.push([a, d, semi(ds[j]), v, ph, j]);
    });
  }
  return { notes, titleAt };
}

// The whole melody for a song. `prog` is the main changes (one chord per bar), `alt` the bridge's.
// `words` ({ n, v, b }: up to 4 lyric lines each) sets the parts to those lines; the song genres always text-set.
export function writeMelody(r, style, scale, { prog, alt, chord = 0, words = null } = {}) {
  const P = SING_PROFILES[style];
  if (!P) return null;
  const deg = scale.length >= 7 ? scale.slice(0, 7) : scale.slice(0, scale.length - 1);
  const tones = (pr) => (bar) => {
    const h = pr?.length ? pr[mod(bar, pr.length)] : { r: 0, c: chord };
    return new Set((CHORDS[h.c] || CHORDS[0]).iv.map((x) => mod(h.r + x, 12)));
  };
  if (P.song || words) {
    const sig = P.jump && r() < P.jump ? pick(r, [4, 5]) : pick(r, [2, 3, 3, 4]);
    const n = setPart(r, P, 'n', deg, tones(prog), words?.n, sig), title = n.notes.filter((x) => x[4] === 0).map((x) => x[2]);
    const v = setPart(r, P, 'v', deg, tones(prog), words?.v, sig, title.length ? Math.max(...title) : Infinity);
    const b = setPart(r, P, 'b', deg, tones(alt?.length ? alt : prog), words?.b, sig);
    return { bars: MELODY_BARS, n: n.notes, v: v.notes, b: b.notes, ...(P.comp ? { c: 1 } : {}) };
  }
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
    parts[name] = phrases.filter(Boolean).map((p) => ({ ...p, start: p.notes[0].start, end: p.notes.at(-1).start + p.notes.at(-1).dur, syllables: new Set(p.notes.map((n) => n.slot)).size }));
  }
  return { format: 'untergrund-melody/1', bpm, bars: m.bars, beatsPerBar: 4, parts };
}
