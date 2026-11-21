import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { WIND_BANKS, WIND_TUNING, WIND_PEAKS } from '../js/jazz-wind-data.js';
import { windBanks, windNotches, recordedJazzWind } from '../js/jazz-winds.js';
import { freshSong, sanitize, HOOK_VOICES } from '../js/state.js';
import { liveSets } from '../js/livekit.js';
import { Sequencer } from '../js/engine.js';
import { Recorder } from '../js/midi.js';

assert.equal(HOOK_VOICES.at(-1), 'harmon', 'new colour appends without renumbering old voices');
assert.equal(freshSong('modal', 1).patterns[6].hook.v, 'tpt', 'Modal defaults to the open recorded trumpet');
const saved = freshSong('modal', 1); saved.patterns[6].hook.v = 'harmon';
assert.equal(sanitize(JSON.parse(JSON.stringify(saved))).patterns[6].hook.v, 'harmon', 'Harmon remains an explicit saved voice choice');
assert.equal(WIND_BANKS.jtv1.length, 11);
assert.equal(WIND_BANKS.jtv2.length, 11);
assert.equal(WIND_BANKS.jfl.length, 10);
assert.equal(WIND_BANKS.jflb.length, 10);
assert.equal(WIND_BANKS.jhm1.length, 8);
for (const style of ['swing', 'modal', 'bossa', 'jazzfunk']) {
  const song = freshSong(style, 42), voice = song.patterns[6].hook.v;
  assert(windBanks(voice).every((bank) => liveSets(song).includes(bank)));
}
assert(!liveSets(freshSong('trap', 42)).some((n) => Object.hasOwn(WIND_BANKS, n)));

const probe = (voice = 'tpt', velocity = .5, duration = .8, take = 0, missing) => {
  const calls = [];
  const e = { rec: (bank) => bank === missing ? null : WIND_BANKS[bank].map((m) => [m + WIND_TUNING[bank][m] / 100, { bank, midi: m }]), trimOut: () => ({}), playBuf: (...args) => calls.push(args) };
  const result = recordedJazzWind(e, 0, velocity * 1.3, 73, duration, voice, true, { take }, 2);
  return { result, calls };
};
for (const [voice, velocity, duration, take, bank] of [
  ['tpt', .4, .8, 0, 'jtv1'], ['tpt', .9, .8, 0, 'jtv2'],
  ['tpt', .3, .15, 0, 'jts11'], ['tpt', .3, .15, 1, 'jts12'],
  ['tpt', .6, .15, 0, 'jts21'], ['tpt', .9, .15, 1, 'jts32'],
  ['harmon', .4, .8, 0, 'jhm1'], ['harmon', .9, .8, 0, 'jhm3'],
  ['airflute', .6, .5, 0, 'jfl'], ['airflute', .6, .5, 1, 'jflb'],
  ['airflute', .6, 1.2, 1, 'jfl'],
]) {
  const { result, calls } = probe(voice, velocity, duration, take);
  assert(result && calls.length === 1);
  const [buf, , , , rate, , fx] = calls[0];
  assert.equal(buf.bank, bank);
  assert(Math.abs((buf.midi + WIND_TUNING[bank][buf.midi] / 100) + 12 * Math.log2(rate) - 73) < 1e-9);
  assert.equal(fx.lp, undefined, 'jazz wind treatment is not a broad low-pass');
  assert(fx.ringOut && fx.peaks.every(([, q, db]) => q >= 30 && db <= 0));
}
assert(!probe('tpt', .5, .8, 0, 'jtv2').result, 'an incomplete bank returns to existing recorded/synth fallback');
assert(!recordedJazzWind({ rec() {} }, 0, .5, 70, .2, 'reed', false, {}, 1), 'unrelated voices do not allocate nodes');
for (const style of ['swing', 'modal', 'bossa', 'jazzfunk']) {
  const song = freshSong(style, 42); song.chain = 'GGGGGGGG'; song.ending = false;
  const e = new Recorder(song), seq = new Sequencer(e, song), takes = [];
  e.hook = (...args) => takes.push(args[9]?.take);
  for (let i = 0; i < 128; i++) seq.tick(i, .05 + i * e.stepDur);
  assert(takes.includes(0) && takes.includes(1), `${style}: actual jazz dispatch alternates takes, not just direct helper calls`);
  song.patterns[6].hook = { h: 1, v: 'airflute', o: 0, s: Array(32).fill(0), x: {} };
  song.patterns[6].hook.s[0] = [4, 1, .6]; song.patterns[6].hook.s[4] = [4, 1, .6];
  const placed = new Recorder(song), player = new Sequencer(placed, song), pair = [];
  placed.hook = (...args) => pair.push(args[9]?.take);
  for (let i = 0; i < 16; i++) player.tick(i, .05 + i * placed.stepDur);
  assert.deepEqual(pair, [0, 1], `${style}: repeated placed winds retain deterministic take alternation`);
}
assert.deepEqual(windNotches('jtv1', 70, NaN), []);
assert.deepEqual(windNotches('missing', 70, 1), []);
for (const [bank, notes] of Object.entries(WIND_PEAKS)) for (const [m, peaks] of Object.entries(notes)) {
  assert.deepEqual(windNotches(bank, +m, 2), peaks.map(([f, q, db]) => [f * 2, q, db]));
  assert(peaks.every(([f]) => f > 1.1 * 440 * 2 ** ((+m - 69) / 12)), 'a high flute fundamental is the note, not an unwanted resonance');
}
const provenance = JSON.parse(readFileSync(new URL('../samples/jazz-winds-provenance.json', import.meta.url)));
assert.equal(provenance.license, 'CC0-1.0'); assert.equal(provenance.samples.length, 124);
assert.equal(provenance.processing.sampleRate, 48000); assert.equal(provenance.processing.bits, 24);
for (const sample of provenance.samples) {
  assert(Number.isFinite(sample.measuredCents) && sample.sourceUrl.includes(provenance.commit));
  assert.equal(createHash('sha256').update(readFileSync(new URL(`../samples/live/${sample.importedFile}`, import.meta.url))).digest('hex'), sample.importedSha256);
}
console.log('jazz winds: 124 licensed recordings, layered sustains/staccato RR, open Modal defaults, selectable Harmon, flute alternation, tuning and narrow EQ passed');
