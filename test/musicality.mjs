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
}
