// Long-form songs: how long a generated song runs, and what earns each bar past the first chorus.
// A plan is a list of sections [kind, bars]: i intro, v verse, p pre-chorus, c chorus, x instrumental, b bridge, o outro.
// A full song grows from a compact base toward about 3.5 minutes at the style's tempo by adding the sections
// listeners reward (a longer, stronger last chorus, an instrumental, a fuller second verse, a longer bridge), never
// by looping what is already there; developSong() writes the takes that make every repeat different.
// Research basis and the testable principles: docs/long-form.md.
import { STEPS } from './params.js';

// Seconds: a full song lands between lo and hi (aiming at mid); a sketch is the idea in about a minute and a half.
export const LENGTHS = { song: { lo: 180, mid: 210, hi: 240 }, sketch: { lo: 40, mid: 80, hi: 110 } };
export const MAX_SONG_BARS = 128;
export const SECTION_NAMES = { i: 'intro', v: 'verse', p: 'pre-chorus', c: 'chorus', x: 'instrumental', b: 'bridge', o: 'outro' };

// Compact bases per idiom (pop and soul write pre-choruses, rap goes verse-to-hook, house grooves stay longer).
const BASES = {
  song: {
    pop: ['i4 v8 p4 c8 v8 p4 c8 b8 c8 o4', 'i4 c8 v8 p4 c8 v8 p4 c8 b8 c8 o4', 'i8 v8 p4 c8 v8 p4 c8 b8 p4 c8 o4'],
    rap: ['i4 c8 v16 c8 v16 c8 b8 c8 o4', 'i8 v16 c8 v16 c8 b8 c8 o8'],
    house: ['i8 v8 c8 v8 c8 b8 c8 o8', 'i8 v8 p4 c8 v8 p4 c8 b8 c8 o8'],
  },
  sketch: { pop: ['i4 v8 p4 c8 o4'], rap: ['i4 v16 c8 o4'], house: ['i8 v8 c8 o8'] },
};

const kinds = (S) => S.map((s) => s[0]);
const nth = (S, k, n) => { let c = 0; return S.findIndex((s) => s[0] === k && ++c === n); };
const grow = (S, i, to) => (i < 0 || S[i][1] >= to ? false : (S[i][1] = to, true));
// Each step adds a section that develops the song; a step that does not apply returns false.
const GROW = {
  final: (S) => grow(S, kinds(S).lastIndexOf('c'), 16),
  inst: (S) => {
    const i = nth(S, 'c', 2);
    if (i < 0 || S.some((s) => s[0] === 'x') || i === kinds(S).lastIndexOf('c')) return false;
    S.splice(i + 1, 0, ['x', 8]); return true;
  },
  verse1: (S) => grow(S, nth(S, 'v', 1), 16),
  verse2: (S) => grow(S, nth(S, 'v', 2), 16),
  verse3: (S) => {
    const b = kinds(S).indexOf('b');
    if (b < 0 || kinds(S).filter((k) => k === 'v').length >= 3) return false;
    S.splice(b, 0, ['v', 16], ['c', 8]); return true;
  },
  pre: (S) => {
    const i = kinds(S).lastIndexOf('c');
    if (!S.some((s) => s[0] === 'p') || S[i - 1]?.[0] === 'p') return false;
    S.splice(i, 0, ['p', 4]); return true;
  },
  bridge: (S) => grow(S, kinds(S).indexOf('b'), 16),
  intro: (S) => S[0][0] === 'i' && grow(S, 0, 8),
  outro: (S) => S.at(-1)[0] === 'o' && grow(S, S.length - 1, 8),
  intro16: (S) => S[0][0] === 'i' && grow(S, 0, 16),
  outro16: (S) => S.at(-1)[0] === 'o' && grow(S, S.length - 1, 16),
};
const ORDER = {
  pop: ['final', 'inst', 'verse2', 'pre', 'outro', 'intro', 'verse1', 'bridge', 'intro16', 'outro16'],
  rap: ['final', 'inst', 'outro', 'intro', 'verse3', 'bridge'],
  house: ['final', 'inst', 'intro16', 'outro16', 'verse2', 'verse1', 'bridge'],
};
const SKETCH_ORDER = ['final', 'intro', 'outro'];

export const parseForm = (spec) => spec.split(' ').map((x) => [x[0], +x.slice(1)]);
export const formBars = (S) => S.reduce((a, s) => a + s[1], 0);
export const formSeconds = (S, bpm) => (formBars(S) * 240) / bpm;

// The section plan for an idiom at a tempo. `r` is the seeded random source that picks the base.
export function planSections(idiom, bpm, length = 'song', r = Math.random) {
  const L = LENGTHS[length] ? length : 'song', T = LENGTHS[L], list = BASES[L][idiom] || BASES[L].pop;
  // The last chorus is the longest wherever the tempo allows; at ballad tempos, bases that already fill the
  // song are preferred, and the shortest is used when none fits.
  const forms = list.map((f) => {
    const S = parseForm(f), t = S.map((x) => [...x]);
    if (L === 'song' && GROW.final(t) && formSeconds(t, bpm) <= T.hi) return t;
    return S;
  });
  const fit = forms.filter((S) => formSeconds(S, bpm) <= T.hi);
  const pick = forms[Math.floor(r() * forms.length)];
  const S = fit.length ? (fit.includes(pick) ? pick : fit[Math.floor(r() * fit.length)]) : forms.reduce((a, b) => (formBars(b) < formBars(a) ? b : a));
  for (const op of L === 'song' ? ORDER[idiom] || ORDER.pop : SKETCH_ORDER) {
    if (formSeconds(S, bpm) >= T.mid) break;
    const trial = S.map((s) => [...s]);
    if (!GROW[op](trial) || formBars(trial) > MAX_SONG_BARS || formSeconds(trial, bpm) > T.hi) continue;
    S.splice(0, S.length, ...trial);
  }
  return S;
}

// Sections as chain letters. The intro, each verse running into a chorus and the bridge end on the fill bar (D);
// every 8 chorus or instrumental bars end on the half-time switch (H).
export function formChain(S) {
  return S.map(([k, n], i) => {
    const next = S[i + 1]?.[0];
    if (k === 'i') return 'A'.repeat(n - 1) + 'D';
    if (k === 'o') return 'A'.repeat(n);
    if (k === 'p') return 'B'.repeat(n);
    if (k === 'v') return next === 'c' ? 'C'.repeat(n - 1) + 'D' : 'C'.repeat(n);
    if (k === 'c' || k === 'x') return 'GGGGGGGH'.repeat(n >> 3) + (n % 8 ? 'G'.repeat(n % 8 - 1) + 'H' : '');
    return 'E'.repeat((n >> 1) - 1) + 'F'.repeat(n >> 1) + 'D';
  }).join('').slice(0, MAX_SONG_BARS);
}

// Where each section starts in the chain.
export function sectionSpans(S) {
  let at = 0;
  return S.map(([k, n]) => { const s = { k, at, bars: n }; at += n; return s; });
}

const ZERO = () => Array(STEPS).fill(0);
const clone = (o) => JSON.parse(JSON.stringify(o));
const on = (row) => Array.isArray(row) && row.some((v) => v && (typeof v !== 'object' || v.on));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const OFF8 = () => Array.from({ length: STEPS }, (_, j) => (j % 4 === 2 ? 1 : 0));
const SHAKE = () => Array.from({ length: STEPS }, (_, j) => (j % 2 ? 1 : 0));

// The second (and third) verse brings in the busiest kit part the chorus has and the first verse held back.
function verseTake(C, G) {
  const steps = {}, len = {};
  const hits = (x) => G.steps[x].filter((v) => v && (typeof v !== 'object' || v.on)).length;
  const t = ['perc', 'oh', 'ride', 'clap'].filter((x) => !on(C.steps[x]) && on(G.steps[x])).sort((a, b) => hits(b) - hits(a))[0];
  if (t) { steps[t] = clone(G.steps[t]); if (G.len?.[t]) len[t] = G.len[t]; }
  if (!Object.keys(steps).length) steps.perc = on(C.steps.perc) ? SHAKE() : OFF8();
  return { steps, ...(Object.keys(len).length ? { len } : {}) };
}
// A later pre-chorus drives harder: the chorus's kick under its first half, then the kick drops out for the last
// bars and a drum roll, so the chorus still lands as the kick coming back (Summach 2011; Solberg 2014).
function driveTake(B, G) {
  const hits = (row) => (row || []).filter((v) => v && (typeof v !== 'object' || v.on)).length;
  return hits(G.steps.kick) > hits(B.steps.kick) ? { steps: { kick: clone(G.steps.kick) } } : null;
}
// The roll itself.
function rollTake(B) {
  const t = on(B.steps.snare) ? 'snare' : 'clap', row = (B.steps[t] || ZERO()).map((v, j) => (j >= 8 ? 1 : v));
  return same(row, B.steps[t]) ? null : { steps: { [t]: row } };
}
// The instrumental: the chorus groove with the lead playing the riff instead of the sung line, and no vocal chops.
function instTake(G) {
  const body = {};
  if (G.hook?.s) { const { m: _m, ...riff } = G.hook; body.hook = { ...clone(riff), h: 1 }; }
  if (on(G.steps.vox)) body.steps = { vox: ZERO() };
  return Object.keys(body).length ? body : { hm: 0 };
}
// The last chorus thickens the cymbals and percussion it already plays (8ths, then 16ths in its second half), so it
// is the densest stretch of the song in the chorus's own sound; a chorus with none of them gets a shaker.
function finalTake(G, level) {
  const steps = {}, fill = (t, every) => {
    if (!on(G.steps[t])) return;
    const row = G.steps[t].map((v, j) => v || (j % every === every >> 1 ? 1 : 0));
    if (!same(row, G.steps[t])) steps[t] = row;
  };
  fill('ride', 4); fill('oh', 4); fill('perc', level > 1 ? 2 : 4);
  if (level > 1) fill('ch', 2);
  if (Object.keys(steps).length) return { steps };
  return on(G.steps.perc) ? null : { steps: { perc: SHAKE() }, len: { perc: STEPS } };
}

// Writes the development of a planned song into its patterns as per-bar takes (scope.js): repeats stay the same
// song (the chorus hook and chords are untouched) but never play back identically. `keep` tracks (locked ones) are
// never touched; `strict` only develops tracks a section already plays, so an explicit instrument list holds.
export function developSong(pats, S, { keep = [], strict = false } = {}) {
  if (!S?.length || !pats || pats.length < 8 || pats.some((p) => p.score)) return pats;
  const B = pats[1], C = pats[2], G = pats[6];
  const add = (pat, from, to, body) => {
    if (!body || to < from) return;
    if (body.steps) {
      const ok = (t) => !keep.includes(t) && (!strict || on(pat.steps[t]));
      const steps = Object.fromEntries(Object.entries(body.steps).filter(([t]) => ok(t)));
      const len = body.len && Object.fromEntries(Object.entries(body.len).filter(([t]) => ok(t)));
      body = { ...body, steps, ...(len ? { len } : {}) };
      if (!Object.keys(steps).length) { delete body.steps; delete body.len; }
      if (!Object.keys(body).length) return;
    }
    (pat.at ??= []).push({ b: [from, to], ...body });
  };
  let verses = 0, pres = 0;
  const spans = sectionSpans(S), last = kinds(S).lastIndexOf('c'), end = (s) => Math.min(s.at + s.bars, MAX_SONG_BARS) - 1;
  spans.forEach((s, i) => {
    if (s.at >= MAX_SONG_BARS) return;
    // A 16-bar verse accumulates: its second half brings the new part in.
    if (s.k === 'v' && ++verses > 1) add(C, s.bars >= 16 ? s.at + (s.bars >> 1) : s.at, end(s), strict ? finalTake(C, 1) : verseTake(C, G));
    if (s.k === 'p' && ++pres > 1) {
      add(B, s.at, s.at + (s.bars >> 1) - 1, driveTake(B, G));
      add(B, end(s), end(s), rollTake(B));
    }
    // An instrumental's last bar is the switch-up (H): it stays instrumental too.
    if (s.k === 'x') { add(G, s.at, end(s), instTake(G)); add(pats[7], s.at, end(s), instTake(pats[7])); }
    if (i === last) {
      const half = s.bars >= 16 ? s.at + 8 : end(s) + 1;
      add(G, s.at, Math.min(half, end(s) + 1) - 1, finalTake(G, 1));
      add(G, half, end(s), finalTake(G, 2));
    }
  });
  return pats;
}

// A club form with a third drop saves its biggest moment for last (P4): the final drop's lead takes the octave on
// every answer instead of only the last phrase's, so the drop sits above the groove before it. Written as a take on
// the drop patterns (G and its half-time H), so it stays an ordinary edit; a locked lead is left alone.
export function developFinalDrop(pats, chain, { keep = [] } = {}) {
  const c = [].concat(chain).join(''), end = c.lastIndexOf('G');
  if (end < 0 || keep.includes('stab') || !pats || pats.length < 8 || pats.some((p) => p.score)) return pats;
  let from = end;
  while (from > 0 && 'GH'.includes(c[from - 1])) from--;
  const to = c[end + 1] === 'H' ? end + 1 : end;
  for (const p of [pats[6], pats[7]]) if (p.hook && !p.hook.h) (p.at ??= []).push({ b: [from, to], hook: { ...clone(p.hook), up: 1 } });
  return pats;
}
