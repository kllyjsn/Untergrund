import { handleAccount } from './_lib/accounts.js';
import { redisKv } from './_lib/kv.js';
import { redisStore } from './_lib/crate.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    const { status, json, cookie } = await handleAccount(
      { method: req.method, query: req.query || {}, body, cookie: req.headers.cookie, client, origin: req.headers.origin, host: req.headers['x-forwarded-host'] || req.headers.host },
      { kv: redisKv(), crate: redisStore(), secret: process.env.AUTH_SECRET, secure: true });
    if (cookie) res.setHeader('Set-Cookie', cookie);
    res.status(status).json(json);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'storage_unavailable' });
  }
}
