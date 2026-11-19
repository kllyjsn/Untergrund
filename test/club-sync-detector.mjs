import assert from 'node:assert/strict';
import { onsets, envelope, resolvedCompare, fixtureMissing, BPM, STEP_MS, PERIOD_MS, KICK_STEPS } from './club-sync-audio.mjs';

const origin = 100000;
const positions = KICK_STEPS.flatMap((bar, b) => bar.map(s => (b * 16 + s) * STEP_MS));
const signal = (shift = 0, omit = false) => Array.from({ length: 15000 }, (_, i) => {
  const t = i * 2, phase = t % PERIOD_MS;
  const prior = positions.filter(p => p <= phase).at(-1) ?? positions.at(-1) - PERIOD_MS;
  const silent = omit && t >= 10000 && t <= 15000;
  return [origin + t + shift, silent ? 0 : Math.exp(-(phase - prior) / 25)];
});
const host = signal(), from = origin + 4000, to = origin + 26000;
assert.ok(onsets(host, BPM).length >= 50);
assert.equal(resolvedCompare(host, host, from, to).max, 0);
for (const offset of [STEP_MS, STEP_MS * 4, STEP_MS * 16, 2000, -2000]) {
  const result = resolvedCompare(host, signal(offset), from, to);
  assert.ok(Math.abs(result.signedLagMs - offset) <= 4, JSON.stringify(result));
  assert.ok(Math.abs(result.median - Math.abs(offset)) <= 4);
  assert.equal(result.missing, 0);
  console.log(`Detector irregular-pattern offset ${offset.toFixed(3)}ms → signed lag ${result.signedLagMs}ms; median |Δ|=${result.median.toFixed(3)}ms; missing=0`);
}
const gap = resolvedCompare(host, signal(0, true), from, to);
assert.ok(gap.missing >= 8);
assert.ok(gap.gaps.some(g => g.missing >= 8 && g.durationMs >= 4000));
assert.equal(fixtureMissing(host, origin, from, to).missing, 0);
assert.deepEqual(onsets([], BPM), []);
assert.deepEqual(onsets([[0, 0], [1, 0]], BPM), []);
assert.equal(resolvedCompare([], [], 0, 10000).median, null);
assert.ok(resolvedCompare(host, [], from, to).missing > 0);
assert.throws(() => envelope({ errors: [], anchors: [], samples: [] }), /No rendered audio/);
assert.throws(() => envelope({ errors: ['route error'] }), /route error/);
assert.deepEqual(envelope({ errors: [], anchors: [[1, 10000]], samples: [[1.5, .2]] }), [[10500, .2]]);
console.log(`Detector tests PASS: self=0ms; whole-step/beat/bar and ±2000ms unaliased; dropout missing=${gap.missing}; fixture rests not missing; silence/empty/error; output-clock mapping.`);
