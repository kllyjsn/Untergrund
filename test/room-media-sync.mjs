import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRoomMediaSync, roomMediaLead, roomMediaTime, ROOM_MEDIA_LEAD } from '../js/room-media-sync.js';
import { roomTransportPosition, syncAudioClock, transportResync, slewTransport, roomTransportCorrection } from '../js/room-sync.js';
import { Engine } from '../js/engine.js';

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
for (const normal of [.42, 1.5]) {
  const jam = createRoomMediaSync(() => 1000), jamSet = { ...item, state: { patterns: [{}] } };
  jam.begin(jamSet, false, false, route);
  jam.start(true, route);
  assert.equal(jam.horizon(normal, true, route), 4, 'jam-capable rooms retain the cold prime');
  jam.remember(jamSet);
  assert.equal(jam.duplicate(jamSet, true, true, route), true, 'cold duplicate guard does not depend on priming');
}
const score = createRoomMediaSync();
score.begin({ ...item, state: { patterns: [{ score: 'written' }] } }, false, false, route);
score.start(true, route);
assert.equal(score.horizon(.42, true, route), 4, 'non-jammable scores retain the one-time cold prime');
score.queued(4, [{ t: 4.5 }]);
assert.equal(score.cancel(4.25), true, 'priming stays active until delayed sources beyond the last grid step start');
assert.equal(score.cancel(4.3), false, 'cancellation consumes the primed queue');
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
function transport(mediaRoute, room = true, roomItem = item) {
  const hits = [], vocals = [];
  const noop = () => {};
  const s = { mediaRoute, roomMediaSync: createRoomMediaSync(), roomMediaTime, roomMediaLead,
    roomTransportPosition, syncAudioClock, transportResync, BG_LEAD: 1.5, ROOM_LEAD: .42,
    slewTransport, roomTransportCorrection, roomDrainUntil: null, roomAudioClock: null, vocalGridDirty: false,
    performance: { now: () => s.ctx.currentTime * 1000 },
    playing: true, songOver: false, queuedRoomReplay: null, roomPlayback: room, roomEditor: false, roomResume: null, roomFirstNote: null,
    roomJoinTimer: 0, handoff: null, jamQueue: [], trackingReplay: false, playbackSources: new WeakMap(), state: { bpm: 120, current: 0 },
    ctx: { currentTime: 10 }, Date: { now: () => 1000000 }, nextTime: 0, abs: 0,
    transportOrigin: 0, clockOffset: null, uiQueue: [],
    engine: { stepDur: .125, prepareVocal: noop, slewVocal: noop, editableHits: [], discardQueuedNotes: noop, cancelJamParams: noop,
      vocal: (t, bar, step, gridTime) => vocals.push({ t, gridTime }) },
    seq: { origin: 0, cur: 0, chainPos: 1, songBars: 4, startAt: noop,
      tick: (abs, t, gridTime) => { hits.push({ abs, t, gridTime }); return 0; } },
    document: { hidden: false, body: { classList: { add: noop } }, querySelectorAll: () => [] },
    clearPaused: noop, stopPreview: noop, closePractice: noop, ensureAudio: noop,
    recordPlayback: noop, pat: () => ({}), timer: { postMessage: noop },
    midiClockStart: noop, midiClockStep: noop, syncNowPlaying: noop, beginListen: noop, listenPos: noop,
    playStarted: noop, renderHome: noop, style: 'test',
    timeline: { skip: () => 0 }, artistTick: noop,
  };
  const api = runInNewContext(`${schedule}\n${start}\n({start,schedule})`, s);
  s.roomMediaSync.begin(roomItem, false, false, mediaRoute);
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
for (const mediaRoute of [null, route]) {
  const { s, api } = transport(mediaRoute);
  const switches = [];
  s.songOver = true;
  s.queuedRoomReplay = { startsAt: 1000300 };
  s.switchRoomReplay = at => { switches.push(at); s.queuedRoomReplay = null; };
  api.schedule();
  assert(Math.abs(switches[0] - (mediaRoute ? 10.26 : 10.3)) < 1e-9);
  let canceled = 0;
  s.engine.cancelJamParams = () => canceled++;
  const at = mediaRoute ? 10.46 : 10.5;
  api.start({ startsAt: 1000500, switchAt: at, room: true });
  assert.equal(s.nextTime, at, 'a replay switch already has its compensated audio boundary');
  assert.equal(canceled, 0, 'a future replay must retain its handoff mix instead of applying it now');
  assert.equal(s.roomMediaSync.active(10), false, 'the old startup queue is no longer primed');
}
console.log('Room media replay PASS: latest-main replay boundaries keep the route lead once and retain future handoff controls; desktop unchanged.');
assert.equal(solo.hits[0].gridTime, undefined);
const jamTransport = transport(route, true, { ...item, state: { patterns: [{}] } });
assert.equal(jamTransport.hits.length, media.hits.length, 'jam-capable join retains four seconds of priming');
for (let i = 0; i < desktop.hits.length; i++)
  assert.equal(jamTransport.hits[i].t, desktop.hits[i].t - ROOM_MEDIA_LEAD, 'jam rooms retain the route lead');
console.log('Room jam startup PASS: jam-capable joins retain the one-time 4s prime and route lead.');
assert.equal(media.s.roomMediaSync.horizon(.42, true, route), .42);
for (const t of [desktop, media]) {
  Object.assign(t.s, { transportOrigin: 999800, abs: 2, nextTime: 14, clockOffset: 988,
    roomAudioClock: { at: 8, contextTime: 10, pending: null } });
  t.api.schedule();
}
assert.equal(media.vocals[0].gridTime, desktop.vocals[0].gridTime - ROOM_MEDIA_LEAD, 'resync vocal grid advances too');
assert.equal(media.vocals[0].t, desktop.vocals[0].t - ROOM_MEDIA_LEAD);
for (const bpm of [120, 240]) for (const mediaRoute of [null, route]) {
  const { s, api } = transport(mediaRoute), landed = [];
  const base = 60 / bpm / 4, lead = roomMediaLead(true, mediaRoute);
  Object.assign(s, { abs: 16, transportOrigin: 1000000 - 16 * base * 1000,
    clockOffset: 990, nextTime: 10 - lead, jamQueue: [{ wall: 1000000 }],
    landJamParts: (wall, t) => {
      assert.equal(wall, (10 + 990) * 1000 + base * 500, 'jam cutoff retains the unshifted wall grid');
      if (s.jamQueue[0].wall <= wall) { landed.push(t); s.jamQueue.length = 0; }
    },
  });
  s.ctx.currentTime = 9.8;
  s.Date.now = () => 999800;
  s.state.bpm = bpm;
  s.engine.stepDur = base;
  api.schedule(.3);
  assert.deepEqual(landed, [10 - lead], 'jam lands on its intended bar, including above 187.5 BPM');
}
console.log('Room jam cutoff PASS: wall-aligned at 120/240 BPM; route audio stays 40ms early; desktop cutoff unchanged.');
const cancelSource = main.slice(main.indexOf('function roomStartPending('), main.indexOf('\nfunction recordPlayback('));
const replaceSource = main.slice(main.indexOf('function replaceState('), main.indexOf('\nfunction showPublish('));
for (const action of ['stop', 'replaceState', 'start']) for (const mode of ['primed', 'desktop', 'jam', 'expired']) {
  const { s, api, hits } = transport(mode === 'desktop' ? null : route, true,
    mode === 'jam' ? { ...item, state: { patterns: [{}] } } : item);
  const noop = () => {}, parameter = () => ({ cancelScheduledValues: noop, setTargetAtTime: noop });
  const sources = hits.map(({ t }) => ({ t, stopped: Infinity,
    src: { stop(time) { this.note.stopped = time; }, note: null } }));
  for (const note of sources) note.src.note = note;
  const engine = Object.assign(Object.create(Engine.prototype), {
    ctx: s.ctx, queuedNotes: [...sources], editableHits: [], ducks: [],
    acidNodes: { env: { offset: parameter() }, o1: { frequency: parameter() }, o2: { frequency: parameter() }, vca: { gain: parameter() } },
    gatedBasses: new Map(), duck: { gain: parameter() }, rumbleDuck: { gain: parameter() }, ch: { acid: {} },
    vocalStop: noop, acidRelease: noop, handoffCancel: noop, breakOpen: noop, riserStop: noop, setThrow: noop,
    applyAll: noop, prepareVocal: noop, state: s.state,
  });
  let discarded = 0;
  engine.discardQueuedNotes = (now) => { discarded++; Engine.prototype.discardQueuedNotes.call(engine, now); };
  Object.assign(s, { engine, playbackStats: { end: noop }, listens: { end: noop }, listenPos: noop,
    endTuning: noop, guardPushOffer: noop, playStopped: noop, midiClockStop: noop,
    setPlayhead: noop, artistLive: null, renderPatterns: noop, renderHome: noop,
    releaseMedia: noop, build: noop, persist: noop, clearTimeout: noop, timeline: { frame: noop, skip: () => 0 },
  });
  s.document.body.classList.remove = noop;
  s.ctx.currentTime = mode === 'expired' ? s.nextTime + 1 : 10.1;
  s.Date.now = () => (s.ctx.currentTime + 990) * 1000;
  const end = runInNewContext(`${cancelSource}\n${replaceSource}\n({stop,replaceState})`, s);
  if (action === 'start') api.start({ startsAt: s.Date.now() + 100, room: true });
  else if (action === 'replaceState') end.replaceState({ bpm: 100 });
  else end.stop();
  const primed = mode === 'primed' || mode === 'jam';
  assert.equal(discarded, primed ? 1 : 0, `${action}: no new discard outside an active primed queue`);
  for (const note of sources) {
    assert.equal(note.stopped, primed && note.t > s.ctx.currentTime ? s.ctx.currentTime : Infinity,
      `${action}: only future primed sources are stopped; desktop/unprimed paths retain legacy behavior`);
    if (primed && note.t > s.ctx.currentTime)
      assert(note.stopped < note.t, 'Web Audio stop before scheduled start prevents any future onset');
  }
}
console.log('Room prime cancellation PASS: real Engine queue discard prevents future starts on stop, set replacement and restart, including jam rooms; desktop and expired-prime paths unchanged.');
const jamSource = main.slice(main.indexOf('function refreshJamPrime('), main.indexOf('\n// GENERATE while'));
for (const mediaRoute of [null, route]) for (const kind of ['snapshot', 'late', 'future', 'beyond', 'expired', 'draining']) {
  const { s, hits, vocals } = transport(mediaRoute, true, { ...item, state: { patterns: [{}] } });
  const noop = () => {}, tasks = [], sources = hits.map(h => ({ ...h, layer: 'old', stopped: Infinity }));
  const makeSource = note => { note.src = { stop: t => { note.stopped = t; } }; return note; };
  sources.forEach(makeSource);
  const end = s.nextTime;
  Object.assign(s, { jamReschedule: false, jamRedraw: 0,
    queueMicrotask: task => tasks.push(task), applyPart: (state, part, layer) => { state[part] = layer; },
    setTimeout: noop, cancelAnimationFrame: noop, requestAnimationFrame: noop,
    engine: { ...s.engine, queuedNotes: [...sources], applyAll: noop, scheduleJamParams: noop,
      discardQueuedNotes: function(t) { for (const note of this.queuedNotes) if (note.t > t) note.src.stop(t); this.queuedNotes.length = 0; },
    },
  });
  s.seq.rewind = abs => { s.seq.chainPos = Math.floor(abs / 16) + (abs % 16 ? 1 : 0); };
  s.seq.tick = (abs, t) => {
    const note = makeSource({ abs, t, layer: s.state.kick || 'old', stopped: Infinity });
    sources.push(note); s.engine.queuedNotes.push(note); return 0;
  };
  const jam = runInNewContext(`${jamSource}\n({landJamPart,queueJamPart,landJamParts})`, s);
  s.landJamParts = jam.landJamParts;
  s.ctx.currentTime = kind === 'expired' ? end + 1 : 10.1;
  s.Date.now = () => (s.ctx.currentTime + 990) * 1000;
  if (kind === 'draining') s.roomDrainUntil = end;
  if (kind === 'snapshot' || kind === 'expired' || kind === 'draining') { jam.landJamPart('kick', 'new'); jam.landJamPart('bass', 'new'); }
  else jam.queueJamPart('kick', 'new', kind === 'late' ? 1000000 : kind === 'future' ? 1002100 : 1010000);
  const boundary = s.nextTime, replaced = mediaRoute && kind !== 'beyond' && kind !== 'expired';
  assert.equal(tasks.length, replaced ? 1 : 0, 'snapshot layers coalesce before the next redraw; desktop/far-future edits do not requeue');
  for (const task of tasks) task();
  if (replaced) {
    assert.equal(s.roomDrainUntil, null, 'replacing a primed queue clears its obsolete clock-correction frontier');
    assert(boundary >= 10.1 + .42 - 1e-6, 'preserve the safe 420ms queue');
    if (kind === 'future') assert(Math.abs(boundary - (12.1 - ROOM_MEDIA_LEAD)) < 1e-6, 'future change keeps its bar');
    else assert.equal(vocals.at(-1).gridTime, boundary, 'partial-bar vocal restarts on the compensated grid');
    for (const note of sources.filter(n => n.layer === 'old'))
      assert.equal(note.stopped < note.t, note.t >= boundary - 1e-6, 'all stale future sources are cancelled, and the safe prefix is retained');
    const replacement = sources.filter(n => n.layer === 'new');
    assert(replacement.length && replacement.every(n => n.t >= boundary - 1e-6), 'refill uses current jam patterns at the safe boundary');
    assert(Math.abs(s.nextTime - end) < 1e-6, 'refill restores the original cold horizon without re-priming');
    assert(s.engine.queuedNotes.some(n => n.t < boundary), 'safe-prefix sources remain tracked for a subsequent stop');
    assert.equal(s.roomMediaSync.horizon(.42, true, mediaRoute, 10.1), .42, 'refill horizon is consumed once');
  } else {
    assert.equal(s.nextTime, end, 'unaffected scheduler cursor is bit-identical');
    assert(sources.every(n => n.stopped === Infinity), 'desktop and beyond-prime edits do not stop sources');
  }
}
console.log('Room jam refill PASS: snapshot and live/late layers replace stale primed notes at a safe prefix/bar, preserve the original horizon and stop tracking; desktop and beyond-prime queues unchanged.');
for (const kind of ['normal', 'empty', 'error']) {
  const state = { params: { kick: { level: .9 }, bass: { level: .8 } } }, calls = [];
  const engine = { state, ctx: { currentTime: 10, sampleRate: 48000 }, gridTime: Engine.prototype.gridTime, applyParam(track, key) {
    if (kind === 'error') throw Error('control failure');
    calls.push([track, key, this.state.params[track][key], this.jamAt]);
  } };
  const apply = () => Engine.prototype.scheduleJamParams.call(engine, kind === 'empty' ? {} : { kick: { level: 0 } }, 12);
  if (kind === 'error') assert.throws(apply, /control failure/);
  else apply();
  assert.equal(engine.state, state, 'temporary control snapshots never replace the current engine state');
  assert.equal(engine.jamAt, undefined);
  assert.equal(engine.schedulingJam, false);
  assert.deepEqual(calls, kind === 'normal' ? [['kick', 'level', 0, 12]] : []);
}
console.log('Room jam control timing PASS: audio-clock boundary, isolated params and empty/error cleanup.');
const broadcast = main.slice(main.indexOf('function startRoomBroadcast('), main.indexOf('\nfunction showClub('));
for (const mediaRoute of [null, route]) {
  let delay;
  const go = runInNewContext(`${broadcast}\nstartRoomBroadcast`, {
    playing: false, roomJoinTimer: 0, mediaRoute, roomMediaLead, ROOM_LEAD: .42,
    Date: { now: () => 1000 }, clearTimeout() {},
    setTimeout: (fn, wait) => { delay = wait; },
  });
  go(2000);
  assert.equal(delay, mediaRoute ? 540 : 580, 'future DJ starts retain main\'s lookahead plus route lead');
}
console.log('Room media sync PASS: desktop bit identity, 40ms route-only lead, one cold-only 4s queue, bounded initial duplicate window, wake/reconnect never re-prime.');
for (const duration of [.1, .125, .15]) {
  const { s, api, hits } = transport(null), slews = [];
  s.engine.slewVocal = (...args) => slews.push(args);
  s.engine.stepDur = duration;
  s.nextTime += .025;
  const queued = hits.map(h => h.t), pending = s.nextTime;
  for (let i = 0; i < 10; i++) api.schedule();
  assert.equal(s.nextTime, pending, 'scheduler polls alone do not accumulate slew');
  assert.equal(slews.length, 0);
  s.ctx.currentTime += .1;
  s.Date.now = () => 1000100;
  api.schedule();
  const endRate = 1 + duration * .016, delta = 2 * duration / (1 + endRate) - duration;
  assert.equal(slews.length, 1, 'one correction for one newly scheduled step');
  assert.ok(Math.abs(hits.at(-1).t - (pending + delta)) < 1e-9);
  assert.deepEqual(hits.slice(0, queued.length).map(h => h.t), queued, 'queued notes are unchanged');
  assert.ok(Math.abs(slews[0][0] - delta) < 1e-9);
  assert.ok(Math.abs(slews[0][1] - (pending - duration)) < 1e-9);
  assert.equal(slews[0][2], duration, 'vocal follows the actual step duration, including score rubato');
  assert.equal(slews[0][3], 1);
  assert.ok(Math.abs(slews[0][4] - endRate) < 1e-9);
  assert.equal(s.engine.roomSlewRate, slews[0][4], 'grid rate persists even without a vocal stem');
  for (let i = 0; i < 10; i++) api.schedule();
  assert.equal(slews.length, 1);
}
console.log('Room step slew PASS: one correction per unscheduled step, no poll-driven acceleration, queued notes unchanged, vocal interval follows.');
await import('./room-jam-controls.mjs');
