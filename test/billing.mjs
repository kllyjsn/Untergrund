import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleAccount, linkProvider, sessionCookie, signSession } from '../api/_lib/accounts.js';
import { billingConfig, handleBilling, handleBillingWebhook, hasSupporterBadge, readBillingWebhook } from '../api/_lib/billing.js';
import { memoryKv } from '../api/_lib/kv.js';
import { handlePage } from '../api/_lib/pages.js';

const kv = memoryKv(), secret = 'a'.repeat(48), origin = 'http://localhost:8020';
const env = {
  UNTERGRUND_STRIPE_MODE: 'test', UNTERGRUND_STRIPE_SECRET_KEY: 'sk_test_fixture',
  UNTERGRUND_STRIPE_WEBHOOK_SECRET: 'whsec_fixture', UNTERGRUND_STRIPE_PRICE_ID: 'price_supporter',
  UNTERGRUND_STRIPE_PORTAL_CONFIGURATION: 'bpc_supporter', UNTERGRUND_BILLING_ORIGIN: origin,
};
const live = { ...env, VERCEL_ENV: 'production', UNTERGRUND_STRIPE_MODE: 'live',
  UNTERGRUND_STRIPE_SECRET_KEY: 'sk_live_fixture', UNTERGRUND_BILLING_ORIGIN: 'https://www.untergrund.sh' };
assert.equal(billingConfig({}), null);
assert.equal(billingConfig({ ...env, VERCEL_ENV: 'production' }), null);
assert.equal(billingConfig({ ...env, UNTERGRUND_STRIPE_SECRET_KEY: live.UNTERGRUND_STRIPE_SECRET_KEY }), null);
assert.equal(billingConfig({ ...env, UNTERGRUND_BILLING_ORIGIN: live.UNTERGRUND_BILLING_ORIGIN }), null);
assert.equal(billingConfig({ ...live, VERCEL_ENV: 'preview' }), null);
assert.equal(billingConfig({ ...live, UNTERGRUND_STRIPE_MODE: 'test' }), null);
assert.equal(billingConfig(live).mode, 'live');

const acct = await linkProvider(kv, null, 'soundcloud', { id: '42', username: 'Nova', handleHint: 'nova' });
const other = await linkProvider(kv, null, 'soundcloud', { id: '43', username: 'Echo', handleHint: 'echo' });
const cookie = (a) => sessionCookie(signSession({ sub: a.id }, secret)).split(';')[0];
const device = await handleAccount({ method: 'POST', body: { action: 'device' } }, { kv, secret });
const anonymous = device.cookie.split(';')[0];
let latest, subscription, customerCount = 0, checkoutCount = 0, portalCount = 0;
const made = new Map();
const stripe = async (raw, req) => {
  const url = new URL(raw), params = req.body || url.searchParams;
  const key = req.headers['Idempotency-Key'];
  assert.equal(url.origin, 'https://api.stripe.com');
  assert.equal(req.headers.Authorization, 'Bearer sk_test_fixture');
  if (req.method === 'POST' && key && made.has(key)) return Response.json(made.get(key));
  let data;
  switch (`${req.method} ${url.pathname}`) {
    case 'GET /v1/prices/price_supporter':
      data = { id: 'price_supporter', livemode: false, active: true, currency: 'usd', unit_amount: 1200, type: 'recurring',
        recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } }; break;
    case 'POST /v1/customers':
      assert.equal(params.get('metadata[ug_account]'), acct.id);
      assert.equal(key, `ug-customer-${acct.id}`);
      customerCount++; data = { id: 'cus_nova', livemode: false }; break;
    case 'GET /v1/subscriptions':
      assert.equal(params.get('customer'), 'cus_nova');
      assert.equal(params.get('status'), 'all');
      data = { data: subscription ? [subscription] : [] }; break;
    case 'GET /v1/checkout/sessions':
      assert.equal(params.get('customer'), 'cus_nova');
      data = { data: latest ? [latest] : [] }; break;
    case 'POST /v1/checkout/sessions':
      assert.equal(params.get('customer'), 'cus_nova');
      assert.equal(params.get('line_items[0][price]'), 'price_supporter');
      assert.equal(params.get('subscription_data[metadata][ug_account]'), acct.id);
      assert.equal(params.get('success_url'), origin + '/pricing?checkout=return');
      assert.equal(params.get('cancel_url'), origin + '/pricing?checkout=canceled');
      checkoutCount++;
      data = latest = { id: `cs_test_${checkoutCount}`, status: 'open', url: `https://checkout.stripe.com/c/pay/cs_test_${checkoutCount}`,
        metadata: { ug_price: params.get('metadata[ug_price]') } };
      break;
    case 'POST /v1/billing_portal/sessions':
      assert.equal(params.get('customer'), 'cus_nova');
      assert.equal(params.get('configuration'), 'bpc_supporter');
      assert.equal(params.get('return_url'), origin + '/pricing');
      portalCount++; data = { url: 'https://billing.stripe.com/p/session/test' }; break;
    default: assert.fail(`Unexpected Stripe request: ${req.method} ${url.pathname}`);
  }
  if (req.method === 'POST' && key) made.set(key, data);
  return Response.json(data);
};
const ctx = { kv, secret, env, fetchImpl: stripe };
const call = (action, opts = {}, context = ctx) => handleBilling(action, {
  method: action === 'status' ? 'GET' : 'POST', cookie: cookie(acct), origin, host: 'localhost:8020', client: 'test', ...opts,
}, context);
assert.deepEqual((await call('status', {}, { ...ctx, env: {} })).json, { available: false });
assert.equal((await call('checkout', {}, { ...ctx, env: {} })).status, 503);
assert.equal((await call('checkout', { method: 'GET' })).status, 405);
assert.equal((await call('checkout', { origin: 'https://other.test' })).status, 403);
assert.equal((await call('checkout', { host: 'other.test' })).status, 403);
assert.equal((await call('checkout', { origin: undefined })).status, 403);
assert.equal((await call('checkout', { cookie: anonymous })).status, 401);
assert.equal((await call('checkout', { cookie: 'ug_session=%XX' })).status, 401);
assert.equal((await call('portal', { cookie: cookie(other) })).status, 404);
assert.deepEqual((await call('status', { cookie: anonymous })).json, {
  available: true, test: true, plan: { cents: 1200, currency: 'usd', accepting: true }, signedIn: false, member: 'free', ending: false, manage: false,
});
assert.equal(customerCount, 0);
const [checkoutA, checkoutB] = await Promise.all([call('checkout'), call('checkout')]);
assert.equal(checkoutA.json.url, checkoutB.json.url);
assert.equal((await call('checkout')).json.url, checkoutA.json.url);
assert.equal(customerCount, 1);
assert.equal(checkoutCount, 1);
assert.equal(portalCount, 0);
assert.equal((await call('portal')).json.url, 'https://billing.stripe.com/p/session/test');
assert.equal(portalCount, 1);

const now = 1770000000000;
const send = (type, status, opts = {}, context = ctx) => {
  const event = { livemode: opts.live ?? false, type, data: { object: { id: 'sub_fixture', status, customer: 'cus_nova', metadata: { ug_account: opts.account || acct.id } } } };
  const raw = Buffer.from(JSON.stringify(event, null, 2));
  const stamp = Math.floor(now / 1000) - (opts.age || 0);
  const mac = createHmac('sha256', env.UNTERGRUND_STRIPE_WEBHOOK_SECRET).update(`${stamp}.`).update(raw).digest('hex');
  const signature = `t=${stamp},v1=${'0'.repeat(64)},v1=${mac}`;
  return handleBillingWebhook({ method: 'POST', raw: opts.tampered ? Buffer.from(JSON.stringify(event)) : raw, signature }, { ...context, now });
};
assert.equal((await send('customer.subscription.created', 'active', { tampered: true })).status, 400);
assert.equal((await send('customer.subscription.created', 'active', { age: 301 })).status, 400);
assert.equal((await send('customer.subscription.created', 'active', { live: true })).status, 400);
assert.equal((await readBillingWebhook([Buffer.from(' {'), Buffer.from('} ')])).toString(), ' {} ');
assert.equal(await readBillingWebhook([Buffer.alloc(512 * 1024 + 1)]), null);
assert.equal(await hasSupporterBadge(kv, acct.id, env), false);

latest.status = 'complete';
subscription = { id: 'sub_fixture', customer: 'cus_nova', livemode: false, status: 'active', metadata: { ug_account: acct.id } };
assert.equal((await send('customer.subscription.created', 'active', { account: other.id })).status, 200);
assert.equal(await hasSupporterBadge(kv, acct.id, env), false);
assert.equal((await send('customer.subscription.created', 'active')).status, 200);
assert.equal((await send('customer.subscription.created', 'active')).status, 200, 'duplicate events are safe');
assert.equal(await hasSupporterBadge(kv, acct.id, env), true);
assert.equal(await hasSupporterBadge(kv, acct.id, live), false, 'test badges never appear in live mode');
assert.equal(await hasSupporterBadge(kv, other.id, env), false);
assert.equal((await call('status')).json.member, 'active');
assert.equal((await call('checkout')).json.error, 'subscription_exists');
const page = await handlePage({ a: 'nova' }, { kv, env });
assert.equal(page.cache, 'no-store', 'the badge must not be served stale after cancellation');
assert.match(page.body, /class="pp-supporter"/);
assert.doesNotMatch(page.body, /cus_nova|sub_fixture|price_supporter/);
assert.doesNotMatch((await handlePage({ a: 'echo' }, { kv, env })).body, /class="pp-supporter"/);

subscription.cancel_at_period_end = true;
assert.equal((await call('status')).json.ending, true);
let observed, release;
const snapshotRead = new Promise((resolve) => { observed = resolve; });
const hold = new Promise((resolve) => { release = resolve; });
const oldSync = send('customer.subscription.updated', 'active', {}, { ...ctx, fetchImpl: async (...args) => {
  const snapshot = await stripe(...args);
  observed();
  await hold;
  return snapshot;
} });
await snapshotRead;
subscription.status = 'canceled';
assert.equal((await send('customer.subscription.deleted', 'canceled')).status, 200);
release();
await oldSync;
assert.equal(await hasSupporterBadge(kv, acct.id, env), false, 'a stale concurrent webhook cannot restore access');
assert.equal((await send('customer.subscription.updated', 'active')).status, 200);
assert.equal(await hasSupporterBadge(kv, acct.id, env), false, 'an out-of-order event reads the current Stripe state');
assert.doesNotMatch((await handlePage({ a: 'nova' }, { kv, env })).body, /class="pp-supporter"/);
assert.equal((await call('status')).json.member, 'free');
assert.equal((await call('checkout')).status, 200, 'a canceled member can rejoin');
assert.equal(checkoutCount, 2);
console.log('billing: mode isolation, account security, checkout, portal, webhook and entitlement passed');
