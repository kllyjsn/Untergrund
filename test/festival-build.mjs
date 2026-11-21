import assert from 'node:assert/strict';
import { festivalBuilds, festivalBuildStep } from '../js/festival-build.js';
import { songPlan, generate, STYLES } from '../js/state.js';
import { buildSong, playSong } from '../scripts/composition.mjs';
import { capture } from '../js/midi.js';
import { Engine } from '../js/engine.js';
import { createTimelineRecorder, stateAt, normalizeTimeline } from '../js/set-timeline.js';

for (const seed of [8, 1234, 3, 20, 4, 42, 211, 11]) {
  const voice = generate('trap', seed).params.stab.voice;
  const plan = songPlan('trap', seed);
  const builds = festivalBuilds(plan.chain, 'trap', voice, seed);
  assert.deepEqual(plan.builds || [], builds);
  assert.equal(builds.length > 0, [0, 2].includes(voice), `planning gate seed ${seed}`);
  const s = buildSong('trap', seed);
  s.artist = { style: 'trap', seed };
  assert.doesNotThrow(() => capture(s), 'note-only recorder supports festival automation');
  const { log, seq } = playSong(s);
  assert.deepEqual(seq.festivalPlan, builds);
  assert.equal(log.filter(x => x.k === 'festivalGap').length, builds.length, 'one gap per drop');
  for (const b of builds) {
    assert.equal(plan.chain[b.drop], 'G');
    assert(!/[GH]/.test(plan.chain[b.drop - 1]));
    assert([2, 3, 4].includes(b.bars));
    assert([2, 4, 8].includes(b.gapSteps));
    assert(b.sweepBars >= 1 && b.sweepBars <= b.bars);
    const events = Array.from({ length: b.bars * 16 }, (_, i) => festivalBuildStep(builds, b.from + Math.floor(i / 16), i % 16));
    assert(events[0].start);
    assert.equal(events.filter(x => x.gapStart).length, 1);
    assert(events.slice(-b.gapSteps).every(x => x.gap && x.rolls.length === 0));
    assert.equal(events.filter(x => x.gap).length, b.gapSteps);
    assert(events.slice(-16).every(x => x.lowOff));
    const rolls = events.flatMap(x => x.rolls);
    if (b.roll === 'none') assert.equal(rolls.length, 0);
    else {
      if (b.shape === 'straight') assert(events.slice(-16,-b.gapSteps).every(x => x.rolls.length === 2));
      assert(rolls[0].velocity < rolls.at(-1).velocity);
    }
    if (b.roll === 'late') assert(events.slice(0, events.length / 2).every(x => !x.rolls.length));
    assert.equal(events.filter(x => x.sweepStart).length, 1);
    const hits = log.filter(x => x.step >= b.from * 16 && x.step < b.drop * 16);
    assert.equal(hits.filter(x => x.k === 'sweep').length, 1);
    assert(!hits.some(x => x.step >= (b.drop - 1) * 16 && (x.k === 'acid' || x.k === 'trigger' && x.a[0] === 'kick')));
    assert(!hits.some(x => x.step >= b.drop * 16 - b.gapSteps && ['trigger', 'hook', 'acid'].includes(x.k)));
    assert(log.some(x => x.step === b.drop * 16 && x.k === 'trigger' && x.a[0] === 'kick'));
    assert(log.some(x => x.step === b.drop * 16 && x.k === 'acid'));
    assert(log.some(x => x.step === b.drop * 16 && x.k === 'impact'));
  }
}
assert.deepEqual(festivalBuilds('AAAADGGGGGGGH', 'trance', 0, 8), []);
for (const voice of [0, 2]) {
  const recorded = buildSong('bailefunk', 8);
  recorded.params.stab.voice = voice;
  const timeline = createTimelineRecorder({ state: recorded, style: 'bailefunk', startsAt: 0 }).finish(15000);
  const at = stateAt(timeline, 0);
  const s = { ...at.state, artist: { style: 'trap', seed: 8 } };
  const replay = playSong(s, at.style);
  const control = playSong({ ...s, artist: { style: at.style, seed: 8 } }, at.style);
  assert.deepEqual(replay.seq.festivalPlan, [], 'recorded Baile Funk never plans a Trap build');
  assert(!replay.log.some(x => x.k === 'festivalGap'), 'recorded Baile Funk has no festival gap');
  const lowEnd = log => log.filter(x => x.k === 'acid' || x.k === 'trigger' && x.a[0] === 'kick');
  assert.deepEqual(lowEnd(replay.log), lowEnd(control.log), 'listener style cannot withdraw recorded kicks or 808');
  assert.equal(s.artist.style, 'trap', 'replay leaves the listener project metadata intact');
}
for (const seed of [8, 1234]) {
  const s = buildSong('trap', seed);
  s.artist = { style: 'bailefunk', seed };
  const { log, seq } = playSong(s, 'trap');
  assert(seq.festivalPlan.length > 0, 'recorded festival Trap still builds in a non-Trap project');
  assert.equal(log.filter(x => x.k === 'festivalGap').length, seq.festivalPlan.length);
}
console.log('Saved-set festival gates follow recorded style: Baile Funk has no builds/gaps or extra kick/808 withdrawal; festival Trap still builds');
{
  const recorded = buildSong('trap', 8); recorded.artist = { style: 'trap', seed: 8 };
  const timeline = normalizeTimeline(createTimelineRecorder({ state: recorded, style: 'trap', startsAt: 0 }).finish(15000));
  const at = stateAt(timeline, 0);
  const expected = festivalBuilds(recorded.chain, 'trap', recorded.params.stab.voice, 8);
  assert.deepEqual(playSong(recorded).seq.festivalPlan, expected, 'live generation keeps its existing seeded plan');
  for (const listener of [42, 211]) {
    const s = { ...at.state, artist: { style: 'trap', seed: listener } };
    assert.deepEqual(playSong(s, at.style, at.state.seed).seq.festivalPlan, expected, 'listeners share the recorded seed plan');
    const legacy = structuredClone(timeline); delete legacy.initial.seed;
    const old = stateAt(normalizeTimeline(legacy), 0);
    assert.deepEqual(playSong(s, old.style, old.state.seed).seq.festivalPlan,
      festivalBuilds(recorded.chain, 'trap', recorded.params.stab.voice, listener), 'old sets retain listener-seed fallback');
    assert.equal(s.artist.seed, listener, 'replay does not replace listener metadata');
  }
  console.log('Saved-set festival seeds passed: two listeners match recorded plan, live generation unchanged, old sets retain listener-seed fallback');
}
for (const style of Object.keys(STYLES).filter(x => x !== 'trap')) {
  for (const voice of [0, 2, 7]) assert.deepEqual(festivalBuilds('AAAAAAADGGGGGGGH', style, voice, 8), []);
}
assert.deepEqual(festivalBuilds('', 'trap', 2), []);
assert.deepEqual(festivalBuilds('GGGGGGGH', 'trap', 2), []);
assert.deepEqual(festivalBuilds('AAAADGGGGGGGH', 'trap', 7), []);
assert.throws(() => festivalBuilds('bad', 'trap', 2), /song chain/);
const short = festivalBuilds('AAADGGGGGGGH', 'trap', 2);
assert.equal(short[0].bars, 2);
assert.equal(festivalBuildStep(short, 0, 0), null);
assert.deepEqual(festivalBuildStep(short, 4, 0), { drop: true });
assert.equal(festivalBuildStep(short, 4, 1), null);
assert.deepEqual(festivalBuilds('AAAAAAADGGGGGGGH', 'trap', 2, 123), festivalBuilds('AAAAAAADGGGGGGGH', 'trap', 2, 123));
const variants = [8, 1234, 3, 20].map(seed => songPlan('trap', seed).builds);
for (const seed of [8, 1234]) {
  const s = buildSong('trap', seed); s.artist = { style: 'trap', seed }; s.master.arr = 0;
  const { log, seq } = playSong(s);
  assert(!log.some(x => x.k === 'festivalGap' || x.k === 'sweep'), 'DROPS off schedules no festival automation');
  for (const b of seq.festivalPlan) {
    assert.equal(festivalBuildStep([b], b.from, 0, 0), null);
    assert.equal(festivalBuildStep([b], b.drop, 0, 0), null);
    assert(!log.some(x => x.step === b.drop * 16 && x.k === 'impact'), 'DROPS off has no festival impact');
    const full = festivalBuildStep([b], b.from, 0), half = festivalBuildStep([b], b.from, 0, .5);
    assert.equal(half.strength, full.strength * .5);
    assert.deepEqual(half.rolls, full.rolls.map(hit => ({ ...hit, velocity: hit.velocity * .5 })));
  }
  s.master.arr = .25;
  const quarter = playSong(s).log.filter(x => x.k === 'sweep');
  s.master.arr = .5;
  const normal = playSong(s).log.filter(x => x.k === 'sweep');
  assert.equal(quarter.length, normal.length);
  for (let i = 0; i < normal.length; i++) assert.equal(quarter[i].a[2], normal[i].a[2] * .5, 'DROPS scales from the existing Trap default of .5');
}
for (const builds of variants) {
  assert.equal(builds[0].roll, 'full');
  assert(builds[0].sweepBars >= Math.max(...builds.slice(1).map(b => b.sweepBars)));
  assert(builds[0].bars >= Math.max(...builds.map(b => b.bars)));
  assert(builds.slice(1).every(b => b.roll !== 'full' && b.strength < builds[0].strength));
  assert(new Set(builds.map(b => `${b.bars}/${b.roll}/${b.gapSteps}/${b.sweepBars}/${b.sweep.tone}`)).size > 1);
}
assert(variants.flat().some(b => b.roll === 'none'));
assert(variants.flat().some(b => b.roll === 'late'));
assert.equal(new Set(variants.flat().map(b => b.sweep.tone)).size, 2);
assert(new Set(variants.map(bs => bs[0].shape)).size > 1, 'first roll recipes vary by seed');
assert(new Set(variants.map(bs => bs[0].gapSteps)).size > 1, 'first gaps vary by seed');
for (const [style, voice, active] of [['trap', 0, true], ['trap', 2, true], ['trap', 7, false], ['trance', 0, false]]) {
  const values = [], times = [], gain = { setValueAtTime: v => values.push(v), linearRampToValueAtTime: v => values.push(v), exponentialRampToValueAtTime: (v,t) => { values.push(v); times.push(t); } };
  Engine.prototype.festivalGap.call({ playbackStyle: style, state: { params: { stab: { voice } } }, festivalGate: { gain } }, 1, .4);
  assert.deepEqual(values, active ? [1, .16, .0003, 1] : [], 'tail decays without a zero floor only inside the festival gate');
  assert.deepEqual(times, active ? [1.06, 1.396] : [], '60 ms entry and continuing exponential tail');
}
for (const amount of [0, .5, 1]) {
  const ramps = [], gain = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime: v => ramps.push(v) };
  Engine.prototype.festivalGap.call({ playbackStyle: 'trap', state: { params: { stab: { voice: 2 } } }, festivalGate: { gain } }, 1, .4, amount);
  assert.deepEqual(ramps, amount ? [.16 ** amount, .0003 ** amount] : [], 'DROPS scales gap depth');
}
console.log('Festival DROPS control passed: zero suppresses builds and impacts, fractional amounts scale rolls/sweeps/gaps');
console.log('Festival Trap builds passed: gates, seeded per-drop variants, variable gaps with nonzero tails, roll/riser shapes and drop downbeats');
