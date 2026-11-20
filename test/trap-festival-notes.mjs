import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { activeBalance, bandEnergy, energyDB, filtered, measure } from '../scripts/trap-festival-notes.mjs';

const fs = 4096, n = 8192;
const tone = (hz, amp) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / fs));
const low = tone(64, .5), high = tone(512, .5), sum = Float32Array.from(low, (v, i) => v + high[i]);
const db = 10 * Math.log10(.5 ** 2 / 2);
assert.ok(Math.abs(bandEnergy([sum, sum], fs) - db) < .001, 'FFT integrates power, not mean power per bin');
assert.ok(Math.abs(energyDB([low, low]) - db) < .001, 'stereo averaging preserves mono power');
assert.ok(Math.abs(bandEnergy([sum.subarray(0, 7000)], fs) - db) < .03, 'Parseval normalization survives zero padding');
assert.ok(energyDB(filtered([high], fs)) < energyDB([high]) - 15, 'Butterworth filter rejects high harmonics');
assert.ok(Math.abs(activeBalance([low], [tone(64, .25)], fs).differenceDB - 6.0206) < .001);
const m = measure([sum, sum], -10, fs, -12);
assert.ok(Math.abs(m.raw.fftDBFS - db) < .001);
assert.equal(m.mixMatched.fftDBFS, m.raw.fftDBFS - 4);
assert.equal(m.fullSongMatched.fftDBFS, m.raw.fftDBFS - 2);
assert.ok(Math.abs(m.independentlyMatched.lufs + 14) < .001);
assert.equal(bandEnergy([new Float32Array(n)], fs), -Infinity);
assert.equal(measure([new Float32Array(n)], -Infinity, fs).independentlyMatched, null);
assert.deepEqual(activeBalance([new Float32Array(n)], [low], fs), { frames: 0, differenceDB: null });
assert.throws(() => bandEnergy([], fs), /nonempty/);
assert.throws(() => bandEnergy([low, new Float32Array(2)], fs), /equal-length/);
assert.throws(() => activeBalance([low], [new Float32Array(2)], fs), /aligned/);
for (const args of [[], ['render', '--out', 'unused', '--seed', 'bad']]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/trap-festival-notes.mjs', import.meta.url)), ...args], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage|integers/);
}
console.log('Trap festival notes metrics: FFT/filter/matching/active frames, silence and invalid inputs passed');
