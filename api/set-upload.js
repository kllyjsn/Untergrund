// Issues short-lived Vercel Blob client tokens so recorded sets upload straight from the browser.
import { handleUpload } from '@vercel/blob/client';
import { redisJukebox } from './_lib/jukebox.js';

export const SET_PATH = /^sets\/[a-z0-9-]{1,60}\.(webm|mp4|m4a|ogg)$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'uploads_disabled' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
    const json = await handleUpload({
      body, request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!SET_PATH.test(pathname)) throw new Error('invalid_path');
        const limiter = redisJukebox();
        if (limiter && !(await limiter.allow(`upload:${client}`))) throw new Error('rate_limited');
        return { allowedContentTypes: ['audio/webm', 'audio/mp4', 'audio/ogg', 'video/webm', 'video/mp4'], maximumSizeInBytes: 400 * 1024 * 1024, addRandomSuffix: true };
      },
    });
    res.status(200).json(json);
  } catch (err) {
    res.status(400).json({ error: String(err?.message || err) });
  }
}
