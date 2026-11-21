import assert from 'node:assert/strict';
import { freshSong, sanitize } from '../js/state.js';
import { Engine, Sequencer } from '../js/engine.js';
import { Recorder } from '../js/midi.js';
import { jazzHarmony, jazzNotes, jazzVoicing, jazzMelody } from '../js/jazz.js';
import { funkBass, FUNK_KICK, FUNK_SNARE } from '../js/jazzfunk.js';
import { CHORDS, TRACK_IDS } from '../js/params.js';
import { parse } from '../js/describe.js';
import { styleFor } from '../js/song-plan.js';
import { liveSets } from '../js/livekit.js';
import { stageScene } from '../js/club-stage.js';

const pc = (n) => (n % 12 + 12) % 12;
for (const text of ['jazz funk', 'jazz-funk', 'fusion', 'Headhunters', 'Herbie', 'Donald Byrd', 'Roy Ayers']) {
  assert.equal(styleFor(text), 'jazzfunk');
  assert(parse(text).edits.some((e) => e.id === 'genre' && e.value === 'jazzfunk'), text);
}
const record = (s) => {
  const e = new Recorder(s), seq = new Sequencer(e, s);
  for (let i = 0; i < 32; i++) seq.tick(i, 0.05 + i * e.stepDur);
  return e.notes;
};
for (const seed of [1, 2, 3, 11, 42, 77, 1234, 12345, 0x12345678]) {
  const s = freshSong('jazzfunk', seed), p = s.patterns[6];
  const saved = sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(saved.patterns, s.patterns); assert.equal(saved.scale, s.scale);
  assert(s.bpm >= 96 && s.bpm <= 110);
  assert(['dorian', 'mixolydian'].includes(s.scale));
  assert.equal(s.master.swing8, 0); assert(s.swing >= 0.1 && s.swing <= 0.2);
  assert.equal(s.master.duck, 0); assert.equal(s.master.kit, 1);
  assert.equal(s.params.stab.voice, 1); assert.equal(s.params.acid.voice, 5);
  assert(s.params.stab.env <= 0.15 && s.params.stab.cutoff <= 1800);
  for (const set of ['kit', 'ebass', 'tpt', 'horn']) assert(liveSets(s).includes(set), set);
  assert.equal(stageScene('jazzfunk', s).kind, 'band');
  assert(s.chain.match(/^G+C+H+$/));
  assert(new Set(p.prog.map((h) => `${h.r}/${h.c}`)).size > 1, 'bridge leaves the vamp');
  for (let bar = 0; bar < 32; bar++) {
    const h = jazzHarmony(p, bar), bass = funkBass(s.key, h, bar), tones = CHORDS[h.c].iv;
    assert.equal(pc(bass[0][2] - s.key), pc(h.r));
    assert(bass.some(([, dur, , v]) => dur < 0.6 && v <= 0.5));
    assert(bass.some(([, , m]) => m === bass[0][2] + 12));
    for (const [step, dur, m] of bass) {
      assert(dur > 0 && m >= 28 && m <= 51);
      if (step % 8 === 0) assert(tones.some((n) => pc(s.key + h.r + n) === pc(m)));
    }
    for (const [step, dur, n] of jazzNotes('jazzfunk', seed, bar, h, true)) {
      assert(dur > 0 && step + dur <= 16);
      if (step % 4 === 0) assert(tones.some((v) => pc(h.r + v) === pc(n)));
    }
    const voicing = jazzVoicing(h, s.key, 'jazzfunk');
    assert(voicing.every((n) => n >= 48 && n <= 76));
    if (h.c === 16) assert(voicing.some((n) => pc(n - s.key - h.r) === 5), 'minor eleventh in Rhodes voicing');
  }
  const notes = record(s), sd = 60 / s.bpm / 4;
  assert(notes.hook.every((n) => n.m >= 69 && n.m <= 80), 'projected trumpet register across keys');
  assert(!notes.ride && !notes.clap && !notes.perc && !notes.vox);
  for (let bar = 0; bar < 2; bar++) {
    const events = (id) => notes[id].filter((n) => n.t >= 0.05 + bar * 16 * sd - 0.001 && n.t < 0.05 + (bar + 1) * 16 * sd - 0.001);
    const at = (id) => events(id).map((n) => Math.round((n.t - 0.05) / sd) % 16);
    assert.deepEqual(at('kick'), FUNK_KICK[bar]); assert.deepEqual(at('snare'), FUNK_SNARE);
    assert.deepEqual(at('ch'), Array.from({ length: 16 }, (_, i) => i).filter((i) => i !== 6 && i !== 14));
    assert.deepEqual(at('oh'), [6, 14]);
    assert(events('snare').some((n) => n.v === 0.18) && events('snare').some((n) => n.v === 0.72));
  }
  const muted = structuredClone(s); muted.mutes = Object.fromEntries(TRACK_IDS.map((id) => [id, true]));
  assert.deepEqual(record(muted), {});
  const solo = structuredClone(s); solo.solos = { acid: true };
  assert.deepEqual(Object.keys(record(solo)), ['acid']);
  let keys = 0, recorded = 0;
  Engine.prototype.stab.call({ state: s, step: 0, harm: jazzHarmony(p, 0), ch: { stab: { input: {}, band: {} } }, keys: () => keys++, recordedNote: () => recorded++ }, 0, 0.6);
  assert.equal(keys, 1); assert.equal(recorded, 0, 'main comping is FM keys, not a piano sample');
  const response = { state: s, step: 62, harm: jazzHarmony(p, 3), ch: { stab: { input: {}, band: {} } }, keys: () => keys++, recordedNote: () => recorded++, rec: () => [[60, {}]] };
  Engine.prototype.stab.call(response, 0, 0.6);
  assert.equal(recorded, 1, 'supporting horns answer the head breath');
  response.rec = () => null;
  Engine.prototype.stab.call(response, 0, 0.6);
  assert.equal(recorded, 1); assert.equal(keys, 3, 'missing horn samples retain Rhodes comping');
}
assert.deepEqual(jazzNotes('jazzfunk', 42, 3, { r: 0, c: 16 }), [], 'head leaves a bar for keys response');
assert(jazzMelody('jazzfunk', 42).n.length > 0, 'shared jazz melody helper resolves funk progressions');
const empty = freshSong('jazzfunk', 42); for (const p of empty.patterns) p.hook = null;
const rhythm = record(empty);
assert(!rhythm.hook && rhythm.acid.length && rhythm.kick.length && rhythm.stab.length, 'missing hook leaves rhythm section intact');
console.log('jazzfunk: aliases, warm FM palette, electric bass octaves/dead notes, ghost backbeat, hats, bridge vamp, strong-beat harmony, head/solos/head, mutes, solos and save/load passed');
