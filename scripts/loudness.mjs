// Per-genre loudness table: renders N fixed seeds of every style as full songs with the real offline engine in
// headless Chrome and meters the master output (BS.1770 integrated LUFS, 4x true peak, limiter gain reduction).
//   node scripts/loudness.mjs [--seeds 3] [--styles a,b] [--bars 0] [--pages 4] [--json out.json] [--write]
//   node scripts/loudness.mjs --pieces [--write]   each REPERTOIRE score once, whole, against PIECE_TRIM_DB
// --write records the table plus the fast-check windows in test/loudness-baseline.json (read by test/loudness.mjs).
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { withChrome } from '../test/chrome.mjs';
import { STYLES } from '../js/state.js';
import { LOUDNESS_TARGET, targetFor, MAKEUP_DB, PIECE_TRIM_DB } from '../js/loudness.js';
import { REPERTOIRE } from '../js/repertoire.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const nSeeds = +arg('seeds', 3), bars = +arg('bars', 0), pages = +arg('pages', 4), json = arg('json', '');
const styles = arg('styles', '') ? arg('styles').split(',') : Object.keys(STYLES);
export const SEEDS = [11, 42, 77, 1234, 2024, 31337, 9001, 555].slice(0, nSeeds);

const baseFile = new URL('../test/loudness-baseline.json', import.meta.url);
if (process.argv.includes('--pieces')) await pieces();

async function pieces() {
  const ids = REPERTOIRE.map((p) => p.id), t = targetFor('repertoire'), t0 = Date.now(), win = {};
  const rows = await withChrome(async (runs) => {
    const out = [];
    let next = 0;
    await Promise.all(runs.map(async (run) => {
      await run(`import('/test/loudness-page.js').then((m) => { window.__m = m; })`);
      while (next < ids.length) {
        const id = ids[next++], r = await run(`window.__m.measure('repertoire', 11, { piece: ${JSON.stringify(id)} })`);
        win[id] = await run(`window.__m.pieceWindow(${JSON.stringify(id)})`);
        out.push(r);
        process.stderr.write(`${id}: ${r.lufs.toFixed(2)} LUFS ${r.tp.toFixed(1)} dBTP (${out.length}/${ids.length})\n`);
      }
    }));
    return out;
  }, { pages });
  if (!rows) { console.log('loudness: no Chrome found'); process.exit(0); }
  rows.sort((a, b) => ids.indexOf(a.piece) - ids.indexOf(b.piece));
  console.log(`REPERTOIRE pieces, whole scores · target ${t} LUFS · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log('piece                          trim    LUFS   vs target  dBTP   GR 1%  -> trim');
  const fit = {};
  for (const r of rows) {
    const trim = PIECE_TRIM_DB[r.piece] || 0;
    fit[r.piece] = +(trim + t - r.lufs).toFixed(1);
    console.log(`${r.piece.padEnd(30)} ${trim.toFixed(1).padStart(5)}  ${r.lufs.toFixed(2)}  ${(r.lufs - t).toFixed(2).padStart(6)}   ${r.tp.toFixed(2)}  ${r.grDeep.toFixed(1).padStart(5)}  ${fit[r.piece].toFixed(1).padStart(5)}`);
  }
  const dev = rows.map((r) => Math.abs(r.lufs - t));
  console.log(`worst |LUFS - target| ${Math.max(...dev).toFixed(2)} LU · worst true peak ${Math.max(...rows.map((r) => r.tp)).toFixed(2)} dBTP`);
  console.log(`fitted PIECE_TRIM_DB = ${JSON.stringify(fit)}`);
  if (process.argv.includes('--write')) {
    const prev = JSON.parse(readFileSync(baseFile, 'utf8'));
    prev.pieces = Object.fromEntries(rows.map((r) => [r.piece, { trim: PIECE_TRIM_DB[r.piece] || 0, lufs: +r.lufs.toFixed(2), tp: +r.tp.toFixed(2), window: +win[r.piece].toFixed(2) }]));
    writeFileSync(baseFile, JSON.stringify(prev, null, 1) + '\n');
    console.log('wrote pieces to test/loudness-baseline.json');
  }
  process.exit(0);
}

const jobs = styles.flatMap((style) => SEEDS.map((seed) => [style, seed]));
const t0 = Date.now(), write = process.argv.includes('--write'), windows = {};
const rows = await withChrome(async (runs) => {
  const out = [];
  let next = 0;
  await Promise.all(runs.map(async (run) => {
    await run(`import('/test/loudness-page.js').then((m) => { window.__m = m; })`);
    while (next < jobs.length) {
      const [style, seed] = jobs[next++];
      const r = await run(`window.__m.measure(${JSON.stringify(style)}, ${seed}, { bars: ${bars} })`);
      out.push(r);
      process.stderr.write(`${style}/${seed}: ${r.lufs.toFixed(1)} LUFS ${r.tp.toFixed(1)} dBTP (${out.length}/${jobs.length})\n`);
    }
    if (write) for (const style of styles) if (!(style in windows)) { windows[style] = null; windows[style] = await run(`window.__m.windowLoudness(${JSON.stringify(style)})`); }
  }));
  return out;
}, { pages });
if (!rows) { console.log('loudness: no Chrome found'); process.exit(0); }

const f = (v, d = 1) => (v >= 0 ? ' ' : '') + v.toFixed(d);
console.log(`target ${LOUDNESS_TARGET.club} LUFS (club) / ${LOUDNESS_TARGET.quiet} (quiet) / ${LOUDNESS_TARGET.classical} (classical), ceiling ${LOUDNESS_TARGET.ceiling} dBTP · ${SEEDS.length} seeds · ${bars || 'full'} bars · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log('style        target  makeup   mean LUFS  spread  vs target  max dBTP  GR mean  GR 1%  GR 10ms jump (p99)');
const table = [];
for (const style of styles) {
  const rs = rows.filter((r) => r.style === style), l = rs.map((r) => r.lufs);
  const mean = l.reduce((a, v) => a + v, 0) / l.length, t = targetFor(style);
  const row = { style, target: t, makeup: MAKEUP_DB[style] || 0, mean, min: Math.min(...l), max: Math.max(...l), tp: Math.max(...rs.map((r) => r.tp)),
    grMean: rs.reduce((a, r) => a + r.grMean, 0) / rs.length, grDeep: Math.min(...rs.map((r) => r.grDeep)), grJump: Math.max(...rs.map((r) => r.grJump)), seeds: rs.map((r) => [r.seed, +r.lufs.toFixed(2), +r.tp.toFixed(2)]) };
  table.push(row);
  console.log(`${style.padEnd(12)} ${f(t)}  ${f(row.makeup)}    ${f(mean, 2)}   ${(row.max - row.min).toFixed(2)}    ${f(mean - t, 2)}     ${f(row.tp, 2)}    ${f(row.grMean)}    ${f(row.grDeep)}    ${row.grJump.toFixed(2)}`);
}
const dev = table.map((r) => Math.abs(r.mean - r.target));
console.log(`worst |mean - target| ${Math.max(...dev).toFixed(2)} LU · worst true peak ${Math.max(...table.map((r) => r.tp)).toFixed(2)} dBTP`);
if (write) {
  const file = baseFile;
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { styles: {} };
  for (const r of table) prev.styles[r.style] = { lufs: +r.mean.toFixed(2), spread: +(r.max - r.min).toFixed(2), tp: +r.tp.toFixed(2), window: +windows[r.style].toFixed(2) };
  prev.seeds = SEEDS; prev.note = 'node scripts/loudness.mjs --write: full-song integrated LUFS (mean over seeds), max dBTP, and the fast-check window LUFS';
  writeFileSync(file, JSON.stringify(prev, null, 1) + '\n');
  console.log('wrote test/loudness-baseline.json');
}
if (json) { mkdirSync(dirname(json), { recursive: true }); writeFileSync(json, JSON.stringify({ seeds: SEEDS, bars, table }, null, 1)); }
