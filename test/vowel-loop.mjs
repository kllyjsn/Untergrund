import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vowelSustain } from '../js/vowels.js';

const ctx = { createBuffer: (_, length, sampleRate) => {
  const data = new Float32Array(length);
  return { sampleRate, duration: length / sampleRate, getChannelData: () => data };
} };
for (const vowel of ['ahh', 'eh', 'ooh']) {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', `samples/live/vox_${vowel}_53.flac`, '-f', 'f32le', 'pipe:1']);
  const data = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  const buffer = { sampleRate: 44100, getChannelData: () => data };
  const loop = vowelSustain(buffer, ctx), y = loop.getChannelData(0), rows = [];
  assert.equal(vowelSustain(buffer, ctx), loop, 'processed sustains are cached');
  const at = (i) => { const p = ((i % y.length) + y.length) % y.length, j = Math.floor(p); return y[j] + (y[(j + 1) % y.length] - y[j]) * (p - j); };
  for (let midi = 48; midi <= 59; midi++) {
    const rate = 2 ** ((midi - 53) / 12), power = [0, 0], count = 1200;
    for (let i = 0; i < count; i++) {
      power[0] += at((i - count) * rate * 44100 / 48000) ** 2;
      power[1] += at(i * rate * 44100 / 48000) ** 2;
    }
    const step = 10 * Math.log10(power[1] / power[0]);
    assert(Math.abs(step) < 1, `${vowel}/${midi} wrap RMS step ${step.toFixed(3)} dB`);
    rows.push(+step.toFixed(3));
  }
  const repeated = new Float32Array(y.length * 10);
  for (let i = 0; i < 10; i++) repeated.set(y, i * y.length);
  if (process.argv[2]) writeFileSync(join(process.argv[2], `vowel-sustain-${vowel}.f32`), repeated);
  console.log(`${vowel} wrap RMS dB, MIDI 48–59: ${rows.join(', ')}`);
}
