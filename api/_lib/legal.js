import { createHash, randomBytes } from 'node:crypto';

const KEY = 'untergrund:legal:requests:v2';
const RETENTION_SECONDS = 180 * 86400;
const RETENTION_MS = RETENTION_SECONDS * 1000;
const MAX_REQUESTS = 500;
const PER_HOUR = 20;
const TYPES = new Set(['copyright', 'privacy', 'rights', 'safety', 'other']);
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const email = (value) => {
  const out = clean(value, 200).toLowerCase();
  return /^[^\s@]{1,80}@[^\s@.]{1,120}\.[^\s@]{2,30}$/.test(out) ? out : '';
};
const hash = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 20);

export function cleanLegalRequest(body, { now = Date.now() } = {}) {
  if (!body || typeof body !== 'object') return null;
  const type = TYPES.has(body.type) ? body.type : 'other';
  const contact = email(body.email);
  const details = clean(body.details, 5000);
  if (!contact || details.length < 20 || body.attest !== true) return null;
  return {
    id: `lr_${now.toString(36)}_${randomBytes(5).toString('hex')}`,
    at: new Date(now).toISOString(),
    type,
    name: clean(body.name, 100),
    email: contact,
    work: clean(body.work, 500),
    details,
  };
}

export async function handleLegal({ method, body, headers = {}, query = {}, kv, client = 'anon', statsToken = '', now = Date.now() }) {
  if (!kv) return { status: 503, json: { error: 'unavailable' } };
  if (method === 'GET') {
    if (!statsToken || String(headers.authorization || '') !== `Bearer ${statsToken}`) return { status: 401, json: { error: 'unauthorized' } };
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    await kv.cmd(['ZREMRANGEBYSCORE', KEY, '-inf', now - RETENTION_MS]);
    const rows = (await kv.cmd(['ZREVRANGEBYSCORE', KEY, '+inf', now - RETENTION_MS, 'LIMIT', 0, limit])).map((row) => {
      try { return JSON.parse(row); } catch { return null; }
    }).filter(Boolean);
    return { status: 200, json: { requests: rows } };
  }
  if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const rate = `untergrund:legal:rate:${hash(client)}:${Math.floor(now / 3600e3)}`;
  const n = await kv.cmd(['INCR', rate]);
  if (n === 1) await kv.cmd(['EXPIRE', rate, 3600]);
  if (+n > PER_HOUR) return { status: 429, json: { error: 'rate_limited' } };
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { body = null; }
  }
  const request = cleanLegalRequest(body, { now });
  if (!request) return { status: 400, json: { error: 'invalid_request' } };
  await kv.pipe([
    ['ZREMRANGEBYSCORE', KEY, '-inf', now - RETENTION_MS],
    ['ZADD', KEY, now, JSON.stringify(request)],
    ['ZREMRANGEBYRANK', KEY, 0, -(MAX_REQUESTS + 1)],
    ['EXPIRE', KEY, RETENTION_SECONDS],
  ]);
  return { status: 201, json: { ok: true, id: request.id } };
}
