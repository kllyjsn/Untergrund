// Local / self-hosted server: static files + the SoundCloud token endpoints (same logic as api/*.js on Vercel).
// SC_MOCK=1 points the app at an in-process fake SoundCloud for offline testing.
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicConfig, exchangeToken } from './api/_lib/soundcloud.js';
import { createRooms, roomsKv, memoryRoomsKv, roomsHandler } from './api/_lib/rooms.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8000);
const MOCK = process.env.SC_MOCK === '1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.flac': 'audio/flac', '.webmanifest': 'application/manifest+json' };
const rooms = createRooms({ kv: roomsKv() || memoryRoomsKv() });
const handleRooms = roomsHandler(rooms, { allowedOrigin: process.env.ROOMS_ALLOWED_ORIGIN || '*' });

let mock = null;
const env = { ...process.env };
if (MOCK) {
  mock = await import('./test/mock-soundcloud.mjs');
  Object.assign(env, { SOUNDCLOUD_CLIENT_ID: 'mock-client', SOUNDCLOUD_CLIENT_SECRET: 'mock-secret',
    SOUNDCLOUD_AUTH_URL: `http://localhost:${PORT}/mock-sc`, SOUNDCLOUD_API_URL: `http://localhost:${PORT}/mock-sc/api` });
}

import { handleCrate, handleRemix, handleDrop, handlePlay, memoryStore, redisStore, MAX_TRACK_BYTES } from './api/_lib/crate.js';
import { handleJukebox, memoryJukebox, redisJukebox } from './api/_lib/jukebox.js';
import { handleEvents, memoryKv, redisKv, MAX_BODY as MAX_EVENT_BYTES } from './api/_lib/events.js';
import { handleDescribe, aiEnv } from './api/_lib/describe-ai.js';
import { handlePlan, planEnv } from './api/_lib/song-plan-ai.js';
import { redisKv as redisAccountKv, memoryKv as memoryAccountKv } from './api/_lib/kv.js';
import { handleAccount, attachPublished } from './api/_lib/accounts.js';
import { handlePage } from './api/_lib/pages.js';
import { handlePush } from './api/_lib/push.js';
import { ogImage, artSeed } from './api/_lib/og.js';
const jukeboxStore = redisJukebox() || memoryJukebox();
const eventsKv = redisKv() || memoryKv();
const STATS_TOKEN = process.env.STATS_TOKEN || (MOCK ? 'dev' : '');
const crateStore = redisStore() || memoryStore();
// Accounts/handles/follows persist to a local JSON file when Redis isn't configured.
const accountKv = redisAccountKv() || memoryAccountKv({ file: process.env.DATA_FILE || path.join(ROOT, '.data/kv.json') });
let authSecret = process.env.AUTH_SECRET || '';
if (!authSecret && !redisKv()) {
  authSecret = (await accountKv.cmd(['GET', 'untergrund:dev:auth-secret'])) || randomBytes(32).toString('hex');
  await accountKv.cmd(['SET', 'untergrund:dev:auth-secret', authSecret]);
}
const accountCtx = () => ({ kv: accountKv, crate: crateStore, secret: authSecret, env, secure: false });
const readBody = (req, max = Infinity) => new Promise((ok, fail) => {
  const c = []; let size = 0;
  req.on('data', (d) => { size += d.length; if (size > max) { ok(null); req.destroy(); } else c.push(d); });
  req.on('end', () => ok(Buffer.concat(c)));
  req.on('error', fail);
});
const sendJson = (res, status, json) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(json)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (await handleRooms(req, res, url)) return;
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
      const { status, json } = await handleJukebox(req.method, body, { store: jukeboxStore, crate: crateStore, client: req.socket.remoteAddress, id: url.searchParams.get('id') || '' });
      if (status === 201 && json.item?.trackId) await attachPublished({ kv: accountKv, secret: authSecret, cookie: req.headers.cookie, crate: crateStore, trackId: json.item.trackId });
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(json));
    }
    if (url.pathname === '/api/events') {
      const raw = req.method === 'POST' ? await readBody(req, MAX_EVENT_BYTES) : null;
      if (raw === null && req.method === 'POST') return sendJson(res, 413, { error: 'too_large' });
      const { status, json } = await handleEvents({ method: req.method, query: Object.fromEntries(url.searchParams), headers: req.headers, body: raw ? raw.toString() : null, kv: eventsKv, client: req.socket.remoteAddress, statsToken: STATS_TOKEN });
      return sendJson(res, status, json);
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
    if (url.pathname === '/api/push') {
      const raw = req.method === 'POST' ? await readBody(req, 8000) : null;
      const { status, json } = await handlePush({ method: req.method, query: Object.fromEntries(url.searchParams), headers: req.headers, body: raw ? raw.toString() : null, kv: accountKv, client: req.socket.remoteAddress });
      return sendJson(res, status, json);
    }
    if (url.pathname === '/api/account') {
      let body = {};
      if (req.method === 'POST') { const raw = await readBody(req, 16000); try { body = JSON.parse(raw?.toString() || '{}'); } catch { body = null; } }
      const { status, json, cookie } = await handleAccount({ method: req.method, query: Object.fromEntries(url.searchParams), body, cookie: req.headers.cookie,
        client: req.socket.remoteAddress, origin: req.headers.origin, host: req.headers.host }, accountCtx());
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cookie && { 'Set-Cookie': cookie }) });
      return res.end(JSON.stringify(json));
    }
    const pageMatch = url.pathname.match(/^\/(a|t)\/([^/]{1,60})\/?$/);
    if (pageMatch || url.pathname === '/api/page') {
      const query = pageMatch ? { [pageMatch[1]]: decodeURIComponent(pageMatch[2]) } : Object.fromEntries(url.searchParams);
      const r = await handlePage(query, { kv: accountKv, crate: crateStore, site: `http://${req.headers.host}`, og: { ogImage, artSeed } });
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
    if (p === '/research' || p.startsWith('/research/')) {
      const files = (await import('./scripts/research.mjs')).renderSite();
      const f = files.get(p) || files.get(p.replace(/\/?$/, '/index.html'));
      if (!f) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-store' });
      return res.end(f.body);
    }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT) || /\/(\.git|api|node_modules)(\/|$)/.test(file.slice(ROOT.length))) { res.writeHead(404); return res.end(); }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') { res.writeHead(404); return res.end('not found'); }
    console.error(err); sendJson(res, 500, { error: 'server_error' });
  }
}).listen(PORT, () => console.log(`UNTERGRUND on http://localhost:${PORT}${MOCK ? ' (mock SoundCloud)' : ''}${STATS_TOKEN && MOCK && !process.env.STATS_TOKEN ? ` · stats: /stats.html?token=${STATS_TOKEN}` : ''}`));
