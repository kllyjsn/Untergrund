import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { completeCallback } from '../js/soundcloud.js';
import { handle } from './mock-soundcloud.mjs';
import { memoryKv } from '../api/_lib/kv.js';
import { handleAutopublish, AUTOPUBLISH } from '../api/_lib/autopublish.js';
import { releaseChoice } from '../scripts/daily-release.mjs';
import { autoDescription, autoTags } from '../js/release-metadata.js';
import { STYLES, freshSong } from '../js/state.js';

const server = createServer(async (req, res) => {
  const readBody = async () => { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks); };
  await handle(req, res, new URL(req.url, 'http://localhost'), readBody);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/mock-sc`;
const env = { SOUNDCLOUD_CLIENT_ID: 'mock-client', SOUNDCLOUD_CLIENT_SECRET: 'mock-secret', SOUNDCLOUD_AUTH_URL: base,
  SOUNDCLOUD_API_URL: `${base}/api`, AUTOPUBLISH_SC_USER: 'untergrund-test', CRON_SECRET: 'test-cron-secret' };
const kv = memoryKv(), now = Date.parse('2026-11-22T13:30:00Z'), day = Math.floor(now / 86400e3), date = '2026-11-22';
const prefix = `https://github.com/kllyjsn/Untergrund/releases/download/daily-${date}/`;
const meta = { day, date, title: 'Copper Orbit', audio: 'song.mp3', artwork: 'cover.png', description: 'Daily swing · https://www.untergrund.sh', tags: ['swing', '120 bpm'], genre: 'SWING' };
let uploads = 0, failAsset = false, missingRelease = false, missingAudio = false, badMeta = false, rejectUpload = false;
const fakeFetch = async (url, opts) => {
  if (url.startsWith('https://api.github.com/')) {
    assert.equal(url.toLowerCase(), `https://api.github.com/repos/kllyjsn/Untergrund/releases/tags/daily-${date}`.toLowerCase());
    if (missingRelease) return new Response('', { status: 404 });
    return Response.json({ assets: ['release.json', ...(!missingAudio ? ['song.mp3'] : []), 'cover.png'].map((name) => ({ name, browser_download_url: prefix + name })) });
  }
  if (url.startsWith(prefix)) {
    if (url.endsWith('release.json')) return Response.json({ ...meta, ...(badMeta ? { day: day - 1 } : {}) });
    if (failAsset) return new Response('', { status: 503 });
    assert.notEqual(JSON.parse(await kv.cmd(['GET', `${AUTOPUBLISH}:account`])).refresh_token, initialRefresh, 'rotation is persisted before downloading audio');
    return new Response(new Uint8Array([1, 2, 3, 4]));
  }
  if (url === `${base}/api/tracks` && opts?.method === 'POST') {
    uploads++;
    assert.equal(opts.body.get('track[title]'), meta.title);
    assert.equal(opts.body.get('track[sharing]'), 'public');
    assert.equal(opts.body.get('track[tag_list]'), '"swing" "120 bpm"');
    assert.equal(opts.body.get('track[genre]'), 'SWING');
    assert.equal(opts.body.get('track[description]'), meta.description);
    if (rejectUpload) return new Response('', { status: 503 });
  }
  return fetch(url, opts);
};
const call = (method, body, query = {}, extra = {}) => handleAutopublish({ method, body, query, headers: { authorization: `Bearer ${env.CRON_SECRET}` }, kv, env, now, fetchImpl: fakeFetch, ...extra });
async function codeBody() {
  const verifier = 'a-valid-pkce-verifier-for-autopublish-test';
  const q = new URLSearchParams({ code_challenge: createHash('sha256').update(verifier).digest('base64url'), redirect_uri: 'http://localhost/sc-callback.html', state: 'test' });
  const html = await (await fetch(`${base}/authorize?${q}`)).text();
  const url = new URL(html.match(/href="([^"]+)"/)[1]);
  return { code: url.searchParams.get('code'), code_verifier: verifier, redirect_uri: 'http://localhost/sc-callback.html' };
}
let initialRefresh;
try {
  for (const method of ['GET', 'POST']) {
    for (const extra of [{ headers: {} }, { headers: { authorization: 'Bearer wrong' } }, { env: { ...env, CRON_SECRET: '' } }]) {
      const response = await call(method, '', { run: '1' }, {
        ...extra,
        kv: { cmd() { assert.fail('unauthorized runs must not access storage'); } },
        fetchImpl() { assert.fail('unauthorized runs must not fetch'); }
      });
      assert.equal(response.status, 401);
      assert.equal(response.json.error, 'unauthorized');
    }
  }
  console.log('autopublish authorization: GET/POST reject missing, wrong and unset secrets without side effects passed');
  assert.deepEqual((await call('GET')).json, { connected: false, account: null, allowedPermalink: 'untergrund-test', last: null });
  assert.equal((await call('GET', null, {}, { env: { ...env, AUTOPUBLISH_SC_USER: '' } })).json.allowedPermalink, 'jason-kelley-203620322');
  assert.equal((await call('POST', {}, { run: '1' })).json.error, 'not_connected');
  for (const body of ['', ' \n\t ']) assert.equal((await call('POST', body, { run: '1' })).json.error, 'not_connected', 'bodyless runs reach publishing logic');
  assert.equal((await call('POST', {})).status, 400);
  assert.equal((await call('POST', '{')).json.error, 'invalid_json');
  assert.equal((await call('DELETE')).status, 405);
  assert.equal((await call('GET', {}, {}, { kv: null })).status, 503);
  const wrong = await call('POST', await codeBody(), {}, { env: { ...env, AUTOPUBLISH_SC_USER: 'other-user' } });
  assert.equal(wrong.status, 403);
  assert.equal(await kv.cmd(['GET', `${AUTOPUBLISH}:account`]), null);
  assert.equal((await call('POST', { code: 'bad', code_verifier: 'bad', redirect_uri: 'http://localhost/sc-callback.html' })).json.error, 'token_exchange_failed');
  assert.equal((await call('POST', await codeBody())).status, 200);
  initialRefresh = JSON.parse(await kv.cmd(['GET', `${AUTOPUBLISH}:account`])).refresh_token;
  missingRelease = true;
  assert.equal((await call('POST', {}, { run: '1' })).json.error, 'no_release_yet');
  missingRelease = false; badMeta = true;
  assert.equal((await call('POST', {}, { run: '1' })).status, 422);
  badMeta = false; missingAudio = true;
  assert.equal((await call('POST', {}, { run: '1' })).status, 502);
  missingAudio = false; failAsset = true;
  assert.equal((await call('POST', {}, { run: '1' })).status, 502);
  assert.equal(await kv.cmd(['GET', `${AUTOPUBLISH}:day:${day}`]), null, 'pre-upload failure remains retryable');
  failAsset = false;
  const [first, concurrent] = await Promise.all([
    call('POST', {}, { run: '1' }, { env: { ...env, AUTOPUBLISH_GITHUB_REPO: 'kllyjsn/untergrund' } }),
    call('POST', {}, { run: '1' }),
  ]);
  assert.equal(first.status, 200); assert.equal(first.json.published, true);
  assert.equal(concurrent.json.error, 'busy');
  assert.equal(uploads, 1);
  const second = await call('POST', {}, { run: '1' });
  assert.equal(second.json.published, false); assert.equal(uploads, 1);
  assert.equal((await call('GET', {}, { run: '1' })).json.published, false, 'Vercel cron GET is idempotent');
  const status = await call('GET');
  assert.equal(status.json.connected, true); assert.equal(status.json.last.trackId, first.json.trackId);
  assert.equal(status.json.account, 'https://soundcloud.com/untergrund-test');
  assert(!JSON.stringify(status).includes('mock-refresh')); assert(!JSON.stringify(status).includes('access_token'));
  assert.notEqual(JSON.parse(await kv.cmd(['GET', `${AUTOPUBLISH}:account`])).refresh_token, initialRefresh);
  await kv.cmd(['DEL', `${AUTOPUBLISH}:day:${day}`]);
  rejectUpload = true;
  assert.equal((await call('POST', {}, { run: '1' })).json.error, 'upload_failed');
  assert.equal((await call('POST', {}, { run: '1' })).json.error, 'publish_uncertain');
  assert.equal(uploads, 2, 'uncertain uploads are not duplicated');
  console.log('autopublish: wrong-account rejection, PKCE connect, missing release/assets, rotation, concurrency, publish-once and uncertain-upload protection passed');

  const originalFetch = globalThis.fetch;
  const callbackStored = new Map();
  const callbackScript = readFileSync(new URL('../sc-callback.html', import.meta.url), 'utf8').match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import .*?;/, '');
  let callbackPosts = 0, wrongAccount = false, unconfirmed = false;
  globalThis.localStorage = { getItem: (k) => callbackStored.get(k), setItem: (k, v) => callbackStored.set(k, v), removeItem: (k) => callbackStored.delete(k) };
  globalThis.location = { origin: 'http://localhost' };
  globalThis.fetch = async (url, options) => {
    if (url !== '/api/autopublish') return originalFetch(url, options);
    if (options?.method === 'POST') callbackPosts++;
    if (unconfirmed && !options?.method) return Response.json({ connected: false });
    const response = await call(options?.method || 'GET', options?.body, {}, { env: { ...env, ...(wrongAccount ? { AUTOPUBLISH_SC_USER: 'allowed-account' } : {}) } });
    return Response.json(response.json, { status: response.status });
  };
  const callbackPage = async (state, code) => {
    const message = { textContent: 'Connecting SoundCloud…' };
    await runInNewContext(`(async () => { ${callbackScript} })()`, { completeCallback, URLSearchParams,
      location: { origin: 'http://localhost', search: `?${new URLSearchParams({ state, code })}` },
      window: { opener: null }, document: { getElementById: () => message } });
    return message.textContent;
  };
  const prepareCallback = async (state, age = 0) => {
    const body = await codeBody();
    callbackStored.set('untergrund.sc.pending', JSON.stringify({ state, verifier: body.code_verifier, endpoint: '/api/autopublish', persistTokens: false, redirect_uri: body.redirect_uri, t: Date.now() - age }));
    return body.code;
  };
  try {
    await kv.cmd(['DEL', `${AUTOPUBLISH}:account`]);
    const code = await prepareCallback('no-opener');
    assert.equal(await callbackPage('no-opener', code), 'Connected — you can close this tab.');
    assert.equal((await call('GET')).json.connected, true, 'callback exchanges against mock SoundCloud and connects the server');
    assert.equal(callbackPosts, 1);
    assert.equal(callbackStored.has('untergrund.sc.pending'), false);
    assert.equal(callbackStored.has('untergrund.sc'), false, 'server-only callback stores no browser tokens');
    assert.equal(JSON.parse(callbackStored.get('untergrund.sc.callback')).done, true);
    assert.match(await callbackPage('no-opener', code), /does not match/);
    assert.equal(callbackPosts, 1, 'pending record is single-use');
    wrongAccount = true;
    assert.equal(await callbackPage('wrong', await prepareCallback('wrong')), "That SoundCloud account isn't the one set up for autopublishing. Sign in as allowed-account and try again.");
    assert(JSON.parse(callbackStored.get('untergrund.sc.callback')).error);
    wrongAccount = false; unconfirmed = true;
    assert.match(await callbackPage('unconfirmed', await prepareCallback('unconfirmed')), /could not be confirmed/);
    unconfirmed = false;
    const beforeExpired = callbackPosts;
    assert.match(await callbackPage('expired', await prepareCallback('expired', 601e3)), /expired/);
    assert.equal(callbackStored.has('untergrund.sc.pending'), false);
    assert.match(await callbackPage('mismatch', await prepareCallback('expected')), /does not match/);
    assert.equal(callbackPosts, beforeExpired, 'expired and mismatched callbacks never exchange');
    console.log('SoundCloud callback page: no-opener server exchange, confirmation, wrong-account feedback, expiry and replay protection passed');
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
    delete globalThis.location;
  }

  const ids = Object.keys(STYLES);
  for (let i = 0; i < ids.length; i++) assert.equal(releaseChoice(i).style, ids[i]);
  assert.equal(releaseChoice(day, 'swing').style, 'swing');
  assert.equal(releaseChoice(day).seed, releaseChoice(day).seed);
  for (const bad of [-1, NaN, 1.2, Infinity]) assert.throws(() => releaseChoice(bad));
  assert.throws(() => releaseChoice(day, 'unknown'));
  assert.throws(() => releaseChoice(day, 'toString'));
  for (const style of ids) {
    const s = freshSong(style, 42), desc = autoDescription(s, style, 64), tags = autoTags(s, style);
    assert(desc.includes(STYLES[style].name)); assert(desc.includes('daily')); assert(desc.includes('https://www.untergrund.sh'));
    assert(!desc.includes('week')); assert(!tags.includes('berlin techno'));
    assert(tags.includes(STYLES[style].name.toLowerCase()));
  }
  assert(autoDescription(freshSong('repertoire', 42), 'repertoire', 35, 'G major').includes('G major'));
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  assert(config.rewrites.some((r) => r.source === '/api/autopublish' && r.destination === '/api/sc-token?autopublish=1'));
  assert(config.crons.some((r) => r.path === '/api/autopublish?run=1'));
  console.log('daily release: all 42 genre rotation, overrides, invalid input and genre-correct metadata passed');
} finally { await new Promise((resolve) => server.close(resolve)); }

const saved = Object.fromEntries(['window', 'location', 'localStorage', 'fetch', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
try {
  const stored = new Map(), listeners = new Map();
  let rejectConnect = false, persistTokens = false, callbackExchange = false, posts = 0, accountSignIn = false, accountRefreshes = 0;
  const signedInAccount = { id: 'sc-42', handle: 'test-artist' };
  globalThis.localStorage = { getItem: (k) => stored.get(k), setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
  globalThis.location = { origin: 'http://localhost' };
  globalThis.window = {
    open: () => ({ closed: false, close() {}, location: { set href(value) {
      const state = new URL(value).searchParams.get('state');
      assert.equal(JSON.parse(stored.get('untergrund.sc.pending')).state, state, 'pending PKCE record is saved before navigation');
      queueMicrotask(async () => {
        const data = callbackExchange ? await completeCallback({ state, code: 'code' }) : { type: 'sc-auth', code: 'code', state };
        listeners.get('message')({ origin: location.origin, data });
      });
    } } }),
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event) => listeners.delete(event),
  };
  globalThis.fetch = async (url, options) => {
    if (url === '/api/sc-config') return Response.json({ enabled: true, clientId: 'test', authUrl: 'https://soundcloud.example' });
    if (url === '/api/account' && options?.method === 'GET') {
      accountRefreshes++;
      return Response.json({ enabled: true, account: signedInAccount, following: [] });
    }
    if (url === '/api/autopublish' && !options?.method) return Response.json({ connected: callbackExchange, allowedPermalink: 'release-account' });
    assert.equal(url, accountSignIn ? '/api/account?action=soundcloud' : persistTokens ? '/api/sc-token' : '/api/autopublish');
    posts++;
    const body = JSON.parse(options.body);
    assert.equal(body.redirect_uri, 'http://localhost/sc-callback.html');
    assert(body.code_verifier.length > 40);
    if (rejectConnect) return Response.json({ error: 'wrong_account' }, { status: 403 });
    return Response.json(persistTokens ? { access_token: 'browser-access', refresh_token: 'browser-refresh', ...(accountSignIn ? { account: signedInAccount } : {}) } : { connected: true });
  };
  const { connect } = await import('../js/soundcloud.js');
  assert.equal((await connect({ endpoint: '/api/autopublish', persistTokens: false })).connected, true);
  assert.equal(stored.size, 0, 'server-only connection never stores browser tokens');
  rejectConnect = true;
  await assert.rejects(connect({ endpoint: '/api/autopublish', persistTokens: false }), /wrong_account/);
  rejectConnect = false; persistTokens = true;
  await connect();
  assert.equal(JSON.parse(stored.get('untergrund.sc')).access_token, 'browser-access', 'normal publishing still stores browser tokens');
  callbackExchange = true;
  const before = posts;
  await connect();
  assert.equal(posts, before + 1, 'done outcome does not exchange twice');
  assert.equal(JSON.parse(stored.get('untergrund.sc')).refresh_token, 'browser-refresh', 'callback persists regular publishing tokens');
  accountSignIn = true;
  const { signInWithSoundCloud, getAccount } = await import('../js/account.js');
  assert.deepEqual(await signInWithSoundCloud(), signedInAccount, 'detached callback preserves the sign-in account');
  assert.deepEqual((await getAccount()).account, signedInAccount);
  assert.equal(accountRefreshes, 1, 'account sign-in refreshes the account');
  const reported = JSON.parse(stored.get('untergrund.sc.callback'));
  assert.deepEqual(reported.result, { account: signedInAccount });
  assert(!JSON.stringify(reported).includes('browser-access'));
  assert(!JSON.stringify(reported).includes('browser-refresh'));
  accountSignIn = false;
  console.log('SoundCloud detached sign-in: account returned, profile refreshed and tokens excluded from callback outcome passed');
  rejectConnect = true; persistTokens = false;
  await assert.rejects(connect({ endpoint: '/api/autopublish', persistTokens: false }), /Sign in as release-account/);
  assert.equal(posts, before + 3, 'reported callback error does not trigger a second exchange');
  rejectConnect = false;
  stored.delete('untergrund.sc.callback');
  callbackExchange = false;
  console.log('SoundCloud PKCE: server-only connection, wrong-account feedback and existing browser token flow passed');
  let click;
  const status = { textContent: '', replaceChildren(...parts) { this.textContent = parts.join(''); }, append(...parts) { this.textContent += parts.filter((p) => typeof p === 'string').join(''); } };
  const button = { addEventListener: (_, callback) => { click = callback; } };
  const documentListeners = new Map();
  globalThis.document = { addEventListener: (event, fn) => documentListeners.set(event, fn), querySelector: (selector) => selector === '#status' ? status : button, createTextNode: (s) => s, createElement: () => ({}) };
  await import('../js/autopublish.js');
  await new Promise((resolve) => setImmediate(resolve));
  assert(status.textContent.includes('Allowed SoundCloud account: release-account'));
  rejectConnect = true; persistTokens = false;
  await click();
  assert.equal(status.textContent, "That SoundCloud account isn't the one set up for autopublishing. Sign in as release-account and try again.");
  assert.equal(button.disabled, false);
  callbackExchange = true;
  await listeners.get('focus')();
  await new Promise((resolve) => setImmediate(resolve));
  assert(status.textContent.startsWith('Connected:'), 'focus refreshes the server connection status');
  callbackExchange = false;
  document.visibilityState = 'visible';
  await documentListeners.get('visibilitychange')();
  await new Promise((resolve) => setImmediate(resolve));
  assert(status.textContent.startsWith('Not connected.'), 'visibility refreshes server status');
  console.log('autopublish page: allowed account displayed and wrong-account rejection shows sign-in guidance passed');
} finally {
  for (const [key, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
