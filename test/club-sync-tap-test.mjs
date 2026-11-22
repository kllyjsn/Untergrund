import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BPM, KICK_STEPS, STEP_MS } from './club-sync-audio.mjs';
import { missedFirstMixDownbeat } from './club-sync-mix.mjs';
import { schedulerTapEnvelope, tapFirstDownbeat, tapFixtureEvidence } from './club-sync-tap.mjs';

const origin = 100000;
const positions = Array.from({ length: 3 }, (_, n) => KICK_STEPS.flatMap((steps, bar) =>
  steps.map(step => (n * 64 + bar * 16 + step) * STEP_MS))).flat();
const rows = (shift = 0, omit = false) => Array.from({ length: 12000 }, (_, i) => {
  const t = i * 2;
  const last = positions.filter(p => p + shift <= t && !(omit && p === positions[8])).at(-1);
  return [origin + t, last === undefined ? 0 : Math.exp(-(t - last - shift) / 25)];
});
const capture = (delay = 0, skew = 0) => {
  const samples = rows(delay).map(([t, e]) => [(t - origin) / 1000, e]);
  return { errors: [], clockSkew: skew, scheduler: [{ transportOrigin: origin + skew, clockOffset: (origin + skew) / 1000 }],
    samples, anchors: [[0, origin + 1000]], channels: { kick: { samples, ready: true, edge: {} } },
    sources: [{ when: delay / 1000 }] };
};
const host = capture(), listener = capture();
assert.deepEqual(schedulerTapEnvelope(host, origin), rows());
assert.deepEqual(schedulerTapEnvelope(capture(0, 2000), origin), rows());
const clockJump = capture();
clockJump.scheduler.push({ transportOrigin: origin, clockOffset: origin / 1000 + .06 });
clockJump.anchors.push([10, origin + 11060]);
assert.deepEqual(schedulerTapEnvelope(clockJump, origin), rows());
const coldClock = capture();
coldClock.scheduler = [
  {at:0, transportOrigin:origin, clockOffset:origin / 1000 - .5},
  {at:2000, transportOrigin:origin, clockOffset:origin / 1000},
  {at:4000, transportOrigin:origin, clockOffset:origin / 1000 + .06},
];
coldClock.sources = [{at:2500, tag:'kick', when:0}];
assert.deepEqual(schedulerTapEnvelope(coldClock, origin), rows());
assert.equal(tapFirstDownbeat([host, listener], origin, BPM).status, 'aligned');
const delayed = capture(60);
assert.equal(delayed.sources[0].when - listener.sources[0].when, .06);
const shifted = tapFirstDownbeat([host, delayed], origin, BPM);
assert.equal(shifted.status, 'displaced');
assert.ok(missedFirstMixDownbeat(shifted));
assert.ok(Math.abs(shifted.deltaMs - 60) < 3);
console.log(`Tap gate synthetic scheduled listener kick +60ms: delta=${shifted.deltaMs}ms; displaced; FAIL as required`);
const silent = capture();
silent.channels.kick.samples = silent.samples.map(([t]) => [t, 0]);
assert.equal(tapFirstDownbeat([host, silent], origin, BPM).status, 'absent');
assert.ok(missedFirstMixDownbeat(tapFirstDownbeat([host, silent], origin, BPM)));
const from = origin + 500, to = origin + 22000;
assert.equal(tapFixtureEvidence(rows(), origin, from, to).missing, 0);
assert.equal(tapFixtureEvidence(rows(130), origin, from, to).missing, 0);
const absent = tapFixtureEvidence(rows(0, true), origin, from, to);
assert.equal(absent.absentAt.length, 1);
assert.equal(absent.displaced.length, 0);
const moved = rows().map(([t, e]) => [t + (Math.abs(t - origin - positions[8]) < 200 ? 80 : 0), e])
  .sort((a, b) => a[0] - b[0]);
const displacement = tapFixtureEvidence(moved, origin, from, to);
assert.equal(displacement.absentAt.length, 0);
assert.equal(displacement.displaced.length, 1);
assert.equal(displacement.missing, 1);
assert.ok(tapFixtureEvidence([], origin, from, to).absentAt.length > 0);
assert.throws(() => schedulerTapEnvelope({ ...host, scheduler: [] }, origin), /Missing scheduler/);
assert.throws(() => schedulerTapEnvelope({ ...host, samples: [] }, origin), /No rendered/);
assert.throws(() => schedulerTapEnvelope({ ...host, errors: ['unsupported route'] }, origin), /unsupported route/);
assert.throws(() => schedulerTapEnvelope(host, NaN), /Missing server/);
assert.throws(() => schedulerTapEnvelope(host, origin, 'vocal'), /Missing rendered vocal/);
assert.throws(() => tapFixtureEvidence(rows(), NaN, from, to), /Missing server/);
console.log('Tap timing tests PASS: fixed mapping, skew, 60ms scheduling regression, absent/displaced RMS, one-to-one fixture matching, empty/error.');

for (const path of process.argv.slice(2)) {
  const saved = JSON.parse(await readFile(path, 'utf8'));
  for (const r of saved.results.filter(r => r.spec.coldDownbeat)) {
    const tap = tapFirstDownbeat(r.raw.captures, r.events.initial.startsAt, BPM);
    assert.equal(missedFirstMixDownbeat(tap), false, JSON.stringify(tap));
    console.log(`${r.name}: Chrome=${(r.chromeFirstDownbeat ?? r.firstDownbeat).deltaMs.toFixed(3)}ms; tap=${tap.deltaMs.toFixed(3)}ms; ${tap.status}; PASS`);
  }
  for (const r of saved.results.filter(r => r.name === 'replay' && r.raw.captures[0].scheduler)) {
    const at = r.events.newSet.startsAt;
    const taps = r.raw.captures.map(c => schedulerTapEnvelope(c, at));
    const result = tapFixtureEvidence(taps[0], at, Math.max(at, ...taps.map(e => e[0][0])) + 500,
      Math.min(...taps.map(e => e.at(-1)[0])) - 100);
    assert.equal(result.missing, 0, JSON.stringify(result));
    console.log(`replay ${r.run}: tap expected=${result.expected}; absent=${result.absentAt.length}; displaced=${result.displaced.length}; Chrome missing=${r.chromeHostFixture?.missing ?? r.hostFixture.missing}; PASS`);
  }
}
