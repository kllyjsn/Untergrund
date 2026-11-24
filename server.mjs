// Local / self-hosted server: static files + the SoundCloud token endpoints (same logic as api/*.js on Vercel).
// SC_MOCK=1 points the app at an in-process fake SoundCloud for offline testing.
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpath as resolveFile } from 'node:fs/promises';
import { publicConfig, exchangeToken } from './api/_lib/soundcloud.js';
import { handleAutopublish } from './api/_lib/autopublish.js';
import { createRooms, roomsKv, memoryRoomsKv, roomsHandler } from './api/_lib/rooms.js';
import { handlePublicApi, publicApiRoute } from './api/_lib/public-api.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8000);
const MOCK = process.env.SC_MOCK === '1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.flac': 'audio/flac', '.webmanifest': 'application/manifest+json' };
const rooms = createRooms({ kv: roomsKv() || memoryRoomsKv() });
const roomsApiBase = process.env.ROOMS_API_URL;
const handleRooms = roomsHandler(rooms, { allowedOrigin: process.env.ROOMS_ALLOWED_ORIGIN || '*', apiBase: roomsApiBase });

let mock = null;
const env = { ...process.env };
if (MOCK) {
  env.CRON_SECRET ||= 'dev';
  mock = await import('./test/mock-soundcloud.mjs');
  Object.assign(env, { SOUNDCLOUD_CLIENT_ID: 'mock-client', SOUNDCLOUD_CLIENT_SECRET: 'mock-secret',
    SOUNDCLOUD_AUTH_URL: `http://localhost:${PORT}/mock-sc`, SOUNDCLOUD_API_URL: `http://localhost:${PORT}/mock-sc/api` });
}

import { handleCrate, handleRemix, handleDrop, handlePlay, memoryStore, redisStore, MAX_TRACK_BYTES } from './api/_lib/crate.js';
import { handleJukebox, memoryJukebox, redisJukebox } from './api/_lib/jukebox.js';
import { handleEvents, memoryKv, redisKv, MAX_BODY as MAX_EVENT_BYTES } from './api/_lib/events.js';
import { handlePlayback, memoryPlaybackKv, MAX_PLAYBACK_BODY } from './api/_lib/playback.js';
import { handleDescribe, aiEnv } from './api/_lib/describe-ai.js';
import { handlePlan, planEnv } from './api/_lib/song-plan-ai.js';
import { handleSing, singEnv, memorySingStore, MAX_SING_BODY } from './api/_lib/sing.js';
import { redisKv as redisAccountKv, memoryKv as memoryAccount } from './api/_lib/kv.js';
import { handleAccount, attachPublished } from './api/_lib/accounts.js';
import { GOOGLE_CALLBACK } from './api/_lib/listener-auth.js';
import { handleBilling, handleBillingWebhook, readBillingWebhook } from './api/_lib/billing.js';
import { handleSongDrafts, MAX_DRAFT_BODY } from './api/_lib/song-drafts.js';
import { handlePage } from './api/_lib/pages.js';
import { handlePush } from './api/_lib/push.js';
import { handleLegal } from './api/_lib/legal.js';
import { ogImage, artSeed } from './api/_lib/og.js';
import { clubImage } from './api/_lib/og-club.js';
import { handleHealth, redisHealthCheck } from './api/_lib/health.js';
import { LIBRARY_BODY_BYTES, libraryScripts } from './api/_lib/library.js';
const memoryAccountKv = (options) => memoryAccount({ ...options, scripts: libraryScripts });
const jukeboxStore = redisJukebox() || memoryJukebox();
const eventsKv = redisKv() || memoryKv();
const playbackKv = redisAccountKv() || memoryPlaybackKv();
const STATS_TOKEN = process.env.STATS_TOKEN || (MOCK ? 'dev' : '');
const crateStore = redisStore() || memoryStore();
const singStore = memorySingStore();
// Accounts/handles/follows persist to a local JSON file when Redis isn't configured.
const accountDataFile = path.resolve(process.env.DATA_FILE || path.join(ROOT, '.data/kv.json'));
const accountKv = redisAccountKv() || memoryAccountKv({ file: accountDataFile });
let authSecret = process.env.AUTH_SECRET || '';
if (!authSecret && !redisKv()) {
  authSecret = (await accountKv.cmd(['GET', 'untergrund:dev:auth-secret'])) || randomBytes(32).toString('hex');
  await accountKv.cmd(['SET', 'untergrund:dev:auth-secret', authSecret]);
}
const accountCtx = () => ({ kv: accountKv, crate: crateStore, secret: authSecret, env, secure: false });
const readBody = (req, max = Infinity, drain = false) => new Promise((ok, fail) => {
  const c = []; let size = 0;
  req.on('data', (d) => {
    size += d.length;
    if (size <= max) c.push(d);
    else if (!drain) { ok(null); req.destroy(); }
  });
  req.on('end', () => ok(size > max ? null : Buffer.concat(c)));
  req.on('error', fail);
});
const sendJson = (res, status, json) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(json)); };

function publicOrigin(url, headers) {
  const proto = headers['x-forwarded-proto']?.split(',')[0].trim().toLowerCase();
  if (proto !== 'https' && proto !== 'http') return url.origin;
  const host = headers['x-forwarded-host']?.split(',')[0].trim() || url.host;
  if (!/^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d+)?$/i.test(host)) return url.origin;
  try { return new URL(`${proto}://${host}`).origin; } catch { return url.origin; }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/health' || (url.pathname === '/api/page' && url.searchParams.get('health') === '1')) {
      const { status, json } = await handleHealth(req.method, { checkStorage: redisHealthCheck() || (() => true), env, accountSecret: authSecret, uploads: false });
      if (status === 405) res.setHeader('Allow', 'GET');
      return sendJson(res, status, json);
    }
    if (await handleRooms(req, res, url)) return;
    const publicRoute = publicApiRoute(url.pathname);
    if (publicRoute) {
      const r = await handlePublicApi({ method: req.method, ...publicRoute, ip: req.socket.remoteAddress },
        { kv: accountKv, crate: crateStore, rooms, roomsApiBase, rateKv: redisAccountKv(), site: publicOrigin(url, req.headers) });
      res.writeHead(r.status, { 'Content-Type': 'application/json', Vary: 'X-Forwarded-Proto, X-Forwarded-Host', ...r.headers });
      return res.end(r.status === 204 ? '' : JSON.stringify(r.json));
    }
    if (url.pathname === '/api/tracks' && url.searchParams.get('drop')) {
      const { status, json } = await handleDrop(req.method, url.searchParams.get('drop'), crateStore);
      return sendJson(res, status, json);
    }
    if (url.pathname === '/api/tracks' && url.searchParams.get('play')) {
      const { status, json } = await handlePlay(req.method, url.searchParams.get('play'), crateStore, req.socket.remoteAddress);
      return sendJson(res, status, json);
    }
    if (url.pathname === '/api/tracks' && url.searchParams.get('remix')) {
      const { status, json } = await handleRemix(req.method, url.searchParams.get('remix'), crateStore, req.socket.remoteAddress);
      return sendJson(res, status, json);
    }
    if (url.pathname === '/api/tracks') {
      if (+(req.headers['content-length'] || 0) > MAX_TRACK_BYTES) { req.destroy(); return; }
      const raw = req.method === 'POST' ? await readBody(req, MAX_TRACK_BYTES) : null;
      if (raw === null && req.method === 'POST') return sendJson(res, 413, { error: 'too_large' });
      const body = raw ? JSON.parse(raw.toString() || '{}') : null;
      const { status, json } = await handleCrate(req.method, body, crateStore, url.searchParams.get('id') || '', req.socket.remoteAddress);
      return sendJson(res, status, json);
    }
    if (url.pathname === '/api/jukebox') {
      let body = {};
      if (req.method === 'POST') {
        const chunks = []; let size = 0;
        for await (const c of req) { size += c.length; if (size > MAX_TRACK_BYTES * 2) break; chunks.push(c); }
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { body = null; }
      }
      const auth = { kv: accountKv, secret: authSecret, cookie: req.headers.cookie };
      const { status, json } = await handleJukebox(req.method, body, { store: jukeboxStore, crate: crateStore, auth, client: req.socket.remoteAddress, id: url.searchParams.get('id') || '' });
      if (status === 201 && json.item?.trackId && !body.accountId) await attachPublished({ ...auth, crate: crateStore, trackId: json.item.trackId });
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(json));
    }
    if (url.pathname === '/api/events' && url.searchParams.get('playback') === '1') {
      const raw = req.method === 'POST' ? await readBody(req, MAX_PLAYBACK_BODY) : null;
      if (raw === null && req.method === 'POST') return sendJson(res, 413, { error: 'too_large' });
      const { status, json } = await handlePlayback({ method: req.method, query: Object.fromEntries(url.searchParams),
        headers: req.headers, body: raw?.toString(), kv: playbackKv, accountKv, crate: crateStore, statsToken: STATS_TOKEN });
      return sendJson(res, status, json);
    }
    if (url.pathname === '/api/events' || url.pathname === '/api/improve-digest') {
      const raw = req.method === 'POST' ? await readBody(req, MAX_EVENT_BYTES) : null;
      if (raw === null && req.method === 'POST') return sendJson(res, 413, { error: 'too_large' });
      // Same rewrite as vercel.json: the daily digest cron runs inside the events function.
      const query = url.pathname === '/api/improve-digest' ? { ...Object.fromEntries(url.searchParams), digest: 'run' } : Object.fromEntries(url.searchParams);
      const { status, json } = await handleEvents({ method: req.method, query, headers: req.headers, body: raw ? raw.toString() : null, kv: eventsKv, client: req.socket.remoteAddress,
        statsToken: STATS_TOKEN, cronSecret: process.env.CRON_SECRET || '', webhook: process.env.DIGEST_WEBHOOK_URL || '' });
      return sendJson(res, status, json);
    }
    if (url.pathname === '/api/song-drafts' || (url.pathname === '/api/describe' && url.searchParams.get('drafts') === '1')) {
      try {
        const raw = req.method === 'POST' ? await readBody(req, MAX_DRAFT_BODY) : '';
        if (raw === null) return sendJson(res, 413, { error: 'too_large' });
        const r = await handleSongDrafts({ method: req.method, body: raw.toString(), cookie: req.headers.cookie,
          origin: req.headers.origin, host: req.headers.host }, accountCtx());
        return sendJson(res, r.status, r.json);
      } catch {
        return sendJson(res, 502, { error: 'drafts_unavailable' });
      }
    }
    if (url.pathname === '/api/describe') {
      const raw = req.method === 'POST' ? await readBody(req, 4000) : null;
      const { status, json } = await handleDescribe({ method: req.method, body: raw ? raw.toString() : null, client: req.socket.remoteAddress, ...aiEnv(process.env), kv: eventsKv });
      return sendJson(res, status, json);
    }
    if (url.pathname === '/api/song-plan') {
      const raw = req.method === 'POST' ? await readBody(req, 12000) : null;
      const { status, json } = await handlePlan({ method: req.method, body: raw ? raw.toString() : null, client: req.socket.remoteAddress, ...planEnv(process.env), kv: eventsKv });
      return sendJson(res, status, json);
    }
    if (url.pathname === '/api/sing') {
      const raw = req.method === 'POST' ? await readBody(req, MAX_SING_BODY) : null;
      const r = await handleSing({ method: req.method, body: raw ? raw.toString() : req.method === 'POST' ? 'x'.repeat(MAX_SING_BODY + 1) : null, client: req.socket.remoteAddress, ...singEnv(process.env), kv: eventsKv, store: singStore });
      if (r.body) { res.writeHead(r.status, { 'Content-Type': r.type, 'Cache-Control': 'no-store' }); return res.end(r.body); }
      return sendJson(res, r.status, r.json);
    }
    if (url.pathname === '/api/push') {
      const raw = req.method === 'POST' ? await readBody(req, 8000) : null;
      const { status, json } = await handlePush({ method: req.method, query: Object.fromEntries(url.searchParams), headers: req.headers, body: raw ? raw.toString() : null, kv: accountKv, client: req.socket.remoteAddress });
      return sendJson(res, status, json);
    }
    if (url.pathname === '/api/legal') {
      const raw = req.method === 'POST' ? await readBody(req, 7000) : null;
      if (raw === null && req.method === 'POST') return sendJson(res, 413, { error: 'too_large' });
      const { status, json } = await handleLegal({
        method: req.method, body: raw ? raw.toString() : null, query: Object.fromEntries(url.searchParams),
        headers: req.headers, kv: accountKv, client: req.socket.remoteAddress, statsToken: STATS_TOKEN,
      });
      return sendJson(res, status, json);
    }
    if (url.pathname.startsWith('/api/billing/') || (url.pathname === '/api/account' && url.searchParams.has('billing'))) {
      const action = url.pathname.startsWith('/api/billing/') ? url.pathname.slice('/api/billing/'.length) : url.searchParams.get('billing');
      try {
        const r = action === 'webhook'
          ? await handleBillingWebhook({ method: req.method, raw: req.method === 'POST' && await readBillingWebhook(req), signature: req.headers['stripe-signature'] }, accountCtx())
          : await handleBilling(action, { method: req.method, cookie: req.headers.cookie, client: req.socket.remoteAddress,
            origin: req.headers.origin, host: req.headers.host }, accountCtx());
        return sendJson(res, r.status, r.json);
      } catch (err) {
        console.error('Billing request failed:', err.message);
        return sendJson(res, 502, { error: 'billing_unavailable' });
      }
    }
    if (url.pathname === '/api/account' || url.pathname === GOOGLE_CALLBACK) {
      const query = Object.fromEntries(url.searchParams);
      const isGoogleCallback = url.pathname === GOOGLE_CALLBACK;
      if (isGoogleCallback) query.action = 'google-callback';
      const library = !isGoogleCallback && query.library !== undefined;
      let body = {}, tooLarge = false;
      if (req.method === 'POST') {
        const raw = await readBody(req, library ? LIBRARY_BODY_BYTES : 16000, library);
        tooLarge = raw === null;
        try { body = JSON.parse(raw?.toString() || '{}'); } catch { body = null; }
      }
      const { status, json, cookie, redirect } = await handleAccount({ method: req.method, query, body, tooLarge, cookie: req.headers.cookie,
        client: req.socket.remoteAddress, origin: req.headers.origin, host: req.headers.host }, accountCtx());
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cookie && { 'Set-Cookie': cookie }),
        ...(redirect && { Location: redirect, 'Referrer-Policy': 'no-referrer' }) });
      return res.end(redirect ? undefined : JSON.stringify(json));
    }
    const pageMatch = url.pathname.match(/^\/(a|t|r)\/([^/]{1,60})\/?$/);
    if (pageMatch || url.pathname === '/api/page' || url.pathname === '/api/flagship') {
      const query = pageMatch ? { ...Object.fromEntries(url.searchParams), [pageMatch[1]]: decodeURIComponent(pageMatch[2]) } : url.pathname === '/api/flagship' ? { flagship: '1' } : Object.fromEntries(url.searchParams);
      const r = await handlePage(query, { kv: accountKv, crate: crateStore, jukebox: jukeboxStore, site: `http://${req.headers.host}`, og: { ogImage, artSeed, clubImage }, rooms, env });
      if (r.location) { res.writeHead(r.status, { Location: r.location }); return res.end(); }
      res.writeHead(r.status, { 'Content-Type': r.type, 'Cache-Control': 'no-store' });
      return res.end(r.body);
    }
    if (url.pathname === '/api/set-upload') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'uploads_disabled' }));
    }
    if (url.pathname === '/api/room-config') {
      return sendJson(res, 200, { apiBase: process.env.ROOMS_API_URL || '' });
    }
    if (url.pathname === '/api/sc-config') {
      const cfg = publicConfig(env);
      if (MOCK) { const o = `http://${req.headers.host}/mock-sc`; cfg.authUrl = o; cfg.apiUrl = o + '/api'; }
      return sendJson(res, 200, cfg);
    }
    if (url.pathname === '/api/autopublish' || (url.pathname === '/api/sc-token' && url.searchParams.get('autopublish') === '1')) {
      const raw = req.method === 'POST' ? await readBody(req, 16000) : null;
      if (raw === null && req.method === 'POST') return sendJson(res, 413, { error: 'too_large' });
      const { status, json } = await handleAutopublish({ method: req.method, query: Object.fromEntries(url.searchParams), body: raw?.toString(), headers: req.headers, kv: accountKv, env });
      return sendJson(res, status, json);
    }
    if (url.pathname === '/api/sc-token' && req.method === 'POST') {
      const { status, json } = await exchangeToken(JSON.parse((await readBody(req)).toString() || '{}'), env);
      return sendJson(res, status, json);
    }
    if (MOCK && url.pathname.startsWith('/mock-sc')) return mock.handle(req, res, url, readBody);
    if (MOCK && url.pathname === '/upload' && req.method === 'POST') {
      await mkdir(path.join(ROOT, 'test/out'), { recursive: true });
      await writeFile(path.join(ROOT, 'test/out', path.basename(url.searchParams.get('name') || 'out.wav')), await readBody(req));
      return sendJson(res, 200, { ok: true });
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/pricing') p = '/pricing/';
    if (p === '/research' || p.startsWith('/research/')) {
      const files = (await import('./scripts/research.mjs')).renderSite();
      const f = files.get(p) || files.get(p.replace(/\/?$/, '/index.html'));
      if (!f) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-store' });
      return res.end(f.body);
    }
    if (accountKv.kind === 'memory') {
      const localStore = path.resolve(process.env.DATA_FILE || path.join(ROOT, '.data/kv.json'));
      const requested = path.join(ROOT, path.normalize(p.endsWith('/') ? `${p}index.html` : p));
      const resolvedStore = await resolveFile(localStore).catch(() => localStore);
      if (requested === localStore || await resolveFile(requested).catch(() => null) === resolvedStore) {
        res.writeHead(404);
        return res.end('not found');
      }
    }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    const privatePath = (file) => !file.startsWith(ROOT + path.sep) || /\/(\.[^/]+|api|node_modules|suno-lab)(\/|$)/.test(file.slice(ROOT.length));
    if (privatePath(file) || file === accountDataFile) { res.writeHead(404); return res.end(); }
    const resolved = await realpath(file);
    const privateStore = await realpath(accountDataFile).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
      return accountDataFile;
    });
    if (privatePath(resolved) || resolved === privateStore) { res.writeHead(404); return res.end(); }
    const data = await readFile(resolved);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') { res.writeHead(404); return res.end('not found'); }
    console.error(err); sendJson(res, 500, { error: 'server_error' });
  }
}).listen(PORT, function () { console.log(`UNTERGRUND on http://localhost:${this.address().port}${MOCK ? ' (mock SoundCloud)' : ''}${STATS_TOKEN && MOCK && !process.env.STATS_TOKEN ? ` · stats: /stats.html?token=${STATS_TOKEN}` : ''}`); });
