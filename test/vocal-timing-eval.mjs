// Offline checks for the real-stem vocal timing eval: no audio or browser needed (docs/vocal-timing-eval.md).
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SR, compare, cuts, lockStats, readWav, scoreRun, sourceState, yinAt, yinCentred } from './vocal-timing-metrics.mjs';
import { MANIFEST, loadStems } from '../scripts/vocal-timing-eval.mjs';

const sine = (hz, s, amp = 0.3) => Float32Array.from({ length: Math.round(s * SR) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / SR));
function wav(samples, float) {
  const width = float ? 4 : 2, b = Buffer.alloc(44 + samples.length * width);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * width, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(float ? 3 : 1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * width, 28);
  b.writeUInt16LE(width, 32); b.writeUInt16LE(width * 8, 34); b.write('data', 36); b.writeUInt32LE(samples.length * width, 40);
  samples.forEach((x, i) => float ? b.writeFloatLE(x, 44 + 4 * i) : b.writeInt16LE(Math.round(x * 32767), 44 + 2 * i));
  return b;
}

// WAV decoding: PCM16 and float32, the two formats Music's stems use.
const tone = sine(220, 0.1);
assert.ok(Math.abs(readWav(wav(tone, true)).samples[100] - tone[100]) < 1e-7);
assert.ok(Math.abs(readWav(wav(tone, false)).samples[100] - tone[100]) < 1e-4);

// Both YIN conventions find a sung pitch within a cent and reject silence.
const a = sine(261.63, 1);
assert.ok(Math.abs(1200 * Math.log2(yinAt(a, 0.5, 1024) / 261.63)) < 1);
assert.ok(Math.abs(1200 * Math.log2(yinCentred(a, 0.5, 4096) / 261.63)) < 1);
assert.ok(Number.isNaN(yinAt(new Float32Array(SR), 0.5)) && Number.isNaN(yinCentred(new Float32Array(SR), 0.5)));

// Source playhead integrates playbackRate ramps and cancels; before start it extrapolates at rate 1.
const src = { at: 1, offset: 2, events: [[1, 1, 's'], [2, 2, 'l'], [1, 3, 'l'], [null, 2.5, 'c']] };
assert.deepEqual(sourceState(src, 0.5), [1.5, 1]);
const [phase, rate] = sourceState(src, 1.5);
assert.ok(Math.abs(phase - 2.625) < 1e-9 && Math.abs(rate - 1.5) < 1e-9);

// A one-source run that starts 60 ms late: lock is +60 ms throughout, with no cuts.
const sd = 60 / 123 / 4, steps = Array.from({ length: 200 }, (_, i) => ({ at: 1 + i * sd }));
const late = { sd, steps, sources: [{ at: 1.06, offset: 0, events: [] }], splices: [] };
const lock = lockStats(late, { to: 10 });
assert.ok(Math.abs(lock.peakMs - 60) < 1e-6 && lock.overS > 8.9 && lock.longestOverS === lock.overS);

// A forced fade from a C4 note into a D4 note mid-phrase is a voiced cut with a ~200 c midpoint separation;
// the same fade into silence is not voiced.
const dry = new Float32Array(22 * SR);
dry.set(sine(261.63, 6), 0); dry.set(sine(293.66, 6), 8 * SR);
const render = (incoming) => {
  const pcm = new Float32Array(0.2 * SR), from = 4.9;
  pcm.set(sine(261.63, 0.1), 0); if (incoming) pcm.set(sine(293.66, 0.1), 0.1 * SR);
  return { sd, steps, sources: [{ at: 1, offset: 0, events: [] }, { at: 5, offset: 9, events: [] }], splices: [null, { from, pcm }] };
};
const [cut] = cuts(render(true), dry);
assert.ok(cut.voiced && Math.abs(cut.sep2048 - 200) < 2 && Math.abs(cut.sep4096 - 200) < 2, JSON.stringify(cut));
assert.equal(cuts(render(false), dry)[0].voiced, false);
const scored = scoreRun(render(true), dry);
assert.equal(scored.voicedCuts, 1); assert.ok(scored.maxSepCents > 190);

// Gate: a semitone clash or worse lock holds; a new soft voiced cut ships with notes; no change passes.
const row = (o = {}) => ({ voicedCuts: 0, maxSepCents: 0, overS: 5, peakMs: 80, ...o });
assert.equal(compare({ x: row() }, { x: row() }).verdict, 'pass');
assert.equal(compare({ x: row() }, { x: row({ voicedCuts: 1, maxSepCents: 60 }) }).verdict, 'notes');
assert.equal(compare({ x: row({ voicedCuts: 1, maxSepCents: 68 }) }, { x: row({ voicedCuts: 1, maxSepCents: 98 }) }).verdict, 'hold');
assert.equal(compare({ x: row() }, { x: row({ overS: 6 }) }).verdict, 'hold');

// Stems stay private: none configured is unmeasured, and a file that is not Music's reviewed stem is refused.
assert.equal(await loadStems({ dir: undefined, url: undefined }), null);
const dir = mkdtempSync(join(tmpdir(), 'vocal-stems-'));
for (const meta of Object.values(MANIFEST.stems)) writeFileSync(join(dir, meta.file), wav(tone, true));
await assert.rejects(loadStems({ dir }), /sha256 mismatch/);
for (const meta of Object.values(MANIFEST.stems)) assert.match(meta.sha256, /^[0-9a-f]{64}$/);

console.log('vocal-timing-eval: ok');
