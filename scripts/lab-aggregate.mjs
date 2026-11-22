import { readFile, writeFile } from 'node:fs/promises';
import { aggregateRatings, validateBenchmark } from '../js/lab-metrics.js';

try {
  const args = process.argv.slice(2), paths = [];
  let manifest, out;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--manifest' || args[i] === '--out') {
      const option = args[i], value = args[++i];
      if (!value) throw new Error(`Missing value for ${option}`);
      if (option === '--out') out = value;
      else manifest = validateBenchmark(JSON.parse(await readFile(value, 'utf8')));
    } else if (args[i].startsWith('--')) throw new Error(`Unknown option: ${args[i]}`);
    else paths.push(args[i]);
  }
  if (!paths.length) throw new Error('Usage: node scripts/lab-aggregate.mjs results/*.json [--manifest m.json] [--out file]');
  const exports = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
  const ids = new Set(exports.map((ex) => ex.benchmarkId));
  if (ids.size !== 1 || !exports[0].benchmarkId) throw new Error('Exports must belong to one benchmark');
  const report = { benchmarkId: exports[0].benchmarkId, ...aggregateRatings(exports, manifest || {}) };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (out) await writeFile(out, json);
  else process.stdout.write(json);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
