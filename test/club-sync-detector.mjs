import assert from 'node:assert/strict';
import { onsets, compare, envelope } from './club-sync-audio.mjs';

const bpm = 123, beat = 60000 / bpm;
const signal = (shift = 0, omit = -1) => Array.from({ length: 5000 }, (_, i) => {
  const t = i * 2, k = Math.floor(t / beat), phase = t % beat;
  return [100000 + t + shift, k === omit ? 0 : Math.exp(-phase / 45)];
});
const host = onsets(signal(), bpm), listener = onsets(signal(80), bpm);
assert.ok(host.length >= 20);
assert.equal(compare(host, host, bpm).max, 0);
assert.equal(compare(host, listener, bpm).median, 80);
assert.equal(compare(host, onsets(signal(0, 5), bpm), bpm).missing.listener, 1);
assert.deepEqual(onsets([], bpm), []);
assert.deepEqual(onsets([[0, 0], [1, 0]], bpm), []);
assert.equal(compare([], [], bpm).median, null);
assert.throws(() => envelope({ errors: [], anchors: [], samples: [] }), /No rendered audio/);
assert.throws(() => envelope({ errors: ['route error'] }), /route error/);
// Sparse reference avoids nearest-neighbour beat aliasing for a 2s delay.
assert.equal(compare([0, 5000, 10000], [2000, 7000, 12000], 10).median, 2000);
assert.deepEqual(envelope({ errors: [], anchors: [[1, 10000]], samples: [[1.5, .2]] }), [[10500, .2]]);
console.log('Detector tests PASS: synthesized PCM-envelope onsets, self=0ms, shifted=80ms, sparse shifted=2000ms, one missing kick, silence/empty/error, output-clock mapping.');
