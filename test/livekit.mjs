import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { LIVE_FILES } from '../js/livekit.js';

const dir = new URL('../samples/live/', import.meta.url);
const license = readFileSync(new URL('LICENSE.md', dir), 'utf8');
for (const f of LIVE_FILES) assert.ok(existsSync(new URL(`${f}.wav`, dir)), `missing ${f}.wav`);
const wavs = readdirSync(dir).filter((f) => f.endsWith('.wav'));
assert.deepEqual(wavs.sort(), LIVE_FILES.map((f) => `${f}.wav`).sort(), 'every bundled wav is used and listed');
const prefixes = new Set(wavs.map((f) => f.split('_')[0]));
for (const p of prefixes) assert.ok(license.includes(`\`${p}_`), `${p}_* files have a license entry`);
assert.ok(license.includes('CC0 1.0 Universal'));
console.log('live kit samples + license manifest passed');
