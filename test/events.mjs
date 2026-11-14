import assert from 'node:assert/strict';
import { handleEvents, memoryKv, parseBatch, summarize, cleanListen, listenRates, BATCHES_PER_HOUR, ERRORS_PER_HOUR, LISTENS_PER_HOUR } from '../api/_lib/events.js';

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

// Listen signals: validated record, counted per kind/genre/song, raw log behind the stats token.
{
  const rec = { v: 1, lis: 'abcdef1234', lid: 'abcdefgh12345678', fp: 'abcdefg1234567', tid: 'trk-1', seed: 42, style: 'ACID', src: 'prompt', surf: 'home',
    ph: 'xyz12', bar: 30, bars: 32, sec: 'Drop 2', pct: 94, ms: 61000, pt: 'dark acid', email: 'a@b.com' };
  const c = cleanListen({ ...rec, t: T0 }, { kind: 'start' });
  assert.deepEqual(c, { v: 1, kind: 'start', lis: 'abcdef1234', lid: 'abcdefgh12345678', fp: 'abcdefg1234567', tid: 'trk-1', seed: 42, style: 'acid', src: 'prompt', surf: 'home',
    ph: 'xyz12', bar: 30, bars: 32, sec: 'drop2', pct: 94, ms: 61000, t: T0, pt: 'dark acid' });
  assert.equal(cleanListen({ ...rec, pt: 'x' }, { kind: 'skip' }).pt, undefined, 'prompt text only on start');
  assert.equal(cleanListen(rec, { kind: 'bogus' }), null);
  assert.equal(cleanListen({ ...rec, via: 'k3j9x0aa' }, { kind: 'start' }).via, 'k3j9x0aa', 'share-origin start keeps its ref');
  assert.equal(cleanListen({ ...rec, via: '<script>' }, { kind: 'start' }).via, undefined);
  assert.equal(cleanListen({ ...rec, ref: 'k3j9x0aa' }, { kind: 'share' }).ref, 'k3j9x0aa', 'a share records the ref it minted');
  assert.equal(cleanListen({ ...rec, ref: 'k3j9x0aa' }, { kind: 'start' }).ref, undefined, 'minted ref only on share');
  assert.equal(cleanListen({ ...rec, fp: '<b>' }, { kind: 'start' }), null, 'no fingerprint, no signal');
  const alone = cleanListen({ ...rec, lis: '', ref: 'k3j9x0aa', surf: 'studio' }, { kind: 'share' });
  assert.deepEqual([alone.lis, alone.fp, alone.tid, alone.ref, alone.surf], ['', 'abcdefg1234567', 'trk-1', 'k3j9x0aa', 'studio'], 'a share before playing stands alone');
  assert.equal(cleanListen({ ...rec, lis: '' }, { kind: 'start' }), null, 'only a share can stand alone');
  const junk = cleanListen({ lis: 'abcdef1234', fp: 'abcdefg1234567', lid: 'x', seed: 'nope', pct: 400, ms: -5 }, { kind: 'love' });
  assert.deepEqual([junk.lid, junk.seed, junk.pct, junk.ms], ['', -1, 100, 0]);

  const lk = memoryKv();
  const sig = (kind, extra = {}) => ({ n: 'listen', p: { kind, genre: 'acid' }, l: { ...rec, ...extra }, t: T0 });
  const body = { sid: 'cccccccc01', route: '/', events: [sig('start'), sig('replay'), sig('complete'), sig('love'), sig('share'), sig('start', { lis: 'bbbbbb1234', fp: 'bbbbbbb1234567', style: 'techno' }), sig('skip', { lis: 'bbbbbb1234', fp: 'bbbbbbb1234567', style: 'techno' })] };
  assert.equal((await post(lk, body)).status, 202);
  const get = (query, token = 'secret') => handleEvents({ method: 'GET', query: { ...query, token }, kv: lk, statsToken: 'secret', now: T0 });
  const L = (await get({ summary: '1' })).json.listening;
  assert.equal(L.kinds.start, 2);
  assert.equal(L.rates.completion, 0.5);
  assert.equal(L.rates.skip, 0.5);
  assert.deepEqual(L.styles.map((x) => [x.style, x.starts, x.rates.completion, x.rates.love]), [['acid', 1, 1, 1], ['techno', 1, 0, 0]]);
  assert.equal((await get({ signals: '1' }, 'nope')).status, 401, 'raw signals need the stats token');
  const raw = (await get({ signals: '1', fp: 'abcdefg1234567', limit: '3' })).json;
  assert.equal(raw.signals.length, 3);
  assert.equal(raw.signals[0].kind, 'skip', 'newest first');
  assert.equal(raw.signals[0].sid, 'cccccccc01');
  assert.ok(raw.signals.every((x) => !('email' in x)));
  assert.deepEqual(raw.song.counts, { start: 1, replay: 1, complete: 1, love: 1, share: 1 });
  assert.equal(raw.song.rates.share, 1);
  assert.deepEqual(listenRates({ start: 2, love: 1, unlove: 2 }).love, 0, 'unlove cancels love, never negative');
  assert.equal(listenRates({ start: 4, down: 3, undown: 1 }).down, 0.5, 'net downs per start');
  // Down reasons are a closed set; cohort/device are enums; structure only on start; rewinds carry their target bar.
  assert.equal(cleanListen({ ...rec, why: 'boring' }, { kind: 'why' }).why, 'boring');
  assert.equal(cleanListen({ ...rec, why: 'it was too long' }, { kind: 'why' }), null, 'no free-text reasons');
  assert.equal(cleanListen({ ...rec, why: 'boring' }, { kind: 'down' }).why, undefined);
  const ctxRec = cleanListen({ ...rec, co: 'd1_6', dev: 'phone', arr: 'intro-8.drop-16' }, { kind: 'start' });
  assert.deepEqual([ctxRec.co, ctxRec.dev, ctxRec.arr], ['d1_6', 'phone', 'intro-8.drop-16']);
  const badCtx = cleanListen({ ...rec, co: 'week', dev: 'iphone 15', arr: '<script>' }, { kind: 'start' });
  assert.deepEqual([badCtx.co, badCtx.dev, badCtx.arr], [undefined, undefined, undefined]);
  assert.equal(cleanListen({ ...rec, arr: 'aabb' }, { kind: 'skip' }).arr, undefined);
  assert.equal(cleanListen({ ...rec, to: 4 }, { kind: 'rewind' }).to, 4);
  // The improvement report: stats token only, built from the raw log.
  assert.equal((await get({ improve: '1' }, 'nope')).status, 401);
  const rep = (await get({ improve: '1' })).json;
  assert.equal(rep.version, 1);
  assert.equal(rep.totals.listens, 2);
  assert.ok(Array.isArray(rep.findings) && Array.isArray(rep.experiments));

  // Per-client hourly budget for listen records.
  const rk = memoryKv();
  for (let i = 0; i < 12; i++) await post(rk, { sid: 'dddddddd01', route: '/', events: Array.from({ length: 30 }, () => sig('start')) });
  const kept = (await handleEvents({ method: 'GET', query: { signals: '1', limit: '1000', token: 'secret' }, kv: rk, statsToken: 'secret', now: T0 })).json.signals.length;
  assert.equal(kept, LISTENS_PER_HOUR);
}
console.log('listen events passed');
