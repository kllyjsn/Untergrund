import assert from 'node:assert/strict';
import './jazz-nylon.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { freshSong, sanitize } from '../js/state.js';
import { Engine, Sequencer, stabPitches } from '../js/engine.js';
import { Recorder } from '../js/midi.js';
import { BOSSA_RIM, BOSSA_BATIDA, bossaBass, jazzHarmony, jazzChordTones, jazzNotes } from '../js/jazz.js';
import { parse } from '../js/describe.js';
import { styleFor } from '../js/song-plan.js';
import { BAND, liveSets } from '../js/livekit.js';
import { stageScene } from '../js/club-stage.js';
import { TRACK_IDS } from '../js/params.js';

const pc = (n) => (n % 12 + 12) % 12;
for (const text of ['bossa', 'bossa nova', 'Jobim', 'Brazilian jazz', 'samba jazz']) {
  assert.equal(styleFor(text), 'bossa', text);
  assert(parse(text).edits.some((e) => e.id === 'genre' && e.value === 'bossa'), text);
}
for (const seed of [1, 2, 3, 11, 42, 77, 1234]) {
  const s = freshSong('bossa', seed), p = s.patterns[6];
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(s))).patterns, s.patterns);
  assert(s.bpm >= 126 && s.bpm <= 142);
  assert.equal(s.scale, 'major'); assert.equal(s.master.swing8, 0);
  assert(s.swing > 0 && s.swing <= 0.04);
  assert.equal(s.master.duck, 0); assert.equal(s.master.kit, 1);
  assert(s.master.room <= 0.1 && s.master.revLevel <= 0.18);
  assert([18, 7].includes(s.params.stab.voice));
  assert(liveSets(s).includes('kit') && liveSets(s).includes(s.params.stab.voice === 18 ? 'nylon' : 'piano'));
  assert.equal(stageScene('bossa', s).kind, 'band');
  assert(s.chain.match(/^G+C+H+$/));
  for (let bar = 0; bar < 32; bar++) {
    const h = jazzHarmony(p, bar), next = jazzHarmony(p, bar + 1), bass = bossaBass(s.key, h, next);
    assert.deepEqual(bass.map((x) => x[0]), [0, 6, 8, 14]);
    assert.equal(pc(bass[0][2] - s.key), pc(h.r));
    assert.equal(pc(bass[2][2] - bass[0][2]), 7);
    assert.equal(bass[3][2], bossaBass(s.key, next, jazzHarmony(p, bar + 2))[0][2]);
    for (const [, dur, m] of bass) assert(dur > 0 && m >= 28 && m <= 50);
    for (const [at, dur, n] of jazzNotes('bossa', seed, bar, h, true)) {
      assert(dur > 0 && at + dur <= 16);
      if (at % 8 === 0) assert(jazzChordTones('bossa', h).some((v) => pc(h.r + v) === pc(n)));
    }
  }
  const record = (state) => {
    const e = new Recorder(state), seq = new Sequencer(e, state);
    for (let i = 0; i < 32; i++) seq.tick(i, 0.05 + i * e.stepDur);
    return e.notes;
  };
  const notes = record(s);
  assert(!notes.ride && !notes.clap && !notes.perc && !notes.vox);
  assert(notes.snare.every((n) => n.m === 37), 'MIDI uses cross stick, not a backbeat snare');
  const sd = 60 / s.bpm / 4;
  for (let bar = 0; bar < 2; bar++) {
    const at = (track) => [...new Set(notes[track].map((n) => Math.round((n.t - 0.05) / sd)).filter((i) => i >= bar * 16 && i < (bar + 1) * 16).map((i) => i % 16))];
    assert.deepEqual(at('snare'), BOSSA_RIM[bar]);
    assert.deepEqual(at('stab'), [...new Set([...BOSSA_BATIDA[bar], 0, 8])].sort((a, b) => a - b));
  }
  const thumb = stabPitches({ state: s, harm: jazzHarmony(p, 0), step: 8 });
  assert.equal(thumb.iv.length, 1, 'thumb fifth on beat three between chord plucks');
  const mute = structuredClone(s); mute.mutes = Object.fromEntries(TRACK_IDS.map((id) => [id, true]));
  assert.deepEqual(record(mute), {});
  let played;
  Engine.prototype.sampledHit.call({ state: s, liveHit: (...a) => played = a }, { snare_rim: {} }, 'snare', 0, 0.3);
  assert.equal(played[1], 'snare_rim');
  let upright = 0;
  Engine.prototype.sampledBass.call({ state: s, ch: { acid: { input: {} } }, playBuf: () => upright++, ctx: { createOscillator() { throw Error('synthetic sub'); } } }, {}, 0, 36, 0.5, false);
  assert.equal(upright, 1);
}
assert.deepEqual(jazzNotes('bossa', 42, 3, { r: 0, c: 9 }), [], 'melody breathes for a full bar');
const nylon = JSON.parse(readFileSync(new URL('../samples/nylon-provenance.json', import.meta.url)));
assert.equal(nylon.license, 'CC0-1.0');
assert.match(readFileSync(new URL('../samples/NYLON-LICENSE.txt', import.meta.url), 'utf8'), /CC0 1.0 Universal/);
assert.deepEqual(nylon.samples.map((r) => r.midi), BAND.nylon);
for (const row of nylon.samples) {
  const data = readFileSync(new URL(`../samples/live/${row.importedFile}`, import.meta.url));
  assert.equal(data.subarray(0, 4).toString(), 'fLaC');
  assert.equal(createHash('sha256').update(data).digest('hex'), row.importedSha256);
  assert(row.sourceActiveToTailDb > 40, 'exclude weak or noisy upper finger takes');
}
const guitar = freshSong('bossa', 42), played = [], banks = [];
Engine.prototype.stab.call({ state: guitar, ctx: {}, step: 3, harm: jazzHarmony(guitar.patterns[6], 0), ch: { stab: { band: {}, input: {} } }, rec: (name) => { banks.push(name); return [[60, {}]]; }, recordedNote: (...a) => played.push(a) }, 1, 0.5);
assert.deepEqual(banks, ['nylon']);
assert(played.length > 1 && played.every((a) => a[7] === 'nylon'));
assert(Math.abs(played[1][1] - played[0][1] - 0.002) < 1e-9, 'finger plucks are gently spread');
const invalid = freshSong('bossa', 42); invalid.patterns[0].jazz = { style: 'missing', seed: null };
assert(!sanitize(invalid).patterns[0].jazz);
console.log('bossa: aliases, save/load, straight grid, root/fifth anticipations, batida/thumb, 3-2 rim sample/MIDI, soft kit, breaths, mutes and acoustic upright passed');
