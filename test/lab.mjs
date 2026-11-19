import assert from 'node:assert/strict';
import { analyzePcm, summarizeRatings, validateBenchmark, planSession, raterQuality, aggregateRatings, fitBradleyTerry, seededRandom, DIMENSIONS } from '../js/lab-metrics.js';

assert.throws(() => validateBenchmark({ id: 'x', pairs: [] }));
assert.equal(validateBenchmark({ id: 'x', pairs: [{ id: 'p', a: { id: 'a', file: 'a.wav' }, b: { id: 'b', url: '/b.wav' } }] }).id, 'x');

const sr = 48000, seconds = 1, clean = new Float32Array(sr * seconds);
for (let i = 0; i < clean.length; i++) clean[i] = Math.sin(2 * Math.PI * 440 * i / sr) * 0.5;
const healthy = analyzePcm([clean], sr, { bpm: 120, renderMs: 500 });
assert(healthy.peakDb < -5.9 && healthy.peakDb > -6.1);
assert.equal(healthy.clips, 0);
assert.equal(healthy.renderRatio, 0.5);
assert(!healthy.flags.includes('clipping'));

// Dense kicks over a sustained bed never reach 1.8 times the song's median RMS.
// Flux must still find their attacks, at different tempi and recording levels.
for (const bpm of [126, 154, 174]) {
  for (const gain of [1, 0.05]) {
    const kick = Float32Array.from({ length: sr * 6 }, (_, i) => {
      const t = i / sr, phase = t % (60 / bpm);
      return gain * (0.3 * Math.sin(2 * Math.PI * 440 * t) +
        0.35 * Math.exp(-phase * 15) * Math.sin(2 * Math.PI * 65 * t));
    });
    const measured = analyzePcm([kick], sr, { bpm });
    const expected = Math.floor(6 * bpm / 60);
    assert(measured.onsets >= expected - 2 && measured.onsets <= expected + 2, `dense ${bpm}/${gain}: ${measured.onsets}`);
    assert(measured.gridErrorMs < 20, `dense kick timing ${measured.gridErrorMs}`);
  }
}
assert.equal(analyzePcm([new Float32Array(sr)], sr, { bpm: 120 }).gridErrorMs, null);
assert.equal(analyzePcm([clean], sr, { bpm: 120 }).onsets, 0, 'steady tone is not a groove');
assert.equal(analyzePcm([clean], sr).gridErrorMs, null, 'no tempo means no timing estimate');

const clipped = new Float32Array(sr).fill(1);
const unhealthy = analyzePcm([clipped], sr);
assert(unhealthy.clips > 0);
assert(unhealthy.flags.includes('clipping'));
assert(unhealthy.flags.includes('dc-offset'));

// Dynamic arc: a song that drops 20 dB for a breakdown spreads wide; a steady loop sits near 0.
const arc = (gainOf) => { const x = new Float32Array(sr * 20); for (let i = 0; i < x.length; i++) x[i] = Math.sin(2 * Math.PI * 220 * i / sr) * gainOf(i / sr); return analyzePcm([x], sr).arcDb; };
assert(arc(() => 0.5) < 0.5, 'steady loop has no arc');
assert(arc((t) => (t > 8 && t < 14 ? 0.05 : 0.5)) > 15, 'a breakdown shows up as arc');

const summary = summarizeRatings([{
  identity: { left: 'new', right: 'old' },
  ratings: { left: { musicality: 5, originality: 4 }, right: { musicality: 2, originality: 3 } },
  replay: 'left', release: 'left',
  metrics: { left: { flags: [] }, right: { flags: ['clipping'] } },
}]);
assert.equal(summary.new.meanRating, 4.5);
assert.equal(summary.new.replayWins, 1);
assert.equal(summary.old.technicalFlags, 1);
const manifest = { id: 'session-test', pairs: Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, a: { id: 'a', file: 'a.wav' }, b: { id: 'b', file: 'b.wav' } })) };
const plan = planSession(manifest, 'one');
assert.deepEqual(plan, planSession(manifest, 'one'));
assert.notDeepEqual(plan, planSession(manifest, 'two'));
for (const repeat of plan.trials.filter((t) => t.kind === 'repeat')) {
  const original = plan.trials.find((t) => t.kind === 'main' && t.pairId === repeat.repeatOf);
  assert.equal(repeat.flipped, !original.flipped);
  assert(plan.trials.indexOf(repeat) - plan.trials.indexOf(original) > 1);
}
assert.throws(() => planSession({ ...manifest, pairs: [{ ...manifest.pairs[0], catch: true }] }, 'one'), /expect/);
const result = (kind, flipped = false, pick = 'a') => ({
  pairId: 'p0', trial: { kind, flipped, expect: 'a', ...(kind === 'repeat' && { repeatOf: 'p0' }) },
  identity: flipped ? { left: 'b', right: 'a' } : { left: 'a', right: 'b' },
  ratings: { left: Object.fromEntries(DIMENSIONS.map((d) => [d, flipped ? 1 : 5])), right: Object.fromEntries(DIMENSIONS.map((d) => [d, flipped ? 5 : 1])) },
  release: pick === 'neither' ? pick : (pick === 'a') !== flipped ? 'left' : 'right',
});
assert.equal(raterQuality([result('catch')]).catchPassRate, 1);
assert.equal(raterQuality([result('catch', true)]).flagged, false);
assert.equal(raterQuality([result('catch', false, 'b')]).flagged, true);
assert.equal(raterQuality([result('main'), result('repeat', true)]).repeatConsistency, 1);
assert.equal(raterQuality([result('main'), result('repeat', true, 'b')]).flagged, true);
assert.equal(raterQuality([]).catchPassRate, null);
assert.deepEqual(summarizeRatings([result('catch')]), {});
assert.deepEqual(fitBradleyTerry([]), {});
const random = seededRandom('simulation'), truth = { a: 0.55, b: 0.3, c: 0.15 };
const listeners = Array.from({ length: 100 }, (_, i) => ({
  listenerId: 'sim-' + i, benchmarkId: manifest.id,
  results: ['ab', 'ac', 'bc'].flatMap(([a, b]) => Array.from({ length: 10 }, () => {
    const win = random() < truth[a] / (truth[a] + truth[b]);
    return { identity: { left: a, right: b }, trial: { kind: 'main' }, ratings: { left: Object.fromEntries(DIMENSIONS.map((d) => [d, win ? 5 : 1])), right: Object.fromEntries(DIMENSIONS.map((d) => [d, win ? 1 : 5])) }, release: win ? 'left' : 'right' };
  })).concat(result('catch')),
}));
const aggregate = aggregateRatings(listeners, manifest, { bootstrap: 150 });
const strengths = aggregate.dimensions.overall;
assert.equal(aggregate.status, 'sufficient');
assert(strengths.a.strength > strengths.b.strength && strengths.b.strength > strengths.c.strength);
for (const id of Object.keys(truth)) assert(strengths[id].ci[0] <= truth[id] && strengths[id].ci[1] >= truth[id], id + ' CI contains true normalized strength');
assert.equal(aggregateRatings(listeners.slice(0, 4), manifest).status, 'insufficient');
assert.equal(aggregateRatings([], manifest).status, 'insufficient');
const flagged = { listenerId: 'bad', benchmarkId: manifest.id, results: [result('catch', false, 'b')] };
assert.equal(aggregateRatings([flagged], manifest).includedRaters, 0);
const empty = Array.from({ length: 6 }, (_, i) => ({ listenerId: `empty-${i}`, benchmarkId: manifest.id, results: [] }));
assert.equal(aggregateRatings(empty, manifest).status, 'insufficient', 'empty exports do not satisfy the rater minimum');
const noCatch = Array.from({ length: 6 }, (_, i) => ({ listenerId: `nocatch-${i}`, benchmarkId: manifest.id, results: [result('main')] }));
assert.equal(aggregateRatings(noCatch, manifest).unflaggedRaters, 0, 'raters without a catch trial do not count');
assert.throws(() => aggregateRatings([{ results: [] }]), /listenerId/);
console.log('listening lab metrics passed');
