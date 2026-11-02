import assert from 'node:assert/strict';
import { generate, arrangement, sanitize, defaultState, STYLES, MUSICIAN_PRINCIPLES } from '../js/state.js';
import { SCALES } from '../js/params.js';

// Every club/pop style gets its own seeded hook; NEO-SOUL and BOOM BAP keep their Rhodes licks.
for (const style of Object.keys(STYLES)) {
  const a = generate(style, 11, 'minor'), b = generate(style, 22, 'minor');
  if (style === 'neosoul' || style === 'boombap') { assert.equal(a.pattern.hook, undefined, style); continue; }
  assert(a.pattern.hook && a.pattern.hook.s.length === 32, `${style} needs a hook`);
  const notes = a.pattern.hook.s.filter(Boolean);
  assert(notes.length >= 4, `${style} hook too sparse`);
  const pcs = new Set(SCALES.minor.notes.map((n) => n % 12));
  for (const [n] of notes) assert(pcs.has(((n % 12) + 12) % 12), `${style} hook note ${n} out of scale`);
  assert.notDeepEqual(a.pattern.hook.s, b.pattern.hook.s, `${style} hooks repeat across seeds`);
}
console.log('seeded hooks passed');

assert.deepEqual(Object.keys(MUSICIAN_PRINCIPLES), ['listen', 'respond', 'space', 'develop', 'risk', 'remember']);
for (const style of ['hypnotic', 'deephouse', 'euphoric', 'afrobeats', 'trap']) {
  const hook = generate(style, 84).pattern.hook;
  assert(hook.x && Object.values(hook.x).every((n) => n > 0 && n < 1), `${style} needs an expression plan`);
  assert.notDeepEqual(hook.s.slice(0, 16), hook.s.slice(16), `${style} answer should develop the call`);
  const velocities = new Set(hook.s.filter(Boolean).map((n) => n[2].toFixed(2)));
  assert(velocities.size >= 3, `${style} needs a dynamic phrase`);
}
console.log('musician principles and expression plans passed');

// Seeds change the key, and the groove bass is written per seed rather than picked from a fixed line.
const keys = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => generate('deephouse', seed).key));
assert(keys.size >= 4, 'keys should vary across seeds');
for (const style of ['deephouse', 'ukg', 'afrobeats']) {
  const lines = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(generate(style, seed).pattern.steps.acid)));
  assert(lines.size >= 4, `${style} bass lines repeat across seeds`);
}
console.log('per-seed key and bass passed');

{
  const g = generate('deephouse', 42);
  const scenes = arrangement(g.pattern, 42);
  assert.deepEqual(scenes.map((p) => p.hm), [0, 0, 1, 2, 2, 1, 2, 2], 'hook is held back for the intro');
  const s = defaultState(); s.patterns = scenes;
  const round = sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round.patterns[6].hook, g.pattern.hook);
  assert.equal(round.patterns[0].hm, 0);
}
console.log('hook arrangement and save round-trip passed');

// Neighbouring genres must not share one template: different rooms, lead roles and hook writing.
{
  const g = (st) => generate(st, 21);
  for (const st of ['trap', 'drill', 'reggaeton', 'ukg', 'dnb', 'hyperpop']) {
    assert(g(st).master.revLevel <= 0.4, `${st} should be drier than the ambient/trance room`);
  }
  for (const [a, b] of [['ukg', 'deephouse'], ['dnb', 'euphoric'], ['amapiano', 'afrobeats'], ['hyperpop', 'trance'], ['trap', 'reggaeton']]) {
    const A = g(a), B = g(b);
    const sig = (x) => [x.pattern.hook?.v, x.pattern.hook?.o, x.master.revLevel, x.params.stab.voice, x.params.acid.voice, x.bpm].join('|');
    assert.notEqual(sig(A), sig(B), `${a} and ${b} share a sound signature`);
    const rhythm = (x) => x.pattern.hook.s.map(Boolean).join('');
    assert.notEqual(rhythm(A), rhythm(B), `${a} and ${b} hooks share a rhythm`);
  }
console.log('genre signatures passed');

// A genre is a musical grammar, not one fixed preset. Different seeds should
// recruit different players and registers without borrowing another genre's drums or harmony.
  {
    for (const style of Object.keys(STYLES)) {
      const ensembles = new Set();
      for (let seed = 1; seed <= 24; seed++) {
        const g = generate(style, seed);
        ensembles.add([
          g.params.stab.voice,
          g.params.acid.voice,
          g.params.stab.octave,
        ].join('/'));
      }
      assert(ensembles.size >= 4, `${style} needs several seeded ensembles`);
    }
    const recorded = new Set();
    for (const style of Object.keys(STYLES)) {
      for (let seed = 1; seed <= 24; seed++) {
        const voice = generate(style, seed).params.stab.voice;
        if (voice >= 7) recorded.add(voice);
      }
    }
    assert.deepEqual([...recorded].sort((a, b) => a - b), [7, 8, 9, 10], 'all recorded families should appear across generated songs');
    for (const style of ['trap', 'drill']) {
      for (let seed = 1; seed <= 24; seed++) assert.equal(generate(style, seed).params.acid.voice, 2, `${style} must keep its sliding 808`);
    }
    for (const style of ['bailefunk', 'jerseyclub']) {
      for (let seed = 1; seed <= 24; seed++) assert.notEqual(generate(style, seed).params.acid.voice, 4, `${style} must not borrow amapiano's log drum`);
    }
    for (const style of Object.keys(STYLES)) {
      for (let seed = 1; seed <= 24; seed++) {
        const g = generate(style, seed);
        if (g.params.stab.voice === 6) assert(g.params.stab.octave <= 1, `${style} bells are already voiced one octave high`);
        if ([3, 4].includes(g.params.stab.voice)) assert(g.params.stab.octave >= 0, `${style} organ/brass must stay out of the sub register`);
        if (g.params.stab.voice >= 7) assert(g.params.stab.octave >= 0, `${style} recorded chords must not fold into clustered voicings`);
      }
    }
    for (const style of ['industrial', 'acid', 'peak', 'hardtechno']) {
      for (let seed = 1; seed <= 24; seed++) assert(generate(style, seed).pattern.steps.stab.some(Boolean), `${style} ensembles need audible chord steps`);
    }
    for (let seed = 1; seed <= 24; seed++) {
      assert.equal(generate('trance', seed).params.acid.voice, 0, 'trance must keep its rolling 303');
      assert.notEqual(generate('electro', seed).params.acid.voice, 3, 'electro must not borrow the DnB Reese');
      assert.equal(generate('ambient', seed).params.acid.voice, 1, 'ambient bass must avoid an 808 pitch knock');
      const ukg = generate('ukg', seed);
      if (ukg.params.stab.voice === 3) assert(ukg.params.stab.decay <= 0.3, 'UK garage organ must stay gated');
    }
    assert(new Set(Array.from({ length: 24 }, (_, i) => generate('neosoul', i + 1).params.stab.voice)).has(1), 'neo-soul needs Rhodes/keys');
  }
console.log('seeded instrument ensembles passed');
}
