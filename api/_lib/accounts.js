// Creator accounts: an anonymous device identity (signed httpOnly cookie) that can claim a handle,
// provider sign-in (SoundCloud first) that attaches to it, follows, and permanent track homes.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { STYLES } from '../../js/state.js';
import { clean } from './crate.js';
import { scConfig, exchangeToken } from './soundcloud.js';

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
};
const TRACK_LIMIT = 500, FEED_FOLLOWS = 50, FEED_LIMIT = 30;
const LIMITS = { device: [20, 3600], claim: [12, 3600], profile: [60, 3600], follow: [120, 3600], soundcloud: [30, 3600] };
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
const setJson = (kv, key, v) => kv.cmd(['SET', key, JSON.stringify(v)]);
const newId = () => `u${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;

export async function allow(kv, bucket, client) {
  const [max, windowSec] = LIMITS[bucket] || [60, 3600];
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
const privateView = (acct) => acct && ({ ...publicArtist(acct), id: acct.id, anon: !acct.providers || !Object.keys(acct.providers).length, providers: Object.keys(acct.providers || {}) });
export const trackMeta = ({ state, ...m }) => ({ id: m.id, title: m.title, artist: m.artist, style: m.style, bpm: m.bpm, key: m.key, scale: m.scale, created: m.created });

async function accountByHandle(kv, handle) {
  if (handleError(handle)) return null;
  const id = await kv.cmd(['GET', K.handle(normalizeHandle(handle))]);
  return id ? getJson(kv, K.acct(id)) : null;
}

async function createAccount(kv, extra = {}) {
  const acct = { id: newId(), handle: null, name: '', bio: '', avatar: '', dna: null, providers: {}, created: new Date().toISOString(), ...extra };
  await setJson(kv, K.acct(acct.id), acct);
  return acct;
}

async function claimHandle(kv, acct, raw) {
  const err = handleError(raw);
  if (err) return { error: err };
  const h = normalizeHandle(raw);
  if (acct.handle === h) return { acct };
  const got = await kv.cmd(['SET', K.handle(h), acct.id, 'NX']);
  if (!got && (await kv.cmd(['GET', K.handle(h)])) !== acct.id) return { error: 'taken' };
  if (acct.handle) await kv.cmd(['DEL', K.handle(acct.handle)]);
  acct.handle = h;
  if (!acct.name) acct.name = h;
  await setJson(kv, K.acct(acct.id), acct);
  return { acct };
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
  const session = kv && verifySession(parseCookies(cookie)[COOKIE], secret);
  if (!session || !crate || !trackId) return false;
  return attachTrack(kv, session.sub, await crate.get(trackId));
}

async function tracksOf(kv, accountId, n = 50) {
  return (await kv.cmd(['LRANGE', K.tracks(accountId), 0, n - 1])).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

// Fold an anonymous device account into the account a provider sign-in resolved to.
export async function mergeAccounts(kv, from, into) {
  if (!from || !into || from.id === into.id) return into;
  for (const t of (await tracksOf(kv, from.id, TRACK_LIMIT)).reverse()) {
    await kv.cmd(['SET', K.owner(t.id), into.id]);
    await kv.cmd(['LPUSH', K.tracks(into.id), JSON.stringify(t)]);
  }
  await kv.cmd(['LTRIM', K.tracks(into.id), 0, TRACK_LIMIT - 1]);
  for (const id of await kv.cmd(['SMEMBERS', K.following(from.id)])) {
    await kv.cmd(['SREM', K.followers(id), from.id]);
    if (id !== into.id) { await kv.cmd(['SADD', K.following(into.id), id]); await kv.cmd(['SADD', K.followers(id), into.id]); }
  }
  for (const id of await kv.cmd(['SMEMBERS', K.followers(from.id)])) {
    await kv.cmd(['SREM', K.following(id), from.id]);
    if (id !== into.id) { await kv.cmd(['SADD', K.followers(into.id), id]); await kv.cmd(['SADD', K.following(id), into.id]); }
  }
  if (from.handle) {
    if (!into.handle) { await kv.cmd(['SET', K.handle(from.handle), into.id]); into.handle = from.handle; }
    else await kv.cmd(['DEL', K.handle(from.handle)]);
  }
  for (const f of ['name', 'bio', 'avatar', 'dna']) if (!into[f] && from[f]) into[f] = from[f];
  await setJson(kv, K.acct(into.id), into);
  await kv.cmd(['DEL', K.acct(from.id), K.tracks(from.id), K.following(from.id), K.followers(from.id)]);
  return into;
}

export async function linkProvider(kv, current, provider, profile) {
  const pid = clean(profile.id, 64);
  if (!pid) throw new Error('provider_profile_missing');
  const linkedId = await kv.cmd(['GET', K.link(provider, pid)]);
  let acct = linkedId ? await getJson(kv, K.acct(linkedId)) : null;
  const isAnon = (a) => a && !Object.keys(a.providers || {}).length;
  if (acct && current && current.id !== acct.id && isAnon(current)) acct = await mergeAccounts(kv, current, acct);
  if (!acct) {
    acct = current && isAnon(current) ? current : await createAccount(kv);
    await kv.cmd(['SET', K.link(provider, pid), acct.id]);
  }
  acct.providers = { ...acct.providers, [provider]: { id: pid, username: clean(profile.username, 60), url: clean(profile.url, 200) } };
  if (!acct.name || acct.name === acct.handle) acct.name = clean(profile.username, 40) || acct.name;
  if (!acct.avatar && AVATAR.test(String(profile.avatar || ''))) acct.avatar = profile.avatar;
  await setJson(kv, K.acct(acct.id), acct);
  if (!acct.handle && profile.handleHint) {
    const hint = normalizeHandle(profile.handleHint).replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 24);
    await claimHandle(kv, acct, hint);
  }
  return acct;
}

// ---------- public reads (pages and API) ----------
export async function publicArtistPage(kv, handle) {
  const acct = kv && await accountByHandle(kv, handle);
  if (!acct) return null;
  const [followers, following, tracks] = await Promise.all([
    kv.cmd(['SCARD', K.followers(acct.id)]), kv.cmd(['SCARD', K.following(acct.id)]), tracksOf(kv, acct.id)]);
  return { artist: publicArtist(acct, followers, following), tracks };
}

export async function publicTrack(kv, crate, rawId) {
  const id = clean(rawId, 40);
  if (!/^[a-z0-9-]{3,40}$/.test(id)) return null;
  let track = kv ? await getJson(kv, K.track(id)) : null;
  if (!track && crate) track = await crate.get(id);
  if (!track?.state) return null;
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
  const session = verifySession(parseCookies(req.cookie)[COOKIE], secret);
  let me = session ? await getJson(kv, K.acct(session.sub)) : null;
  const client = clean(req.client, 64) || 'anon';
  const issue = (acct) => sessionCookie(signSession({ sub: acct.id }, secret), { secure });

  if (req.method === 'GET') {
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
    return { status: 200, json: { enabled: true, account: privateView(me), following } };
  }

  if (req.method !== 'POST') return err(405, 'method_not_allowed');
  if (req.origin && req.host) {
    try { if (new URL(req.origin).host !== req.host) return err(403, 'bad_origin'); } catch { return err(403, 'bad_origin'); }
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = clean(body.action || q.action, 20);
  if (JSON.stringify(body).length > 8000) return err(413, 'too_large');
  if (!LIMITS[action] && !['unfollow', 'signout'].includes(action)) return err(400, 'unknown_action');
  const bucket = action === 'unfollow' ? 'follow' : action;
  if (LIMITS[bucket] && !(await allow(kv, bucket, client)) ) return err(429, 'rate_limited');
  if (me && LIMITS[bucket] && !(await allow(kv, bucket, `acct-${me.id}`))) return err(429, 'rate_limited');

  if (action === 'signout') return { status: 200, json: { account: null }, cookie: clearCookie({ secure }) };

  if (action === 'device') {
    if (me) return { status: 200, json: { account: privateView(me) } };
    me = await createAccount(kv);
    return { status: 201, json: { account: privateView(me) }, cookie: issue(me) };
  }

  if (action === 'claim') {
    const fresh = !me;
    if (!me) me = await createAccount(kv);
    const r = await claimHandle(kv, me, body.handle);
    if (r.error) return { ...err(r.error === 'taken' ? 409 : 400, r.error), ...(fresh && { cookie: issue(me) }) };
    applyProfile(r.acct, body);
    await setJson(kv, K.acct(me.id), r.acct);
    return { status: fresh ? 201 : 200, json: { account: privateView(r.acct) }, ...(fresh && { cookie: issue(me) }) };
  }

  if (action === 'profile') {
    if (!me) return err(401, 'sign_in_required');
    applyProfile(me, body);
    await setJson(kv, K.acct(me.id), me);
    return { status: 200, json: { account: privateView(me) } };
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
    return { status: 200, json: { ...tokens.json, account: privateView(acct) }, cookie: issue(acct) };
  }
  return err(400, 'unknown_action');
}

function applyProfile(acct, body) {
  if (body.name != null) acct.name = clean(body.name, 40) || acct.handle || '';
  if (body.bio != null) acct.bio = clean(body.bio, 220);
  if (body.dna && typeof body.dna === 'object') acct.dna = cleanDna(body.dna);
}

export const styleName = (id) => STYLES[id]?.name || '';
