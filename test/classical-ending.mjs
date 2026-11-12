// A classical export ends on a natural decay: in its final 2 s the 100 ms loudness never falls more than 12 dB from
// one window to the next above -60 dBFS (no sample running out mid-ring, no trim fading out an audible tail).
import assert from 'node:assert/strict';
import { withChrome } from './chrome.mjs';
import { REPERTOIRE } from '../js/repertoire.js';

const FLOOR = -60, MAX_DROP = 12;
const jobs = [...['symphony', 'concerto', 'nocturne'].flatMap((st) => [[st, 11], [st, 42]]), ...REPERTOIRE.map((p) => ['repertoire', 11, p.id])];
const t0 = Date.now();
const rows = await withChrome(async (runs) => {
  const out = [];
  let next = 0;
  await Promise.all(runs.map(async (run) => {
    await run(`import('/test/loudness-page.js').then((m) => { window.__m = m; })`);
    while (next < jobs.length) { const [st, seed, piece = ''] = jobs[next++]; out.push(await run(`window.__m.exportEnding(${JSON.stringify(st)}, ${seed}, ${JSON.stringify(piece)})`)); }
  }));
  return out;
}, { pages: 4 });
if (!rows) console.log('classical ending: no Chrome found, skipped');
else {
  const bad = [];
  for (const r of rows) {
    const env = r.env.map((v) => Math.max(v, FLOOR)), last = env.slice(-21);
    let worst = 0, at = 0;
    for (let i = 1; i < last.length; i++) if (last[i - 1] - last[i] > worst) { worst = last[i - 1] - last[i]; at = (last.length - 1 - i) / 10; }
    if (worst > MAX_DROP) bad.push(`${r.piece || `${r.style}/${r.seed}`}: ${worst.toFixed(1)} dB drop in 100 ms, ${at.toFixed(1)} s before the end`);
    assert(r.env.at(-1) < FLOOR, `${r.piece || `${r.style}/${r.seed}`}: the export ends in silence (${r.env.at(-1).toFixed(1)} dBFS)`);
  }
  assert(!bad.length, `classical exports cut off their ending:\n  ${bad.join('\n  ')}`);
  console.log(`classical ending: ${rows.length} exports decay smoothly to the end (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
