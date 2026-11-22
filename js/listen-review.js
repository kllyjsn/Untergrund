export const REVIEW_IDS = ['hypnotic-techno', 'deep-house', 'neo-soul', 'boom-bap', 'liquid-dnb', 'ambient'];
export const DIMENSIONS = ['Groove & timing', 'Arrangement & energy arc', 'Harmony/songwriting', 'Tonal balance vs genre target', 'Dynamics & punch', 'Loudness & headroom', 'Stereo image & mono compatibility'];
export const THRESHOLDS = { timingMs: 5, arcDb: 1.5, songwriting: 1, balanceDb: 1.5, crestDb: 1.5, lra: 1.5, loudnessLu: 1, monoLu: 0.5, ceilingDb: -1 };
const finite = Number.isFinite;
const magnitude = (value) => finite(value) ? Math.abs(value) : null;
const num = (v) => finite(v) ? v.toFixed(2) : 'unavailable';

export function reviewTrack(id, base, head) {
  const findings = [];
  const compare = (name, a, b, threshold, higher, description, hold = false) => {
    const known = finite(a) && finite(b), delta = b - a;
    const changed = known && Math.abs(delta) + 1e-9 >= threshold;
    const status = !known ? 'UNMEASURED' : changed ? ((delta > 0) === higher ? 'better' : 'worse') : 'same';
    findings.push({ dimension: name, status, severity: status === 'worse' ? (hold ? 'critical' : 'warning') : 'info', note: `${description}: ${num(a)} → ${num(b)}${known ? '' : ' (UNMEASURED; no preference inferred)'}.` });
  };
  compare(DIMENSIONS[0], base.pcm.gridErrorMs, head.pcm.gridErrorMs, THRESHOLDS.timingMs, false, 'Onset-to-grid error (ms); a timing proxy, not a swing-quality score');
  compare(DIMENSIONS[1], base.pcm.arcDb, head.pcm.arcDb, THRESHOLDS.arcDb, true, 'Energy-arc spread (dB); more contrast gives the sections room to breathe');
  compare(DIMENSIONS[2], base.songwriting.distinctSections, head.songwriting.distinctSections, THRESHOLDS.songwriting, true, 'Distinct sections; form variety only, not a judgment of harmonic taste');
  compare(DIMENSIONS[3], base.balance?.rmsDb, head.balance?.rmsDb, THRESHOLDS.balanceDb, false, `Genre-target RMS deviation (dB); head worst band ${head.balance?.worstHz ?? '?'} Hz at ${num(head.balance?.worstDb)} dB`, true);
  compare(DIMENSIONS[4], base.pcm.crestDb, head.pcm.crestDb, THRESHOLDS.crestDb, true, `Crest (dB); flattened transients lose punch; LRA ${num(base.mix.loudness.lra)} → ${num(head.mix.loudness.lra)} LU`);
  const dynamics = findings.at(-1);
  if (finite(base.mix.loudness.lra) && finite(head.mix.loudness.lra) && head.mix.loudness.lra <= base.mix.loudness.lra - THRESHOLDS.lra) {
    dynamics.status = 'worse'; dynamics.severity = 'warning';
  }
  compare(DIMENSIONS[5], magnitude(base.mix.loudness.deltaTarget), magnitude(head.mix.loudness.deltaTarget), THRESHOLDS.loudnessLu, false, `Distance from loudness target (LU); integrated ${num(base.mix.loudness.integrated)} → ${num(head.mix.loudness.integrated)} LUFS, true peak ${num(base.mix.peak.truePeakDb)} → ${num(head.mix.peak.truePeakDb)} dBTP, clip runs ${base.mix.peak.clipRuns} → ${head.mix.peak.clipRuns}`);
  const safety = findings.at(-1);
  if (head.mix.peak.clipRuns > base.mix.peak.clipRuns || head.pcm.clips > base.pcm.clips || (head.mix.peak.truePeakDb > THRESHOLDS.ceilingDb && head.mix.peak.truePeakDb > base.mix.peak.truePeakDb + 0.05)) {
    safety.status = 'worse'; safety.severity = 'critical'; safety.note += ' Headroom safety regressed; pull the master back.';
  }
  if (head.mix.peak.truePeakDb > -1 || head.mix.peak.clipRuns > 0 || head.pcm.clips > 0) safety.note += ' Existing or new safety breach needs attention.';
  compare(DIMENSIONS[6], base.mix.stereo.monoLossLu, head.mix.stereo.monoLossLu, THRESHOLDS.monoLu, true, `Mono fold-down (LU); keep the center solid; correlation ${num(base.mix.stereo.correlation)} → ${num(head.mix.stereo.correlation)}`);
  return { id, base, head, findings, verdict: verdict(findings) };
}

export function verdict(findings) {
  if (findings.some((f) => f.severity === 'critical')) return 'Hold';
  return !findings.length || findings.some((f) => f.status === 'UNMEASURED' || f.status === 'worse' || /breach/.test(f.note)) ? 'Ship with notes' : 'Ship';
}

export function validateJudgment(value) {
  if (!value || !['A', 'B', 'same'].includes(value.preference) || !Array.isArray(value.dimensions) || value.dimensions.length !== DIMENSIONS.length || !value.dimensions.every((d, i) => d.dimension === DIMENSIONS[i] && ['A', 'B', 'same'].includes(d.preference) && typeof d.note === 'string')) throw new Error('Invalid judge JSON');
  return value;
}

export function orderAgreement(forward, reverse) {
  validateJudgment(forward); validateJudgment(reverse);
  const unblind = (v, reversed) => v === 'same' ? 'same' : ((v === 'A') !== reversed ? 'base' : 'head');
  const a = unblind(forward.preference, false), b = unblind(reverse.preference, true);
  return a === b ? a : 'inconclusive';
}

export function flipRate(trials) {
  for (const t of trials) for (const order of ['forward', 'reverse']) if (!['base', 'head', 'same'].includes(t[order])) throw new Error('Invalid trial');
  const flips = trials.filter((t) => t.forward !== t.reverse).length;
  return { n: trials.length, flips, rate: trials.length ? flips / trials.length : null };
}

export function controlScores(same, degraded, clean = 'base') {
  flipRate(same); flipRate(degraded);
  if (!['base', 'head'].includes(clean)) throw new Error('Invalid clean candidate');
  return {
    falsePreferenceRate: same.length ? same.filter((t) => t.forward !== 'same' || t.reverse !== 'same').length / same.length : null,
    accuracy: degraded.length ? degraded.filter((t) => t.forward === clean && t.reverse === clean).length / degraded.length : null,
  };
}

export function calibrationGate(controls, flips, human = null) {
  if (human && human.agrees !== true) return 'uncalibrated';
  return controls.falsePreferenceRate !== null && controls.accuracy !== null && flips.rate !== null &&
    controls.falsePreferenceRate <= 0.25 && controls.accuracy >= 0.75 && flips.rate <= 0.25 ? 'calibrated' : 'uncalibrated';
}

export function humanAgreement(windows, expectedAcceptable, threshold = 6) {
  if (!windows.length || typeof expectedAcceptable !== 'boolean' || !finite(threshold) || threshold < 1 || threshold > 10) throw new Error('Invalid human control');
  const candidates = [[], []];
  for (const w of windows) {
    if (!Array.isArray(w) || w.length !== 2) throw new Error('Invalid human orders');
    w.forEach((v, order) => {
      validateScores(v);
      candidates[0].push((order === 0 ? v.A : v.B).overall);
      candidates[1].push((order === 0 ? v.B : v.A).overall);
    });
  }
  const scores = candidates.map((xs) => xs.reduce((a, b) => a + b, 0) / xs.length);
  const eitherAcceptable = scores.some((s) => s >= threshold);
  return { threshold, scores, eitherAcceptable, expectedAcceptable, agrees: eitherAcceptable === expectedAcceptable };
}

export function trapOrdering(trap, terrible) {
  if (!finite(trap) || terrible.length !== 3 || !terrible.every(finite)) throw new Error('Invalid human ordering');
  return { mean: trap, nearAcceptable: trap >= 5.5, exceeds: terrible.map((score) => trap > score), agrees: terrible.every((score) => trap > score), gatePass: !terrible.every((score) => trap < score) };
}

export function validateScores(value) {
  const candidate = (x) => x && finite(x.overall) && x.overall >= 1 && x.overall <= 10 &&
    Array.isArray(x.dimensions) && x.dimensions.length === DIMENSIONS.length &&
    x.dimensions.every((d, i) => d.dimension === DIMENSIONS[i] && finite(d.score) && d.score >= 1 && d.score <= 10);
  if (!value || !candidate(value.A) || !candidate(value.B)) throw new Error('Invalid judge scores');
  return value;
}

export function aggregateScores(windows, margin = 0.75) {
  if (!windows.length || !finite(margin) || margin <= 0) throw new Error('Invalid scoring windows or margin');
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const decision = (d) => Math.abs(d) < margin ? 'same' : d > 0 ? 'head' : 'base';
  const unblinded = windows.map((w) => {
    if (!Array.isArray(w) || w.length !== 2) throw new Error('Invalid scoring orders');
    return w.map((v, order) => {
      validateScores(v);
      return { base: order === 0 ? v.A : v.B, head: order === 0 ? v.B : v.A };
    });
  });
  const deltas = [0, 1].map((order) => mean(unblinded.map((w) => w[order].head.overall - w[order].base.overall)));
  const dimensions = DIMENSIONS.map((dimension, i) => ({ dimension, delta: mean(unblinded.flatMap((w) => w.map((v) => v.head.dimensions[i].score - v.base.dimensions[i].score))) }));
  const [forward, reverse] = deltas.map(decision), delta = mean(deltas);
  return { forward, reverse, delta, deltas, dimensions, unblinded, preference: forward === reverse && decision(delta) !== 'same' ? decision(delta) : 'inconclusive' };
}

const escape = (s) => String(s).replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
export function markdownReview(review) {
  return [`# Expert listening review: ${review.verdict}`, '', `Base: ${review.baseRef} (${review.baseCommit}); head: ${review.headCommit}.`, '', 'Measured proxies, not a substitute for human listening. No reference recordings used.', '', '| Track | Verdict | Regressions |', '| --- | --- | --- |', ...review.tracks.map((t) => `| ${escape(t.id)} | ${t.verdict} | ${t.findings.filter((f) => f.status === 'worse').map((f) => escape(f.dimension)).join(', ') || 'None'} |`), '', ...review.tracks.flatMap((t) => [`## ${t.id}`, ...t.findings.map((f) => `- **${f.dimension}: ${f.status} (${f.severity})** — ${f.note}`), `- Songwriting base/head: \`${JSON.stringify(t.base.songwriting)}\` / \`${JSON.stringify(t.head.songwriting)}\``, '', 'How to listen (local generated audio):', `- Base: \`${t.base.mp3}\``, `- Head: \`${t.head.mp3}\``, '']), '## Audio-model judge (advisory only)', '', 'Measured order-stability and per-genre calibration: docs/judge-stability.md (raw results: docs/judge-stability-results.json). Uncalibrated genres are advisory and never counted. Model preference never changes the measured verdict.', ...review.judge.map((j) => `- ${j.id}: ${j.preference || j.note}${j.model ? ` (${j.model})` : ''}`), '', 'Full measurements and both raw judge orders: `review.json`.', ''].join('\n');
}
