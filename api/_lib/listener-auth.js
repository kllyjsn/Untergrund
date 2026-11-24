import { createHash, createPublicKey, randomBytes, scrypt, timingSafeEqual, verify } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
const b64 = (bytes) => bytes.toString('base64url');
export const randomToken = () => b64(randomBytes(32));
export const digest = (value) => createHash('sha256').update(value).digest('base64url');
export const emailID = (email) => digest(`email:${email}`);
export function emailAddress(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^@\s\x00-\x1f]+@[^@\s\x00-\x1f]+\.[^@\s\x00-\x1f]+$/.test(email) ? email : null;
}
export const validPassword = (value, min = 12) => typeof value === 'string' && [...value].length >= min && Buffer.byteLength(value) <= 256;
export async function passwordHash(password, salt = b64(randomBytes(16))) {
  return `${salt}.${b64(await derive(password, salt, 32, options))}`;
}
export async function passwordMatches(password, encoded) {
  const [salt, hash] = (encoded || '0000000000000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').split('.');
  const got = (await passwordHash(password, salt)).split('.')[1];
  return timingSafeEqual(Buffer.from(got), Buffer.from(hash)) && !!encoded;
}

export const GOOGLE_CALLBACK = '/api/auth/google/callback';
export const googleEnabled = (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const resetEnabled = (env) => !!(env.RESEND_API_KEY && env.ACCOUNT_EMAIL_FROM);
export const accountOrigin = (secure, host) => {
  if (secure) return 'https://www.untergrund.sh';
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/.test(host) ? `http://${host}` : null;
};

export function googleAuthorization(env, redirectUri, state, nonce, verifier) {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile',
    state, nonce, code_challenge: digest(verifier), code_challenge_method: 'S256',
  });
}
export async function googleProfile(env, fetchImpl, code, redirect_uri, { verifier, nonce }) {
  if (typeof code !== 'string' || !code || code.length > 4096) return null;
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, redirect_uri, grant_type: 'authorization_code', code_verifier: verifier,
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET }),
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) return null;
  const { id_token } = await response.json();
  if (typeof id_token !== 'string' || id_token.length > 12000) return null;
  const parts = id_token.split('.');
  if (parts.length !== 3) return null;
  const decode = (i) => JSON.parse(Buffer.from(parts[i], 'base64url').toString());
  const header = decode(0), claims = decode(1);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' ||
      !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) ||
      claims.aud !== env.GOOGLE_CLIENT_ID || (claims.azp && claims.azp !== env.GOOGLE_CLIENT_ID) ||
      !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 || claims.nonce !== nonce ||
      typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(claims.sub)) return null;
  const keys = await fetchImpl('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(7000) });
  if (!keys.ok) return null;
  const jwk = (await keys.json()).keys?.find((k) => k.kid === header.kid && k.kty === 'RSA' && k.use === 'sig');
  if (!jwk || !verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')), createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url'))) return null;
  return { id: claims.sub, username: typeof claims.name === 'string' ? claims.name : '' };
}

export async function sendPasswordReset(env, fetchImpl, email, resetURL, id) {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `ug-reset-${id}` },
    body: JSON.stringify({ from: env.ACCOUNT_EMAIL_FROM, to: [email], subject: 'Reset your Untergrund password',
      text: `Reset your Untergrund password within 30 minutes:\n\n${resetURL}\n\nIf you didn't request this, you can ignore this email.` }),
    signal: AbortSignal.timeout(7000),
  });
  return response.ok;
}
