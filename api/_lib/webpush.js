// Standard Web Push with no provider and no dependencies: VAPID (RFC 8292) auth + aes128gcm payload encryption (RFC 8291).
import { createECDH, createHmac, createCipheriv, createPrivateKey, createSign, randomBytes } from 'node:crypto';

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const unb64 = (s) => Buffer.from(String(s || ''), 'base64url');

// VAPID keys in the usual web-push format: public = 65-byte uncompressed P-256 point, private = 32-byte scalar (both base64url).
export function vapidKeys(publicKey, privateKey) {
  const pub = unb64(publicKey), priv = unb64(privateKey);
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) return null;
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(priv);
    if (!ecdh.getPublicKey().equals(pub)) return null;
  } catch { return null; }
  return { publicKey: b64url(pub), privateKey: b64url(priv) };
}

export function generateVapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

export function vapidAuth(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  const pub = unb64(publicKey);
  const key = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) } });
  const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 3600, sub: subject }));
  const sig = createSign('SHA256').update(`${head}.${claims}`).sign({ key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64url(sig)}, k=${publicKey}`;
}

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// RFC 8291 §3.4 + RFC 8188: one record, plaintext || 0x02. `salt` and `serverKey` are only passed in by tests.
export function encrypt(payload, { p256dh, auth }, { salt = randomBytes(16), serverKey = null } = {}) {
  const ua = unb64(p256dh), secret = unb64(auth);
  const ecdh = createECDH('prime256v1');
  if (serverKey) ecdh.setPrivateKey(unb64(serverKey)); else ecdh.generateKeys();
  const as = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(ua);
  const ikm = hmac(hmac(secret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = as.length;
  return Buffer.concat([header, as, body]);
}

// Resolves to the push service's HTTP status (201 = queued; 404/410 = the subscription is gone).
export async function sendPush(subscription, payload, vapid, { ttl = 43200, topic = '', urgency = 'normal', fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const res = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuth(subscription.endpoint, vapid),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      TTL: String(ttl), Urgency: urgency, ...(topic && { Topic: topic }),
    },
    body: encrypt(JSON.stringify(payload), subscription.keys),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.status;
}
