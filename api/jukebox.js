import { handleJukebox, redisJukebox } from './_lib/jukebox.js';
import { redisStore } from './_lib/crate.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    const { status, json } = await handleJukebox(req.method, body, { store: redisJukebox(), crate: redisStore(), client, uploads: !!process.env.BLOB_READ_WRITE_TOKEN });
    res.status(status).json(json);
  } catch {
    res.status(502).json({ error: 'storage_unavailable' });
  }
}
