import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VOWEL_BAND, VOWEL_TUNE } from '../js/vowels.js';
import { LIVE_FILES, BAND_FILES, KIT_EXTRA, HAND_FILES, BAND, TAKES, MUTE_LAYER, SOFT_LAYER, withTakes, liveSets, BAND_LAYER, playsAnalogBass } from '../js/livekit.js';
import { generate } from '../js/state.js';
import { Engine } from '../js/engine.js';
import { OfflineAudioContext } from './offline-audio.mjs';

const dir = new URL('../samples/live/', import.meta.url);
const license = readFileSync(new URL('LICENSE.md', dir), 'utf8');
const ALL = [...LIVE_FILES, ...BAND_FILES, ...KIT_EXTRA, ...HAND_FILES];
for (const f of ALL) assert.ok(existsSync(new URL(`${f}.flac`, dir)), `missing ${f}.flac`);
const files = readdirSync(dir).filter((f) => f !== 'LICENSE.md');
assert.deepEqual(files.sort(), ALL.map((f) => `${f}.flac`).sort(), 'every bundled sample is a used, listed .flac');
const prefixes = new Set(files.map((f) => f.split('_')[0]));
for (const p of prefixes) assert.ok(license.includes(`\`${p}_`), `${p}_* files have a license entry`);
assert.ok(license.includes('CC0 1.0 Universal'));
const manifest = JSON.parse(readFileSync(new URL('../scripts/vocal-samples.json', import.meta.url)));
const provenance = JSON.parse(readFileSync(new URL('../samples/vocal-provenance.json', import.meta.url)));
assert.deepEqual(manifest.map((v) => v.id), [763909, 763911, 763893]);
for (const entry of manifest) {
  const name = `vox_${entry.vowel}`, file = `${name}_${entry.midi}.flac`;
  assert.deepEqual(BAND[name], VOWEL_BAND[name]);
  assert(license.includes(`\`${file}\``) && license.includes(entry.source_url));
  assert.equal(entry.license, 'https://creativecommons.org/publicdomain/zero/1.0/');
  assert.equal(entry.download_url, `https://freesound.org/apiv2/sounds/${entry.id}/download/`);
  assert.match(entry.source_sha256, /^[a-f0-9]{64}$/);
  const report = provenance.find((p) => p.file === file);
  assert.equal(report.source_sha256, entry.source_sha256);
  assert.equal(report.sha256, createHash('sha256').update(readFileSync(new URL(file, dir))).digest('hex'));
  assert(Math.abs(report.after.cents) < 5);
  assert(Math.abs(VOWEL_TUNE[name][entry.midi] - report.after.cents) < 0.001);
  assert(Math.max(Math.abs(report.stability.min_cents), Math.abs(report.stability.max_cents)) < 5);
  assert(report.before.fundamental_over_suboctave_db > 6 && report.before.partial_levels[2] > report.before.partial_levels[0] * 0.05);
}
assert.ok(!/^\| `[^|]*\.wav`/m.test(license), 'license manifest lists the bundled .flac names');
// A take alternates note-for-note with the recording it doubles (js/engine.js recordedNote picks by index).
for (const [k, alt] of Object.entries(TAKES)) assert.deepEqual(BAND[alt], BAND[k], `${alt} covers the notes of ${k}`);
for (const [k, mute] of Object.entries(MUTE_LAYER)) assert.deepEqual(BAND[mute], BAND[k], `${mute} covers the notes of ${k}`);
// An offline render waits for every take, so an exported song has the same round robins and mutes as playback.
assert.deepEqual(withTakes(['gtr', SOFT_LAYER.gtr]).sort(), ['gtr', 'gtrb', 'gtrmute', 'gtrmuteb', 'gtrsoft', 'gtrsoftb']);
assert.deepEqual(withTakes(['agtr']).sort(), ['agtr', 'agtrb']);
// UK Garage's ORGAN chords and REESE bass load the recorded tonewheel organ and SH-2; another style's stay synth.
const ukg = { ...generate('ukg', 1), artist: { style: 'ukg' } };
assert.equal(Math.round(ukg.params.stab.voice), 3); assert.equal(Math.round(ukg.params.acid.voice), 3);
assert.ok(liveSets(ukg).includes('org') && liveSets(ukg).includes('abass'), 'UK Garage loads org + abass');
const organSeeds = [];
const bassVoices = new Set();
for (let sd = 1; sd <= 50; sd++) {
  const gf = { ...generate('gfunk', sd), artist: { style: 'gfunk' } };
  assert.ok([1, 7].includes(Math.round(gf.params.acid.voice)) && liveSets(gf).includes('abass'), `G-Funk seed ${sd} plays its synth bass on the SH-2`);
  assert.equal(liveSets(gf).includes('org'), Math.round(gf.params.stab.voice) === 3, `G-Funk seed ${sd} loads the organ only for its organ chords`);
  bassVoices.add(Math.round(gf.params.acid.voice));
  if (Math.round(gf.params.stab.voice) === 3) organSeeds.push(sd);
}
assert.deepEqual([...bassVoices].sort(), [1, 7]);
assert.ok(organSeeds.length > 0, 'generated G-Funk includes recorded organ chords');
for (const voice of [1, 7]) assert.ok(playsAnalogBass('gfunk', voice));
assert.ok(playsAnalogBass('ukg', 3));
for (const [style, voice] of [['ukg', 1], ['rock', 1], ['trap', 7], ['gfunk', 3], [undefined, 1], ['gfunk', undefined]]) assert.ok(!playsAnalogBass(style, voice));
for (const [style, voice, expected] of [['gfunk', 1, 'recorded'], ['gfunk', 7, 'recorded'], ['ukg', 3, 'recorded'], ['ukg', 1, 'synth'], ['rock', 1, 'synth']]) {
  const engine = {
    state: { artist: { style }, params: { acid: { voice } } }, playbackStyle: style,
    acidNodes: { vca: { gain: { setTargetAtTime() {}, cancelScheduledValues() {} } } }, gatedBasses: new Map(),
    rec: () => true, analogBass: () => 'recorded', bass: () => 'synth',
  };
  assert.equal(Engine.prototype.acidVoice.call(engine, 0, {}, false, false, 0.1), expected, `${style} voice ${voice} dispatch`);
}
for (const recorded of [true, false]) {
  const ctx = new OfflineAudioContext(1, 48000, 48000), input = ctx.createGain(), amp = ctx.createGain(), vca = ctx.createGain();
  amp.gain.setValueAtTime(1, 0.5); vca.gain.setValueAtTime(1, 0.5);
  let pickup;
  const engine = {
    ctx, state: { artist: { style: 'gfunk' }, params: { acid: { voice: 7 } } }, playbackStyle: 'gfunk',
    ch: { acid: { input } }, acidNodes: { vca }, gatedBasses: new Map([[7, { amp }]]),
    gain: Engine.prototype.gain, acidVoice: Engine.prototype.acidVoice, rec: () => recorded,
    analogBass: () => { pickup = engine.ch.acid.input; return 'recorded'; },
    pulseBass: () => { pickup = engine.ch.acid.input; return 'synth'; },
  };
  assert.equal(Engine.prototype.acid.call(engine, 0.1, { until: 0.2, targetAt: 0.3 }, false, false, 0.1), recorded ? 'recorded' : 'synth');
  assert.equal(engine.ch.acid.input, input, 'the pickup restores the main bass destination');
  assert.equal(pickup.gain.at(0.3), recorded ? 0 : 1, 'only a shared synth bank needs its pickup gate reopened');
  if (recorded) {
    assert.ok(amp.gain.at(0.6) < 1e-6 && vca.gain.at(0.6) < 1e-6, 'recorded routing cancels stale same-voice bank and synth VCA automation');
    engine.analogBass = () => { throw new Error('test playback failure'); };
    assert.throws(() => Engine.prototype.acid.call(engine, 0.7, { until: 0.8, targetAt: 0.9 }, false, false, 0.1), /test playback failure/);
    assert.equal(engine.ch.acid.input, input, 'a failed pickup also restores the destination');
  }
}
{
  const ctx = new OfflineAudioContext(1, 48000, 48000);
  const bassLevel = ({ voice = 3, level = 0.5, mutes = {}, solos = {} } = {}) => {
    let volume;
    const engine = {
      state: { params: { acid: { voice: 1, cutoff: 500, decay: 0.5, envmod: 0 }, stab: { voice, level } }, mutes, solos },
      playbackStyle: 'gfunk', ch: { acid: { input: ctx.destination } },
      rec: () => [[36, {}]], bassMidi: () => 36, monoNote: (t, f) => f, analogBassOut() { return this.ch.acid.input; },
      playBuf: (buf, t, v) => { volume = v; return { g: ctx.createGain() }; },
    };
    Engine.prototype.analogBass.call(engine, 0, {}, 0.1, false, false);
    return volume;
  };
  const normal = bassLevel({ voice: 1 }), ensemble = bassLevel();
  assert.ok(ensemble > 0 && ensemble < normal, 'an audible organ ensemble keeps its separately calibrated bass level');
  assert.equal(bassLevel({ mutes: { stab: true } }), normal, 'muted organ selection does not attenuate the bass');
  assert.equal(bassLevel({ solos: { acid: true } }), normal, 'a bass solo excludes the organ-ensemble trim');
  assert.equal(bassLevel({ level: 0 }), normal, 'a zero-level organ does not attenuate the bass');
  assert.equal(bassLevel({ solos: { acid: true, stab: true } }), ensemble, 'an audible soloed organ keeps the ensemble balance');
}
{
  const ctx = new OfflineAudioContext(1, 48000, 48000), sd = 60 / 92 / 4;
  const note = ({ style = 'gfunk', organ = false, hold = false, approach = false, voice = 1 } = {}) => {
    let call;
    const engine = {
      state: { params: { acid: { voice, cutoff: 485, decay: 0.2, envmod: 0.36 }, stab: { voice: organ ? 3 : 1 } } },
      playbackStyle: style, ch: { acid: { input: ctx.destination } },
      rec: () => [[36, {}]], bassMidi: () => 36, monoNote: (t, f) => f, analogBassOut() { return this.ch.acid.input; },
      playBuf: (buf, t, level, out, rate, len, fx) => {
        const g = ctx.createGain(); g.gain.value = level;
        g.gain.setValueAtTime(level, t + len);
        g.gain.setTargetAtTime(0, t + len, fx.release);
        call = { level, len, fx, amp: g.gain }; return { g };
      },
    };
    Engine.prototype.analogBass.call(engine, 0, { ap: approach }, sd, hold, false);
    return call;
  };
  for (const voice of [1, 7]) {
    const n = note({ voice });
    assert.equal(n.fx.hpQ, -3.01);
    assert.equal(n.fx.hpStages, 4);
    assert.equal(n.fx.hp, 35);
    assert.ok(Math.abs(n.level - 0.8 * 4.4 * (voice === 1 ? 3.35 : 3.4)) < 1e-12, 'G-Funk keeps its calibrated SH-2 gain');
    assert.ok(Math.abs(n.len - sd * 1.3) < 1e-12);
    assert.ok(n.amp.at(0.1) < n.amp.at(0.015), 'the recorded bass decays during its body instead of holding full gain');
    assert.ok(n.amp.at(n.len + 0.15) < n.level * 0.01, 'release clears space before the next kick');
    assert.ok(n.amp.events.every(e => e.k !== 's' || e.v === 0), 'a stale playBuf hold cannot reopen the release');
    assert.equal(note({ voice, hold: true }).len, sd * 2, 'held and slide-connected steps keep their body');
    assert.equal(note({ voice, approach: true }).len, sd * 0.9, 'approach notes clear the downbeat');
  }
  const organ = note({ organ: true }), uk = note({ style: 'ukg', voice: 3 });
  assert.ok(Math.abs(organ.level - 0.8 * 4.4 * 1.27) < 1e-12, 'the organ ensemble keeps its calibrated bass gain');
  assert.equal(uk.level, 0.8 * 4.4, 'UKG recorded bass keeps its gain');
  assert.ok(organ.len < note().len && organ.fx.release < note().fx.release, 'the held organ ensemble leaves a shorter bass pocket');
  assert.equal(uk.len, sd * 2.2); assert.equal(uk.fx.release, 0.04);
  assert.equal(uk.fx.hp, undefined); assert.equal(uk.amp.at(0.1), uk.level, 'UKG keeps its existing recorded hold');
  for (const hpQ of [undefined, -3.01]) {
    const filters = [], engine = {
      ctx, gain: v => { const g = ctx.createGain(); g.gain.value = v; return g; },
      filter: (type, f, q) => { const n = Engine.prototype.filter.call({ ctx }, type, f, q); filters.push(n); return n; },
      startSource: (s, t, off) => s.start(t, off),
    };
    Engine.prototype.playBuf.call(engine, ctx.createBuffer(1, 48000, 48000), 0, 1, ctx.destination, 1, 0.2, { hp: 35, hpStages: 4, hpQ });
    assert.equal(filters.length, 4);
    assert.ok(filters.every(f => f.Q.value === (hpQ ?? 0.7)), 'each stage receives the selected Q without changing other recorded voices');
  }
  console.log('G-Funk SH-2 gain: both voices and organ ensemble retain calibrated levels; UKG unchanged');
  console.log('G-Funk SH-2: flat HP stages, decaying body, kick-clearing release, held/approach notes and unchanged UKG passed');
}
for (const style of ['gfunk', 'ukg', 'rock', undefined]) {
  const engine = { playbackStyle: style, recorded: (kind, fallback) => [kind, fallback], synthOrgan: () => 'synth' };
  assert.deepEqual(Engine.prototype.organ.call(engine), ['gfunk', 'ukg'].includes(style) ? ['org', 'synthOrgan'] : 'synth');
}
for (const style of ['gfunk', 'ukg', 'rock', undefined]) {
  for (const kind of ['org', 'str']) {
    let fx;
    const engine = {
      playbackStyle: style, state: {}, ch: { stab: { input: {}, band: {} } },
      rec: () => null,
      playBuf: (...args) => { fx = args.at(-1); },
    };
    Engine.prototype.recordedNote.call(engine, [[60, {}]], 0, 1, 60, 0.5, {}, 0, kind);
    assert.equal(fx.hp, kind === 'org' && style === 'gfunk' ? 110 : 0, 'only G-Funk recorded organ loses its kick-band lows');
    assert.equal(fx.hpQ, -3.01, 'organ low-cut is non-resonant');
  }
}
console.log('Recorded organ low-cut: 110 Hz non-resonant HPF isolated to G-Funk organ');
assert.ok(!liveSets({ ...ukg, params: { ...ukg.params, acid: { ...ukg.params.acid, voice: 1 } } }).includes('abass'), 'UK Garage keeps its synth BASS voice');
const other = { ...ukg, artist: { style: 'reggaeton' } };
assert.ok(!liveSets(other).includes('org') && !liveSets(other).includes('abass'), 'other styles keep the synth organ and Reese');
assert.deepEqual(BAND_LAYER.rock.chorus.parts, ['org']);
console.log('live kit samples + license manifest passed');
await import('./roots.mjs');
