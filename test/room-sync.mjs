import assert from 'node:assert/strict';
import { createRoomClock, roomTransportPosition, shiftRoomSet, syncAudioClock, transportResync } from '../js/room-sync.js';

const origin = 1_000_000;
const close = (a, b) => assert(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

{
  let now = 100;
  const host = createRoomClock({ wall: () => origin + now - 1500, monotonic: () => now });
  const guest = createRoomClock({ wall: () => origin + now + 2000, monotonic: () => now });
  assert.equal(host.shift(), 0, 'offline and older room servers keep local timestamps');
  for (const clock of [host, guest]) {
    clock.observe([origin + 110, origin + 210], 100, 220);
    clock.observe([origin + 600, origin + 610], 500, 625);
    clock.observe([origin + 700, origin + 710], 720, 715);
  }
  now = 800;
  assert.equal(host.shift(), 1500);
  assert.equal(guest.shift(), -2000);
  const hostSet = { startsAt: origin + now - 1500 + 1600, orderAt: origin + now - 1500, bpm: 120 };
  const wire = shiftRoomSet(hostSet, host.shift());
  const listenerSet = shiftRoomSet(wire, -guest.shift());
  for (const elapsed of [200, 1400, 2300, 4860]) {
    const djNow = hostSet.orderAt + elapsed;
    const guestNow = listenerSet.orderAt + elapsed;
    assert.deepEqual(roomTransportPosition(hostSet.startsAt, 120, djNow), roomTransportPosition(listenerSet.startsAt, 120, guestNow));
  }
  assert.equal(shiftRoomSet(hostSet, 0), hostSet, 'local BroadcastChannel path does not translate timestamps');
}

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

{
  const before = syncAudioClock(null, 1000);
  assert.deepEqual(before, { offset: 1000, jumped: false });
  const jitter = syncAudioClock(before.offset, 1000.02);
  assert.equal(jitter.jumped, false);
  close(jitter.offset, 1000.001);

  const wake = syncAudioClock(jitter.offset, 1015);
  assert.deepEqual(wake, { offset: 1015, jumped: true });
  assert.deepEqual(transportResync(1011.5 - wake.offset, 11.5, 10, 0.125), { skip: 109, nextTime: 10.125 });
  assert.equal(syncAudioClock(wake.offset, 1015.02).jumped, false);
}

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
