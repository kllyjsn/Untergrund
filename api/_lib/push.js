// Daily Drop notifications: Web Push subscriptions in Redis, a daily send (Vercel cron) and cleanup of dead/stale ones.
// Env-gated: without VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (and Redis on Vercel) GET reports enabled:false and nothing else runs.
import { createHash, timingSafeEqual } from 'node:crypto';
import { dailyDrop, dropDate, isDropDate } from '../../js/daily.js';
import { vapidKeys, sendPush, unb64 } from './webpush.js';

const SUBS = 'untergrund:push:subs', sentKey = (d) => `untergrund:push:sent:${d}`, rateKey = (c) => `untergrund:push:rl:${c}`;
export const MAX_SUBS = 20000, STALE_DAYS = 60, PER_HOUR = 30, BATCH = 25;
const DAY = 864e5;
// Only real browser push services, so a subscription can't point the daily send at an arbitrary URL.
export const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|google\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

const hash = (v) => createHash('sha256').update(String(v || '')).digest('hex');
export const subId = (endpoint) => hash(endpoint).slice(0, 24);
const int = (v, max) => (Number.isFinite(+v) ? Math.max(0, Math.min(max, Math.round(+v))) : 0);

export function pushEnv(env = process.env) {
  const keys = vapidKeys(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  return keys && { ...keys, subject: env.VAPID_SUBJECT || 'https://www.untergrund.sh', cronSecret: env.CRON_SECRET || '' };
}

export function cleanSubscription(s, hosts = PUSH_HOSTS) {
  const endpoint = String(s?.endpoint || '');
  if (endpoint.length > 1024) return null;
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || !hosts.test(url.hostname)) return null;
  const p256dh = String(s?.keys?.p256dh || ''), auth = String(s?.keys?.auth || '');
  const pub = unb64(p256dh);
  if (pub.length !== 65 || pub[0] !== 4 || unb64(auth).length !== 16) return null;
  return { endpoint, keys: { p256dh, auth } };
}

// The listener's streak as the app last reported it: consecutive drop days ending on `last`.
const cleanStreak = (b) => (isDropDate(b?.last) ? { streak: int(b.streak, 3650), last: b.last } : { streak: 0, last: '' });

export function dropMessage(sub, date) {
  const d = dailyDrop(date);
  const yesterday = dropDate(Date.parse(`${date}T00:00:00Z`) - DAY);
  const alive = sub.last === yesterday && sub.streak > 0;
  return {
    title: `Today’s drop: ${d.title}`,
    body: alive ? `${d.genre} · Play it for a ${sub.streak + 1}-day streak.` : `${d.genre} · One new track for everyone today.`,
    url: `/?drop=${d.date}&from=push`, tag: 'daily-drop',
  };
}

const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };
async function allSubs(kv) {
  const flat = (await kv.cmd(['HGETALL', SUBS])) || [];
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) { const s = parse(flat[i + 1]); if (s?.endpoint) out.push({ id: flat[i], ...s }); }
  return out;
}

export async function sendDaily({ kv, vapid, now = Date.now(), force = false, fetchImpl = fetch }) {
  const date = dropDate(now);
  // Cron retries and double invocations must not ping anyone twice.
  if (!force && !(await kv.cmd(['SET', sentKey(date), '1', 'NX', 'EX', String(3 * 86400)]))) return { date, skipped: 'already_sent' };
  const subs = await allSubs(kv);
  const r = { date, total: subs.length, sent: 0, played: 0, expired: 0, stale: 0, failed: 0 };
  const drop = async (id) => { await kv.cmd(['HDEL', SUBS, id]); };
  const due = [];
  for (const s of subs) {
    if (now - (Date.parse(s.seen) || 0) > STALE_DAYS * DAY) { r.stale++; await drop(s.id); }
    else if (s.last === date) r.played++;
    else due.push(s);
  }
  for (let i = 0; i < due.length; i += BATCH) {
    await Promise.all(due.slice(i, i + BATCH).map(async (s) => {
      try {
        const status = await sendPush(s, dropMessage(s, date), vapid, { topic: 'daily-drop', fetchImpl });
        if (status === 404 || status === 410) { r.expired++; await drop(s.id); }
        else if (status >= 200 && status < 300) r.sent++;
        else r.failed++;
      } catch { r.failed++; }
    }));
  }
  return r;
}

const authorized = (header, secret) => {
  if (!secret) return false;
  const a = Buffer.from(String(header || '')), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
};

// GET: public config. GET with `Authorization: Bearer $CRON_SECRET`: the daily send. POST: subscribe / unsubscribe / renew.
export async function handlePush({ method, query = {}, headers = {}, body, kv, env = process.env, client = '', now = Date.now(), hosts = PUSH_HOSTS, fetchImpl = fetch }) {
  const vapid = pushEnv(env);
  const enabled = !!(vapid && kv);
  if (method === 'GET' && (headers.authorization || query.send)) {
    if (!authorized(headers.authorization, vapid?.cronSecret)) return { status: 401, json: { error: 'unauthorized' } };
    if (!enabled) return { status: 503, json: { error: 'push_disabled' } };
    return { status: 200, json: await sendDaily({ kv, vapid, now, force: query.force === '1', fetchImpl }) };
  }
  if (method === 'GET') return { status: 200, json: enabled ? { enabled, publicKey: vapid.publicKey } : { enabled: false } };
  if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  if (!enabled) return { status: 503, json: { enabled: false, error: 'push_disabled' } };
  const b = typeof body === 'string' ? parse(body || '{}') : body;
  if (!b || typeof b !== 'object') return { status: 400, json: { error: 'bad_request' } };

  if (b.action === 'unsubscribe') {
    if (typeof b.endpoint !== 'string' || !b.endpoint) return { status: 400, json: { error: 'bad_request' } };
    await kv.cmd(['HDEL', SUBS, subId(b.endpoint)]);
    return { status: 200, json: { ok: true } };
  }
  if (b.action !== 'subscribe' && b.action !== 'renew') return { status: 400, json: { error: 'bad_action' } };
  const sub = cleanSubscription(b.subscription, hosts);
  if (!sub) return { status: 400, json: { error: 'bad_subscription' } };
  const rl = rateKey(hash(client).slice(0, 16));
  const hits = await kv.cmd(['INCR', rl]);
  if (hits === 1) await kv.cmd(['EXPIRE', rl, '3600']);
  if (hits > PER_HOUR) return { status: 429, json: { error: 'rate_limited' } };

  const id = subId(sub.endpoint);
  let prev = parse(await kv.cmd(['HGET', SUBS, id]));
  // The browser rotated the subscription (service worker `pushsubscriptionchange`): carry the streak over.
  if (b.action === 'renew' && typeof b.old === 'string' && b.old && b.old !== sub.endpoint) {
    const oldId = subId(b.old);
    prev = prev || parse(await kv.cmd(['HGET', SUBS, oldId]));
    await kv.cmd(['HDEL', SUBS, oldId]);
  }
  if (!prev && +(await kv.cmd(['HLEN', SUBS])) >= MAX_SUBS) return { status: 507, json: { error: 'full' } };
  const streak = b.action === 'renew' && prev ? { streak: prev.streak || 0, last: prev.last || '' } : cleanStreak(b);
  const seen = new Date(now).toISOString();
  await kv.cmd(['HSET', SUBS, id, JSON.stringify({ ...sub, ...streak, created: prev?.created || seen, seen })]);
  return { status: prev ? 200 : 201, json: { ok: true } };
}
