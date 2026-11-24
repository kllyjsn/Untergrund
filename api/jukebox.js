import { handleJukebox, redisJukebox } from './_lib/jukebox.js';
import { redisStore } from './_lib/crate.js';
import { redisKv } from './_lib/kv.js';
import { attachPublished } from './_lib/accounts.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    const crate = redisStore();
    const auth = { kv: redisKv(), secret: process.env.AUTH_SECRET, cookie: req.headers.cookie };
    const { status, json } = await handleJukebox(req.method, body, { store: redisJukebox(), crate, client, auth, uploads: !!process.env.BLOB_READ_WRITE_TOKEN, id: String(req.query?.id || '') });
    if (status === 201 && json.item?.trackId && !body.accountId) {
      await attachPublished({ ...auth, crate, trackId: json.item.trackId }).catch(() => {});
    }
    res.status(status).json(json);
  } catch {
    res.status(502).json({ error: 'storage_unavailable' });
  }
}
