import assert from 'node:assert/strict';
import { timbreFeatures, rankTimbres, ROLES } from '../js/timbre-metrics.js';

const fs = 12000, notes = [0.1, 0.8, 1.5].map((t) => ({ t, dur: 0.3 }));
function signal(hz, attack = 0.015, tail = 0.025) {
  const x = new Float32Array(fs * 3);
  for (const { t, dur } of notes) for (let i = Math.floor(t * fs); i < Math.min(x.length, (t + dur + tail * 5) * fs); i++) {
    const s = i / fs - t, a = s < dur ? Math.min(1, s / attack) : Math.exp(-(s - dur) / tail);
    x[i] += Math.sin(2 * Math.PI * hz * i / fs) * a;
  }
  return x;
}
const a = timbreFeatures([signal(220)], fs, notes), same = timbreFeatures([signal(220)], fs, notes), b = timbreFeatures([signal(3500, 0.15, 0.09)], fs, notes);
assert.equal(a.status, 'MEASURED'); assert.equal(b.status, 'MEASURED');
assert.deepEqual(a.vector, same.vector);
assert.ok(b.centroid > a.centroid * 5); assert.ok(b.envelope[0] > a.envelope[0]);
assert.equal(timbreFeatures([new Float32Array(fs)], fs, notes).status, 'UNMEASURED');
assert.equal(timbreFeatures([], fs).status, 'UNMEASURED');
assert.equal(timbreFeatures([Float32Array.of(NaN)], fs).status, 'UNMEASURED');
assert.equal(timbreFeatures([signal(220)], fs, []).status, 'UNMEASURED');
const rows = ['a', 'identical', 'different'].flatMap((style) => [1, 2, 3].map((seed) => ({ style, seed, roles: Object.fromEntries(Object.keys(ROLES).map((r) => [r, style === 'different' ? b : a])) })));
const report = rankTimbres(rows);
const identical = report.pairs.find((p) => p.a === 'a' && p.b === 'identical');
assert.equal(identical.status, 'UNMEASURED');
assert.equal(identical.similarity, null);
assert.match(identical.roles.bass.reason, /not separable/);
assert.equal(report.pairs.find((p) => p.a === 'a' && p.b === 'different').status, 'MEASURED');
assert.ok(a.vector.reduce((s, v, k) => s + (v - same.vector[k]) ** 2, 0) < a.vector.reduce((s, v, k) => s + (v - b.vector[k]) ** 2, 0));
assert.deepEqual(rankTimbres([]), { pairs: [], nearest: [] });
console.log('timbre: synthetic identical/distinct spectra and envelopes, silence, missing/invalid PCM, empty input and uncertainty checks passed');
