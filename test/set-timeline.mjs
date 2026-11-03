import assert from 'node:assert/strict';
import { generate, defaultState, clone, sanitize } from '../js/state.js';
import { createTimelineRecorder, stateAt, trimTimeline, createReplayer, normalizeTimeline, diffOps, applyOps, stepAt, compactTimeline, liveView, MAX_TIMELINE_BYTES } from '../js/set-timeline.js';

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
assert.equal(stepAt(tempo, 12000).bpm, 150);

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
