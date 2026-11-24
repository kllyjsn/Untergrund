import { createHmac, timingSafeEqual } from 'node:crypto';
import { accountFromSession, allow, authEnabled } from './accounts.js';
import { aiEnv } from './describe-ai.js';
import { PRO_PRICE_CENTS } from '../../js/pro-plan.js';

const LIVE_ORIGIN = 'https://www.untergrund.sh';
const MAX_WEBHOOK_BYTES = 512 * 1024;
const SUBSCRIPTION_EVENTS = new Set(['created', 'updated', 'deleted', 'paused', 'resumed'].map((name) => `customer.subscription.${name}`));
const id = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[a-zA-Z0-9_]+$`).test(value);
const result = (status, json) => ({ status, json });
const error = (status, reason) => result(status, { error: reason });

export function billingConfig(env = process.env) {
  const mode = env.UNTERGRUND_STRIPE_MODE;
  const secret = env.UNTERGRUND_STRIPE_SECRET_KEY;
  const signingSecret = env.UNTERGRUND_STRIPE_WEBHOOK_SECRET;
  const price = env.UNTERGRUND_STRIPE_PRICE_ID;
  const portal = env.UNTERGRUND_STRIPE_PORTAL_CONFIGURATION;
  const origin = env.UNTERGRUND_BILLING_ORIGIN;
  if (!['test', 'live'].includes(mode) || !id(secret, `(?:sk|rk)_${mode}`) ||
      !id(signingSecret, 'whsec') || !id(price, 'price') || !id(portal, 'bpc')) return null;
  if (mode === 'live') {
    if (env.VERCEL_ENV !== 'production' || origin !== LIVE_ORIGIN) return null;
  } else {
    if (env.VERCEL_ENV === 'production' || origin === LIVE_ORIGIN || origin === 'https://untergrund.sh') return null;
    try {
      const url = new URL(origin);
      if (url.origin !== origin || !(url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) return null;
    } catch { return null; }
  }
  return { mode, secret, signingSecret, price, portal, origin };
}

const key = (cfg, kind, account) => `untergrund:billing:${cfg.mode}:${kind}:${account}`;
const customerKey = (cfg, account) => key(cfg, 'customer', account);
const badgeKey = (cfg, account) => key(cfg, 'pro', account);

function stripeApi(cfg, fetchImpl) {
  return async (path, params = {}, idempotencyKey) => {
    const post = path.startsWith('POST ');
    const form = new URLSearchParams(params);
    const url = `https://api.stripe.com/v1/${post ? path.slice(5) : path + '?' + form}`;
    const res = await fetchImpl(url, {
      method: post ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${cfg.secret}`, 'Stripe-Version': '2024-06-20',
        ...(post && { 'Content-Type': 'application/x-www-form-urlencoded' }),
        ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }) },
      ...(post && { body: form }),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error(`Stripe HTTP ${res.status}`);
    return res.json();
  };
}

let priceCache;
async function planPrice(api, cfg) {
  if (priceCache?.id === cfg.price && priceCache.mode === cfg.mode && priceCache.until > Date.now()) return priceCache.plan;
  const p = await api(`prices/${cfg.price}`);
  if (p.id !== cfg.price || p.livemode !== (cfg.mode === 'live') ||
      p.currency !== 'usd' || p.unit_amount !== PRO_PRICE_CENTS ||
      p.type !== 'recurring' || p.recurring?.interval !== 'month' || p.recurring.interval_count !== 1 ||
      p.recurring.usage_type !== 'licensed') throw new Error('Stripe price is not a fixed monthly USD price');
  const plan = { cents: p.unit_amount, currency: p.currency, accepting: p.active === true };
  priceCache = { id: cfg.price, mode: cfg.mode, until: Date.now() + 60_000, plan };
  return plan;
}

async function membership(api, cfg, customer, account) {
  let cursor, attention = false;
  do {
    const rows = await api('subscriptions', { customer, status: 'all', limit: 100, ...(cursor && { starting_after: cursor }) });
    const owned = rows.data.filter((s) => s.customer === customer && s.livemode === (cfg.mode === 'live') &&
      s.metadata?.ug_account === account && !['canceled', 'incomplete_expired'].includes(s.status));
    const active = owned.find((s) => ['active', 'trialing'].includes(s.status) &&
      s.items?.data?.some((item) => item.price?.id === cfg.price));
    if (active) return { state: 'active', ending: Boolean(active.cancel_at_period_end || active.cancel_at) };
    attention ||= owned.length > 0;
    cursor = rows.has_more ? rows.data.at(-1)?.id : null;
  } while (cursor);
  return { state: attention ? 'attention' : 'free' };
}

async function getCustomer(api, kv, cfg, account) {
  const k = customerKey(cfg, account);
  const existing = await kv.cmd(['GET', k]);
  if (existing) return existing;
  const customer = await api('POST customers', { 'metadata[ug_account]': account }, `ug-customer-${account}`);
  if (!id(customer.id, 'cus') || customer.livemode !== (cfg.mode === 'live')) throw new Error('Unexpected Stripe customer');
  return await kv.cmd(['SET', k, customer.id, 'NX']) ? customer.id : kv.cmd(['GET', k]);
}

function hostedUrl(raw, hostname) {
  const url = new URL(raw);
  if (url.origin !== `https://${hostname}` || url.username || url.password) throw new Error('Unexpected Stripe redirect');
  return url.href;
}

export async function handleBilling(action, req, { kv, secret, env = process.env, fetchImpl = fetch }) {
  const cfg = billingConfig(env);
  if (!['status', 'checkout', 'portal'].includes(action)) return error(404, 'not_found');
  if (req.method !== (action === 'status' ? 'GET' : 'POST')) return error(405, 'method_not_allowed');
  if (!cfg || !kv || !authEnabled(secret)) return action === 'status' ? result(200, { available: false }) : error(503, 'billing_disabled');
  if (action !== 'status' && (req.origin !== cfg.origin || req.host !== new URL(cfg.origin).host)) return error(403, 'bad_origin');

  const acct = await accountFromSession(kv, secret, req.cookie);
  const account = acct && Object.keys(acct.providers || {}).length ? acct.id : null;
  const api = stripeApi(cfg, fetchImpl);
  const checkoutEnabled = Boolean(aiEnv(env).key) && (cfg.mode === 'test' || env.UNTERGRUND_LIVE_CHECKOUT === '1');
  if (action === 'status') {
    if (!await allow(kv, 'billing-status', req.client)) return error(429, 'rate_limited');
    const customer = account && await kv.cmd(['GET', customerKey(cfg, account)]);
    const [plan, sub] = await Promise.all([planPrice(api, cfg), customer ? membership(api, cfg, customer, account) : { state: 'free' }]);
    return result(200, { available: true, test: cfg.mode === 'test', plan: { ...plan, accepting: plan.accepting && checkoutEnabled }, signedIn: Boolean(account),
      member: sub.state, ending: Boolean(sub.ending), manage: Boolean(customer) });
  }
  if (!account) return error(401, 'sign_in_required');
  if (!await allow(kv, 'billing-write', account)) return error(429, 'rate_limited');
  if (action === 'portal') {
    const customer = await kv.cmd(['GET', customerKey(cfg, account)]);
    if (!customer) return error(404, 'billing_account_missing');
    const portal = await api('POST billing_portal/sessions', { customer, configuration: cfg.portal, return_url: `${cfg.origin}/pricing` });
    return result(200, { url: hostedUrl(portal.url, 'billing.stripe.com') });
  }

  if (!checkoutEnabled || !(await planPrice(api, cfg)).accepting) return error(409, 'checkout_paused');
  const customer = await getCustomer(api, kv, cfg, account);
  // The latest session's ID makes simultaneous requests use the same idempotency key, even across instances.
  const latest = (await api('checkout/sessions', { customer, limit: 1 })).data[0];
  if ((await membership(api, cfg, customer, account)).state !== 'free') return error(409, 'subscription_exists');
  if (latest?.status === 'open') {
    if (latest.metadata?.ug_price !== cfg.price) return error(409, 'checkout_in_progress');
    return result(200, { url: hostedUrl(latest.url, 'checkout.stripe.com') });
  }
  const session = await api('POST checkout/sessions', {
    mode: 'subscription', customer, 'line_items[0][price]': cfg.price, 'line_items[0][quantity]': '1',
    'payment_method_types[0]': 'card', 'subscription_data[metadata][ug_account]': account,
    'metadata[ug_price]': cfg.price,
    success_url: `${cfg.origin}/pricing?checkout=return`,
    cancel_url: `${cfg.origin}/pricing?checkout=canceled`,
  }, `ug-checkout-${customer}-${latest?.id || 'first'}`);
  return result(200, { url: hostedUrl(session.url, 'checkout.stripe.com') });
}

export async function hasActivePro(kv, account, cfg, fetchImpl = fetch) {
  const customer = await kv.cmd(['GET', customerKey(cfg, account)]);
  return !!customer && (await membership(stripeApi(cfg, fetchImpl), cfg, customer, account)).state === 'active';
}

function signedEvent(raw, signature, secret, now) {
  if (!Buffer.isBuffer(raw) || typeof signature !== 'string') return null;
  const fields = signature.split(',').map((field) => field.trim().split('='));
  const stamp = fields.find(([name]) => name === 't')?.[1];
  if (!/^\d{1,12}$/.test(stamp || '') || Math.abs(Math.floor(now / 1000) - Number(stamp)) > 300) return null;
  const expected = createHmac('sha256', secret).update(`${stamp}.`).update(raw).digest();
  if (!fields.some(([name, value]) => name === 'v1' && /^[\da-f]{64}$/i.test(value || '') &&
    timingSafeEqual(expected, Buffer.from(value, 'hex')))) return null;
  try { return JSON.parse(raw.toString('utf8')); } catch { return null; }
}

export async function handleBillingWebhook(req, { kv, env = process.env, fetchImpl = fetch, now = Date.now() }) {
  if (req.method !== 'POST') return error(405, 'method_not_allowed');
  const cfg = billingConfig(env);
  if (!cfg || !kv) return error(503, 'billing_disabled');
  if (!req.raw || req.raw.length > MAX_WEBHOOK_BYTES) return error(413, 'too_large');
  const event = signedEvent(req.raw, req.signature, cfg.signingSecret, now);
  if (!event || event.livemode !== (cfg.mode === 'live')) return error(400, 'invalid_stripe_event');
  const resource = event.data?.object;
  const account = resource?.metadata?.ug_account;
  if (SUBSCRIPTION_EVENTS.has(event.type) && /^u[a-z0-9]+$/.test(account || '') && id(resource.customer, 'cus') &&
      await kv.cmd(['GET', customerKey(cfg, account)]) === resource.customer) {
    // Re-read Stripe, not the event snapshot: Stripe can deliver retries and old events in any order.
    const version = await kv.cmd(['INCR', key(cfg, 'sync', account)]);
    const current = await membership(stripeApi(cfg, fetchImpl), cfg, resource.customer, account);
    const k = badgeKey(cfg, account);
    await kv.cmd(['ZADD', k, version, `${version}:${current.state === 'active' ? '1' : '0'}`]);
    await kv.cmd(['ZREMRANGEBYRANK', k, 0, -2]);
  }
  return result(200, { received: true });
}

export async function readBillingWebhook(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= MAX_WEBHOOK_BYTES) chunks.push(chunk);
  }
  return size <= MAX_WEBHOOK_BYTES ? Buffer.concat(chunks) : null;
}

export async function hasProBadge(kv, account, env = process.env) {
  const cfg = billingConfig(env);
  if (!cfg || !kv) return false;
  const [latest] = await kv.cmd(['ZREVRANGEBYSCORE', badgeKey(cfg, account), '+inf', '-inf', 'LIMIT', 0, 1]);
  return latest?.endsWith(':1') || false;
}
