import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { createRoomClock, roomTransportPosition, shiftRoomSet, syncAudioClock, transportResync, calibrateRoomClock, slewTransport, roomTransportCorrection } from '../js/room-sync.js';
import { freshSong, clone, sanitize, STYLES } from '../js/state.js';
import { songFingerprint } from '../js/listen.js';
import { createRoomMediaSync, roomMediaLead, roomMediaTime } from '../js/room-media-sync.js';
import { createClockSender } from '../js/midi-core.js';
import { Sequencer } from '../js/engine.js';
import { Recorder } from '../js/midi.js';

const origin = 1_000_000;
const close = (a, b) => assert(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

{
  let now = 100;
  const host = createRoomClock({ wall: () => origin + now - 1500, monotonic: () => now });
  const guest = createRoomClock({ wall: () => origin + now + 2000, monotonic: () => now });
  assert.equal(host.shift(), 0, 'offline and older room servers keep local timestamps');
  for (const clock of [host, guest]) {
    clock.observe([origin + 110, origin + 210], 100, 220);
    clock.observe([origin + 600, origin + 610], 500, 625);
    clock.observe([origin + 700, origin + 710], 720, 715);
  }
  now = 800;
  assert.equal(host.shift(), 1500);
  assert.equal(guest.shift(), -2000);
  const hostSet = { startsAt: origin + now - 1500 + 1600, orderAt: origin + now - 1500, bpm: 120 };
  const wire = shiftRoomSet(hostSet, host.shift());
  const listenerSet = shiftRoomSet(wire, -guest.shift());
  for (const elapsed of [200, 1400, 2300, 4860]) {
    const djNow = hostSet.orderAt + elapsed;
    const guestNow = listenerSet.orderAt + elapsed;
    assert.deepEqual(roomTransportPosition(hostSet.startsAt, 120, djNow), roomTransportPosition(listenerSet.startsAt, 120, guestNow));
  }
  assert.equal(shiftRoomSet(hostSet, 0), hostSet, 'local BroadcastChannel path does not translate timestamps');
}

{
  const clock = createRoomClock({ wall: () => origin + 2000 + 200, monotonic: () => 200 });
  assert.equal(clock.observe([origin + 101, origin + 103], 100, 162), 60);
  assert.equal(clock.shift(), -2029, 'cold response with asymmetric delay biases the first offset');
  assert.equal(clock.observe([origin + 165, origin + 165], 163, 167), 4);
  assert.equal(clock.shift(), -2000, 'warm sample removes the startup bias before a set is adopted');
  assert.equal(clock.observe([origin + 171, origin + 171], 170, 200), 30);
  assert.equal(clock.shift(), -2000, 'a slower response does not replace the warm sample');
}

assert.deepEqual(roomTransportPosition(origin + 1600, 120, origin), { step: 0, delay: 1.6 });

{
  const clock = createRoomClock({wall:() => origin, monotonic:() => 0});
  const observe = (from, latency, offset) => clock.observe([origin + from + latency / 2 + offset, origin + from + latency / 2 + offset], from, from + latency);
  observe(0, 4, 0);
  observe(20000, 20, 100);
  observe(31000, 100, 500);
  assert.equal(clock.shift(), 0, 'ageing past 30s cannot replace a fast sample with an outlier');
  observe(61000, 200, 999);
  assert.equal(clock.shift(), 100, 'expiration selects the fastest remaining sample, not the newest outlier');
  for (let i = 1; i <= 16; i++) observe(62000 + i * 100, 30, i);
  assert.equal(clock.shift(), 1, 'the window retains at most sixteen observations');
  clock.observe([NaN, origin], 1, 2);
  assert.equal(clock.shift(), 1, 'invalid samples cannot corrupt the window');
}

{
  let now = 0;
  const calls = [];
  const initial = {snapshot:{sessionToken:'cold'}, latency:330};
  const result = await calibrateRoomClock(initial, async (token, timeout) => {
    calls.push({token, timeout});
    const latency = [320, 290, 18][calls.length - 1];
    assert(timeout >= latency, 'warm probes use latency-scaled rather than 250ms timeouts');
    now += latency;
    return {snapshot:{sessionToken:`warm${calls.length}`}, latency};
  }, () => now);
  assert.equal(result.sessionToken, 'warm3');
  assert.equal(calls.length, 3, 'a fast sample stops calibration early');
  assert.equal(calls[1].token, 'warm1');
  assert(now <= 1500);
  assert.equal(await calibrateRoomClock({...initial, latency:2}, () => assert.fail('fast joins do not need extra probes')), initial.snapshot);
  now = 0;
  assert.equal(await calibrateRoomClock(initial, async (_, timeout) => {
    now += timeout;
    throw new Error('timeout');
  }, () => now), initial.snapshot, 'failed probes preserve the initial snapshot');
  assert(now <= 1500, 'calibration has a bounded total deadline');
  let empty = 0;
  assert.equal(await calibrateRoomClock(initial, async () => { empty++; return null; }, () => 0), initial.snapshot);
  assert.equal(empty, 4, 'empty responses cannot cause unlimited probes');
}

{
  close(slewTransport(10.02, 10), 10.0015);
  close(slewTransport(9.98, 10), 9.9985);
  assert.equal(slewTransport(10, 10), 10);
  assert.equal(slewTransport(10.2, 10), 10, 'large corrections remain transportResync work');
  let at = 10;
  for (let i = 0; i < 20; i++) at = slewTransport(10.02, at);
  close(at, 10.02);
  assert.equal(roomTransportCorrection(9.951, 10, 9.5, 0.125), null, 'ordinary errors retain the bounded slew');
  assert.deepEqual(roomTransportCorrection(11.25, 11.5, 11.2, 0.125), {drainUntil:11.5});
  assert.deepEqual(roomTransportCorrection(11.26, 11.5, 11.49, 0.125, 11.5), {drainUntil:11.5}, 'clock updates do not extend the stopped queue');
  const adopted = roomTransportCorrection(11.25, 11.5, 11.5, 0.125, 11.5);
  assert.equal(adopted.skip, 2);
  close(adopted.nextTime, 11.5);
  assert.equal(adopted.adopted, true);
  const forward = roomTransportCorrection(11.75, 11.5, 11.5, 0.125, 11.5);
  assert.equal(forward.skip, 0);
  close(forward.nextTime, 11.75);
}

{
  const source = await readFile(new URL('../js/club.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export class RoomBus'), source.indexOf('\nlet parkedBus')).replace('export class', 'class');
  const RoomBus = runInNewContext(`${body}\nRoomBus`, {shiftRoomSet, normalizeMember:x => x,
    sessionStorage:{setItem(){}}, Date});
  for (const clientId of ['host', 'listener']) {
    let shift = -200;
    const corrections = [], events = [];
    const set = {broadcastId:'live', startsAt:origin, version:1};
    const bus = Object.assign(Object.create(RoomBus.prototype), {clientId, user:{}, members:new Map(), seq:0,
      roomClock:{shift:() => shift}, currentSet:{...set, startsAt:origin + 200}, currentSetKey:'server:1',
      serverOrigin:{broadcastId:'live', startsAt:origin}, hostId:'host', appliedBroadcasts:new Set(['live']),
      initiatedSets:new Set(), onClock:value => corrections.push(value), onEvent:value => events.push(value), emit(){}});
    bus.applySnapshot({currentSet:set, hostId:'host'});
    assert.equal(corrections.length, 0);
    shift = -20;
    bus.applySnapshot({currentSet:set, hostId:'host'});
    assert.equal(bus.currentSet.startsAt, origin + 20);
    assert.equal(corrections.length, 1, `${clientId} is notified despite same-version dedupe`);
    assert.equal(corrections[0].previousStartsAt, origin + 200, 'clock notifications carry a delta independent of live tempo edits');
    assert.equal(events.length, 0, 'clock correction does not rebroadcast or replay the set');
    shift = 0;
    bus.applySnapshot({hostId:'host'});
    assert.equal(bus.currentSet.startsAt, origin, 'omitted known-set bodies still allow re-anchoring');
    assert.equal(corrections.length, 2);
    shift = 1;
    bus.applySnapshot({hostId:'host'});
    assert.equal(corrections.length, 2, 'sub-threshold jitter is ignored');
    bus.serverOrigin.broadcastId = 'old';
    shift = 100;
    bus.applySnapshot({hostId:'host'});
    assert.equal(corrections.length, 2, 'another broadcast cannot move the current grid');
  }
}
{
  const source = await readFile(new URL('../js/club.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export class RoomBus'), source.indexOf('\nlet parkedBus')).replace('export class', 'class');
  for (const mode of ['warm', 'error', 'closed', 'empty', 'fast']) {
    let requests = 0, release;
    const snapshots = [], latencies = [];
    const reply = name => ({ok:true, json:async () => ({name, clock:[], sessionToken:name})});
    const RoomBus = runInNewContext(`${body}\nRoomBus`, {Date, AbortController, setTimeout, clearTimeout,
      calibrateRoomClock, performance:{now:() => 0}, fetch:async () => {
        requests++;
        if (requests === 1) return mode === 'empty' ? {ok:false} : reply('initial');
        if (requests === 2) return new Promise((resolve, reject) => { release = () => mode === 'error' ? reject(new Error('offline')) : resolve(reply('warm')); });
        throw new Error('offline');
      }});
    const bus = Object.assign(Object.create(RoomBus.prototype), {clientId:'listener', user:{}, token:'', apiBase:'/remote',
      endpoint:path => path, known:() => ({}), receive(){}, applySnapshot:s => snapshots.push(s.name),
      roomClock:{observe:() => { const latency = mode === 'fast' || latencies.length ? 5 : 330; latencies.push(latency); return latency; }}});
    await bus.heartbeat(true);
    assert.deepEqual(snapshots, mode === 'empty' ? [] : ['initial'], `${mode}: ready adopts the first estimate without waiting for warm calibration`);
    if (mode === 'fast' || mode === 'empty') {
      assert.equal(requests, 1, `${mode}: no unnecessary calibration traffic`);
    } else {
      assert.equal(requests, 2, 'warm calibration can remain in flight while playback starts');
      if (mode === 'closed') bus.closed = true;
      release();
    }
    await bus.calibration;
    assert.deepEqual(snapshots, mode === 'warm' ? ['initial', 'warm'] : mode === 'empty' ? [] : ['initial'],
      `${mode}: later samples update the playing origin, but failures or a closed room cannot replace it`);
    if (mode === 'warm') assert.deepEqual(latencies, [330, 5]);
  }
}
console.log('Room join latency PASS: first estimate starts playback while bounded warm calibration runs; fast, empty, failed and closed-room probes are safe.');
console.log('Room clock calibration PASS: bounded recent minimum, adaptive probes, same-broadcast host/listener re-anchor and per-step slew.');

{
  const source = await readFile(new URL('../js/club.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('bus.onClock = '), source.indexOf('\n    bus.onPlaybackUnavailable'));
  const calls = [], pending = {broadcastId:'live', startsAt:origin + 200, state:{bpm:123}};
  const sandbox = {bus:{}, clockBus:{jamFollow:'live'}, pendingSet:pending,
    getTransport:() => ({playing:false}), reanchorRoomSet:(...args) => calls.push(args)};
  runInNewContext(handler, sandbox);
  sandbox.bus.onClock({broadcastId:'live', startsAt:origin + 20, previousStartsAt:origin + 200});
  assert.equal(sandbox.pendingSet.startsAt, origin + 20, 'calibration updates the set Listen Live will prefer before unlock');
  assert.equal(sandbox.pendingSet.state, pending.state);
  assert.equal(calls.length, 0, 'a pending join does not start or reanchor audio');
  sandbox.bus.onClock({broadcastId:'other', startsAt:origin - 100});
  assert.equal(sandbox.pendingSet.startsAt, origin + 20);
  sandbox.pendingSet = null;
  sandbox.getTransport = () => ({playing:true});
  sandbox.bus.onClock({broadcastId:'live', startsAt:origin, previousStartsAt:origin + 20});
  assert.deepEqual(calls, [[origin, origin + 20]], 'playing rooms receive the clock delta');
}

let pos = roomTransportPosition(origin, 120, origin + 1500);
assert.equal(pos.step, 13);
close(pos.delay, 0.125);

pos = roomTransportPosition(origin, 120, origin + 1562.5);
assert.equal(pos.step, 13);
close(pos.delay, 0.0625);

for (const bpm of [122, 138, 150]) {
  for (const elapsed of [10000, 33333, 61234.5]) {
    const now = origin + elapsed;
    const { step, delay } = roomTransportPosition(origin, bpm, now);
    const boundary = origin + step * (15000 / bpm);
    assert(Math.abs(now + delay * 1000 - boundary) < 0.001);
    assert(delay > 0 && delay <= 15 / bpm + 1e-9);
  }
}

assert.equal(transportResync(10.01, 10, 9.9, 0.125), null);
assert.deepEqual(transportResync(10.2, 10, 9.9, 0.125), { skip: 0, nextTime: 10.2, discard: false });
assert.deepEqual(transportResync(9.5, 10, 9.9, 0.125), { skip: 4, nextTime: 10, discard: false });
assert.deepEqual(transportResync(9.0, 9.0, 9.6, 0.125), { skip: 5, nextTime: 9.625, discard: false });

for (const bpm of [40, 80, 123, 180, 240]) for (const residual of [-0.030, -0.028, 0.028, 0.030]) {
  const stepSec = 15 / bpm;
  let target = 10, nextTime = target + residual, steps = 0, rate = 1;
  while (Math.abs(nextTime - target) > 0.002 + 1e-9 || rate !== 1) {
    const fix = transportResync(target, nextTime, nextTime - stepSec - 0.01, stepSec, false, -Infinity, rate);
    assert.equal(fix.slew, true);
    assert.equal(fix.skip, 0);
    assert.equal(fix.discard, false);
    assert.ok(Math.abs(fix.nextTime - nextTime) / stepSec < 0.01);
    assert.equal(fix.rate, rate);
    assert.ok(Math.abs(fix.endRate - rate) <= stepSec * .016 + 1e-12, 'rate ramps smoothly at a bounded slope');
    assert.ok(Math.abs(fix.endRate - 1) <= .008 + 1e-12);
    assert.ok((fix.endRate - 1) * residual >= 0, 'no rate reversal or overshoot oscillation');
    close((stepSec + fix.nextTime - nextTime) * (rate + fix.endRate) / 2, stepSec);
    rate = fix.endRate;
    nextTime = fix.nextTime + stepSec;
    target += stepSec;
    steps++;
    assert.ok(steps * stepSec < 5, 'small room residuals converge within five seconds');
  }
}
assert.equal(transportResync(10.001, 10, 9, .125, false, -Infinity, 1), null);
assert.equal(transportResync(10.02, 10, 9.9, .125, false, -Infinity, 1), null, 'do not slew an interval already rendering');
assert.deepEqual(transportResync(10.2, 10, 9.9, .125, false, -Infinity, 1), { skip: 0, nextTime: 10.2, discard: false });
console.log('Room residual slew PASS: both signs, 40–240 BPM, smooth bounded rates, phase-locked steps, unity within <5s, floor and render guard.');

for (const bpm of [40, 80, 123, 180, 240]) for (const sign of [-1, 1]) {
  let previousPeak = 0;
  for (const residual of [.001, .005, .014, .028, .030, .049]) {
    const sd = 15 / bpm;
    let target = 10, next = target + sign * residual, rate = 1, profile = null, peak = 0, steps = 0;
    const endpoints = [1];
    while (Math.abs(target - next) > 1e-10 || rate !== 1) {
      const fix = transportResync(target, next, next - sd - .01, sd, false, -Infinity, rate, true, profile);
      assert.ok(fix?.slew);
      assert.equal(fix.rate, rate);
      assert.ok(Math.abs(fix.endRate - 1) <= .008 + 1e-12);
      assert.ok(Math.abs(fix.nextTime - next) <= .0015 + 1e-12);
      close((sd + fix.nextTime - next) * (rate + fix.endRate) / 2, sd);
      assert.ok((fix.endRate - 1) * sign >= 0, 'a stable target never reverses pitch');
      if (bpm === 123 && steps === 0)
        assert.ok(Math.abs(1200 * Math.log2(fix.endRate)) <= 1, 'first sixteenth leaves unity gently');
      profile = fix.profile; rate = fix.endRate; next = fix.nextTime + sd; target += sd; steps++;
      peak = Math.max(peak, Math.abs(rate - 1)); endpoints.push(rate);
      assert.ok(steps * sd < 30, 'exact alignment and unity complete in finite time');
    }
    if (residual <= .030) assert.ok(peak > previousPeak, 'peak deviation grows with residual');
    previousPeak = peak;
    assert.equal(profile, null);
    assert.ok(Math.abs(next - target) < 1e-10, 'exact alignment includes residuals below 2ms');
    const velocities = endpoints.map(r => Math.abs(r - 1));
    assert.ok(velocities.slice(1, -1).every(v => v > 0), 'no mid-slew unity reset');
    assert.ok(Math.max(...velocities) < .008, 'no plateau at the rate cap');
    if (bpm === 123 && residual === .030) {
      assert.ok(steps * sd <= 6.25, '30ms closes in about six seconds at 123 BPM');
      console.log(`Room S-curve ${sign * 30}ms: unity/exact alignment ${(steps * sd).toFixed(6)}s.`);
    }
  }
}
{
  const sd = 15 / 123;
  const first = transportResync(10, 10.028, 9, sd, false, -Infinity, 1, true);
  const saved = JSON.stringify(first.profile);
  assert.equal(transportResync(10, 10.028, 10, sd, false, -Infinity, 1, true), null, 'render guard does not start a profile');
  const changed = transportResync(10 + sd + .003, first.nextTime + sd, 9, sd, false, -Infinity, first.endRate, true, first.profile);
  assert.equal(changed.rate, first.endRate, 'a moving target replans from the actual carried rate');
  const rubato = transportResync(10 + .15, first.nextTime + .15, 9, .15, false, -Infinity, first.endRate, true, first.profile);
  close((.15 + rubato.nextTime - first.nextTime - .15) * (rubato.rate + rubato.endRate) / 2, .15);
  assert.equal(JSON.stringify(first.profile), saved, 'planning never mutates an unaccepted profile');
  assert.equal(transportResync(10, 10, 9, sd, false, -Infinity, 1, true), null);
}
console.log('Room S-curve PASS: monotonic residual-scaled peaks, both signs, 40–240 BPM, gentle onset, exact phase/unity, cap, guards, retargeting and rubato.');

for (const residual of [-.030, .030]) {
  const sd = 15 / 123, origin = 1795171688926 / 1000, offset = 1795171682.8419116;
  let next = origin - offset + residual, rate = 1, profile = null, starts = 0, aligned = false;
  for (let step = 0; step < 52; step++) {
    const target = origin + step * sd - offset;
    const fix = transportResync(target, next, 0, sd, false, -Infinity, rate, true, profile);
    if (fix?.slew) {
      if (fix.profile?.index === 1) starts++;
      rate = fix.endRate; profile = fix.profile; next = fix.nextTime;
    }
    if (rate === 1 && Math.abs(next - target) < 1e-6) { aligned = true; break; }
    next += sd;
  }
  assert.ok(aligned, 'epoch subtraction rounding must not continually restart the easing profile');
  assert.equal(starts, 1, 'sub-microsecond grid quantization is not a new clock correction');
}
console.log('Room S-curve clock precision PASS: real epoch arithmetic preserves profile progress and closes +/-30ms in about six seconds.');

{
  const imports = `import assert from 'node:assert/strict'; import {transportResync} from ${JSON.stringify(new URL('../js/room-sync.js', import.meta.url).href)};`;
  const repro = spawnSync(process.execPath, ['--input-type=module', '-e', `${imports}
    const fix = transportResync(10.005, 10, 0, .7, false, -Infinity, 1.005, true);
    assert.ok(fix?.slew);
    assert.ok(fix.profile.rates.some(rate => rate < 1), 'the profile can cross unity');
    console.log('Room profile hang regression PASS: 0.7s step, 1.005 start rate, +5ms residual; returns and crosses unity.');
  `], {encoding:'utf8', timeout:2000});
  assert.equal(repro.error, undefined, `profile call exceeded timeout: ${repro.error}`);
  assert.equal(repro.status, 0, repro.stderr);
  process.stdout.write(repro.stdout);
  const sweep = spawnSync(process.execPath, ['--input-type=module', '-e', `${imports}
    let count = 0, seed = 0x293;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    function converge(startRate, error, duration, rubato = false) {
      let target = 10 + error, next = 10, rate = startRate, profile = null;
      for (let step = 0; step < 512; step++) {
        if (Math.abs(target - next) < 1e-9 && rate === 1) { count++; return; }
        const sd = rubato && step < 12 ? duration * (.5 + random()) : duration;
        const fix = transportResync(target, next, 0, sd, false, -Infinity, rate, true, profile);
        assert.ok(fix && Number.isFinite(fix.nextTime));
        if (fix.slew) {
          assert.equal(fix.rate, rate);
          assert.ok(Math.abs(fix.endRate - 1) <= .008 + 1e-12);
          assert.ok(Math.abs((sd + fix.nextTime - next) * (rate + fix.endRate) / 2 - sd) < 1e-9);
          assert.ok(!fix.profile || fix.profile.rates.length < 1024);
          rate = fix.endRate; profile = fix.profile;
        } else profile = null;
        next = fix.nextTime + sd; target += sd;
      }
      assert.fail(JSON.stringify({startRate, error, duration, rubato, rate, residual:target - next}));
    }
    for (const bpm of [40, 123, 240]) for (const scale of [1, 2])
      for (const rate of [.992, .995, 1, 1.005, 1.008])
        for (const error of [-.049, -.028, -.005, 0, .005, .028, .049]) converge(rate, error, 15 / bpm * scale);
    for (let i = 0; i < 1000; i++) converge(.992 + random() * .016, (random() * 2 - 1) * .049,
      15 / (40 + random() * 200) * (.5 + random() * 1.5), i % 2 === 0);
    for (const rate of [.992, 1.008]) {
      const fallback = transportResync(100.005, 100, 0, 30, false, -Infinity, rate, true);
      assert.ok(fallback?.slew);
      assert.equal(fallback.endRate, rate, 'a constant inherited rate starts with zero slope');
      assert.ok(Math.abs(fallback.profile.rates[2] - 1) < Math.abs(rate - 1), 'an exhausted search eases toward unity');
      const limit = Math.max(...[-.03, .03].flatMap(error => {
        const rates = transportResync(error, 0, -100, 30, false, -Infinity, 1, true).profile.rates;
        return rates.slice(1).map((value, i) => Math.abs(1200 * Math.log2(value / rates[i])));
      }));
      assert.ok(fallback.profile.rates.slice(2).every((value, i) =>
        Math.abs(1200 * Math.log2(value / fallback.profile.rates[i + 1])) <= limit + 1e-10));
      assert.equal(fallback.profile.rates.at(-1), 1);
    }
    console.log('Room profile sweep PASS: ' + count + ' cases, both residual signs, full rate cap, 40–240 BPM/rubato, bounded fallback and eventual exact alignment/unity.');
  `], {encoding:'utf8', timeout:30000});
  assert.equal(sweep.error, undefined, `profile sweep exceeded timeout: ${sweep.error}`);
  assert.equal(sweep.status, 0, sweep.stderr);
  process.stdout.write(sweep.stdout);
  const retarget = spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(new URL('./room-slew-retarget.mjs', import.meta.url).href)});`], {encoding:'utf8', timeout:30000});
  assert.equal(retarget.error, undefined, `retarget sweep exceeded timeout: ${retarget.error}`);
  assert.equal(retarget.status, 0, retarget.stderr);
  process.stdout.write(retarget.stdout);
}

{
  const correction = transportResync(10.75, 11.5, 10, 0.125, false, -4, true);
  assert.equal(correction, null, 'raw resync cannot skip future room positions; large errors use the drain/adopt path');
  assert.equal(transportResync(11.46, 11.5, 10, 0.125, false, -64, true), null, 'a 40ms correction keeps a playable room/Jam downbeat');
  assert.equal(transportResync(11.376, 11.5, 10, 0.125, false, -64, true), null, 'a sub-step correction cannot bypass the drained-frontier requirement');
  close(slewTransport(11.46, 11.5, 0.125), 11.4985);
  assert.deepEqual(transportResync(10.75, 11.5, 10, 0.0625), {skip:0, nextTime:10.75, discard:false}, 'solo tempo increases retain pre-room-correction behavior without rewinding');
  assert.deepEqual(transportResync(11.4, 11.5, 10, 0.125), {skip:0, nextTime:11.4, discard:false}, 'a sub-step correction keeps ordered queued notes');
}

{
  const before = syncAudioClock(null, 1000);
  assert.deepEqual(before, { offset: 1000, jumped: false });
  const jitter = syncAudioClock(before.offset, 1000.02);
  assert.equal(jitter.jumped, false);
  close(jitter.offset, 1000.001);

  const wake = syncAudioClock(jitter.offset, 1015);
  assert.deepEqual(wake, { offset: 1015, jumped: true });
  assert.deepEqual(transportResync(1011.5 - wake.offset, 11.5, 10, 0.125, wake.jumped), { skip: 108, nextTime: 10, discard: true, firstTime: 10.005 });
  assert.equal(syncAudioClock(wake.offset, 1015.02).jumped, false);

  const short = syncAudioClock(before.offset, 1000.25);
  assert.deepEqual(transportResync(1011.5 - short.offset, 11.5, 10, 0.125, short.jumped), { skip: -10, nextTime: 10, discard: true, firstTime: 10.005 });
  const stall = syncAudioClock(before.offset, 1000.8);
  const recovery = transportResync(1011.475 - stall.offset, 11.5, 10, 0.125, stall.jumped);
  assert.equal(recovery.discard, true);
  assert.equal(recovery.skip, -5);
  close(recovery.nextTime, 10.05);
  assert.equal(transportResync(recovery.nextTime, recovery.nextTime, 10, 0.125), null);
}

{
  const late = transportResync(9.955, 11.5, 10, 0.125, true, 0);
  assert.deepEqual(late, { skip: 0, nextTime: 9.955, discard: true, firstTime: 10.005 });
  close(late.nextTime + 0.125, 10.08);
  const missed = transportResync(9.945, 11.5, 10, 0.125, true, 0);
  assert.equal(missed.skip, 1);
  assert.equal(missed.firstTime, undefined);
  close(missed.nextTime, 10.07);
  const fast = transportResync(9.965, 11.5, 10, 0.0625, true, 0);
  assert.equal(fast.skip, 1, 'a fast song does not crowd the next step to recover a late one');
  close(fast.nextTime, 10.0275);
}

{
  const songOrigin = 64, nextStep = 68;
  const recovery = transportResync(10.75, 11.5, 10, 0.125, true, songOrigin - nextStep);
  assert.equal(recovery.skip, -4, 'a landed handoff cannot rewind into the outgoing song');
  assert.equal(nextStep + recovery.skip, songOrigin);
  close(recovery.nextTime, 10.25);
  assert.equal(recovery.discard, true);
  const ordinary = transportResync(10.75, 11.5, 10, 0.125, true, -nextStep);
  assert.equal(ordinary.skip, -6, 'lookahead within the current song can still rewind');
  const long = transportResync(-3.5, 11.5, 10, 0.125, true, songOrigin - nextStep);
  assert.equal(long.skip, 108, 'the origin bound does not change long-stall forward skips');
}

console.log('room transport alignment passed');

{
  let clock = {offset:null, state:null};
  const sample = (at, contextTime, measured) => clock = syncAudioClock(clock.offset, measured, {at, contextTime, state:clock.state});
  sample(0, 0, 1000);
  assert.equal(clock.offset, 1000, 'the first usable join estimate applies immediately');
  for (let i = 1; i <= 40; i++) sample(i * .02, i * .02, 1000.08);
  assert.equal(clock.offset, 1000, 'a sub-second renderer stall cannot move the room grid');
  sample(1, 1, 1000);
  assert.equal(clock.state.pending, null, 'a transient estimate is discarded');
  for (let i = 0; i < 100; i++) sample(2 + i * .02, 2 + i * .02, 1000.08);
  assert.equal(clock.offset, 1000);
  sample(4, 4, 1000.08);
  close(clock.offset, 1000.08);
  assert.equal(clock.jumped, false, 'a lasting offset uses ordinary room correction, not wake cancellation');
  sample(4.02, 4.02, 1002);
  assert.equal(clock.offset, 1000.08, 'even a large one-frame glitch waits for persistence');
  assert.equal(clock.jumped, false);
  sample(4.04, 4.04, 1000.08);
  sample(6.04, 4.04, 1002.08);
  assert.equal(clock.jumped, true, 'a real frozen-page interval retains immediate wake recovery');
  close(clock.offset, 1002.08);
}
for (const rate of [-0.005, 0.005]) {
  let clock = syncAudioClock(null, 1000, {at:0, contextTime:0, state:null});
  let adopted = 0, residual = 0;
  for (let i = 1; i <= 100; i++) {
    const at = i / 2, measured = 1000 + rate * at;
    const next = syncAudioClock(clock.offset, measured, {at, contextTime:at * (1 - rate), state:clock.state});
    if (next.offset !== clock.offset) {
      adopted++;
      const values = [...clock.state.pending.values, measured].sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      close(next.offset, values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2);
    }
    assert.equal(next.jumped, false, 'ordinary continuous drift is not a frozen wake');
    residual = Math.max(residual, Math.abs(next.offset - measured));
    clock = next;
  }
  assert(adopted >= 10, `a5ms/s drift over50s repeatedly adopts despite the estimate continuing to move (${adopted} adoptions)`);
  assert(residual < .02, 'persistent drift stays within20ms of the latest mapping');
  console.log(`Room clock drift ${rate * 1000}ms/s PASS: ${adopted} adoptions over50s, maximum residual${(residual * 1000).toFixed(3)}ms.`);
}

{
  let clock = syncAudioClock(null, 1000, {at:0, contextTime:0, state:null});
  const sample = (at, measured) => clock = syncAudioClock(clock.offset, measured, {at, contextTime:at, state:clock.state});
  sample(.1, 1000.020);
  sample(1.5, 1000.007);
  assert.equal(clock.offset, 1000);
  assert.equal(clock.state.pending, null, 'returning within8ms discards a transient before2s');
  sample(2, 1000.060);
  sample(3.99, 1000.070);
  assert.equal(clock.offset, 1000, 'a new deviation starts a fresh2s persistence window');
  sample(4, 1000.080);
  close(clock.offset, 1000.070);
  assert.equal(clock.state.pending, null);
}
for (const sign of [-1, 1]) {
  let clock = syncAudioClock(null, 1000, {at:0, contextTime:0, state:null});
  const sample = (at, measured) => clock = syncAudioClock(clock.offset, measured, {at, contextTime:at, state:clock.state});
  for (let i = 1; i <= 200; i++) {
    sample(i / 50, 1000 + (i === 100 ? sign * .130 : 0));
    assert.equal(clock.offset, 1000, 'one outlier in otherwise accepted samples cannot move the grid');
    assert.equal(roomTransportCorrection(10 + 1000 - clock.offset, 10, 9.5, .125), null,
      'a single clock outlier cannot start a drain or skip a sixteenth');
  }
  for (const outlier of [1, 51, 101]) {
    clock = syncAudioClock(null, 1000, {at:0, contextTime:0, state:null});
    for (let i = 1; i <= 101; i++) {
      sample(1 + (i - 1) / 50, 1000 + sign * (i === outlier ? .130 : .012));
      if (i < 101) assert.equal(clock.offset, 1000, 'the robust window still waits two seconds');
    }
    close(clock.offset, 1000 + sign * .012);
    assert.equal(roomTransportCorrection(10 + 1000 - clock.offset, 10, 9.5, .125), null,
      'an outlier at window start, middle or exact expiry cannot turn a small correction into a skip');
  }
  clock = syncAudioClock(null, 1000, {at:0, contextTime:0, state:null});
  sample(1, 1000 + sign * .012);
  sample(3, 1000 + sign * .130);
  assert.equal(clock.offset, 1000, 'two conflicting sparse samples cannot establish a robust correction');
  sample(3.02, 1000 + sign * .012);
  close(clock.offset, 1000 + sign * .012);
}
console.log('Room clock robust window PASS: isolated outliers never correct or skip; first/middle/expiry outliers cannot determine adoption; sparse pairs wait for a median.');
console.log('Room clock drift persistence PASS: moving5ms/s estimates re-adopt over50s with residual below20ms; returning within8ms cancels transient corrections.');
console.log('Room clock persistence PASS: immediate first estimate/wake, transient and large glitches held, stable80ms offset adopted only after2s; solo arithmetic unchanged.');

const oldOrigin = origin;
const oldBpm = 120;
const newBpm = 150;
const changeAt = origin + 60000;
const currentStep = (changeAt - oldOrigin) / (15000 / oldBpm);
const rebasedOrigin = changeAt - currentStep * (15000 / newBpm);
const before = (changeAt - oldOrigin) / (15000 / oldBpm);
const after = (changeAt - rebasedOrigin) / (15000 / newBpm);
close(before, after);

const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
const stopSource = main.slice(main.indexOf('function roomStartPending()'), main.indexOf('\nfunction recordPlayback'));
for (const [action, currentTime, playing, expected] of [
  ['stop', 1.8, true, ['discard@1.8', 'timer', 'panic']],
  ['cancelRoomStart', 1.8, true, ['discard@1.8', 'timer', 'panic']],
  ['cancelRoomStart', 1.8, false, ['timer']],
  ['stop', 2.1, true, ['timer', 'panic']],
  ['cancelRoomStart', 2.1, true, []],
]) {
  const calls = [], noop = () => {};
  const sandbox = {
    playing, roomFirstNote: playing ? 2 : null, roomPlayback: true, roomEditor: false, roomJoinTimer: 1, roomResume: noop, mediaRoute: null,
    ctx: {currentTime}, engine: {editableHits: [], discardQueuedNotes: t => calls.push(`discard@${t}`), panic: () => calls.push('panic'), cancelJamParams: noop},
    playbackStats: {end: noop}, trackingReplay: false, listens: {end: noop}, listenPos: noop, songOver: false,
    clearPaused: noop, endTuning: noop, clearTimeout: () => calls.push('timer'), handoff: null,
    jamQueue: [], guardPushOffer: noop, playStopped: noop, timer: null, midiClockStop: noop,
    uiQueue: [], setPlayhead: noop, timeline: {frame: noop}, lastPlayedPat: null, seq: null, artistLive: null,
    document: {body: {classList: {remove: noop}}, querySelectorAll: () => []},
    renderPatterns: noop, renderHome: noop, releaseMedia: noop, syncNowPlaying: noop,
  };
  runInNewContext(`${stopSource}\n${action}()`, sandbox);
  assert.deepEqual(calls, expected, `${action} at audio time ${currentTime} (playing: ${playing})`);
  assert.equal(sandbox.playing, playing && !expected.length);
}
{
  const notes = [], rewinds = [], cancelled = [], sent = [], positions = [];
  const clock = createClockSender((bytes, time) => {
    if (bytes[0] === 0xf8) sent.push(time);
    if (bytes[0] === 0xf2) positions.push({step:bytes[1] + (bytes[2] << 7), time});
  });
  clock.start(64, 11000);
  for (let step = 64; step < 68; step++) clock.step(step, 11000 + (step - 64) * 125, 125);
  const oldTickCount = sent.length, oldLastTick = sent.at(-1);
  const sandbox = {playing:true, songOver:false, roomPlayback:true, roomEditor:false, ROOM_LEAD:0.25, BG_LEAD:1,
    mediaRoute:null, roomMediaSync:createRoomMediaSync(), roomMediaLead, roomMediaTime,
    document:{hidden:false}, ctx:{currentTime:10}, Date:{now:() => sandbox.ctx.currentTime * 1000},
    state:{bpm:120, part:'old'}, clockOffset:0, transportOrigin:2250, abs:68, nextTime:11.5,
    syncAudioClock, transportResync, slewTransport, roomTransportCorrection, roomDrainUntil:null, vocalCorrectionWindow:0,
    queuedRoomSwitch:null, handoff:null, jamQueue:[], vocalGridDirty:false, roomAudioClock:{at:10, contextTime:10, pending:null},
    performance:{now:() => sandbox.ctx.currentTime * 1000},
    engine:{stepDur:0.125, applyAll(){}, scheduleJamParams(){}, discardQueuedNotes:t => cancelled.push(t), vocal(){}},
    seq:{origin:0, chainPos:5, songBars:8, advanceBar(){}, rewind:step => rewinds.push(step),
      tick:(step, time) => { notes.push({step, time, part:sandbox.state.part}); return {}; }},
    uiQueue:[], timeline:{skip:() => 0}, artistTick(){}, landJamParts(){},
    midiClockStart:(ctx, step, time) => clock.start(step, time * 1000),
    midiClockStep:(ctx, step, time, duration) => clock.step(step, time * 1000, duration * 1000),
    applyPart:(state, part, layer) => { state.part = layer.id; }, setTimeout(){}, cancelAnimationFrame(){},
    requestAnimationFrame:() => 0, jamRedraw:0};
  const schedulerSource = main.slice(main.indexOf('function schedule(lead)'), main.indexOf('\n// Jam:'));
  const jamSource = main.slice(main.indexOf('function landJamPart(part,'), main.indexOf('\n// GENERATE while'));
  const initialNotes = [], initial = {...sandbox, abs:0, nextTime:10.06, transportOrigin:10100,
    roomAudioClock:null, roomDrainUntil:null, vocalGridDirty:false, uiQueue:[],
    engine:{...sandbox.engine, vocalNow:null, queuedNotes:[]},
    seq:{...sandbox.seq, tick:(step, time) => { initialNotes.push({step, time}); return {}; }},
    midiClockStart(){}, midiClockStep(){}};
  runInNewContext(`${schedulerSource}\nschedule()`, initial);
  close(initialNotes[0].time, 10.1);
  assert.equal(initial.transportOrigin, 10100, 'the first unqueued room estimate snaps its audio deadline, never the shared broadcast origin');
  {
    const notes = [], cold = {...initial, abs:0, nextTime:13, transportOrigin:13000,
      ctx:{currentTime:11.6}, Date:{now:() => 12100}, clockOffset:0,
      roomAudioClock:{at:12, contextTime:11.5, pending:{since:9, values:[.5, .5, .5]}},
      performance:{now:() => 12100}, roomDrainUntil:null, uiQueue:[],
      seq:{...initial.seq, tick:(step, time) => { notes.push({step, time}); return {}; }}};
    for (const queued of [{queuedNotes:[{t:13}]}, {vocalNow:{}}]) {
      const sounding = {...cold, engine:{...cold.engine, ...queued}};
      runInNewContext(`${schedulerSource}\nschedule()`, sounding);
      close(sounding.nextTime, 13);
      assert.equal(sounding.roomDrainUntil, 13, 'queued audio still drains before a clock correction');
    }
    const schedule = runInNewContext(`${schedulerSource}\nschedule(); schedule`, cold);
    close(cold.nextTime, 12.5);
    assert.equal(cold.roomDrainUntil, null, 'an unqueued first downbeat has no audio frontier to drain');
    cold.ctx.currentTime = 12.3;
    cold.Date.now = () => 12800;
    cold.performance.now = () => 12800;
    schedule();
    assert.equal(notes[0].step, 0, 'a corrected cold clock preserves the still-future first downbeat');
    close(notes[0].time, 12.5);
  }
  for (const origin of [9999, 9960, 9920]) {
    const notes = [], padded = {...initial, abs:0, nextTime:10.01, transportOrigin:origin, uiQueue:[],
      roomAudioClock:null, roomDrainUntil:null, vocalGridDirty:false,
      seq:{...initial.seq, tick:(step, time) => { notes.push({step, time}); return {}; }}};
    runInNewContext(`${schedulerSource}\nschedule()`, padded);
    assert.equal(notes[0].step, 0, 'crossing the first grid deadline cannot skip the still-playable padded step');
    close(notes[0].time, 10.01);
    assert(notes.every((n, i) => n.step === i && n.time >= 10.01 && (!i || n.time > notes[i-1].time)),
      'a padded room start renders each step once in order before later corrections');
    assert.equal(padded.transportOrigin, origin, 'the startup pad never changes the shared origin');
  }
  const f = runInNewContext(`${schedulerSource}\n${jamSource}\n({schedule, landJamPart})`, sandbox);
  f.landJamPart('kick', {id:'new'}, 11);
  f.schedule();
  assert.equal(sandbox.abs, 68, 'still-future room steps wait at the queued frontier rather than being dropped');
  assert.equal(notes.length, 0, 'do not rebuild any audio ahead of the queued frontier');
  assert.equal(cancelled.length, 0);
  assert.equal(rewinds.length, 0);
  sandbox.ctx.currentTime = 11.5;
  f.schedule();
  assert.ok(notes.length > 0);
  assert.ok(notes.every(n => n.part === 'new' && n.time >= 11 && n.step >= 68), 'a part applied for a queued Jam downbeat cannot sound before it');
  assert.equal(sent.length, oldTickCount + notes.length * 6, 'every new step sends its six MIDI ticks, with none suppressed by rewind');
  assert.ok(sent[oldTickCount] > oldLastTick);
  assert.ok(sent.every((time, i) => !i || time > sent[i - 1]), 'old and new MIDI clock queues stay strictly monotonic without overlap');
  assert.equal(positions.at(-1).step, notes[0].step);
  assert.ok(positions.at(-1).time > oldLastTick, 'relocation follows the drained MIDI queue');
  const musicNotes = [];
  const music = {...sandbox, abs:68, nextTime:11.5, transportOrigin:2750, clockOffset:0, roomDrainUntil:null,
    ctx:{currentTime:11.2}, Date:{now:() => music.ctx.currentTime * 1000}, uiQueue:[], midiClockStep(){}, midiClockStart(){},
    seq:{...sandbox.seq, tick:(step, time) => { musicNotes.push({step, time}); return {}; }}};
  const drain = runInNewContext(`${schedulerSource}\nschedule(0.5); schedule`, music);
  assert.equal(musicNotes.length, 0, 'a large correction stops queuing until the old frontier drains');
  music.ctx.currentTime = 11.5;
  drain(0.5);
  assert.deepEqual(musicNotes.map(n => n.step), [70, 71, 72, 73], 'after draining only already-past steps68/69 skip; every remaining future step renders');
  assert.ok(musicNotes.every((n, i) => n.time >= (i ? musicNotes[i - 1].time : 11.5)), 'adoption never reorders old or new audio');
  assert.equal(music.vocalGridDirty, false, 'an aligned vocal consumes the dirty-grid check');
  const relocations = [], forward = {...music, abs:68, nextTime:11.5, transportOrigin:3250, roomDrainUntil:null,
    seq:{...music.seq, tick:() => ({})}, midiClockStart:(ctx, step, time) => relocations.push({step, time})};
  runInNewContext(`${schedulerSource}\nschedule(0.5)`, forward);
  assert.deepEqual(relocations, [{step:68, time:11.75}], 'adoption sends SPP even when no logical steps were skipped');
  const replayNotes = [], switches = [];
  const replay = {...music, ROOM_LEAD:0.42, abs:68, nextTime:10.25, transportOrigin:1500, roomDrainUntil:null,
    ctx:{currentTime:10}, Date:{now:() => replay.ctx.currentTime * 1000}, jamQueue:[], uiQueue:[],
    queuedRoomSwitch:{startsAt:10375}, switchRoomSet:at => switches.push(at),
    seq:{...music.seq, tick:(step, time) => {replayNotes.push({step, time}); return {};}}};
  const replaySchedule = runInNewContext(`${schedulerSource}\nschedule(); schedule`, replay);
  assert.deepEqual(switches, [], 'a replay entering lookahead cannot bypass unscheduled outgoing steps while the frontier drains');
  replay.ctx.currentTime = 10.25;
  replaySchedule();
  assert.deepEqual(replayNotes, [{step:70, time:10.25}], 'the playable outgoing step before the replay downbeat still sounds');
  assert.deepEqual(switches, [10.375], 'switch only after all outgoing steps before the replay are queued');
  assert.equal(transportResync(11.25, 11.5, 11.2, 0.125, false, -Infinity, true), null);
  const partial = transportResync(11.125, 11.5, 11.2, 0.125, false, -Infinity, true);
  assert.equal(partial.skip, 1, 'only the corrected step already before now can be skipped');
  close(partial.nextTime, 11.5);
}
console.log('Room frontier PASS: large corrections drain then adopt, future-at-adoption steps render, no reorder/rebuild, solo no-repeat, explicit SPP and monotonic MIDI.');
{
  const runBoundary = ({step=63, nextTime=10.5, gridOrigin=2325, now=10, wall=10325, clockOffset=0, lead, pendingForce=false, mediaRoute=null} = {}) => {
    const notes = [], effects = [], vocals = [], state = freshSong('hypnotic', 7, {length:'sketch', bpm:120});
    state.bpm = 120; state.chainOn = true; state.chain = 'CCCCEEEECCCC'; state.master.arr = 1; state.part = 'old';
    const engine = new Recorder(state), seq = new Sequencer(engine, state);
    seq.chainPos = 4; seq.cur = 2;
    engine.at = 0;
    engine.applyAll = () => effects.push({kind:'mix', time:engine.at});
    engine.scheduleJamParams = (params, time) => effects.push({kind:'mix', time});
    engine.breakSweep = time => effects.push({kind:'break', time});
    engine.discardQueuedNotes = () => assert.fail('a room correction must preserve the queued notes');
    engine.vocal = (...args) => vocals.push(args);
    if (pendingForce) engine.vocalNow = {correction:{forceStep:64}};
    const tick = seq.tick.bind(seq);
    seq.tick = (abs, time, ...args) => { notes.push({abs, time, part:state.part}); return tick(abs, time, ...args); };
    const sandbox = {playing:true, songOver:false, roomPlayback:true, roomEditor:false, ROOM_LEAD:0.25, BG_LEAD:1,
      mediaRoute, roomMediaSync:createRoomMediaSync(), roomMediaLead, roomMediaTime,
      document:{hidden:false}, ctx:{currentTime:now}, Date:{now:() => now * 1000},
      state, engine, seq, abs:step, nextTime, transportOrigin:gridOrigin, clockOffset,
      syncAudioClock, transportResync, slewTransport, roomTransportCorrection, roomDrainUntil:null, vocalCorrectionWindow:0,
      queuedRoomSwitch:null, handoff:null, vocalGridDirty:false, uiQueue:[], roomAudioClock:{at:now, contextTime:now, pending:null}, performance:{now:() => now * 1000},
      jamQueue:[{part:'kick', layer:{id:'new'}, wall}], jamRedraw:0,
      timeline:{skip:() => 0}, artistTick(){}, midiClockStep(){}, midiClockStart(){},
      applyPart:(s, part, layer) => { s.part = layer.id; }, setTimeout(){}, cancelAnimationFrame(){}, requestAnimationFrame:() => 0};
    const scheduler = main.slice(main.indexOf('function schedule(lead)'), main.indexOf('\n// Jam:'));
    const jam = main.slice(main.indexOf('function landJamParts('), main.indexOf('\n// GENERATE while'));
    runInNewContext(`${scheduler}\n${jam}\nschedule(${lead})`, sandbox);
    return {sandbox, notes, effects, vocals};
  };
  const small = runBoundary({step:64, nextTime:11.5, gridOrigin:3460, now:11.3, wall:11460});
  assert.equal(small.notes[0]?.abs, 64, 'a small calibration never skips the playable Jam downbeat');
  assert.equal(small.notes[0].part, 'new');
  close(small.notes[0].time, 11.4985);
  const future = runBoundary({now:10.1, lead:0.5});
  assert.equal(future.notes.length, 0, 'large corrections leave future queued notes alone while draining');
  const skipped = runBoundary({now:10.5});
  assert.equal(skipped.sandbox.abs, 68);
  assert.equal(skipped.sandbox.state.part, 'new', 'a skipped Jam boundary lands rather than waiting another bar');
  assert.equal(skipped.sandbox.jamQueue.length, 0);
  assert.equal(skipped.sandbox.seq.cur, 4, 'a skipped breakdown advances the actual section');
  assert.deepEqual(skipped.notes.map(n => n.abs), [66, 67], 'only past steps are skipped; existing queued notes are not rebuilt');
  close(skipped.effects.find(e => e.kind === 'break').time, 10.5);
  close(skipped.effects.find(e => e.kind === 'mix').time, 10.5);
  const boundary = runBoundary({now:10.6, nextTime:10.6, gridOrigin:2825});
  const downbeat = boundary.notes.find(n => n.abs === 64);
  close(boundary.effects.find(e => e.kind === 'break').time, downbeat.time);
  close(boundary.effects.find(e => e.kind === 'mix').time, downbeat.time);
  assert.ok(boundary.effects.every(e => e.time > 10.6), 'future section and mix automation still land at their rendered grid time, not scheduler-now');
  assert.equal(skipped.sandbox.engine.at, 0, 'temporary scheduled mix time is restored');
  const late = runBoundary({now:10.5, wall:10550});
  assert.equal(late.sandbox.state.part, 'new', 'a Jam due between skipped and playable steps lands on the first playable grid time');
  close(late.effects.find(e => e.kind === 'mix').time, 10.575);
  const mediaLate = runBoundary({now:10.5, wall:10550, mediaRoute:{}});
  assert.equal(mediaLate.notes[0].part, 'new', 'media-route compensation cannot defer a due Jam beyond the first playable corrected step');
  close(mediaLate.effects.find(e => e.kind === 'mix').time, 10.535);
  const clockOnly = runBoundary({step:64, nextTime:11.5, gridOrigin:3500, clockOffset:-0.02});
  assert.equal(clockOnly.sandbox.vocalGridDirty, true, 'clock-offset-only slews request the same deferred vocal alignment');
  for (const pendingForce of [false, true]) {
    const moving = runBoundary({step:64, nextTime:11.5, gridOrigin:3500, clockOffset:-.02, now:11.3, pendingForce});
    assert.equal(moving.vocals.some(args => args[4] === true), pendingForce,
      'ordinary slews hold vocal checks, but a pending large-correction deadline cannot miss its downbeat during a later small slew');
  }
}
console.log('Room skipped boundaries PASS: sub-step Jam downbeat retained; skipped Jam, breakdown and mix automation land at grid time; late Jam catches the first playable step.');
{
  const reanchorSource = main.slice(main.indexOf('function reanchorRoomSet('), main.indexOf('\nfunction stopRoomStats'));
  const sandbox = {playing:true, roomPlayback:true, state:{bpm:newBpm}, seq:{origin:64}, transportOrigin:rebasedOrigin, vocalGridDirty:false, queuedRoomSwitch:null};
  const reanchor = runInNewContext(`${reanchorSource}\nreanchorRoomSet`, sandbox);
  reanchor(oldOrigin + 5, oldOrigin);
  close(sandbox.transportOrigin, rebasedOrigin + 5);
  assert.equal(sandbox.vocalGridDirty, true);
  reanchor(oldOrigin + 8, oldOrigin + 5);
  close(sandbox.transportOrigin, rebasedOrigin + 8);
  reanchor(oldOrigin + 8, oldOrigin + 8);
  close(sandbox.transportOrigin, rebasedOrigin + 8);
  sandbox.vocalGridDirty = false;
  sandbox.queuedRoomSwitch = {startsAt:oldOrigin + 20000};
  reanchor(oldOrigin + 20120, oldOrigin + 20000);
  close(sandbox.transportOrigin, rebasedOrigin + 8, 'queued replay calibration leaves outgoing origin alone');
  assert.equal(sandbox.vocalGridDirty, false);
  assert.equal(sandbox.queuedRoomSwitch.startsAt, oldOrigin + 20120);
  reanchor(NaN, oldOrigin + 20120);
  assert.equal(sandbox.queuedRoomSwitch.startsAt, oldOrigin + 20120, 'invalid origins cannot move the queue');
  const replaySource = main.slice(main.indexOf('function switchRoomSet('), main.indexOf('\nfunction startRoomReplay('));
  const switches = [];
  sandbox.ctx = {currentTime:1};
  sandbox.startRoomReplay = (replay, at) => switches.push({startsAt:replay.startsAt, at});
  runInNewContext(`${replaySource}\nswitchRoomSet(${(origin + 20120) / 1000})`, sandbox);
  assert.equal(switches[0].startsAt, oldOrigin + 20120);
  assert.equal(switches[0].at, (oldOrigin + 20120) / 1000, 'the switch uses the corrected queued timestamp');
  sandbox.playing = false;
  reanchor(oldOrigin + 100, oldOrigin + 8);
  close(sandbox.transportOrigin, rebasedOrigin + 8);
}
const joinSource = main.slice(main.indexOf('function joinRoomSet('), main.indexOf('\nfunction startRoomBroadcast'));
function roomJoin(change = () => {}, options = {}) {
  const state = freshSong('hypnotic', 7, { length:'sketch', bpm:123 });
  state.artist = {name:'Sync fixture', title:'Seed 7', style:'hypnotic', seed:7};
  state.sing = {on:true, voice:'gwen', db:0, ms:0};
  const item = {state:clone(state), startsAt:origin, style:'hypnotic', title:'New DJ'};
  const calls = [], analytics = [], timers = [], starts = [];
  const engine = {state, editableHits:[{}], vocalNow:{source:'continuous'}, stepDur:.125};
  const seq = {s:state, origin:0, queued:null};
  const sandbox = {state, engine, seq, playing:true, roomPlayback:true, roomEditor:true, artistLive:null, handoff:null, jamQueue:[], mediaRoute:null,
    transportOrigin:origin, vocalGridDirty:false, style:'hypnotic', songOrigin:{}, STYLES, sanitize, clone, songFingerprint,
    roomStatsItem:null, playbackSources:new WeakMap(), playbackStats:{end:(outcome) => analytics.push(outcome)},
    ctx:{currentTime:8}, abs:65, nextTime:8.125, recordPlayback:(source) => analytics.push(source),
    Date:{now:() => origin + 8000}, ROOM_LEAD:.42, roomJoinTimer:0, stopTimeline(){}, joinRoomReplay(){calls.push('replay');},
    replaceState(){calls.push('replace');}, play({startsAt}){calls.push('play'); starts.push(startsAt);}, build(){}, persist(){}, syncNowPlaying(){}, toast(){},
    setTimeout(fn, delay){calls.push('timer'); return timers.push({fn, delay});}, ...options};
  change(item, sandbox);
  const join = runInNewContext(`${joinSource}\njoinRoomSet`, sandbox);
  join(item);
  return {calls, sandbox, item, join, analytics, timers, starts};
}
{
  const {calls, timers, starts, item} = roomJoin((_, s) => { s.playing = false; }, {Date:{now:() => origin - 1600}});
  assert.deepEqual(calls, ['replace', 'timer']);
  assert.equal(timers[0].delay, 1180, 'cold join starts with a scheduler lookahead before the downbeat');
  timers[0].fn();
  assert.deepEqual(starts, [item.startsAt], 'earlier startup still uses the published grid origin');
}
{
  const {calls, starts} = roomJoin((_, s) => { s.playing = false; }, {Date:{now:() => origin - 300}});
  assert.deepEqual(calls, ['replace', 'play'], 'a join already inside the lookahead starts without waiting');
  assert.deepEqual(starts, [origin]);
}
{
  const startsAt = origin + 12000;
  const {calls, sandbox} = roomJoin((item, s) => {
    item.broadcastId = 'spin';
    item.state.artist.seed = 11;
    item.startsAt = startsAt;
    s.engine.prepareVocal = () => {};
  }, { prepareSample() {}, liveSets: () => [], loadSets: async () => {}, queuedRoomSwitch: null });
  assert.deepEqual(calls, [], 'a future room song leaves the outgoing transport running');
  assert.equal(sandbox.state.artist.seed, 7);
  assert.equal(sandbox.queuedRoomSwitch.roomState.artist.seed, 11);
  assert.equal(sandbox.queuedRoomSwitch.startsAt, startsAt);
  const scheduled = [];
  Object.assign(sandbox, {
    stopTimeline() {},
    installRoomSong(next, at) { sandbox.state = next; scheduled.push(at); },
    play(opts) { scheduled.push(opts); },
  });
  const switchSource = main.slice(main.indexOf('function switchRoomSet('), main.indexOf('\nfunction startRoomReplay('));
  runInNewContext(`${switchSource}\nswitchRoomSet(12)`, sandbox);
  assert.equal(scheduled[0], 12, 'incoming parameters land on the audio boundary');
  assert.equal(scheduled[1].switchAt, 12, 'incoming downbeat uses the same audio boundary');
  assert.equal(scheduled[1].startsAt, startsAt, 'incoming grid uses the published origin');
  assert.equal(sandbox.state.artist.seed, 11);
}
{
  const {calls, sandbox, item, analytics} = roomJoin((item, s) => {
    item.state.artist.title = 'Same song, new DJ';
    item.state.current = 1;
    s.state.current = 2;
    s.seq.origin = 64;
    s.transportOrigin -= 64 * 15000 / s.state.bpm;
    item.startsAt += .75;
  });
  assert.deepEqual(calls, [], 'same song and running origin do not stop or restart playback');
  assert.equal(sandbox.state.artist.title, item.state.artist.title);
  assert.equal(sandbox.state.current, 2, 'chain playback retains the current pattern');
  assert.equal(sandbox.engine.state, sandbox.state);
  assert.equal(sandbox.seq.s, sandbox.state);
  assert.equal(sandbox.engine.vocalNow.source, 'continuous');
  assert.equal(sandbox.roomEditor, false, 'the former DJ becomes a listener');
  assert.equal(sandbox.engine.editableHits.length, 0);
  assert.equal(analytics[0], 'skip');
  assert.equal(analytics[1].surface, 'club', 'a seamless DJ handoff starts capturing the former host as a listener');
  sandbox.roomResume();
  assert.deepEqual(calls, [], 'resuming the same active room does not rebuild its transport');
  assert.equal(analytics.length, 2, 'resyncing the same broadcast keeps one play');
}
for (const change of [
  (i) => { i.startsAt += 31; },
  (i) => { i.state.bpm++; },
  (i) => { i.state.patterns[0].steps.kick[0] = i.state.patterns[0].steps.kick[0] ? 0 : 1; },
  (i) => { i.state.chain += 'B'; },
  (i) => { i.state.params.kick.level = .01; },
  (i) => { i.state.sing.on = false; },
  (i) => { i.state.sing.voice = 'other'; },
  (i) => { i.state.sing.ms = 100; },
  (i) => { i.state.artist.seed++; },
  (i) => { i.state.artist.style = i.style = 'hardtechno'; },
  (i, s) => { s.playing = false; },
  (i, s) => { s.roomPlayback = false; },
  (i, s) => { s.artistLive = {}; },
  (i, s) => { s.handoff = {}; },
  (i, s) => { s.seq.queued = 1; },
  (i, s) => { s.jamQueue.push({}); },
  (i, s) => { i.state.chainOn = s.state.chainOn = false; i.state.current = 1; },
]) assert.deepEqual(roomJoin(change).calls, ['replace', 'play'], 'changed music/origin or inactive transport takes the normal join path');
{
  const {calls, sandbox, analytics} = roomJoin((item, s) => {
    item.broadcastId = 'live';
    s.roomStatsItem = {broadcastId:'live'};
    item.startsAt += 235;
  });
  assert.deepEqual(calls, [], 'a large same-broadcast correction never restarts playback');
  assert.equal(sandbox.transportOrigin, origin + 235);
  assert.equal(sandbox.vocalGridDirty, true, 'the continuous vocal must follow the corrected grid');
  assert.equal(sandbox.engine.vocalNow.source, 'continuous');
  assert.deepEqual(analytics, [], 'clock corrections keep the active play');
}
assert.deepEqual(roomJoin(i => { delete i.state; }).calls, []);
assert.deepEqual(roomJoin(i => { i.replay = {}; }).calls, ['replay']);
console.log('Room continuity PASS: role-only rebroadcast retains vocal/scheduler; changed song, vocal, origin, queued edits, replay and stopped transport still join normally.');
{
  let builds = 0;
  const { item, join, sandbox, calls } = roomJoin((i, s) => {
    Object.assign(i, { broadcastId: 'a:1', version: 1, by: 'a' });
    s.roomMediaSync.begin(i, false, false, s.mediaRoute);
    s.roomMediaSync.start(true, s.mediaRoute);
  }, {
    mediaRoute: {}, roomMediaSync: createRoomMediaSync(), roomMediaLead, build: () => builds++,
  });
  assert.equal(builds, 1);
  join({ ...item }, { initial: true });
  assert.equal(builds, 1, 'an already-playing media-route set is a complete no-op');
  assert.equal(sandbox.roomStatsItem, item);
  sandbox.roomResume();
  assert.equal(builds, 2, 'wake rejoin bypasses initial duplicate suppression even inside the window');
  join({ ...item, by: 'b' });
  assert.equal(builds, 3, 'role-only DJ handoff still reaches continuity handling');
  const update = clone(item);
  update.broadcastId = 'a:2'; update.version++;
  update.state.patterns[0].steps.kick[0] = update.state.patterns[0].steps.kick[0] ? 0 : 1;
  join(update);
  assert.deepEqual(calls, ['replace', 'play'], 'UPDATE ROOM still applies changed music');
}
console.log('Room media joins PASS: duplicate ignored; DJ handoff and UPDATE ROOM still apply.');
for (const mediaRoute of [null, {}]) {
  let delay;
  roomJoin((i, s) => { i.startsAt += 9000; s.playing = false; }, {
    mediaRoute, roomMediaSync: createRoomMediaSync(), roomMediaLead,
    setTimeout: (fn, wait) => { delay = wait; },
  });
  assert.equal(delay, mediaRoute ? 540 : 580, 'future listener starts retain main\'s lookahead plus route lead');
}
