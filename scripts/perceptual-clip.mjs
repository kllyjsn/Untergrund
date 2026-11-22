// Apply the benchmark's PCM proxies to a local listening excerpt. No audio leaves the machine.
import { execFileSync } from 'node:child_process';
import { analyzePerceptual } from '../js/perceptual-audio.js';

const [file, startArg, endArg, ...extra] = process.argv.slice(2);
const start = Number(startArg ?? 0), end = Number(endArg ?? Infinity), fs = 48000;
if (!file || !Number.isFinite(start) || start < 0 || (endArg != null && !Number.isFinite(end)) || !(end > start) || extra.length) {
  console.error('Usage: node scripts/perceptual-clip.mjs FILE [START_SECONDS [END_SECONDS]]');
  process.exit(1);
}
const trim = ['-ss', String(start), ...(Number.isFinite(end) ? ['-t', String(end - start)] : [])];
const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, ...trim, '-f', 'f32le', '-ac', '2', '-ar', String(fs), 'pipe:1'], { maxBuffer: 256 * 1024 * 1024 });
if (!raw.length) throw new Error('No audio in the requested range.');
const L = new Float32Array(raw.length / 8), R = new Float32Array(L.length);
for (let i = 0; i < L.length; i++) { L[i] = raw.readFloatLE(8 * i); R[i] = raw.readFloatLE(8 * i + 4); }
console.log(JSON.stringify(analyzePerceptual(L, R, fs), null, 2));
