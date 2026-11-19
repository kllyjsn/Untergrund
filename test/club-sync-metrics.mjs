import assert from 'node:assert/strict';
import { transitionAudio } from './club-sync-transition.mjs';
import { diagnose } from './club-sync-diagnostics.mjs';

const rows = Array.from({ length: 2500 }, (_, i) => {
  const t = i * 2;
  return [t, (t >= 1000 && t < 1100) || (t >= 2000 && t < 2100) ? 1 : 0];
});
const transition = transitionAudio(rows, 1500, 2000);
assert.ok(Math.abs(transition.firstDownbeat - 2000) < 80);
assert.equal(transition.interKickGapAcrossActionMs, 1000);
assert.equal(transition.silenceBeforeFirstDownbeatMs, 902);
assert.ok(transition.actionToFirstDownbeatMs >= 500);
for (const silent of [[], [[1000, 0], [2000, 0]]]) {
  const empty = transitionAudio(silent, 1500, 2000);
  assert.equal(empty.firstDownbeat, null);
  assert.equal(empty.silenceBeforeFirstDownbeatMs, null);
  assert.deepEqual(empty.gaps, []);
}
assert.throws(() => transitionAudio(rows, NaN, 2000), /Missing transition times/);
const [diagnostic] = diagnose([{ clockSkew: 0, scheduler: [{ at: 15000, monotonic: 5000, abs: 40, base: .125,
  nextTime: 5.027, transportOrigin: 9997, clockOffset: 9.97, wallOffset: 9.98,
  output: { contextTime: 5, performanceTime: 5000 } }] }], 10000);
assert.equal(diagnostic.originMinusServerMs, -3);
assert.equal(diagnostic.scheduledOutputOffsetMs, 30);
assert.ok(Math.abs(diagnostic.smoothingResidualMs - 10) < .001);
assert.ok(Math.abs(diagnostic.toleranceResidualMs) < .001);
assert.equal(diagnose([{}], 10000)[0].scheduledOutputOffsetMs, null);
console.log('Club transition/diagnostic metrics PASS: downbeat, inter-kick/silence gaps, empty/silent/error, known output-clock decomposition.');
