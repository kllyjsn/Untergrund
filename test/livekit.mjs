import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { LIVE_FILES, BAND_FILES, KIT_EXTRA, HAND_FILES, BAND, TAKES, MUTE_LAYER, SOFT_LAYER, withTakes, liveSets, BAND_LAYER, playsAnalogBass } from '../js/livekit.js';
import { generate } from '../js/state.js';
import { Engine } from '../js/engine.js';

const dir = new URL('../samples/live/', import.meta.url);
const license = readFileSync(new URL('LICENSE.md', dir), 'utf8');
const ALL = [...LIVE_FILES, ...BAND_FILES, ...KIT_EXTRA, ...HAND_FILES];
for (const f of ALL) assert.ok(existsSync(new URL(`${f}.flac`, dir)), `missing ${f}.flac`);
const files = readdirSync(dir).filter((f) => f !== 'LICENSE.md');
assert.deepEqual(files.sort(), ALL.map((f) => `${f}.flac`).sort(), 'every bundled sample is a used, listed .flac');
const prefixes = new Set(files.map((f) => f.split('_')[0]));
for (const p of prefixes) assert.ok(license.includes(`\`${p}_`), `${p}_* files have a license entry`);
assert.ok(license.includes('CC0 1.0 Universal'));
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
    acidNodes: { vca: { gain: { setTargetAtTime() {} } } }, gatedBasses: new Map(),
    rec: () => true, analogBass: () => 'recorded', bass: () => 'synth',
  };
  assert.equal(Engine.prototype.acidVoice.call(engine, 0, {}, false, false, 0.1), expected, `${style} voice ${voice} dispatch`);
}
for (const style of ['gfunk', 'ukg', 'rock', undefined]) {
  const engine = { playbackStyle: style, recorded: (kind, fallback) => [kind, fallback], synthOrgan: () => 'synth' };
  assert.deepEqual(Engine.prototype.organ.call(engine), ['gfunk', 'ukg'].includes(style) ? ['org', 'synthOrgan'] : 'synth');
}
assert.ok(!liveSets({ ...ukg, params: { ...ukg.params, acid: { ...ukg.params.acid, voice: 1 } } }).includes('abass'), 'UK Garage keeps its synth BASS voice');
const other = { ...ukg, artist: { style: 'reggaeton' } };
assert.ok(!liveSets(other).includes('org') && !liveSets(other).includes('abass'), 'other styles keep the synth organ and Reese');
assert.deepEqual(BAND_LAYER.rock.chorus.parts, ['org']);
console.log('live kit samples + license manifest passed');
