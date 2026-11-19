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

const escape = (s) => String(s).replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
export function markdownReview(review) {
  return [`# Expert listening review: ${review.verdict}`, '', `Base: ${review.baseRef} (${review.baseCommit}); head: ${review.headCommit}.`, '', 'Measured proxies, not a substitute for human listening. No reference recordings used.', '', '| Track | Verdict | Regressions |', '| --- | --- | --- |', ...review.tracks.map((t) => `| ${escape(t.id)} | ${t.verdict} | ${t.findings.filter((f) => f.status === 'worse').map((f) => escape(f.dimension)).join(', ') || 'None'} |`), '', ...review.tracks.flatMap((t) => [`## ${t.id}`, ...t.findings.map((f) => `- **${f.dimension}: ${f.status} (${f.severity})** — ${f.note}`), `- Songwriting base/head: \`${JSON.stringify(t.base.songwriting)}\` / \`${JSON.stringify(t.head.songwriting)}\``, '', 'How to listen (local generated audio):', `- Base: \`${t.base.mp3}\``, `- Head: \`${t.head.mp3}\``, '']), '## Audio-model judge (advisory only)', '', 'Prior pilot: judgments were conclusive only for Minimal. Model preference never changes the measured verdict.', ...review.judge.map((j) => `- ${j.id}: ${j.preference || j.note}${j.model ? ` (${j.model})` : ''}`), '', 'Full measurements and both raw judge orders: `review.json`.', ''].join('\n');
}
