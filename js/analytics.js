// Anonymous product analytics + error reporting, sent in batches to /api/events.
// No PII: only event names, a whitelisted handful of short props, and a random per-tab session id.
// Disabled entirely under Do Not Track / Global Privacy Control and for automated browsers.
const ENDPOINT = '/api/events';
const FIRST_SEEN = 'untergrund.firstSeen', LAST_DAY = 'untergrund.lastVisitDay', SESSION = 'untergrund.sid', LISTENER = 'untergrund.lid';
const ID = /^[a-z0-9]{8,32}$/;
const randomId = () => Array.from({ length: 16 }, () => ((Math.random() * 36) | 0).toString(36)).join('');

export const localDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayIndex = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / 864e5);
export const retentionBucket = (days) => (days === 1 ? 'd1' : days < 7 ? 'd2_6' : days === 7 ? 'd7' : days < 30 ? 'd8_29' : 'd30_plus');

export function privacyOptOut(win) {
  const n = win.navigator || {};
  return n.doNotTrack === '1' || n.doNotTrack === 'yes' || win.doNotTrack === '1' || n.msDoNotTrack === '1' || n.globalPrivacyControl === true;
}

const safeStore = (s) => ({
  get: (k) => { try { return s?.getItem(k) ?? null; } catch { return null; } },
  set: (k, v) => { try { s?.setItem(k, v); } catch {} },
});

export function createAnalytics({ win = globalThis, now = () => Date.now(), flushMs = 8000, maxBatch = 20, maxErrors = 8, force = false } = {}) {
  const nav = win.navigator || {};
  const enabled = force || !(privacyOptOut(win) || nav.webdriver);
  const local = safeStore(win.localStorage), session = safeStore(win.sessionStorage);
  let sid = session.get(SESSION);
  if (!ID.test(sid || '')) { sid = randomId(); session.set(SESSION, sid); }
  // Listen signals also carry a random per-device listener id (made only when analytics is on), so taste can be learned across visits.
  let lid = '';
  const listener = () => {
    if (lid || !enabled) return lid;
    lid = local.get(LISTENER);
    if (!ID.test(lid || '')) { lid = randomId(); local.set(LISTENER, lid); }
    return lid;
  };
  const queue = [];
  let timer = 0, offline = false, playTimer = 0, errorsSent = 0;
  const seenErrors = new Set();

  const route = () => {
    const l = win.location || {};
    const keys = l.search ? [...new URLSearchParams(l.search).keys()].sort().join('&') : '';
    const studio = win.document?.body?.classList?.contains('studio-open') ? '#studio' : '';
    return `${l.pathname || '/'}${keys ? `?${keys}` : ''}${studio}`;
  };

  function send(beacon) {
    clearTimeout(timer); timer = 0;
    if (!queue.length || offline) { queue.length = 0; return; }
    const body = JSON.stringify({ sid, route: route(), events: queue.splice(0, 40) });
    if (queue.length) schedule(0);
    if (beacon && nav.sendBeacon) {
      try { if (nav.sendBeacon(ENDPOINT, body)) return; } catch {}
    }
    if (!win.fetch) return;
    win.fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } })
      .then((r) => r.json()).then((j) => { if (j?.enabled === false) offline = true; }).catch(() => {});
  }
  const schedule = (ms) => { if (!timer) timer = setTimeout(() => send(false), ms); };
  const push = (event, urgent) => {
    if (!enabled) return false;
    queue.push(event);
    if (queue.length >= maxBatch) send(false);
    else schedule(urgent ? 1500 : flushMs);
    return true;
  };

  function track(name, props = {}) {
    const p = {};
    for (const [k, v] of Object.entries(props || {})) if (['string', 'number', 'boolean'].includes(typeof v)) p[k] = typeof v === 'string' ? v.slice(0, 32) : v;
    return push({ n: String(name), p, t: now() });
  }

  // A listen signal (js/listen.js): kind + genre are counted like any event; `l` is the full record, kept for learning.
  function signal(kind, rec = {}) {
    const l = { lid: listener() };
    for (const [k, v] of Object.entries(rec || {})) if (['string', 'number', 'boolean'].includes(typeof v)) l[k] = typeof v === 'string' ? v.slice(0, k === 'pt' ? 120 : 40) : v;
    return push({ n: 'listen', p: { kind: String(kind), genre: String(rec?.style || '').slice(0, 32) }, l, t: now() }, kind === 'love' || kind === 'unlove');
  }

  function reportError(err, { kind = 'error', source = '' } = {}) {
    const message = String(err?.message || err?.reason?.message || err || 'Unknown error').slice(0, 300);
    const sig = `${kind}:${message}`;
    if (seenErrors.has(sig) || errorsSent >= maxErrors) return false;
    seenErrors.add(sig); errorsSent++;
    return push({ n: 'error', t: now(), e: { kind, message, stack: String(err?.stack || '').slice(0, 2000), source: String(source).slice(0, 200), ua: String(nav.userAgent || '').slice(0, 200), route: route() } }, true);
  }

  // play_start once per transport start; play_30s if it keeps playing for 30 seconds.
  function playStarted(props = {}) {
    if (playTimer) return;
    track('play_start', props);
    playTimer = setTimeout(() => { track('play_30s', props); }, 30000);
  }
  function playStopped() { clearTimeout(playTimer); playTimer = 0; }

  function visit() {
    const today = localDay(now());
    const first = local.get(FIRST_SEEN);
    if (!first) local.set(FIRST_SEEN, today);
    track('app_open', { visitor: first ? 'returning' : 'new' });
    if (first && local.get(LAST_DAY) !== today) {
      const days = Math.max(0, dayIndex(today) - dayIndex(first));
      if (days >= 1) track('return_visit', { days: Math.min(days, 365), bucket: retentionBucket(days) });
    }
    local.set(LAST_DAY, today);
  }

  function install() {
    if (!enabled || !win.addEventListener) return;
    win.addEventListener('error', (e) => {
      if (e?.error || e?.message) reportError(e.error || { message: e.message }, { kind: 'window', source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '' });
    });
    win.addEventListener('unhandledrejection', (e) => reportError(e?.reason instanceof Error ? e.reason : { message: String(e?.reason) }, { kind: 'promise' }));
    win.addEventListener('pagehide', () => send(true));
    win.document?.addEventListener?.('visibilitychange', () => { if (win.document.visibilityState === 'hidden') send(true); });
    visit();
    // Free Vercel Web Analytics (page views) on the deployed site; enable it in the Vercel dashboard.
    const host = win.location?.hostname || '';
    if (win.document?.head && /(^|\.)untergrund\.sh$|\.vercel\.app$/.test(host)) {
      win.va = win.va || function va(...a) { (win.vaq = win.vaq || []).push(a); };
      const s = win.document.createElement('script');
      s.defer = true; s.src = '/_vercel/insights/script.js';
      win.document.head.append(s);
    }
  }

  return { enabled, sid, get lid() { return listener(); }, track, signal, reportError, playStarted, playStopped, visit, install, flush: send, queue };
}

const browser = typeof window !== 'undefined' && typeof document !== 'undefined';
export const analytics = browser ? createAnalytics({ win: window }) : null;
analytics?.install();
// Lifecycle milestones (keep → share → go live), remembered on this device so Create can suggest the next step.
const MILESTONES = { publish: 'kept', share_link_copied: 'shared', video_export: 'shared', room_go_live: 'live' };
const didKey = (m) => `untergrund.did.${m}`;
export const did = (m) => { try { return localStorage.getItem(didKey(m)) === '1'; } catch { return false; } };
const trackHooks = new Set();
// Other modules can watch events as they're tracked (main.js turns publish/share/go live into listen signals).
export const onTrack = (fn) => { trackHooks.add(fn); return () => trackHooks.delete(fn); };
export const track = (name, props) => {
  if (MILESTONES[name]) try { localStorage.setItem(didKey(MILESTONES[name]), '1'); } catch {}
  for (const fn of trackHooks) try { fn(name, props || {}); } catch {}
  return analytics?.track(name, props);
};
export const signal = (kind, rec) => analytics?.signal(kind, rec);
export const flushEvents = () => analytics?.flush(true);
export const reportError = (err, opts) => analytics?.reportError(err, opts);
export const playStarted = (props) => analytics?.playStarted(props);
export const playStopped = () => analytics?.playStopped();
