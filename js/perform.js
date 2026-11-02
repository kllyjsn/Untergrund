// The PERFORMER: turns notes as written into notes as played. A score file only knows pitches and
// rhythms; a pianist shapes each phrase, sings the top line over the accompaniment, leans into the
// bass, rolls wide chords, changes the pedal with the harmony and lets the tempo breathe.
// Deterministic: the same score always gets the same performance.
//
// in:  { bars, barLen, tempo: [[step, mult]], rubato, notes: [[step, midi, dur, vel, part, hand]] }
// out: { bars, barLen, sections, notes: [[step, midi, dur, vel, part, offsetSec]], at, tempo: per-step mult }

const cl = (x, a, b) => Math.max(a, Math.min(b, x));
const EPS = 0.02;

// Phrases are four bars of common time (eight of a short 3/8 or 2/4 bar), grouped as the ear groups them.
const phraseLen = (barLen) => (barLen <= 8 ? 8 : 4) * barLen;

// Step-length multipliers: the written tempo changes, then each phrase presses on and broadens into
// its cadence, and the last bars slow into the final chord. depth 0 is a metronome.
export function rubatoMap(total, barLen, written, depth, flex = 1) {
  const t = new Array(total).fill(1), P = phraseLen(barLen);
  let w = 0;
  for (let i = 0, k = 0; i < total; i++) {
    while (k < written.length && written[k][0] <= i) w = written[k++][1] - 1;
    const ph = (i % P) / P, n = Math.floor(i / P), d = depth * flex * (0.7 + 0.6 * (Math.sin(n * 91.7) * 0.5 + 0.5));
    let m = 1 - 0.022 * d * Math.sin(Math.PI * ph * 1.5) + (ph > 0.86 ? 0.06 * d * (ph - 0.86) / 0.14 : 0);
    t[i] = m * (1 + w);
  }
  const rit = Math.max(0, total - 2 * barLen);
  for (let i = rit; i < total; i++) t[i] *= 1 + 0.35 * cl(depth * Math.max(1, flex), 0.3, 3) * ((i - rit) / (total - rit)) ** 1.6;
  return t;
}

// How much a composer's music asks of the player: Chopin's line is florid (wide dynamics, lingering
// climaxes, a right hand that sings freely over a steady left), Mozart and Bach want poise.
const EXPRESSION = { Chopin: 1.7, Schubert: 1.25, Satie: 1.2, Beethoven: 1.1, Mozart: 0.7, Haydn: 0.65, Bach: 0.55 };
export const expressionOf = (composer = '') => EXPRESSION[Object.keys(EXPRESSION).find((k) => composer.includes(k))] ?? 1;

function groups(notes, key) {
  const out = new Map();
  for (const n of notes) {
    const g = key(n) + ':' + Math.round(n.s / EPS);
    if (!out.has(g)) out.set(g, []);
    out.get(g).push(n);
  }
  return [...out.values()];
}

export function perform(raw) {
  const { barLen = 16, rubato = 1 } = raw, total = raw.bars * barLen, P = phraseLen(barLen), ex = expressionOf(raw.composer);
  const src = raw.notes.map((n) => n.slice());
  const notes = src.map(([s, m, d, v, part, hand = 0]) => ({ s, m, d, v, part, hand, off: 0 }));
  const piano = notes.filter((n) => n.part === 'pno');
  // A score with no written dynamics (one velocity per part) gets them from its own shape.
  const flat = new Set(notes.map((n) => n.v)).size <= 2;

  // Loud where the writing is dense or high, soft where it thins out: a proxy for f/p in plain files.
  const perBar = new Array(raw.bars).fill(0);
  for (const n of notes) perBar[Math.min(raw.bars - 1, Math.floor(n.s / barLen))]++;
  const meanBar = perBar.reduce((a, b) => a + b, 0) / Math.max(1, raw.bars);
  const smooth = perBar.map((_, b) => { let a = 0, c = 0; for (let k = b - 2; k <= b + 2; k++) if (k >= 0 && k < raw.bars) { a += perBar[k]; c++; } return a / c; });

  for (const n of notes) {
    const bar = Math.min(raw.bars - 1, Math.floor(n.s / barLen)), ph = (n.s % P) / P, inBar = n.s % barLen;
    // A phrase rises to a point a little past its middle and relaxes into the cadence.
    const arc = ph < 0.62 ? ph / 0.62 : (1 - ph) / 0.38;
    // Phrases also differ from each other: one is a whisper, the next opens out.
    const level = 1 + 0.09 * ex * Math.sin(Math.floor(n.s / P) * 2.3 + 1);
    let v = n.v;
    if (flat) v = (0.5 + 0.16 * cl(smooth[bar] / meanBar - 1, -1, 1) + 0.1 * ex * arc) * level;
    else v *= (1 - 0.06 * ex + 0.12 * ex * arc) * level;
    // Metre: the downbeat leans, the half-bar a little, quick offbeats lighten.
    const beat = barLen % 6 === 0 && barLen !== 12 ? 6 : 4;
    v *= inBar < EPS ? 1.07 : Math.abs(inBar - barLen / 2) < EPS && barLen % 8 === 0 ? 1.03 : inBar % beat < EPS ? 1 : inBar % 2 < EPS ? 0.95 : 0.9;
    n.v = v;
  }

  // Voicing: the top of the right hand sings, inner notes recede, the left hand accompanies under it
  // with its bass note given weight. In strings the first violin leads.
  const melody = [];
  for (const g of groups(piano, (n) => n.hand)) {
    g.sort((a, b) => a.m - b.m);
    const top = g[g.length - 1], low = g[0];
    if (top.hand === 0) melody.push(top);
    for (const n of g) {
      if (n.hand === 0) n.v *= n === top ? 1.05 + 0.07 * ex : 0.8;
      else n.v *= n === low ? 0.86 : 0.72;
    }
    // Wide or full chords are rolled from the bottom, quicker when they are short.
    const span = top.m - low.m;
    if (g.length >= 3 && (span > 14 || (g.length >= 4 && top.d >= 2))) g.forEach((n, i) => { n.off += i * (span > 14 ? 0.016 : 0.009); });
  }
  // Melody lead: the sung line speaks a touch before the accompaniment under it.
  for (const n of piano) if (n.hand === 0 && n.v > 0.5) n.off -= 0.008;

  // The singing line: it swells as it climbs and toward each climax, lingers on the climax (the time
  // is paid back over the next beat), the right hand arrives a breath after the bass there, and quick
  // ornamental notes are feathered. All scaled by the composer's expression.
  melody.sort((a, b) => a.s - b.s);
  const linger = new Array(total).fill(0);
  // Each phrase begins with a breath: its first beat unfolds a touch slower.
  for (let s = 0; s < total; s += P) for (let j = 0; j < 4 && s + j < total; j++) linger[s + j] += 0.07 * ex * (1 - j / 4);
  for (let i = 0, lo = 0, hi = 0; i < melody.length; i++) {
    const n = melody[i];
    while (melody[lo].s < n.s - barLen) lo++;
    while (hi < melody.length - 1 && melody[hi + 1].s < n.s + barLen) hi++;
    let sum = 0, max = -1;
    for (let k = lo; k <= hi; k++) { sum += melody[k].m; max = Math.max(max, melody[k].m); }
    const mean = sum / (hi - lo + 1);
    n.v *= 1 + 0.035 * ex * cl((n.m - mean) / 4, -2, 2);
    if (n.d <= 0.6) n.v *= 1 - 0.07 * ex;
    // A sigh: a held note falling by step leans on the dissonance and lets the resolution fall away.
    const pv = melody[i - 1];
    if (pv && pv.d >= 2 && pv.m - n.m >= 1 && pv.m - n.m <= 2) {
      pv.v *= 1 + 0.05 * ex; n.v *= 1 - 0.06 * ex;
      if (Math.floor(pv.s) < total) linger[Math.floor(pv.s)] += 0.05 * ex;
    }
    if (n.m !== max || n.m - mean < 3 || (i && melody[i - 1].m === n.m)) continue;
    for (let k = lo; k <= hi; k++) {
      if (k === i) continue;
      const x = Math.abs(melody[k].s - n.s) / barLen;
      melody[k].v *= 1 + 0.05 * ex * (k < i ? -x : -1.3 * x);
    }
    n.v *= 1 + 0.06 * ex; n.off += 0.008 + 0.01 * ex;
    const st = Math.floor(n.s);
    for (let j = 0; j < 6 && st + j < total; j++) linger[st + j] += j < 2 ? (j ? 0.06 : 0.11) * ex : -0.025 * ex;
  }
  const lead = { vln1: 1.08, vln2: 0.9, vla: 0.88, vc: 0.97, cb: 0.85 };
  for (const n of notes) if (lead[n.part]) n.v *= lead[n.part];

  // Pedal: the damper lifts where the bass moves to a new harmony, so notes ring until then.
  // Quick right-hand figuration gets a half pedal so scales stay clean.
  // A new bass note on a beat is a new harmony; repeated chords and Alberti figures over one bass ring on.
  const beatLen = barLen % 6 === 0 && barLen !== 12 ? 6 : 4, changes = [];
  let bass = null;
  for (const g of groups(piano.filter((n) => n.hand === 1), () => 'L').sort((x, y) => x[0].s - y[0].s)) {
    const s = g[0].s, low = Math.min(...g.map((n) => n.m));
    if (low !== bass && (s % beatLen < EPS || s % barLen < EPS || bass === null)) { changes.push(s); bass = low; }
  }
  const nextChange = (s) => { let lo = 0, hi = changes.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (changes[mid] <= s + EPS) lo = mid + 1; else hi = mid; } return lo < changes.length ? changes[lo] : s + barLen; };
  if (changes.length) for (const n of piano) {
    const ring = Math.min(nextChange(n.s), n.s + barLen) - n.s;
    if (ring > n.d) n.d = n.d < 1 && n.hand === 0 ? Math.min(ring, n.d * 2.5) : ring;
  }

  // Dynamic range: an expressive player spreads louds and softs further from the piece's middle.
  const mid = notes.reduce((a, n) => a + n.v, 0) / Math.max(1, notes.length), spread = 1 + 0.5 * (ex - 1);
  for (const n of notes) n.v = mid + (n.v - mid) * spread;
  const out = notes.map((n) => [n.s, n.m, n.d, Math.round(cl(n.v, 0.08, 1) * 1000) / 1000, n.part, Math.round(n.off * 1000) / 1000]);
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const at = Array.from({ length: total }, () => []);
  for (const n of out) at[Math.min(total - 1, Math.floor(n[0] + 1e-9))].push(n);
  const sections = (raw.sections || [{ at: 0, name: 'I' }]).map((x, i, a) => ({ ...x, len: (a[i + 1]?.at ?? raw.bars) - x.at }));
  const tempo = rubatoMap(total, barLen, raw.tempo || [], rubato, ex ** 1.5).map((t, i) => Math.min(3.5, t * cl(1 + linger[i] * Math.min(1, rubato), 0.85, 1.5)));
  return { bars: raw.bars, barLen, sections, notes: out, at, tempo, piece: raw.id };
}
