import { exchangeToken } from './_lib/soundcloud.js';
import { handleAutopublish } from './_lib/autopublish.js';
import { redisKv } from './_lib/kv.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.query?.autopublish === '1') {
    const { status, json } = await handleAutopublish({ method: req.method, query: req.query, body: req.body, kv: redisKv() });
    return res.status(status).json(json);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const { status, json } = await exchangeToken(body);
  res.status(status).json(json);
}
