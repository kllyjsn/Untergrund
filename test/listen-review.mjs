import assert from 'node:assert/strict';
import { DIMENSIONS, REVIEW_IDS, reviewTrack, verdict, orderAgreement, validateJudgment, markdownReview } from '../js/listen-review.js';
import { targetCurve, targetBalance } from '../js/audio-quality.js';

for (const style of ['hypnotic', 'hardtechno', 'minimal', 'drill', 'trap']) {
  const curve = targetCurve(style), hz = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  assert.equal(curve.length, 9);
  const octaves = hz.map((f, i) => [f, curve[i] - 20]);
  assert.equal(targetBalance(octaves, style).rmsDb, 0, 'level independent target match');
  assert.equal(targetBalance(octaves.slice(0, -1), style).rmsDb, 0, '44.1 kHz excludes the 16 kHz octave');
  octaves[0][1] += 12;
  assert(targetBalance(octaves, style).rmsDb > 3, 'excess bass deviates');
  assert.equal(targetBalance(octaves.slice(1), style), null, 'partial spectrum is unmeasured');
}
assert.equal(targetBalance([], 'trap'), null);
assert.equal(targetBalance([[63, NaN]], 'trap'), null);
assert.equal(targetCurve('unknown'), null);

const fixture = () => ({ pcm: { gridErrorMs: 10, arcDb: 5, crestDb: 12, clips: 0 }, songwriting: { distinctSections: 4 }, balance: { rmsDb: 3, worstHz: 125, worstDb: 2 }, mix: { loudness: { integrated: -10, deltaTarget: 0, lra: 5 }, peak: { truePeakDb: -2, clipRuns: 0 }, stereo: { monoLossLu: -0.5, correlation: 0.8 } }, mp3: '/local/generated.mp3' });
const compare = (mutate) => { const a = fixture(), b = fixture(); mutate(b); return reviewTrack('test', a, b); };
assert.equal(REVIEW_IDS.length, 6);
assert.equal(compare(() => {}).verdict, 'Ship');
assert.equal(compare((b) => { b.balance.rmsDb += 1.49; }).verdict, 'Ship');
assert.equal(compare((b) => { b.balance.rmsDb += 1.5; }).verdict, 'Hold');
{
  const a = fixture(), b = fixture();
  a.balance.rmsDb = 2.6; b.balance.rmsDb = 4.1;
  assert.equal(reviewTrack('fractional-threshold', a, b).verdict, 'Hold');
}
assert.equal(compare((b) => { b.mix.peak.truePeakDb = -0.9; }).verdict, 'Hold');
assert.equal(compare((b) => { b.mix.peak.clipRuns = 1; }).verdict, 'Hold');
assert.equal(compare((b) => { b.pcm.clips = 1; }).verdict, 'Hold');
assert.equal(compare((b) => { b.pcm.crestDb -= 1.5; }).verdict, 'Ship with notes');
assert.equal(compare((b) => { b.mix.loudness.lra -= 1.5; }).verdict, 'Ship with notes');
assert.equal(compare((b) => { b.pcm.gridErrorMs += 4.99; }).findings[0].status, 'same');
assert.equal(compare((b) => { b.pcm.gridErrorMs += 5; }).findings[0].status, 'worse');
assert.equal(compare((b) => { b.pcm.arcDb += 1.5; }).findings[1].status, 'better');
assert.equal(compare((b) => { b.songwriting.distinctSections -= 1; }).findings[2].status, 'worse');
assert.equal(compare((b) => { b.mix.stereo.monoLossLu -= 0.5; }).findings[6].status, 'worse');
assert.equal(compare((b) => { b.balance = null; b.pcm.gridErrorMs = null; }).findings[3].status, 'UNMEASURED');
assert.equal(compare((b) => { b.balance = null; }).verdict, 'Ship with notes');
assert.equal(compare((b) => { b.pcm.gridErrorMs = null; }).verdict, 'Ship with notes');
for (const missing of [null, undefined, NaN, Infinity]) {
  for (const side of ['base', 'head']) {
    const base = fixture(), head = fixture();
    base.mix.loudness.deltaTarget = 3; head.mix.loudness.deltaTarget = 3;
    (side === 'base' ? base : head).mix.loudness.deltaTarget = missing;
    const finding = reviewTrack('missing-loudness', base, head).findings[5];
    assert.equal(finding.status, 'UNMEASURED');
    assert.match(finding.note, /UNMEASURED; no preference inferred/);
  }
}
assert.equal(verdict([]), 'Ship with notes');
const judgment = (preference) => ({ preference, dimensions: DIMENSIONS.map((dimension) => ({ dimension, preference, note: 'Audible evidence' })) });
assert.equal(orderAgreement(judgment('A'), judgment('B')), 'base');
assert.equal(orderAgreement(judgment('B'), judgment('A')), 'head');
assert.equal(orderAgreement(judgment('A'), judgment('A')), 'inconclusive');
assert.equal(orderAgreement(judgment('same'), judgment('same')), 'same');
assert.throws(() => validateJudgment({ preference: 'A', dimensions: [] }), /Invalid/);
assert.throws(() => validateJudgment(null), /Invalid/);
const track = compare(() => {});
const report = markdownReview({ verdict: 'Ship', baseRef: 'origin/main', baseCommit: 'abc', headCommit: 'def', tracks: [track], judge: [{ id: 'test', note: 'Skipped: key missing' }] });
for (const text of ['# Expert listening review: Ship', '| test | Ship | None |', 'How to listen', '/local/generated.mp3', 'advisory only', 'Skipped: key missing', '10.00 → 10.00']) assert.ok(report.includes(text), text);
assert.ok(markdownReview({ verdict: 'Ship', tracks: [], judge: [] }).includes('Full measurements'));
console.log('listening review: thresholds, Hold safety, missing metrics, order agreement and markdown passed');
