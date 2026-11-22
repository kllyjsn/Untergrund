import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { WIND_BANKS, WIND_TUNING, WIND_PEAKS } from '../js/jazz-wind-data.js';
import { windBanks, windNotches, bossaFluteNotches, recordedJazzWind } from '../js/jazz-winds.js';
import { jazzNotches, jazzHarmony } from '../js/jazz.js';
import { freshSong, sanitize, HOOK_VOICES } from '../js/state.js';
import { liveSets } from '../js/livekit.js';
import { Engine, Sequencer } from '../js/engine.js';
import { OfflineAudioContext } from './offline-audio.mjs';
import { Recorder } from '../js/midi.js';

assert.equal(HOOK_VOICES.indexOf('harmon'), 25, 'new colours preserve the saved Harmon voice index');
assert.equal(HOOK_VOICES.indexOf('marimba'), 26, 'sax dispatch preserves the saved marimba voice index');
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
  assert(windBanks(voice, style).every((bank) => liveSets(song).includes(bank)));
}
assert(!liveSets(freshSong('trap', 42)).some((n) => Object.hasOwn(WIND_BANKS, n)));
for (const style of ['swing', 'modal', 'bossa', 'jazzfunk']) {
  const song = freshSong(style, 42); song.chainOn = false; song.current = 6;
  const collect = (from = 0) => {
    const e = new Recorder(song), seq = new Sequencer(e, song), hits = [];
    e.hook = (...args) => hits.push({ step: e.step, pitch: args[2] + (args[5] || 0) * 12, take: args[9]?.take });
    if (from) seq.startAt(from, .05);
    for (let i = from; i < 128; i++) seq.tick(i, .05 + i * e.stepDur);
    return hits;
  };
  const hits = collect(), counts = new Map();
  for (const hit of hits) {
    const count = counts.get(hit.pitch) || 0;
    if (hit.step >= 16) assert.equal(hit.take, count % 2, `pitch ${hit.pitch}, step ${hit.step}: RR must continue across bars`);
    counts.set(hit.pitch, count + 1);
  }
  assert.deepEqual(collect(64), hits.filter((hit) => hit.step >= 64), 'seeking reconstructs the same written-note RR history');
  song.patterns[6].hook = { h: 1, v: 'tpt', o: 0, s: Array(32).fill(0), x: {} };
  song.patterns[6].hook.s[0] = [4, 1, .6]; song.patterns[6].hook.s[16] = [4, 1, .6];
  const placed = collect();
  assert.deepEqual(placed.map((hit) => hit.take), [0, 1, 0, 1, 0, 1, 0, 1], 'placed repeats continue across bars and phrase passes');
  assert.deepEqual(collect(64), placed.filter((hit) => hit.step >= 64), 'placed-note seeks reconstruct the same RR history');
}

const probe = (voice = 'tpt', velocity = .5, duration = .8, take = 0, missing, style, midi = 73) => {
  const calls = [], eq = [];
  const e = { rec: (bank) => bank === missing ? null : WIND_BANKS[bank].map((m) => [m + WIND_TUNING[bank][m] / 100, { bank, midi: m }]), trimOut: () => ({}), bodyFor: (out, shape) => { eq.push(shape); return out; }, playBuf: (...args) => calls.push(args) };
  const result = recordedJazzWind(e, 0, velocity * 1.3, midi, duration, voice, true, { take, style }, 2);
  return { result, calls, eq };
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
  assert.equal(fx.ringOut, !bank.startsWith('jts'), 'only held recordings reserve a tail before their buffer runs out');
  assert(fx.peaks.every(([, q, db]) => q >= 30 && db <= 0));
}
assert(!probe('tpt', .5, .8, 0, 'jtv2').result, 'an incomplete bank returns to existing recorded/synth fallback');
{
  const ctx = new OfflineAudioContext(2, 48000, 48000), fx = probe('tpt', .6, .2).calls[0][6];
  const e = { ctx, gain(v) { const g = ctx.createGain(); g.gain.value = v; return g; }, startSource(s, t, offset) { s.start(t, offset); } };
  const played = Engine.prototype.playBuf.call(e, ctx.createBuffer(1, 14400, 48000), 1, .4, ctx.destination, 2 ** (2 / 12), .184, fx);
  const release = played.g.gain.events.find((x) => x.k === 'g' && x.v === 0);
  assert(Math.abs(release.t - 1.184) < 1e-9, 'a tuned short recording must hold its written gate, not damp after 20 ms');
}
for (const duration of [.15, .5, .85, 1.2]) {
  const { result, calls, eq } = probe('airflute', .6, duration, 1, 'jflb', 'bossa');
  assert(result && calls.length === 1, 'Bossa can play a complete sustain bank while expressive takes load');
  assert.equal(calls[0][0].bank, 'jfl', 'Bossa keeps the sustain performance through short and held notes');
  assert.deepEqual(eq, [[2950, .8, 6.2], [780, 1.2, -2.5]], 'Bossa restores the original presence/body peaking stages');
  assert.deepEqual(calls[0][6].peaks, jazzNotches('fl', calls[0][0].midi, calls[0][4]), 'Bossa retains only the legacy named-line corrections at the actual playback rate');
}
const bossaA = probe('airflute', .6, .5, 1, undefined, 'bossa', 68).calls[0];
assert.equal(bossaA[0].midi, 69);
assert.deepEqual(bossaA[6].peaks, [[2644 * bossaA[4], 40, -3], [3088 * bossaA[4], 60, -14]], 'the A4 sustain retains its recalibrated narrow lines without the deep body cut');
assert.deepEqual(bossaFluteNotches(69, 2), [[5288, 40, -3], [6176, 60, -14]]);
assert.deepEqual(bossaFluteNotches(64, 1.5), [[3954, 35, -16]]);
assert.deepEqual(bossaFluteNotches(61), []);
for (const rate of [NaN, Infinity, 0, -1]) assert.deepEqual(bossaFluteNotches(69, rate), []);
assert(!probe('airflute', .6, .5, 1, 'jfl', 'bossa').result, 'Bossa retains the loading fallback when sustain recordings are missing');
assert.equal(probe('airflute', .6, .5, 0, undefined, 'bossa', 62).calls[0][0].midi, 60, 'Bossa keeps the original lower root at nominal-pitch ties');
for (const style of ['swing', 'modal', 'jazzfunk', undefined]) {
  const { calls, eq } = probe('airflute', .6, .5, 1, undefined, style);
  assert.equal(calls[0][0].bank, 'jflb', 'other styles keep their existing expressive alternation');
  assert.deepEqual(eq, [], 'Bossa body stages never reach another style');
}
assert.deepEqual(probe('tpt', .6, .5, 1, undefined, 'bossa').eq, [], 'Bossa trumpet is untouched');
assert(!recordedJazzWind({ rec() {} }, 0, .5, 70, .2, 'reed', false, {}, 1), 'unrelated voices do not allocate nodes');
{
  const level = (style, velocity = .4, midi = 65, duration = .8, voice = 'tpt', take = 0) => probe(voice, velocity, duration, take, undefined, style, midi).calls[0][2];
  assert(Math.abs(level('bossa') / level('modal') - 10 ** (-3.2 / 20)) < 1e-12, 'Bossa level-matches the soft F4 sustain take');
  for (const args of [[.9, 65, .8], [.4, 63, .8], [.4, 65, .15], [.4, 65, .8, 'harmon']]) {
    assert.equal(level('bossa', ...args), level('modal', ...args), 'other roots, layers and articulations retain their gain');
  }
  for (const style of ['swing', 'jazzfunk', undefined]) assert.equal(level(style), level('modal'), 'the take correction is Bossa-only');
  assert.equal(level('bossa', .4, 65, .8, 'tpt', NaN), level('bossa'), 'invalid take indices keep the deterministic sustain fallback');
  assert(!probe('tpt', .4, .8, 0, 'jtv1', 'bossa', 65).result, 'missing sustain recordings still use the existing fallback');
}
{
  const state = freshSong('bossa', 11), ctx = new OfflineAudioContext(2, 48000, 48000), calls = [], requested = [];
  const e = { state, ctx, harm: jazzHarmony(state.patterns[6], 0), playingPattern: state.patterns[6], hookBus: ctx.destination,
    rec(bank) { requested.push(bank); return bank === 'jfl' ? WIND_BANKS.jfl.map((m) => [m + WIND_TUNING.jfl[m] / 100, { bank, midi: m }]) : null; },
    trimOut: () => ctx.destination, bodyFor: (out) => out, playBuf: (...args) => calls.push(args),
  };
  Engine.prototype.hook.call(e, 0, .6, 7, .5, 'airflute', 0);
  assert.equal(calls[0][0].bank, 'jfl', 'the selected recorded flute plays without loading legacy fallback banks');
  assert(!requested.includes('fl'));
}
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
