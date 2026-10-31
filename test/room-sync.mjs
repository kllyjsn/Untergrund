import assert from 'node:assert/strict';
import { roomTransportPosition, transportResync } from '../js/room-sync.js';

const origin = 1_000_000;
const close = (a, b) => assert(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

assert.deepEqual(roomTransportPosition(origin + 1600, 120, origin), { step: 0, delay: 1.6 });

let pos = roomTransportPosition(origin, 120, origin + 1500);
assert.equal(pos.step, 13);
close(pos.delay, 0.125);

pos = roomTransportPosition(origin, 120, origin + 1562.5);
assert.equal(pos.step, 13);
close(pos.delay, 0.0625);

for (const bpm of [122, 138, 150]) {
  for (const elapsed of [10000, 33333, 61234.5]) {
    const now = origin + elapsed;
    const { step, delay } = roomTransportPosition(origin, bpm, now);
    const boundary = origin + step * (15000 / bpm);
    assert(Math.abs(now + delay * 1000 - boundary) < 0.001);
    assert(delay > 0 && delay <= 15 / bpm + 1e-9);
  }
}

assert.equal(transportResync(10.01, 10, 9.9, 0.125), null);
assert.deepEqual(transportResync(10.2, 10, 9.9, 0.125), { skip: 0, nextTime: 10.2 });
assert.deepEqual(transportResync(9.5, 10, 9.9, 0.125), { skip: 4, nextTime: 10 });
assert.deepEqual(transportResync(9.0, 9.0, 9.6, 0.125), { skip: 5, nextTime: 9.625 });

console.log('room transport alignment passed');

const oldOrigin = origin;
const oldBpm = 120;
const newBpm = 150;
const changeAt = origin + 60000;
const currentStep = (changeAt - oldOrigin) / (15000 / oldBpm);
const rebasedOrigin = changeAt - currentStep * (15000 / newBpm);
const before = (changeAt - oldOrigin) / (15000 / oldBpm);
const after = (changeAt - rebasedOrigin) / (15000 / newBpm);
close(before, after);
