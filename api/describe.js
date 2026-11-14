import { handleDescribe, aiEnv } from './_lib/describe-ai.js';
import { handlePlan, planEnv } from './_lib/song-plan-ai.js';
import { redisKv } from './_lib/events.js';
import { handleSing, singEnv, memorySingStore, blobSingStore } from './_lib/sing.js';

let singStore;

// Also serves /api/song-plan and /api/sing (vercel.json rewrites), so those endpoints don't cost a function slot.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const plan = req.query?.plan === '1';
  if (req.query?.sing === '1') return sing(req, res);
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

async function sing(req, res) {
  const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
  const kv = redisKv();
  singStore ??= blobSingStore(kv) || memorySingStore();
  const body = typeof req.body === 'string' || req.body == null ? req.body : JSON.stringify(req.body);
  const r = await handleSing({ method: req.method, body, client, ...singEnv(process.env), kv, store: singStore });
  if (r.body) { res.setHeader('Content-Type', r.type); return res.status(r.status).send(r.body); }
  res.status(r.status).json(r.json);
}
