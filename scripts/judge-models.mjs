import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeAudio, checkModel } from './judge-audio.mjs';
import { canResumeModel, checkpointFingerprint, assertCheckpointInputs } from './judge-checkpoint.mjs';
import { REVIEW_IDS, flipRate, controlScores, calibrationGate, humanAgreement } from '../js/listen-review.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (!['--private-manifest', '--private-audio-root', '--private-out', '--budget'].includes(args[i]) || !args[i + 1]) throw new Error('Expected private manifest, audio root, output directory and optional budget');
  options[args[i].slice(2)] = args[++i];
}
if (!options['private-manifest'] || !options['private-audio-root'] || !options['private-out']) throw new Error('Private paths are required');
const privateOut = resolve(options['private-out']);
const outside = relative(root, realpathSync(existsSync(privateOut) ? privateOut : dirname(privateOut)));
if (outside !== '..' && !outside.startsWith('../') && !isAbsolute(outside)) throw new Error('Private output must be outside repository');
mkdirSync(privateOut, { recursive: true });
const budget = Number(options.budget || 18);
if (!Number.isFinite(budget) || budget <= 0 || budget > 19) throw new Error('Budget must be >0 and <=19 USD');
const stateFile = join(privateOut, 'sweep.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile)) : { requests: 0, charged: 0, reportedCost: 0, models: [] };
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
const models = ['google/gemini-2.5-pro', 'google/gemini-3.1-pro-preview', 'google/gemini-3.8-flash', 'google/gemini-4-hydrogen', 'openai/gpt-audio-mini', 'qwen/qwen3.8-omni-flash'];
const fixtureDir = join(root, 'test/out/judge-stability');
const screening = ['trap', 'minimal', 'uk-drill', 'hard-techno'];
const fullIds = [...REVIEW_IDS, 'minimal', 'uk-drill', 'hard-techno', 'trap'];
const run = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
const manifestBytes = readFileSync(resolve(options['private-manifest']));
const manifest = JSON.parse(manifestBytes);
const audioEntries = readdirSync(resolve(options['private-audio-root']), { recursive: true, withFileTypes: true });
const sources = manifest.pairs.map((p) => {
  const entry = audioEntries.find((e) => e.isFile() && e.name === `Pair-${p.pair}.mp3`);
  if (!entry) throw new Error('Private audio file missing');
  return join(entry.parentPath, entry.name);
});
const inputFingerprint = checkpointFingerprint([manifestBytes, ...sources.map((source) => readFileSync(source))]);
assertCheckpointInputs(existsSync(stateFile) ? state : undefined, inputFingerprint);
state.inputFingerprint = inputFingerprint;
save();
const catalogResponse = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(30000) });
if (!catalogResponse.ok) throw new Error('Cannot load model pricing');
const catalog = (await catalogResponse.json()).data;
const pack = [];
for (const [index, p] of manifest.pairs.entries()) {
  const source = sources[index];
  const id = ({ drill: 'uk-drill', hardtechno: 'hard-techno' })[p.style] || p.style;
  const first = join(privateOut, `${id}-first.wav`), second = join(privateOut, `${id}-second.wav`);
  run(['-i', source, '-t', String(p.silence.startSeconds), first]);
  run(['-ss', String(p.silence.endSeconds), '-i', source, second]);
  pack.push({ id, style: p.style, files: p.first === 'original' ? [first, second] : [second, first] });
}
const fixtures = (id, type) => {
  const clean = join(fixtureDir, 'head/untergrund', `${id}-untergrund.wav`);
  return type === 'same' ? [clean, clean] : type === 'seed' ? [clean, join(fixtureDir, 'variant/untergrund', `${id}-untergrund.wav`)] : [clean, join(fixtureDir, `${id}-${type}.wav`)];
};
function summarize(trials) {
  const controls = controlScores(trials.filter((t) => t.type === 'same'), trials.filter((t) => ['mild', 'severe'].includes(t.type)));
  const flips = flipRate(trials);
  return { flips, controls, mild: controlScores([], trials.filter((t) => t.type === 'mild')).accuracy, severe: controlScores([], trials.filter((t) => t.type === 'severe')).accuracy, calibration: calibrationGate(controls, flips) };
}
async function batches(jobs, fn) {
  for (let at = 0; at < jobs.length; at += 3) {
    const results = await Promise.allSettled(jobs.slice(at, at + 3).map(fn));
    const failure = results.find((r) => r.status === 'rejected');
    if (failure) throw failure.reason;
  }
}
async function evaluate(m, files, style, prefix) {
  let error;
  for (let attempt = 0; attempt < 2; attempt++) {
    let reservation = 0;
    try {
      return await judgeAudio({ files, style, model: m.model, out: privateOut, prefix, protocol: 'stable',
        onCall: () => {
          reservation = m.requestBound;
          if (state.charged + reservation > budget) throw new Error('Budget exhausted');
          state.charged += reservation; state.requests++; m.requests++;
          save();
        },
        onUsage: (usage) => {
          const cost = Number.isFinite(usage.cost) ? usage.cost : Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens) ? usage.prompt_tokens * m.promptRate + usage.completion_tokens * m.completionRate : reservation;
          state.charged += Math.max(0, cost) - reservation; state.reportedCost += Math.max(0, cost);
          m.cost += Math.max(0, cost); reservation = 0;
          save();
        },
      });
    } catch (e) {
      error = e;
      if (e.message === 'Budget exhausted') throw e;
    }
  }
  throw error;
}
await Promise.all(models.map(async (model) => {
  const previous = state.models.find((m) => m.model === model);
  if (!canResumeModel(previous)) return;
  const pricing = catalog.find((m) => m.id === model)?.pricing;
  const promptRate = Math.max(Number(pricing?.prompt), Number(pricing?.audio || 0)), completionRate = Number(pricing?.completion);
  const m = previous || { model, promptRate, completionRate, requestBound: promptRate * 10000 + completionRate * 2200, requests: 0, cost: 0, trials: [], pack: [], full: [], finished: false };
  m.finished = false;
  for (const key of ['error', 'privateError', 'fullSkipped', 'screen', 'passes']) delete m[key];
  if (![promptRate, completionRate, m.requestBound].every(Number.isFinite)) throw new Error('Missing pricing; refusing unbudgeted model');
  if (!previous) state.models.push(m);
  save();
  console.log(`Screening ${model}`);
  try {
    await checkModel(model);
    await batches(screening.flatMap((id) => ['same', 'mild', 'severe'].map((type) => ({ id, type }))).filter(({ id, type }) => !m.trials.some((t) => t.id === id && t.type === type)), async ({ id, type }) => {
      const value = await evaluate(m, fixtures(id, type), id, `${model.replaceAll('/', '-')}-${id}-${type}`);
      m.trials.push({ id, type, ...value }); save();
    });
    await batches(pack.filter((p) => !m.pack.some((t) => t.id === p.id)), async (p) => {
      const value = await evaluate(m, p.files, p.style, `${model.replaceAll('/', '-')}-private-${p.id}`);
      m.pack.push({ id: p.id, ...value, human: humanAgreement(value.windows, p.id === 'trap') }); save();
    });
    m.screen = summarize(m.trials);
    const trap = m.pack.find((p) => p.id === 'trap'), bad = m.pack.filter((p) => p.id !== 'trap');
    const mean = (p) => p.human.scores.reduce((a, b) => a + b, 0) / 2;
    m.human = {
      trapAbove: Object.fromEntries(bad.map((p) => [p.id, mean(trap) > mean(p)])),
      badAcceptable: Object.fromEntries(bad.map((p) => [p.id, p.human.eitherAcceptable])),
      badFalsePreference: Object.fromEntries(bad.map((p) => [p.id, ['base', 'head'].includes(p.preference)])),
    };
    m.passes = m.screen.calibration === 'calibrated' && Object.values(m.human.trapAbove).every(Boolean) && !Object.values(m.human.badAcceptable).some(Boolean) && !Object.values(m.human.badFalsePreference).some(Boolean);
    if (m.screen.calibration === 'calibrated') {
      const fullBound = (80 - m.full.length) * 6 * Math.max(m.cost / m.requests * 1.5, 0.002);
      if (state.charged + fullBound > budget) m.fullSkipped = 'Conservative full-run reservation exceeds remaining budget';
      else {
        console.log(`Full benchmark ${model}`);
        await batches(fullIds.flatMap((id) => ['same', 'mild', 'severe', 'seed'].flatMap((type) => [0, 1].map((rep) => ({ id, type, rep })))).filter(({ id, type, rep }) => !m.full.some((t) => t.id === id && t.type === type && t.rep === rep)), async ({ id, type, rep }) => {
          m.full.push({ id, type, rep, ...await evaluate(m, fixtures(id, type), id, `${model.replaceAll('/', '-')}-full-${id}-${type}-${rep}`) }); save();
        });
        m.fullSummary = summarize(m.full);
      }
    }
  } catch (error) {
    m.privateError = error.message;
    m.error = /^OpenRouter HTTP \d+$/.test(error.message) || error.message === 'Budget exhausted' ? error.message : 'Audio response unavailable or invalid after one retry';
  }
  if (!m.screen && m.trials.length) m.screen = summarize(m.trials);
  m.finished = m.error !== 'Budget exhausted' && !m.fullSkipped; save();
  console.log(`Finished ${model}: ${m.error || m.screen?.calibration}, requests ${m.requests}`);
}));
const aggregate = { generated: new Date().toISOString(), requests: state.requests, reportedCost: state.reportedCost, conservativeCharge: state.charged, budget, models: state.models.map((m) => ({
  model: m.model, requests: m.requests, cost: m.cost, error: m.error, completedControls: m.trials.length, completedPackGenres: m.pack.length, screen: m.screen, human: m.human, passes: m.passes === true && m.fullSummary?.calibration === 'calibrated',
  genres: Object.fromEntries(screening.map((id) => [id, summarize(m.trials.filter((t) => t.id === id))])),
  fullSummary: m.fullSummary, fullSkipped: m.fullSkipped,
  fullGenres: m.full.length ? Object.fromEntries(fullIds.map((id) => [id, summarize(m.full.filter((t) => t.id === id))])) : undefined,
})) };
writeFileSync(join(root, 'docs/judge-model-comparison.json'), JSON.stringify(aggregate, null, 2) + '\n');
const pct = (n) => n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`;
const rows = ['## Model screening comparison', '', 'Stable scoring only; one repetition, both orders across three windows, four genres, same/mild/severe controls plus the actual private human-rated pack. Private per-half scores and identifiers are stored outside this repository. The pack labels are not disclosed in the scoring prompt. Degraded accuracy requires the clean candidate in both orders. A pass requires control calibration, Trap strictly above each bad genre, no bad genre acceptable, no false preference on its human-rated halves, and a calibrated full benchmark. Error rows contain partial controls only; missing tests are not passes.', '', '| Model | Controls /12; pack genres /4 | Requests | Null false preference | Mild accuracy | Severe accuracy | Flips | Trap above all three | Any bad genre acceptable | Passes everything | Error / full run |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
for (const m of aggregate.models) rows.push(`| ${m.model} | ${m.completedControls}; ${m.completedPackGenres} | ${m.requests} | ${pct(m.screen?.controls.falsePreferenceRate)} | ${pct(m.screen?.mild)} | ${pct(m.screen?.severe)} | ${pct(m.screen?.flips.rate)} | ${m.human ? Object.values(m.human.trapAbove).every(Boolean) : 'n/a'} | ${m.human ? Object.values(m.human.badAcceptable).some(Boolean) : 'n/a'} | ${m.passes} | ${m.error || m.fullSkipped || (m.fullSummary ? m.fullSummary.calibration : 'not eligible')} |`);
rows.push('', `Requests: ${aggregate.requests}; reported/estimated API cost: $${aggregate.reportedCost.toFixed(4)}; conservative charge including failed/missing-usage requests: $${aggregate.conservativeCharge.toFixed(4)} (budget $${budget}). No private half-level scores or pair identifiers are published. Per-genre aggregates: [judge-model-comparison.json](judge-model-comparison.json).`, '');
rows.push(`Models eligible for the full ten-genre, two-repetition benchmark: ${aggregate.models.filter((m) => !m.error && m.screen?.calibration === 'calibrated').length}. Models completing it: ${aggregate.models.filter((m) => m.fullSummary).length}.`, '', 'To repeat, first create the ignored audio fixtures with the stability benchmark, then run `node scripts/judge-models.mjs --private-manifest /private/manifest.json --private-audio-root /private/audio --private-out /private/judge-models --budget 18`. The private output directory must exist outside this repository; its checkpoint resumes completed trials without rescoring them. Model selection in the ordinary stability benchmark also honors `LISTEN_JUDGE_MODEL`.', '');
const report = join(root, 'docs/judge-stability.md'), previous = readFileSync(report, 'utf8').split('## Model screening comparison')[0].trimEnd();
writeFileSync(report, previous + '\n\n' + rows.join('\n'));
console.log(rows.join('\n'));
