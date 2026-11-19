import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRoomClock, roomTransportPosition, shiftRoomSet, syncAudioClock, transportResync } from '../js/room-sync.js';
import { freshSong, clone, sanitize, STYLES } from '../js/state.js';
import { songFingerprint } from '../js/listen.js';

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

{
  const clock = createRoomClock({ wall: () => origin + 2000 + 200, monotonic: () => 200 });
  assert.equal(clock.observe([origin + 101, origin + 103], 100, 162), 60);
  assert.equal(clock.shift(), -2029, 'cold response with asymmetric delay biases the first offset');
  assert.equal(clock.observe([origin + 165, origin + 165], 163, 167), 4);
  assert.equal(clock.shift(), -2000, 'warm sample removes the startup bias before a set is adopted');
  assert.equal(clock.observe([origin + 171, origin + 171], 170, 200), 30);
  assert.equal(clock.shift(), -2000, 'a slower response does not replace the warm sample');
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
assert.deepEqual(transportResync(10.2, 10, 9.9, 0.125), { skip: 0, nextTime: 10.2, discard: false });
assert.deepEqual(transportResync(9.5, 10, 9.9, 0.125), { skip: 4, nextTime: 10, discard: false });
assert.deepEqual(transportResync(9.0, 9.0, 9.6, 0.125), { skip: 5, nextTime: 9.625, discard: false });

{
  const before = syncAudioClock(null, 1000);
  assert.deepEqual(before, { offset: 1000, jumped: false });
  const jitter = syncAudioClock(before.offset, 1000.02);
  assert.equal(jitter.jumped, false);
  close(jitter.offset, 1000.001);

  const wake = syncAudioClock(jitter.offset, 1015);
  assert.deepEqual(wake, { offset: 1015, jumped: true });
  assert.deepEqual(transportResync(1011.5 - wake.offset, 11.5, 10, 0.125, wake.jumped), { skip: 108, nextTime: 10, discard: true, firstTime: 10.005 });
  assert.equal(syncAudioClock(wake.offset, 1015.02).jumped, false);

  const short = syncAudioClock(before.offset, 1000.25);
  assert.deepEqual(transportResync(1011.5 - short.offset, 11.5, 10, 0.125, short.jumped), { skip: -10, nextTime: 10, discard: true, firstTime: 10.005 });
  const stall = syncAudioClock(before.offset, 1000.8);
  const recovery = transportResync(1011.475 - stall.offset, 11.5, 10, 0.125, stall.jumped);
  assert.equal(recovery.discard, true);
  assert.equal(recovery.skip, -5);
  close(recovery.nextTime, 10.05);
  assert.equal(transportResync(recovery.nextTime, recovery.nextTime, 10, 0.125), null);
}

{
  const late = transportResync(9.955, 11.5, 10, 0.125, true, 0);
  assert.deepEqual(late, { skip: 0, nextTime: 9.955, discard: true, firstTime: 10.005 });
  close(late.nextTime + 0.125, 10.08);
  const missed = transportResync(9.945, 11.5, 10, 0.125, true, 0);
  assert.equal(missed.skip, 1);
  assert.equal(missed.firstTime, undefined);
  close(missed.nextTime, 10.07);
  const fast = transportResync(9.965, 11.5, 10, 0.0625, true, 0);
  assert.equal(fast.skip, 1, 'a fast song does not crowd the next step to recover a late one');
  close(fast.nextTime, 10.0275);
}

{
  const songOrigin = 64, nextStep = 68;
  const recovery = transportResync(10.75, 11.5, 10, 0.125, true, songOrigin - nextStep);
  assert.equal(recovery.skip, -4, 'a landed handoff cannot rewind into the outgoing song');
  assert.equal(nextStep + recovery.skip, songOrigin);
  close(recovery.nextTime, 10.25);
  assert.equal(recovery.discard, true);
  const ordinary = transportResync(10.75, 11.5, 10, 0.125, true, -nextStep);
  assert.equal(ordinary.skip, -6, 'lookahead within the current song can still rewind');
  const long = transportResync(-3.5, 11.5, 10, 0.125, true, songOrigin - nextStep);
  assert.equal(long.skip, 108, 'the origin bound does not change long-stall forward skips');
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

const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
const joinSource = main.slice(main.indexOf('function joinRoomSet(item)'), main.indexOf('\nfunction startRoomBroadcast'));
function roomJoin(change = () => {}, options = {}) {
  const state = freshSong('hypnotic', 7, { length:'sketch', bpm:123 });
  state.artist = {name:'Sync fixture', title:'Seed 7', style:'hypnotic', seed:7};
  state.sing = {on:true, voice:'gwen', db:0, ms:0};
  const item = {state:clone(state), startsAt:origin, style:'hypnotic', title:'New DJ'};
  const calls = [], analytics = [];
  const engine = {state, editableHits:[{}], vocalNow:{source:'continuous'}, stepDur:.125};
  const seq = {s:state, origin:0, queued:null};
  const sandbox = {state, engine, seq, playing:true, roomPlayback:true, roomEditor:true, artistLive:null, handoff:null, jamQueue:[],
    transportOrigin:origin, style:'hypnotic', songOrigin:{}, STYLES, sanitize, clone, songFingerprint,
    roomStatsItem:null, playbackSources:new WeakMap(), playbackStats:{end:(outcome) => analytics.push(outcome)},
    ctx:{currentTime:8}, abs:65, nextTime:8.125, recordPlayback:(source) => analytics.push(source),
    Date:{now:() => origin + 8000}, stopTimeline(){}, joinRoomReplay(){calls.push('replay');},
    replaceState(){calls.push('replace');}, play(){calls.push('play');}, build(){}, persist(){}, syncNowPlaying(){}, toast(){},
    setTimeout(){calls.push('timer');}, ...options};
  change(item, sandbox);
  const join = runInNewContext(`${joinSource}\njoinRoomSet`, sandbox);
  join(item);
  return {calls, sandbox, item, join, analytics};
}
{
  const {calls, sandbox, item, analytics} = roomJoin((item, s) => {
    item.state.artist.title = 'Same song, new DJ';
    item.state.current = 1;
    s.state.current = 2;
    s.seq.origin = 64;
    s.transportOrigin -= 64 * 15000 / s.state.bpm;
    item.startsAt += .75;
  });
  assert.deepEqual(calls, [], 'same song and running origin do not stop or restart playback');
  assert.equal(sandbox.state.artist.title, item.state.artist.title);
  assert.equal(sandbox.state.current, 2, 'chain playback retains the current pattern');
  assert.equal(sandbox.engine.state, sandbox.state);
  assert.equal(sandbox.seq.s, sandbox.state);
  assert.equal(sandbox.engine.vocalNow.source, 'continuous');
  assert.equal(sandbox.roomEditor, false, 'the former DJ becomes a listener');
  assert.equal(sandbox.engine.editableHits.length, 0);
  assert.equal(analytics[0], 'skip');
  assert.equal(analytics[1].surface, 'club', 'a seamless DJ handoff starts capturing the former host as a listener');
  sandbox.roomResume();
  assert.deepEqual(calls, [], 'resuming the same active room does not rebuild its transport');
  assert.equal(analytics.length, 2, 'resyncing the same broadcast keeps one play');
}
for (const change of [
  (i) => { i.startsAt += 31; },
  (i) => { i.state.bpm++; },
  (i) => { i.state.patterns[0].steps.kick[0] = i.state.patterns[0].steps.kick[0] ? 0 : 1; },
  (i) => { i.state.chain += 'B'; },
  (i) => { i.state.params.kick.level = .01; },
  (i) => { i.state.sing.on = false; },
  (i) => { i.state.sing.voice = 'other'; },
  (i) => { i.state.sing.ms = 100; },
  (i) => { i.state.artist.seed++; },
  (i) => { i.state.artist.style = i.style = 'hardtechno'; },
  (i, s) => { s.playing = false; },
  (i, s) => { s.roomPlayback = false; },
  (i, s) => { s.artistLive = {}; },
  (i, s) => { s.handoff = {}; },
  (i, s) => { s.seq.queued = 1; },
  (i, s) => { s.jamQueue.push({}); },
  (i, s) => { i.state.chainOn = s.state.chainOn = false; i.state.current = 1; },
]) assert.deepEqual(roomJoin(change).calls, ['replace', 'play'], 'changed music/origin or inactive transport takes the normal join path');
assert.deepEqual(roomJoin(i => { delete i.state; }).calls, []);
assert.deepEqual(roomJoin(i => { i.replay = {}; }).calls, ['replay']);
console.log('Room continuity PASS: role-only rebroadcast retains vocal/scheduler; changed song, vocal, origin, queued edits, replay and stopped transport still join normally.');
