// First-party product analytics: anonymous funnel events + client errors stored as
// daily Redis counters (HINCRBY), daily unique sessions (HyperLogLog) and a short error log.
import { createHash, timingSafeEqual } from 'node:crypto';
import { redisEnv } from './crate.js';
import { analyze, toMarkdown } from './improve.js';
import { EXPERIMENTS, ARMS, XP_ID } from '../../js/experiments.js';

export const EVENTS = ['app_open', 'generate', 'play_start', 'play_30s', 'save_track', 'publish', 'share_link_copied',
  'room_join', 'room_go_live', 'export_wav', 'export_stems', 'export_midi', 'return_visit', 'shared_open', 'remix', 'video_export', 'hum', 'voice_chops', 'song_edit', 'set_replay', 'daily_drop', 'describe', 'push', 'live_rooms', 'go_live_nudge', 'room_create', 'room_privacy', 'listen', 'radio', 'library', 'error'];
export const FUNNEL = ['app_open', 'generate', 'play_start', 'play_30s', 'publish', 'share_link_copied'];
// One prop per event is also counted as a breakdown field, e.g. `generate:acid`.
export const DIMENSION = { app_open: 'visitor', generate: 'genre', publish: 'kind', share_link_copied: 'what', return_visit: 'bucket', error: 'kind', save_track: 'shared', shared_open: 'kind', remix: 'kind', video_export: 'kind', hum: 'kind', voice_chops: 'kind', song_edit: 'kind', set_replay: 'kind', daily_drop: 'kind', describe: 'kind', push: 'kind', room_join: 'kind', live_rooms: 'kind', go_live_nudge: 'kind', room_create: 'kind', room_privacy: 'kind', listen: 'kind', radio: 'kind', library: 'kind' };
const PROPS = ['genre', 'kind', 'what', 'bucket', 'days', 'visitor', 'bars', 'shared', 'public'];
const P = 'untergrund:ev', TTL = 400 * 86400, MAX_EVENTS = 40, ERROR_LOG = 100;
export const MAX_BODY = 32_000, BATCHES_PER_HOUR = 400, ERRORS_PER_HOUR = 20;
// Listen signals (js/listen.js, docs/listen-signals.md): counted like events, and each full record is kept in a capped log.
export const LISTEN_KINDS = ['start', 'complete', 'skip', 'partial', 'replay', 'keep', 'publish', 'share', 'live', 'love', 'unlove', 'down', 'undown', 'why', 'rewind'];
export const DOWN_REASONS = ['boring', 'sounds_bad', 'not_my_style'], COHORTS = ['d0', 'd1_6', 'd7_29', 'd30_plus'], DEVICES = ['phone', 'tablet', 'desktop'];
export const LISTEN_LOG = 5000, LISTENS_PER_HOUR = 300, SIGNALS_MAX = 1000;
// Day logs (untergrund:ev:listen:<day>) keep every day's records for HISTORY_DAYS, read in pages, so the improvement
// engine sees weeks instead of the newest LISTEN_LOG records. DAY_LOG caps one day (reported as `capped`).
export const DAY_LOG = 5000, HISTORY_DAYS = 28, PAGE = 1000, PAGES_AT_ONCE = 4, DIGESTS_KEPT = 30;

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

const SHARE_REF = /^[a-z0-9]{8}$/; // js/share-code.js mints these
const int = (v, lo, hi, d) => (Number.isFinite(+v) && v !== '' && v !== null && typeof v !== 'boolean' ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);
const id = (v, re) => (re.test(String(v ?? '')) ? String(v) : '');
export function cleanListen(l, p = {}) {
  const kind = LISTEN_KINDS.includes(p?.kind) ? p.kind : null;
  const fp = id(l?.fp, /^[a-z0-9]{6,16}$/);
  if (!kind || !fp) return null;
  const out = {
    v: int(l.v, 1, 99, 1), kind, lis: id(l.lis, /^[a-z0-9]{6,16}$/), lid: id(l.lid, /^[a-z0-9]{8,32}$/i), fp,
    tid: id(l.tid, /^[A-Za-z0-9-]{1,40}$/), seed: int(l.seed, -1, 2 ** 31, -1), style: slug(l.style), src: slug(l.src), surf: slug(l.surf),
    ph: id(l.ph, /^[a-z0-9]{1,8}$/), bar: int(l.bar, 0, 9999, 0), bars: int(l.bars, 0, 9999, 0), sec: slug(l.sec), pct: int(l.pct, -1, 100, -1),
    ms: int(l.ms, 0, 864e5, 0), t: int(l.t, 0, 1e14, 0),
  };
  // Only a share can stand alone (a link copied before pressing play); every other signal belongs to a listen.
  if (!out.lis && kind !== 'share') return null;
  const co = COHORTS.includes(l.co) ? l.co : '', dev = DEVICES.includes(l.dev) ? l.dev : '';
  if (co) out.co = co;
  if (dev) out.dev = dev;
  if (kind === 'start') {
    const pt = text(l.pt, 120), arr = id(l.arr, /^[a-z0-9_.-]{1,80}$/);
    if (pt) out.pt = pt;
    if (arr) out.arr = arr;
  }
  // Share attribution: `via` is the ref of the link a listen arrived through; a `share` carries the ref it minted.
  const via = id(l.via, SHARE_REF), ref = kind === 'share' ? id(l.ref, SHARE_REF) : '';
  if (via) out.via = via;
  if (ref) out.ref = ref;
  if (kind === 'why') { if (!DOWN_REASONS.includes(l.why)) return null; out.why = l.why; }
  if (kind === 'rewind') out.to = int(l.to, 0, 9999, 0);
  if (XP_ID.test(String(l.xp ?? '')) && ARMS.includes(l.arm)) { out.xp = l.xp; out.arm = l.arm; }
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
    if (name === 'listen') {
      const l = cleanListen({ ...e.l, t: e.t }, e.p);
      if (l) events.push({ n: name, p: { kind: l.kind, ...(l.style ? { genre: l.style } : {}) }, l });
      continue;
    }
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
      case 'INCRBY': { const v = (+get(key) || 0) + +args[0]; data.set(key, v); return v; }
      case 'EXPIRE': return data.has(key) ? 1 : 0;
      case 'PFADD': { const s = get(key, () => new Set()); const n = s.size; args.forEach((a) => s.add(a)); return s.size > n ? 1 : 0; }
      case 'PFCOUNT': { const u = new Set(); for (const k of [key, ...args]) for (const v of get(k) || []) u.add(v); return u.size; }
      case 'LPUSH': { const l = get(key, () => []); l.unshift(...args.reverse()); return l.length; }
      case 'LTRIM': { const l = get(key) || []; const end = +args[1] < 0 ? l.length + +args[1] : +args[1]; data.set(key, l.slice(+args[0], end + 1)); return 'OK'; }
      case 'LLEN': return (get(key) || []).length;
      case 'DEL': return data.delete(key) ? 1 : 0;
      case 'GET': return data.has(key) ? data.get(key) : null;
      case 'SET': { if (args.slice(1).map((a) => String(a).toUpperCase()).includes('NX') && data.has(key)) return null; data.set(key, args[0]); return 'OK'; }
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
  const listens = batch.events.filter((e) => e.n === 'listen');
  let listenBudget = 0;
  if (listens.length) {
    const [n] = await kv([['INCRBY', `${P}:lrate:${who}:${hour}`, listens.length], ['EXPIRE', `${P}:lrate:${who}:${hour}`, 3600]]);
    listenBudget = Math.max(0, Math.min(listens.length, LISTENS_PER_HOUR - (n - listens.length)));
  }
  const seen = new Set();
  for (const e of batch.events) {
    if (e.n === 'error') {
      if (errorBudget-- <= 0) continue;
      cmds.push(['LPUSH', `${P}:errors`, JSON.stringify({ at: new Date(now).toISOString(), ...e.e })]);
    }
    if (e.n === 'listen') {
      if (listenBudget-- <= 0) continue;
      const l = e.l;
      const rec = JSON.stringify({ at: new Date(now).toISOString(), sid: batch.sid, ...l });
      cmds.push(['LPUSH', `${P}:listen`, rec], ['LPUSH', `${P}:listen:${day}`, rec]);
      // Per-genre per-day and per-song totals: what the improvement engine scores first.
      if (l.style) cmds.push(['HINCRBY', `${P}:ls:${day}`, `${l.style}:${l.kind}`, 1], ['EXPIRE', `${P}:ls:${day}`, TTL]);
      cmds.push(['HINCRBY', `${P}:fp:${l.fp}`, l.kind, 1], ['EXPIRE', `${P}:fp:${l.fp}`, TTL]);
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
  if (listens.length) cmds.push(['LTRIM', `${P}:listen`, 0, LISTEN_LOG - 1], ['EXPIRE', `${P}:listen`, TTL],
    ['LTRIM', `${P}:listen:${day}`, 0, DAY_LOG - 1], ['EXPIRE', `${P}:listen:${day}`, (HISTORY_DAYS + 1) * 86400]);
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
  cmds.push(['LRANGE', `${P}:describe_miss`, 0, 99]);
  const lsDates = dates.slice(7);
  for (const d of lsDates) cmds.push(['HGETALL', `${P}:ls:${d}`]);
  const r = await kv(cmds);
  let i = 0;
  const counts = dates.map(() => toObj(r[i++]));
  const byDate = Object.fromEntries(dates.map((d, j) => [d, counts[j]]));
  const daily = dates.slice(7).map((date) => ({ date, counts: byDate[date], uniques: Object.fromEntries(names.map((e) => [e, +r[i++] || 0])) }));
  const period = {};
  for (const w of windows) period[w] = Object.fromEntries(names.map((e) => [e, +r[i++] || 0]));
  const list = (x) => (x || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  const errors = list(r[i++]), misses = list(r[i++]);
  const byStyle = {};
  for (const _ of lsDates) for (const [k, v] of Object.entries(toObj(r[i++]))) {
    const [st, kind] = k.split(':');
    (byStyle[st] ||= {})[kind] = (byStyle[st][kind] || 0) + v;
  }

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
  return { enabled: true, generated: new Date(now).toISOString(), days: n, events: EVENTS, funnel, retention, period, totals, daily, errors, misses, listening: listening(totals, byStyle) };
}

// Enjoyment rates per listen start: how often a song is finished, skipped early, replayed, loved, kept, published, shared or played live.
const RATES = { completion: 'complete', skip: 'skip', replay: 'replay', rewind: 'rewind', love: 'love', down: 'down', keep: 'keep', publish: 'publish', share: 'share', live: 'live' };
const NET = { love: 'unlove', down: 'undown' };
export function listenRates(k = {}) {
  const starts = k.start || 0;
  return Object.fromEntries(Object.entries(RATES).map(([name, kind]) => [name, starts ? (NET[name] ? Math.max(0, (k[kind] || 0) - (k[NET[name]] || 0)) : k[kind] || 0) / starts : 0]));
}
function listening(totals, byStyle) {
  const kinds = Object.fromEntries(LISTEN_KINDS.map((kind) => [kind, totals[`listen:${kind}`] || 0]));
  const styles = Object.entries(byStyle).map(([style, k]) => ({ style, starts: k.start || 0, counts: k, rates: listenRates(k) })).sort((a, b) => b.starts - a.starts);
  return { kinds, rates: listenRates(kinds), styles };
}

// Raw listen records, newest first (stats-token only): the input for offline learning and automations.
export async function listSignals(kv, { limit = 500, fp = '' } = {}) {
  const n = Math.max(1, Math.min(SIGNALS_MAX, Math.round(+limit) || 500));
  const cmds = [['LRANGE', `${P}:listen`, 0, n - 1]];
  const song = /^[a-z0-9]{6,16}$/.test(fp) ? fp : '';
  if (song) cmds.push(['HGETALL', `${P}:fp:${song}`]);
  const [rows, counts] = await kv(cmds);
  const signals = (rows || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
  return { enabled: true, version: 1, signals, ...(song ? { song: { fp: song, counts: toObj(counts), rates: listenRates(toObj(counts)) } } : {}) };
}

const parseAll = (rows) => (rows || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);

// Every listen record of the last `days` UTC days, newest day first: day logs read in pages of PAGE, plus records from the
// newest-5000 log for days that have no day log (written before day logs existed).
export async function readHistory(kv, { days = HISTORY_DAYS, now = Date.now() } = {}) {
  const n = Math.max(1, Math.min(HISTORY_DAYS, Math.round(+days) || HISTORY_DAYS));
  const dates = Array.from({ length: n }, (_, i) => dayKey(now - i * 864e5));
  const lens = await kv(dates.map((d) => ['LLEN', `${P}:listen:${d}`]));
  const pages = [];
  dates.forEach((d, i) => { for (let at = 0; at < Math.min(+lens[i] || 0, DAY_LOG); at += PAGE) pages.push(['LRANGE', `${P}:listen:${d}`, at, at + PAGE - 1]); });
  const signals = [];
  for (let i = 0; i < pages.length; i += PAGES_AT_ONCE) {
    const got = await Promise.all(pages.slice(i, i + PAGES_AT_ONCE).map((c) => kv([c])));
    for (const [rows] of got) signals.push(...parseAll(rows));
  }
  const logged = new Set(dates.filter((_, i) => +lens[i] > 0)), window = new Set(dates);
  const [old] = await kv([['LRANGE', `${P}:listen`, 0, LISTEN_LOG - 1]]);
  const legacy = parseAll(old).filter((r) => r.at && window.has(r.at.slice(0, 10)) && !logged.has(r.at.slice(0, 10)));
  signals.push(...legacy);
  return { signals, coverage: { days: n, from: dates[n - 1], to: dates[0], records: signals.length, pages: pages.length, legacy: legacy.length,
    capped: dates.filter((_, i) => +lens[i] >= DAY_LOG) } };
}

// The improvement engine over the history (stats-token only): ranked findings, proposed experiments (never applied) and
// the read-out of running ones.
export async function improveReport(kv, { now = Date.now(), days = HISTORY_DAYS, running = EXPERIMENTS, ...options } = {}) {
  const { signals, coverage } = await readHistory(kv, { days, now });
  return { enabled: true, coverage, ...analyze(signals, { now, running, ...options }) };
}

// The daily digest (Vercel cron → /api/improve-digest): the report, stored for stats.html, and posted to
// DIGEST_WEBHOOK_URL (Slack-style `{ text }`) when set. Once per UTC day unless forced.
export async function runDigest(kv, { now = Date.now(), webhook = '', fetchImpl = globalThis.fetch, force = false, ...options } = {}) {
  const day = dayKey(now);
  const [fresh] = await kv([['SET', `${P}:digest:ran:${day}`, '1', 'NX', 'EX', 2 * 86400]]);
  if (fresh !== 'OK' && !force) return { ok: true, day, skipped: 'already_ran' };
  let r, markdown, brief;
  try {
    r = await improveReport(kv, { now, ...options });
    markdown = toMarkdown(r);
    const digest = { day, generated: r.generated, coverage: r.coverage, totals: r.totals, findings: r.findings.slice(0, 10), experiments: r.experiments, running: r.running, loop: r.loop, markdown };
    brief = { day, generated: r.generated, listens: r.totals.listens, findings: r.findings.length, experiments: r.experiments.length, running: r.running.map((x) => ({ id: x.id, status: x.status })),
      loop: { sharesPerSong: r.loop.sharesPerSong, shareStarts: r.loop.shareOrigin.starts, creatorReturn7d: r.loop.creators.returnRate7d } };
    await kv([['SET', `${P}:digest`, JSON.stringify(digest)], ['LPUSH', `${P}:digests`, JSON.stringify(brief)], ['LTRIM', `${P}:digests`, 0, DIGESTS_KEPT - 1]]);
  } catch (err) {
    // A failed run must not use up the day: the next cron retry tries again. Only the run that set the marker clears it.
    if (fresh === 'OK') await kv([['DEL', `${P}:digest:ran:${day}`]]).catch(() => {});
    throw err;
  }
  let delivered = false;
  if (/^https:\/\//.test(webhook) && fetchImpl) {
    try { delivered = (await fetchImpl(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: markdown }) })).ok; } catch {}
  }
  return { ok: true, day, findings: r.findings.length, experiments: r.experiments.length, running: brief.running, records: r.coverage.records, delivered };
}

export async function latestDigest(kv) {
  const [d, list] = await kv([['GET', `${P}:digest`], ['LRANGE', `${P}:digests`, 0, DIGESTS_KEPT - 1]]);
  let digest = null;
  try { digest = d ? JSON.parse(d) : null; } catch {}
  return { enabled: true, digest, history: parseAll(list) };
}

export function validToken(given, expected) {
  if (!expected || !given) return false;
  return timingSafeEqual(hash(given), hash(expected));
}

export async function handleEvents({ method, query = {}, headers = {}, body, kv, client = 'anon', statsToken = '', cronSecret = '', webhook = '', fetchImpl, now = Date.now() }) {
  if (method === 'GET' && (query.summary || query.signals || query.improve || query.digest)) {
    if (!statsToken) return { status: 404, json: { error: 'stats_disabled' } };
    const given = String(query.token || headers['x-stats-token'] || String(headers.authorization || '').replace(/^Bearer\s+/i, '') || '');
    // The digest run also takes Vercel's cron secret, which is what its scheduler sends.
    const run = query.digest === 'run';
    if (!validToken(given, statsToken) && !(run && validToken(given, cronSecret))) return { status: 401, json: { error: 'unauthorized' } };
    if (!kv) return { status: 503, json: { enabled: false, error: 'storage_unavailable' } };
    const opts = { now, ...(+query.min > 0 ? { minListens: Math.min(1000, Math.round(+query.min)) } : {}), ...(+query.days > 0 ? { days: +query.days } : {}) };
    if (run) return { status: 200, json: await runDigest(kv, { ...opts, webhook, fetchImpl, force: query.force === '1' && validToken(given, statsToken) }) };
    if (query.digest) return { status: 200, json: await latestDigest(kv) };
    if (query.improve) return { status: 200, json: await improveReport(kv, opts) };
    if (query.signals) return { status: 200, json: await listSignals(kv, { limit: query.limit, fp: String(query.fp || '') }) };
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
