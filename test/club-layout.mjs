import assert from 'node:assert/strict';
import { clubActions } from '../js/club.js';

const ids = ({ primary, secondary }) => [primary?.id || null, secondary.map((a) => a.id)];
const base = { isHost: false, live: false, canListen: false, queued: false, queueLength: 0 };

assert.deepEqual(ids(clubActions({ ...base, isHost: true })), ['live', []], 'an idle deck offers GO LIVE');
assert.deepEqual(ids(clubActions({ ...base, isHost: true, live: true })), [null, ['rebroadcast']], 'a live DJ has no competing primary');
assert.deepEqual(ids(clubActions({ ...base, isHost: true, live: true, queueLength: 2 })), [null, ['pass', 'rebroadcast']], 'a live DJ with a queue can pass the deck');
assert.deepEqual(ids(clubActions({ ...base, isHost: true, live: true, canListen: true })), ['listen', []], 'a DJ whose deck is live elsewhere rejoins the audio first');
assert.deepEqual(ids(clubActions({ ...base, live: true, canListen: true })), ['listen', ['queue']], 'a new listener taps to listen; the queue is secondary');
assert.deepEqual(ids(clubActions({ ...base, live: true })), ['queue', []], 'a listening guest can join the DJ queue');
assert.deepEqual(ids(clubActions({ ...base, live: true, queued: true })), [null, ['unqueue']], 'leaving the queue is never primary');
assert.deepEqual(ids(clubActions(base)), ['queue', []], 'a guest in a quiet room can queue for the deck');

for (const isHost of [true, false]) for (const live of [true, false]) for (const canListen of [true, false]) for (const queued of [true, false]) for (const queueLength of [0, 1]) {
  const { primary, secondary } = clubActions({ isHost, live, canListen, queued, queueLength });
  assert(!secondary.some((a) => a.id === primary?.id), 'an action is either primary or secondary');
  assert(primary || secondary.length, 'there is always something to do');
}
console.log('club layout passed');
