import { redisKv } from './_lib/kv.js';
import { handleLegal } from './_lib/legal.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'anon';
    const { status, json } = await handleLegal({
      method: req.method,
      body: req.body,
      query: req.query || {},
      headers: req.headers,
      kv: redisKv(),
      client,
      statsToken: process.env.STATS_TOKEN || '',
    });
    res.status(status).json(json);
  } catch {
    res.status(502).json({ error: 'storage_unavailable' });
  }
}
