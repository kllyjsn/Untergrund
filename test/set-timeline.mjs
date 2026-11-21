import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { generate, defaultState, clone, sanitize, STYLES } from '../js/state.js';
import { createTimelineRecorder, stateAt, trimTimeline, createReplayer, normalizeTimeline, diffOps, applyOps, stepAt, compactTimeline, liveView, MAX_TIMELINE_BYTES } from '../js/set-timeline.js';
import { startLiveSet, endLiveSet, playTimeline, stopTimeline } from '../js/live-sets.js';

// Deterministic "DJ": a seeded run of knob turns, mutes, pattern switches, tempo and genre changes.
function rng(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function performSet(seed, minutes = 6) {
  const r = rng(seed), live = defaultState(), t0 = 1_700_000_000_000;
  let style = 'hypnotic';
  const rec = createTimelineRecorder({ state: live, style, startsAt: t0, dj: 'Night Listener', room: 'the-bunker', title: 'Test' });
  const truth = [];
  for (let t = 0; t <= minutes * 60e3; t += 500) {
    const k = r();
    if (k < 0.15) live.params.acid.cutoff = Math.round(r() * 1000) / 1000;
    else if (k < 0.2) live.mutes.ch = !live.mutes.ch;
    else if (k < 0.24) live.current = Math.floor(r() * live.patterns.length);
    else if (k < 0.25) live.bpm = 120 + Math.floor(r() * 20);
    else if (k < 0.27) live.patterns[live.current].steps.kick[Math.floor(r() * 16)] = r() < 0.5 ? 0 : 1;
    else if (k < 0.272) { style = r() < 0.5 ? 'acid' : 'hypnotic'; const g = generate(style, Math.floor(r() * 999)); live.master.drive = g.master.drive ?? live.master.drive; }
    rec.capture(live, style, t0 + t);
    if (t % 30000 === 0) truth.push({ t, view: liveView(live), style });
  }
  return { timeline: rec.finish(t0 + minutes * 60e3), truth };
}

// diff/apply round trip
const a = defaultState(), b = clone(a);
b.params.kick.level = 0.3; b.mutes.clap = true; b.patterns[2].steps.ch[3] = 1; delete b.solos;
assert.deepEqual(applyOps(clone(a), diffOps(a, b)), b);
assert.equal(diffOps(a, clone(a)).length, 0);
{
  const state = defaultState(); state.artist = { style: 'trap', seed: 0 };
  const rec = createTimelineRecorder({ state, style: 'trap', startsAt: 0 });
  state.artist.seed = 1234; rec.capture(state, 'trap', 1000);
  delete state.artist.seed; rec.capture(state, 'trap', 2000);
  const saved = normalizeTimeline(rec.finish(15000));
  assert.equal(stateAt(saved, 0).state.seed, 0, 'zero is a recorded seed');
  assert.equal(stateAt(saved, 1500).state.seed, 1234, 'song changes record the new seed');
  assert.equal(stateAt(saved, 2500).state.seed, undefined, 'missing seed clears the replay override');
  assert.equal(stateAt(trimTimeline(saved, 1200, 1800), 0).state.seed, 1234, 'trimming keeps the seed at the cut');
  const applied = [];
  const rep = createReplayer(saved, { startsAt: 0, apply: s => applied.push(s.seed) });
  rep.tick(0); rep.tick(1500); rep.tick(2500);
  assert.deepEqual(applied, [1234, undefined]);
  const compacted = compactTimeline(saved, 1);
  assert.equal(stateAt(compacted, 2500).state.seed, undefined);
  const invalid = normalizeTimeline({ ...saved, initial: { ...saved.initial, seed: '8' }, events: [{ t: 100, ops: [
    [['seed'], null], [['seed'], '8'], [['seed', 'x'], 8], [['seed'], {}], [['seed'], 8],
  ] }] });
  assert.equal(invalid.initial.seed, undefined);
  assert.deepEqual(invalid.events[0].ops, [[['seed'], 8]]);
  assert.equal(stateAt(normalizeTimeline({ ...saved, initial: liveView(defaultState()), events: [] }), 0).state.seed, undefined, 'old timelines stay seedless');
  console.log('Timeline seeds passed: record/update/remove, normalize, trim, compact, replay and legacy/invalid values');
}
{
  const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
  const source = main.slice(main.indexOf('function timelineHooks('), main.indexOf('\nfunction replayToRoom('));
  const env = { state: { ...defaultState(), artist: { style: 'trap', seed: 211 } }, style: 'trap', STYLES, sanitize, clone,
    playing: false, engine: { applyAll() {} }, seq: {}, guest: null, build() {}, persist() {}, pat: () => ({}) };
  let played, queued;
  env.replaceState = s => { env.state = s; };
  env.play = opts => { played = opts; };
  env.queueSong = plan => { queued = plan; };
  runInNewContext(`${source}; hooks = timelineHooks(false);`, env);
  env.hooks.load({ ...defaultState(), seed: 8 }, 'trap');
  env.hooks.play({});
  assert.equal(played.replaySeed, 8, 'timeline load forwards seed to replay start');
  assert.equal(env.state.artist.seed, 211, 'loading keeps listener artist metadata');
  env.hooks.apply({ seed: 0 }, 'trap');
  assert.equal(env.engine.replaySeed, 0, 'immediate timeline events forward zero seed');
  env.hooks.apply({}, 'trap');
  assert.equal(env.engine.replaySeed, undefined, 'legacy timeline clears the previous override');
  env.playing = true;
  const next = clone(env.state); next.seed = 1234; next.chain = 'GGGG';
  next.patterns[0].steps.kick[0] = next.patterns[0].steps.kick[0] ? 0 : 1;
  env.hooks.apply(next, 'trap');
  assert.equal(queued.replaySeed, 1234, 'downbeat song handoffs carry the incoming recorded seed');
  console.log('Timeline loading forwards recorded seed through start, immediate changes and queued song handoffs without mutating listener metadata');
}

// recorder -> stateAt reproduces the live state at every checkpoint
const { timeline, truth } = performSet(7);
for (const { t, view, style } of truth) {
  const at = stateAt(timeline, t);
  assert.deepEqual(at.state, view, `state at ${t}`);
  assert.equal(at.style, style);
}
assert.equal(timeline.duration, 6 * 60e3);
assert(JSON.stringify(timeline).length < MAX_TIMELINE_BYTES, 'a 6-minute set stays tiny');

// determinism: same performance -> byte-identical timeline
assert.equal(JSON.stringify(performSet(7).timeline), JSON.stringify(timeline));

// replayer ends in the same state no matter how irregularly it ticks
for (const seed of [1, 2, 3]) {
  const r = rng(seed), startsAt = 5000;
  let applied = null, ended = 0;
  const rep = createReplayer(timeline, { startsAt, apply: (s) => { applied = s; }, onEnd: () => ended++ });
  for (let now = startsAt; !rep.done; now += 20 + Math.floor(r() * 900)) rep.tick(now);
  assert.equal(ended, 1);
  assert.deepEqual(rep.snapshot().state, stateAt(timeline, timeline.duration).state);
  assert.deepEqual(applied, stateAt(timeline, timeline.duration).state);
}
// a late joiner starts from stateAt and converges with an on-time listener
const mid = 200e3, late = createReplayer(timeline, { startsAt: 0 }), early = createReplayer(timeline, { startsAt: 0 });
late.tick(mid); assert.deepEqual(late.snapshot().state, stateAt(timeline, mid).state);
for (let now = 0; now <= 250e3; now += 333) early.tick(now);
late.tick(250e3);
assert.deepEqual(late.snapshot(), early.snapshot());

// trim: the cut starts at the right state and keeps relative timing
const cut = trimTimeline(timeline, 60e3, 180e3);
assert.equal(cut.duration, 120e3);
assert.deepEqual(cut.initial, stateAt(timeline, 60e3).state);
for (const t of [0, 30e3, 90e3, 120e3]) assert.deepEqual(stateAt(cut, t).state, stateAt(timeline, 60e3 + t).state);

// tempo integration: 120 BPM for 10 s (80 steps) then 150 BPM for 2 s (20 steps)
const tempo = { initial: { bpm: 120 }, events: [{ t: 10000, ops: [[['bpm'], 150]] }], duration: 20000 };
assert.equal(stepAt(tempo, 12000).steps, 100);

{
  const realNow = Date.now, startsAt = 50000;
  try {
    for (const [joinAt, expected] of [
      [startsAt - 300, { step: 0, stepWall: startsAt }],
      [startsAt + 12000, { step: 101, stepWall: startsAt + 12100 }],
    ]) {
      let wall = joinAt, played;
      Date.now = () => wall;
      playTimeline(tempo, startsAt, {
        load: () => { wall += 60; },
        play: (opts) => { played = opts; },
      });
      assert.deepEqual(played, expected, 'rendering the loaded state does not move the first replay step');
      stopTimeline();
    }
  } finally {
    Date.now = realNow;
    stopTimeline();
  }
}
assert.equal(stepAt(tempo, 12000).bpm, 150);

// A set records the playing song's genre, not the genre picker.
{
  const project = { ...defaultState(), artist: { style: 'drill' } };
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const realNow = Date.now, interval = globalThis.setInterval, clear = globalThis.clearInterval;
  const startsAt = 1000;
  let now = startsAt, picker = 'trap', tick;
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
    Date.now = () => now;
    globalThis.setInterval = (fn) => { tick = fn; return 1; };
    globalThis.clearInterval = () => {};
    startLiveSet({ getState: () => project, getStyle: () => picker, startsAt, isPlaying: () => true, isDJ: () => true });
    now += 500; picker = 'hardtechno'; tick();
    now += 500; project.artist.style = 'trap'; tick();
    const replay = endLiveSet({ offer: false });
    assert.equal(stateAt(replay, 0).style, 'drill');
    assert.equal(stateAt(replay, 500).style, 'drill');
    assert.equal(stateAt(replay, 1000).style, 'trap');
  } finally {
    endLiveSet({ offer: false });
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
    else delete globalThis.localStorage;
    Date.now = realNow;
    globalThis.setInterval = interval;
    globalThis.clearInterval = clear;
  }
}

// untrusted input: survives normalize unchanged, drops prototype pollution and foreign keys
const norm = normalizeTimeline(JSON.parse(JSON.stringify(timeline)));
const canon = (s) => liveView(sanitize(s));
for (const t of [0, 123456, timeline.duration]) assert.deepEqual(canon(stateAt(norm, t).state), canon(stateAt(timeline, t).state));
assert.equal(norm.events.length, timeline.events.length);
const evil = normalizeTimeline({ ...timeline, events: [{ t: 10, ops: [[['__proto__', 'x'], 1], [['artist', 'name'], 'x'], [['params', 'constructor'], 1], [['style'], 'not-a-style'], [['bpm'], 140]] }] });
assert.deepEqual(evil.events, [{ t: 10, ops: [[['bpm'], 140]] }]);
assert.equal(normalizeTimeline({ events: [] }), null);
assert.equal(({}).x, undefined);

// compaction keeps the end state and the budget
const big = compactTimeline(timeline, 20000);
assert(JSON.stringify(big).length <= 20000 || big.events.length === 1);
assert.deepEqual(stateAt(big, big.duration).state, stateAt(timeline, timeline.duration).state);

// jukebox: a live set saves as a timeline (no Blob), lists light, and replays by id — with the in-memory store (Redis off)
const { handleJukebox, memoryJukebox } = await import('../api/_lib/jukebox.js');
const { memoryStore } = await import('../api/_lib/crate.js');
const { normalizeSet } = await import('../api/_lib/rooms.js');
const jb = memoryJukebox(), crate = memoryStore();
const jcut = trimTimeline(timeline, 60000, 240000);
const saved = await handleJukebox('POST', { kind: 'set', title: 'Night shift', artist: 'DJ Test', room: 'basement', timeline: jcut }, { store: jb, crate, client: 'dj' });
assert.equal(saved.status, 201);
assert.equal(saved.json.item.replay, true); assert.equal(saved.json.item.room, 'basement'); assert.equal(saved.json.item.artist, 'DJ Test');
assert.equal(saved.json.item.duration, 180);
assert(!('timeline' in saved.json.item) && !('url' in saved.json.item));
const listed = await handleJukebox('GET', null, { store: jb, crate });
assert(!('timeline' in listed.json.items[0]), 'jukebox list stays light');
const fetched = await handleJukebox('GET', null, { store: jb, crate, id: saved.json.item.id });
assert.deepEqual(canon(stateAt(fetched.json.timeline, 90000).state), canon(stateAt(jcut, 90000).state));
assert.equal((await handleJukebox('GET', null, { store: jb, crate, id: '../x' })).status, 404);
assert.equal((await handleJukebox('POST', { kind: 'set', timeline: { events: [] } }, { store: jb, crate })).status, 400);

// rooms: "replay this set to the room" carries an id (or an inline local timeline) through set normalization
const roomSet = normalizeSet({ state: jcut.initial, startsAt: 5, replay: { id: saved.json.item.id, title: 'Night shift', dj: 'DJ Test' } });
assert.deepEqual(roomSet.replay, { id: saved.json.item.id, title: 'Night shift', dj: 'DJ Test' });
assert.equal(normalizeSet({ state: jcut.initial, replay: { timeline: jcut } }).replay.timeline.events.length, jcut.events.length);
assert.equal(normalizeSet({ state: jcut.initial, replay: { id: '../evil' } }).replay, undefined);
console.log('set-timeline passed');
