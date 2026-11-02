// STUDY: learns compact style statistics per composer from the public-domain / CC0 scores in
// data/repertoire (already license-checked by scripts/import-repertoire.py) and writes js/composer-models.js.
// Node only, no dependencies, deterministic: the same scores always give the same file.
//   node scripts/study-corpus.mjs           write js/composer-models.js
//   node scripts/study-corpus.mjs --check   exit 1 if the committed file is out of date
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chord } from '../js/classical.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = ROOT + 'js/composer-models.js';
const mod = (x, n) => ((x % n) + n) % n;
const r3 = (x) => Math.round(x * 1000) / 1000;
const EPS = 0.02;

// Composers with less than this go only into their era's model.
const MIN_PIECES = 2, MIN_BARS = 200;
const ERAS = {
  'Classical era': ['Joseph Haydn', 'Wolfgang Amadeus Mozart', 'Ludwig van Beethoven'],
  'Romantic era': ['Franz Schubert', 'Frédéric Chopin', 'Erik Satie'],
};
const SHORT = (name) => name.split(' ').pop();

// ---- key and chord vocabulary --------------------------------------------------------------
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function parseKey(s) {
  const m = /^([A-G])([♯#♭b]?)\s+(major|minor)/i.exec(s.trim());
  if (!m) throw new Error(`Unreadable key "${s}"`);
  return { t: mod(LETTER[m[1].toUpperCase()] + (m[2] === '♯' || m[2] === '#' ? 1 : m[2] ? -1 : 0), 12), m: m[3].toLowerCase() === 'major' ? 'M' : 'm' };
}
const DIATONIC = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'viio', 'vii'];
const SEVENTHS = ['V7', 'ii7', 'IV7', 'viio7'];
const SECONDARY = ['V/ii', 'V/iii', 'V/IV', 'V/V', 'V/vi', 'V7/ii', 'V7/iii', 'V7/IV', 'V7/V', 'V7/vi', 'viio7/V'];
export const VOCAB = [...DIATONIC, ...SEVENTHS, ...SECONDARY];
const TRIADS = new Set(DIATONIC);
// iii and the subtonic are rare in this music; they only win a window with clear evidence.
const RARE = { iii: -0.04, vii: -0.04 };
// Cadences: the penultimate chord that can make each kind.
const CADENCE_FROM = {
  perfect: new Set(['V', 'V7', 'viio', 'viio7', 'IV']),
  half: new Set(['I', 'ii', 'ii7', 'IV', 'vi', 'V/V', 'V7/V', 'viio7/V']),
  deceptive: new Set(['V', 'V7']),
};
// Krumhansl-Kessler key profiles, for the local key a melody is heard in.
const KK = {
  M: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  m: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};
function keyOf(w) {
  let best = null, c = -Infinity;
  const mw = w.reduce((a, b) => a + b, 0) / 12;
  for (const m of ['M', 'm']) for (let t = 0; t < 12; t++) {
    const P = KK[m], mp = P.reduce((a, b) => a + b, 0) / 12;
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < 12; i++) { const x = w[mod(i + t, 12)] - mw, y = P[i] - mp; xy += x * y; xx += x * x; yy += y * y; }
    const r = xy / Math.sqrt(xx * yy || 1);
    if (r > c) { c = r; best = { t, m }; }
  }
  return best;
}
function templates(key) {
  const seen = new Set(), out = [];
  for (const sym of VOCAB) {
    const c = chord(sym, key), id = [...c.pcs].sort((a, b) => a - b).join(',');
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ sym, pcs: c.pcs, root: c.root, prior: RARE[sym] ?? (TRIADS.has(sym) ? 0 : sym.includes('/') ? -0.06 : -0.03) });
  }
  return out;
}
const scaleSet = (key) => {
  const s = new Set((key.m === 'M' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10, 9, 11]).map((x) => mod(x + key.t, 12)));
  return s;
};

// ---- metre ---------------------------------------------------------------------------------
// barLen is in score steps; a 32-step bar is common time written in 32nds, a 6-step bar is 3/8.
const beatOf = (barLen) => (barLen >= 32 ? 8 : barLen <= 8 ? 2 : 4);
const windowOf = (barLen) => (barLen >= 16 ? barLen / 2 : barLen);

// ---- one piece -----------------------------------------------------------------------------
function analyse(p) {
  const key = parseKey(p.key), tpl = templates(key);
  const barLen = p.barLen || 16, beat = beatOf(barLen), win = windowOf(barLen), total = p.bars * barLen;
  const notes = p.notes.map(([s, m, d, v, part, hand = 0]) => ({ s, m, d, part, acc: part === 'pno' ? hand === 1 : part !== 'vln1' }));

  // Harmony per window: duration-weighted pitch classes (the bass counts extra) matched to chord templates.
  const nW = Math.ceil(total / win), wins = Array.from({ length: nW }, () => ({ w: new Array(12).fill(0), bass: null, bassAt: Infinity }));
  for (const n of notes) {
    for (let k = Math.floor(n.s / win); k < nW && k * win < n.s + n.d; k++) {
      const a = Math.max(n.s, k * win), b = Math.min(n.s + n.d, (k + 1) * win);
      if (b <= a) continue;
      const W = wins[k];
      W.w[n.m % 12] += b - a;
      if (n.s < (k + 0.5) * win && (W.bass === null || n.m < W.bass)) W.bass = n.m;
    }
  }
  const labels = wins.map((W) => {
    const tot = W.w.reduce((a, b) => a + b, 0);
    if (tot < 0.5) return null;
    const w = W.w.slice();
    if (W.bass !== null) w[W.bass % 12] += tot * 0.25;
    const T = w.reduce((a, b) => a + b, 0);
    let best = null, score = -Infinity;
    for (const c of tpl) {
      const cov = c.pcs.reduce((a, pc) => a + w[pc], 0) / T;
      let miss = 0;
      c.pcs.forEach((pc, j) => { if (w[pc] < 0.06 * T) miss += j === 2 ? 0.5 : 1; });
      if (c.pcs.length === 4 && w[c.pcs[3]] < 0.08 * T) continue;
      const sc = cov - 0.18 * miss + (W.bass !== null && W.bass % 12 === c.root ? 0.06 : 0) + c.prior;
      if (sc > score) { score = sc; best = c; }
    }
    if (!best || score < 0.4) return { sym: '?', inv: '' };
    let inv = '';
    if (TRIADS.has(best.sym) && W.bass !== null) {
      const b = W.bass % 12;
      inv = b === best.pcs[1] ? '6' : b === best.pcs[2] ? '64' : '';
    }
    return { sym: best.sym, inv };
  });

  // Chord-to-chord moves (repeats merged), harmonic rhythm, inversions.
  const trans = {}, inv = {}, rhythm = { mid: [0, 0], bar: [0, 0] };
  let prev = null;
  labels.forEach((l, k) => {
    if (!l) return;
    if (l.sym !== '?') {
      inv[l.sym] ??= { root: 0, '6': 0, '64': 0 };
      if (TRIADS.has(l.sym)) inv[l.sym][l.inv || 'root']++;
    }
    if (prev && labels[k - 1] && l.sym !== '?' && prev.sym !== '?') {
      const changed = l.sym !== prev.sym;
      const slot = win < barLen && k % 2 ? 'mid' : 'bar';
      rhythm[slot][0] += changed ? 1 : 0; rhythm[slot][1]++;
      if (changed) { trans[prev.sym] ??= {}; trans[prev.sym][l.sym] = (trans[prev.sym][l.sym] || 0) + 1; }
    }
    prev = l;
  });

  // Top voice: the highest melody-part note at each onset.
  const onsets = new Map();
  for (const n of notes) if (!n.acc) {
    const g = Math.round(n.s / EPS);
    if (!onsets.has(g) || onsets.get(g).m < n.m) onsets.set(g, n);
  }
  // Skyline: an onset under a melody note that is still sounding is an inner voice, not the tune.
  const top = [];
  for (const n of [...onsets.values()].sort((a, b) => a.s - b.s)) {
    const cur = top[top.length - 1];
    if (cur && n.s < cur.s + cur.d - EPS && n.m < cur.m) continue;
    top.push(n);
  }
  // Local key, bar by bar (two bars either side), so a melody is chromatic against the key it is in.
  const barPc = Array.from({ length: p.bars }, () => new Array(12).fill(0));
  for (const n of notes) barPc[Math.min(p.bars - 1, Math.floor(n.s / barLen))][n.m % 12] += n.d;
  const local = barPc.map((_, b) => {
    const w = new Array(12).fill(0);
    for (let k = Math.max(0, b - 2); k <= Math.min(p.bars - 1, b + 2); k++) barPc[k].forEach((x, i) => { w[i] += x; });
    return scaleSet(keyOf(w));
  });
  const melody = { size: [0, 0, 0, 0, 0, 0], semis: {}, turns: [0, 0], leaps: [0, 0], chromatic: [0, 0], steps: [0, 0] };
  const size = (semi) => { const a = Math.abs(semi); return a === 0 ? 0 : a <= 2 ? 1 : a <= 4 ? 2 : a <= 6 ? 3 : a <= 7 ? 4 : 5; };
  for (let i = 0; i < top.length; i++) {
    const n = top[i];
    melody.chromatic[0] += local[Math.min(p.bars - 1, Math.floor(n.s / barLen))].has(n.m % 12) ? 0 : 1; melody.chromatic[1]++;
    const a = top[i - 1];
    if (!a || n.s - (a.s + a.d) > barLen / 2) continue;
    const iv = n.m - a.m;
    melody.size[size(iv)]++;
    const c = Math.max(-12, Math.min(12, iv));
    melody.semis[c] = (melody.semis[c] || 0) + 1;
    melody.steps[0] += size(iv) === 1 ? 1 : 0; melody.steps[1] += size(iv) ? 1 : 0;
    const z = top[i - 2];
    if (z && iv && a.m !== z.m && a.s - (z.s + z.d) <= barLen / 2) {
      const pv = a.m - z.m;
      melody.turns[0] += Math.sign(pv) !== Math.sign(iv) ? 1 : 0; melody.turns[1]++;
      if (Math.abs(pv) >= 5) { melody.leaps[0] += Math.sign(pv) !== Math.sign(iv) && Math.abs(iv) <= 2 ? 1 : 0; melody.leaps[1]++; }
    }
  }

  // Rhythm cells: which quarter-beats of each beat the top voice starts a note on ('1010' = two eighths).
  const cells = {}, q = beat / 4, hit = new Set(top.map((n) => Math.round(n.s / q)));
  for (let b = 0; b < total / beat; b++) {
    let c = '';
    for (let j = 0; j < 4; j++) c += hit.has(b * 4 + j) ? '1' : '0';
    cells[c] = (cells[c] || 0) + 1;
  }

  // Phrases: the top voice breathes (a rest of a beat or more) or holds a long note; that ends a phrase.
  // The cadence is the last two different chords before it.
  const short = barLen <= 8 ? 2 : 1, phrases = {}, cadences = {};
  let from = top[0]?.s ?? 0;
  const ends = [];
  top.forEach((n, i) => {
    const next = top[i + 1], gap = next ? next.s - (n.s + n.d) : Infinity;
    if (gap >= beat - EPS || n.d >= barLen / 2 || !next) {
      const len = Math.round((n.s + n.d - from) / barLen / short);
      if (len >= 2) { ends.push(n.s); phrases[Math.min(len, 12)] = (phrases[Math.min(len, 12)] || 0) + 1; from = next ? next.s : 0; }
    }
  });
  for (const s of ends) {
    let k = Math.min(nW - 1, Math.floor(s / win));
    while (k > 0 && (!labels[k] || labels[k].sym === '?')) k--;
    const F = labels[k];
    if (!F || F.sym === '?') continue;
    let j = k - 1;
    while (j >= 0 && (!labels[j] || labels[j].sym === F.sym)) j--;
    const P = labels[j];
    if (!P || P.sym === '?' || k - j > 4) continue;
    const kind = F.sym === 'I' ? 'perfect' : F.sym === 'V' || F.sym === 'V7' ? 'half' : F.sym === 'vi' && P.sym.startsWith('V') ? 'deceptive' : null;
    if (!kind || !CADENCE_FROM[kind].has(P.sym)) continue;
    const pat = `${P.sym + (TRIADS.has(P.sym) ? P.inv : '')} ${F.sym === 'V7' ? 'V' : F.sym}`;
    cadences[kind] ??= {};
    cadences[kind][pat] = (cadences[kind][pat] || 0) + 1;
  }

  // Accompaniment texture, bar by bar, from the left hand (piano) or the lower parts (strings).
  const texture = { alberti: 0, arpeggio: 0, block: 0, sustain: 0, line: 0 }, spans = [], reach = [];
  const acc = notes.filter((n) => n.acc);
  const byBar = Array.from({ length: p.bars }, () => []);
  for (const n of acc) byBar[Math.min(p.bars - 1, Math.floor(n.s / barLen))].push(n);
  for (const bar of byBar) {
    if (!bar.length) continue;
    const g = new Map();
    for (const n of bar) { const k = Math.round(n.s / EPS); if (!g.has(k)) g.set(k, []); g.get(k).push(n); }
    const groups = [...g.values()], attacks = groups.length, beats = barLen / beat;
    const chordal = groups.filter((x) => new Set(x.map((n) => n.m)).size >= 2).length / attacks;
    for (const x of groups) if (x.length >= 3) { const ms = x.map((n) => n.m); spans.push(Math.max(...ms) - Math.min(...ms)); }
    const seq = groups.map((x) => Math.min(...x.map((n) => n.m)));
    const span = Math.max(...seq) - Math.min(...seq), distinct = new Set(seq).size;
    let kind;
    if (attacks / beats <= 0.5) kind = 'sustain';
    else if (chordal >= 0.6 || distinct <= 2) kind = 'block';
    else {
      let rep = 0, cnt = 0;
      for (let i = 1; i + 2 < seq.length; i += 2) { cnt++; if (seq[i] === seq[i + 2]) rep++; }
      if (seq.length >= 4 && span <= 14 && cnt && rep / cnt >= 0.6) kind = 'alberti';
      else if (seq.length >= 4 && span >= 12) { kind = 'arpeggio'; reach.push(span); }
      else kind = 'line';
    }
    texture[kind]++;
  }
  return { trans, inv, rhythm, melody, cells, phrases, cadences, texture, spans, reach, bars: p.bars };
}

// ---- pooling -------------------------------------------------------------------------------
const addInto = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = typeof v === 'number' ? (a[k] || 0) + v : addInto(a[k] || (Array.isArray(v) ? [] : {}), v); return a; };
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
// Probabilities to 3 decimals that sum to exactly 1 (the largest entry absorbs the rounding), tiny ones dropped.
function norm(counts, { floor = 0.005, order = null } = {}) {
  const tot = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!tot) return {};
  let e = Object.entries(counts).map(([k, v]) => [k, v / tot]).filter(([, p]) => p >= floor);
  const t2 = e.reduce((a, [, p]) => a + p, 0);
  e = e.map(([k, p]) => [k, Math.round((p / t2) * 1000)]);
  const s = e.reduce((a, [, p]) => a + p, 0), big = e.reduce((bi, x, i) => (x[1] > e[bi][1] ? i : bi), 0);
  e[big][1] += 1000 - s;
  e.sort(order ? (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]) : (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return Object.fromEntries(e.filter(([, p]) => p > 0).map(([k, p]) => [k, p / 1000]));
}
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function build(name, ids, stats, prior) {
  const S = ids.map((id) => stats[id]);
  const sum = (f) => S.reduce((a, s) => addInto(a, f(s)), {});
  const trans = sum((s) => s.trans), inv = sum((s) => s.inv), cells = sum((s) => s.cells), phrases = sum((s) => s.phrases);
  const cad = sum((s) => s.cadences), tex = sum((s) => s.texture);
  const mel = S.reduce((a, s) => addInto(a, s.melody), {});
  const rh = S.reduce((a, s) => addInto(a, s.rhythm), {});
  // Each row of the transition matrix is smoothed toward the whole corpus (weight 2 moves), so a chord
  // this composer rarely uses still has somewhere sensible to go.
  const states = VOCAB.filter((v) => trans[v] || prior?.[v]);
  const T = {};
  for (const v of states) {
    const row = { ...(trans[v] || {}) }, n = Object.values(row).reduce((a, b) => a + b, 0);
    const pr = prior?.[v] || {};
    for (const [k, p] of Object.entries(pr)) row[k] = (row[k] || 0) + 2 * p * (n ? 1 : 1) / 1;
    if (!n && !Object.keys(pr).length) continue;
    T[v] = norm(row, { floor: 0.01 });
  }
  const I = {};
  for (const v of DIATONIC) if (inv[v]) { const x = norm(inv[v], { floor: 0, order: ['root', '6', '64'] }); if (Object.keys(x).length) I[v] = x; }
  const pct = (a) => (a && a[1] ? r3(a[0] / a[1]) : null);
  const top = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n));
  return {
    name,
    pieces: ids,
    bars: S.reduce((a, s) => a + s.bars, 0),
    harmony: {
      transitions: sortObj(T),
      changeMid: pct(rh.mid),
      changeBar: pct(rh.bar),
      inversions: I,
      cadences: Object.fromEntries(['perfect', 'half', 'deceptive'].filter((k) => cad[k]).map((k) => [k, norm(top(cad[k], 6), { floor: 0.02 })])),
    },
    melody: {
      size: Object.fromEntries(norm(Object.fromEntries((mel.size || []).map((c, i) => [i, c])), { floor: 0, order: ['0', '1', '2', '3', '4', '5'] }) ? Object.entries(norm(Object.fromEntries((mel.size || []).map((c, i) => [i, c])), { floor: 0, order: ['0', '1', '2', '3', '4', '5'] })) : []),
      semitones: norm(Object.fromEntries(Object.entries(mel.semis || {}).sort((a, b) => +a[0] - +b[0])), { floor: 0.004, order: Array.from({ length: 25 }, (_, i) => String(i - 12)) }),
      stepShare: pct(mel.steps),
      turn: pct(mel.turns),
      leapRecovery: pct(mel.leaps),
      chromatic: pct(mel.chromatic),
    },
    rhythm: { cells: norm(top(cells, 12), { floor: 0.01 }) },
    phrases: norm(phrases, { floor: 0.03, order: Array.from({ length: 13 }, (_, i) => String(i)) }),
    texture: norm(tex, { floor: 0, order: ['alberti', 'arpeggio', 'block', 'sustain', 'line'] }),
    voicing: { chordSpan: median(S.flatMap((s) => s.spans)), arpeggioReach: median(S.flatMap((s) => s.reach)) },
  };
}

export function study() {
  const dir = ROOT + 'data/repertoire/';
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const pieces = files.map((f) => JSON.parse(readFileSync(dir + f, 'utf8')));
  const stats = Object.fromEntries(pieces.map((p) => [p.id, analyse(p)]));
  const all = pieces.map((p) => p.id);
  const g = all.reduce((a, id) => addInto(a, stats[id].trans), {});
  const prior = Object.fromEntries(Object.entries(g).map(([k, row]) => [k, norm(row, { floor: 0 })]));
  const byComposer = {};
  for (const p of pieces) (byComposer[p.composer] ??= []).push(p.id);
  const models = {}, merged = {};
  // Composers in the order they lived.
  const LIVED = ['Johann Sebastian Bach', 'Joseph Haydn', 'Wolfgang Amadeus Mozart', 'Ludwig van Beethoven', 'Franz Schubert', 'Frédéric Chopin', 'Erik Satie'];
  const when = (c) => (LIVED.includes(c) ? LIVED.indexOf(c) : LIVED.length);
  for (const [composer, ids] of Object.entries(byComposer).sort(([a], [b]) => when(a) - when(b) || (a < b ? -1 : 1))) {
    const bars = ids.reduce((a, id) => a + stats[id].bars, 0);
    if (ids.length >= MIN_PIECES && bars >= MIN_BARS) models[SHORT(composer)] = build(SHORT(composer), ids, stats, prior);
    else merged[SHORT(composer)] = { pieces: ids.length, bars, era: Object.keys(ERAS).find((e) => ERAS[e].includes(composer)) || null };
  }
  for (const [era, names] of Object.entries(ERAS)) {
    const ids = all.filter((id) => names.includes(pieces.find((p) => p.id === id).composer));
    if (ids.length) models[era] = build(era, ids, stats, prior);
  }
  return { models, merged, count: pieces.length };
}

export function render({ models, merged, count }) {
  const lines = [
    '// GENERATED by scripts/study-corpus.mjs from data/repertoire (do not edit by hand; re-run the script).',
    `// Style statistics learned from ${count} public-domain / CC0 scores: harmony as roman numerals in the`,
    '// piece\'s key, chord-to-chord moves, cadences, melody intervals and contour, rhythm cells, phrase lengths,',
    '// accompaniment texture and chord spacing. See data/models/README.md.',
    `export const CORPUS = ${JSON.stringify({ scores: count, thin: merged })};`,
    'export const MODELS = {',
    ...Object.entries(models).map(([k, m]) => `  ${JSON.stringify(k)}: ${JSON.stringify(m)},`),
    '};',
    '',
  ];
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = render(study());
  if (process.argv.includes('--check')) {
    const now = readFileSync(OUT, 'utf8');
    if (now !== text) { console.error('js/composer-models.js is out of date: run node scripts/study-corpus.mjs'); process.exit(1); }
    console.log('composer models are up to date');
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT.slice(ROOT.length)} (${(text.length / 1024).toFixed(1)} KB)`);
  }
}
