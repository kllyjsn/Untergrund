import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { memoryKv } from '../api/_lib/kv.js';
import { memoryStore } from '../api/_lib/crate.js';
import { handleAccount, handleError, normalizeHandle, signSession, verifySession, sessionCookie, parseCookies, attachPublished, attachTrack, COOKIE } from '../api/_lib/accounts.js';
import { defaultState } from '../js/state.js';
import { emailID, GOOGLE_CALLBACK } from '../api/_lib/listener-auth.js';

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
const scCall = (j, id, permalink, storage = kv) => handleAccount({ method: 'POST', body: { code: 'c', code_verifier: 'v', redirect_uri: 'https://www.untergrund.sh/sc-callback.html' }, query: { action: 'soundcloud' }, cookie: j.cookie, client: 'ip-sc' },
  { ...ctx, kv: storage, env: scEnv, fetchImpl: scFetch(id, permalink) }).then((x) => j.take(x));
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
const interrupted = { cmd: (args) => {
  if ((args[0] === 'EVAL' && args[1].includes('LRANGE')) || (args[0] === 'SET' && args[1].includes(':o:'))) throw new Error('store interrupted');
  return kv.cmd(args);
} };
await assert.rejects(scCall(phone, 77, 'alice-sc', interrupted), /store interrupted/);
assert.equal((await call(phone, 'GET')).json.account.anon, true, 'a failed transfer leaves the source session and tracks recoverable');
assert.deepEqual((await call(phone, 'GET')).json.following, ['bobby']);
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

// ---------- listener credentials and preferences ----------
const local = { ...ctx, env: {} };
const host = 'localhost:8020';
const request = (j, action, fields = {}, opts = {}) => {
  const { context = local, client = 'listener', method = 'POST', cookie = j.cookie, query = {} } = opts;
  return handleAccount({ method, body: { action, ...fields }, query, cookie, client, host, origin: `http://${host}` }, context)
    .then((response) => j.take(response));
};
const listener = jar(), tablet = jar();
const email = 'listener@example.com', password = 'Some strong phrase 16';
const signIn = (j, fields = {}, opts) => request(j, 'email-login', { email, password, ...fields }, opts);
const prefs = { displayName: 'Sub Signal', favoriteGenres: ['acid', 'acid', 'hypnotic'], defaultGenre: 'acid' };
assert.deepEqual((await request(listener, null, {}, { method: 'GET' })).json.auth, { google: false, reset: false });
assert.equal((await request(listener, 'preferences', prefs)).status, 401);
assert.equal((await request(listener, 'reset-request', { email })).status, 503);
const device = await request(listener, 'device');
const deviceCookie = listener.cookie;
assert.equal((await request(listener, 'email-signup', { email, password: 'short' })).json.error, 'invalid_password');
const registered = await request(listener, 'email-signup', { email: ' Listener@EXAMPLE.com ', password });
const id = registered.json.account.id;
assert.equal(registered.status, 201);
assert.equal(id, device.json.account.id, 'registration keeps the device account ID');
assert.deepEqual(registered.json.account.providers, ['email']);
assert.equal(registered.json.account.email, email);
assert.equal((await request(jar(), null, {}, { method: 'GET', cookie: deviceCookie })).json.account, null, 'pre-upgrade cookie cannot authenticate');
assert.equal((await request(tablet, 'email-signup', { email, password })).status, 409);
assert.equal((await signIn(tablet, { password: 'wrong password' })).json.error, 'invalid_credentials');
assert.equal((await request(listener, 'preferences', { ...prefs, favoriteGenres: ['constructor'] })).status, 400);
assert.equal((await request(listener, 'preferences', prefs)).status, 200);
const login = await signIn(tablet);
assert.equal(login.json.account.id, id);
assert.deepEqual(login.json.account.listener, { ...prefs, favoriteGenres: ['acid', 'hypnotic'] });
assert(!JSON.stringify(login.json).includes(password));
const publicHandle = await request(listener, 'claim', { handle: 'sub-signal' });
assert.equal(publicHandle.status, 200);
const publicProfile = (await request(jar(), null, {}, { method: 'GET', query: { handle: 'sub-signal' } })).json.artist;
assert.equal(publicProfile.listener, undefined);
assert.equal(publicProfile.email, undefined);
const newPassword = 'A much stronger test passphrase';
assert.equal((await request(listener, 'password-change', { currentPassword: 'wrong', password: newPassword })).status, 401);
assert.equal((await request(listener, 'password-change', { currentPassword: password, password: newPassword })).status, 200);
assert.equal((await request(tablet, null, {}, { method: 'GET' })).json.account, null, 'password change revokes other cookies');
assert.equal((await signIn(tablet)).status, 401);
assert.equal((await signIn(tablet, { password: newPassword })).json.account.id, id);
assert.match((await request(tablet, 'signout')).cookie, /Max-Age=0/);
assert.equal((await request(tablet, null, {}, { method: 'GET' })).json.account, null);
const race = await Promise.all([jar(), jar()].map((j) => request(j, 'email-signup',
  { email: 'race@example.com', password }, { client: 'signup-race' })));
assert.deepEqual(race.map((r) => r.status).sort(), [201, 409], 'concurrent registrations never create two identities for the same email');
for (let i = 0; i < 10; i++) {
  assert.equal((await signIn(jar(), {}, { client: 'repeated-attempts' })).status, 401);
}
assert.equal((await signIn(jar(), {}, { client: 'repeated-attempts' })).status, 429);
assert.equal((await signIn(jar(), { password: newPassword }, { client: 'another-network' })).json.account.id, id,
  'failed guesses on another network cannot block the real listener from signing in');
const failureKey = `untergrund:acct:r:email-failure:${emailID(email)}`;
assert.equal(await kv.cmd(['GET', failureKey]), '13', 'only failed password checks count toward the shared cooldown');
for (let i = 0; i < 7; i++) {
  assert.equal((await signIn(jar(), {}, { client: `distributed-${i}` })).status, 401);
}
const beforeCooldown = performance.now();
assert.equal((await signIn(jar(), { password: newPassword }, { client: 'new-network' })).status, 200,
  'even above the shared threshold a correct password signs in');
assert(performance.now() - beforeCooldown >= 250, 'guesses across networks trigger a shared delay');
assert.equal(await kv.cmd(['GET', failureKey]), '20');
console.log('listener sign-up, cross-device preferences, privacy, password change and rate limits passed');

// ---------- Google OIDC and explicit provider linking ----------
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = { GOOGLE_CLIENT_ID: 'mock-client', GOOGLE_CLIENT_SECRET: 'mock-secret', RESEND_API_KEY: 'mock-resend', ACCOUNT_EMAIL_FROM: 'support@example.com' };
let nonce, challenge, delivered, subject = 'google-123', tokenRequests = 0;
const oidcToken = () => {
  const parts = [{ alg: 'RS256', kid: 'key' }, { iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 300, nonce, sub: subject, name: 'Google Listener', email }]
    .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
  return `${parts}.${sign('RSA-SHA256', Buffer.from(parts), privateKey).toString('base64url')}`;
};
const integrations = { ...local, env, fetchImpl: async (url, params) => {
  if (url === 'https://oauth2.googleapis.com/token') {
    tokenRequests++;
    assert.equal(params.body.get('redirect_uri'), `http://${host}${GOOGLE_CALLBACK}`);
    const { digest } = await import('../api/_lib/listener-auth.js');
    assert.equal(digest(params.body.get('code_verifier')), challenge);
    return { ok: true, json: async () => ({ id_token: oidcToken() }) };
  }
  if (url === 'https://www.googleapis.com/oauth2/v3/certs') return { ok: true, json: async () => ({ keys: [{ ...publicKey.export({ format: 'jwk' }), use: 'sig', kid: 'key' }] }) };
  if (url === 'https://api.resend.com/emails') {
    delivered = JSON.parse(params.body);
    return { ok: true };
  }
  assert.fail('Unexpected external request');
} };
assert.deepEqual((await request(listener, null, {}, { method: 'GET', context: integrations })).json.auth, { google: true, reset: true });
const googleFlow = async (j, link, { wrongBrowser = false, wrongNonce = false } = {}) => {
  const session = j.cookie;
  const started = await handleAccount({ method: 'POST', body: { action: 'google-start', link }, host, cookie: session, client: 'google' }, integrations);
  assert.equal(started.status, 200);
  const url = new URL(started.json.url);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  nonce = wrongNonce ? 'not-the-request-nonce' : url.searchParams.get('nonce');
  challenge = url.searchParams.get('code_challenge');
  const options = { context: integrations, method: 'GET', cookie: [session, !wrongBrowser && started.cookie.split(';')[0]].filter(Boolean).join('; '),
    query: { action: 'google-callback', code: 'code', state: url.searchParams.get('state') } };
  const callback = () => handleAccount({ ...options, host, client: 'google', method: 'GET' }, integrations);
  const result = await callback();
  if (result.cookie?.[1]) j.take({ cookie: result.cookie[1] });
  return { result, callback };
};
assert.equal((await googleFlow(jar(), false, { wrongBrowser: true })).result.redirect, '/?account=google_failed');
assert.equal(tokenRequests, 0, 'callback checks the browser before exchanging the authorization code');
assert.equal((await googleFlow(jar(), false, { wrongNonce: true })).result.redirect, '/?account=google_failed');
subject = 'unlinked-google';
const unlinked = jar();
assert.equal((await googleFlow(unlinked, false)).result.redirect, '/?account=google_ok');
const separate = (await request(unlinked, null, {}, { method: 'GET' })).json.account;
assert.notEqual(separate.id, id, 'a matching email claim never automatically links accounts');
assert.deepEqual(separate.providers, ['google']);
assert.equal(separate.email, undefined);
subject = 'google-123';
const linked = await googleFlow(listener, true);
assert.equal(linked.result.redirect, '/?account=google_ok');
assert.equal((await linked.callback()).redirect, '/?account=google_failed', 'OAuth state is single use');
const googleDevice = jar();
assert.equal((await googleFlow(googleDevice, false)).result.redirect, '/?account=google_ok');
const googleAccount = (await request(googleDevice, null, {}, { method: 'GET' })).json.account;
assert.equal(googleAccount.id, id, 'Google and email sign in to the same explicitly linked account');
assert.deepEqual(googleAccount.providers, ['email', 'google']);
const other = jar();
assert.equal((await request(other, 'email-signup', { email: 'another@example.com', password })).status, 201);
assert.equal((await googleFlow(other, true)).result.redirect, '/?account=google_conflict');
console.log('Google OIDC browser binding, nonce validation, replay prevention and explicit account linking passed');

// ---------- optional email password reset ----------
assert.equal((await request(tablet, 'reset-request', { email: 'missing@example.com' }, { context: integrations })).status, 202);
assert.equal(delivered, undefined);
assert.equal((await request(tablet, 'reset-request', { email }, { context: integrations })).status, 202);
assert.deepEqual(delivered.to, [email]);
const resetLink = delivered.text.match(/http:\/\/localhost:8020\/#reset-password=([\w-]+)/);
assert(resetLink);
const resetPassword = 'Third long test passphrase';
const reset = (j) => request(j, 'reset-password', { token: resetLink[1], password: resetPassword }, { context: integrations });
const recoveryDevice = (await request(tablet, 'claim', { handle: 'recovery-device' })).json.account;
const recoveryTrack = (await import('../api/_lib/crate.js')).normalizeTrack({ title: 'Recovery Jam', state: defaultState() });
await attachTrack(kv, recoveryDevice.id, recoveryTrack);
const recovered = (await reset(tablet)).json.account;
assert.equal(recovered.id, id);
assert.deepEqual(recovered.providers, ['email'], 'recovery removes sign-in methods linked before proving mailbox ownership');
assert.equal((await request(jar(), null, {}, { method: 'GET', query: { track: recoveryTrack.id } })).json.artist.handle, 'sub-signal',
  'password recovery moves anonymous device releases into the recovered account');
assert.equal((await reset(jar())).json.error, 'invalid_reset');
assert.equal((await request(googleDevice, null, {}, { method: 'GET' })).json.account, null);
const oldGoogle = jar();
assert.equal((await googleFlow(oldGoogle, false)).result.redirect, '/?account=google_ok');
assert.notEqual((await request(oldGoogle, null, {}, { method: 'GET' })).json.account.id, id, 'the old Google identity cannot regain access after recovery');
assert.equal((await signIn(jar(), { password: resetPassword })).json.account.id, id);
console.log('Resend reset delivery, single-use tokens and session rotation passed');

// ---------- self-hosted account data stays private ----------
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(root + 'data/account-store-test-');
const file = dir + '/kv.json';
const server = createServer().listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
await new Promise((resolve) => server.close(resolve));
await writeFile(file, '{}');
await symlink(file, dir + '/alias.json');
const app = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_FILE: file },
  stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await Promise.race([once(app.stdout, 'data'), once(app, 'exit').then(([code]) => { throw new Error(`self-hosted server exited: ${code}`); })]);
  const status = async (path) => (await fetch(`http://127.0.0.1:${port}/${path}`)).status;
  assert.equal(await status('index.html'), 200);
  assert.equal(await status(file.slice(root.length)), 404);
  assert.equal(await status(dir.slice(root.length) + '/alias.json'), 404);
  assert.equal(await status('.data/kv.json'), 404);
} finally {
  const exited = once(app, 'exit');
  app.kill();
  await exited;
  await rm(dir, { recursive: true, force: true });
}
console.log('self-hosted static files refuse configured account stores and filesystem aliases');
