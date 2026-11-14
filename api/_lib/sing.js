// /api/sing: the song's vocal stem from the self-hosted neural singer (singer/, docs/singer.md). Off unless SINGER_URL and
// SINGER_SECRET are set; the client then never shows SING. The request is the app's own score (js/sing-score.js), checked
// by validateSing() before it leaves; stems are cached by content hash (Vercel Blob when configured, else in memory) so a
// song is only ever sung once. Singing takes longer than a function may run: POST starts a job, the client polls it.
import { createHash } from 'node:crypto';
import { validateSing } from '../../js/sing-score.js';

export const SING_PER_HOUR = 6, SING_TIMEOUT = 8000, MAX_SING_BODY = 256 * 1024, MAX_STEM_BYTES = 12 * 1024 * 1024;
export const MODEL_PIN = 'spybyscript/scyllasband@de0d1d9dd9ddb23ba8c7cd8b3ec6ea842f250868';
const TYPES = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
const HEX = /^[0-9a-f]{64}$/, JOB = /^[A-Za-z0-9_-]{1,64}$/;

export const singEnv = (env) => ({ url: String(env.SINGER_URL || '').replace(/\/+$/, ''), secret: env.SINGER_SECRET || '' });
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
export const singHash = (req) => createHash('sha256').update(canon({ pin: MODEL_PIN, ...req })).digest('hex');

// Stems in this process's memory (local server, or a Vercel instance without Blob): small, newest kept.
export function memorySingStore({ max = 24 } = {}) {
  const stems = new Map(), jobs = new Map();
  return {
    async get(hash) { const s = stems.get(hash); return s ? { bytes: s.bytes, type: s.type } : null; },
    async put(hash, bytes, type) { stems.delete(hash); stems.set(hash, { bytes, type }); while (stems.size > max) stems.delete(stems.keys().next().value); return null; },
    async job(hash, id) { jobs.set(id, hash); if (jobs.size > 500) jobs.delete(jobs.keys().next().value); },
    async jobOf(id) { return jobs.get(id) || null; },
  };
}

// Stems in Vercel Blob (public, immutable by hash), their URLs and the job -> hash map in KV.
export function blobSingStore(kv, { token = process.env.BLOB_READ_WRITE_TOKEN, putImpl } = {}) {
  if (!kv || !token) return null;
  return {
    async get(hash) { const [url] = await kv([['GET', `untergrund:sing:${hash}`]]); return url ? { url } : null; },
    async put(hash, bytes, type) {
      const put = putImpl || (await import('@vercel/blob')).put;
      const { url } = await put(`sing/${hash}.${TYPES[type]}`, bytes, { access: 'public', contentType: type, addRandomSuffix: false, allowOverwrite: true, token, cacheControlMaxAge: 31536000 });
      await kv([['SET', `untergrund:sing:${hash}`, url]]);
      return url;
    },
    async job(hash, id) { await kv([['SET', `untergrund:sing:job:${id}`, hash, 'EX', 3600]]); },
    async jobOf(id) { const [h] = await kv([['GET', `untergrund:sing:job:${id}`]]); return h || null; },
  };
}

async function call(fetchImpl, url, init, timeout) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  try { return await fetchImpl(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(timer); }
}
const done = (hash, hit) => (hit.url ? { status: 200, json: { hash, url: hit.url } } : { status: 200, body: hit.bytes, type: hit.type, hash });

// { status, json } or, for a stem kept in memory, { status, body, type }. Body: a sing request, or { job, hash } to poll.
export async function handleSing({ method, body, client = 'anon', url = '', secret = '', kv, store, fetchImpl = fetch, timeout = SING_TIMEOUT, now = Date.now() }) {
  const on = !!(url && secret && store);
  if (method === 'GET') return { status: 200, json: { enabled: on } };
  if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  if (!on) return { status: 501, json: { error: 'disabled' } };
  if (typeof body === 'string') { if (body.length > MAX_SING_BODY) return { status: 413, json: { error: 'too_large' } }; try { body = JSON.parse(body || '{}'); } catch { body = null; } }
  const auth = { Authorization: `Bearer ${secret}` };
  try {
    if (body && body.job != null) {
      const job = String(body.job), hash = String(body.hash || '');
      if (!JOB.test(job) || !HEX.test(hash) || (await store.jobOf(job)) !== hash) return { status: 404, json: { error: 'unknown_job' } };
      const hit = await store.get(hash);
      if (hit) return done(hash, hit);
      const res = await call(fetchImpl, `${url}/result?id=${encodeURIComponent(job)}`, { headers: auth }, timeout);
      if (res.status === 202) return { status: 202, json: { hash, job, status: 'pending' } };
      const type = String(res.headers.get('content-type') || '').split(';')[0];
      if (!res.ok || !TYPES[type]) return { status: 502, json: { error: 'sing_failed' } };
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_STEM_BYTES) return { status: 502, json: { error: 'sing_failed' } };
      const stored = await store.put(hash, bytes, type);
      return done(hash, stored ? { url: stored } : { bytes, type });
    }
    const req = validateSing(body);
    if (!req) return { status: 400, json: { error: 'bad_request' } };
    const hash = singHash(req), hit = await store.get(hash);
    if (hit) return done(hash, hit);
    if (kv) {
      const k = `untergrund:ev:sing_rate:${createHash('sha256').update(String(client)).digest('hex').slice(0, 16)}:${Math.floor(now / 3600e3)}`;
      const [n] = await kv([['INCR', k], ['EXPIRE', k, 3600]]);
      if (+n > SING_PER_HOUR) return { status: 429, json: { error: 'rate_limited' } };
    }
    const res = await call(fetchImpl, `${url}/submit`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(req) }, timeout);
    const job = res.ok ? String((await res.json())?.id || '') : '';
    if (!JOB.test(job)) return { status: res.status === 429 ? 429 : 502, json: { error: res.status === 429 ? 'busy' : 'singer_unavailable' } };
    await store.job(hash, job);
    return { status: 202, json: { hash, job, status: 'pending' } };
  } catch { return { status: 502, json: { error: 'singer_unavailable' } }; }
}
