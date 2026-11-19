import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { mixFixture, realMixFixture } from './club-sync-mix.mjs';
import { analyzeVocalGrid, vocalFindings } from './club-sync-vocals.mjs';

const paths = process.argv.slice(2);
assert.ok(paths.length, 'Usage: node test/club-sync-vocal-report.mjs test/out/<capture>.json [...]');
const rows = [], clips = [];
for (const path of paths) {
  const capture = JSON.parse(await readFile(path, 'utf8'));
  assert.ok(!capture.error && capture.results.length, `Incomplete capture: ${path}`);
  const mode = capture.options.vocal, song = mode === 'synthetic' ? mixFixture() : realMixFixture();
  for (const result of capture.results) {
    if (!result.spec.mix) continue;
    assert.ok(result.gridReference?.envelope, 'Missing recorded ground truth');
    result.vocalGrid = analyzeVocalGrid(result.raw.captures, song, result.gridReference.envelope,
      result.events, result.events.initial.startsAt, !!result.spec.freezeMs);
    result.vocalFindings = vocalFindings(result.vocalGrid);
    const metrics = result.vocalGrid[1], a = metrics.after;
    const round = n => n == null ? null : Math.round(n * 10) / 10;
    const row = { scenario:result.name, mode, run:result.run,
      before:round(metrics.before.vocalVsKick?.medianMs), after:round(a.vocalVsKick?.medianMs),
      beforeP95:round(metrics.before.vocalVsKick?.p95AbsMs), afterP95:round(a.vocalVsKick?.p95AbsMs),
      gaps:`${a.gaps?.count}/${round(a.gaps?.totalMs)}/${round(a.gaps?.longestMs)}`,
      phrases:`${a.phrases?.missing}/${a.phrases?.displaced}/${a.phrases?.doubled}`, replays:a.phrases?.replays.length,
      vocalRecovery:round(a.recoveryMs), kickRecovery:round(result.mix.timeToRealignMs),
      failures:result.failures.join('; ') || 'none', findings:result.vocalFindings.join('; ') || 'none' };
    rows.push(row); console.log(`vocal summary: ${JSON.stringify(row)}`);
    clips.push(...Object.values(result.clips?.paths || {}).map(p => `test/out/${p}`));
  }
  capture.vocalAnalysis = { version:'kick-relative-recovery-v3', reanalyzedAt:new Date().toISOString(),
    source:'recorded isolated tap envelopes and processed ground-truth stem; no audio regenerated' };
  await writeFile(path, JSON.stringify(capture, null, 2));
}
console.table(rows);
console.log(`Clips (${clips.length}):\n${clips.join('\n')}`);
