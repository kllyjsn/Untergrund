import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { LIVE_FILES, BAND_FILES, KIT_EXTRA } from '../js/livekit.js';

const dir = new URL('../samples/live/', import.meta.url);
const license = readFileSync(new URL('LICENSE.md', dir), 'utf8');
const ALL = [...LIVE_FILES, ...BAND_FILES, ...KIT_EXTRA];
for (const f of ALL) assert.ok(existsSync(new URL(`${f}.flac`, dir)), `missing ${f}.flac`);
const files = readdirSync(dir).filter((f) => f !== 'LICENSE.md');
assert.deepEqual(files.sort(), ALL.map((f) => `${f}.flac`).sort(), 'every bundled sample is a used, listed .flac');
const prefixes = new Set(files.map((f) => f.split('_')[0]));
for (const p of prefixes) assert.ok(license.includes(`\`${p}_`), `${p}_* files have a license entry`);
assert.ok(license.includes('CC0 1.0 Universal'));
assert.ok(!/^\| `[^|]*\.wav`/m.test(license), 'license manifest lists the bundled .flac names');
console.log('live kit samples + license manifest passed');
