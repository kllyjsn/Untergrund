import assert from 'node:assert/strict';
import { generate, sanitize, defaultState, applyOverrides, STYLES } from '../js/state.js';
import { CHORDS, SCALES } from '../js/params.js';
import { SING_PROFILES, MELODY_BARS, melodyScore, strongNote, sings } from '../js/melody.js';
import { buildSong, playSong, melodyShape } from '../scripts/composition.mjs';

const pc = (x) => ((x % 12) + 12) % 12;
const phrasesOf = (list) => { const o = []; for (const x of list) (o[x[4]] ??= []).push(x); return o.filter(Boolean); };

// Vocal-length melodies: 4- or 8-bar phrases, a planned peak, a held last note and a breath, singable rhythm,
// steps with recovered leaps, chord tones on strong beats, and a chorus hook that returns.
let notes = 0, steps = 0, moves = 0, leaps = 0, recovered = 0, strong = 0, tones = 0, grid = 0;
for (const style of Object.keys(SING_PROFILES)) for (const seed of [1, 2, 3, 5, 8, 13]) {
  const g = generate(style, seed, 'minor'), h = g.pattern.hook, m = h.m;
  assert(m && m.bars === MELODY_BARS && m.n.length && m.v.length && m.b.length, `${style}/${seed} sings`);
  assert.deepEqual(generate(style, seed, 'minor').pattern.hook, h, `${style}/${seed} is deterministic`);
  assert.equal(h.s.length, 32, `${style}/${seed} keeps a 32-step preview`);
  const scale = new Set(SCALES.minor.notes.map(pc));
  for (const [id, alt] of [['n', 0], ['v', 0], ['b', 1]]) {
    const prog = (alt && g.pattern.alt) || g.pattern.prog;
    const ph = phrasesOf(m[id]);
    assert(ph.length >= 1 && ph.length <= 2, `${style}/${seed} ${id} has 1-2 phrases`);
    let prevEnd = null;
    for (const q of ph) {
      q.forEach((x, j) => assert.equal(x[5], j, `${style}/${seed} ${id} syllable slots count up`));
      const span = (q.at(-1)[0] + q.at(-1)[1] - q[0][0]) / 16;
      assert(span >= 3 && span <= 8.5, `${style}/${seed} ${id} phrase spans ${span} bars`);
      assert(q.at(-1)[1] >= 4, `${style}/${seed} ${id} phrase ends on a held note`);
      if (prevEnd !== null) assert(q[0][0] - prevEnd >= 4, `${style}/${seed} ${id} breathes between phrases`);
      prevEnd = q.at(-1)[0] + q.at(-1)[1];
      const top = Math.max(...q.map((x) => x[2]));
      assert.equal(q.filter((x) => x[2] === top).length >= 1, true);
      const k = q.findIndex((x) => x[2] === top);
      assert(k > 0 && k < q.length - 1, `${style}/${seed} ${id} peaks inside the phrase`);
      for (let j = 0; j < q.length; j++) {
        const x = q[j];
        notes++; if (x[0] % 2 === 0) grid++;
        assert(scale.has(pc(x[2])), `${style}/${seed} ${id} note ${x[2]} in scale`);
        if (strongNote(x[0], x[1])) {
          strong++;
          const c = prog[Math.floor((((x[0] % 128) + 128) % 128) / 16) % prog.length];
          if (CHORDS[c.c].iv.map((v) => pc(c.r + v)).includes(pc(x[2]))) tones++;
        }
        if (!j) continue;
        const iv = x[2] - q[j - 1][2];
        if (iv) { moves++; if (Math.abs(iv) <= 2) steps++; }
        if (Math.abs(iv) >= 5 && j + 1 < q.length) { leaps++; const nx = q[j + 1][2] - x[2]; if (nx && Math.sign(nx) !== Math.sign(iv) && Math.abs(nx) <= 4) recovered++; }
      }
    }
  }
  // The hook bar returns: the chorus's second phrase opens with the first phrase's first bar.
  const [a, b] = phrasesOf(m.n), bar = (q, at) => q.filter((x) => x[0] >= at && x[0] < at + 16).map((x) => `${x[0] - at}:${x[2]}`).join();
  assert(b && bar(a, 0) && bar(a, 0) === bar(b, 64), `${style}/${seed} chorus hook returns (${bar(a, 0)} / ${b && bar(b, 64)})`);
}
assert(grid / notes >= 0.8, `syllables sit on 8ths and quarters (${(grid / notes).toFixed(2)})`);
assert(steps / moves >= 0.55, `mostly stepwise (${(steps / moves).toFixed(2)})`);
assert(!leaps || recovered / leaps >= 0.7, `leaps recover (${recovered}/${leaps})`);
assert(tones / strong >= 0.9, `strong beats land on chord tones (${tones}/${strong})`);
console.log('vocal-length melodies passed');

// The 32-step hook path stays for techno and old projects: no melody, nothing new in a sanitized old hook.
for (const style of ['hypnotic', 'acid', 'peak', 'dnb', 'jerseyclub', 'dub']) {
  assert(!sings(style) && generate(style, 7).pattern.hook && !generate(style, 7).pattern.hook.m, `${style} keeps its riff`);
}
{
  const s = defaultState(); applyOverrides(s, generate('deephouse', 4));
  const old = JSON.parse(JSON.stringify(s)); delete old.patterns[0].hook.m;
  assert.equal(sanitize(old).patterns[0].hook.m, undefined, 'an old hook stays a 32-step hook');
  assert.deepEqual(sanitize(s).patterns[0].hook.m, s.patterns[0].hook.m, 'a sung hook survives save and share');
  const bad = JSON.parse(JSON.stringify(s)); bad.patterns[0].hook.m = { n: [[999, -4, 90, 7, 'x', null], 'junk'] };
  const fixed = sanitize(bad).patterns[0].hook.m;
  assert.deepEqual(fixed.n, [[127, 1, 36, 1, 0, 0]], 'melody notes are clamped');
}
console.log('legacy hooks passed');

// The singer's score: every part as phrases of numbered syllables with MIDI pitch and beats.
{
  const g = generate('afrobeats', 21), sc = melodyScore(g.pattern.hook, { key: g.key, bpm: g.bpm });
  assert.equal(sc.format, 'untergrund-melody/1');
  for (const part of ['hook', 'verse', 'bridge']) for (const p of sc.parts[part]) {
    assert.equal(p.syllables, p.notes.length);
    p.notes.forEach((n, j) => { assert.equal(n.slot, j); assert(n.midi >= 40 && n.midi <= 96 && n.dur > 0); });
  }
}
console.log('melody score passed');

// In a song the verse sings in C, the chorus in G, the bridge in the breakdown; phrases run 4+ bars with breaths.
for (const style of ['deephouse', 'neosoul', 'trap']) {
  const s = buildSong(style, 307), { log } = playSong(s), m = s.patterns[6].hook.m;
  const lead = log.filter((L) => L.k === 'hook' && !L.a[9]?.harm && !L.a[9]?.counter);
  const sect = (c) => lead.filter((L) => s.chain[Math.floor(L.step / 16)] === c).map((L) => L.a[2]);
  const has = (list, part) => { const ok = new Set(m[part].map((x) => x[2])); return list.every((n) => ok.has(n)); };
  assert(sect('C').length && sect('G').length && sect('E').length, `${style} sings verse, chorus and bridge`);
  assert(has(sect('E'), 'b'), `${style} breakdown sings the bridge`);
  const shape = melodyShape(lead.map((L) => [L.step, Math.max(1, Math.round(L.a[3] / 0.125)), L.a[2]]));
  assert(shape.phraseBars >= 3, `${style} phrases run ${shape.phraseBars} bars`);
}
console.log('sung song passed');
