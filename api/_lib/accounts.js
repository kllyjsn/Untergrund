// Creator accounts: an anonymous device identity (signed httpOnly cookie) that can claim a handle,
// provider sign-in (SoundCloud first) that attaches to it, follows, and permanent track homes.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { STYLES } from '../../js/state.js';
import { clean } from './crate.js';
import { scConfig, exchangeToken } from './soundcloud.js';
import { compareAndSet as commit, incrementWithExpiry, migrateAccountData } from './kv.js';
import { accountOrigin, digest, emailAddress, emailID, GOOGLE_CALLBACK, googleAuthorization, googleEnabled,
  googleProfile, passwordHash, passwordMatches, randomToken, resetEnabled, sendPasswordReset, validPassword } from './listener-auth.js';

export const COOKIE = 'ug_session';
const SESSION_DAYS = 365;
const P = 'untergrund:acct:';
const K = {
  acct: (id) => `${P}a:${id}`,
  handle: (h) => `${P}h:${h}`,
  link: (provider, id) => `${P}l:${provider}:${id}`,
  tracks: (id) => `${P}t:${id}`,
  track: (id) => `${P}track:${id}`,
  owner: (id) => `${P}o:${id}`,
  followers: (id) => `${P}fr:${id}`,
  following: (id) => `${P}fg:${id}`,
  rate: (bucket, client) => `${P}r:${bucket}:${client}`,
  email: (id) => `${P}email:${id}`,
  password: (id) => `${P}pw:${id}`,
  reset: (id) => `${P}reset:${id}`,
  oauth: (id) => `${P}oauth:${id}`,
};
const TRACK_LIMIT = 500, FEED_FOLLOWS = 50, FEED_LIMIT = 30;
const LIMITS = { device: [20, 3600], claim: [12, 3600], profile: [60, 3600], follow: [120, 3600], soundcloud: [30, 3600],
  'email-signup': [6, 3600], 'email-login': [20, 900], 'email-attempt': [10, 900], 'password-change': [8, 900],
  'reset-request': [8, 3600], 'reset-email': [3, 3600], 'reset-password': [15, 900],
  'google-start': [20, 900], 'google-callback': [30, 900], preferences: [60, 3600] };
const RATE_LIMITS = { ...LIMITS, 'billing-status': [120, 60], 'billing-write': [12, 60], 'pro-drafts': [6, 60] };
const WRITE_ACTIONS = new Set([...Object.keys(LIMITS).filter((a) => !['email-attempt', 'reset-email', 'google-callback'].includes(a)), 'unfollow', 'signout']);
const OAUTH_COOKIE = 'ug_google';
const RESET_TTL = 30 * 60;
const GOOGLE_TTL = 10 * 60;
const EMAIL_FAILURE_THRESHOLD = 20, EMAIL_FAILURE_WINDOW = 15 * 60;
const validToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);
export const DNA_TRAITS = ['darkness', 'hypnosis', 'acid', 'space', 'energy'];

// ---------- handles ----------
export const RESERVED_HANDLES = new Set(`a t api www app admin administrator root system support help about faq terms privacy legal
  login logout signin signout signup register account accounts settings profile me you null undefined
  untergrund jukebox club studio artist artists create home feed following followers explore discover search
  track tracks set sets room rooms live publish og static assets css js samples dist public mod moderator staff
  official team soundcloud spotify apple youtube vercel status security billing pricing`.split(/\s+/).filter(Boolean));

export const normalizeHandle = (raw) => String(raw ?? '').normalize('NFKC').trim().replace(/^@/, '').toLowerCase();

export function handleError(raw) {
  const h = normalizeHandle(raw);
  if (h.length < 3) return 'too_short';
  if (h.length > 24) return 'too_long';
  if (!/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(h) || /[_-]{2}/.test(h)) return 'invalid';
  if (RESERVED_HANDLES.has(h) || /^untergrund/.test(h) || /admin|official/.test(h)) return 'reserved';
  return null;
}

// ---------- sessions ----------
const b64 = (s) => Buffer.from(s).toString('base64url');
const mac = (data, secret) => createHmac('sha256', secret).update(data).digest('base64url');
export const authEnabled = (secret) => typeof secret === 'string' && secret.length >= 32;

export function signSession(payload, secret, { now = Date.now(), days = SESSION_DAYS } = {}) {
  if (!authEnabled(secret)) throw new Error('auth_secret_missing');
  const body = b64(JSON.stringify({ ...payload, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000 + days * 86400) }));
  return `${body}.${mac(body, secret)}`;
}

export function verifySession(token, secret, { now = Date.now() } = {}) {
  if (!authEnabled(secret) || typeof token !== 'string' || token.length > 1024) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = Buffer.from(mac(body, secret)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p || typeof p.sub !== 'string' || !(p.exp > now / 1000)) return null;
    return p;
  } catch { return null; }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const sessionCookie = (token, { secure = true } = {}) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
export const clearCookie = ({ secure = true } = {}) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

// ---------- storage helpers ----------
const getJson = async (kv, key) => { const s = await kv.cmd(['GET', key]); try { return s ? JSON.parse(s) : null; } catch { return null; } };
export async function accountFromSession(kv, secret, cookie) {
  if (!kv) return null;
  let token;
  try { token = parseCookies(cookie)[COOKIE]; } catch { return null; }
  const session = verifySession(token, secret);
  const acct = session && await getJson(kv, K.acct(session.sub));
  return acct && acct.authVersion === session.ver ? acct : null;
}
const setJson = (kv, key, v) => kv.cmd(['SET', key, JSON.stringify(v)]);
const saveAccount = (kv, previous, next) => commit(kv, [K.acct(next.id), previous && JSON.stringify(previous), JSON.stringify(next)]);
const newId = () => `u${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;

export async function allow(kv, bucket, client) {
  const [max, windowSec] = RATE_LIMITS[bucket] || [60, 3600];
  const key = K.rate(bucket, clean(client, 64) || 'anon');
  const n = await kv.cmd(['INCR', key]);
  if (n === 1) await kv.cmd(['EXPIRE', key, windowSec]);
  return n <= max;
}

const AVATAR = /^https:\/\/[a-z0-9.-]*sndcdn\.com\/[A-Za-z0-9._\/-]+$/;
const cleanDna = (dna) => Object.fromEntries(DNA_TRAITS.map((t) => [t, Math.max(0, Math.min(100, Math.round(Number(dna?.[t]) || 0)))]));

function publicArtist(acct, followers = 0, following = 0) {
  return {
    handle: acct.handle, name: acct.name || acct.handle, bio: acct.bio || '', avatar: acct.avatar || '',
    dna: acct.dna || null, followers, following, created: acct.created,
    soundcloud: acct.providers?.soundcloud?.url || '',
  };
}
const isAnon = (acct) => !acct || !Object.keys(acct.providers || {}).length;
const privateView = (acct) => acct && ({ ...publicArtist(acct), id: acct.id, anon: isAnon(acct), providers: Object.keys(acct.providers || {}),
  ...(acct.email && { email: acct.email }), ...(acct.listener && { listener: acct.listener }) });
export const trackMeta = ({ state, ...m }) => ({ id: m.id, title: m.title, artist: m.artist, style: m.style, bpm: m.bpm, key: m.key, scale: m.scale, created: m.created });

async function accountByHandle(kv, handle) {
  if (handleError(handle)) return null;
  const id = await kv.cmd(['GET', K.handle(normalizeHandle(handle))]);
  return id ? getJson(kv, K.acct(id)) : null;
}

const newAccount = () => ({ id: newId(), handle: null, name: '', bio: '', avatar: '', dna: null, providers: {}, created: new Date().toISOString() });
async function createAccount(kv) {
  const acct = newAccount();
  await setJson(kv, K.acct(acct.id), acct);
  return acct;
}

async function claimHandle(kv, acct, raw, profile) {
  const err = handleError(raw);
  if (err) return { error: err };
  const h = normalizeHandle(raw);
  const next = { ...acct, handle: h, name: acct.name || h };
  if (profile) applyProfile(next, profile);
  if (acct.handle === h) {
    return await saveAccount(kv, acct, next) ? { acct: next } : { error: 'account_conflict' };
  }
  const got = await kv.cmd(['SET', K.handle(h), acct.id, 'NX']);
  if (!got && (await kv.cmd(['GET', K.handle(h)])) !== acct.id) return { error: 'taken' };
  if (!await saveAccount(kv, acct, next)) {
    const latest = await getJson(kv, K.acct(acct.id));
    if (latest?.handle !== h) await commit(kv, [K.handle(h), acct.id, null]);
    return { error: 'account_conflict' };
  }
  if (acct.handle) await commit(kv, [K.handle(acct.handle), acct.id, null]);
  return { acct: next };
}

// Copy a published crate track into the account so it keeps a permanent home (the crate evicts old tracks).
export async function attachTrack(kv, accountId, track) {
  if (!track?.id || !track.state) return false;
  const owner = await kv.cmd(['SET', K.owner(track.id), accountId, 'NX']);
  if (!owner && (await kv.cmd(['GET', K.owner(track.id)])) !== accountId) return false;
  await setJson(kv, K.track(track.id), track);
  await kv.cmd(['LPUSH', K.tracks(accountId), JSON.stringify(trackMeta(track))]);
  await kv.cmd(['LTRIM', K.tracks(accountId), 0, TRACK_LIMIT - 1]);
  return true;
}

export async function attachPublished({ kv, secret, cookie, crate, trackId }) {
  if (!crate || !trackId) return false;
  const acct = await accountFromSession(kv, secret, cookie);
  return acct ? attachTrack(kv, acct.id, await crate.get(trackId)) : false;
}

async function tracksOf(kv, accountId, n = 50) {
  return (await kv.cmd(['LRANGE', K.tracks(accountId), 0, n - 1])).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

// Fold an anonymous device account into the account a provider sign-in resolved to.
export async function mergeAccounts(kv, from, into, updates = into, writes = []) {
  if (!from || !into || from.id === into.id || !isAnon(from)) return into;
  const next = { ...updates, handle: into.handle || from.handle };
  for (const f of ['name', 'bio', 'avatar', 'dna']) if (!next[f] && from[f]) next[f] = from[f];
  const rows = [[K.acct(from.id), JSON.stringify(from), null], [K.acct(into.id), JSON.stringify(into), JSON.stringify(next)],
    ...(from.handle ? [[K.handle(from.handle), from.id, into.handle ? null : into.id]] : []), ...writes];
  return await migrateAccountData(kv, rows, P, from.id, into.id, TRACK_LIMIT) ? next : null;
}

export async function linkProvider(kv, current, provider, profile) {
  const pid = clean(profile.id, 64);
  if (!pid) throw new Error('provider_profile_missing');
  const key = K.link(provider, pid);
  const linkedId = await kv.cmd(['GET', key]);
  let acct = linkedId ? await getJson(kv, K.acct(linkedId)) : null;
  if (acct && current && current.id !== acct.id && isAnon(current)) {
    acct = await mergeAccounts(kv, current, acct);
    if (!acct) return null;
  }
  const previous = acct || (current && isAnon(current) ? current : null);
  const next = { ...(previous || newAccount()) };
  next.providers = { ...next.providers, [provider]: { id: pid, username: clean(profile.username, 60), url: clean(profile.url, 200) } };
  if (isAnon(previous)) next.authVersion = randomToken();
  if (!next.name || next.name === next.handle) next.name = clean(profile.username, 40) || next.name;
  if (!next.avatar && AVATAR.test(String(profile.avatar || ''))) next.avatar = profile.avatar;
  if (!await commit(kv, [key, linkedId, next.id], [K.acct(next.id), previous && JSON.stringify(previous), JSON.stringify(next)])) return null;
  if (!next.handle && profile.handleHint) {
    const hint = normalizeHandle(profile.handleHint).replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 24);
    return (await claimHandle(kv, next, hint)).acct || next;
  }
  return next;
}

// ---------- public reads (pages and API) ----------
export async function publicArtistPage(kv, handle, { pro } = {}) {
  const acct = kv && await accountByHandle(kv, handle);
  if (!acct) return null;
  const [followers, following, tracks, isPro] = await Promise.all([
    kv.cmd(['SCARD', K.followers(acct.id)]), kv.cmd(['SCARD', K.following(acct.id)]), tracksOf(kv, acct.id), pro?.(acct.id)]);
  return { artist: { ...publicArtist(acct, followers, following), ...(isPro && { pro: true }) }, tracks };
}

export async function publishedTrack(kv, crate, rawId) {
  const id = clean(rawId, 40);
  if (!/^[a-z0-9-]{3,40}$/.test(id)) return null;
  let track = kv ? await getJson(kv, K.track(id)) : null;
  if (!track && crate) track = await crate.get(id);
  return track?.state ? track : null;
}

export async function publicTrack(kv, crate, rawId) {
  const track = await publishedTrack(kv, crate, rawId);
  if (!track) return null;
  const id = track.id;
  let artist = null;
  const ownerId = kv && await kv.cmd(['GET', K.owner(id)]);
  const owner = ownerId && await getJson(kv, K.acct(ownerId));
  if (owner?.handle) artist = { handle: owner.handle, name: owner.name || owner.handle, avatar: owner.avatar || '' };
  return { track, artist };
}

async function feedFor(kv, accountId) {
  const ids = (await kv.cmd(['SMEMBERS', K.following(accountId)])).slice(0, FEED_FOLLOWS);
  const rows = await Promise.all(ids.map(async (id) => {
    const acct = await getJson(kv, K.acct(id));
    if (!acct?.handle) return [];
    return (await tracksOf(kv, id, 6)).map((t) => ({ ...t, by: { handle: acct.handle, name: acct.name || acct.handle } }));
  }));
  return rows.flat().sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, FEED_LIMIT);
}

// ---------- HTTP handler (shared by api/account.js and server.mjs) ----------
const err = (status, error, extra = {}) => ({ status, json: { error, ...extra } });

export async function handleAccount(req, ctx) {
  const { kv, secret, env = process.env, secure = true, fetchImpl = fetch } = ctx;
  const q = req.query || {};
  if (!kv || !authEnabled(secret)) return { status: 503, json: { enabled: false, account: null } };
  let me = await accountFromSession(kv, secret, req.cookie);
  const client = clean(req.client, 64) || 'anon';
  const issue = (acct) => sessionCookie(signSession({ sub: acct.id, ver: acct.authVersion }, secret), { secure });
  const origin = accountOrigin(secure, req.host);
  const google = googleEnabled(env) && !!origin && (!secure || req.host === new URL(origin).host);
  const reset = resetEnabled(env) && !!origin;
  const auth = { google, reset };

  if (req.method === 'GET') {
    if (q.action === 'google-callback') return completeGoogle({ req, kv, env, me, google, origin, secure, client, issue, fetchImpl });
    if (q.handle) {
      const page = await publicArtistPage(kv, q.handle);
      if (!page) return err(404, 'not_found');
      const target = await kv.cmd(['GET', K.handle(page.artist.handle)]);
      const isFollowing = !!(me && await kv.cmd(['SISMEMBER', K.following(me.id), target]));
      return { status: 200, json: { ...page, isFollowing, isMe: me?.id === target } };
    }
    if (q.track) {
      const t = await publicTrack(kv, ctx.crate, q.track);
      return t ? { status: 200, json: t } : err(404, 'not_found');
    }
    if (q.check != null) {
      const e = handleError(q.check), h = normalizeHandle(q.check);
      if (e) return { status: 200, json: { handle: h, available: false, error: e } };
      const owner = await kv.cmd(['GET', K.handle(h)]);
      return { status: 200, json: { handle: h, available: !owner || owner === me?.id } };
    }
    if (q.feed != null) return { status: 200, json: { items: me ? await feedFor(kv, me.id) : [] } };
    const following = me ? (await Promise.all((await kv.cmd(['SMEMBERS', K.following(me.id)])).slice(0, 200).map((id) => getJson(kv, K.acct(id))))).filter((a) => a?.handle).map((a) => a.handle) : [];
    return { status: 200, json: { enabled: true, account: privateView(me), following, auth } };
  }

  if (req.method !== 'POST') return err(405, 'method_not_allowed');
  if (req.origin && req.host) {
    try { if (new URL(req.origin).host !== req.host) return err(403, 'bad_origin'); } catch { return err(403, 'bad_origin'); }
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = clean(body.action || q.action, 20);
  if (JSON.stringify(body).length > 8000) return err(413, 'too_large');
  if (!WRITE_ACTIONS.has(action)) return err(400, 'unknown_action');
  const bucket = action === 'unfollow' ? 'follow' : action;
  if (LIMITS[bucket] && !(await allow(kv, bucket, client)) ) return err(429, 'rate_limited');
  if (me && LIMITS[bucket] && !(await allow(kv, bucket, `acct-${me.id}`))) return err(429, 'rate_limited');

  if (action === 'signout') return { status: 200, json: { account: null }, cookie: clearCookie({ secure }) };
  const signedIn = (acct, status = 200) => ({ status, json: { account: privateView(acct) }, cookie: issue(acct) });

  if (action === 'email-signup' || action === 'email-login' || action === 'reset-request') {
    const email = emailAddress(body.email);
    if (!email) return err(400, 'invalid_email');
    if (action === 'reset-request' && !reset) return err(503, 'reset_unavailable');
    const id = emailID(email);
    const emailKey = K.email(id);
    if (action === 'email-login' && !await allow(kv, 'email-attempt', digest(`${client}:${id}`))) return err(429, 'rate_limited');
    const accountID = await kv.cmd(['GET', emailKey]);

    if (action === 'reset-request') {
      const accepted = { status: 202, json: { accepted: true } };
      if (!await allow(kv, 'reset-email', id)) return accepted;
      const account = accountID && await getJson(kv, K.acct(accountID));
      if (account?.email === email) {
        const token = randomToken();
        const key = K.reset(digest(token));
        await kv.cmd(['SET', key, JSON.stringify({ id: account.id, version: account.authVersion }), 'EX', RESET_TTL, 'NX']);
        const sent = await sendPasswordReset(env, fetchImpl, email, `${origin}/#reset-password=${token}`, digest(token)).catch(() => false);
        if (!sent) {
          await kv.cmd(['DEL', key]);
          console.error('Account password reset delivery failed');
        }
      }
      return accepted;
    }

    if (action === 'email-signup') {
      if (!isAnon(me)) return err(409, 'already_signed_in');
      if (!validPassword(body.password)) return err(400, 'invalid_password');
      if (accountID) return err(409, 'email_unavailable');
      const hash = await passwordHash(body.password);
      const account = me || newAccount();
      const next = { ...account, email, providers: { ...account.providers, email: { id } }, authVersion: randomToken() };
      if (!await commit(kv, [emailKey, null, account.id], [K.acct(account.id), me && JSON.stringify(me), JSON.stringify(next)],
        [K.password(account.id), null, hash])) return err(409, 'account_conflict');
      return signedIn(next, 201);
    }
    if (!validPassword(body.password, 1)) return err(401, 'invalid_credentials');
    const failureKey = K.rate('email-failure', id);
    const failures = Number(await kv.cmd(['GET', failureKey]));
    if (failures >= EMAIL_FAILURE_THRESHOLD) await wait(250 * 2 ** Math.min(3, failures - EMAIL_FAILURE_THRESHOLD));
    const hash = accountID && await kv.cmd(['GET', K.password(accountID)]);
    if (!await passwordMatches(body.password, hash)) {
      await incrementWithExpiry(kv, failureKey, EMAIL_FAILURE_WINDOW);
      return err(401, 'invalid_credentials');
    }
    const account = await getJson(kv, K.acct(accountID));
    if (!account || account.email !== email || await kv.cmd(['GET', K.password(accountID)]) !== hash) return err(401, 'invalid_credentials');
    const destination = me && me.id !== account.id && isAnon(me) ? await mergeAccounts(kv, me, account) : account;
    return destination ? signedIn(destination) : err(409, 'account_conflict');
  }

  if (action === 'password-change' || action === 'reset-password') {
    if (!validPassword(body.password)) return err(400, 'invalid_password');
    const device = isAnon(me) ? me : null;
    let key, saved;
    if (action === 'reset-password') {
      if (!reset || !validToken(body.token)) return err(400, 'invalid_reset');
      key = K.reset(digest(body.token));
      saved = await kv.cmd(['GET', key]);
      if (!saved) return err(400, 'invalid_reset');
      const record = JSON.parse(saved);
      me = await getJson(kv, K.acct(record.id));
      if (me?.authVersion !== record.version) return err(400, 'invalid_reset');
    }
    if (!me?.providers?.email) return err(401, 'sign_in_required');
    const passwordKey = K.password(me.id);
    const hash = await kv.cmd(['GET', passwordKey]);
    if (action === 'password-change' && (!validPassword(body.currentPassword, 1) ||
        !await passwordMatches(body.currentPassword, hash))) return err(401, 'invalid_credentials');
    const next = { ...me, authVersion: randomToken() };
    const providers = [];
    if (action === 'reset-password' && me.providers.google) {
      const { google, ...remaining } = me.providers;
      next.providers = remaining;
      providers.push([K.link('google', google.id), me.id, null]);
    }
    const newHash = await passwordHash(body.password);
    const writes = [[passwordKey, hash, newHash], ...providers, ...(key ? [[key, saved, null]] : [])];
    if (key && device && device.id !== me.id) {
      const destination = await mergeAccounts(kv, device, me, next, writes);
      return destination ? signedIn(destination) : err(409, 'account_conflict');
    }
    if (!await commit(kv, [K.acct(me.id), JSON.stringify(me), JSON.stringify(next)], ...writes)) return err(409, 'account_conflict');
    return signedIn(next);
  }

  if (action === 'google-start') {
    if (!google) return err(503, 'google_unavailable');
    const link = body.link === true;
    if (link === isAnon(me)) return err(409, 'sign_in_required');
    if (link && me.providers.google) return err(409, 'already_linked');
    const state = randomToken(), browser = randomToken(), nonce = randomToken(), verifier = randomToken();
    await kv.cmd(['SET', K.oauth(digest(state)), JSON.stringify({ browser: digest(browser), nonce, verifier,
      account: me?.id || null, version: me?.authVersion, link, pricing: body.returnTo === '/pricing' }), 'EX', GOOGLE_TTL, 'NX']);
    return { status: 200, json: { url: googleAuthorization(env, origin + GOOGLE_CALLBACK, state, nonce, verifier) },
      cookie: googleCookie(browser, GOOGLE_TTL, secure) };
  }

  if (action === 'preferences') {
    if (isAnon(me)) return err(401, 'sign_in_required');
    const likes = body.favoriteGenres;
    const genre = body.defaultGenre;
    if (!Array.isArray(likes) || likes.length > Object.keys(STYLES).length || likes.some((id) => typeof id !== 'string' || !Object.hasOwn(STYLES, id)) ||
        !(genre === null || typeof genre === 'string' && Object.hasOwn(STYLES, genre)) || typeof body.displayName !== 'string') return err(400, 'invalid_preferences');
    const next = { ...me, listener: { displayName: clean(body.displayName, 40), favoriteGenres: [...new Set(likes)], defaultGenre: genre } };
    if (!await commit(kv, [K.acct(me.id), JSON.stringify(me), JSON.stringify(next)])) return err(409, 'account_conflict');
    return { status: 200, json: { account: privateView(next) } };
  }

  if (action === 'device') {
    if (me) return { status: 200, json: { account: privateView(me) } };
    me = await createAccount(kv);
    return { status: 201, json: { account: privateView(me) }, cookie: issue(me) };
  }

  if (action === 'claim') {
    const fresh = !me;
    if (!me) me = await createAccount(kv);
    const r = await claimHandle(kv, me, body.handle, body);
    if (r.error) return { ...err(['taken', 'account_conflict'].includes(r.error) ? 409 : 400, r.error), ...(fresh && { cookie: issue(me) }) };
    return { status: fresh ? 201 : 200, json: { account: privateView(r.acct) }, ...(fresh && { cookie: issue(me) }) };
  }

  if (action === 'profile') {
    if (!me) return err(401, 'sign_in_required');
    const next = { ...me };
    applyProfile(next, body);
    if (!await saveAccount(kv, me, next)) return err(409, 'account_conflict');
    return { status: 200, json: { account: privateView(next) } };
  }

  if (action === 'follow' || action === 'unfollow') {
    const target = await accountByHandle(kv, body.handle);
    if (!target) return err(404, 'not_found');
    const fresh = !me;
    if (!me) me = await createAccount(kv);
    if (target.id === me.id) return err(400, 'cannot_follow_self');
    if (action === 'follow') {
      await kv.cmd(['SADD', K.following(me.id), target.id]);
      await kv.cmd(['SADD', K.followers(target.id), me.id]);
    } else {
      await kv.cmd(['SREM', K.following(me.id), target.id]);
      await kv.cmd(['SREM', K.followers(target.id), me.id]);
    }
    const followers = await kv.cmd(['SCARD', K.followers(target.id)]);
    return { status: 200, json: { following: action === 'follow', followers }, ...(fresh && { cookie: issue(me) }) };
  }

  if (action === 'soundcloud') {
    const tokens = await exchangeToken(body, env);
    if (tokens.status !== 200 || !tokens.json?.access_token) return tokens;
    const r = await fetchImpl(`${scConfig(env).apiUrl}/me`, { headers: { Accept: 'application/json; charset=utf-8', Authorization: `OAuth ${tokens.json.access_token}` } });
    const u = r.ok ? await r.json() : null;
    if (!u?.id) return err(502, 'soundcloud_profile_failed');
    const permalink = String(u.permalink_url || '').split('/').filter(Boolean).pop() || u.permalink || '';
    const acct = await linkProvider(kv, me, 'soundcloud', { id: String(u.id), username: u.username, url: u.permalink_url, avatar: u.avatar_url, handleHint: permalink });
    if (!acct) return err(409, 'account_conflict');
    return { status: 200, json: { ...tokens.json, account: privateView(acct) }, cookie: issue(acct) };
  }
  return err(400, 'unknown_action');
}

const googleCookie = (value, age, secure) => `${OAUTH_COOKIE}=${value}; Path=${GOOGLE_CALLBACK}; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;

async function completeGoogle({ req, kv, env, me, google, origin, secure, client, issue, fetchImpl }) {
  let returnTo = '/';
  const finish = (result, account) => ({ status: 303, redirect: `${returnTo}?account=${result}`,
    cookie: [googleCookie('', 0, secure), ...(account ? [issue(account)] : [])] });
  if (!google || !await allow(kv, 'google-callback', client)) return finish('google_failed');
  const { state, code } = req.query;
  let browser;
  try { browser = parseCookies(req.cookie)[OAUTH_COOKIE]; } catch { return finish('google_failed'); }
  if (!validToken(state) || !validToken(browser)) return finish('google_failed');
  const key = K.oauth(digest(state));
  const raw = await kv.cmd(['GET', key]);
  if (!raw) return finish('google_failed');
  const flow = JSON.parse(raw);
  if (flow.browser !== digest(browser) || flow.account !== (me?.id || null) || flow.version !== me?.authVersion ||
      (flow.link && isAnon(me)) || !await commit(kv, [key, raw, null])) return finish('google_failed');
  if (flow.pricing) returnTo = '/pricing';
  const profile = await googleProfile(env, fetchImpl, code, origin + GOOGLE_CALLBACK, flow).catch(() => null);
  if (!profile) return finish('google_failed');
  const linked = K.link('google', profile.id);
  const id = await kv.cmd(['GET', linked]);
  if (id && flow.link && id !== me.id) return finish('google_conflict');
  if (id) {
    const account = await getJson(kv, K.acct(id));
    if (!account || account.providers?.google?.id !== profile.id) return finish('google_failed');
    const destination = me && me.id !== id && isAnon(me) ? await mergeAccounts(kv, me, account) : account;
    return destination ? finish('google_ok', destination) : finish('google_failed');
  }
  const account = me || newAccount();
  if (account.providers.google) return finish('google_conflict');
  const next = { ...account, providers: { ...account.providers, google: { id: profile.id } },
    ...(isAnon(account) && { authVersion: randomToken() }) };
  if (profile.username && !account.name && !account.listener?.displayName) {
    next.listener = { ...account.listener, displayName: clean(profile.username, 40) };
  }
  if (!await commit(kv, [linked, null, account.id], [K.acct(account.id), me && JSON.stringify(me), JSON.stringify(next)])) return finish('google_failed');
  return finish('google_ok', next);
}

function applyProfile(acct, body) {
  if (body.name != null) acct.name = clean(body.name, 40) || acct.handle || '';
  if (body.bio != null) acct.bio = clean(body.bio, 220);
  if (body.dna && typeof body.dna === 'object') acct.dna = cleanDna(body.dna);
}

export const styleName = (id) => STYLES[id]?.name || '';
