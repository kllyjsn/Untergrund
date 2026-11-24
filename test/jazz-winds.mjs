import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { WIND_BANKS, WIND_TUNING, WIND_PEAKS } from '../js/jazz-wind-data.js';
import { windBanks, windNotches, bossaFluteNotches, windTone, recordedJazzWind } from '../js/jazz-winds.js';
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
  const voice = song.patterns[6].hook.v;
  const collect = (from = 0) => {
    const e = new Recorder(song), seq = new Sequencer(e, song), hits = [];
    e.hook = (...args) => hits.push({ step: e.step, pitch: args[2] + (args[5] || 0) * 12, velocity: args[1], duration: args[3], take: args[9]?.take });
    if (from) seq.startAt(from, .05);
    for (let i = from; i < 128; i++) seq.tick(i, .05 + i * e.stepDur);
    return hits;
  };
  const hits = collect(), counts = new Map();
  for (const hit of hits) {
    if (voice === 'tpt' && hit.duration > .26) continue;
    const key = voice === 'tpt' ? `${hit.pitch}:${hit.velocity < .48 ? 1 : hit.velocity < .75 ? 2 : 3}` : hit.pitch;
    const count = counts.get(key) || 0;
    if (hit.step >= 16) assert.equal(hit.take, count % 2, `pitch ${hit.pitch}, step ${hit.step}: RR must continue across bars`);
    counts.set(key, count + 1);
  }
  assert.deepEqual(collect(64), hits.filter((hit) => hit.step >= 64), 'seeking reconstructs the same written-note RR history');
  song.patterns[6].hook = { h: 1, v: 'tpt', o: 0, s: Array(32).fill(0), x: {} };
  song.patterns[6].hook.s[0] = [4, 1, .6]; song.patterns[6].hook.s[16] = [4, 1, .6];
  const placed = collect();
  assert.deepEqual(placed.map((hit) => hit.take), [0, 1, 0, 1, 0, 1, 0, 1], 'placed repeats continue across bars and phrase passes');
  assert.deepEqual(collect(64), placed.filter((hit) => hit.step >= 64), 'placed-note seeks reconstruct the same RR history');
}

for (const [style, legacy] of [['swing', false], ['modal', false], ['jazzfunk', false], ['bossa', false], ['bossa', true]]) {
  const song = freshSong(style, 7); song.chainOn = false; song.current = 6; song.ending = false;
  delete song.feel;
  const pat = song.patterns[6];
  if (legacy) delete pat.jazz.bossaPart;
  const collect = (from = 0) => {
    const e = new Recorder(song), seq = new Sequencer(e, song), hits = [];
    e.rec = (bank) => WIND_BANKS[bank]?.map((m) => [m, { bank, midi: m }]);
    e.trimOut = () => ({});
    e.bodyFor = (out) => out;
    e.playBuf = (buf, t, v, out, rate) => hits.push({ step: e.step, bank: buf.bank, pitch: Math.round(buf.midi + 12 * Math.log2(rate)) });
    e.hook = Engine.prototype.hook.bind(e);
    if (from) seq.startAt(from, .05);
    for (let i = from; i < 256; i++) seq.tick(i, .05 + i * e.stepDur);
    return hits;
  };
  pat.hook.v = 'tpt';
  const generated = collect();
  assert(generated.length, `${style}/${legacy}: real dispatcher reaches recorded winds`);
  const counts = new Map();
  for (const hit of generated) if (hit.bank.startsWith('jts')) {
    const key = `${hit.pitch}:${hit.bank.slice(0, -1)}`, count = counts.get(key) || 0;
    assert.equal(hit.bank.at(-1), String(count % 2 + 1), `${style}/${legacy}: held notes and other dynamics never consume a staccato turn`);
    counts.set(key, count + 1);
  }
  assert.deepEqual(collect(128), generated.filter((h) => h.step >= 128), `${style}/${legacy}: generated-bank seek history`);
  pat.hook = { h: 1, v: 'tpt', o: 0, s: Array(32).fill(0), x: {} };
  for (const [at, duration, velocity] of [[0, 1, .6], [4, 4, .6], [8, 1, .3], [16, 1, .6], [20, 1, .9], [24, 1, .6]]) pat.hook.s[at] = [4, duration, velocity];
  const placed = collect();
  assert.deepEqual(placed.slice(0, 6).map((h) => h.bank), ['jts21', 'jtv1', 'jts11', 'jts22', 'jts31', 'jts21']);
  for (const from of [16, 32, 128]) assert.deepEqual(collect(from), placed.filter((h) => h.step >= from), `${style}/${legacy}: placed banks after short/held/different-dynamic seek`);
  song.chainOn = true; song.chain = 'G'.repeat(16); song.feel = 'longing'; song.bpm = 58;
  const breathed = collect();
  assert.deepEqual(collect(128), breathed.filter((h) => h.step >= 128), `${style}/${legacy}: seek reconstructs duration thresholds with feeling tempo and swing`);
  assert.equal(new Sequencer(new Recorder(song), song).jazzExpression(pat.hook, [], 0, 0), pat.hook.x, 'an empty note list does not advance RR');
}

const probe = (voice = 'tpt', velocity = .5, duration = .8, take = 0, missing, style, midi = 73) => {
  const calls = [], eq = [];
  const e = { rec: (bank) => bank === missing ? null : WIND_BANKS[bank].map((m) => [m + WIND_TUNING[bank][m] / 100, { bank, midi: m }]), trimOut: () => ({}), bodyFor: (out, shape) => { eq.push(shape); return out; }, playBuf: (...args) => calls.push(args) };
  const result = recordedJazzWind(e, 0, velocity * 1.3, midi, duration, voice, true, { take, style }, 2);
  return { result, calls, eq };
};
const withoutTone = (call) => call.map((v, i) => i === 2 ? 0 : i === 6 ? (({ shelves, fade, offset, attackGain, ...fx }) => fx)(v) : v);
for (const velocity of [0, .3, .6, .9]) for (const duration of [.15, .8]) for (const take of [0, 1]) {
  const reference = probe('tpt', velocity, duration, take, undefined, 'swing').calls[0];
  const actual = probe('tpt', velocity, duration, take, undefined, 'jazzfunk').calls[0];
  assert.equal(actual[2], reference[2] * 10 ** (2 / 20), 'Jazz-Funk alone lifts every recorded trumpet layer and articulation by 2 dB');
  assert.deepEqual(withoutTone(actual), withoutTone(reference), 'style voicing preserves bank, take, tuning, source notches, release and tail');
  assert.equal(actual[6].attackGain, 1);
  assert.equal(actual[6].offset, .02);
  assert.equal(actual[6].fade, .004);
  for (const style of ['modal', undefined]) {
    const other = probe('tpt', velocity, duration, take, undefined, style).calls[0];
    assert.equal(other[2], reference[2], 'other styles retain their gain');
    assert.deepEqual(withoutTone(other), withoutTone(reference));
  }
}
for (const voice of ['harmon', 'airflute']) assert.deepEqual(probe(voice, .6, .8, 0, undefined, 'jazzfunk').calls, probe(voice, .6, .8, 0, undefined, 'swing').calls, 'the Jazz-Funk lift never affects another wind voice');
const missingFunk = probe('tpt', .6, .8, 0, 'jtv1', 'jazzfunk');
assert.equal(missingFunk.result, false);
assert.deepEqual(missingFunk.calls, [], 'a failed Jazz-Funk bank retains the loading fallback');
assert.deepEqual(missingFunk.eq, [], 'missing recordings never create tone nodes');
const tones = {
  swing: { body: [[1800, 1.2, 4.3], [2050, 4, -8.4], [2800, 4, -6.87], [3600, 1.4, -.68]], shelves: [[2600, -11.31], [5000, -13.8]] },
  modal: { body: [[1800, 1.2, -.46], [2050, 4, -16.17], [2300, 1.4, 16], [2800, 4, 11.23], [3600, 1.4, -16.37]], shelves: [[2600, -3.09], [5000, -19.72]] },
  bossa: { body: [[1800, 1.2, 3.83], [2050, 4, -15.02], [2300, 1.4, 2.18], [2800, 4, 5.13], [3600, 1.4, -4.13]], shelves: [[2600, -10.71], [5000, -15.58]] },
  flute: { body: [[2050, 4, 1.35], [2300, 1.4, -.53], [2800, 4, 1.16], [3600, 1.4, 3.25]], shelves: [[2600, -1.39], [5000, -3.8]] },
  jazzfunk: { body: [[2300, 1.4, -.4], [2800, 2, -2.17], [3600, 1.4, -.17], [1800, 1.2, 1.13], [2300, 1.4, .15], [3600, 1.4, .02]], shelves: [[2600, -16.28], [5000, -7.38]] },
};
for (const [key, expected] of Object.entries(tones)) for (const short of [false, true]) {
  const style = key === 'flute' ? 'bossa' : key, voice = key === 'flute' ? 'airflute' : 'tpt';
  const body = expected.body, envelope = style === 'jazzfunk' ? { fade: .004, offset: .02, attackGain: 1 } : { fade: voice === 'airflute' ? .012 : .028 };
  assert.deepEqual(windTone(style, voice, short), { body, shelves: expected.shelves, ...envelope });
  const { calls, eq } = probe(voice, .6, short ? .15 : .8, 0, undefined, style);
  assert.deepEqual(eq, [...(key === 'flute' ? [[2950, .8, 6.2], [780, 1.2, -2.5]] : []), ...body], 'the cached wind bus receives only its style/articulation body stages');
  assert.deepEqual(calls[0][6].shelves, expected.shelves);
  assert.equal(calls[0][6].fade, envelope.fade);
  assert.equal(calls[0][6].offset, envelope.offset);
  assert.equal(calls[0][6].attackGain, envelope.attackGain ?? 1.02);
}
for (const style of [undefined, null, '', 'trap', 'country', 'constructor', '__proto__']) for (const voice of ['tpt', 'airflute', 'harmon', 'reed']) assert.equal(windTone(style, voice), null);
for (const style of ['swing', 'modal', 'jazzfunk']) assert.equal(windTone(style, 'airflute'), null);
for (const style of ['swing', 'modal', 'bossa', 'jazzfunk']) for (const voice of ['harmon', 'reed', 'constructor', '__proto__']) assert.equal(windTone(style, voice), null);
const sustainBody = [[1000, .7, 2.28], [1800, 1, .39], [2800, 3, .13]];
for (const midi of [76, 77, 78]) {
  const { calls, eq } = probe('tpt', .9, .7, 0, undefined, 'jazzfunk', midi);
  assert.equal(calls[0][0].bank, 'jtv2'); assert.equal(calls[0][0].midi, 77);
  assert.deepEqual(eq, [...windTone('jazzfunk', 'tpt').body, ...sustainBody], 'only the identified hard sustain receives the fitted body restoration');
  assert.equal(calls[0][6].release, .055);
}
assert.deepEqual(windTone('jazzfunk', 'tpt', false, 'jtv2', 77.0005).body, [...tones.jazzfunk.body, ...sustainBody]);
assert.deepEqual(windTone('jazzfunk', 'tpt', true, 'jtv2', 77).body, [...tones.jazzfunk.body, ...sustainBody]);
for (const bank of ['jtv1', 'jts21', 'jts31', undefined]) assert.deepEqual(windTone('jazzfunk', 'tpt', false, bank, 77), windTone('jazzfunk', 'tpt'));
for (const root of [74, 81, NaN, Infinity, undefined, null]) assert.deepEqual(windTone('jazzfunk', 'tpt', false, 'jtv2', root), windTone('jazzfunk', 'tpt'));
for (const style of ['swing', 'modal', 'bossa']) assert.deepEqual(windTone(style, 'tpt', false, 'jtv2', 77), windTone(style, 'tpt'));
const takeCuts = { 60: [2611, 60, -18], 65: [2812, 60, -12], 77: [2795, 60, -12] };
const stemCuts = {
  jtv1: { 74: [[2931, 60, -10]] },
  jtv2: { 60: [[2879.2, 60, -10], [3150, 60, -18]], 65: [[2461.4, 628.96, -12.01]], 67: [[2745.9, 60, -6]], 70: [[2796, 60, -10], [3263.1, 60, -8]], 74: [[2923, 60, -10]] },
  jts21: { 60: [[3141.3, 60, -18]], 67: [[3150.4, 60, -18]], 74: [[2931, 60, -10]] },
  jts22: { 65: [[3147.8, 60, -18]] },
  jts31: { 70: [[2319.1, 60, -10]], 77: [[2764.6, 60, -6]] },
  jts32: { 70: [[2760.2, 45, -12]], 74: [[2927.4, 60, -18]], 77: [[2757.9, 60, -6]] },
};
const expectedTakeCuts = (bank, root, style) => {
  const prior = bank === 'jtv2' && takeCuts[root] ? [takeCuts[root]] : bank === 'jts21' && root === 74 ? [[2929, 60, -18]] : bank === 'jfl' && root === 69 ? [[2631, 60, -6]] : [];
  const added = (stemCuts[bank]?.[root] || []).map(([f, q, db]) => [f, q, style === 'modal' && bank === 'jtv2' && root === 65 ? -14 : db]);
  const scoped = style === 'bossa' && bank === 'jtv2' && root === 63 ? [[2819.5, 60, -6]] : style === 'bossa' && bank === 'jtv2' && root === 67 ? [[2739, 40, -27], [3131, 40, -27]] : style === 'swing' && bank === 'jts31' && root === 65 ? [[2790.6, 60, -3]] : [];
  return [...prior, ...added, ...scoped];
};
for (const [root, cut] of Object.entries(takeCuts)) {
  for (const style of ['bossa', 'swing', 'modal', 'jazzfunk', undefined]) for (const midi of [+root, +root + 1]) {
    const [buf, , level, , rate, , fx] = probe('tpt', .9, .7, 0, undefined, style, midi).calls[0];
    assert.equal(buf.bank, 'jtv2'); assert.equal(buf.midi, +root);
    assert.deepEqual(fx.peaks, [...WIND_PEAKS.jtv2[root], ...expectedTakeCuts('jtv2', +root, style)].map(([f, q, db]) => [f * rate, q, db]), 'the identified hard sustain carries its narrow correction at the actual transposed rate');
    assert.equal(level, .8 * (style === 'jazzfunk' ? 10 ** (2 / 20) : 1), 'take EQ preserves body gain and the approved Jazz-Funk lift');
  }
  for (const rate of [NaN, Infinity, 0, -1]) assert.deepEqual(windNotches('jtv2', +root, rate), []);
  const missing = probe('tpt', .9, .7, 0, 'jtv2', 'jazzfunk', +root);
  assert.equal(missing.result, false); assert.deepEqual(missing.calls, [], 'a corrected take never bypasses loading fallback');
}
for (const [voice, bank, root, cut, velocity, duration] of [
  ['tpt', 'jts21', 74, [2929, 60, -18], .6, .15],
  ['airflute', 'jfl', 69, [2631, 60, -6], .6, 1.2],
]) {
  for (const style of ['bossa', 'swing', 'modal', 'jazzfunk', undefined]) for (const midi of [root - 2, root, root + 1]) {
    const [buf, , level, , rate, , fx] = probe(voice, velocity, duration, 0, undefined, style, midi).calls[0];
    assert.equal(buf.bank, bank); assert.equal(buf.midi, root);
    const base = style === 'bossa' && voice === 'airflute' ? [[2644 * rate, 40, -3], [3088 * rate, 60, -14]] : WIND_PEAKS[bank][root].map(([f, q, db]) => [f * rate, q, db]);
    assert.deepEqual(fx.peaks, [...base, ...expectedTakeCuts(bank, root, style).map(([f, q, db]) => [f * rate, q, db])], 'only the identified take tracks its partial through the played MIDI and measured tuning');
    assert.equal(level, (voice === 'airflute' ? 1.02 : .4) * (velocity * 1.3) * 2 * (style === 'jazzfunk' && voice === 'tpt' ? 10 ** (2 / 20) : 1), 'narrow cuts preserve gain and the approved trumpet lift');
  }
  for (const rate of [NaN, Infinity, 0, -1]) assert.deepEqual(windNotches(bank, root, rate), []);
  const missing = probe(voice, velocity, duration, 0, bank, 'bossa', root);
  assert.equal(missing.result, false); assert.deepEqual(missing.calls, [], 'a missing corrected recording still falls back');
}
for (const [voice, velocity, duration, take, bank, root] of [
  ['tpt', .3, .15, 0, 'jts11', 74], ['tpt', .6, .15, 1, 'jts22', 74],
  ['tpt', .9, .15, 0, 'jts31', 74], ['tpt', .6, .8, 0, 'jtv1', 70],
  ['airflute', .6, .5, 1, 'jflb', 69], ['harmon', .6, .8, 0, 'jhm1', 70],
]) {
  const [buf, , , , rate, , fx] = probe(voice, velocity, duration, take, undefined, 'swing', root).calls[0];
  assert.equal(buf.bank, bank); assert.equal(buf.midi, root);
  assert.deepEqual(fx.peaks, WIND_PEAKS[bank][root].map(([f, q, db]) => [f * rate, q, db]), 'other dynamics, RR takes and instruments stay unchanged');
}
for (const [voice, velocity, duration, take, bank] of [
  ['tpt', .4, .8, 0, 'jtv1'], ['tpt', .9, .8, 0, 'jtv2'],
  ['tpt', .3, .15, 0, 'jts11'], ['tpt', .3, .15, 1, 'jts12'],
  ['tpt', .6, .15, 0, 'jts21'], ['tpt', .9, .15, 1, 'jts32'],
  ['tpt', .48, .26, 1, 'jts22'], ['tpt', .75, .26, 0, 'jts31'],
  ['tpt', .6, .260001, 1, 'jtv1'],
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
  for (const midi of [67, 68]) {
    const { calls } = probe('tpt', .9, .7, 0, undefined, 'bossa', midi);
    const [buf, , level, , rate, , fx] = calls[0];
    assert.equal(buf.bank, 'jtv2');
    assert.equal(buf.midi, 67, 'the G4 hard sustain also covers the transposed Bossa 7 note');
    assert.deepEqual(fx.peaks, [...windNotches('jtv2', 67, rate), [2739 * rate, 40, -27], [3131 * rate, 40, -27]], 'only this take receives the two tuned narrow-line cuts');
    assert.equal(level, probe('tpt', .9, .7, 0, undefined, 'modal', midi).calls[0][2], 'the correction preserves the take body gain');
  }
  for (const [voice, velocity, duration, midi] of [['tpt', .4, .7, 67], ['tpt', .9, .15, 67], ['tpt', .9, .7, 65], ['harmon', .9, .7, 67], ['airflute', .9, .7, 67]]) {
    const [buf, , , , rate, , fx] = probe(voice, velocity, duration, 0, undefined, 'bossa', midi).calls[0];
    assert.deepEqual(fx.peaks, voice === 'airflute' ? bossaFluteNotches(buf.midi, rate) : windNotches(buf.bank, buf.midi, rate), 'other takes, dynamics and articulations keep their treatment');
  }
  for (const style of ['swing', 'modal', 'jazzfunk', undefined]) {
    const [buf, , , , rate, , fx] = probe('tpt', .9, .7, 0, undefined, style, 67).calls[0];
    assert.deepEqual(fx.peaks, windNotches(buf.bank, buf.midi, rate), 'the hard-take correction never reaches another style');
  }
  assert.deepEqual(windNotches('missing', 67, 1, 'bossa'), []);
  for (const rate of [NaN, Infinity, 0, -1]) assert.deepEqual(windNotches('jtv2', 67, rate, 'bossa'), []);
  assert(!probe('tpt', .9, .7, 0, 'jtv2', 'bossa', 67).result, 'a failed bank retains the normal loading fallback');
}
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
  assert.deepEqual(eq.slice(0, 2), [[2950, .8, 6.2], [780, 1.2, -2.5]], 'Bossa retains the original presence/body stages before wind voicing');
  assert.deepEqual(calls[0][6].peaks, jazzNotches('fl', calls[0][0].midi, calls[0][4]), 'Bossa retains only the legacy named-line corrections at the actual playback rate');
}
const bossaA = probe('airflute', .6, .5, 1, undefined, 'bossa', 68).calls[0];
assert.equal(bossaA[0].midi, 69);
assert.deepEqual(bossaA[6].peaks, [[2644 * bossaA[4], 40, -3], [3088 * bossaA[4], 60, -14], [2631 * bossaA[4], 60, -6]], 'the A4 sustain retains its existing lines and tracks the newly localized partial');
assert.deepEqual(bossaFluteNotches(69, 2), [[5288, 40, -3], [6176, 60, -14], [5262, 60, -6]]);
assert.deepEqual(bossaFluteNotches(64, 1.5), [[3954, 35, -16], [3452.25, 60, -10]]);
for (const midi of [63, 64, 65, 66]) {
  const [buf, , , , rate, , fx] = probe('airflute', .6, .7, 0, undefined, 'bossa', midi).calls[0];
  assert.equal(buf.bank, 'jfl'); assert.equal(buf.midi, 64);
  assert.deepEqual(fx.peaks, [[2636 * rate, 35, -16], [2301.5 * rate, 60, -10]], 'the E4 take cut follows every played note including Bossa11 MIDI66, preserving the original cut');
  assert.deepEqual(windNotches('jfl', 64, rate, 'swing'), WIND_PEAKS.jfl[64].map(([f, q, db]) => [f * rate, q, db]), 'the Bossa-only E4 correction never changes other styles');
}
for (const rate of [NaN, Infinity, 0, -1]) assert.deepEqual(bossaFluteNotches(64, rate), []);
assert.deepEqual(bossaFluteNotches(61), []);
for (const rate of [NaN, Infinity, 0, -1]) assert.deepEqual(bossaFluteNotches(69, rate), []);
assert(!probe('airflute', .6, .5, 1, 'jfl', 'bossa').result, 'Bossa retains the loading fallback when sustain recordings are missing');
assert.equal(probe('airflute', .6, .5, 0, undefined, 'bossa', 62).calls[0][0].midi, 60, 'Bossa keeps the original lower root at nominal-pitch ties');
for (const style of ['swing', 'modal', 'jazzfunk', undefined]) {
  const { calls, eq } = probe('airflute', .6, .5, 1, undefined, style);
  assert.equal(calls[0][0].bank, 'jflb', 'other styles keep their existing expressive alternation');
  assert.deepEqual(eq, [], 'Bossa body stages never reach another style');
}
assert.deepEqual(probe('tpt', .6, .5, 1, undefined, 'bossa').eq, windTone('bossa', 'tpt').body, 'Bossa trumpet never receives flute presence stages');
assert(!recordedJazzWind({ rec() {} }, 0, .5, 70, .2, 'reed', false, {}, 1), 'unrelated voices do not allocate nodes');
{
  const level = (style, velocity = .4, midi = 65, duration = .8, voice = 'tpt', take = 0) => probe(voice, velocity, duration, take, undefined, style, midi).calls[0][2];
  assert(Math.abs(level('bossa') / level('modal') - 10 ** (-3.2 / 20)) < 1e-12, 'Bossa level-matches the soft F4 sustain take');
  for (const args of [[.9, 65, .8], [.4, 63, .8], [.4, 65, .15], [.4, 65, .8, 'harmon']]) {
    assert.equal(level('bossa', ...args), level('modal', ...args), 'other roots, layers and articulations retain their gain');
  }
  for (const style of ['swing', undefined]) assert.equal(level(style), level('modal'), 'the take correction is Bossa-only');
  assert.equal(level('jazzfunk'), level('modal') * 10 ** (2 / 20), 'Jazz-Funk uses its separate whole-trumpet gain, not the Bossa take trim');
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
  const song = freshSong(style, 42); song.chain = style === 'jazzfunk' ? 'G'.repeat(16) + 'C'.repeat(24) + 'H'.repeat(16) : 'GGGGGGGG'; song.ending = false;
  const e = new Recorder(song), seq = new Sequencer(e, song), takes = [];
  e.hook = (...args) => takes.push({ step: e.step, pitch: args[2], duration: args[3], velocity: args[1], take: args[9]?.take });
  for (let i = 0; i < song.chain.length * 16; i++) seq.tick(i, .05 + i * e.stepDur);
  assert(takes.length, `${style}: the generated wind actually enters`);
  if (style === 'jazzfunk') assert(takes.every((hit) => hit.step >= 64), 'the written rhythm intro remains wind tacet');
  const counts = new Map();
  for (const hit of takes) {
    const trumpet = song.patterns[6].hook.v === 'tpt';
    if (trumpet && hit.duration > .26) { assert.equal(hit.take, 0); continue; }
    const key = trumpet ? `${hit.pitch}:${hit.velocity < .48 ? 1 : hit.velocity < .75 ? 2 : 3}` : hit.pitch;
    const count = counts.get(key) || 0;
    assert.equal(hit.take, count % 2, `${style}: dispatched RR counts only the matching recorded bank`);
    counts.set(key, count + 1);
  }
  song.patterns[6].hook = { h: 1, v: 'airflute', o: 0, s: Array(32).fill(0), x: {} };
  song.patterns[6].hook.s[0] = [4, 1, .6]; song.patterns[6].hook.s[4] = [4, 1, .6];
  if (style === 'jazzfunk') { song.chainOn = false; song.current = 6; }
  const placed = new Recorder(song), player = new Sequencer(placed, song), pair = [];
  placed.hook = (...args) => pair.push(args[9]?.take);
  for (let i = 0; i < 16; i++) player.tick(i, .05 + i * placed.stepDur);
  assert.deepEqual(pair, [0, 1], `${style}: repeated placed winds retain deterministic take alternation`);
}
assert.deepEqual(windNotches('jtv1', 70, NaN), []);
assert.deepEqual(windNotches('missing', 70, 1), []);
for (const [bank, notes] of Object.entries(WIND_PEAKS)) for (const [m, peaks] of Object.entries(notes)) {
  for (const style of ['swing', 'modal', 'bossa', 'jazzfunk', undefined, 'constructor']) for (const rate of [.9, 1, 2]) {
    assert.deepEqual(windNotches(bank, +m, rate, style), [...peaks, ...expectedTakeCuts(bank, +m, style)].map(([f, q, db]) => [f * rate, q, db]), 'only localized recordings and styles gain pitch-tracked stem corrections');
  }
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
