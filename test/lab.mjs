import assert from 'node:assert/strict';
import { analyzePcm, summarizeRatings, validateBenchmark } from '../js/lab-metrics.js';

assert.throws(() => validateBenchmark({ id: 'x', pairs: [] }));
assert.equal(validateBenchmark({ id: 'x', pairs: [{ id: 'p', a: { id: 'a', file: 'a.wav' }, b: { id: 'b', url: '/b.wav' } }] }).id, 'x');

const sr = 48000, seconds = 1, clean = new Float32Array(sr * seconds);
for (let i = 0; i < clean.length; i++) clean[i] = Math.sin(2 * Math.PI * 440 * i / sr) * 0.5;
const healthy = analyzePcm([clean], sr, { bpm: 120, renderMs: 500 });
assert(healthy.peakDb < -5.9 && healthy.peakDb > -6.1);
assert.equal(healthy.clips, 0);
assert.equal(healthy.renderRatio, 0.5);
assert(!healthy.flags.includes('clipping'));

const clipped = new Float32Array(sr).fill(1);
const unhealthy = analyzePcm([clipped], sr);
assert(unhealthy.clips > 0);
assert(unhealthy.flags.includes('clipping'));
assert(unhealthy.flags.includes('dc-offset'));

const summary = summarizeRatings([{
  identity: { left: 'new', right: 'old' },
  ratings: { left: { musicality: 5, originality: 4 }, right: { musicality: 2, originality: 3 } },
  replay: 'left', release: 'left',
  metrics: { left: { flags: [] }, right: { flags: ['clipping'] } },
}]);
assert.equal(summary.new.meanRating, 4.5);
assert.equal(summary.new.replayWins, 1);
assert.equal(summary.old.technicalFlags, 1);
console.log('listening lab metrics passed');
