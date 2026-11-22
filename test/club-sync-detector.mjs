import assert from 'node:assert/strict';
import { onsets, envelope, postResumeEnvelope, resolvedCompare, fixtureMissing, BPM, STEP_MS, PERIOD_MS, KICK_STEPS } from './club-sync-audio.mjs';
import { analyzeMix, mixFixture } from './club-sync-mix.mjs';

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
for (const sign of [-1, 1]) {
  const kick = onsets(host, BPM).find(t => t > origin + (sign < 0 ? 9000 : 20000));
  const shifted = signal(sign * 16).map(([t, e]) => [t + (Math.abs(t - kick) < 200 ? sign * 12.4 : 0), e])
    .sort((a, b) => a[0] - b[0]);
  const result = resolvedCompare(host, shifted, sign < 0 ? kick - 20.7 : from, sign > 0 ? kick + 20.7 : to);
  assert.equal(result.missing, 0, `Guard boundary ${sign}: ${JSON.stringify(result)}`);
  const pair = result.pairs.find(p => p.host === kick);
  assert.ok(pair && Math.abs(pair.delta - sign * 28.4) < .01);
  assert.ok(sign < 0 ? pair.listener < result.from : pair.listener > result.to);
}
const fixtureEnd = origin + PERIOD_MS * 2 + positions[5] + 10;
const clipped = signal(130).filter(([t]) => t <= fixtureEnd + 100);
const boundaryFixture = fixtureMissing(clipped, origin, from, fixtureEnd);
assert.equal(boundaryFixture.missing, 0, JSON.stringify(boundaryFixture));
assert.ok(boundaryFixture.outputOffsetMs > 120);
assert.deepEqual(onsets([], BPM), []);
assert.deepEqual(onsets([[0, 0], [1, 0]], BPM), []);
assert.equal(resolvedCompare([], [], 0, 10000).median, null);
assert.ok(resolvedCompare(host, [], from, to).missing > 0);
assert.throws(() => envelope({ errors: [], anchors: [], samples: [] }), /No rendered audio/);
assert.throws(() => envelope({ errors: ['route error'] }), /route error/);
assert.deepEqual(envelope({ errors: [], anchors: [[1, 10000]], samples: [[1.5, .2]] }), [[10500, .2]]);
const wakeCapture = { errors: [], anchors: [[7.20, origin - 15062], [7.262, origin - 83]],
  resumeBoundary: { contextTime: 7.262, sampleRate: 1000, frame: 7262 },
  samples: [...Array.from({ length: 9 }, (_, i) => [7.245 + i * .002, 3 * Math.exp(-i * 2 / 10)]),
    ...host.map(([t, e]) => [7.345 + (t - origin) / 1000, e])] };
const wakeFrom = origin - 120;
const contaminated = resolvedCompare(host, envelope(wakeCapture), wakeFrom, to);
assert.equal(contaminated.missing, 1);
assert.equal(contaminated.extra, 1);
const cleanWake = postResumeEnvelope(wakeCapture);
assert.ok(cleanWake[0][0] >= origin - .001);
const resumed = resolvedCompare(host, cleanWake, wakeFrom, to);
assert.equal(resumed.missing, 0);
assert.equal(resumed.extra, 0);
assert.ok(resumed.max < .001);
for (const staleTime of [7.1, 7.2]) {
  const staleCapture = { ...wakeCapture, anchors: [wakeCapture.anchors[0], [staleTime, origin - 15062], wakeCapture.anchors[1]] };
  const staleMapped = wakeCapture.samples.filter(([t]) => t >= 7.262)
    .map(([t, e]) => [wakeCapture.anchors[0][1] + (t - 7.2) * 1000, e]);
  const staleOnsets = onsets(staleMapped, BPM);
  assert.ok(onsets(host, BPM).filter(t => t >= wakeFrom && t <= to)
    .some(t => staleOnsets.every(l => Math.abs(l - t) > 50)));
  const fixed = resolvedCompare(host, postResumeEnvelope(staleCapture), wakeFrom, to);
  assert.equal(fixed.missing, 0);
  assert.equal(fixed.extra, 0);
  assert.ok(fixed.max < .001);
}
assert.throws(() => envelope({ errors: [], anchors: [[NaN, 10000]], samples: [[1.5, .2]] }), /No rendered audio/);
assert.throws(() => postResumeEnvelope({}), /Missing resume PCM boundary/);
assert.throws(() => postResumeEnvelope({ ...wakeCapture, samples: [] }), /No rendered audio/);
assert.throws(() => postResumeEnvelope({ ...wakeCapture, errors: ['route error'] }), /route error/);
const tailCapture = (hits, frame = 500) => {
  const samples = Array.from({ length: 1000 }, (_, i) => {
    const t = i * 2, last = hits.filter(hit => hit <= t).at(-1);
    const level = last === undefined ? 0 : Math.exp(-(t - last) / 190);
    return [t / 1000, level, level];
  });
  const channel = { ready: true, edge: 1, samples };
  return { errors: [], anchors: [[0, origin]], scheduler:[{transportOrigin:origin, clockOffset:origin / 1000}], resumeBoundary: { sampleRate: 1000, frame },
    samples, channels: { kick: channel, vocal: channel } };
};
const mix = mixFixture(), wake = { interruptAt: origin + 200, recoverAt: origin + 500 };
const wakeKicks = (host, listener) => analyzeMix([host, listener], mix, wake, origin).phases.after.kicks;
const continuousHost = tailCapture([450, 980, 1470]), resumedListener = tailCapture([980, 1470]);
assert.equal(wakeKicks(continuousHost, resumedListener).matched, 2);
assert.equal(wakeKicks(continuousHost, resumedListener).missing, 0, 'Cropping the host tail fabricates a miss');
assert.equal(wakeKicks(continuousHost, tailCapture([1470])).missing, 1, 'A real missed kick still counts');
const nearCut = wakeKicks(tailCapture([504, 990], 560), tailCapture([504, 990]));
assert.equal(nearCut.matched, 2, 'A genuine attack before the delayed host marker still counts');
assert.ok(nearCut.pairs[0].host >= origin + 504 && nearCut.pairs[0].host < origin + 530);
console.log('Wake boundary PASS: pre-freeze frame at 7.245s maps after recovery but is excluded by 7.262s PCM boundary; false missing/extra 1/1 → 0/0.');
console.log('Stale output anchors PASS: repeated/backward context times cannot trap post-wake mapping on the pre-freeze clock; zero missing/extra.');
console.log(`Detector tests PASS: self=0ms; whole-step/beat/bar and ±2000ms unaliased; dropout missing=${gap.missing}; both guard-straddling pairs matched; fixture bounds use rendered time; fixture rests not missing; silence/empty/error; output-clock mapping.`);
