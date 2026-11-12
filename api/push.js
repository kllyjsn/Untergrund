import { handlePush } from './_lib/push.js';
import { redisKv } from './_lib/kv.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    const { status, json } = await handlePush({ method: req.method, query: req.query || {}, headers: req.headers, body: req.body, kv: redisKv(), client });
    res.status(status).json(json);
  } catch {
    res.status(502).json({ error: 'storage_unavailable' });
  }
}
