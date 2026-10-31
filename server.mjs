// Local / self-hosted server: static files + the SoundCloud token endpoints (same logic as api/*.js on Vercel).
// SC_MOCK=1 points the app at an in-process fake SoundCloud for offline testing.
import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicConfig, exchangeToken } from './api/_lib/soundcloud.js';
import { STYLES, sanitize } from './js/state.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8000);
const MOCK = process.env.SC_MOCK === '1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };
const rooms = new Map();

let mock = null;
const env = { ...process.env };
if (MOCK) {
  mock = await import('./test/mock-soundcloud.mjs');
  Object.assign(env, { SOUNDCLOUD_CLIENT_ID: 'mock-client', SOUNDCLOUD_CLIENT_SECRET: 'mock-secret',
    SOUNDCLOUD_AUTH_URL: `http://localhost:${PORT}/mock-sc`, SOUNDCLOUD_API_URL: `http://localhost:${PORT}/mock-sc/api` });
}

const readBody = (req) => new Promise((ok, fail) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', fail); });
const sendJson = (res, status, json) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(json)); };
const sendRoomJson = (res, status, json) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': process.env.ROOMS_ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(json));
};
const clean = (value, max = 80) => String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
const secretHash = (value) => createHash('sha256').update(String(value || '')).digest();
const validSecret = (secret, expected) => {
  if (!/^[a-f0-9]{64}$/i.test(String(secret || '')) || !expected) return false;
  return timingSafeEqual(secretHash(secret), Buffer.from(expected, 'hex'));
};
const getRoom = (id) => {
  if (!rooms.has(id)) rooms.set(id, { id, seq: 0, setVersion: 0, hostId: null, queue: [], members: new Map(), tokens: new Map(), secrets: new Map(), events: [], currentSet: null });
  return rooms.get(id);
};

function normalizeSet(payload) {
  if (!payload || typeof payload !== 'object' || !payload.state || !Array.isArray(payload.state.patterns)) return null;
  const state = sanitize(payload.state);
  const now = Date.now();
  const requestedStart = Number(payload.startsAt);
  return {
    state,
    style: STYLES[payload.style] ? payload.style : (STYLES[state.artist?.style] ? state.artist.style : 'hypnotic'),
    title: clean(payload.title || state.artist?.title || 'Live Machine Set', 80),
    artist: clean(payload.artist || state.artist?.name || 'UNTERGRUND', 40),
    bpm: state.bpm,
    key: clean(payload.key, 24),
    startsAt: Number.isFinite(requestedStart) ? Math.max(now - 864e5, Math.min(now + 300000, requestedStart)) : now + 1000,
    by: clean(payload.by, 64),
  };
}

function roomSnapshot(room, since = 0) {
  const cutoff = Date.now() - 15000;
  for (const [id, member] of room.members) if (member.seen < cutoff) room.members.delete(id);
  room.queue = room.queue.filter((id) => room.members.has(id) && id !== room.hostId);
  if (room.hostId && !room.members.has(room.hostId)) room.hostId = room.queue.shift() || room.members.keys().next().value || null;
  return {
    id: room.id,
    seq: room.seq,
    hostId: room.hostId,
    queue: room.queue,
    members: [...room.members.values()],
    events: room.events.filter((event) => event.seq > since),
    currentSet: room.currentSet,
  };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/rooms/') && req.method === 'OPTIONS') return sendRoomJson(res, 204, {});
    if (url.pathname === '/api/room-config') {
      return sendJson(res, 200, { apiBase: process.env.ROOMS_API_URL || '' });
    }
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([a-z0-9-]{2,32})(?:\/events)?$/i);
    if (roomMatch && req.method === 'GET') {
      return sendRoomJson(res, 200, roomSnapshot(getRoom(roomMatch[1].toLowerCase()), +(url.searchParams.get('since') || 0)));
    }
    if (roomMatch && req.method === 'POST') {
      const room = getRoom(roomMatch[1].toLowerCase());
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const clientId = clean(body.clientId, 64);
      if (!clientId) return sendRoomJson(res, 400, { error: 'client_id_required' });
      const clientSecret = String(body.clientSecret || '');
      let sessionToken = room.tokens.get(clientId);
      const expectedSecret = room.secrets.get(clientId);
      if (expectedSecret && !validSecret(clientSecret, expectedSecret)) return sendRoomJson(res, 401, { error: 'invalid_client_secret' });
      if (sessionToken && body.token !== sessionToken) return sendRoomJson(res, 401, { error: 'invalid_room_token' });
      if (!sessionToken) {
        if (!/^[a-f0-9]{64}$/i.test(clientSecret)) return sendRoomJson(res, 400, { error: 'client_secret_required' });
        sessionToken = randomBytes(24).toString('base64url');
        room.tokens.set(clientId, sessionToken);
        room.secrets.set(clientId, secretHash(clientSecret).toString('hex'));
      }
      const existing = room.members.get(clientId);
      const user = {
        id: clientId,
        name: clean(body.user?.name || 'Listener', 28),
        avatar: {
          shape: clean(body.user?.avatar?.shape || body.user?.shape || 'block', 12),
          color: clean(body.user?.avatar?.color || body.user?.color || 'lime', 12),
          gear: clean(body.user?.avatar?.gear || body.user?.gear || 'none', 12),
        },
        joinedAt: existing?.joinedAt || (Number.isFinite(+body.user?.joinedAt) ? +body.user.joinedAt : Date.now()),
        seen: Date.now(),
      };
      room.members.set(clientId, user);
      if (!room.hostId) room.hostId = clientId;
      if (body.type !== 'presence') {
        const type = ['chat', 'reaction', 'set', 'deck'].includes(body.type) ? body.type : null;
        if (!type) return sendRoomJson(res, 400, { error: 'invalid_event' });
        let payload = body.payload || {};
        if (type === 'chat') payload = { text: clean(payload.text, 280) };
        if (type === 'reaction') payload = { value: clean(payload.value, 24) };
        if (type === 'set') {
          if (room.hostId !== clientId) return sendRoomJson(res, 403, { error: 'host_only' });
          const raw = JSON.stringify(payload);
          if (raw.length > 450000) return sendRoomJson(res, 413, { error: 'set_too_large' });
          payload = normalizeSet(payload);
          if (!payload) return sendRoomJson(res, 400, { error: 'invalid_set' });
          payload.by = clientId;
          payload.version = ++room.setVersion;
          room.currentSet = payload;
        }
        if (type === 'deck') {
          const action = clean(payload.action, 12);
          if (action === 'join' && clientId !== room.hostId && !room.queue.includes(clientId)) room.queue.push(clientId);
          if (action === 'leave') room.queue = room.queue.filter((id) => id !== clientId);
          if (action === 'pass' && clientId === room.hostId) {
            const next = room.queue.shift();
            if (next && room.members.has(next)) room.hostId = next;
          }
          payload = { action, hostId: room.hostId, queue: room.queue };
        }
        const event = { id: clean(body.id, 80) || `${clientId}-${Date.now()}`, seq: ++room.seq, type, user, payload, at: Date.now() };
        room.events.push(event);
        room.events = room.events.slice(-120);
      }
      return sendRoomJson(res, 200, { ...roomSnapshot(room, +(body.since || 0)), sessionToken });
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
}).listen(PORT, () => console.log(`UNTERGRUND on http://localhost:${PORT}${MOCK ? ' (mock SoundCloud)' : ''}`));
