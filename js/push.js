// Daily Drop notifications: a listener's drop streak (local) and opt-in Web Push (api/push.js).
// iOS only offers push to the installed home-screen app (16.4+), and only from a tap, so enablePush() must run in a click handler.
import { dropDate } from './daily.js';

const DAYS = 'untergrund.dropDays', SYNCED = 'untergrund.pushSynced', OFFERED = 'untergrund.pushOffered';
const DAY = 864e5, KEEP = 400, OFFER_GAP = 21 * DAY, OFFER_MAX = 2;
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const prev = (date) => dropDate(Date.parse(`${date}T00:00:00Z`) - DAY);

export const playedDays = () => { const d = read(DAYS, []); return Array.isArray(d) ? d.filter((x) => typeof x === 'string') : []; };

// Consecutive drop days played, ending today, or yesterday while today's is still unplayed.
export function dropStreak(days = playedDays(), today = dropDate()) {
  const set = new Set(days);
  let d = set.has(today) ? today : prev(today), n = 0;
  while (set.has(d)) { n++; d = prev(d); }
  return n;
}

let config = null, reg = null, sub = null, ready = null;
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());
export const onPushChange = (fn) => listeners.add(fn);

export const pushSupported = () => typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// 'unsupported' | 'disabled' (server has no keys) | 'denied' | 'off' | 'on'; 'loading' until initPush() settles.
export function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (!config) return 'loading';
  if (!config.enabled || !reg) return 'disabled';
  if (sub) return 'on';
  return Notification.permission === 'denied' ? 'denied' : 'off';
}

const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const sameKey = (s) => {
  const k = s.options?.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k), b = keyBytes(config.publicKey);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};
const post = (body) => fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then((r) => { if (!r.ok) throw new Error(`push ${r.status}`); });

function sync(force = false) {
  if (!sub) return Promise.resolve();
  const today = dropDate();
  if (!force && localStorage.getItem(SYNCED) === today) return Promise.resolve();
  const days = playedDays();
  const last = [...days].sort().pop() || '';
  const sent = post({ action: 'subscribe', subscription: sub.toJSON(), streak: last ? dropStreak(days, last) : 0, last })
    .then(() => localStorage.setItem(SYNCED, today));
  return force === 'strict' ? sent : sent.catch(() => {});
}

export function initPush() {
  if (ready) return ready;
  ready = (async () => {
    if (!pushSupported()) return;
    config = await fetch('/api/push').then((r) => (r.ok ? r.json() : { enabled: false })).catch(() => ({ enabled: false }));
    if (config.enabled) {
      reg = await Promise.race([navigator.serviceWorker.ready, new Promise((ok) => setTimeout(ok, 8000))]) || null;
      sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
      // The VAPID key was rotated: swap to a subscription the server can still sign for.
      if (sub && !sameKey(sub)) {
        await sub.unsubscribe().catch(() => {});
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) }).catch(() => null);
        if (sub) await sync(true);
      } else await sync();
    }
    changed();
  })();
  return ready;
}

export async function enablePush() {
  if (!reg || !config?.enabled) return 'disabled';
  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) });
  } catch {
    changed();
    return Notification.permission === 'denied' ? 'denied' : 'off';
  }
  try {
    await sync('strict');
  } catch {
    // The server didn't take it (rate limit, unknown push host, storage down): don't claim alerts are on.
    await sub.unsubscribe().catch(() => {});
    sub = null;
    changed();
    return 'failed';
  }
  changed();
  return 'on';
}

export async function disablePush() {
  const s = sub;
  sub = null;
  localStorage.removeItem(SYNCED);
  if (s) {
    await post({ action: 'unsubscribe', endpoint: s.endpoint }).catch(() => {});
    await s.unsubscribe().catch(() => {});
  }
  changed();
}

// Only today's drop counts toward the streak (replaying an old one from the jukebox doesn't fill a gap).
export function recordDropPlay(date) {
  const days = playedDays();
  if (date !== dropDate() || days.includes(date)) return;
  write(DAYS, [...days, date].sort().slice(-KEEP));
  sync(true);
  changed();
}

// The one-time opt-in sheet: only after they've played a drop, never while undecided twice, at most every 3 weeks.
export function shouldOffer(now = Date.now()) {
  if (pushState() !== 'off' || Notification.permission !== 'default' || !playedDays().length) return false;
  const o = read(OFFERED, { n: 0, at: 0 });
  return o.n < OFFER_MAX && now - o.at > OFFER_GAP;
}
export const markOffered = (now = Date.now()) => { const o = read(OFFERED, { n: 0, at: 0 }); write(OFFERED, { n: o.n + 1, at: now }); };
