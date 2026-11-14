// Long-form composition: every generated song runs 3-4 minutes at its own tempo (a sketch about a minute and a
// half), keeps its genre's section roles, repeats with development, and never pads time with copied loops.
// Principles and research basis: docs/long-form.md.
import assert from 'node:assert/strict';
import { STYLES, SONG_STYLES, songPlan } from '../js/state.js';
import { realize, validateSpec, localSpec } from '../js/song-spec.js';
import { planSections, formChain, formSeconds, developSong, LENGTHS, MAX_SONG_BARS } from '../js/longform.js';
import { buildSong, playSong, SEEDS, loopStyles } from '../scripts/composition.mjs';

const LETTERS = 'ABCDEFGH';
const secs = (s) => (s.chain.length * 240) / s.bpm;
// What plays at a bar: its pattern and which of that pattern's takes (if any) covers the bar.
const sig = (s, pos) => {
  const i = LETTERS.indexOf(s.chain[pos]), at = s.patterns[i].at || [];
  let t = -1; for (let k = at.length - 1; k >= 0; k--) if (at[k].b[0] <= pos && pos <= at[k].b[1]) { t = k; break; }
  return `${i}.${t}`;
};
const spans = (S) => { let at = 0; return S.map(([k, n]) => { const x = { k, at, bars: n }; at += n; return x; }); };
const hitsPerBar = (log, from, bars) => log.filter((L) => L.k === 'trigger' && L.step >= from * 16 && L.step < (from + bars) * 16).length / bars;

// P1 duration: 3-4 minutes at the generated tempo (slow ballads may reach ~4:15, the 128-bar cap keeps the fastest near 3:00).
{
  const out = [];
  for (const style of loopStyles()) for (const seed of SEEDS) {
    const full = buildSong(style, seed), sketch = buildSong(style, seed, 'sketch'), t = secs(full), k = secs(sketch);
    assert(t >= 175 && t <= 255, `${style}/${seed} full song runs ${t.toFixed(0)}s`);
    assert(k >= LENGTHS.sketch.lo && k <= 120, `${style}/${seed} sketch runs ${k.toFixed(0)}s`);
    assert(full.chain.length <= MAX_SONG_BARS && sketch.chain.length < full.chain.length / 2, `${style}/${seed} sketch is a sketch`);
    out.push(t);
  }
  out.sort((a, b) => a - b);
  console.log(`long-form duration passed: full songs ${out[0].toFixed(0)}-${out.at(-1).toFixed(0)}s, median ${out[out.length >> 1].toFixed(0)}s`);
  // Planning is tempo-aware: the same idiom gets more bars at a faster tempo, never past the cap.
  const r = () => 0;
  assert(formChain(planSections('pop', 150, 'song', r)).length > formChain(planSections('pop', 90, 'song', r)).length);
  for (const bpm of [60, 90, 120, 150, 180]) for (const idiom of ['pop', 'rap', 'house']) {
    const S = planSections(idiom, bpm, 'song', r);
    assert(formSeconds(S, bpm) <= LENGTHS.song.hi || S.reduce((a, x) => a + x[1], 0) <= 84, `${idiom} at ${bpm} only grows while it stays under 4 minutes`);
  }
}

// P2 section roles: songs keep verse/chorus/bridge with an intro and outro; the last chorus is the longest.
{
  let inst = 0, n = 0;
  for (const style of SONG_STYLES) for (const seed of SEEDS) {
    const { sections: S } = songPlan(style, seed), k = S.map((x) => x[0]), count = (c) => k.filter((x) => x === c).length;
    assert.equal(k[0], 'i', `${style} opens on an intro`); assert.equal(k.at(-1), 'o', `${style} ends on an outro`);
    assert(count('v') >= 2 && count('c') >= 3 && count('b') === 1, `${style}/${seed} form ${k.join(' ')}`);
    const choruses = S.filter((x) => x[0] === 'c').map((x) => x[1]);
    assert(choruses.at(-1) === Math.max(...choruses), `${style} saves its longest chorus for last`);
    assert(k.lastIndexOf('b') < k.lastIndexOf('c'), `${style} bridge leads back to a final chorus`);
    // The instrumental is earned time: only a slow song already near 3:30 without it may skip it.
    const bpm = (STYLES[style].bpm[0] + STYLES[style].bpm[1]) / 2;
    assert(count('x') || formSeconds(S, bpm) >= 200, `${style}/${seed} has room for an instrumental`);
    inst += count('x') ? 1 : 0; n++;
    const sketch = songPlan(style, seed, 'sketch').sections.map((x) => x[0]);
    assert(sketch.includes('v') && sketch.includes('c') && !sketch.includes('b'), `${style} sketch is verse and chorus only`);
  }
  assert(inst / n >= 0.75, `most songs earn an instrumental (${inst}/${n})`);
  // Club forms keep their own architecture: intro, breakdown, at least two drops, out.
  for (const style of loopStyles().filter((x) => !SONG_STYLES.has(x) && x !== 'ambient')) {
    const c = songPlan(style, 101).chain, drops = c.match(/G+/g) || [];
    assert(c.startsWith('AAAA') && c.endsWith('A') && c.includes('E') && drops.length >= 2, `${style} club form ${c}`);
  }
  console.log(`long-form section roles passed (${inst}/${n} songs with an instrumental)`);
}

// P3 repetition with development: choruses keep the hook and chords, verse 2 and the last chorus add material,
// the instrumental hands the lead line to the riff, and the rendered last chorus is the densest.
{
  for (const style of SONG_STYLES) for (const seed of SEEDS.slice(0, 3)) {
    const s = buildSong(style, seed), { sections } = songPlan(style, seed, 'song', s.bpm), sp = spans(sections);
    const v = sp.filter((x) => x.k === 'v'), c = sp.filter((x) => x.k === 'c'), x = sp.find((y) => y.k === 'x');
    assert.notEqual(sig(s, v[1].at + v[1].bars - 2), sig(s, v[0].at + v[0].bars - 2), `${style}/${seed} verse 2 develops verse 1`);
    assert.equal(sig(s, c[1].at), sig(s, c[0].at), `${style}/${seed} the second chorus is the same chorus`);
    assert.notEqual(sig(s, c.at(-1).at), sig(s, c[0].at), `${style}/${seed} the last chorus is bigger`);
    if (x) assert.equal(s.patterns[6].at.find((t) => t.b[0] === x.at)?.hook?.h ?? 1, 1, `${style} instrumental plays the riff`);
    if (x) assert(s.patterns[7].at?.some((t) => t.b[0] === x.at), `${style} the instrumental's last bar (H) stays instrumental`);
    if (seed !== SEEDS[0]) continue;
    const { log } = playSong(s), first = hitsPerBar(log, c[0].at, 7), last = hitsPerBar(log, c.at(-1).at, c.at(-1).bars - 1);
    assert(last > first, `${style} last chorus ${last.toFixed(1)} hits/bar > first ${first.toFixed(1)}`);
    assert(hitsPerBar(log, v[1].at, v[1].bars - 1) > hitsPerBar(log, v[0].at, v[0].bars - 1), `${style} verse 2 is fuller than verse 1`);
  }
  // A described song develops its repeats the same way.
  const r = realize({ style: 'pop', prompt: 'a pop song' }, 7);
  assert(r.patterns[6].at?.length, 'a described song develops its last chorus');
  // ...but only with the instruments each of its sections asked for.
  for (const p of r.patterns) for (const t of p.at || []) for (const id of Object.keys(t.steps || {}))
    assert(p.steps[id].some((v) => v && (typeof v !== 'object' || v.on)), `a described song keeps ${id} out of a section that excluded it`);
  // An AI plan that ignores a "demo" request is cut to the sketch form, keeping its chords.
  const long = { style: 'pop', bpm: 120, sections: ['intro', 'verse', 'drop', 'verse', 'drop', 'breakdown', 'drop', 'outro'].map((role) => ({ role, bars: 16, energy: 0.7, chords: ['i', 'VI', 'III', 'VII'] })) };
  const demo = validateSpec(long, { prompt: 'a short pop demo' }), dBars = demo.sections.reduce((a, x) => a + x.bars, 0);
  assert((dBars * 240) / demo.bpm <= 120 && demo.sections.some((x) => x.chords?.length), `a demo prompt gets a sketch (${dBars} bars)`);
  const slow = validateSpec({ ...long, style: 'folk', bpm: 60 }, { prompt: 'a folk demo' }), sBars = slow.sections.reduce((a, x) => a + x.bars, 0);
  assert((sBars * 240) / slow.bpm <= 120, `a slow demo is sized at its own tempo (${sBars} bars at ${slow.bpm})`);
  for (const seed of [1, 2, 3, 4]) {
    const off = localSpec('hyperpop at 80 bpm', { seed }), oBars = off.sections.reduce((a, x) => a + x.bars, 0);
    assert((oBars * 240) / off.bpm >= 175, `an out-of-range tempo is clamped before the form is sized (${oBars} bars at ${off.bpm})`);
  }
  assert.equal(validateSpec(long, { prompt: 'a pop song' }).sections.length, 8, 'a full prompt keeps its plan');
  // Locked tracks are never developed.
  const keep = ['kick', 'ch', 'oh', 'ride', 'perc', 'clap', 'snare'];
  for (const style of SONG_STYLES) {
    const s = buildSong(style, 7), pats = s.patterns.map((p) => ({ ...p, at: undefined }));
    developSong(pats, songPlan(style, 7, 'song', s.bpm).sections, { keep });
    for (const p of pats) for (const t of p.at || []) assert(!keep.some((id) => t.steps?.[id] || t.len?.[id]), `${style} develops a locked track`);
  }
  console.log('long-form development passed');
}

// P4 no loop padding: no stretch of the song is an identical copy of the stretch before it (unless it is one held
// groove bar), and no single bar repeats unchanged for more than 16 bars.
{
  for (const style of loopStyles()) for (const seed of SEEDS) for (const length of ['song', 'sketch']) {
    const s = buildSong(style, seed, length), n = s.chain.length, g = Array.from({ length: n }, (_, i) => sig(s, i));
    let run = 1;
    for (let i = 1; i < n; i++) { run = g[i] === g[i - 1] ? run + 1 : 1; assert(run <= 16, `${style}/${seed} ${length}: bar ${i} repeats ${run}x`); }
    if (!SONG_STYLES.has(style)) continue;
    for (const w of [4, 8, 12, 16, 24, 32]) for (let i = 0; i + 2 * w <= n; i++) {
      const a = g.slice(i, i + w), b = g.slice(i + w, i + 2 * w);
      if (new Set(a).size > 1) assert.notDeepEqual(a, b, `${style}/${seed} ${length}: bars ${i + 1}-${i + 2 * w} loop a ${w}-bar block`);
    }
  }
  console.log('long-form no-padding passed');
}
