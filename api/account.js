import { handleAccount } from './_lib/accounts.js';
import { redisKv } from './_lib/kv.js';
import { redisStore } from './_lib/crate.js';
import { handleBilling, handleBillingWebhook, readBillingWebhook } from './_lib/billing.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const billing = req.query?.billing;
  const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
  if (billing) {
    try {
      const ctx = { kv: redisKv(), secret: process.env.AUTH_SECRET };
      const r = billing === 'webhook'
        ? await handleBillingWebhook({ method: req.method, raw: req.method === 'POST' && await readBillingWebhook(req), signature: req.headers['stripe-signature'] }, ctx)
        : await handleBilling(billing, { method: req.method, cookie: req.headers.cookie, client,
          origin: req.headers.origin, host: req.headers['x-forwarded-host'] || req.headers.host }, ctx);
      return res.status(r.status).json(r.json);
    } catch (err) {
      console.error('Billing request failed:', err.message);
      return res.status(502).json({ error: 'billing_unavailable' });
    }
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const { status, json, cookie } = await handleAccount(
      { method: req.method, query: req.query || {}, body, cookie: req.headers.cookie, client, origin: req.headers.origin, host: req.headers['x-forwarded-host'] || req.headers.host },
      { kv: redisKv(), crate: redisStore(), secret: process.env.AUTH_SECRET, secure: true });
    if (cookie) res.setHeader('Set-Cookie', cookie);
    res.status(status).json(json);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'storage_unavailable' });
  }
}
