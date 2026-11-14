// Product principles (js/principles.js): every rule cites the research map, and every proposed experiment is a valid
// EXPERIMENTS entry that is not running and whose one change does what it says on the composition benchmark's seeds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRINCIPLES, PRINCIPLES_VERSION, PROPOSED, perArm } from '../js/principles.js';
import { EXPERIMENTS, experimentErrors, assign } from '../js/experiments.js';
import { METRICS } from '../api/_lib/improve.js';
import { buildSong, scoreSong, SEEDS } from '../scripts/composition.mjs';

const map = readFileSync(new URL('../research/program.md', import.meta.url), 'utf8');
const keys = new Set([...map.matchAll(/^- \*\*([a-z0-9]+)\*\* /gm)].map((m) => m[1]));
assert(Number.isInteger(PRINCIPLES_VERSION) && PRINCIPLES_VERSION >= 1);
assert(keys.size >= 30, `research map lists its citations (${keys.size})`);
for (const line of map.split('\n').filter((l) => /^- \*\*[a-z0-9]+\*\* /.test(l))) assert(/https:\/\/(doi\.org|arxiv\.org|proceedings\.|www\.itu\.int|ismir)/.test(line), `citation has a DOI or URL: ${line.slice(0, 60)}`);
const ids = new Set();
for (const p of PRINCIPLES) {
  assert(/^[a-z]+\.[a-z-]+$/.test(p.id) && !ids.has(p.id), `principle id ${p.id}`); ids.add(p.id);
  assert(p.rule && p.measure && p.refs.length, p.id);
  for (const k of p.refs) assert(keys.has(k), `${p.id} cites ${k}, which research/program.md lists`);
  assert(map.includes(`\`${p.id}\``), `research/program.md maps ${p.id}`);
}

const metrics = Object.keys(METRICS), live = new Set(EXPERIMENTS.map((e) => e.id));
const songOf = (e, seed) => buildSong(e.scope.style, seed);
const T = Date.UTC(2026, 10, 20);
const rows = {};
for (const e of PROPOSED) {
  assert.deepEqual(experimentErrors(e, metrics), [], e.id);
  assert(!live.has(e.id), `${e.id} is a proposal, not running`);
  assert(ids.has(e.principle) && PRINCIPLES.find((p) => p.id === e.principle).experiment === e.id, `${e.id} tests ${e.principle}`);
  assert(e.hypothesis && typeof e.apply === 'function' && e.minListensPerArm === Math.max(50, e.minListensPerArm));
  assert(map.includes(`\`${e.id}\``), `research/program.md describes ${e.id}`);
  // Live only once its PR adds it to EXPERIMENTS with dates; the same entry then assigns like any other.
  assert.equal(assign('listener0000001', { ...e.scope }, EXPERIMENTS, T)?.xp === e.id, false);
  assert.ok(assign('listener0000001', { ...e.scope }, [{ ...e, from: '2026-11-15' }], T));
  const a = [], b = [];
  for (const seed of SEEDS) {
    const control = songOf(e, seed), variant = songOf(e, seed);
    e.apply(variant, { seed });
    assert.equal(variant.chain.length, control.chain.length, `${e.id} ${seed}: same length`);
    assert.deepEqual(songOf(e, seed), control, `${e.id}: control is untouched and deterministic`);
    const pick = (s) => (e.offline.metric === 'swing' ? s.swing : scoreSong(s)[e.offline.metric]);
    a.push(pick(control)); b.push(pick(variant));
    if (e.offline.expect === 'zero') assert(pick(control) > 0 && pick(variant) === 0, `${e.id} ${seed}: ${pick(control)} -> ${pick(variant)}`);
    if (e.offline.expect === 'higher') assert(pick(variant) >= pick(control), `${e.id} ${seed}: ${pick(control)} -> ${pick(variant)}`);
    if (e.offline.expect === 'lower') assert(pick(variant) <= pick(control), `${e.id} ${seed}: ${pick(control)} -> ${pick(variant)}`);
  }
  const med = (x) => [...x].sort((p, q) => p - q)[x.length >> 1];
  if (e.offline.expect === 'higher') assert(med(b) > med(a), `${e.id}: median ${e.offline.metric} rises`);
  if (e.offline.expect === 'lower') assert(med(b) < med(a), `${e.id}: median ${e.offline.metric} falls`);
  rows[e.id] = { metric: e.offline.metric, control: med(a), variant: med(b), perArm: e.minListensPerArm };
}
// pop-no-bridge keeps duration: the verse it plays instead is as long as the bridge it replaces.
const pop = buildSong('pop', SEEDS[0]); PROPOSED[0].apply(pop);
assert(!/[EF]/.test(pop.chain) && /^[A-H]+$/.test(pop.chain));
assert.equal(perArm(0.5, 0.1), 385);
if (!process.argv.includes('--quiet')) console.table(rows);
console.log(`principles passed: v${PRINCIPLES_VERSION}, ${PRINCIPLES.length} principles, ${PROPOSED.length} proposed experiments, ${keys.size} citations`);
