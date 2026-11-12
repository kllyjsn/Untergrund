// Tiny Redis-command KV: Upstash REST in production, an in-memory twin (optionally file-backed) for server.mjs and tests.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { redisEnv, redis } from './crate.js';

export const redisKv = () => (redisEnv() ? { cmd: (args) => redis(args.map(String)) } : null);

export function memoryKv({ file = '' } = {}) {
  const data = new Map();
  if (file) {
    try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) data.set(k, v.t === 'set' ? { ...v, v: new Set(v.v) } : v); } catch {}
  }
  let saveTimer = 0;
  const persist = () => {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      const out = {};
      for (const [k, v] of data) out[k] = v.t === 'set' ? { ...v, v: [...v.v] } : v;
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
    const v = t === 'set' ? new Set() : t === 'list' ? [] : t === 'hash' ? {} : null;
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
    LREM: (k, c, v) => { const l = of(k, 'list'); if (!l) return 0; const before = l.length; const keep = l.filter((x) => x !== String(v)); l.length = 0; l.push(...keep); return before - l.length; },
  };
  return {
    async cmd([name, ...args]) {
      const op = ops[String(name).toUpperCase()];
      if (!op) throw new Error(`unsupported command ${name}`);
      const out = op(...args);
      if (!/^(GET|SMEMBERS|SCARD|SISMEMBER|LRANGE|HGET|HGETALL|HLEN)$/i.test(name)) persist();
      return out;
    },
    dump: () => data,
  };
}
