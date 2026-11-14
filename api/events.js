import { handleEvents, redisKv } from './_lib/events.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    const { status, json } = await handleEvents({ method: req.method, query: req.query || {}, headers: req.headers, body: req.body, kv: redisKv(), client, statsToken: process.env.STATS_TOKEN || '', cronSecret: process.env.CRON_SECRET || '', webhook: process.env.DIGEST_WEBHOOK_URL || '' });
    res.status(status).json(json);
  } catch {
    res.status(502).json({ error: 'storage_unavailable' });
  }
}
