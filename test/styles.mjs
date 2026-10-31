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
import { STYLES } from '../js/state.js';
const sigs = new Map();
for (const style of Object.keys(STYLES)) {
  for (const seed of [3, 99]) {
    const g = generate(style, seed, 'minor');
    const [lo, hi] = STYLES[style].bpm;
    assert(g.bpm >= lo && g.bpm <= hi, style);
    assert(STYLES[style].family && STYLES[style].tag, style);
  }
  const g = generate(style, 3, 'minor');
  const sig = JSON.stringify([g.pattern.steps.kick, g.pattern.steps.snare, g.pattern.steps.ch, g.bpm, g.swing ?? 0]);
  assert(!sigs.has(sig), `${style} sounds the same as ${sigs.get(sig)}`);
  sigs.set(sig, style);
}
console.log(`${sigs.size} distinct genres passed`);
