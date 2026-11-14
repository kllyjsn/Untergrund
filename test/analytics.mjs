import assert from 'node:assert/strict';
import { createAnalytics, privacyOptOut, retentionBucket, localDay, onTrack, track as trackModule } from '../js/analytics.js';

const storage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
function fakeWindow({ dnt, webdriver, local = storage() } = {}) {
  const listeners = {}, sent = [], beacons = [];
  const win = {
    navigator: { doNotTrack: dnt, webdriver, userAgent: 'TestUA', sendBeacon: (url, body) => { beacons.push({ url, body: JSON.parse(body) }); return true; } },
    localStorage: local, sessionStorage: storage(),
    location: { pathname: '/', search: '?room=night&x=1', hostname: 'localhost' },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    fetch: async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { json: async () => ({ ok: true }) }; },
  };
  win.emit = (type, e) => (listeners[type] || []).forEach((fn) => fn(e));
  return { win, sent, beacons, listeners };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

// Do Not Track / GPC / automation disable everything.
assert(privacyOptOut({ navigator: { doNotTrack: '1' } }));
assert(privacyOptOut({ navigator: { globalPrivacyControl: true } }));
assert(!privacyOptOut({ navigator: {} }));
for (const opts of [{ dnt: '1' }, { webdriver: true }]) {
  const { win, sent, beacons, listeners } = fakeWindow(opts);
  const a = createAnalytics({ win, flushMs: 1 });
  a.install();
  assert.equal(a.track('generate', { genre: 'acid' }), false);
  a.flush(true); await tick();
  assert.equal(sent.length + beacons.length, 0);
  assert.equal(Object.keys(listeners).length, 0, 'no listeners under DNT');
}

// Batching: events queue up and go out as one request at maxBatch; pagehide uses sendBeacon.
{
  const { win, sent, beacons } = fakeWindow();
  const a = createAnalytics({ win, flushMs: 60_000, maxBatch: 3 });
  a.install();
  a.track('generate', { genre: 'acid', nested: { a: 1 }, long: 'x'.repeat(100) });
  assert.equal(sent.length, 0);
  a.track('play_start');
  await tick();
  assert.equal(sent.length, 1, 'flushes once the batch is full');
  const b = sent[0].body;
  assert.equal(sent[0].url, '/api/events');
  assert.deepEqual(b.events.map((e) => e.n), ['app_open', 'generate', 'play_start']);
  assert.deepEqual(b.events[1].p, { genre: 'acid', long: 'x'.repeat(32) });
  assert.match(b.sid, /^[a-z0-9]{16}$/);
  assert.equal(b.route, '/?room&x', 'route keeps query keys, never values');
  a.track('export_wav', { bars: 16 });
  win.emit('pagehide');
  assert.equal(beacons.length, 1);
  assert.deepEqual(beacons[0].body.events.map((e) => e.n), ['export_wav']);
}

// return_visit: D1 / D7 from a localStorage first-seen date, once per day.
{
  const local = storage();
  let now = new Date(2026, 9, 1, 10).getTime();
  const open = () => { const { win } = fakeWindow({ local }); const a = createAnalytics({ win, now: () => now, flushMs: 60_000 }); a.visit(); return a.queue.map((e) => [e.n, e.p]); };
  assert.deepEqual(open(), [['app_open', { visitor: 'new' }]]);
  assert.equal(local.m.get('untergrund.firstSeen'), localDay(now));
  assert.deepEqual(open(), [['app_open', { visitor: 'returning' }]], 'same day is not a return visit');
  now += 864e5;
  assert.deepEqual(open()[1], ['return_visit', { days: 1, bucket: 'd1' }]);
  assert.equal(open().length, 1, 'only one return_visit per day');
  now += 6 * 864e5;
  assert.deepEqual(open()[1], ['return_visit', { days: 7, bucket: 'd7' }]);
  assert.deepEqual([3, 10, 40].map(retentionBucket), ['d2_6', 'd8_29', 'd30_plus']);
}

// Errors: window.onerror + unhandledrejection, deduped and capped per page.
{
  const { win, sent } = fakeWindow();
  const a = createAnalytics({ win, flushMs: 60_000, maxBatch: 100, maxErrors: 3 });
  a.install();
  a.queue.length = 0;
  const err = new Error('AudioContext was not allowed to start');
  win.emit('error', { error: err, message: err.message, filename: '/js/main.js', lineno: 60, colno: 9 });
  win.emit('error', { error: err, message: err.message });
  win.emit('unhandledrejection', { reason: new Error('decode failed') });
  a.reportError(new Error('x'), { kind: 'audio_context' });
  a.reportError(new Error('y'), { kind: 'audio_context' });
  const errors = a.queue.filter((e) => e.n === 'error');
  assert.equal(errors.length, 3, 'deduped and capped');
  assert.equal(errors[0].e.kind, 'window');
  assert.equal(errors[0].e.source, '/js/main.js:60:9');
  assert.match(errors[0].e.stack, /AudioContext was not allowed/);
  assert.equal(errors[0].e.ua, 'TestUA');
  assert.equal(errors[1].e.kind, 'promise');
  assert.equal(errors[2].e.kind, 'audio_context');
  a.flush(false); await tick();
  assert.equal(sent.at(-1).body.events.length, 3);
}

// play_start once per transport start, play_30s after 30 seconds of play.
{
  const { win } = fakeWindow();
  const a = createAnalytics({ win, flushMs: 60_000, maxBatch: 100 });
  const realSetTimeout = globalThis.setTimeout, timers = [];
  globalThis.setTimeout = (fn, ms) => { if (ms === 30000) { timers.push(fn); return 1; } return realSetTimeout(fn, ms); };
  try {
    a.playStarted({ genre: 'house' }); a.playStarted({ genre: 'house' });
    assert.equal(a.queue.filter((e) => e.n === 'play_start').length, 1);
    timers[0]();
    assert.deepEqual(a.queue.at(-1), { n: 'play_30s', p: { genre: 'house' }, t: a.queue.at(-1).t });
    a.playStopped(); a.playStarted({ genre: 'house' });
    assert.equal(a.queue.filter((e) => e.n === 'play_start').length, 2);
  } finally { globalThis.setTimeout = realSetTimeout; }
}

// Backend off: after the endpoint reports enabled:false the page stops sending.
{
  const { win, sent } = fakeWindow();
  win.fetch = async (url, opts) => { sent.push(opts); return { json: async () => ({ ok: true, enabled: false }) }; };
  const a = createAnalytics({ win, flushMs: 60_000 });
  a.track('generate'); a.flush(false); await tick();
  a.track('generate'); a.flush(false); await tick();
  assert.equal(sent.length, 1);
}
// Listen signals: full record rides along as `l` with a per-device listener id; nothing under DNT.
{
  const local = storage();
  const { win, sent } = fakeWindow({ local });
  const a = createAnalytics({ win, flushMs: 60_000 });
  const seen = [];
  const off = onTrack((n, p) => seen.push([n, p.kind]));
  assert.ok(a.signal('start', { v: 1, lis: 'abcdef1234', fp: 'abcdefg1234567', style: 'acid', seed: 7, pt: 'p'.repeat(200), sec: 's'.repeat(60), obj: { x: 1 } }));
  a.flush(false); await tick();
  const e = sent[0].body.events[0];
  assert.equal(e.n, 'listen');
  assert.deepEqual(e.p, { kind: 'start', genre: 'acid' });
  assert.match(e.l.lid, /^[a-z0-9]{16}$/);
  assert.equal(local.getItem('untergrund.lid'), e.l.lid, 'listener id persists per device');
  assert.equal(e.l.pt.length, 120);
  assert.equal(e.l.sec.length, 40);
  assert.equal(e.l.obj, undefined);
  assert.equal(e.l.co, 'd0', 'cohort: how long this device has listened');
  assert.equal(e.l.dev, 'desktop', 'device class, coarse');
  assert.equal(typeof e.t, 'number');
  assert.equal(createAnalytics({ win: fakeWindow({ local }).win }).lid, e.l.lid);
  trackModule('publish', { kind: 'song' });
  off();
  trackModule('publish', { kind: 'song' });
  assert.deepEqual(seen, [['publish', 'song']]);
  const dnt = fakeWindow({ dnt: '1' });
  const b = createAnalytics({ win: dnt.win });
  assert.equal(b.signal('love', { fp: 'abcdefg1234567' }), false);
  assert.equal(b.lid, '');
  assert.equal(dnt.win.localStorage.getItem('untergrund.lid'), null, 'no listener id without consent to analytics');
}
console.log('analytics module passed');
process.exit(0);
