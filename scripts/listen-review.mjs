import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkModel, judgeAudio, MODEL } from './judge-audio.mjs';
import { analyzeMix, targetBalance } from '../js/audio-quality.js';
import { analyzePcm } from '../js/lab-metrics.js';
import { targetFor } from '../js/loudness.js';
import { REVIEW_IDS, reviewTrack, verdict, markdownReview } from '../js/listen-review.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--judge') options.judge = true;
  else if (['--base', '--only', '--out', '--pages', '--comment', '--judge-protocol'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key.slice(2)] = args[++i];
  else throw new Error(`Unknown option or missing value: ${key}`);
}
const run = (bin, argv, cwd = root, extra = {}) => execFileSync(bin, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 128 * 1024 * 1024, ...extra });
if (options['judge-protocol'] && !['legacy', 'stable'].includes(options['judge-protocol'])) throw new Error('--judge-protocol must be stable or legacy');
const git = (...argv) => run('git', argv).trim();
const ids = options.only ? options.only.split(',') : REVIEW_IDS;
const prompts = JSON.parse(readFileSync(join(root, 'research/suno/prompts.json')));
if (!ids.length || new Set(ids).size !== ids.length || ids.some((id) => !prompts.prompts.some((p) => p.id === id))) throw new Error('Choose unique prompt ids from research/suno/prompts.json');
const pages = Number(options.pages || 3);
if (!Number.isInteger(pages) || pages < 1) throw new Error('--pages must be a positive integer');
if (options.comment && !/^\d+$/.test(options.comment)) throw new Error('--comment must be a PR number');
const out = resolve(root, options.out || 'test/out/listen-review');
const baseRef = options.base || 'origin/main', baseCommit = git('rev-parse', '--verify', `${baseRef}^{commit}`), headCommit = git('rev-parse', 'HEAD');
mkdirSync(out, { recursive: true });

function render(cwd, dir) {
  if (!existsSync(join(cwd, 'scripts/suno-benchmark.mjs'))) throw new Error(`Base ${baseRef} lacks scripts/suno-benchmark.mjs; choose a newer base with the render kit.`);
  run(process.execPath, ['scripts/suno-benchmark.mjs', '--only', ids.join(','), '--dir', dir, '--wav', '--pages', String(pages)], cwd, { stdio: 'inherit' });
}

function analyze(dir, id) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'))), pair = manifest.pairs.find((p) => p.id === id);
  if (!pair) throw new Error(`Missing rendered prompt ${id} in ${dir}`);
  const wav = join(dir, pair.a.file.replace(/\.mp3$/, '.wav'));
  const raw = run('ffmpeg', ['-v', 'error', '-i', wav, '-f', 'f32le', '-ac', '2', '-ar', '44100', '-'], root, { encoding: 'buffer' });
  const n = raw.length / 8, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = raw.readFloatLE(i * 8); R[i] = raw.readFloatLE(i * 8 + 4); }
  const mix = analyzeMix(L, R, 44100, { target: targetFor(pair.style) });
  return { style: pair.style, seed: pair.seed, mp3: join(dir, pair.a.file), wav, songwriting: pair.songwriting, pcm: analyzePcm([L, R], 44100, { bpm: pair.songwriting.bpm }), mix, balance: targetBalance(mix.spectrum.octaves, pair.style) };
}

async function judge(track) {
  if (!options.judge) return { id: track.id, note: 'Skipped (use --judge).' };
  try {
    await checkModel();
    const protocol = options['judge-protocol'] || 'stable';
    const result = await judgeAudio({ files: [track.base.wav, track.head.wav], style: track.head.style, protocol, out, prefix: track.id });
    const calibrationFile = join(root, 'docs/judge-stability-results.json');
    const calibration = existsSync(calibrationFile) ? JSON.parse(readFileSync(calibrationFile)) : { genres: [] };
    const genre = calibration.genres.find((g) => g.id === track.id);
    const calibrated = calibration.model === MODEL && genre?.summary?.[protocol]?.calibration === 'calibrated';
    return { id: track.id, model: MODEL, protocol, ...result, preference: calibrated ? result.preference : undefined, note: calibrated ? undefined : 'uncalibrated (advisory, not counted)', calibration: calibrated ? 'calibrated' : 'uncalibrated' };
  } catch (error) { return { id: track.id, model: MODEL, note: `Judge unavailable: ${error.message}` }; }
}
try {
  const baseDir = join(out, 'base'), headDir = join(out, 'head');
  const worktree = join(mkdtempSync(join(out, 'base-worktree-')), 'checkout');
  let added = false;
  try {
    git('worktree', 'add', '--detach', worktree, baseCommit); added = true;
    if (!existsSync(join(worktree, 'scripts/suno-benchmark.mjs'))) throw new Error(`Base ${baseRef} lacks scripts/suno-benchmark.mjs; choose a newer base with the render kit.`);
    if (existsSync(join(root, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(worktree, 'node_modules'), 'dir');
    else run('npm', ['ci'], worktree, { stdio: 'inherit' });
    render(worktree, baseDir);
  } finally { if (added) git('worktree', 'remove', '--force', worktree); }
  render(root, headDir);
  const tracks = ids.map((id) => reviewTrack(id, analyze(baseDir, id), analyze(headDir, id)));
  const review = { schema: 'untergrund.listen-review/1', baseRef, baseCommit, headCommit, dirty: Boolean(git('status', '--porcelain')), verdict: verdict(tracks.flatMap((t) => t.findings)), tracks, judge: [] };
  for (const track of tracks) review.judge.push(await judge(track));
  writeFileSync(join(out, 'review.json'), JSON.stringify(review, null, 2) + '\n');
  writeFileSync(join(out, 'REVIEW.md'), markdownReview(review));
  console.log(`Listening review: ${review.verdict}; ${join(out, 'REVIEW.md')}`);
  if (options.comment) run('gh', ['pr', 'comment', options.comment, '--body-file', join(out, 'REVIEW.md')], root, { stdio: 'inherit' });
} catch (error) { console.error(error.message); process.exitCode = 1; }
