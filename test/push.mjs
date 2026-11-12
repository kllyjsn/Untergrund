import assert from 'node:assert/strict';
import { createECDH, createDecipheriv, createHmac, createPublicKey, createVerify } from 'node:crypto';
import { encrypt, vapidAuth, vapidKeys, generateVapidKeys, sendPush, b64url, unb64 } from '../api/_lib/webpush.js';
import { handlePush, sendDaily, pushEnv, dropMessage, subId, cleanSubscription } from '../api/_lib/push.js';
import { memoryKv } from '../api/_lib/kv.js';
import { dailyDrop } from '../js/daily.js';
import { EVENTS, DIMENSION } from '../api/_lib/events.js';

// RFC 8291 Appendix A: byte-exact aes128gcm Web Push encryption.
const rfc = encrypt('When I grow up, I want to be a watermelon',
  { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
  { salt: unb64('DGv6ra1nlYgDCS1FRnbzlw'), serverKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' });
assert.equal(b64url(rfc), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');

// A browser-side decrypt of a random-salt message round-trips.
const ua = createECDH('prime256v1'); ua.generateKeys();
const auth = b64url(Buffer.from('0123456789abcdef'));
const keys = { p256dh: b64url(ua.getPublicKey()), auth };
function decrypt(buf) {
  const salt = buf.subarray(0, 16), idlen = buf[20], as = buf.subarray(21, 21 + idlen), body = buf.subarray(21 + idlen);
  const h = (k, d) => createHmac('sha256', k).update(d).digest();
  const ikm = h(h(unb64(auth), ua.computeSecret(as)), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), as, Buffer.from([1])]));
  const prk = h(salt, ikm);
  const d = createDecipheriv('aes-128-gcm', h(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16), h(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12));
  d.setAuthTag(body.subarray(-16));
  const out = Buffer.concat([d.update(body.subarray(0, -16)), d.final()]);
  assert.equal(out.at(-1), 2);
  return out.subarray(0, -1).toString();
}
assert.equal(decrypt(encrypt('{"hi":1}', keys)), '{"hi":1}');

// VAPID: keys validate as a pair, and the JWT verifies with the public key.
const vk = generateVapidKeys();
assert.deepEqual(vapidKeys(vk.publicKey, vk.privateKey), vk);
assert.equal(vapidKeys(vk.publicKey, generateVapidKeys().privateKey), null, 'mismatched pair');
assert.equal(vapidKeys('nope', ''), null);
const vapid = { ...vk, subject: 'mailto:test@untergrund.sh' };
const authz = vapidAuth('https://fcm.googleapis.com/fcm/send/abc', vapid, Date.parse('2026-11-12T16:00:00Z'));
const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(authz);
assert.equal(k, vk.publicKey);
const [hd, cl, sig] = jwt.split('.');
const claims = JSON.parse(unb64(cl));
assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: Date.parse('2026-11-12T17:00:00Z') / 1000, sub: 'mailto:test@untergrund.sh' });
const pub = unb64(vk.publicKey);
const pubKey = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) } });
assert(createVerify('SHA256').update(`${hd}.${cl}`).verify({ key: pubKey, dsaEncoding: 'ieee-p1363' }, unb64(sig)));

// Env gating: no keys -> disabled, app unchanged.
assert.equal(pushEnv({}), null);
const env = { VAPID_PUBLIC_KEY: vk.publicKey, VAPID_PRIVATE_KEY: vk.privateKey, CRON_SECRET: 'cron-secret' };
assert.equal(pushEnv(env).subject, 'https://www.untergrund.sh');
let r = await handlePush({ method: 'GET', env: {}, kv: memoryKv() });
assert.deepEqual(r, { status: 200, json: { enabled: false } });
r = await handlePush({ method: 'GET', env, kv: null });
assert.equal(r.json.enabled, false, 'no storage -> disabled');
r = await handlePush({ method: 'POST', env: {}, kv: memoryKv(), body: {} });
assert.equal(r.status, 503);

// Subscribe validation: real push services only, well-formed keys.
const sub = (n, host = 'fcm.googleapis.com') => ({ endpoint: `https://${host}/fcm/send/device-${n}`, keys });
assert(cleanSubscription(sub(1)));
assert(cleanSubscription(sub(1, 'web.push.apple.com')));
assert(cleanSubscription(sub(1, 'updates.push.services.mozilla.com')));
assert.equal(cleanSubscription(sub(1, 'evil.example.com')), null, 'no arbitrary URLs');
assert.equal(cleanSubscription(sub(1, 'fcm.googleapis.com.evil.com')), null);
assert.ok(cleanSubscription(sub(1, 'jmt17.google.com')), 'Chrome endpoints moved to *.google.com');
assert.equal(cleanSubscription(sub(1, 'google.com.evil.com')), null);
assert.equal(cleanSubscription({ endpoint: 'http://fcm.googleapis.com/x', keys }), null);
assert.equal(cleanSubscription({ ...sub(1), keys: { p256dh: keys.p256dh, auth: 'short' } }), null);

const kv = memoryKv();
const now = Date.parse('2026-11-12T16:00:00Z');
const call = (body, extra = {}) => handlePush({ method: 'POST', env, kv, body, client: '1.2.3.4', now, ...extra });
r = await handlePush({ method: 'GET', env, kv });
assert.deepEqual(r.json, { enabled: true, publicKey: vk.publicKey });
assert.equal((await call({ action: 'subscribe', subscription: sub(1, 'evil.example.com') })).status, 400);
assert.equal((await call({ action: 'nope' })).status, 400);
assert.equal((await call(JSON.stringify({ action: 'subscribe', subscription: sub(1), streak: 3, last: '2026-11-11' }))).status, 201);
assert.equal((await call({ action: 'subscribe', subscription: sub(1), streak: 4, last: '2026-11-11' })).status, 200, 'resubscribe updates');
await call({ action: 'subscribe', subscription: sub(2), streak: 2, last: '2026-11-12' });   // already played today
await call({ action: 'subscribe', subscription: sub(3), streak: 9, last: '2026-11-01' });   // streak broke
await call({ action: 'subscribe', subscription: sub(4), streak: 'x', last: 'garbage' });
await call({ action: 'subscribe', subscription: sub(5) });
await call({ action: 'subscribe', subscription: sub(6) }, { now: now - 61 * 864e5 });         // app not opened in 61 days
const stored = JSON.parse(await kv.cmd(['HGET', 'untergrund:push:subs', subId(sub(1).endpoint)]));
assert.equal(stored.streak, 4);
assert.equal(stored.last, '2026-11-11');
assert.deepEqual(JSON.parse(await kv.cmd(['HGET', 'untergrund:push:subs', subId(sub(4).endpoint)])).streak, 0);
assert.equal((await call({ action: 'unsubscribe', endpoint: sub(5).endpoint })).status, 200);
assert.equal(await kv.cmd(['HLEN', 'untergrund:push:subs']), 5);

// Renewal carries the streak to the new endpoint.
assert.equal((await call({ action: 'renew', old: sub(1).endpoint, subscription: sub(7) })).status, 200);
assert.equal(await kv.cmd(['HGET', 'untergrund:push:subs', subId(sub(1).endpoint)]), null);
assert.equal(JSON.parse(await kv.cmd(['HGET', 'untergrund:push:subs', subId(sub(7).endpoint)])).streak, 4);

// Messages: title, genre, streak, deep link.
const drop = dailyDrop('2026-11-12');
assert.deepEqual(dropMessage({ streak: 4, last: '2026-11-11' }, '2026-11-12'),
  { title: `Today’s drop: ${drop.title}`, body: `${drop.genre} · Play it for a 5-day streak.`, url: '/?drop=2026-11-12&from=push', tag: 'daily-drop' });
assert.equal(dropMessage({ streak: 9, last: '2026-11-01' }, '2026-11-12').body, `${drop.genre} · One new track for everyone today.`);

// Cron: auth required, sends once a day, removes expired + stale subscriptions.
assert.equal((await handlePush({ method: 'GET', env, kv, headers: { authorization: 'Bearer wrong' } })).status, 401);
assert.equal((await handlePush({ method: 'GET', env: { ...env, CRON_SECRET: '' }, kv, headers: { authorization: 'Bearer ' } })).status, 401, 'no secret, no send');
assert.equal((await handlePush({ method: 'GET', env, kv, query: { send: '1' } })).status, 401);
const sent = [];
const fakeFetch = async (url, init) => {
  sent.push({ url, init });
  assert.match(init.headers.Authorization, /^vapid t=.+, k=/);
  assert.equal(init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(init.headers.Topic, 'daily-drop');
  return { status: url.endsWith('device-3') ? 410 : 201 };
};
r = await handlePush({ method: 'GET', env, kv, headers: { authorization: 'Bearer cron-secret' }, now, fetchImpl: fakeFetch });
assert.equal(r.status, 200);
assert.deepEqual(r.json, { date: '2026-11-12', total: 5, sent: 2, played: 1, expired: 1, stale: 1, failed: 0 });
assert.deepEqual(sent.map((s) => s.url.split('-').pop()).sort(), ['3', '4', '7'], 'played-today and stale ones are not pinged');
const msg = JSON.parse(decrypt(sent.find((s) => s.url.endsWith('device-7')).init.body));
assert.equal(msg.body, `${drop.genre} · Play it for a 5-day streak.`);
assert.equal(await kv.cmd(['HLEN', 'untergrund:push:subs']), 3, 'expired (410) and stale subscriptions are removed');
r = await handlePush({ method: 'GET', env, kv, headers: { authorization: 'Bearer cron-secret' }, now, fetchImpl: fakeFetch });
assert.equal(r.json.skipped, 'already_sent');
r = await sendDaily({ kv, vapid: pushEnv(env), now, force: true, fetchImpl: async () => { throw new Error('network'); } });
assert.equal(r.failed, 2);

// Rate limit per client.
const rl = memoryKv();
for (let i = 0; i < 30; i++) await handlePush({ method: 'POST', env, kv: rl, client: '9.9.9.9', body: { action: 'subscribe', subscription: sub(1) } });
assert.equal((await handlePush({ method: 'POST', env, kv: rl, client: '9.9.9.9', body: { action: 'subscribe', subscription: sub(1) } })).status, 429);

// sendPush passes through the push service status.
assert.equal(await sendPush(sub(1), { t: 1 }, vapid, { fetchImpl: async () => ({ status: 201 }) }), 201);

assert(EVENTS.includes('push') && DIMENSION.push === 'kind');
console.log('push ok');
