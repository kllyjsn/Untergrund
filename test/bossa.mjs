import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { freshSong, sanitize } from '../js/state.js';
import { Engine, Sequencer, stabPitches } from '../js/engine.js';
import { Recorder } from '../js/midi.js';
import { BOSSA_RIM, BOSSA_BATIDA, bossaBass, jazzHarmony, jazzChordTones, jazzNotes } from '../js/jazz.js';
import { bossaGrip, bossaLine } from '../js/bossa.js';
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
  assert.match(s.chain, /^A{8}G{16}E{16}H{16}C{16}F{16}(C{16})?H{16}B{8}$/);
  assert.match(freshSong('bossa', seed, { length: 'sketch' }).chain, /^G{8}E{8}H{8}B{8}$/);
  assert.equal(p.prog.length, 16);
  assert.notDeepEqual(s.patterns[4].prog, p.prog, 'the bridge moves through different harmony');
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
  const record = (state, from = 0, bars = state.chain.length) => {
    const e = new Recorder(state), seq = new Sequencer(e, state);
    seq.chainPos = from;
    for (let i = from * 16; i < (from + bars) * 16; i++) seq.tick(i, 0.05 + i * e.stepDur);
    return e.notes;
  };
  const notes = record(s, 8, 2);
  assert(!notes.ride && !notes.clap && !notes.perc && !notes.vox);
  assert(notes.snare.every((n) => n.m === 37), 'MIDI uses cross stick, not a backbeat snare');
  const sd = 60 / s.bpm / 4, base = 8 * 16;
  for (let bar = 0; bar < 2; bar++) {
    const at = (track) => [...new Set(notes[track].map((n) => Math.round((n.t - 0.05) / sd) - base).filter((i) => i >= bar * 16 && i < (bar + 1) * 16).map((i) => i % 16))];
    assert.deepEqual(at('snare'), BOSSA_RIM[bar]);
    assert.deepEqual(at('stab'), [...new Set([...BOSSA_BATIDA[bar], 0, 8])].sort((a, b) => a - b));
  }
  assert(notes.snare.every((n) => n.t > 0.05 + Math.round((n.t - 0.05) / sd) * sd), 'cross-stick leans behind the beat');
  assert(notes.stab[0].t < notes.stab[1].t, 'thumb leads the fingers on the opening pluck');
  const head = record(s, 8, 16), bridge = record(s, 24, 16), intro = record(s, 0, 4), tag = record(s, s.chain.length - 2, 2);
  assert(head.hook.length >= 48 && bridge.hook.length >= 40, 'both 16-bar themes sing complete phrases');
  assert(head.hook.some((n) => n.dur >= sd * 5) && head.hook.some((n) => n.dur < 2 * sd), 'held notes and short pickups');
  assert.notDeepEqual(head.hook.slice(0, 6).map((n) => n.m), bridge.hook.slice(0, 6).map((n) => n.m));
  assert(!intro.snare && !intro.hook && intro.stab, 'the guitar has room to introduce the song');
  assert.equal(pc(tag.hook.at(-1).m), pc(s.key), 'the tag resolves to the tonic');
  assert.equal(pc(tag.acid.at(-1).m), pc(s.key), 'the bass closes with the same tonic');
  assert.deepEqual(record(sanitize(structuredClone(s))), record(s), 'save/load preserves all Bossa performances');
  const upper = bossaGrip(p.prog[0], s.key, { chord: true });
  assert.equal(upper.length, 3);
  assert(upper.every((n) => n >= 53 && n <= 76));
  const reharm = { r: 3, c: 20 };
  assert(bossaLine('head', 0, reharm, seed).every(([, , n]) => [0, 3, 6, 10].includes(pc(n - reharm.r))), 'editable changes refit the authored melody');
  const thumb = stabPitches({ state: s, harm: jazzHarmony(p, 0), step: 8 });
  assert.equal(thumb.iv.length, 1, 'thumb fifth on beat three between chord plucks');
  const mute = structuredClone(s); mute.mutes = Object.fromEntries(TRACK_IDS.map((id) => [id, true]));
  assert.deepEqual(record(mute, 8, 2), {});
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
