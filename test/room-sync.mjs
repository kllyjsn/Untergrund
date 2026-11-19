import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRoomClock, roomTransportPosition, shiftRoomSet, syncAudioClock, transportResync, calibrateRoomClock, slewTransport } from '../js/room-sync.js';
import { freshSong, clone, sanitize, STYLES } from '../js/state.js';
import { songFingerprint } from '../js/listen.js';
import { createRoomMediaSync, roomMediaLead } from '../js/room-media-sync.js';

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

{
  const clock = createRoomClock({wall:() => origin, monotonic:() => 0});
  const observe = (from, latency, offset) => clock.observe([origin + from + latency / 2 + offset, origin + from + latency / 2 + offset], from, from + latency);
  observe(0, 4, 0);
  observe(20000, 20, 100);
  observe(31000, 100, 500);
  assert.equal(clock.shift(), 0, 'ageing past 30s cannot replace a fast sample with an outlier');
  observe(61000, 200, 999);
  assert.equal(clock.shift(), 100, 'expiration selects the fastest remaining sample, not the newest outlier');
  for (let i = 1; i <= 16; i++) observe(62000 + i * 100, 30, i);
  assert.equal(clock.shift(), 1, 'the window retains at most sixteen observations');
  clock.observe([NaN, origin], 1, 2);
  assert.equal(clock.shift(), 1, 'invalid samples cannot corrupt the window');
}

{
  let now = 0;
  const calls = [];
  const initial = {snapshot:{sessionToken:'cold'}, latency:330};
  const result = await calibrateRoomClock(initial, async (token, timeout) => {
    calls.push({token, timeout});
    const latency = [320, 290, 18][calls.length - 1];
    assert(timeout >= latency, 'warm probes use latency-scaled rather than 250ms timeouts');
    now += latency;
    return {snapshot:{sessionToken:`warm${calls.length}`}, latency};
  }, () => now);
  assert.equal(result.sessionToken, 'warm3');
  assert.equal(calls.length, 3, 'a fast sample stops calibration early');
  assert.equal(calls[1].token, 'warm1');
  assert(now <= 1500);
  assert.equal(await calibrateRoomClock({...initial, latency:2}, () => assert.fail('fast joins do not need extra probes')), initial.snapshot);
  now = 0;
  assert.equal(await calibrateRoomClock(initial, async (_, timeout) => {
    now += timeout;
    throw new Error('timeout');
  }, () => now), initial.snapshot, 'failed probes preserve the initial snapshot');
  assert(now <= 1500, 'calibration has a bounded total deadline');
  let empty = 0;
  assert.equal(await calibrateRoomClock(initial, async () => { empty++; return null; }, () => 0), initial.snapshot);
  assert.equal(empty, 4, 'empty responses cannot cause unlimited probes');
}

{
  close(slewTransport(10.02, 10), 10.0015);
  close(slewTransport(9.98, 10), 9.9985);
  assert.equal(slewTransport(10, 10), 10);
  assert.equal(slewTransport(10.2, 10), 10, 'large corrections remain transportResync work');
  let at = 10;
  for (let i = 0; i < 20; i++) at = slewTransport(10.02, at);
  close(at, 10.02);
}

{
  const source = await readFile(new URL('../js/club.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export class RoomBus'), source.indexOf('\nlet parkedBus')).replace('export class', 'class');
  const RoomBus = runInNewContext(`${body}\nRoomBus`, {shiftRoomSet, normalizeMember:x => x,
    sessionStorage:{setItem(){}}, Date});
  for (const clientId of ['host', 'listener']) {
    let shift = -200;
    const corrections = [], events = [];
    const set = {broadcastId:'live', startsAt:origin, version:1};
    const bus = Object.assign(Object.create(RoomBus.prototype), {clientId, user:{}, members:new Map(), seq:0,
      roomClock:{shift:() => shift}, currentSet:{...set, startsAt:origin + 200}, currentSetKey:'server:1',
      serverOrigin:{broadcastId:'live', startsAt:origin}, hostId:'host', appliedBroadcasts:new Set(['live']),
      initiatedSets:new Set(), onClock:value => corrections.push(value), onEvent:value => events.push(value), emit(){}});
    bus.applySnapshot({currentSet:set, hostId:'host'});
    assert.equal(corrections.length, 0);
    shift = -20;
    bus.applySnapshot({currentSet:set, hostId:'host'});
    assert.equal(bus.currentSet.startsAt, origin + 20);
    assert.equal(corrections.length, 1, `${clientId} is notified despite same-version dedupe`);
    assert.equal(events.length, 0, 'clock correction does not rebroadcast or replay the set');
    shift = 0;
    bus.applySnapshot({hostId:'host'});
    assert.equal(bus.currentSet.startsAt, origin, 'omitted known-set bodies still allow re-anchoring');
    assert.equal(corrections.length, 2);
    shift = 1;
    bus.applySnapshot({hostId:'host'});
    assert.equal(corrections.length, 2, 'sub-threshold jitter is ignored');
    bus.serverOrigin.broadcastId = 'old';
    shift = 100;
    bus.applySnapshot({hostId:'host'});
    assert.equal(corrections.length, 2, 'another broadcast cannot move the current grid');
  }
}
{
  const source = await readFile(new URL('../js/club.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export class RoomBus'), source.indexOf('\nlet parkedBus')).replace('export class', 'class');
  for (const mode of ['warm', 'error', 'closed', 'empty', 'fast']) {
    let requests = 0, release;
    const snapshots = [], latencies = [];
    const reply = name => ({ok:true, json:async () => ({name, clock:[], sessionToken:name})});
    const RoomBus = runInNewContext(`${body}\nRoomBus`, {Date, AbortController, setTimeout, clearTimeout,
      calibrateRoomClock, performance:{now:() => 0}, fetch:async () => {
        requests++;
        if (requests === 1) return mode === 'empty' ? {ok:false} : reply('initial');
        if (requests === 2) return new Promise((resolve, reject) => { release = () => mode === 'error' ? reject(new Error('offline')) : resolve(reply('warm')); });
        throw new Error('offline');
      }});
    const bus = Object.assign(Object.create(RoomBus.prototype), {clientId:'listener', user:{}, token:'', apiBase:'/remote',
      endpoint:path => path, known:() => ({}), receive(){}, applySnapshot:s => snapshots.push(s.name),
      roomClock:{observe:() => { const latency = mode === 'fast' || latencies.length ? 5 : 330; latencies.push(latency); return latency; }}});
    await bus.heartbeat(true);
    assert.deepEqual(snapshots, mode === 'empty' ? [] : ['initial'], `${mode}: ready adopts the first estimate without waiting for warm calibration`);
    if (mode === 'fast' || mode === 'empty') {
      assert.equal(requests, 1, `${mode}: no unnecessary calibration traffic`);
    } else {
      assert.equal(requests, 2, 'warm calibration can remain in flight while playback starts');
      if (mode === 'closed') bus.closed = true;
      release();
    }
    await bus.calibration;
    assert.deepEqual(snapshots, mode === 'warm' ? ['initial', 'warm'] : mode === 'empty' ? [] : ['initial'],
      `${mode}: later samples update the playing origin, but failures or a closed room cannot replace it`);
    if (mode === 'warm') assert.deepEqual(latencies, [330, 5]);
  }
}
console.log('Room join latency PASS: first estimate starts playback while bounded warm calibration runs; fast, empty, failed and closed-room probes are safe.');
console.log('Room clock calibration PASS: bounded recent minimum, adaptive probes, same-broadcast host/listener re-anchor and per-step slew.');

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

for (const bpm of [40, 80, 123, 180, 240]) for (const residual of [-0.030, -0.028, 0.028, 0.030]) {
  const stepSec = 15 / bpm;
  let target = 10, nextTime = target + residual, steps = 0, rate = 1;
  while (Math.abs(nextTime - target) > 0.002 + 1e-9 || rate !== 1) {
    const fix = transportResync(target, nextTime, nextTime - stepSec - 0.01, stepSec, false, -Infinity, rate);
    assert.equal(fix.slew, true);
    assert.equal(fix.skip, 0);
    assert.equal(fix.discard, false);
    assert.ok(Math.abs(fix.nextTime - nextTime) / stepSec < 0.01);
    assert.equal(fix.rate, rate);
    assert.ok(Math.abs(fix.endRate - rate) <= stepSec * .016 + 1e-12, 'rate ramps smoothly at a bounded slope');
    assert.ok(Math.abs(fix.endRate - 1) <= .008 + 1e-12);
    assert.ok((fix.endRate - 1) * residual >= 0, 'no rate reversal or overshoot oscillation');
    close((stepSec + fix.nextTime - nextTime) * (rate + fix.endRate) / 2, stepSec);
    rate = fix.endRate;
    nextTime = fix.nextTime + stepSec;
    target += stepSec;
    steps++;
    assert.ok(steps * stepSec < 5, 'small room residuals converge within five seconds');
  }
}
assert.equal(transportResync(10.001, 10, 9, .125, false, -Infinity, 1), null);
assert.equal(transportResync(10.02, 10, 9.9, .125, false, -Infinity, 1), null, 'do not slew an interval already rendering');
assert.deepEqual(transportResync(10.2, 10, 9.9, .125, false, -Infinity, 1), { skip: 0, nextTime: 10.2, discard: false });
console.log('Room residual slew PASS: both signs, 40–240 BPM, smooth bounded rates, phase-locked steps, unity within <5s, floor and render guard.');

{
  const correction = transportResync(10.75, 11.5, 10, 0.125, false, -4);
  assert.equal(correction.discard, true, 'an earlier room grid cancels the old lookahead before rescheduling');
  assert.equal(correction.skip, -4, 'rewind future steps without crossing the current song origin');
  close(correction.nextTime, 10.25);
  assert.deepEqual(transportResync(11.4, 11.5, 10, 0.125), {skip:0, nextTime:11.4, discard:false}, 'a sub-step correction keeps ordered queued notes');
}

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
const stopSource = main.slice(main.indexOf('function roomStartPending()'), main.indexOf('\nfunction recordPlayback'));
for (const [action, currentTime, playing, expected] of [
  ['stop', 1.8, true, ['discard@1.8', 'timer', 'panic']],
  ['cancelRoomStart', 1.8, true, ['discard@1.8', 'timer', 'panic']],
  ['cancelRoomStart', 1.8, false, ['timer']],
  ['stop', 2.1, true, ['timer', 'panic']],
  ['cancelRoomStart', 2.1, true, []],
]) {
  const calls = [], noop = () => {};
  const sandbox = {
    playing, roomFirstNote: playing ? 2 : null, roomPlayback: true, roomEditor: false, roomJoinTimer: 1, roomResume: noop, mediaRoute: null,
    ctx: {currentTime}, engine: {editableHits: [], discardQueuedNotes: t => calls.push(`discard@${t}`), panic: () => calls.push('panic'), cancelJamParams: noop},
    playbackStats: {end: noop}, trackingReplay: false, listens: {end: noop}, listenPos: noop, songOver: false,
    clearPaused: noop, endTuning: noop, clearTimeout: () => calls.push('timer'), handoff: null,
    jamQueue: [], guardPushOffer: noop, playStopped: noop, timer: null, midiClockStop: noop,
    uiQueue: [], setPlayhead: noop, timeline: {frame: noop}, lastPlayedPat: null, seq: null, artistLive: null,
    document: {body: {classList: {remove: noop}}, querySelectorAll: () => []},
    renderPatterns: noop, renderHome: noop, releaseMedia: noop, syncNowPlaying: noop,
  };
  runInNewContext(`${stopSource}\n${action}()`, sandbox);
  assert.deepEqual(calls, expected, `${action} at audio time ${currentTime} (playing: ${playing})`);
  assert.equal(sandbox.playing, playing && !expected.length);
}
const joinSource = main.slice(main.indexOf('function joinRoomSet('), main.indexOf('\nfunction startRoomBroadcast'));
function roomJoin(change = () => {}, options = {}) {
  const state = freshSong('hypnotic', 7, { length:'sketch', bpm:123 });
  state.artist = {name:'Sync fixture', title:'Seed 7', style:'hypnotic', seed:7};
  state.sing = {on:true, voice:'gwen', db:0, ms:0};
  const item = {state:clone(state), startsAt:origin, style:'hypnotic', title:'New DJ'};
  const calls = [], analytics = [], timers = [], starts = [];
  const engine = {state, editableHits:[{}], vocalNow:{source:'continuous'}, stepDur:.125};
  const seq = {s:state, origin:0, queued:null};
  const sandbox = {state, engine, seq, playing:true, roomPlayback:true, roomEditor:true, artistLive:null, handoff:null, jamQueue:[], mediaRoute:null,
    transportOrigin:origin, vocalGridDirty:false, style:'hypnotic', songOrigin:{}, STYLES, sanitize, clone, songFingerprint,
    roomStatsItem:null, playbackSources:new WeakMap(), playbackStats:{end:(outcome) => analytics.push(outcome)},
    ctx:{currentTime:8}, abs:65, nextTime:8.125, recordPlayback:(source) => analytics.push(source),
    Date:{now:() => origin + 8000}, ROOM_LEAD:.42, roomJoinTimer:0, stopTimeline(){}, joinRoomReplay(){calls.push('replay');},
    replaceState(){calls.push('replace');}, play({startsAt}){calls.push('play'); starts.push(startsAt);}, build(){}, persist(){}, syncNowPlaying(){}, toast(){},
    setTimeout(fn, delay){calls.push('timer'); return timers.push({fn, delay});}, ...options};
  change(item, sandbox);
  const join = runInNewContext(`${joinSource}\njoinRoomSet`, sandbox);
  join(item);
  return {calls, sandbox, item, join, analytics, timers, starts};
}
{
  const {calls, timers, starts, item} = roomJoin((_, s) => { s.playing = false; }, {Date:{now:() => origin - 1600}});
  assert.deepEqual(calls, ['replace', 'timer']);
  assert.equal(timers[0].delay, 1180, 'cold join starts with a scheduler lookahead before the downbeat');
  timers[0].fn();
  assert.deepEqual(starts, [item.startsAt], 'earlier startup still uses the published grid origin');
}
{
  const {calls, starts} = roomJoin((_, s) => { s.playing = false; }, {Date:{now:() => origin - 300}});
  assert.deepEqual(calls, ['replace', 'play'], 'a join already inside the lookahead starts without waiting');
  assert.deepEqual(starts, [origin]);
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
{
  const {calls, sandbox, analytics} = roomJoin((item, s) => {
    item.broadcastId = 'live';
    s.roomStatsItem = {broadcastId:'live'};
    item.startsAt += 235;
  });
  assert.deepEqual(calls, [], 'a large same-broadcast correction never restarts playback');
  assert.equal(sandbox.transportOrigin, origin + 235);
  assert.equal(sandbox.vocalGridDirty, true, 'the continuous vocal must follow the corrected grid');
  assert.equal(sandbox.engine.vocalNow.source, 'continuous');
  assert.deepEqual(analytics, [], 'clock corrections keep the active play');
}
assert.deepEqual(roomJoin(i => { delete i.state; }).calls, []);
assert.deepEqual(roomJoin(i => { i.replay = {}; }).calls, ['replay']);
console.log('Room continuity PASS: role-only rebroadcast retains vocal/scheduler; changed song, vocal, origin, queued edits, replay and stopped transport still join normally.');
{
  let builds = 0;
  const { item, join, sandbox, calls } = roomJoin((i, s) => {
    Object.assign(i, { broadcastId: 'a:1', version: 1, by: 'a' });
    s.roomMediaSync.begin(i, false, false, s.mediaRoute);
    s.roomMediaSync.start(true, s.mediaRoute);
  }, {
    mediaRoute: {}, roomMediaSync: createRoomMediaSync(), roomMediaLead, build: () => builds++,
  });
  assert.equal(builds, 1);
  join({ ...item }, { initial: true });
  assert.equal(builds, 1, 'an already-playing media-route set is a complete no-op');
  assert.equal(sandbox.roomStatsItem, item);
  sandbox.roomResume();
  assert.equal(builds, 2, 'wake rejoin bypasses initial duplicate suppression even inside the window');
  join({ ...item, by: 'b' });
  assert.equal(builds, 3, 'role-only DJ handoff still reaches continuity handling');
  const update = clone(item);
  update.broadcastId = 'a:2'; update.version++;
  update.state.patterns[0].steps.kick[0] = update.state.patterns[0].steps.kick[0] ? 0 : 1;
  join(update);
  assert.deepEqual(calls, ['replace', 'play'], 'UPDATE ROOM still applies changed music');
}
console.log('Room media joins PASS: duplicate ignored; DJ handoff and UPDATE ROOM still apply.');
for (const mediaRoute of [null, {}]) {
  let delay;
  roomJoin(i => { i.startsAt += 9000; }, {
    mediaRoute, roomMediaSync: createRoomMediaSync(), roomMediaLead,
    setTimeout: (fn, wait) => { delay = wait; },
  });
  assert.equal(delay, mediaRoute ? 540 : 580, 'future listener starts retain main\'s lookahead plus route lead');
}
