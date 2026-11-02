import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { STYLES, arrangement, generate } from '../js/state.js';

const SEEDS = [101, 211, 307, 401, 503, 601, 701, 809, 907, 1009, 1103, 1201, 1301, 1409, 1511, 1601, 1709, 1801, 1901, 2003];
const TRACKS = ['kick', 'snare', 'clap', 'ch', 'oh', 'ride', 'perc', 'stab', 'vox', 'acid'];
const THRESHOLDS = {
  ensemblesPerGenre: 4,
  uniquePatternsPerGenre: 18,
  uniqueArrangementsPerGenre: 18,
  genreDistanceP10: 0.09,
  genreDistanceMedian: 0.14,
};

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)];
};
const active = (steps = []) => steps.filter((step) => (
  Array.isArray(step) ? step.length > 0 : typeof step === 'object' ? step?.on : Boolean(step)
)).length / Math.max(1, steps.length);
const featureVector = (generated) => {
  const { pattern, params, master, bpm, swing = 0 } = generated;
  const hook = pattern.hook?.s || [];
  return [
    bpm / 180,
    swing,
    master.revLevel || 0,
    master.room || 0,
    master.duck || 0,
    master.arr || 0,
    master.dust || 0,
    (params.stab.voice || 0) / 10,
    (params.acid.voice || 0) / 4,
    (params.stab.octave || 0) / 2,
    ...TRACKS.map((track) => active(pattern.steps[track])),
    active(hook),
    (pattern.prog?.length || 0) / 8,
    new Set(pattern.prog || []).size / 8,
  ];
};
const distance = (a, b) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length);

export function runMusicBenchmark({ enforce = false } = {}) {
  const started = performance.now();
  const styles = {};
  let deterministic = 0;
  const rows = [];

  for (const style of Object.keys(STYLES)) {
    const patterns = new Set();
    const arrangements = new Set();
    const ensembles = new Set();
    const styleRows = [];
    for (const seed of SEEDS) {
      const first = generate(style, seed);
      const second = generate(style, seed);
      if (hash(first) === hash(second)) deterministic++;
      patterns.add(hash(first.pattern));
      arrangements.add(hash(arrangement(first.pattern, seed)));
      ensembles.add([first.params.stab.voice, first.params.acid.voice, first.params.stab.octave].join('/'));
      const row = { style, seed, vector: featureVector(first), projectHash: hash(first) };
      rows.push(row);
      styleRows.push(row);
    }
    styles[style] = {
      ensembles: ensembles.size,
      uniquePatterns: patterns.size,
      uniqueArrangements: arrangements.size,
      uniqueProjects: new Set(styleRows.map((row) => row.projectHash)).size,
    };
  }

  const nearest = [];
  let exactGenreCollisions = 0;
  for (const row of rows) {
    let best = { distance: Infinity, style: null };
    for (const other of rows) {
      if (other.seed !== row.seed || other.style === row.style) continue;
      const d = distance(row.vector, other.vector);
      if (d === 0) exactGenreCollisions++;
      if (d < best.distance) best = { distance: d, style: other.style };
    }
    nearest.push({ style: row.style, seed: row.seed, nearestStyle: best.style, distance: +best.distance.toFixed(6) });
  }
  const distances = nearest.map((row) => row.distance);
  const report = {
    version: 1,
    seeds: SEEDS,
    genres: Object.keys(STYLES).length,
    projects: rows.length,
    durationMs: +(performance.now() - started).toFixed(1),
    determinism: {
      matched: deterministic,
      expected: rows.length,
      rate: +(deterministic / rows.length).toFixed(4),
    },
    diversity: styles,
    genreDistance: {
      p10: +quantile(distances, 0.1).toFixed(6),
      median: +quantile(distances, 0.5).toFixed(6),
      p90: +quantile(distances, 0.9).toFixed(6),
      exactCollisions: exactGenreCollisions / 2,
      closest: [...nearest].sort((a, b) => a.distance - b.distance).slice(0, 10),
    },
    thresholds: THRESHOLDS,
  };

  if (enforce) {
    assert.equal(report.determinism.rate, 1, 'fixed seeds must be deterministic');
    assert.equal(report.genreDistance.exactCollisions, 0, 'different genres must not share an identical synthetic signature');
    assert(report.genreDistance.p10 >= THRESHOLDS.genreDistanceP10, `genre distance p10 ${report.genreDistance.p10} is too low`);
    assert(report.genreDistance.median >= THRESHOLDS.genreDistanceMedian, `genre distance median ${report.genreDistance.median} is too low`);
    for (const [style, result] of Object.entries(styles)) {
      assert(result.ensembles >= THRESHOLDS.ensemblesPerGenre, `${style} needs ${THRESHOLDS.ensemblesPerGenre} instrument ensembles`);
      assert(result.uniquePatterns >= THRESHOLDS.uniquePatternsPerGenre, `${style} repeats too many seed patterns`);
      assert(result.uniqueArrangements >= THRESHOLDS.uniqueArrangementsPerGenre, `${style} repeats too many arrangements`);
      assert.equal(result.uniqueProjects, SEEDS.length, `${style} must produce a distinct project for every benchmark seed`);
    }
  }
  return report;
}

const args = process.argv.slice(2);
const report = runMusicBenchmark({ enforce: args.includes('--assert') });
const jsonAt = args.indexOf('--json');
if (jsonAt >= 0) {
  const output = resolve(args[jsonAt + 1] || 'test/out/music-benchmark.json');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote ${output}`);
}
console.log(`music benchmark passed: ${report.projects} projects, determinism ${(report.determinism.rate * 100).toFixed(0)}%, genre distance p10 ${report.genreDistance.p10}, median ${report.genreDistance.median}`);
