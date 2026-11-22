import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VOWEL_BAND, VOWEL_TUNE } from '../js/vowels.js';
import { LIVE_FILES, BAND_FILES, KIT_EXTRA, HAND_FILES, BAND, TAKES, MUTE_LAYER, SOFT_LAYER, withTakes, liveSets, BAND_LAYER } from '../js/livekit.js';
import { generate } from '../js/state.js';

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
const other = { ...ukg, artist: { style: 'reggaeton' } };
assert.ok(!liveSets(other).includes('org') && !liveSets(other).includes('abass'), 'other styles keep the synth organ and Reese');
assert.deepEqual(BAND_LAYER.rock.chorus.parts, ['org']);
console.log('live kit samples + license manifest passed');
await import('./roots.mjs');
