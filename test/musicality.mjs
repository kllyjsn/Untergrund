import assert from 'node:assert/strict';
import { generate, arrangement, sanitize, defaultState, STYLES } from '../js/state.js';
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
