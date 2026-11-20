import assert from 'node:assert/strict';
import {withChrome} from './chrome.mjs';

const result = await withChrome(async run => run(`(async()=>{
  const {rubatoVocalFixture} = await import('/test/rubato-vocal-fixture.mjs');
  return Promise.all(['ukg','euphoric'].flatMap(style=>[0,.028].map(residual=>rubatoVocalFixture({style,residual}))));
})()`));
for (const r of result || []) {
  assert.equal(r.measurements.length, 192);
  assert.equal(r.sourceStarts[0].when, 1 + r.residualMs / 1000, 'the offset is injected into the stem, not reset by the room startup grid');
  if (r.residualMs) assert.ok(r.measurements[1].vocalMinusKickMs > 25, 'the +28ms fixture really begins behind the kick');
  else assert.ok(Math.abs(r.measurements[1].vocalMinusKickMs) < 1e-6);
  assert.equal(r.durationOnlyRestarts, 0, 'rubato duration alone cannot replace the stem');
  assert.equal(r.restarts, r.hardReanchors.length, 'only the existing hard path can replace these sources');
  assert.ok(r.hardReanchors.every(c => !c.forced), 'rubato only re-anchors inside verified quiet gaps');
  const requests = r.calls.filter(c => c.reanchor && !c.pending);
  assert.ok(requests.every(c => Math.abs(c.errorMs) > 30), 'rubato re-anchor requests wait for more than 30 ms of drift');
  assert.ok(requests.some(c => Math.abs(c.errorMs) < 50), 'rubato asks for a quiet gap before reaching the constant-tempo gate');
  assert.ok(r.peakCents <= Math.abs(1200 * Math.log2(.992)) + 1e-8);
  assert.ok(r.maxRampAdjacentCents <= r.centsLimit + 1e-8, 'appended ramps retain the existing relative cents limit');
  assert.ok(r.sourceStarts.some(s => s.events.some(e => e.name === 'linearRampToValueAtTime')), 'rubato reaches real appended playbackRate ramps');
  if (r.style === 'ukg') {
    assert.ok(r.maxVocalMinusKickMs < 50, 'earlier quiet gaps keep UKG under 50 ms throughout');
  } else {
    let over = 0;
    for (let i = 1; i < r.measurements.length; i++) {
      const before = r.measurements[i - 1];
      over = Math.abs(before.vocalMinusKickMs ?? 0) > 50 ? over + r.measurements[i].kick - before.kick : 0;
      assert.ok(over < 2.5, 'even the sparse euphoric gaps cannot leave drift over 50 ms for 2.5 seconds');
    }
  }
}
if (result) console.log('Rubato scheduler PASS: real schedule() and Engine, both styles at 0/+28 ms, earlier gap alignment and the original rate cap.');
