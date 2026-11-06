import { handleDescribe, aiEnv } from './_lib/describe-ai.js';
import { redisKv } from './_lib/events.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    const { status, json } = await handleDescribe({ method: req.method, body: req.body, client, ...aiEnv(process.env), kv: redisKv() });
    res.status(status).json(json);
  } catch {
    res.status(502).json({ error: 'unavailable', edits: [] });
  }
}
