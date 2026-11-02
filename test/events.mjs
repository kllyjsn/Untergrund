import assert from 'node:assert/strict';
import { handleEvents, memoryKv, parseBatch, summarize, BATCHES_PER_HOUR, ERRORS_PER_HOUR } from '../api/_lib/events.js';

const T0 = Date.parse('2026-11-01T12:00:00Z'), DAY = 864e5;
const post = (kv, body, extra = {}) => handleEvents({ method: 'POST', body, kv, client: '1.2.3.4', now: T0, ...extra });
const batch = (sid, ...events) => ({ sid, route: '/', events: events.map(([n, p]) => ({ n, p })) });

// No storage configured: ingest is a silent no-op, summary reports disabled.
assert.deepEqual((await post(null, batch('abcdefgh12', ['app_open']))).json, { ok: true, enabled: false });
assert.equal((await handleEvents({ method: 'GET', kv: null })).json.enabled, false);
assert.equal((await handleEvents({ method: 'GET', query: { summary: '1', token: 't' }, kv: null, statsToken: 't' })).status, 503);

// Validation: unknown events and props are dropped, junk is rejected.
assert.equal((await post(memoryKv(), 'not json')).status, 400);
assert.equal((await post(memoryKv(), { events: 'x' })).status, 400);
assert.equal((await post(memoryKv(), 'x'.repeat(40_000))).status, 413);
const parsed = parseBatch(JSON.stringify(batch('abcdefgh12', ['generate', { genre: 'ACID!', email: 'a@b.com', bars: 16.4, nested: { x: 1 } }], ['hack', {}])));
assert.deepEqual(parsed.events, [{ n: 'generate', p: { genre: 'acid', bars: 16 } }]);
assert.equal(parseBatch({ sid: '<script>', events: [] }).sid, '');

// Ingest + summary through the in-memory Redis mock.
const kv = memoryKv();
for (const [i, sid] of ['aaaaaaaa01', 'aaaaaaaa02', 'aaaaaaaa03', 'aaaaaaaa04'].entries()) {
  const evs = [['app_open', { visitor: 'new' }]];
  if (i < 3) evs.push(['generate', { genre: 'acid' }], ['generate', { genre: 'acid' }], ['play_start', {}]);
  if (i < 2) evs.push(['play_30s', {}]);
  if (i < 1) evs.push(['publish', { kind: 'song' }], ['share_link_copied', { what: 'room' }]);
  assert.equal((await post(kv, batch(sid, ...evs), { now: T0 - DAY })).status, 202);
}
await post(kv, batch('bbbbbbbb01', ['app_open', { visitor: 'returning' }], ['return_visit', { bucket: 'd1', days: 1 }]));
await post(kv, JSON.stringify({ sid: 'bbbbbbbb01', route: '/?room', events: [{ n: 'error', e: { kind: 'audio_context', message: 'NotAllowedError', stack: 'at ensureAudio' } }] }), { headers: { 'user-agent': 'TestUA/1' } });

assert.equal((await handleEvents({ method: 'GET', query: { summary: '1' }, kv, statsToken: '' })).status, 404, 'stats disabled without STATS_TOKEN');
assert.equal((await handleEvents({ method: 'GET', query: { summary: '1', token: 'nope' }, kv, statsToken: 'secret' })).status, 401);
const ok = await handleEvents({ method: 'GET', query: { summary: '1' }, headers: { 'x-stats-token': 'secret' }, kv, statsToken: 'secret', now: T0 });
assert.equal(ok.status, 200);
const s = ok.json;
assert.equal(s.days, 30);
assert.equal(s.daily.length, 30);
assert.equal(s.daily.at(-1).date, '2026-11-01');
const yesterday = s.daily.at(-2);
assert.equal(yesterday.counts.generate, 6);
assert.equal(yesterday.counts['generate:acid'], 6);
assert.equal(yesterday.uniques.generate, 3);
assert.equal(yesterday.uniques.session, 4);
assert.deepEqual(s.funnel.map((f) => f.sessions), [5, 3, 3, 2, 1, 1]);
assert.equal(s.funnel[1].ofFirst, 3 / 5);
assert.equal(s.funnel[3].ofPrev, 2 / 3);
assert.deepEqual(s.retention.d1, { returned: 1, cohort: 4, rate: 0.25 });
assert.equal(s.period[1].session, 1);
assert.equal(s.errors.length, 1);
assert.equal(s.errors[0].kind, 'audio_context');
assert.equal(s.errors[0].ua, 'TestUA/1');
assert.equal(s.errors[0].route, '/?room');
assert.equal(s.totals['error:audio_context'], 1);
assert.equal((await summarize(kv, { days: 7, now: T0 })).daily.length, 7);
console.log('events endpoint passed');

// Rate limits: batches per client per hour, and a tighter cap on stored errors.
const rl = memoryKv();
for (let i = 0; i < BATCHES_PER_HOUR; i++) assert.equal((await post(rl, batch('cccccccc01', ['app_open']))).status, 202);
assert.equal((await post(rl, batch('cccccccc01', ['app_open']))).status, 429);
assert.equal((await post(rl, batch('cccccccc01', ['app_open']), { client: '5.6.7.8' })).status, 202);
const er = memoryKv();
const errBatch = (i) => ({ sid: 'dddddddd01', events: [{ n: 'error', e: { message: `boom ${i}` } }] });
for (let i = 0; i < ERRORS_PER_HOUR + 10; i++) await post(er, errBatch(i));
const errs = (await summarize(er, { now: T0 })).errors;
assert.equal(errs.length, Math.min(50, ERRORS_PER_HOUR));
assert(![...er.data.keys()].some((k) => k.includes('1.2.3.4')), 'client IPs are hashed, never stored');
console.log('events rate limit passed');
