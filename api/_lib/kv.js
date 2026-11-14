// Tiny Redis-command KV: Upstash REST in production, an in-memory twin (optionally file-backed) for server.mjs and tests.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { redisEnv, redis } from './crate.js';

export const redisKv = () => (redisEnv() ? { kind: 'redis', cmd: (args) => redis(args.map(String)), pipe: redisPipe } : null);

// Upstash REST pipeline: one HTTP round trip, each command billed separately. Failed commands come back as Error values.
export async function redisPipe(list) {
  if (!list.length) return [];
  const { url, token } = redisEnv();
  const res = await fetch(`${url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(list.map((c) => c.map(String))) });
  const json = await res.json();
  if (!res.ok || !Array.isArray(json)) throw new Error(json?.error || `redis ${res.status}`);
  return json.map((r) => (r.error ? new Error(r.error) : r.result));
}
export const sha1 = (src) => createHash('sha1').update(src).digest('hex');

// `scripts` maps a Lua source to a JS twin (call, KEYS, ARGV) so EVAL/EVALSHA work in memory; `delay` (ms) jitters every
// command to shake out races in tests; `count` tallies commands the way Upstash bills them (each redis.call inside EVAL too).
export function memoryKv({ file = '', scripts = {}, delay = 0 } = {}) {
  const data = new Map();
  const shas = new Map(Object.keys(scripts).map((src) => [sha1(src), src]));
  const stats = { count: 0 };
  if (file) {
    try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) data.set(k, v.t === 'set' ? { ...v, v: new Set(v.v) } : v.t === 'zset' ? { ...v, v: new Map(v.v) } : v); } catch {}
  }
  let saveTimer = 0;
  const persist = () => {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      const out = {};
      for (const [k, v] of data) out[k] = v.t === 'set' || v.t === 'zset' ? { ...v, v: [...v.v] } : v;
      try { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(out)); } catch (err) { console.error('kv persist failed', err.message); }
    }, 200);
    saveTimer.unref?.();
  };
  const live = (k) => {
    const e = data.get(k);
    if (e && e.exp && e.exp <= Date.now()) { data.delete(k); return null; }
    return e || null;
  };
  const of = (k, t, make) => {
    const e = live(k);
    if (e && e.t !== t) throw new Error('WRONGTYPE');
    if (e) return e.v;
    if (!make) return null;
    const v = t === 'set' ? new Set() : t === 'list' ? [] : t === 'hash' ? {} : t === 'zset' ? new Map() : null;
    data.set(k, { t, v });
    return v;
  };
  const ops = {
    GET: (k) => { const e = live(k); return e ? e.v : null; },
    SET: (k, v, ...opt) => {
      const flags = opt.map((o) => String(o).toUpperCase());
      if (flags.includes('NX') && live(k)) return null;
      const ex = flags.indexOf('EX');
      data.set(k, { t: 's', v: String(v), ...(ex >= 0 && { exp: Date.now() + +opt[ex + 1] * 1000 }) });
      return 'OK';
    },
    DEL: (...ks) => ks.reduce((n, k) => n + (data.delete(k) ? 1 : 0), 0),
    INCR: (k) => { const e = live(k); const n = (e ? +e.v : 0) + 1; data.set(k, { ...(e || { t: 's' }), v: String(n) }); return n; },
    EXPIRE: (k, s) => { const e = live(k); if (!e) return 0; e.exp = Date.now() + +s * 1000; return 1; },
    SADD: (k, ...m) => { const s = of(k, 'set', true); let n = 0; for (const x of m) if (!s.has(String(x))) { s.add(String(x)); n++; } return n; },
    SREM: (k, ...m) => { const s = of(k, 'set'); if (!s) return 0; let n = 0; for (const x of m) if (s.delete(String(x))) n++; return n; },
    SMEMBERS: (k) => [...(of(k, 'set') || [])],
    SCARD: (k) => (of(k, 'set') || new Set()).size,
    SISMEMBER: (k, m) => ((of(k, 'set') || new Set()).has(String(m)) ? 1 : 0),
    LPUSH: (k, ...v) => { const l = of(k, 'list', true); for (const x of v) l.unshift(String(x)); return l.length; },
    LRANGE: (k, a, b) => { const l = of(k, 'list') || []; const n = l.length; const s = +a < 0 ? n + +a : +a, e = +b < 0 ? n + +b : +b; return l.slice(Math.max(0, s), e + 1); },
    LTRIM: (k, a, b) => { const l = of(k, 'list'); if (l) { const kept = ops.LRANGE(k, a, b); l.length = 0; l.push(...kept); } return 'OK'; },
    HSET: (k, ...fv) => { const m = of(k, 'hash', true); let n = 0; for (let i = 0; i + 1 < fv.length; i += 2) { if (!(String(fv[i]) in m)) n++; m[String(fv[i])] = String(fv[i + 1]); } return n; },
    HGET: (k, f) => of(k, 'hash')?.[String(f)] ?? null,
    HDEL: (k, ...fs) => { const m = of(k, 'hash'); if (!m) return 0; let n = 0; for (const f of fs) if (String(f) in m) { delete m[String(f)]; n++; } return n; },
    HGETALL: (k) => Object.entries(of(k, 'hash') || {}).flat(),
    HLEN: (k) => Object.keys(of(k, 'hash') || {}).length,
    HSETNX: (k, f, v) => { const m = of(k, 'hash', true); if (String(f) in m) return 0; m[String(f)] = String(v); return 1; },
    HINCRBY: (k, f, n) => { const m = of(k, 'hash', true); m[String(f)] = String((+m[String(f)] || 0) + +n); return +m[String(f)]; },
    RPUSH: (k, ...v) => { const l = of(k, 'list', true); l.push(...v.map(String)); return l.length; },
    ZADD: (k, ...sm) => { const z = of(k, 'zset', true); let n = 0; for (let i = 0; i + 1 < sm.length; i += 2) { if (!z.has(String(sm[i + 1]))) n++; z.set(String(sm[i + 1]), +sm[i]); } return n; },
    ZREVRANGEBYSCORE: (k, max, min, ...opt) => {
      const z = of(k, 'zset') || new Map(), hi = max === '+inf' ? Infinity : +max, lo = min === '-inf' ? -Infinity : +min;
      const li = opt.map((o) => String(o).toUpperCase()).indexOf('LIMIT');
      const out = [...z].filter(([, sc]) => sc <= hi && sc >= lo).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1)).map(([m]) => m);
      return li >= 0 ? out.slice(+opt[li + 1], +opt[li + 1] + +opt[li + 2]) : out;
    },
    ZREMRANGEBYSCORE: (k, min, max) => {
      const z = of(k, 'zset'); if (!z) return 0;
      const lo = min === '-inf' ? -Infinity : +min, hi = max === '+inf' ? Infinity : +max; let n = 0;
      for (const [m, sc] of z) if (sc >= lo && sc <= hi) { z.delete(m); n++; }
      return n;
    },
    ZREMRANGEBYRANK: (k, start, stop) => {
      const z = of(k, 'zset'); if (!z) return 0;
      const rows = [...z].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
      const from = +start < 0 ? Math.max(0, rows.length + +start) : +start;
      const to = Math.min(rows.length - 1, +stop < 0 ? rows.length + +stop : +stop);
      if (to < from) return 0;
      let n = 0;
      for (const [member] of rows.slice(from, to + 1)) if (z.delete(member)) n++;
      return n;
    },
    EVAL: (src, nk, ...rest) => {
      const fn = scripts[src];
      if (!fn) throw new Error('ERR unsupported script');
      shas.set(sha1(src), src);
      return fn((name, ...a) => { stats.count++; return ops[String(name).toUpperCase()](...a); }, rest.slice(0, +nk).map(String), rest.slice(+nk).map(String));
    },
    EVALSHA: (sha, ...rest) => { if (!shas.has(sha)) throw new Error('NOSCRIPT No matching script'); return ops.EVAL(shas.get(sha), ...rest); },
    LREM: (k, c, v) => { const l = of(k, 'list'); if (!l) return 0; const before = l.length; const keep = l.filter((x) => x !== String(v)); l.length = 0; l.push(...keep); return before - l.length; },
  };
  const wait = () => (delay ? new Promise((ok) => setTimeout(ok, Math.random() * delay)) : null);
  const run = ([name, ...args]) => {
    const op = ops[String(name).toUpperCase()];
    if (!op) throw new Error(`unsupported command ${name}`);
    stats.count++;
    const out = op(...args.map((a) => (typeof a === 'number' ? String(a) : a)));
    if (!/^(GET|SMEMBERS|SCARD|SISMEMBER|LRANGE|HGET|HGETALL|HLEN|ZREVRANGEBYSCORE)$/i.test(name)) persist();
    return out;
  };
  return {
    kind: 'memory',
    async cmd(args) { await wait(); return run(args); },
    async pipe(list) {
      const out = [];
      for (const c of list) { await wait(); try { out.push(run(c)); } catch (err) { out.push(err); } }
      return out;
    },
    stats,
    dump: () => data,
  };
}
