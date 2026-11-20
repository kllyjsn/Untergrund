import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { transportResync } from '../js/room-sync.js';

const cents = rate => 1200 * Math.log2(rate);
const change = rates => Math.max(...rates.slice(1).map((rate, i) => Math.abs(cents(rate / rates[i]))));
const fixture = JSON.parse(readFileSync(new URL('./room-slew-fresh.json', import.meta.url)));
for (const [d, error, hash] of fixture.cases) {
  const fix = transportResync(100 + error, 100, 0, d, false, -Infinity, 1, true);
  assert.equal(createHash('sha256').update(JSON.stringify(fix.profile.rates)).digest('hex'), hash);
}
console.log(`Room fresh identity PASS: ${fixture.cases.length} byte-identical profiles from ${fixture.source.slice(0, 7)}, both signs, 40–240 BPM and rubato.`);

const limits = new Map(), interruptions = [], times = [];
let count = 0, seed = 0x293271, inherited = 0;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
function limit(d) {
  if (!limits.has(d)) limits.set(d, Math.max(...[-.03, .03].map(error =>
    change(transportResync(error, 0, -100, d, false, -Infinity, 1, true).profile.rates))));
  return limits.get(d);
}
function run(d, startRate, error, previous = null, rubato = false) {
  const input = {stepSec:d, startRate, errorMs:error * 1000, inherited:!!previous, rubato};
  let rate = startRate, next = 100, target = next + error, profile = previous, wall = 0, hard = false;
  for (let step = 0; step < 1024; step++) {
    if (Math.abs(target - next) < 1e-9 && rate === 1) {
      count++; times.push({ ...input, seconds:wall, hard }); return;
    }
    const sd = rubato && step < 8 ? d * (.8 + random() * .4) : d;
    const fix = transportResync(target, next, 0, sd, false, -Infinity, rate, true, profile);
    assert.ok(fix && Number.isFinite(fix.nextTime), JSON.stringify(input));
    if (!fix.slew) {
      assert.ok(Math.abs(target - next) > .05);
      interruptions.push({...input, step, interruptionMs:(target - next) * 1000});
      hard = true; rate = 1; profile = null;
    } else {
      const duration = sd + fix.nextTime - next;
      assert.equal(fix.rate, rate);
      assert.ok(Math.abs(fix.endRate - 1) <= .008 + 1e-12);
      assert.ok(Math.abs(duration * (rate + fix.endRate) / 2 - sd) < 1e-10);
      if (fix.profile?.index === 1 && rate !== 1) {
        assert.ok(change(fix.profile.rates.slice(1)) <= limit(sd) + 1e-9, JSON.stringify(input));
        const prior = profile?.rates[profile.index - 1];
        if (prior !== undefined && profile.rates[profile.index] === rate) {
          const before = (rate - prior) * (rate + prior) / (2 * profile.stepSec);
          const after = (fix.endRate - rate) / duration;
          assert.ok(Math.abs(after - before) < 1e-10, JSON.stringify({...input, before, after}));
          inherited++;
        } else assert.equal(fix.endRate, rate, 'a previously constant rate starts with zero slope');
        const phase = fix.profile.rates.slice(1).reduce((sum, value, i) =>
          sum + 2 * sd / (fix.profile.rates[i] + value) - sd, 0);
        assert.ok(Math.abs(phase - (target - next)) < 1e-9, JSON.stringify(input));
      } else if (step > 0) assert.ok(Math.abs(cents(fix.endRate / rate)) <= limit(sd) + 1e-9, JSON.stringify(input));
      wall += duration;
      rate = fix.endRate; profile = fix.profile;
    }
    next = fix.nextTime + sd; target += sd;
  }
  assert.fail(JSON.stringify({...input, rate, residualMs:(target - next) * 1000}));
}
for (const d of [15 / 240, 15 / 180, 15 / 123, 15 / 80, 15 / 40, .7, .75])
  for (const rate of [.992, .996, 1, 1.004, 1.008])
    for (const error of [-.030, -.020, -.005, -.001, .001, .005, .020, .030]) run(d, rate, error);
for (let i = 0; i < 1000; i++) {
  const d = 15 / (40 + random() * 200) * (.5 + random() * 1.5);
  run(d, .992 + random() * .016, (random() < .5 ? -1 : 1) * (.001 + random() * .029), null, i % 3 === 0);
}
for (let i = 0; i < 300; i++) {
  const d = 15 / (40 + random() * 200);
  const fresh = transportResync(100 + (random() < .5 ? -.028 : .028), 100, 0, d, false, -Infinity, 1, true).profile;
  const index = 1 + Math.floor(random() * (fresh.rates.length - 2));
  run(d, fresh.rates[index], (random() < .5 ? -1 : 1) * (.001 + random() * .029), {...fresh, index});
}
const regions = {};
for (const r of interruptions) {
  const key = `${r.stepSec >= .375 ? 'slow/rubato' : 'normal/fast'} ${Math.abs(r.startRate - 1) >= .006 ? 'near-cap' : 'partial-rate'} ${(r.startRate - 1) * r.errorMs > 0 ? 'wrong-way' : 'right-way'}`;
  regions[key] = (regions[key] ?? 0) + 1;
}
const soft = times.filter(r => !r.hard);
console.log(`Room retarget sweep PASS: ${count} cases; termination, exact phase/unity or existing hard adoption, relative cents bound and ${inherited} inherited-slope checks.`);
console.log('Room retarget hard-path report: ' + JSON.stringify({cases:count, interrupted:interruptions.length, regions,
  smallestAbsRate:Math.min(...interruptions.map(r => Math.abs(r.startRate - 1))), smallestAbsResidualMs:Math.min(...interruptions.map(r => Math.abs(r.errorMs))),
  stepSecRange:[Math.min(...interruptions.map(r => r.stepSec)), Math.max(...interruptions.map(r => r.stepSec))],
  maxSoftConvergenceSeconds:Math.max(...soft.map(r => r.seconds))}));
if (process.env.CLUB_RETARGET_EVIDENCE) {
  writeFileSync(process.env.CLUB_RETARGET_EVIDENCE, JSON.stringify({count, inherited, interruptions, regions, times}, null, 2));
}
