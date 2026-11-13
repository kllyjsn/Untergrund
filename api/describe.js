import { handleDescribe, aiEnv } from './_lib/describe-ai.js';
import { handlePlan, planEnv } from './_lib/song-plan-ai.js';
import { redisKv } from './_lib/events.js';

// Also serves /api/song-plan (vercel.json rewrite), so the plan endpoint doesn't cost a function slot.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const plan = req.query?.plan === '1';
  try {
    const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    const { status, json } = plan
      ? await handlePlan({ method: req.method, body: req.body, client, ...planEnv(process.env), kv: redisKv() })
      : await handleDescribe({ method: req.method, body: req.body, client, ...aiEnv(process.env), kv: redisKv() });
    res.status(status).json(json);
  } catch {
    res.status(502).json(plan ? { error: 'unavailable' } : { error: 'unavailable', edits: [] });
  }
}
