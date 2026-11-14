import assert from 'node:assert/strict';
import { assign, bucket, inScope, isLive, experimentErrors, EXPERIMENTS } from '../js/experiments.js';
import { createListens } from '../js/listen.js';
import { createAnalytics } from '../js/analytics.js';
import { analyze, experimentResults, toMarkdown, METRICS } from '../api/_lib/improve.js';
import { handleEvents, memoryKv, cleanListen, readHistory, DAY_LOG, PAGE, HISTORY_DAYS } from '../api/_lib/events.js';

const T0 = Date.UTC(2026, 10, 20, 12), DAY = 864e5;
const exp = { id: 'techno-drop', lever: 'arrangement', scope: { style: 'techno', src: 'prompt' }, share: 0.1, primary: { metric: 'down', goal: 'lower' },
  guardrails: ['skip', 'complete'], minListensPerArm: 100, from: '2026-11-15' };

// ---- assignment: deterministic per listener, independent per experiment, scoped, ~share in the variant.
const lids = Array.from({ length: 4000 }, (_, i) => `listener${i.toString(36).padStart(6, '0')}`);
const ctx = { style: 'techno', src: 'prompt', surf: 'home', dev: 'phone', co: 'd1_6' };
assert.deepEqual(assign(lids[0], ctx, [exp], T0), assign(lids[0], ctx, [exp], T0 + 30 * DAY), 'same listener, same arm, every visit');
assert.equal(bucket(lids[0], 'a'), bucket(lids[0], 'a'));
const variant = lids.filter((l) => assign(l, ctx, [exp], T0).arm === 'variant').length / lids.length;
assert.ok(variant > 0.08 && variant < 0.12, `variant share ${variant}`);
const other = { ...exp, id: 'techno-sound' };
const both = lids.filter((l) => assign(l, ctx, [exp], T0).arm === 'variant' && assign(l, ctx, [other], T0).arm === 'variant').length / lids.length;
assert.ok(both < 0.03, 'arms of different experiments are independent');
assert.equal(assign(lids[0], { ...ctx, src: 'generate' }, [exp], T0), null, 'outside the scope: never assigned');
assert.equal(assign('', ctx, [exp], T0), null, 'no listener id (analytics off): never assigned');
assert.equal(assign(lids[0], ctx, [exp], Date.UTC(2026, 10, 1)), null, 'before `from`');
assert.equal(assign(lids[0], ctx, [{ ...exp, until: '2026-11-20' }], T0), null, '`until` is exclusive');
assert.ok(isLive(exp, T0) && inScope(exp, ctx));
assert.equal(assign(lids[0], ctx, [{ ...exp, share: 5 }], T0).arm !== undefined, true, 'a share above the cap is clamped, not trusted');
assert.equal(assign(lids[0], ctx, [exp, other], T0).xp, 'techno-drop', 'a listen is in at most one experiment');
assert.equal(assign(lids[0], ctx, [], T0), null);

// The shipped registry is valid (and empty until an experiment is started by a reviewed PR).
for (const e of EXPERIMENTS) assert.deepEqual(experimentErrors(e, Object.keys(METRICS)), [], e.id);
assert.deepEqual(experimentErrors(exp, Object.keys(METRICS)), []);
assert.deepEqual(experimentErrors({ ...exp, id: 'Bad Id', scope: { prompt: 'x' }, share: 0.9, guardrails: ['taste'] }, Object.keys(METRICS)), ['id', 'scope', 'share', 'guardrails']);

// ---- privacy: analytics off (Do Not Track / GPC / automated) gives no listener context, so nothing is assigned.
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const win = (nav) => ({ navigator: nav, localStorage: store(), sessionStorage: store(), innerWidth: 390, matchMedia: () => ({ matches: true }) });
for (const nav of [{ doNotTrack: '1' }, { globalPrivacyControl: true }, { webdriver: true }]) assert.deepEqual(createAnalytics({ win: win(nav) }).context(), {});
const on = createAnalytics({ win: win({}) }).context();
assert.match(on.lid, /^[a-z0-9]{16}$/);
assert.deepEqual([on.dev, on.co], ['phone', 'd0']);

// ---- tagging: every signal of a listen in an experiment carries xp + arm; others carry neither.
const sent = [];
const listens = createListens({ emit: (kind, rec) => sent.push({ kind, ...rec }), now: () => T0, store: store() });
listens.begin({ fp: 'abcdef1234567', style: 'techno', src: 'prompt', xp: 'techno-drop', arm: 'variant' });
listens.toggleDown({ bar: 4, bars: 32 });
listens.begin({ fp: 'zzzzzz1234567', style: 'acid', src: 'generate' });
assert.ok(sent.filter((s) => s.fp === 'abcdef1234567').every((s) => s.xp === 'techno-drop' && s.arm === 'variant'));
assert.ok(sent.filter((s) => s.fp === 'zzzzzz1234567').every((s) => !('xp' in s) && !('arm' in s)));
const rec = { fp: 'abcdef1234567', lis: 'lis0001', xp: 'techno-drop', arm: 'variant' };
assert.deepEqual([cleanListen(rec, { kind: 'start' }).xp, cleanListen(rec, { kind: 'start' }).arm], ['techno-drop', 'variant']);
assert.equal(cleanListen({ ...rec, arm: 'treatment' }, { kind: 'start' }).xp, undefined, 'unknown arms are dropped');
assert.equal(cleanListen({ ...rec, xp: '<b>' }, { kind: 'start' }).arm, undefined);

// ---- read-out: the experiment's own primary metric and guardrails, its stop rule, and findings without the variant arm.
let n = 0;
const listen = ({ lid, arm, down = false, outcome = 'complete', style = 'techno', src = 'prompt', t = T0 }) => {
  const base = { v: 1, lis: `l${(n++).toString(36).padStart(6, '0')}`, lid, fp: `fp${lid}`.slice(0, 14).padEnd(8, 'a'), style, src, surf: 'home', dev: 'desktop', co: 'd1_6', bars: 32, t, ...(arm ? { xp: 'techno-drop', arm } : {}) };
  return [{ ...base, kind: 'start', bar: 0 }, ...(down ? [{ ...base, kind: 'down', bar: 8, t: t + 1 }] : []), { ...base, kind: outcome, bar: 32, t: t + 2 }];
};
const fixture = (variantDown, variantSkip = 0) => {
  const out = [];
  for (let i = 0; i < 400; i++) {
    const lid = lids[i], arm = assign(lid, ctx, [exp], T0).arm;
    for (let k = 0; k < 2; k++) {
      const v = arm === 'variant', x = (i * 7 + k * 13) % 100;
      out.push(...listen({ lid, arm, down: x < (v ? variantDown : 30), outcome: v && x >= 100 - variantSkip ? 'skip' : 'complete', t: T0 + i * 1000 + k }));
    }
  }
  return out;
};
const ready = analyze(fixture(5), { now: T0, running: [{ ...exp, minListensPerArm: 50 }] });
const ro = ready.running[0];
assert.equal(ro.id, 'techno-drop');
assert.equal(ro.status, 'ready');
assert.equal(ro.verdict, 'variant_better', 'downs fell in the variant');
assert.ok(ro.primary.rate < ro.primary.base && ro.primary.metric === 'down');
assert.ok(ro.arms.variant.listens > 40 && ro.arms.control.listens > 500);
assert.equal(ready.totals.listens, 800, 'totals count every listen');
const collecting = analyze(fixture(5), { now: T0, running: [exp] }).running[0];
assert.equal(collecting.status, 'collecting', 'below minListensPerArm');
assert.equal(collecting.verdict, null);
const stopped = analyze(fixture(30, 40), { now: T0, running: [exp] }).running[0];
assert.equal(stopped.status, 'stop', 'a breached guardrail stops it early');
assert.ok(stopped.guardrails.find((g) => g.metric === 'skip').breached);
assert.equal(experimentResults([], [exp])[0].arms.variant.listens, 0, 'a running experiment with no listens yet is still listed');
assert.equal(analyze(fixture(5), { now: T0 }).running[0].status, 'ended', 'tags without a registry entry read out as ended');
assert.ok(!analyze(fixture(5), { now: T0, running: [exp] }).experiments.some((e) => e.scope.style === 'techno' && e.scope.src === 'prompt' && Object.keys(e.scope).length === 2),
  'no new proposal for a scope that is already running');
assert.match(toMarkdown(ready), /## Running experiments[\s\S]*techno-drop \| ready · variant_better/);

// ---- history: day logs read in pages, beyond the newest-5000 log; legacy records fill days without a day log.
const kv = memoryKv();
const sig = (kind, i) => ({ n: 'listen', p: { kind }, l: { v: 1, lis: `h${i.toString(36).padStart(6, '0')}`, lid: lids[i % 50], fp: 'abcdef1234567', style: 'acid', src: 'generate', surf: 'home' }, t: T0 });
for (let d = 0; d < 3; d++) for (let b = 0; b < 100; b++) {
  const events = Array.from({ length: 30 }, (_, j) => sig(j % 2 ? 'complete' : 'start', d * 3000 + b * 15 + (j >> 1)));
  assert.equal((await handleEvents({ method: 'POST', body: { sid: `sess${d}${String(b).padStart(5, '0')}`, route: '/', events }, kv, client: `10.0.${d}.${b}`, now: T0 - d * DAY })).status, 202);
}
const h = await readHistory(kv, { now: T0 });
assert.equal(h.signals.length, 9000, 'three days of 3000 records, past the 5000-record log');
assert.equal(h.coverage.pages, 9);
assert.deepEqual(h.coverage.capped, []);
assert.equal(h.coverage.days, HISTORY_DAYS);
assert.ok(PAGE < DAY_LOG);
assert.equal((await readHistory(kv, { now: T0, days: 1 })).signals.length, 3000);
// Records from before day logs existed: only in the 5000 log, counted once.
const legacyKv = memoryKv();
legacyKv.data.set('untergrund:ev:listen', [JSON.stringify({ at: new Date(T0 - DAY).toISOString(), kind: 'start', lis: 'old0001', fp: 'abcdef1234567', t: T0 - DAY }),
  JSON.stringify({ at: new Date(T0 - 40 * DAY).toISOString(), kind: 'start', lis: 'old0002', fp: 'abcdef1234567', t: T0 - 40 * DAY })]);
const lh = await readHistory(legacyKv, { now: T0 });
assert.deepEqual([lh.signals.length, lh.coverage.legacy], [1, 1], 'legacy records inside the window only');
const rep = (await handleEvents({ method: 'GET', query: { improve: '1', days: '2', token: 's' }, kv, statsToken: 's', now: T0 })).json;
assert.equal(rep.coverage.records, 6000);
assert.ok(Array.isArray(rep.running));

// ---- digest: STATS_TOKEN or Vercel's CRON_SECRET runs it, once a day; it is stored and optionally posted.
const posts = [];
const fetchImpl = async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
const digest = (query, auth, extra = {}) => handleEvents({ method: 'GET', query, headers: auth ? { authorization: `Bearer ${auth}` } : {}, kv, statsToken: 's', cronSecret: 'cron', webhook: 'https://hooks.example/x', fetchImpl, now: T0, ...extra });
assert.equal((await digest({ digest: 'run' })).status, 401);
assert.equal((await digest({ digest: 'run' }, 'wrong')).status, 401);
assert.equal((await digest({ summary: '1' }, 'cron')).status, 401, 'the cron secret only runs the digest');
assert.equal((await digest({ digest: 'run' }, 'cron', { statsToken: '' })).status, 404, 'stats off: no digest');
const ran = (await digest({ digest: 'run' }, 'cron')).json;
assert.equal(ran.ok, true);
assert.equal(ran.delivered, true);
assert.equal(ran.records, 9000);
assert.equal(posts.length, 1);
assert.match(posts[0].body.text, /# Listen findings/);
assert.equal((await digest({ digest: 'run' }, 's')).json.skipped, 'already_ran', 'cron retries never post twice');
assert.equal(posts.length, 1);
assert.equal((await digest({ digest: 'run', force: '1' }, 'cron')).json.skipped, 'already_ran', 'the cron secret cannot force a rerun');
assert.equal((await digest({ digest: 'run', force: '1' }, 's')).json.ok, true);
assert.equal(posts.length, 2, 'forced with the stats token');
const latest = (await digest({ digest: '1' }, 's')).json;
assert.equal(latest.digest.day, '2026-11-20');
assert.match(latest.digest.markdown, /# Listen findings/);
assert.equal(latest.history.length, 2);
assert.equal((await digest({ digest: '1' }, 'cron')).status, 401, 'reading the digest needs the stats token');
const quiet = memoryKv();
assert.equal((await handleEvents({ method: 'GET', query: { digest: 'run' }, headers: { authorization: 'Bearer s' }, kv: quiet, statsToken: 's', webhook: '', now: T0 })).json.delivered, false, 'no webhook: stored only');

// A run that fails part-way does not use up the day.
const flaky = memoryKv();
let fail = true;
const flakyKv = async (cmds) => { if (fail && cmds.some(([c, k]) => c === 'LLEN' || k === 'untergrund:ev:digest')) throw new Error('redis down'); return flaky(cmds); };
await assert.rejects(handleEvents({ method: 'GET', query: { digest: 'run' }, headers: { authorization: 'Bearer s' }, kv: flakyKv, statsToken: 's', now: T0 }));
fail = false;
assert.equal((await handleEvents({ method: 'GET', query: { digest: 'run' }, headers: { authorization: 'Bearer s' }, kv: flakyKv, statsToken: 's', now: T0 })).json.skipped, undefined, 'the retry runs');
fail = true;
await assert.rejects(handleEvents({ method: 'GET', query: { digest: 'run', force: '1' }, headers: { authorization: 'Bearer s' }, kv: flakyKv, statsToken: 's', now: T0 }));
fail = false;
assert.equal((await handleEvents({ method: 'GET', query: { digest: 'run' }, headers: { authorization: 'Bearer s' }, kv: flakyKv, statsToken: 's', now: T0 })).json.skipped, 'already_ran', 'a failed forced rerun keeps the successful run\'s marker');

console.log('experiments, history and digest passed');
