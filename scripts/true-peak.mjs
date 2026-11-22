// True-peak seed sweep: renders whole generated songs of every style through the real offline engine in headless
// Chrome (test/true-peak-page.js) and fails when any of them peaks above the -1 dBTP ceiling (js/loudness.js).
// Seeds per style: SWEEP_SEEDS, past regressions, and the smallest seeds that reach every ensemble in
// INSTRUMENTS[style]. Songs listed in test/true-peak-known.json are known breaches: they may not
// get louder, and an entry that no longer breaches must be removed, so the list only shrinks.
//   node scripts/true-peak.mjs [--assert] [--shard 1/4] [--styles a,b] [--seeds 1,2] [--wide N [--night D]] [--pages N] [--json out.json]
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { withChrome } from '../test/chrome.mjs';
import { STYLES, INSTRUMENTS } from '../js/state.js';
import { rng } from '../js/dsp.js';
import { LOUDNESS_TARGET } from '../js/loudness.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SWEEP_SEEDS = [11, 42, 1234];
// Seeds that once peaked over the ceiling, kept in the sweep after their fix so they cannot regress unseen.
export const REGRESSION_SEEDS = { trap: [211], deephouse: [386387654], euphoric: [2, 11], minimal: [41654, 41655], pop: [41655], rnb: [166325, 166328, 166329, 166330, 166331] };
// Repeat renders match to 0.001 dB; a known breach fails once it is this much louder than recorded.
export const WORSE_DB = 0.1;
export const KNOWN_FILE = join(ROOT, 'test/true-peak-known.json');

// js/state.js generatePattern(): the ensemble is the first draw of its own seeded RNG.
export const ensembleOf = (style, seed) => Math.floor(rng(Math.imul((seed | 0) ^ 0x6d2b79f5, 0x85ebca6b))() * INSTRUMENTS[style].length);

export function sweepSeeds(style, base = SWEEP_SEEDS) {
  const n = INSTRUMENTS[style]?.length || 0, seeds = [...new Set([...base, ...(REGRESSION_SEEDS[style] || [])])];
  const have = new Set(seeds.map((s) => n && ensembleOf(style, s)));
  for (let s = 1; have.size < n && s < 10000; s++) if (!have.has(ensembleOf(style, s))) { have.add(ensembleOf(style, s)); seeds.push(s); }
  return seeds;
}

export const knownSongs = () => JSON.parse(readFileSync(KNOWN_FILE, 'utf8')).songs || {};

// The sweep always re-renders every known breach, so a stale entry is caught even after its seed leaves the sweep.
export function jobs(styles, seeds, known = knownSongs()) {
  return styles.flatMap((style) => {
    const list = seeds || sweepSeeds(style);
    if (!seeds) for (const id of Object.keys(known)) { const [st, sd] = id.split('/'); if (st === style && !list.includes(+sd)) list.push(+sd); }
    return list.map((seed) => [style, seed]);
  });
}

// Nightly wide sweep: n fresh seeds per style each night, rotating through seeds 100+ so every night renders new songs.
// The same night index always gives the same seeds, so a nightly breach reproduces with --wide n --night d.
export const nightOf = (ms = Date.now()) => Math.floor(ms / 86400000);
export const wideSeeds = (n, night = nightOf()) => Array.from({ length: n }, (_, i) => 100 + ((night * n + i) % 1e6));

// Deterministic split for CI: job k of n takes every n-th song after sorting the sweep (spreads long styles).
export const shard = (list, k, n) => list.filter((_, i) => i % n === k - 1);

export function verdict(rows, known = {}, ceiling = LOUDNESS_TARGET.ceiling) {
  const fail = [], knownBad = [], fixed = [];
  for (const r of rows) {
    const id = `${r.style}/${r.seed}`, k = known[id];
    if (r.tp > ceiling) {
      if (k == null) fail.push(`${id}: ${r.tp.toFixed(2)} dBTP at bar ${r.bar + 1} (${r.at} s, section ${r.section ?? '-'}) is over the ${ceiling} dBTP ceiling`);
      else if (r.tp > k.tp + WORSE_DB) fail.push(`${id}: known breach got louder, ${r.tp.toFixed(2)} dBTP vs ${k.tp} recorded (+${WORSE_DB} dB allowed)`);
      else knownBad.push(`${id}: ${r.tp.toFixed(2)} dBTP (known, recorded ${k.tp})`);
    } else if (k != null) fixed.push(`${id}: now ${r.tp.toFixed(2)} dBTP, under the ceiling: remove it from test/true-peak-known.json`);
  }
  return { ok: !fail.length && !fixed.length, fail, knownBad, fixed };
}

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);

async function main() {
  const styles = arg('styles') ? arg('styles').split(',') : Object.keys(STYLES), seeds = arg('seeds') ? arg('seeds').split(',').map(Number) : null;
  const wide = +arg('wide', 0), night = +arg('night', nightOf());
  const all = wide ? styles.flatMap((style) => wideSeeds(wide, night).map((seed) => [style, seed])) : jobs(styles, seeds);
  const [k, n] = (arg('shard', '1/1')).split('/').map(Number), list = shard(all, k, n);
  if (wide) console.log(`wide sweep: night ${night}, ${wide} seeds per style (${wideSeeds(wide, night)[0]}…${wideSeeds(wide, night).at(-1)}); reproduce with --wide ${wide} --night ${night}`);
  const pages = +arg('pages', Math.max(1, Math.min(8, cpus().length))), t0 = Date.now(), quiet = flag('quiet');
  // CI runners occasionally fail to launch headless Chrome; a launch failure renders nothing, so it is safe to retry.
  const launch = async (f, o, tries = 3) => { try { return await withChrome(f, o); } catch (e) { if (tries > 1 && /Chrome did not start/.test(e.message)) { console.log('true peak: Chrome did not start, retrying'); return launch(f, o, tries - 1); } throw e; } };
  const rows = await launch(async (runs) => {
    const out = [];
    let next = 0;
    await Promise.all((Array.isArray(runs) ? runs : [runs]).map(async (run) => {
      await run(`import('/test/true-peak-page.js').then((m) => { window.__t = m; })`);
      while (next < list.length) {
        const [style, seed] = list[next++], r = await run(`window.__t.songPeak(${JSON.stringify(style)}, ${seed})`);
        out.push(r);
        if (!quiet) process.stderr.write(`${style}/${seed}: ${r.tp.toFixed(2)} dBTP bar ${r.bar + 1} ${r.section ?? ''} (${(r.renderMs / 1000).toFixed(0)} s, ${out.length}/${list.length})\n`);
      }
    }));
    return out;
  }, { pages });
  if (!rows) { console.log('true peak: no Chrome found, skipped'); if (flag('assert')) process.exit(1); return; }
  rows.sort((a, b) => b.tp - a.tp);
  const known = JSON.parse(readFileSync(KNOWN_FILE, 'utf8')).songs || {};
  const v = verdict(rows, known), wall = Math.round((Date.now() - t0) / 1000);
  const json = arg('json', join(ROOT, `test/out/true-peak${n > 1 ? `-${k}of${n}` : ''}.json`));
  mkdirSync(dirname(json), { recursive: true });
  writeFileSync(json, JSON.stringify({ schema: 'untergrund.true-peak/1', ceiling: LOUDNESS_TARGET.ceiling, shard: `${k}/${n}`, wallSec: wall, pages, rows, ...v }, null, 1) + '\n');
  console.log(`hottest: ${rows.slice(0, 8).map((r) => `${r.style}/${r.seed} ${r.tp.toFixed(2)}`).join(', ')}`);
  for (const line of [...v.knownBad, ...v.fixed, ...v.fail]) console.log(`  ${line}`);
  console.log(`true peak (shard ${k}/${n}): ${v.ok ? 'PASS' : 'FAIL'} · ${rows.length} songs · ${new Set(rows.map((r) => r.style)).size} styles · ceiling ${LOUDNESS_TARGET.ceiling} dBTP · worst ${rows[0]?.tp.toFixed(2)} dBTP · ${wall} s · ${json}`);
  if (flag('assert') && !v.ok) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
