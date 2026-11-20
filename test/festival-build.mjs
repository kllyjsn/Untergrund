import assert from 'node:assert/strict';
import { festivalBuilds, festivalBuildStep } from '../js/festival-build.js';
import { songPlan, generate, STYLES } from '../js/state.js';
import { buildSong, playSong } from '../scripts/composition.mjs';
import { capture } from '../js/midi.js';
import { Engine } from '../js/engine.js';

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
  Engine.prototype.festivalGap.call({ state: { artist: { style }, params: { stab: { voice } } }, festivalGate: { gain } }, 1, .4);
  assert.deepEqual(values, active ? [1, .16, .0003, 1] : [], 'tail decays without a zero floor only inside the festival gate');
  assert.deepEqual(times, active ? [1.06, 1.396] : [], '60 ms entry and continuing exponential tail');
}
console.log('Festival Trap builds passed: gates, seeded per-drop variants, variable gaps with nonzero tails, roll/riser shapes and drop downbeats');
