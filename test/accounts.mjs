import assert from 'node:assert/strict';
import { memoryKv } from '../api/_lib/kv.js';
import { memoryStore } from '../api/_lib/crate.js';
import { handleAccount, handleError, normalizeHandle, signSession, verifySession, sessionCookie, parseCookies, attachPublished, attachTrack, COOKIE } from '../api/_lib/accounts.js';
import { defaultState } from '../js/state.js';

// ---------- handles ----------
assert.equal(normalizeHandle('  @Nova_Berlin '), 'nova_berlin');
assert.equal(handleError('nova'), null);
assert.equal(handleError('NoVa-23'), null);
assert.equal(handleError('ab'), 'too_short');
assert.equal(handleError('x'.repeat(25)), 'too_long');
for (const bad of ['-nova', 'nova-', 'no va', 'nóva', 'no--va', 'nova!', '<script>']) assert.equal(handleError(bad), 'invalid', bad);
for (const r of ['admin', 'API', 'jukebox', 'untergrund', 'untergrund-official', 'superadmin', 'www', 'settings']) assert.equal(handleError(r), 'reserved', r);
console.log('handle rules passed');

// ---------- sessions ----------
const SECRET = 'x'.repeat(48);
const tok = signSession({ sub: 'u1' }, SECRET);
assert.equal(verifySession(tok, SECRET).sub, 'u1');
assert.equal(verifySession(tok, 'y'.repeat(48)), null, 'wrong secret');
const [body, sig] = tok.split('.');
const forged = Buffer.from(JSON.stringify({ sub: 'u2', exp: 9e9 })).toString('base64url');
assert.equal(verifySession(`${forged}.${sig}`, SECRET), null, 'tampered payload');
assert.equal(verifySession(`${body}.${sig}x`, SECRET), null, 'tampered signature');
assert.equal(verifySession(`${tok}.extra`, SECRET), null);
assert.equal(verifySession(signSession({ sub: 'u1' }, SECRET, { now: Date.now() - 400 * 864e5 }), SECRET), null, 'expired');
assert.equal(verifySession('garbage', SECRET), null);
assert.throws(() => signSession({ sub: 'u1' }, 'short'));
assert.equal(verifySession(tok, 'short'), null, 'weak secret disables auth');
const cookie = sessionCookie(tok, { secure: true });
assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Secure/);
assert.equal(parseCookies(`a=1; ${COOKIE}=${tok}`)[COOKIE], tok);
console.log('session signing passed');

// ---------- API with in-memory KV ----------
const kv = memoryKv(), crate = memoryStore();
const ctx = { kv, crate, secret: SECRET, secure: false };
const jar = () => { let c = ''; return { get cookie() { return c; }, take(r) { if (r.cookie) c = r.cookie.split(';')[0]; return r; } }; };
const call = (j, method, body = null, query = {}, client = 'ip1') => handleAccount({ method, body, query, cookie: j.cookie, client }, ctx).then((r) => j.take(r));

assert.equal((await handleAccount({ method: 'GET' }, { ...ctx, kv: null })).status, 503, 'no storage degrades');
assert.equal((await handleAccount({ method: 'GET' }, { ...ctx, secret: '' })).status, 503, 'no AUTH_SECRET degrades');

const alice = jar(), bob = jar(), eve = jar();
assert.equal((await call(alice, 'GET')).json.account, null);
const claimed = await call(alice, 'POST', { action: 'claim', handle: 'Alice', name: 'Alice\u0007 <b>', bio: 'x'.repeat(400), dna: { darkness: 250, acid: 'nope' } });
assert.equal(claimed.status, 201);
assert.equal(claimed.json.account.handle, 'alice');
assert.equal(claimed.json.account.name, 'Alice <b>', 'control chars stripped (HTML escaped at render)');
assert.equal(claimed.json.account.bio.length, 220);
assert.deepEqual(claimed.json.account.dna, { darkness: 100, hypnosis: 0, acid: 0, space: 0, energy: 0 });
assert.equal(claimed.json.account.anon, true);
assert(alice.cookie.startsWith(`${COOKIE}=`));
assert.equal((await call(alice, 'GET')).json.account.handle, 'alice', 'cookie restores the session');
assert.equal((await call(bob, 'POST', { action: 'claim', handle: 'ALICE' })).status, 409, 'handles are unique, case-insensitive');
assert.equal((await call(bob, 'POST', { action: 'claim', handle: 'admin' })).json.error, 'reserved');
assert.equal((await call(bob, 'GET', null, { check: 'alice' })).json.available, false);
assert.equal((await call(alice, 'GET', null, { check: 'alice' })).json.available, true, 'your own handle reads as available');
assert.equal((await call(bob, 'POST', { action: 'claim', handle: 'bob' })).status, 200);
// renaming frees the old handle
assert.equal((await call(bob, 'POST', { action: 'claim', handle: 'bobby' })).json.account.handle, 'bobby');
assert.equal((await call(eve, 'GET', null, { check: 'bob' })).json.available, true);
assert.equal((await call(eve, 'POST', { action: 'profile', name: 'x' })).status, 401);
assert.equal((await call(eve, 'POST', { action: 'nope' })).status, 400);
assert.equal((await handleAccount({ method: 'POST', body: { action: 'device' }, origin: 'https://evil.example', host: 'www.untergrund.sh' }, ctx)).status, 403, 'cross-origin writes rejected');
console.log('account claim API passed');

// ---------- follow ----------
let r = await call(bob, 'POST', { action: 'follow', handle: 'alice' });
assert.deepEqual(r.json, { following: true, followers: 1 });
r = await call(bob, 'POST', { action: 'follow', handle: 'alice' });
assert.equal(r.json.followers, 1, 'follow is idempotent');
assert.equal((await call(alice, 'POST', { action: 'follow', handle: 'alice' })).json.error, 'cannot_follow_self');
assert.equal((await call(bob, 'POST', { action: 'follow', handle: 'ghost' })).status, 404);
const anonFollow = await call(eve, 'POST', { action: 'follow', handle: 'alice' });
assert.equal(anonFollow.json.followers, 2, 'a fresh device can follow without signing up');
assert(eve.cookie, 'follow issues an anonymous device session');
const page = await call(bob, 'GET', null, { handle: 'alice' });
assert.equal(page.json.artist.followers, 2);
assert.equal(page.json.isFollowing, true);
assert.equal(page.json.artist.id, undefined, 'public profile hides internal ids');
assert.deepEqual((await call(bob, 'GET')).json.following, ['alice']);
r = await call(eve, 'POST', { action: 'unfollow', handle: 'alice' });
assert.deepEqual(r.json, { following: false, followers: 1 });

// tracks + feed
const t1 = await crate.add({ ...(await import('../api/_lib/crate.js')).normalizeTrack({ title: 'Null Signal', style: 'acid', state: defaultState() }) }).then(() => crate.list(1)).then(([m]) => m);
const aliceToken = alice.cookie;
assert.equal(await attachPublished({ kv, secret: SECRET, cookie: aliceToken, crate, trackId: t1.id }), true);
assert.equal(await attachPublished({ kv, secret: SECRET, cookie: bob.cookie, crate, trackId: t1.id }), false, 'a track has exactly one owner');
assert.equal(await attachPublished({ kv, secret: SECRET, cookie: '', crate, trackId: t1.id }), false);
const feed = await call(bob, 'GET', null, { feed: '1' });
assert.equal(feed.json.items.length, 1);
assert.equal(feed.json.items[0].title, 'Null Signal');
assert.equal(feed.json.items[0].by.handle, 'alice');
assert.equal(feed.json.items[0].state, undefined, 'feed carries metadata only');
assert.equal((await call(eve, 'GET', null, { feed: '1' })).json.items.length, 0);
const tr = await call(eve, 'GET', null, { track: t1.id });
assert.equal(tr.json.artist.handle, 'alice');
assert(Array.isArray(tr.json.track.state.patterns));
assert.equal((await call(eve, 'GET', null, { track: '../etc' })).status, 404);
console.log('follow API and feed passed');

// ---------- rate limits ----------
const spam = jar();
let last;
for (let i = 0; i < 121; i++) last = await call(spam, 'POST', { action: i % 2 ? 'unfollow' : 'follow', handle: 'alice' }, {}, 'ip-spam');
assert.equal(last.status, 429);
const claimer = jar();
for (let i = 0; i < 13; i++) last = await call(claimer, 'POST', { action: 'claim', handle: `name${i}x` }, {}, 'ip-claim');
assert.equal(last.status, 429);
console.log('account rate limits passed');

// ---------- SoundCloud sign-in attaches the device identity ----------
const scEnv = { SOUNDCLOUD_CLIENT_ID: 'id', SOUNDCLOUD_CLIENT_SECRET: 'secret', SOUNDCLOUD_AUTH_URL: 'https://sc.test', SOUNDCLOUD_API_URL: 'https://api.sc.test' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'tok', refresh_token: 'r', expires_in: 3600 }), json: async () => ({}) });
const scFetch = (id, permalink) => async () => ({ ok: true, json: async () => ({ id, username: `DJ ${permalink}`, permalink_url: `https://soundcloud.com/${permalink}`, avatar_url: 'https://i1.sndcdn.com/avatars-1-large.jpg' }) });
const scCall = (j, id, permalink) => handleAccount({ method: 'POST', body: { code: 'c', code_verifier: 'v', redirect_uri: 'https://www.untergrund.sh/sc-callback.html' }, query: { action: 'soundcloud' }, cookie: j.cookie, client: 'ip-sc' },
  { ...ctx, env: scEnv, fetchImpl: scFetch(id, permalink) }).then((x) => j.take(x));
// 1) anonymous alice signs in: same account, now provider-backed
r = await scCall(alice, 77, 'alice-sc');
assert.equal(r.status, 200);
assert.equal(r.json.access_token, 'tok', 'browser still gets tokens for publishing');
assert.equal(r.json.account.handle, 'alice');
assert.equal(r.json.account.anon, false);
assert.equal(r.json.account.avatar, 'https://i1.sndcdn.com/avatars-1-large.jpg');
// 2) a new device makes anonymous saves, then signs in to the same SoundCloud user: it merges into alice
const phone = jar();
await call(phone, 'POST', { action: 'device' }, {}, 'ip-phone');
const t2 = await (async () => { const { normalizeTrack } = await import('../api/_lib/crate.js'); const t = normalizeTrack({ title: 'Phone Jam', state: defaultState() }); await crate.add(t); return t; })();
assert.equal(await attachTrack(kv, (await call(phone, 'GET')).json.account.id, t2), true);
await call(phone, 'POST', { action: 'follow', handle: 'bobby' }, {}, 'ip-phone');
r = await scCall(phone, 77, 'alice-sc');
assert.equal(r.json.account.handle, 'alice', 'device session now points at the signed-in account');
const merged = await call(eve, 'GET', null, { handle: 'alice' });
assert.deepEqual(merged.json.tracks.map((t) => t.title).sort(), ['Null Signal', 'Phone Jam'], 'anonymous saves migrate on sign-in');
assert.equal((await call(eve, 'GET', null, { track: t2.id })).json.artist.handle, 'alice');
assert.equal((await call(eve, 'GET', null, { handle: 'bobby' })).json.artist.followers, 1, 'follows migrate without double counting');
// 3) brand-new SoundCloud user gets a handle from their permalink
const carol = jar();
r = await scCall(carol, 99, 'Carol-Beats');
assert.equal(r.json.account.handle, 'carol-beats');
globalThis.fetch = realFetch;
console.log('SoundCloud sign-in and migration passed');
