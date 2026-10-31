import { exchangeToken } from './_lib/soundcloud.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const { status, json } = await exchangeToken(body);
  res.status(status).json(json);
}
