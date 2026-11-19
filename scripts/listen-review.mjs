import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeMix, targetBalance } from '../js/audio-quality.js';
import { analyzePcm } from '../js/lab-metrics.js';
import { targetFor } from '../js/loudness.js';
import { REVIEW_IDS, DIMENSIONS, reviewTrack, verdict, validateJudgment, orderAgreement, markdownReview } from '../js/listen-review.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--judge') options.judge = true;
  else if (['--base', '--only', '--out', '--pages', '--comment'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key.slice(2)] = args[++i];
  else throw new Error(`Unknown option or missing value: ${key}`);
}
const run = (bin, argv, cwd = root, extra = {}) => execFileSync(bin, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 128 * 1024 * 1024, ...extra });
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
  const model = process.env.LISTEN_JUDGE_MODEL || 'google/gemini-2.5-flash';
  if (!options.judge) return { id: track.id, note: 'Skipped (use --judge).' };
  if (!process.env.OPENROUTER_API_KEY) return { id: track.id, note: 'Skipped: OPENROUTER_API_KEY missing.' };
  try {
    const catalog = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(30000) }).then((r) => r.json());
    if (!catalog.data?.find((m) => m.id === model)?.architecture?.input_modalities?.includes('audio')) throw new Error(`Model ${model} does not advertise audio input`);
    const audio = [track.base, track.head].map((side, i) => {
      const file = join(out, `${track.id}-${i}-judge.mp3`);
      run('ffmpeg', ['-v', 'error', '-y', '-i', side.wav, '-ss', '30', '-t', '24', '-af', 'loudnorm=I=-18:TP=-2:LRA=11', '-ar', '24000', '-ac', '1', '-b:a', '64k', file]);
      return readFileSync(file).toString('base64');
    });
    const orders = [];
    for (const order of [[0, 1], [1, 0]]) {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 2200, response_format: { type: 'json_object' }, messages: [
          { role: 'system', content: `You are a seasoned producer and mix engineer reviewing two blind, loudness-matched generated music excerpts. Judge groove, musical intent, arrangement, harmony, tonal masking, punch, headroom and mono-compatible imaging. Do not favor louder or brighter. Do not invent numeric measurements. Genre: ${track.head.style}. Only return strict JSON: {"preference":"A"|"B"|"same","dimensions":[{"dimension":name,"preference":"A"|"B"|"same","note":"specific audible evidence or uncertainty"}]}. Include these dimensions exactly in order: ${DIMENSIONS.join('; ')}. These are short mono excerpts: explicitly acknowledge inability to judge stereo and full-song form.` },
          { role: 'user', content: order.flatMap((index, i) => [{ type: 'text', text: `Candidate ${i === 0 ? 'A' : 'B'}` }, { type: 'input_audio', input_audio: { data: audio[index], format: 'mp3' } }]) },
        ] }),
      });
      if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
      const data = await response.json();
      orders.push(validateJudgment(JSON.parse(data.choices?.[0]?.message?.content)));
    }
    return { id: track.id, model, preference: orderAgreement(...orders), orders };
  } catch (error) { return { id: track.id, model, note: `Judge unavailable: ${error.message}` }; }
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
