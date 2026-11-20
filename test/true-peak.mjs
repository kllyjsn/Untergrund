// scripts/true-peak.mjs gate logic: every style is swept, every ensemble is reached, CI shards cover the sweep once,
// and the verdict fails new breaches, louder known breaches and stale known entries.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STYLES, INSTRUMENTS } from '../js/state.js';
import { sweepSeeds, ensembleOf, jobs, shard, verdict, SWEEP_SEEDS, WORSE_DB, KNOWN_FILE } from '../scripts/true-peak.mjs';

assert(readFileSync(new URL('../js/state.js', import.meta.url), 'utf8').includes('rng(Math.imul((seed | 0) ^ 0x6d2b79f5, 0x85ebca6b))'),
  'ensembleOf() mirrors the instrument RNG in js/state.js generatePattern(): update both together');
for (const style of Object.keys(STYLES)) {
  const seeds = sweepSeeds(style);
  assert.deepEqual(seeds.slice(0, SWEEP_SEEDS.length), SWEEP_SEEDS, `${style} sweeps the base seeds`);
  if (INSTRUMENTS[style]) assert.equal(new Set(seeds.map((s) => ensembleOf(style, s))).size, INSTRUMENTS[style].length, `${style} renders every ensemble`);
}
const all = jobs(Object.keys(STYLES));
assert.equal(new Set(all.map((j) => j[0])).size, Object.keys(STYLES).length, 'every style is in the sweep');
assert.deepEqual(jobs(['trap'], null, {}).filter(([, seed]) => seed === 211), [['trap', 211]], 'Trap seed 211 stays in the sweep without an exemption');
for (const n of [1, 4, 6]) {
  const parts = Array.from({ length: n }, (_, i) => shard(all, i + 1, n));
  assert.deepEqual(parts.flat().map(String).sort(), all.map(String).sort(), `${n} shards cover the sweep exactly once`);
}

const row = (style, seed, tp) => ({ style, seed, tp, bar: 3, at: 7.5, section: 'G' });
assert(verdict([row('trap', 11, -1.2), row('peak', 42, -1)]).ok, 'at or under -1 dBTP passes');
const v = verdict([row('trap', 20, -0.93)]);
assert(!v.ok && /trap\/20: -0\.93 dBTP at bar 4 .* over the -1 dBTP ceiling/.test(v.fail[0]), 'a new breach fails with style, seed, peak and bar');
const known = { 'trap/20': { tp: -0.9 } };
assert(verdict([row('trap', 20, -0.85)], known).ok, 'a known breach within tolerance passes');
assert(!verdict([row('trap', 20, -0.9 + WORSE_DB + 0.01)], known).ok, 'a known breach that got louder fails');
assert(/remove it/.test(verdict([row('trap', 20, -1.4)], known).fixed[0]), 'a fixed known breach must be removed from the list');

const listed = JSON.parse(readFileSync(KNOWN_FILE, 'utf8')).songs;
for (const [id, k] of Object.entries(listed)) {
  const [style, seed] = id.split('/');
  assert(STYLES[style] && all.some(([st, sd]) => st === style && sd === +seed), `${id} is rendered by the sweep`);
  assert(k.tp > -1 && k.why, `${id} records its measured peak and why it is known`);
}
console.log(`true-peak gate: ${all.length} songs across ${Object.keys(STYLES).length} styles, ${Object.keys(listed).length} known breaches`);
