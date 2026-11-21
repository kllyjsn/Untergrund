import assert from 'node:assert/strict';
import { freshSong, generate, sanitize, applyOverrides } from '../js/state.js';
import { jazzBass, jazzHarmony, jazzNotes, jazzVoicing, jazzNotches, JAZZ_PROGS, JAZZ_MIX } from '../js/jazz.js';
import { CHORDS } from '../js/params.js';
import { Recorder } from '../js/midi.js';
import { Engine, Sequencer, stabPitches } from '../js/engine.js';
import { parse } from '../js/describe.js';
import { styleFor } from '../js/song-plan.js';
import { stageScene } from '../js/club-stage.js';
import { liveSets } from '../js/livekit.js';
import { writeMelody } from '../js/melody.js';
import { rng } from '../js/dsp.js';

const pc = (n) => ((n % 12) + 12) % 12;
for (const style of ['swing', 'modal', 'bossa', 'jazzfunk']) {
  const state = freshSong(style, 42); state.master.volume = 0.37; state.master.dj = -0.42;
  applyOverrides(state, generate(style, 11));
  assert.equal(state.master.volume, 0.37, 'generating jazz preserves the master level');
  assert.equal(state.master.dj, -0.42, 'generating jazz preserves the DJ filter');
}
for (const pitch of [57, 60, 63, 67, 70, 74, 77, 81]) {
  const a = jazzNotches('tpt', pitch), b = jazzNotches('tpt', pitch, 2 ** (-1 / 12));
  assert(a.length === 1 && a[0][1] >= 30 && a[0][2] < 0);
  assert.equal(b[0][0], a[0][0] * 2 ** (-1 / 12), 'sample correction follows transposition');
  assert.deepEqual(b[0].slice(1), a[0].slice(1));
}
assert.deepEqual(jazzNotches('piano', 66), []);
assert.deepEqual(jazzNotches('jazz', 60), []);
assert.deepEqual(jazzNotches('tpt', NaN), []);
for (const rate of [NaN, Infinity, 0, -1]) assert.deepEqual(jazzNotches('tpt', 77, rate), []);
for (const kind of ['fl', 'flb']) assert(jazzNotches(kind, 69).length);
assert.equal(jazzNotches('jazz', 66.04)[0][0], 2967);
for (const style of ['swing', 'modal']) for (const seed of [1, 2, 3, 11, 42, 77, 1234]) {
  const s = freshSong(style, seed), round = sanitize(JSON.parse(JSON.stringify(s))), pat = s.patterns[6];
  assert.deepEqual(round.patterns, s.patterns, 'jazz grammar and notation survive save/load');
  assert.deepEqual(round.labels, s.labels);
  assert.equal(s.master.duck, 0); assert.equal(s.master.kit, 1);
  assert(s.master.room > 0 && s.master.room <= 0.2);
  assert(s.master.swing8 >= 0.65 && s.master.swing8 <= 0.85);
  assert(s.chain.match(/^G+C+H+$/), 'head, solos, head out');
  const m = writeMelody(rng(seed), style, [0, 2, 3, 5, 7, 9, 10]);
  assert(m.n.length && m.v.length && m.b.length && m.bars === 8, 'instrumental profiles produce scored phrases without words');
  assert(liveSets(s).includes('kit') && liveSets(s).includes(s.params.stab.voice === 13 ? 'jazz' : 'piano'));
  assert.equal(stageScene(style, s).kind, 'band');
  for (let bar = 0; bar < 32; bar++) {
    const h = jazzHarmony(pat, bar), next = jazzHarmony(pat, bar + 1);
    const bass = jazzBass(style, s.key, h, next, bar), iv = CHORDS[h.c].iv;
    assert(bass.every((n) => n >= 28 && n <= 50));
    for (const beat of [0, 2]) assert(iv.some((n) => pc(s.key + h.r + n) === pc(bass[beat])), 'strong bass notes belong to the actual chord');
    const nextBass = jazzBass(style, s.key, next, jazzHarmony(pat, bar + 2), bar + 1);
    assert.equal(Math.abs(bass[3] - nextBass[0]), 1, 'beat four approaches the actual next bass root by a semitone, not an octave-displaced root');
    for (const [at, dur, n] of jazzNotes(style, seed, bar, h, true)) {
      assert(dur > 0 && at + dur <= 16);
      if (at % 8 === 0) assert(iv.some((v) => pc(h.r + v) === pc(n)), 'strong lead landings are chord tones');
    }
    const v = jazzVoicing(h, s.key, style);
    assert(v[0] >= 48 && v.at(-1) <= 83, 'comping stays out of the bass register');
    if (style === 'modal' && h.c === 17) assert.deepEqual(v.map((n) => n - v[0]), [0, 5, 10, 15, 19]);
  }
  const record = (state) => {
    const rec = new Recorder(state), seq = new Sequencer(rec, state);
    for (let i = 0; i < 16 * 12; i++) seq.tick(i, 0.05 + i * rec.stepDur);
    return rec.notes;
  };
  assert.deepEqual(record(s), record(round), 'scheduler/MIDI playback survives serialization');
  const muted = sanitize(s); muted.mutes = Object.fromEntries(Object.keys(muted.mutes).map((id) => [id, true]));
  assert.deepEqual(record(muted), {}, 'muted jazz players stay silent');
  const notes = record(s);
  if (style === 'modal') {
    const h = jazzHarmony(pat, 0), v = stabPitches({ state: s, harm: h, step: 0 });
    assert(v.pedal && v.iv.length === 1 && v.root >= 48 && v.root < 60, 'modal piano anchors the bar with a left-hand pedal');
    assert(notes.stab.some((n) => n.dur >= 14 * 60 / s.bpm / 4), 'the piano pedal sustains under the fourth stabs');
  }
  assert(!notes.clap && !notes.perc && !notes.vox && notes.ride && notes.acid && notes.hook);
  applyOverrides(s, generate('neosoul', seed));
  assert.equal(s.master.swing8, 0, 'legacy generation does not inherit eighth swing');
}
for (const [style, progs] of Object.entries(JAZZ_PROGS)) for (const pr of progs) {
  const pat = { jazz: { style }, prog: pr.map(([r, c]) => ({ r, c })) };
  const h = jazzHarmony(pat, 0);
  if (style === 'modal') for (let b = 1; b < 4; b++) assert.deepEqual(jazzHarmony(pat, b), h);
}
for (const [text, style] of [['jazz', 'swing'], ['bebop', 'swing'], ['hard bop', 'swing'], ['swing jazz', 'swing'], ['modal', 'modal'], ['Coltrane', 'modal'], ['Miles', 'modal'], ['Kind of Blue', 'modal'], ['neo soul', 'neosoul'], ['Glasper', 'neosoul']]) {
  assert.equal(styleFor(text), style, text);
  assert(parse(text).edits.some((e) => e.id === 'genre' && e.value === style), text);
}
const bad = freshSong('modal', 1); bad.patterns[0].jazz = { style: 'oops', seed: Infinity };
assert(!sanitize(bad).patterns[0].jazz);
const s = freshSong('modal', 11), fake = { state: s };
assert.doesNotThrow(() => Engine.prototype.duckAt.call(fake, 0, 1), 'jazz skips all kick-driven duck automation');
for (const style of ['swing', 'modal']) {
  let played = 0, level;
  const e = { state: freshSong(style, 42), ch: { acid: { input: {} } }, playBuf(buf, t, gain) { played++; level = gain; },
    ctx: { createOscillator() { throw new Error('acoustic upright must not have a synthesized sub layer'); } } };
  Engine.prototype.sampledBass.call(e, {}, 0.05, 36, 0.4, false);
  assert.equal(played, 1);
  assert.equal(level, 10 ** (JAZZ_MIX[style].bass / 20), 'upright balance is a linear trim, not a changed articulation');
  const calls = [], comp = { state: freshSong(style, 42), ctx: {}, step: 6, stepDur: 0.1,
    ch: { stab: { band: {} } }, rec: () => [], recordedNote: (...a) => calls.push(a) };
  Engine.prototype.stab.call(comp, 0.1, 0.5);
  assert(calls.length > 1);
  for (const a of calls) {
    assert.equal(a[2], 0.5 * 0.62 * 10 ** (JAZZ_MIX[style].comp / 20));
    assert.equal(a[8], 0.5, 'comp trim preserves the sampled velocity layer');
  }
  const ride = Engine.prototype.liveFx.call({ state: freshSong(style, 42) }, 'ride', { duration: 2 });
  assert.equal(ride.fx.fade, 0.005);
  assert.equal(ride.fx.attackGain, 0.65);
  assert.equal(ride.dur, 2, 'ride attack shaping retains the full recorded sustain');
  assert.equal(JAZZ_MIX[style].output, -2, 'jazz leaves post-clipper intersample headroom');
}
console.log('jazz: progression-aware walking/approaches, strong-note harmony, quartal stacks, instrumental form, mutes, save/load, preload and routing passed');
