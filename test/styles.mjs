import assert from 'node:assert/strict';
import { generate, defaultState, applyOverrides, sanitize } from '../js/state.js';

for (const seed of [1, 7, 42, 1337]) {
  const g = generate('euphoric', seed, 'major');
  assert(g.bpm >= 126 && g.bpm <= 134);
  assert(g.pattern.steps.vox.some(Boolean), 'euphoric needs vocal chops');
  assert(g.swing > 0);
  const s = defaultState();
  s.patterns[0] = g.pattern;
  applyOverrides(s, g);
  assert.equal(s.swing, g.swing);
  const round = sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round.patterns[0].steps.vox, g.pattern.steps.vox);
}
assert.equal(sanitize({ patterns: [], scale: 'major' }).scale, 'major');
console.log('euphoric style and VOX track passed');
