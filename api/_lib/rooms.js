// Club room service: presence, chat, reactions, DJ queue and the current native set.
// Memory is the source of truth (one process); an optional store keeps rooms across restarts.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { STYLES, sanitize } from '../../js/state.js';
import { redisEnv, redis } from './crate.js';
import { normalizeTimeline } from '../../js/set-timeline.js';

export const ROOM_ID = /^[a-z0-9-]{2,32}$/;
export const MAX_ROOM_BODY = 480000;
const MAX_SET = 450000, MAX_EVENTS = 120, PRESENCE_MS = 15000, ROOM_TTL_S = 7 * 864e2;
const EVENT_TYPES = ['chat', 'reaction', 'set', 'deck'];

const clean = (value, max = 80) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const secretHash = (value) => createHash('sha256').update(String(value || '')).digest();
const validSecret = (secret, expected) => {
  if (!/^[a-f0-9]{64}$/i.test(String(secret || '')) || !expected) return false;
  return timingSafeEqual(secretHash(secret), Buffer.from(expected, 'hex'));
};
const emptyRoom = (id) => ({ id, seq: 0, setVersion: 0, hostId: null, queue: [], members: new Map(), tokens: new Map(), secrets: new Map(), events: [], currentSet: null });

export const serializeRoom = (room) => JSON.stringify({ ...room, members: [...room.members], tokens: [...room.tokens], secrets: [...room.secrets] });
export function deserializeRoom(id, raw) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || data.id !== id) return null;
    return { ...emptyRoom(id), ...data, members: new Map(data.members || []), tokens: new Map(data.tokens || []), secrets: new Map(data.secrets || []), events: (data.events || []).slice(-MAX_EVENTS) };
  } catch { return null; }
}

export function normalizeSet(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'object' || !payload.state || !Array.isArray(payload.state.patterns)) return null;
  const state = sanitize(payload.state);
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
    broadcastId: clean(payload.broadcastId, 120),
    orderAt: Number.isFinite(+payload.orderAt) ? +payload.orderAt : now,
    ...(payload.replay && { replay: normalizeReplay(payload.replay) }),
  };
}

// "Replay this set to the room": a jukebox set id (fetched by listeners) or, for local-only sets, the timeline inline.
function normalizeReplay(r) {
  const id = /^[a-z0-9-]{1,40}$/.test(String(r?.id || '')) ? String(r.id) : '';
  const timeline = !id && r?.timeline ? normalizeTimeline(r.timeline) : null;
  return id || timeline ? { ...(id && { id }), ...(timeline && { timeline }), title: clean(r.title, 80), dj: clean(r.dj, 28) } : undefined;
}

function snapshot(room, since = 0, now = Date.now()) {
  const cutoff = now - PRESENCE_MS;
  for (const [id, member] of room.members) if (member.seen < cutoff) room.members.delete(id);
  room.queue = room.queue.filter((id) => room.members.has(id) && id !== room.hostId);
  if (room.hostId && !room.members.has(room.hostId)) room.hostId = room.queue.shift() || room.members.keys().next().value || null;
  return { id: room.id, seq: room.seq, hostId: room.hostId, queue: room.queue, members: [...room.members.values()], events: room.events.filter((event) => event.seq > since), currentSet: room.currentSet };
}

// Upstash/Vercel KV (KV_REST_API_URL + KV_REST_API_TOKEN) persistence; null when not configured.
export const redisRooms = () => (redisEnv() ? {
  kind: 'redis',
  async load(id) { return redis(['GET', `untergrund:room:${id}`]); },
  async save(id, raw) { await redis(['SET', `untergrund:room:${id}`, raw, 'EX', ROOM_TTL_S]); },
} : null);

export function memoryRoomStore() {
  const data = new Map();
  return { kind: 'memory', data, async load(id) { return data.get(id) || null; }, async save(id, raw) { data.set(id, raw); } };
}

export function createRooms({ store = null, saveDelay = 250, now = Date.now } = {}) {
  const rooms = new Map(), loading = new Map(), dirty = new Set();
  let timer = null;

  async function getRoom(id) {
    if (rooms.has(id)) return rooms.get(id);
    if (!store) { rooms.set(id, emptyRoom(id)); return rooms.get(id); }
    if (!loading.has(id)) {
      loading.set(id, (async () => {
        let room = null;
        try { room = deserializeRoom(id, await store.load(id)); } catch (err) { console.error('room load failed', id, err.message); }
        if (!rooms.has(id)) rooms.set(id, room || emptyRoom(id));
        loading.delete(id);
        return rooms.get(id);
      })());
    }
    return loading.get(id);
  }

  async function flush() {
    clearTimeout(timer); timer = null;
    const ids = [...dirty]; dirty.clear();
    await Promise.all(ids.map(async (id) => {
      try { await store.save(id, serializeRoom(rooms.get(id))); } catch (err) { console.error('room save failed', id, err.message); }
    }));
  }
  const markDirty = (id) => {
    if (!store) return;
    dirty.add(id);
    if (!timer) timer = setTimeout(flush, saveDelay);
  };

  async function get(id, since = 0) {
    return { status: 200, json: snapshot(await getRoom(id), since, now()) };
  }

  async function post(id, body) {
    if (!body || typeof body !== 'object') return { status: 400, json: { error: 'invalid_body' } };
    const room = await getRoom(id);
    const clientId = clean(body.clientId, 64);
    if (!clientId) return { status: 400, json: { error: 'client_id_required' } };
    const clientSecret = String(body.clientSecret || '');
    let sessionToken = room.tokens.get(clientId);
    const expectedSecret = room.secrets.get(clientId);
    if (expectedSecret && !validSecret(clientSecret, expectedSecret)) return { status: 401, json: { error: 'invalid_client_secret' } };
    if (sessionToken && body.token !== sessionToken) return { status: 401, json: { error: 'invalid_room_token' } };
    let changed = false;
    if (!sessionToken) {
      if (!/^[a-f0-9]{64}$/i.test(clientSecret)) return { status: 400, json: { error: 'client_secret_required' } };
      sessionToken = randomBytes(24).toString('base64url');
      room.tokens.set(clientId, sessionToken);
      room.secrets.set(clientId, secretHash(clientSecret).toString('hex'));
      changed = true;
    }
    const at = now();
    const existing = room.members.get(clientId);
    const user = {
      id: clientId,
      name: clean(body.user?.name || 'Listener', 28),
      avatar: {
        shape: clean(body.user?.avatar?.shape || body.user?.shape || 'block', 12),
        color: clean(body.user?.avatar?.color || body.user?.color || 'lime', 12),
        gear: clean(body.user?.avatar?.gear || body.user?.gear || 'none', 12),
      },
      joinedAt: existing?.joinedAt || (Number.isFinite(+body.user?.joinedAt) ? +body.user.joinedAt : at),
      seen: at,
    };
    room.members.set(clientId, user);
    if (!room.hostId) { room.hostId = clientId; changed = true; }
    if (body.type !== 'presence') {
      const type = EVENT_TYPES.includes(body.type) ? body.type : null;
      if (!type) return { status: 400, json: { error: 'invalid_event' } };
      let payload = body.payload || {};
      if (type === 'chat') payload = { text: clean(payload.text, 280) };
      if (type === 'reaction') payload = { value: clean(payload.value, 24) };
      if (type === 'set') {
        if (room.hostId !== clientId) return { status: 403, json: { error: 'host_only' } };
        if (JSON.stringify(payload).length > MAX_SET) return { status: 413, json: { error: 'set_too_large' } };
        payload = normalizeSet(payload, at);
        if (!payload) return { status: 400, json: { error: 'invalid_set' } };
        payload.by = clientId;
        payload.version = ++room.setVersion;
        room.currentSet = payload;
      }
      if (type === 'deck') {
        const action = clean(payload.action, 12);
        if (action === 'join' && clientId !== room.hostId && !room.queue.includes(clientId)) room.queue.push(clientId);
        if (action === 'leave') room.queue = room.queue.filter((qid) => qid !== clientId);
        if (action === 'pass' && clientId === room.hostId) {
          const next = room.queue.shift();
          if (next && room.members.has(next)) room.hostId = next;
        }
        payload = { action, hostId: room.hostId, queue: room.queue };
      }
      room.events.push({ id: clean(body.id, 80) || `${clientId}-${at}`, seq: ++room.seq, type, user, payload, at });
      room.events = room.events.slice(-MAX_EVENTS);
      changed = true;
    }
    if (changed) markDirty(id);
    return { status: 200, json: { ...snapshot(room, +(body.since || 0), at), sessionToken } };
  }

  return { get, post, flush, size: () => rooms.size, persistent: Boolean(store) };
}

// CORS: ROOMS_ALLOWED_ORIGIN is "*" (default) or a comma-separated list of exact origins.
export function corsHeaders(origin, allowed = '*') {
  const list = String(allowed || '*').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  const allow = list.includes('*') ? '*' : (list.includes(origin) ? origin : list[0]);
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Max-Age': '600', ...(allow === '*' ? {} : { Vary: 'Origin' }) };
}

const readJson = (req, max) => new Promise((ok, fail) => {
  const chunks = []; let size = 0;
  req.on('data', (d) => { size += d.length; if (size > max) { ok(undefined); req.destroy(); } else chunks.push(d); });
  req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { ok(null); } });
  req.on('error', fail);
});

// Node http handler for /api/rooms/:room[/events]; returns false when the path is not a room route.
export function roomsHandler(rooms, { allowedOrigin = '*' } = {}) {
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/api/rooms/')) return false;
    const send = (status, json) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(req.headers.origin, allowedOrigin) });
      res.end(status === 204 ? '' : JSON.stringify(json));
      return true;
    };
    if (req.method === 'OPTIONS') return send(204, {});
    const match = url.pathname.match(/^\/api\/rooms\/([a-z0-9-]{2,32})(?:\/events)?$/i);
    if (!match) return send(404, { error: 'not_found' });
    const id = match[1].toLowerCase();
    if (req.method === 'GET') { const r = await rooms.get(id, +(url.searchParams.get('since') || 0)); return send(r.status, r.json); }
    if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' });
    if (+(req.headers['content-length'] || 0) > MAX_ROOM_BODY) { req.resume(); return send(413, { error: 'too_large' }); }
    const body = await readJson(req, MAX_ROOM_BODY);
    if (body === undefined) return send(413, { error: 'too_large' });
    const r = await rooms.post(id, body);
    return send(r.status, r.json);
  };
}
