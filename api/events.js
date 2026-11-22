import { handleEvents, redisKv } from './_lib/events.js';
import { redisStore } from './_lib/crate.js';
import { redisKv as commandKv } from './_lib/kv.js';
import { handlePlayback } from './_lib/playback.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.query?.playback === '1') {
      const { status, json } = await handlePlayback({ method: req.method, query: req.query, headers: req.headers,
        body: req.body, kv: commandKv(), crate: redisStore(), statsToken: process.env.STATS_TOKEN || '' });
      return res.status(status).json(json);
    }
    const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    const { status, json } = await handleEvents({ method: req.method, query: req.query || {}, headers: req.headers, body: req.body, kv: redisKv(), client, statsToken: process.env.STATS_TOKEN || '', cronSecret: process.env.CRON_SECRET || '', webhook: process.env.DIGEST_WEBHOOK_URL || '' });
    res.status(status).json(json);
  } catch {
    res.status(502).json({ error: 'storage_unavailable' });
  }
}
