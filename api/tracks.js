import { handleCrate, handleRemix, redisStore } from './_lib/crate.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.query?.remix) {
      const { status, json } = await handleRemix(req.method, String(req.query.remix), redisStore(), String(req.headers['x-forwarded-for'] || '').split(',')[0].trim());
      return res.status(status).json(json);
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    const { status, json } = await handleCrate(req.method, body, redisStore(), req.query?.id, client);
    res.status(status).json(json);
  } catch {
    res.status(502).json({ error: 'storage_unavailable' });
  }
}
