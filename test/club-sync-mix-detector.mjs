import assert from 'node:assert/strict';
import { mixFixture, mixBoundaries, matchEvents, realignment, phraseOnsets, boundaryMetric, mixFailures, templateKicks } from './club-sync-mix.mjs';
import { postResumeEnvelope } from './club-sync-audio.mjs';

const s = mixFixture();
assert.deepEqual(s, mixFixture());
assert.equal(s.chain, 'AAAABBBBCCCCCCCDGGGGGGGHEEEDGGGGGGGHAAAA');
assert.deepEqual(s.solos, {});
const boundaries = mixBoundaries(s, 100000);
assert.equal(boundaries.find(b => b.section === 'DROP').bar, 8);
const hs = [1000, 1500, 2000, 2500];
for (const delta of [-80, -24, 0, 24, 80]) {
  const stats = matchEvents(hs, hs.map(t => t + delta), 900, 2600);
  assert.equal(stats.signedMedianMs, delta);
  assert.equal(stats.signedP95Ms, delta);
  assert.equal(stats.missing, 0);
  assert.equal(stats.extra, 0);
  assert.equal(realignment({...stats, hostOnsets:hs}, 900), Math.abs(delta) <= 50 ? 1100 + delta : null);
}
const missing = matchEvents(hs, [1020, 2020, 2520, 2300], 900, 2600);
assert.equal(missing.missing, 1); assert.equal(missing.extra, 1);
assert.equal(realignment({...missing, hostOnsets:hs}, 900), null);
const silent = matchEvents(hs, [], 900, 2600);
assert.equal(silent.missing, 4); assert.equal(silent.median, null);
assert.equal(matchEvents([], [], 0, 10000).median, null);
assert.deepEqual(phraseOnsets([], .2), []);
const signal = (shift = 0, wrong = false) => Array.from({length:6000}, (_, i) => {
  const t = i * 2;
  const e = t < 4000 ? .2 + .1 * Math.sin(t / 71) : .6 + .25 * Math.sin(t / (wrong ? 17 : 103));
  return [t + shift, e];
});
for (const offset of [-80, -24, 0, 24, 80]) {
  const b = boundaryMetric(signal(), signal(offset), 4000);
  assert.ok(Math.abs(b.deltaMs - offset) <= 4, JSON.stringify(b));
  assert.equal(b.correctSection, Math.abs(offset) <= 50);
}
assert.equal(boundaryMetric(signal(), signal(0, true), 4000).correctSection, false);
assert.equal(boundaryMetric([], [], 4000).correctSection, false);
const kickSignal = (shift = 0, omit = false) => Array.from({length:3000}, (_, i) => {
  const t = i * 2, age = t % 500;
  return [t + shift, omit && t >= 2000 && t < 2500 ? 0 : Math.exp(-age / 25)];
});
for (const delta of [-80, -24, 0, 24, 80]) {
  const k = templateKicks(kickSignal(), kickSignal(delta), hs, 900, 2600);
  assert.equal(k.median, Math.abs(delta));
  assert.equal(k.missing, 0);
}
assert.equal(templateKicks(kickSignal(), kickSignal(0, true), hs, 900, 2600).missing, 1);
assert.equal(templateKicks(kickSignal(), [], hs, 900, 2600).missing, 4);
const capture = {errors:[], samples:[[1, .2, .3, .4], [2, .5, .6, .7]], anchors:[[1, 1000], [2, 3000]],
  resumeBoundary:{frame:200, sampleRate:100}};
assert.deepEqual(postResumeEnvelope(capture), [[3000, .5]]);
assert.deepEqual(postResumeEnvelope(capture, 3), [[3000, .7]]);
assert.throws(() => postResumeEnvelope({...capture, resumeBoundary:null}), /Missing resume PCM boundary/);
const phrases = Array.from({length:4000}, (_, i) => [i * 2, i % 1000 < 750 ? 1 : 0]);
assert.deepEqual(phraseOnsets(phrases, .25), [0, 2000, 4000, 6000]);
assert.equal(matchEvents(phraseOnsets(phrases, .25), phraseOnsets(phrases.filter(([t]) => t < 4000 || t >= 5500), .25), 0, 7000).missing, 1);
assert.ok(mixFailures({phases:{after:{kicks:silent, vocal:{lagMs:null, returnMs:null}}},
  boundaries:[], timeToRealignMs:null, budgetMs:1500, stemInjected:[[], []]}).length >= 3);
console.log('Full-mix analysis: deterministic song, signed offsets, missing/extra kicks/phrases, realignment, boundary offsets, wrong section and empty audio PASS');
