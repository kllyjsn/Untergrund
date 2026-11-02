// First-party product analytics: anonymous funnel events + client errors stored as
// daily Redis counters (HINCRBY), daily unique sessions (HyperLogLog) and a short error log.
import { createHash, timingSafeEqual } from 'node:crypto';
import { redisEnv } from './crate.js';

export const EVENTS = ['app_open', 'generate', 'play_start', 'play_30s', 'save_track', 'publish', 'share_link_copied',
  'room_join', 'room_go_live', 'export_wav', 'return_visit', 'error'];
export const FUNNEL = ['app_open', 'generate', 'play_start', 'play_30s', 'publish', 'share_link_copied'];
// One prop per event is also counted as a breakdown field, e.g. `generate:acid`.
export const DIMENSION = { app_open: 'visitor', generate: 'genre', publish: 'kind', share_link_copied: 'what', return_visit: 'bucket', error: 'kind', save_track: 'shared' };
const PROPS = ['genre', 'kind', 'what', 'bucket', 'days', 'visitor', 'bars', 'shared', 'public'];
const P = 'untergrund:ev', TTL = 400 * 86400, MAX_EVENTS = 40, ERROR_LOG = 100;
export const MAX_BODY = 32_000, BATCHES_PER_HOUR = 400, ERRORS_PER_HOUR = 20;

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
const slug = (v) => text(v, 32).toLowerCase().replace(/[^a-z0-9_.-]/g, '');
export const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const hash = (v) => createHash('sha256').update(String(v || '')).digest();

export function cleanProps(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  for (const k of PROPS) {
    const v = p[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(-1e6, Math.min(1e6, Math.round(v)));
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && slug(v)) out[k] = slug(v);
  }
  return out;
}

function cleanError(e, ua, route) {
  return {
    kind: slug(e?.kind) || 'error',
    message: text(e?.message, 300) || 'Unknown error',
    stack: text(e?.stack, 2000),
    source: text(e?.source, 200),
    ua: text(e?.ua || ua, 200),
    route: text(e?.route || route, 120),
  };
}

export function parseBatch(body) {
  let b = body;
  if (typeof b === 'string') { if (b.length > MAX_BODY) return null; try { b = JSON.parse(b || '{}'); } catch { return null; } }
  if (!b || typeof b !== 'object' || !Array.isArray(b.events)) return null;
  const sid = /^[a-z0-9]{8,32}$/i.test(b.sid || '') ? b.sid : '';
  const route = text(b.route, 120);
  const events = [];
  for (const e of b.events.slice(0, MAX_EVENTS)) {
    const name = EVENTS.includes(e?.n) ? e.n : null;
    if (!name) continue;
    events.push(name === 'error' ? { n: name, p: { kind: slug(e.e?.kind) || 'error' }, e: cleanError(e.e, b.ua, route) } : { n: name, p: cleanProps(e.p) });
  }
  return { sid, route, events };
}

// ---- KV backends: both take a list of Redis commands and return their results in order.
export const redisKv = () => {
  const env = redisEnv();
  if (!env) return null;
  return async (commands) => {
    const res = await fetch(`${env.url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands) });
    const json = await res.json();
    if (!res.ok || !Array.isArray(json)) throw new Error(json?.error || `redis ${res.status}`);
    return json.map((r) => (r && 'result' in r ? r.result : null));
  };
};

export function memoryKv() {
  const data = new Map();
  const get = (k, make) => { if (!data.has(k) && make) data.set(k, make()); return data.get(k); };
  const run = ([cmd, key, ...args]) => {
    switch (String(cmd).toUpperCase()) {
      case 'HINCRBY': { const h = get(key, () => new Map()); h.set(args[0], (+h.get(args[0]) || 0) + +args[1]); return h.get(args[0]); }
      case 'HGETALL': { const h = get(key); return h ? [...h].flatMap(([f, v]) => [f, String(v)]) : []; }
      case 'INCR': { const v = (+get(key) || 0) + 1; data.set(key, v); return v; }
      case 'EXPIRE': return data.has(key) ? 1 : 0;
      case 'PFADD': { const s = get(key, () => new Set()); const n = s.size; args.forEach((a) => s.add(a)); return s.size > n ? 1 : 0; }
      case 'PFCOUNT': { const u = new Set(); for (const k of [key, ...args]) for (const v of get(k) || []) u.add(v); return u.size; }
      case 'LPUSH': { const l = get(key, () => []); l.unshift(...args.reverse()); return l.length; }
      case 'LTRIM': { const l = get(key) || []; const end = +args[1] < 0 ? l.length + +args[1] : +args[1]; data.set(key, l.slice(+args[0], end + 1)); return 'OK'; }
      case 'LRANGE': { const l = get(key) || []; const end = +args[1] < 0 ? l.length + +args[1] : +args[1]; return l.slice(+args[0], end + 1); }
      default: throw new Error(`unsupported ${cmd}`);
    }
  };
  const kv = async (commands) => commands.map(run);
  kv.data = data;
  return kv;
}

// ---- ingest
async function ingest(batch, kv, client, now) {
  const day = dayKey(now), hour = Math.floor(now / 3600e3), who = hash(client).toString('hex').slice(0, 16);
  const [batches] = await kv([['INCR', `${P}:rate:${who}:${hour}`], ['EXPIRE', `${P}:rate:${who}:${hour}`, 3600]]);
  if (batches > BATCHES_PER_HOUR) return { status: 429, json: { error: 'rate_limited' } };
  const dk = `${P}:d:${day}`, cmds = [];
  const errors = batch.events.filter((e) => e.n === 'error');
  let errorBudget = 0;
  if (errors.length) {
    const [n] = await kv([['INCR', `${P}:erate:${who}:${hour}`], ['EXPIRE', `${P}:erate:${who}:${hour}`, 3600]]);
    errorBudget = n <= ERRORS_PER_HOUR ? Math.min(5, errors.length) : 0;
  }
  const seen = new Set();
  for (const e of batch.events) {
    if (e.n === 'error') {
      if (errorBudget-- <= 0) continue;
      cmds.push(['LPUSH', `${P}:errors`, JSON.stringify({ at: new Date(now).toISOString(), ...e.e })]);
    }
    cmds.push(['HINCRBY', dk, e.n, 1]);
    const dim = DIMENSION[e.n], v = dim && e.p[dim];
    if (v !== undefined && v !== '') cmds.push(['HINCRBY', dk, `${e.n}:${v}`, 1]);
    if (batch.sid && !seen.has(e.n)) { seen.add(e.n); cmds.push(['PFADD', `${P}:u:${day}:${e.n}`, batch.sid], ['EXPIRE', `${P}:u:${day}:${e.n}`, TTL]); }
  }
  if (batch.sid && cmds.length) cmds.push(['PFADD', `${P}:u:${day}:session`, batch.sid], ['EXPIRE', `${P}:u:${day}:session`, TTL]);
  if (!cmds.length) return { status: 202, json: { ok: true, stored: 0 } };
  cmds.push(['EXPIRE', dk, TTL]);
  if (errors.length) cmds.push(['LTRIM', `${P}:errors`, 0, ERROR_LOG - 1]);
  await kv(cmds);
  return { status: 202, json: { ok: true, stored: batch.events.length } };
}

// ---- summary
const toObj = (r) => {
  if (!r) return {};
  if (!Array.isArray(r)) return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v]));
  const o = {};
  for (let i = 0; i < r.length; i += 2) o[r[i]] = +r[i + 1];
  return o;
};

export async function summarize(kv, { days = 30, now = Date.now() } = {}) {
  const n = Math.max(1, Math.min(90, Math.round(days) || 30));
  const dates = Array.from({ length: n + 7 }, (_, i) => dayKey(now - (n + 6 - i) * 864e5)); // +7 for retention cohorts
  const names = [...EVENTS, 'session'];
  const cmds = [];
  for (const d of dates) cmds.push(['HGETALL', `${P}:d:${d}`]);
  for (const d of dates.slice(7)) for (const e of names) cmds.push(['PFCOUNT', `${P}:u:${d}:${e}`]);
  const windows = [1, 7, n].filter((w, i, a) => a.indexOf(w) === i);
  for (const w of windows) for (const e of names) cmds.push(['PFCOUNT', ...dates.slice(-w).map((d) => `${P}:u:${d}:${e}`)]);
  cmds.push(['LRANGE', `${P}:errors`, 0, 49]);
  const r = await kv(cmds);
  let i = 0;
  const counts = dates.map(() => toObj(r[i++]));
  const byDate = Object.fromEntries(dates.map((d, j) => [d, counts[j]]));
  const daily = dates.slice(7).map((date) => ({ date, counts: byDate[date], uniques: Object.fromEntries(names.map((e) => [e, +r[i++] || 0])) }));
  const period = {};
  for (const w of windows) period[w] = Object.fromEntries(names.map((e) => [e, +r[i++] || 0]));
  const errors = (r[i++] || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);

  const totals = {};
  for (const d of daily) for (const [k, v] of Object.entries(d.counts)) totals[k] = (totals[k] || 0) + v;
  const u = period[n];
  const funnel = FUNNEL.map((event, j) => ({ event, sessions: u[event] || 0, count: totals[event] || 0,
    ofFirst: u[FUNNEL[0]] ? (u[event] || 0) / u[FUNNEL[0]] : 0,
    ofPrev: j && u[FUNNEL[j - 1]] ? (u[event] || 0) / u[FUNNEL[j - 1]] : j ? 0 : 1 }));
  // Rolling retention: devices back on day N vs devices first seen N days earlier.
  const retention = {};
  for (const [label, off] of [['d1', 1], ['d7', 7]]) {
    let returned = 0, cohort = 0;
    for (let j = 7; j < dates.length; j++) {
      const newer = byDate[dates[j - off]]?.['app_open:new'] || 0;
      if (!newer) continue;
      cohort += newer; returned += byDate[dates[j]]?.[`return_visit:${label}`] || 0;
    }
    retention[label] = { returned, cohort, rate: cohort ? returned / cohort : 0 };
  }
  return { enabled: true, generated: new Date(now).toISOString(), days: n, events: EVENTS, funnel, retention, period, totals, daily, errors };
}

export function validToken(given, expected) {
  if (!expected || !given) return false;
  return timingSafeEqual(hash(given), hash(expected));
}

export async function handleEvents({ method, query = {}, headers = {}, body, kv, client = 'anon', statsToken = '', now = Date.now() }) {
  if (method === 'GET' && query.summary) {
    if (!statsToken) return { status: 404, json: { error: 'stats_disabled' } };
    const given = query.token || headers['x-stats-token'] || String(headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!validToken(String(given || ''), statsToken)) return { status: 401, json: { error: 'unauthorized' } };
    if (!kv) return { status: 503, json: { enabled: false, error: 'storage_unavailable' } };
    return { status: 200, json: await summarize(kv, { days: +query.days || 30, now }) };
  }
  if (method === 'GET') return { status: 200, json: { enabled: !!kv } };
  if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  if (!kv) return { status: 202, json: { ok: true, enabled: false } };
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  if (raw.length > MAX_BODY) return { status: 413, json: { error: 'too_large' } };
  const batch = parseBatch(body);
  if (!batch) return { status: 400, json: { error: 'invalid_batch' } };
  if (!batch.events.length) return { status: 202, json: { ok: true, stored: 0 } };
  for (const e of batch.events) if (e.e && !e.e.ua) e.e.ua = text(headers['user-agent'], 200);
  return ingest(batch, kv, String(client || 'anon'), now);
}
