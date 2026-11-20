import assert from 'node:assert/strict';
import { festivalBuilds, festivalBuildStep } from '../js/festival-build.js';
import { songPlan, generate, STYLES } from '../js/state.js';
import { buildSong, playSong } from '../scripts/composition.mjs';
import { capture } from '../js/midi.js';

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
    assert([2, 4].includes(b.bars));
    const events = Array.from({ length: b.bars * 16 }, (_, i) => festivalBuildStep(builds, b.from + Math.floor(i / 16), i % 16));
    assert(events[0].start);
    assert.equal(events.filter(x => x.gapStart).length, 1);
    assert(events.slice(-4).every(x => x.gap && x.rolls.length === 0));
    assert(events.slice(-16).every(x => x.lowOff));
    assert(events.slice(-16,-4).every(x => x.rolls.length === 2));
    assert(events[0].rolls[0].velocity < events.at(-5).rolls[1].velocity);
    const hits = log.filter(x => x.step >= b.from * 16 && x.step < b.drop * 16);
    assert.equal(hits.filter(x => x.k === 'sweep').length, 1);
    assert(!hits.some(x => x.step >= (b.drop - 1) * 16 && (x.k === 'acid' || x.k === 'trigger' && x.a[0] === 'kick')));
    assert(!hits.some(x => x.step >= b.drop * 16 - 4 && ['trigger', 'hook', 'acid'].includes(x.k)));
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
console.log('Festival Trap builds passed: planning/playback gates, 2/4 bars, accelerating rolls, riser, bass/kick withdrawal, one-beat gap and drop downbeat');
