import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeMix, mixFixture, mixFailures, vocalSourceEvidence } from './club-sync-mix.mjs';
import { onsets } from './club-sync-audio.mjs';
import { schedulerTapEnvelope } from './club-sync-tap.mjs';

assert.ok(process.argv.length > 2, 'Usage: node test/club-sync-mix-reanalysis.mjs <capture.json> [...]');
for (const path of process.argv.slice(2)) {
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.options.vocal, 'synthetic', 'Reanalysis requires the seed-7 synthetic fixture');
  for (const r of saved.results.filter(r => ['reconnect-mix', 'background-wake-mix'].includes(r.name))) {
    const mix = analyzeMix(r.raw.captures, mixFixture(), r.events, r.events.initial.startsAt,
      {resume:!!r.spec.freezeMs, checkFirstDownbeat:true});
    const failures = mixFailures(mix);
    for (const [i,c] of r.raw.captures.entries()) {
      const counts = vocalSourceEvidence(c, i === 1 && r.spec.freezeMs ? 1 : 0);
      if (!counts.count || counts.count > counts.allowed) failures.push(`client ${i} vocal source starts`);
      if (counts.midPhraseRestarts !== 0) failures.push(`client ${i} mid-phrase vocal restarts`);
      if (counts.unclassifiedStarts !== 0) failures.push(`client ${i} vocal start classification`);
      if (counts.invalidForcedReanchors !== 0) failures.push(`client ${i} invalid forced vocal alignment`);
      if (counts.duplicateForcedReanchors !== 0) failures.push(`client ${i} repeated forced vocal alignment`);
    }
    const host = onsets(schedulerTapEnvelope(r.raw.captures[0], r.events.initial.startsAt, 'kick', {segmented:true}), mixFixture().bpm);
    const gaps = host.slice(1).flatMap((t, i) => host[i] >= r.events.recoverAt - 2000 && t <= r.events.recoverAt + 2000 ? [t - host[i]] : []);
    console.log(JSON.stringify({path, scenario:r.name, run:r.run, failures,
      hostRecoveryGapMs:gaps.length ? Math.max(...gaps) : null,
      realignmentMs:mix.timeToRealignMs, phases:Object.fromEntries(Object.entries(mix.phases).map(([name,p]) =>
        [name, {median:p.kicks.median, p95:p.kicks.p95, missing:p.kicks.missing, extra:p.kicks.extra,
          chromeMedian:p.chromeKicks.median, chromeP95:p.chromeKicks.p95}]))}));
  }
}
