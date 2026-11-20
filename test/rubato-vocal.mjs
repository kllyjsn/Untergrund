import assert from 'node:assert/strict';
import {withChrome} from './chrome.mjs';

const result = await withChrome(async run => run(`(async()=>{
  const {rubatoVocalFixture} = await import('/test/rubato-vocal-fixture.mjs');
  return Promise.all([0,.028].map(residual=>rubatoVocalFixture({residual})));
})()`));
for (const r of result || []) {
  assert.equal(r.measurements.length, 192);
  assert.equal(r.sourceStarts[0].when, 1 + r.residualMs / 1000, 'the offset is injected into the stem, not reset by the room startup grid');
  if (r.residualMs) assert.ok(r.measurements[1].vocalMinusKickMs > 25, 'the +28ms fixture really begins behind the kick');
  else assert.ok(Math.abs(r.measurements[1].vocalMinusKickMs) < 1e-6);
  assert.equal(r.durationOnlyRestarts, 0, 'rubato duration alone cannot replace the stem');
  assert.equal(r.restarts, r.hardReanchors.length, 'only the existing hard path can replace these sources');
  assert.ok(r.calls.filter(c => c.reanchor && !c.pending).every(c => Math.abs(c.errorMs) > 50), 'new hard requests retain the current gate; already-pending corrections keep the existing completion policy');
  assert.ok(r.peakCents <= Math.abs(1200 * Math.log2(.992)) + 1e-8);
  assert.ok(r.maxRampAdjacentCents <= r.centsLimit + 1e-8, 'appended ramps retain the existing relative cents limit');
  assert.ok(r.calls.some(c => c.reanchor), 'large residuals still dispatch the existing hard controller');
  assert.ok(r.sourceStarts.some(s => s.events.some(e => e.name === 'linearRampToValueAtTime')), 'rubato reaches real appended playbackRate ramps');
}
if (result) console.log(`Rubato scheduler PASS: real schedule(), real Engine, 12 bars x 2 residuals; zero duration-only restarts, bounded appended rates and hard dispatch preserved. Restarts: ${result.map(r=>r.restarts).join('/')}.`);
