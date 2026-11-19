import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRoomMediaSync, roomMediaLead, roomMediaTime, ROOM_MEDIA_LEAD } from '../js/room-media-sync.js';
import { roomTransportPosition, syncAudioClock, transportResync } from '../js/room-sync.js';

const route = {};
assert.equal(ROOM_MEDIA_LEAD, .04);
assert.equal(roomMediaLead(true, null), 0);
assert.equal(roomMediaLead(false, route), 0);
assert.equal(roomMediaLead(true, route), ROOM_MEDIA_LEAD);
for (const time of [0, -0, NaN, Infinity, -Infinity, .04, 10.1, 1e12]) {
  assert(Object.is(roomMediaTime(time, true, null), time), 'destination times are bit-identical');
  assert(Object.is(roomMediaTime(time, false, route), time), 'solo media-route times are unchanged');
}
let now = 1000;
const sync = createRoomMediaSync(() => now);
const item = { broadcastId: 'a:1', version: 1, startsAt: 1000, by: 'a', state: {} };
const warming = createRoomMediaSync();
warming.begin(item, false, false, route);
warming.remember(item);
warming.begin(item, false, false, route);
warming.start(true, route);
assert.equal(warming.horizon(.42, true, route), 4, 'a repeated join while band/vocal tuning preserves the first cold prime');
warming.start(true, route);
assert.equal(warming.horizon(.42, true, route), .42);
sync.start(true, null);
assert.equal(sync.horizon(.42, true, null), .42);
sync.start(false, route);
assert.equal(sync.horizon(.42, false, route), .42);
sync.begin(item, false, false, route);
sync.start(true, route);
assert.equal(sync.horizon(.42, true, route), 4);
assert.equal(sync.horizon(.42, true, route), .42);
sync.start(true, route);
assert.equal(sync.horizon(1.5, true, route), 1.5, 'a transport restart does not re-prime');
assert.equal(sync.horizon(1.5, true, route), 1.5);
assert.equal(sync.duplicate(item, true, true, route), false);
sync.begin(item, false, false, route);
sync.start(true, route);
sync.remember(item);
assert.equal(sync.duplicate({ ...item }, true, true, route), true);
for (const changed of [null, {}, { ...item, replay: {} }, { ...item, state: null },
  { ...item, broadcastId: 'a:2' }, { ...item, version: 2 }, { ...item, startsAt: 1001 }, { ...item, by: 'b' }])
  assert.equal(sync.duplicate(changed, true, true, route), false, 'updates, handoffs and invalid sets still join');
assert.equal(sync.duplicate(item, false, true, route), false);
assert.equal(sync.duplicate(item, true, false, route), false);
assert.equal(sync.duplicate(item, true, true, null), false);
now += 251;
assert.equal(sync.duplicate(item, true, true, route), false, 'initial duplicate window expires');
for (const next of [item, { ...item, version: 2 }, { ...item, broadcastId: 'a:2' }]) {
  sync.begin(next, false, false, route);
  sync.start(true, route);
  assert.equal(sync.horizon(.42, true, route), .42, 'wake/reconnect, including a changed set, never re-primes');
}
item.version++;
assert.equal(sync.duplicate(item, true, true, route), false, 'identity is snapshotted before a mutable item changes');

const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
const schedule = main.slice(main.indexOf('function schedule(lead)'), main.indexOf('\n// Jam:'));
const start = main.slice(main.indexOf('function start({'), main.indexOf('\nfunction stop('));
function transport(mediaRoute, room = true) {
  const hits = [], vocals = [];
  const noop = () => {};
  const s = { mediaRoute, roomMediaSync: createRoomMediaSync(), roomMediaTime, roomMediaLead,
    roomTransportPosition, syncAudioClock, transportResync, BG_LEAD: 1.5, ROOM_LEAD: .42,
    playing: true, songOver: false, roomPlayback: room, roomEditor: false, roomResume: null,
    roomJoinTimer: 0, handoff: null, jamQueue: [], trackingReplay: false, playbackSources: new WeakMap(), state: { bpm: 120, current: 0 },
    ctx: { currentTime: 10 }, Date: { now: () => 1000000 }, nextTime: 0, abs: 0,
    transportOrigin: 0, clockOffset: null, uiQueue: [],
    engine: { stepDur: .125, prepareVocal: noop, editableHits: [], discardQueuedNotes: noop,
      vocal: (t, bar, step, gridTime) => vocals.push({ t, gridTime }) },
    seq: { origin: 0, cur: 0, chainPos: 1, songBars: 4, startAt: noop,
      tick: (abs, t, gridTime) => { hits.push({ abs, t, gridTime }); return 0; } },
    document: { hidden: false, body: { classList: { add: noop } }, querySelectorAll: () => [] },
    clearPaused: noop, stopPreview: noop, closePractice: noop, ensureAudio: noop,
    recordPlayback: noop, pat: () => ({}), timer: { postMessage: noop },
    midiClockStart: noop, midiClockStep: noop, syncNowPlaying: noop,
    timeline: { skip: () => 0 }, artistTick: noop,
  };
  const api = runInNewContext(`${schedule}\n${start}\n({start,schedule})`, s);
  s.roomMediaSync.begin(item, false, false, mediaRoute);
  api.start({ startsAt: 1000100, room });
  return { s, api, hits, vocals };
}
const desktop = transport(null), media = transport(route), solo = transport(route, false);
assert.equal(desktop.s.transportOrigin, 1000100);
assert.equal(media.s.transportOrigin, desktop.s.transportOrigin, 'shared wall origin must not be advanced twice');
assert.equal(desktop.hits.length, 3, 'normal room queue remains 420 ms');
assert.equal(media.hits.length, 32, 'only the initial media room queue covers four seconds');
for (let i = 0; i < desktop.hits.length; i++) {
  assert.equal(desktop.hits[i].t, 10.1 + i * .125, 'legacy desktop expression is bit-identical');
  assert.equal(media.hits[i].t, desktop.hits[i].t - ROOM_MEDIA_LEAD);
  assert.equal(media.hits[i].gridTime, media.hits[i].t, 'vocal grid receives the same advanced deadline');
}
assert.equal(solo.hits[0].t, desktop.hits[0].t, 'non-room media playback has no lead');
assert.equal(solo.hits[0].gridTime, undefined);
assert.equal(media.s.roomMediaSync.horizon(.42, true, route), .42);
for (const t of [desktop, media]) {
  Object.assign(t.s, { transportOrigin: 999800, abs: 2, nextTime: 14, clockOffset: 0 });
  t.api.schedule();
}
assert.equal(media.vocals[0].gridTime, desktop.vocals[0].gridTime - ROOM_MEDIA_LEAD, 'resync vocal grid advances too');
assert.equal(media.vocals[0].t, desktop.vocals[0].t - ROOM_MEDIA_LEAD);
const broadcast = main.slice(main.indexOf('function startRoomBroadcast('), main.indexOf('\nfunction showClub('));
for (const mediaRoute of [null, route]) {
  let delay;
  const go = runInNewContext(`${broadcast}\nstartRoomBroadcast`, {
    playing: false, roomJoinTimer: 0, mediaRoute, roomMediaLead,
    Date: { now: () => 1000 }, clearTimeout() {},
    setTimeout: (fn, wait) => { delay = wait; },
  });
  go(2000);
  assert.equal(delay, mediaRoute ? 900 : 940, 'future DJ starts retain the original margin plus route lead');
}
console.log('Room media sync PASS: desktop bit identity, 40ms route-only lead, one cold-only 4s queue, bounded initial duplicate window, wake/reconnect never re-prime.');
