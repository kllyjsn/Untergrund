import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./club-sync.mjs', import.meta.url), 'utf8');
const start = source.indexOf('    const locateClick =');
const end = source.indexOf('    return { run, nav,', start);
assert.ok(start >= 0 && end > start);
const helpers = source.slice(start, end);
const fixture = ({ point = { x: 30, y: 40 }, lookupMs = 150, lookupError, dispatchError } = {}) => {
  let now = 500, lookups = 0;
  const sent = [];
  const controls = runInNewContext(`(() => { ${helpers} return { clickText, prepareClickText }; })()`, {
    Date: { now: () => now }, visibleControl: () => {},
    run: async () => { lookups++; now += lookupMs; if (lookupError) throw lookupError; return point; },
    until: async (fn, label) => { const result = await fn(); if (!result) throw new Error(`missing ${label}`); return result; },
    send: (method, params) => {
      sent.push({ at: now, method, ...params });
      return Promise.resolve().then(() => { if (dispatchError) throw dispatchError; now += 10; });
    },
  });
  return { ...controls, sent, setTime: value => { now = value; }, lookups: () => lookups };
};

const f = fixture(), timing = {};
const prepared = await f.prepareClickText('PASS DECK', timing);
assert.equal(timing.lookupStartAt, 500);
assert.equal(timing.lookupCompleteAt, 650);
assert.equal(f.sent.length, 0);
f.setTime(1000);
assert.equal(await prepared(), 1000);
assert.equal(f.lookups(), 1, 'dispatch does not await another geometry lookup');
assert.equal(timing.pressDispatchAt, 1000);
assert.equal(timing.releaseDispatchAt, 1000);
assert.deepEqual(f.sent.map(e => [e.type, e.at, e.x, e.y]), [
  ['mousePressed', 1000, 30, 40], ['mouseReleased', 1000, 30, 40],
]);

const late = fixture(), lateClick = await late.prepareClickText('PASS DECK');
late.setTime(1101);
const lateAt = await lateClick();
assert.equal(lateAt, 1101, 'timestamp is dispatch time, never geometry time or timer-arm time');
assert.ok(Math.abs(lateAt - 1000) > 100, 'a genuinely late dispatch still exceeds the unchanged gate');
assert.ok(source.includes("if (timedHandoff) assert.ok(Math.abs(events.actionAt - events.passTargetAt) <= 100, 'PASS DECK within 100ms of the handoff target')"));
const browserGuard = source.slice(source.indexOf('assert.ok(Number.isFinite(events.passDeckTiming.browserClickAt)'), source.indexOf("'PASS DECK browser click within 100ms of the handoff target'"));
assert.ok(browserGuard.includes('Math.abs(events.passDeckTiming.browserClickAt - events.passTargetAt) <= 100'));
for (const browserClickAt of [899, 1101, null, undefined, NaN])
  assert.equal(runInNewContext(`Number.isFinite(at) && Math.abs(at - target) <= 100`, {at:browserClickAt, target:1000}), false);
for (const browserClickAt of [900, 1000, 1100])
  assert.equal(runInNewContext(`Number.isFinite(at) && Math.abs(at - target) <= 100`, {at:browserClickAt, target:1000}), true);
assert.ok(source.indexOf("passDeckClick = await host.prepareClickText('PASS DECK'") < source.indexOf('await pause(events.passTargetAt - Date.now());'));
assert.ok(source.indexOf("assert.ok(Date.now() < events.passTargetAt, 'DJ queue ready before the handoff target')") > source.indexOf("passDeckClick = await host.prepareClickText('PASS DECK'"));

const ordinary = fixture();
assert.equal(await ordinary.clickText('OTHER BUTTON'), 650, 'untimed clicks retain lookup-then-dispatch behavior');
assert.equal(ordinary.lookups(), 1);
const empty = fixture({ point: null });
await assert.rejects(empty.prepareClickText('PASS DECK'), /missing PASS DECK/);
assert.equal(empty.sent.length, 0);
const broken = fixture({ lookupError: new Error('lookup failed') });
await assert.rejects(broken.prepareClickText('PASS DECK'), /lookup failed/);
assert.equal(broken.sent.length, 0);
const failedDispatch = fixture({ dispatchError: new Error('dispatch failed') });
const failedClick = await failedDispatch.prepareClickText('PASS DECK');
await assert.rejects(failedClick(), /dispatch failed/);
console.log('PASS DECK controls PASS: pre-resolved geometry; ordered press/release submitted without an ACK round trip; unchanged dispatch gate plus actual-browser 100ms gate; untimed, empty, late and error cases.');
