import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIEW_IDS, flipRate, controlScores, calibrationGate, humanAgreement, trapOrdering, aggregateScores } from '../js/listen-review.js';
import { checkModel, judgeAudio, MODEL } from './judge-audio.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opts = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--summarize') { opts.summarize = true; continue; }
  if (!['--reps', '--out', '--pages'].includes(args[i]) || !args[i + 1]) throw new Error('Expected --reps N, --out DIR or --pages N');
  opts[args[i].slice(2)] = args[++i];
}
const reps = Number(opts.reps || 2), pages = Number(opts.pages || 3);
if (![reps, pages].every((v) => Number.isInteger(v) && v > 0)) throw new Error('reps/pages must be positive integers');
const out = resolve(root, opts.out || 'test/out/judge-stability');
mkdirSync(out, { recursive: true });
const ids = [...REVIEW_IDS, 'minimal', 'uk-drill', 'hard-techno', 'trap'];
const humanExpectations = { minimal: false, 'uk-drill': false, 'hard-techno': false, trap: true };
const run = (bin, argv) => execFileSync(bin, argv, { cwd: root, stdio: 'inherit' });
if (!opts.summarize) await checkModel();
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const humanAnchor = { source: 'Jason (corrected key): Trap pair halfway decent (soft anchor); Minimal, Drill and Hard Techno pairs terrible, not smooth, jarring, toy-like. Pair-level labels.', provenance: 'Initial pack recipe not found in repository/history search. The 2026-11-19 metadata was later supplied (base b712b9c, head 5d64e97): Trap most put together; other three bad in both halves, no preference. Exact audio GET returned HTTP 401 and head commit was unavailable locally; optional reproduction skipped. These current seed-42/43 renders remain proxies, not the human-rated recordings.', threshold: 6 };
const results = opts.summarize ? JSON.parse(readFileSync(join(root, 'docs/judge-stability-results.json'))) : { schema: 'untergrund.judge-stability/1', model: MODEL, commit, dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()), generated: new Date().toISOString(), reps, margin: 0.75, apiCalls: 0, genres: [] };
results.humanAnchor = humanAnchor;
const renderDirs = [join(out, 'head'), join(out, 'variant')];
for (const [i, dir] of (opts.summarize ? [] : renderDirs.entries())) {
  const manifest = existsSync(join(dir, 'manifest.json')) ? JSON.parse(readFileSync(join(dir, 'manifest.json'))) : { pairs: [] };
  const missing = ids.filter((id) => !manifest.pairs.some((p) => p.id === id));
  if (missing.length) run(process.execPath, ['scripts/suno-benchmark.mjs', '--only', missing.join(','), '--dir', dir, '--pages', String(pages), '--wav', '--seed', String(42 + i)]);
}
const manifests = opts.summarize ? [] : renderDirs.map((d) => JSON.parse(readFileSync(join(d, 'manifest.json'))));
const pct = (n) => n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`;
function save() {
  writeFileSync(join(root, 'docs/judge-stability-results.json'), JSON.stringify(results, (key, value) => key === 'unblinded' ? undefined : value, 2) + '\n');
  const lines = ['# Judge order stability', '', `Model: \`${results.model}\`. Repetitions: ${results.reps}. Requests attempted: ${results.apiCalls}. Fixed seeds 42/43. Audio is generated locally, not committed.`, '',
    'Stable: three 20-second mono loudness-matched windows centered at 20/50/80%, absolute anchored scores, margin 0.75, both orders. Legacy: exact PR #182 prompt and 30–54s window. Flip means unblinded order decisions differ (including same vs preference); controls require success in both orders. Errors excluded from rates, but force uncalibrated. These small samples are diagnostics, not proof of generalization. Calibration is specific to this model/protocol and genre.', '',
    'Human anchor (corrected key, pair-level ratings): Trap halfway decent; Minimal, Drill and Hard Techno terrible (not smooth, jarring sounds, toy-like instruments). These seed-42/43 renders are proxies, not independently human-rated recordings. The supplied metadata (2026-11-19, b712b9c vs 5d64e97) again ranks Trap first; the other three remain bad in both halves with no preference. Exact pack audio returned HTTP 401 and its head revision was unavailable locally, so the optional exact-pack reproduction was skipped; no claims about its base/head decision are made. Acceptable means mean absolute overall score ≥6/10 for either version across windows, orders and repetitions. Either version acceptable in a terrible genre fails calibration. Trap is a soft anchor; report ordering against each terrible genre, failing only if below all three. Legacy has no absolute score and cannot detect this failure. Human expectations are never revealed in the scoring prompt.', '',
    'Position-bias audit: [seed-42 blind pilot](judge-position-bias-audit.md) found legacy chose A on 27/28 identical-audio presentations, including Minimal; A/A unblinds to base/head and counts as both a flip and false preference, never agreement. Its 350 Hz lowpass comparisons agreed in 6/6 pairs. The present benchmark measures both mild 7 kHz lowpass and severe 350 Hz lowpass controls; combined degraded accuracy must pass the gate.', '',
    '| Genre | Protocol | Same flips | Mild flips | Severe flips | Seed flips | Overall flips | Same false preference | Mild accuracy | Severe accuracy | Either acceptable | Agrees with human listener | Calibration | Errors |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const g of results.genres) for (const p of ['legacy', 'stable']) {
    const s = g.summary[p];
    lines.push(`| ${g.id} | ${p} | ${pct(s.flips.same.rate)} | ${pct(s.flips.mild.rate)} | ${pct(s.flips.severe.rate)} | ${pct(s.flips.seed.rate)} | ${pct(s.flips.overall.rate)} | ${pct(s.controls.falsePreferenceRate)} | ${pct(s.tiers.mild.accuracy)} | ${pct(s.tiers.severe.accuracy)} | ${s.human ? s.human.eitherAcceptable : 'n/a'} | ${s.human?.agrees ?? (p === 'legacy' ? 'cannot detect' : 'not rated')} | ${s.calibration} | ${s.errors} |`);
  }
  const trap = results.genres.find((g) => g.id === 'trap')?.summary.stable.human;
  if (trap?.ordering) lines.push('', `Trap pair mean: ${trap.ordering.mean.toFixed(2)}; near acceptable (≥5.5): ${trap.ordering.nearAcceptable}; exceeds Minimal/Drill/Hard Techno respectively: ${trap.ordering.exceeds.join('/')}. Soft-anchor gate fails only when below all three.`);
  if (results.marginSweep) {
    lines.push('', '## Offline margin sensitivity', '', 'Re-aggregated the same raw scores (no extra API calls), rather than changing prompts mid-sample. A larger deadband can remove flips through abstention without improving detection; retain 0.75 rather than tune away failed controls.', '', '| Margin | Stable flips overall | Degraded accuracy |', '| --- | --- | --- |');
    for (const s of results.marginSweep) lines.push(`| ${s.margin} | ${pct(s.flips.rate)} | ${pct(s.controls.accuracy)} |`);
  }
  lines.push('', 'Interpretation: read flips together with controls. Constant or near-constant scores can yield zero flips while failing every degraded control; that is not a useful calibrated judge. A low flip rate alone is not evidence of listening accuracy, and failed genres remain uncalibrated. Acceptability on these proxy renders is not a re-rating of the original human pack.', '', 'Raw responses, order decisions, sample counts and errors: [judge-stability-results.json](judge-stability-results.json).', '');
  writeFileSync(join(root, 'docs/judge-stability.md'), lines.join('\n'));
}
const pendingIds = opts.summarize ? [] : ids;
for (let batch = 0; batch < pendingIds.length; batch += 3) await Promise.all(pendingIds.slice(batch, batch + 3).map(async (id) => {
  const pairs = manifests.map((m) => m.pairs.find((p) => p.id === id));
  if (pairs.some((p) => !p)) throw new Error(`Missing rendered prompt ${id}`);
  const files = pairs.map((p, i) => join(renderDirs[i], p.a.file.replace(/\.mp3$/, '.wav')));
  const degraded = {};
  for (const [tier, frequency] of [['mild', 7000], ['severe', 350]]) {
    degraded[tier] = join(out, `${id}-${tier}.wav`);
    run('ffmpeg', ['-v', 'error', '-y', '-i', files[0], '-af', `lowpass=f=${frequency}`, degraded[tier]]);
  }
  const g = { id, style: pairs[0].style, trials: [], summary: {} };
  for (const protocol of ['legacy', 'stable']) {
    for (const [type, audio] of Object.entries({ same: [files[0], files[0]], mild: [files[0], degraded.mild], severe: [files[0], degraded.severe], seed: files })) {
      for (let rep = 0; rep < reps; rep++) {
        console.log(`${id} ${protocol} ${type} ${rep + 1}/${reps}`);
        try {
          const result = await judgeAudio({ files: audio, style: g.style, protocol, out, prefix: `${id}-${type}`, onCall: () => results.apiCalls++ });
          g.trials.push({ protocol, type, rep, ...result });
        } catch (error) { g.trials.push({ protocol, type, rep, error: error.message }); }
      }
    }
    const trials = g.trials.filter((t) => t.protocol === protocol && !t.error);
    const byType = (type) => trials.filter((t) => t.type === type);
    const flips = Object.fromEntries(['same', 'mild', 'severe', 'seed'].map((type) => [type, flipRate(byType(type))]));
    flips.overall = flipRate(trials);
    const controls = controlScores(byType('same'), [...byType('mild'), ...byType('severe')]);
    const tiers = Object.fromEntries(['mild', 'severe'].map((type) => [type, controlScores(byType('same'), byType(type))]));
    const errors = g.trials.filter((t) => t.protocol === protocol && t.error).length;
    const expected = humanExpectations[id];
    const human = protocol === 'stable' && byType('seed').length ? humanAgreement(byType('seed').flatMap((t) => t.windows), expected ?? false) : null;
    if (human && expected === undefined) Object.assign(human, { expectedAcceptable: null, agrees: null });
    g.summary[protocol] = { flips, controls, tiers, human, errors, calibration: errors ? 'uncalibrated' : calibrationGate(controls, flips.overall, id === 'trap' || expected === undefined ? null : human) };
  }
  results.genres.push(g);
  save();
}));
for (const g of results.genres) {
  const seeds = g.trials.filter((t) => t.protocol === 'stable' && t.type === 'seed' && !t.error);
  const expected = humanExpectations[g.id];
  const s = g.summary.stable;
  s.human = seeds.length ? humanAgreement(seeds.flatMap((t) => t.windows), expected ?? false) : null;
  if (s.human && expected === undefined) Object.assign(s.human, { expectedAcceptable: null, agrees: null });
  s.calibration = s.errors ? 'uncalibrated' : calibrationGate(s.controls, s.flips.overall, g.id === 'trap' || expected === undefined ? null : s.human);
}
const trap = results.genres.find((g) => g.id === 'trap');
const terrible = ['minimal', 'uk-drill', 'hard-techno'].map((id) => results.genres.find((g) => g.id === id));
if (trap?.summary.stable.human && terrible.every((g) => g?.summary.stable.human)) {
  const mean = (g) => g.summary.stable.human.scores.reduce((a, b) => a + b, 0) / 2;
  const ordering = trapOrdering(mean(trap), terrible.map(mean));
  Object.assign(trap.summary.stable.human, { ordering, agrees: ordering.agrees });
  if (!ordering.gatePass) trap.summary.stable.calibration = 'uncalibrated';
}
results.marginSweep = [0.5, 0.75, 1, 1.5].map((margin) => {
  const trials = results.genres.flatMap((g) => g.trials.filter((t) => t.protocol === 'stable' && !t.error).map((t) => ({ type: t.type, ...aggregateScores(t.windows, margin) })));
  return { margin, flips: flipRate(trials), controls: controlScores(trials.filter((t) => t.type === 'same'), trials.filter((t) => ['mild', 'severe'].includes(t.type))) };
});
save();
console.log(readFileSync(join(root, 'docs/judge-stability.md'), 'utf8'));
