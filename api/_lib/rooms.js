// Club room service: presence, chat, reactions, DJ queue and the current native set.
// Memory is the source of truth (one process); an optional store keeps rooms across restarts.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { STYLES, sanitize } from '../../js/state.js';
import { memoryKv, redisKv, sha1 } from './kv.js';
import { normalizeTimeline } from '../../js/set-timeline.js';
import { jamAction, jammable, reconcileJam } from '../../js/jam.js';

export const ROOM_ID = /^[a-z0-9-]{2,32}$/;
export const MAX_ROOM_BODY = 480000;
const MAX_SET = 450000, MAX_EVENTS = 120, PRESENCE_MS = 15000, ROOM_TTL_S = 7 * 864e2;
const EVENT_TYPES = ['chat', 'reaction', 'set', 'deck', 'jam'];

const clean = (value, max = 80) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const secretHash = (value) => createHash('sha256').update(String(value || '')).digest();
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
    public: payload.public !== false,
    ...(payload.replay && { replay: normalizeReplay(payload.replay) }),
  };
}

// "Replay this set to the room": a jukebox set id (fetched by listeners) or, for local-only sets, the timeline inline.
function normalizeReplay(r) {
  const id = /^[a-z0-9-]{1,40}$/.test(String(r?.id || '')) ? String(r.id) : '';
  const timeline = !id && r?.timeline ? normalizeTimeline(r.timeline) : null;
  return id || timeline ? { ...(id && { id }), ...(timeline && { timeline }), title: clean(r.title, 80), dj: clean(r.dj, 28) } : undefined;
}

// ---- Storage: stateless and concurrency-safe, so any number of Vercel instances can serve one room. ----
// untergrund:room:<id>        hash  rev, seq, idx, exp, core (host/queue/set card/jam meta JSON), m:<clientId> (member JSON)
// untergrund:room:<id>:auth   hash  <clientId> -> "<sha256(secret)> <sessionToken>" (HSETNX: first claim wins)
// untergrund:room:<id>:events list  last MAX_EVENTS event JSONs (seq from HINCRBY, appended inside one script)
// untergrund:room:<id>:set    string current native set JSON (only fetched when the client's version is stale)
// untergrund:room:<id>:jam    hash  part -> layer JSON
// untergrund:rooms:live       zset  room id scored by last activity (the public directory index; no key scans)
// Members are fields written independently, so heartbeats never race; host/queue/set/jam changes go through the COMMIT
// script, which compare-and-sets `rev` and appends the event atomically. Losers re-read and retry.
const keys = (id) => { const p = `untergrund:room:${id}`; return { live: p, auth: `${p}:auth`, events: `${p}:events`, set: `${p}:set`, jam: `${p}:jam` }; };
const INDEX = 'untergrund:rooms:live';
const BEAT_WRITE_MS = 6000, INDEX_MS = 60000, EXPIRE_MS = 864e5, DROP_MS = 120000, DIRECTORY_MAX = 24;

export const COMMIT = `local rev = tonumber(redis.call('HGET', KEYS[1], 'rev') or '0')
if ARGV[1] ~= '' and rev ~= tonumber(ARGV[1]) then return {0, rev, 0} end
if ARGV[2] ~= '' then rev = rev + 1; redis.call('HSET', KEYS[1], 'rev', rev, 'core', ARGV[2]) end
local seq = 0
if ARGV[3] ~= '' then
  seq = redis.call('HINCRBY', KEYS[1], 'seq', 1)
  redis.call('RPUSH', KEYS[2], '{"seq":' .. seq .. ',' .. string.sub(ARGV[3], 2))
  redis.call('LTRIM', KEYS[2], -tonumber(ARGV[11]), -1)
  redis.call('EXPIRE', KEYS[2], ARGV[10])
end
if ARGV[4] ~= '' then
  redis.call('SET', KEYS[3], ARGV[4], 'EX', ARGV[10])
  redis.call('ZADD', KEYS[5], ARGV[9], ARGV[8])
  redis.call('HSET', KEYS[1], 'idx', ARGV[9])
end
if ARGV[5] == 'clear' then redis.call('DEL', KEYS[4]) end
if ARGV[5] == 'part' then redis.call('HSET', KEYS[4], ARGV[6], ARGV[7]); redis.call('EXPIRE', KEYS[4], ARGV[10]) end
redis.call('EXPIRE', KEYS[1], ARGV[10])
return {1, rev, seq}`;

// The same script in JS for the in-memory KV (local server, tests); `call` runs one command synchronously.
const commitTwin = (call, K, A) => {
  const rev0 = +(call('HGET', K[0], 'rev') || 0);
  if (A[0] !== '' && rev0 !== +A[0]) return [0, rev0, 0];
  let rev = rev0, seq = 0;
  if (A[1] !== '') { rev++; call('HSET', K[0], 'rev', rev, 'core', A[1]); }
  if (A[2] !== '') {
    seq = call('HINCRBY', K[0], 'seq', 1);
    call('RPUSH', K[1], `{"seq":${seq},${A[2].slice(1)}`);
    call('LTRIM', K[1], -+A[10], -1);
    call('EXPIRE', K[1], A[9]);
  }
  if (A[3] !== '') { call('SET', K[2], A[3], 'EX', A[9]); call('ZADD', K[4], A[8], A[7]); call('HSET', K[0], 'idx', A[8]); }
  if (A[4] === 'clear') call('DEL', K[3]);
  if (A[4] === 'part') { call('HSET', K[3], A[5], A[6]); call('EXPIRE', K[3], A[9]); }
  call('EXPIRE', K[0], A[9]);
  return [1, rev, seq];
};

export const roomsKv = () => redisKv();
export const memoryRoomsKv = (opts = {}) => memoryKv({ ...opts, scripts: { [COMMIT]: commitTwin } });
const COMMIT_SHA = sha1(COMMIT);

const emptyCore = () => ({ hostId: null, queue: [], setVersion: 0, card: null, jam: null });
const parseJson = (raw, fallback = null) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
const hashObject = (flat) => {
  if (!flat) return {};
  if (!Array.isArray(flat)) return flat;
  const out = {};
  for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
  return out;
};
function parseLive(flat) {
  const h = hashObject(flat), members = [];
  for (const [f, v] of Object.entries(h)) if (f.startsWith('m:')) { const m = parseJson(v); if (m?.id) members.push(m); }
  return { rev: +h.rev || 0, seq: +h.seq || 0, idx: +h.idx || 0, exp: +h.exp || 0, core: { ...emptyCore(), ...parseJson(h.core, {}) }, members };
}
const stripJam = (jam) => jam && ({ ...jam, parts: Object.fromEntries(Object.entries(jam.parts).map(([p, s]) => [p, { owner: s.owner, step: s.step, rev: s.rev }])) });

// Derived view: drops stale members, hands the decks on when the host leaves, frees jam parts. Pure, so every
// instance computes the same answer from the same stored state.
function reconcile(live, t, poster = '') {
  const present = live.members.filter((m) => m.seen >= t - PRESENCE_MS).sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
  const ids = new Map(present.map((m) => [m.id, m]));
  const core = structuredClone(live.core);
  core.queue = core.queue.filter((id) => ids.has(id) && id !== core.hostId);
  if (core.hostId && !ids.has(core.hostId)) core.hostId = core.queue.shift() || present[0]?.id || null;
  if (!core.hostId && poster && ids.has(poster)) core.hostId = poster;
  const before = core.jam?.setVersion;
  core.jam = stripJam(reconcileJam(core.jam, { setVersion: core.setVersion, members: ids }));
  return { core, present, ids, clearLayers: Boolean(live.core.jam) && before !== core.setVersion };
}

const sameProfile = (a, b) => a && a.name === b.name && JSON.stringify(a.avatar) === JSON.stringify(b.avatar) && a.joinedAt === b.joinedAt;
const slimSet = (set) => { const { state, ...rest } = set; return rest.replay?.timeline ? { ...rest, replay: { ...rest.replay, timeline: undefined } } : rest; };
const roomCard = (set) => ({ title: set.title, artist: set.artist, style: set.style, bpm: set.bpm, key: set.key, startsAt: set.startsAt, at: set.orderAt || set.startsAt, version: set.version, public: set.public !== false, replay: Boolean(set.replay), jammable: jammable(set), by: set.by });

export function createRooms({ kv = memoryRoomsKv(), now = Date.now } = {}) {
  const tokens = new Map();
  let dir = null;

  async function script(prefix, K, A) {
    const args = (op, ref) => [op, ref, K.length, ...K, ...A.map(String)];
    let out = await kv.pipe([...prefix, args('EVALSHA', COMMIT_SHA)]);
    if (out.at(-1) instanceof Error && /NOSCRIPT/i.test(out.at(-1).message)) out = [...out.slice(0, -1), await kv.cmd(args('EVAL', COMMIT))];
    for (const r of out) if (r instanceof Error) throw r;
    return out.at(-1);
  }
  const commitArgs = (id, k, t, { rev = '', core = '', event = '', set = '', jam = '', part = '', layer = '' }) =>
    [[k.live, k.events, k.set, k.jam, INDEX], [rev, core, event, set, jam, part, layer, id, t, ROOM_TTL_S, MAX_EVENTS]];

  // Read-side: events after `since`, plus the set/jam bodies only when the caller's copy is stale.
  async function view(id, k, live, t, { since = 0, knownSet, knownJam, poster = '' } = {}) {
    const { core, present } = reconcile(live, t, poster);
    since = Math.max(0, +since || 0);
    const wantSet = core.setVersion && String(knownSet) !== String(core.setVersion);
    const wantJam = core.jam && String(knownJam) !== String(core.jam.rev);
    const behind = Math.min(MAX_EVENTS, live.seq - since);
    const span = (n) => ['LRANGE', k.events, -n, -1];
    const n = behind > 0 ? Math.min(MAX_EVENTS, behind + 8) : 0;
    const want = [...(n ? [span(n)] : []), ...(wantSet ? [['GET', k.set]] : []), ...(wantJam ? [['HGETALL', k.jam]] : [])];
    const out = want.length ? await kv.pipe(want) : [];
    for (const r of out) if (r instanceof Error) throw r;
    let events = n ? (out.shift() || []).map((e) => parseJson(e)).filter(Boolean) : [];
    // Events appended between the two reads can push older ones out of the window; widen once if there is a gap.
    if (events.length === n && n < MAX_EVENTS && events[0]?.seq > since + 1) events = ((await kv.cmd(span(MAX_EVENTS))) || []).map((e) => parseJson(e)).filter(Boolean);
    events = events.filter((e) => e.seq > since);
    const set = wantSet ? parseJson(out.shift()) : null;
    let jam;
    if (wantJam) {
      const layers = hashObject(out.shift());
      jam = { ...core.jam, parts: Object.fromEntries(Object.entries(core.jam.parts).map(([p, s]) => [p, { ...s, layer: parseJson(layers[p]) }])) };
    }
    const seq = Math.max(live.seq, events.at(-1)?.seq || 0);
    return { id, seq, rev: live.rev, hostId: core.hostId, queue: core.queue, members: present, events, ...(set && { currentSet: set }), ...(jam && { jam }) };
  }

  async function read(k) { return parseLive(await kv.cmd(['HGETALL', k.live])); }

  async function get(id, since = 0, known = {}) {
    const k = keys(id), t = now();
    return { status: 200, json: await view(id, k, await read(k), t, { since, ...known }) };
  }

  async function authorize(id, k, clientId, body, storedRaw) {
    const secret = String(body.clientSecret || '');
    const hash = /^[a-f0-9]{64}$/i.test(secret) ? secretHash(secret).toString('hex') : '';
    let stored = storedRaw;
    if (!stored) {
      if (!hash) return { status: 400, error: 'client_secret_required' };
      const token = randomBytes(24).toString('base64url');
      const [won] = await kv.pipe([['HSETNX', k.auth, clientId, `${hash} ${token}`], ['EXPIRE', k.auth, ROOM_TTL_S]]);
      if (won === 1) return { token, stored: `${hash} ${token}` };
      stored = await kv.cmd(['HGET', k.auth, clientId]);
    }
    const [expected, token] = String(stored).split(' ');
    if (!hash || !timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'))) return { status: 401, error: 'invalid_client_secret' };
    if (body.token !== token) return { status: 401, error: 'invalid_room_token' };
    return { token, stored };
  }

  async function post(id, body) {
    if (!body || typeof body !== 'object') return { status: 400, json: { error: 'invalid_body' } };
    const clientId = clean(body.clientId, 64);
    if (!clientId) return { status: 400, json: { error: 'client_id_required' } };
    const type = body.type === 'presence' ? 'presence' : (EVENT_TYPES.includes(body.type) ? body.type : null);
    const k = keys(id), t = now(), ck = `${id}\n${clientId}`;
    const cached = tokens.get(ck);
    const first = await kv.pipe([...(cached ? [] : [['HGET', k.auth, clientId]]), ['HGETALL', k.live]]);
    for (const r of first) if (r instanceof Error) throw r;
    const auth = await authorize(id, k, clientId, body, cached || first[0]);
    if (auth.error) return { status: auth.status, json: { error: auth.error } };
    if (!cached) { if (tokens.size > 5000) tokens.clear(); tokens.set(ck, auth.stored); }
    const sessionToken = auth.token;
    if (!type) return { status: 400, json: { error: 'invalid_event' } };
    let live = parseLive(first.at(-1));
    const existing = live.members.find((m) => m.id === clientId);
    const user = {
      id: clientId,
      name: clean(body.user?.name || existing?.name || 'Listener', 28),
      avatar: {
        shape: clean(body.user?.avatar?.shape || body.user?.shape || existing?.avatar?.shape || 'block', 12),
        color: clean(body.user?.avatar?.color || body.user?.color || existing?.avatar?.color || 'lime', 12),
        gear: clean(body.user?.avatar?.gear || body.user?.gear || existing?.avatar?.gear || 'none', 12),
      },
      joinedAt: existing?.joinedAt || (Number.isFinite(+body.user?.joinedAt) ? +body.user.joinedAt : t),
      seen: t,
    };
    // Presence only writes when the member is new, changed, or its `seen` is getting old (heartbeats are every 4 s).
    const writeMember = !existing || !sameProfile(existing, user) || t - existing.seen >= BEAT_WRITE_MS || type !== 'presence';
    const memberCmds = () => {
      if (!writeMember) return [];
      const cmds = [['HSET', k.live, `m:${clientId}`, JSON.stringify(user)]];
      const gone = live.members.filter((m) => m.seen < t - DROP_MS).map((m) => `m:${m.id}`);
      if (gone.length) cmds.push(['HDEL', k.live, ...gone]);
      if (live.core.card && t - live.idx >= INDEX_MS) cmds.push(['ZADD', INDEX, t, id], ['HSET', k.live, 'idx', t]);
      if (t - live.exp >= EXPIRE_MS) cmds.push(['HSET', k.live, 'exp', t], ...[k.live, k.auth, k.events, k.set, k.jam].map((key) => ['EXPIRE', key, ROOM_TTL_S]));
      return cmds;
    };
    const withMe = (l) => ({ ...l, members: [...l.members.filter((m) => m.id !== clientId), user] });
    const known = { since: body.since, knownSet: body.knownSet, knownJam: body.knownJam, poster: clientId };
    const reply = async (status, extra = {}) => ({ status, json: { ...extra, ...(await view(id, k, withMe(await read(k)), t, known)), sessionToken } });

    if (type === 'presence') {
      const { core, clearLayers } = reconcile(withMe(live), t, clientId);
      if (JSON.stringify(core) !== JSON.stringify(live.core)) {
        const [K, A] = commitArgs(id, k, t, { rev: live.rev, core: JSON.stringify(core), jam: clearLayers ? 'clear' : '' });
        await script(memberCmds(), K, A);
        return reply(200);
      }
      const cmds = memberCmds();
      if (cmds.length) { const out = await kv.pipe(cmds); for (const r of out) if (r instanceof Error) throw r; }
      return { status: 200, json: { ...(await view(id, k, withMe(live), t, known)), sessionToken } };
    }

    let payload = body.payload || {};
    const event = (p) => JSON.stringify({ id: clean(body.id, 80) || `${clientId}-${t}`, type, user, payload: p, at: t });
    if (type === 'chat' || type === 'reaction') {
      payload = type === 'chat' ? { text: clean(payload.text, 280) } : { value: clean(payload.value, 24) };
      const [K, A] = commitArgs(id, k, t, { event: event(payload) });
      await script(memberCmds(), K, A);
      return reply(200);
    }
    let set0 = null;

    // Host/queue/set/jam: compute against a consistent read, then compare-and-set; retry from a fresh read on conflict.
    let first2 = true;
    for (let attempt = 0; attempt < 12; attempt++) {
      if (attempt) { await new Promise((ok) => setTimeout(ok, Math.random() * 15 * attempt)); live = await read(k); }
      const { core, clearLayers } = reconcile(withMe(live), t, clientId);
      const opts = { rev: live.rev };
      if (type === 'set') {
        if (core.hostId !== clientId) return reply(403, { error: 'host_only' });
        if (!set0 && JSON.stringify(payload).length > MAX_SET) return reply(413, { error: 'set_too_large' });
        set0 ||= normalizeSet(payload, t);
        if (!set0) return reply(400, { error: 'invalid_set' });
        const set = { ...set0, by: clientId, version: core.setVersion + 1 };
        core.setVersion = set.version;
        core.card = roomCard(set);
        core.jam = stripJam(reconcileJam(core.jam, { setVersion: core.setVersion }));
        Object.assign(opts, { set: JSON.stringify(set), jam: 'clear', event: event(slimSet(set)) });
      }
      if (type === 'deck') {
        const action = clean(payload.action, 12);
        if (action === 'join' && clientId !== core.hostId && !core.queue.includes(clientId)) core.queue.push(clientId);
        if (action === 'leave') core.queue = core.queue.filter((qid) => qid !== clientId);
        if (action === 'pass' && clientId === core.hostId) {
          const next = core.queue.shift();
          if (next && withMe(live).members.some((m) => m.id === next && m.seen >= t - PRESENCE_MS)) core.hostId = next;
        }
        opts.event = event({ action, hostId: core.hostId, queue: core.queue });
        if (clearLayers) opts.jam = 'clear';
      }
      if (type === 'jam') {
        const set = core.card ? { ...core.card, version: core.setVersion, replay: core.card.replay || undefined, state: core.card.jammable ? { patterns: [] } : undefined } : null;
        const result = jamAction(core.jam, { clientId, hostId: core.hostId, set, now: t }, payload);
        if (result.error) return reply(result.status, { error: result.error });
        const part = result.payload?.part;
        const layer = core.jam.parts[part]?.layer;
        if (layer && payload.action === 'play') Object.assign(opts, { jam: 'part', part, layer: JSON.stringify(layer) });
        else if (clearLayers) opts.jam = 'clear';
        core.jam = stripJam(core.jam);
        opts.event = event(result.payload);
      }
      opts.core = JSON.stringify(core);
      const [K, A] = commitArgs(id, k, t, opts);
      const [ok] = await script(first2 ? memberCmds() : [], K, A);
      first2 = false;
      if (+ok === 1) { dir = null; return reply(200); }
    }
    return { status: 409, json: { error: 'busy' } };
  }

  // Public live rooms: a set is playing, someone was seen within PRESENCE_MS, and the set is public.
  async function directory() {
    const t = now();
    if (dir && t - dir.at < 3000) return dir.json;
    const [, ids] = await kv.pipe([['ZREMRANGEBYSCORE', INDEX, '-inf', t - 3 * INDEX_MS], ['ZREVRANGEBYSCORE', INDEX, '+inf', t - 3 * INDEX_MS, 'LIMIT', 0, 64]]);
    const list = Array.isArray(ids) ? ids : [];
    const lives = list.length ? await kv.pipe(list.map((rid) => ['HGETALL', keys(rid).live])) : [];
    const rooms = [];
    list.forEach((rid, i) => {
      if (lives[i] instanceof Error) return;
      const live = parseLive(lives[i]), card = live.core.card;
      if (!card || card.public === false) return;
      const { core, present } = reconcile(live, t);
      if (!present.length) return;
      const dj = present.find((m) => m.id === core.hostId) || present.find((m) => m.id === card.by) || present[0];
      rooms.push({ id: rid, title: card.title, artist: card.artist, style: card.style, bpm: card.bpm, key: card.key, listeners: present.length, dj: { name: dj.name, shape: dj.avatar?.shape, color: dj.avatar?.color, gear: dj.avatar?.gear }, startsAt: card.startsAt, replay: Boolean(card.replay), at: card.at || 0 });
    });
    rooms.sort((a, b) => b.listeners - a.listeners || b.at - a.at);
    const json = { enabled: true, rooms: rooms.slice(0, DIRECTORY_MAX).map(({ at, ...r }) => r) };
    dir = { at: t, json };
    return json;
  }

  return { get, post, directory, flush: async () => {}, persistent: kv.kind === 'redis', kind: kv.kind, kv };
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

// Shared router for GET /api/rooms, GET /api/rooms/:room?since=&set=&jam=, POST /api/rooms/:room/events.
// `rooms` is null when no KV is configured (Vercel without Upstash): the directory says so, room routes 503.
export async function routeRooms(rooms, { method, path, query = {}, body }) {
  if (method === 'OPTIONS') return { status: 204, json: {} };
  if (/^\/api\/rooms\/?$/.test(path)) {
    if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
    if (!rooms) return { status: 200, json: { enabled: false, rooms: [] } };
    return { status: 200, json: await rooms.directory(), cache: 'public, max-age=5, stale-while-revalidate=10' };
  }
  const match = path.match(/^\/api\/rooms\/([a-z0-9-]{2,32})(?:\/events)?\/?$/i);
  if (!match) return { status: 404, json: { error: 'not_found' } };
  if (!rooms) return { status: 503, json: { error: 'rooms_unavailable' } };
  const id = match[1].toLowerCase();
  // Listeners polling the same room at the same seq share one CDN-cached reply for up to a second.
  if (method === 'GET') return { ...(await rooms.get(id, +(query.since || 0), { knownSet: query.set, knownJam: query.jam })), cache: 'public, max-age=0, s-maxage=1' };
  if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  if (body === undefined) return { status: 413, json: { error: 'too_large' } };
  return rooms.post(id, body);
}

// Node http handler (server.mjs, rooms-server.mjs); returns false when the path is not a room route.
export function roomsHandler(rooms, { allowedOrigin = '*' } = {}) {
  return async (req, res, url) => {
    if (!/^\/api\/rooms(\/|$)/.test(url.pathname)) return false;
    let body = null;
    if (req.method === 'POST') {
      if (+(req.headers['content-length'] || 0) > MAX_ROOM_BODY) { req.resume(); body = undefined; }
      else body = await readJson(req, MAX_ROOM_BODY);
    }
    let r;
    try { r = await routeRooms(rooms, { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body }); }
    catch (err) { console.error('rooms failed', err.message); r = { status: 503, json: { error: 'rooms_unavailable' } }; }
    res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': r.cache || 'no-store', ...corsHeaders(req.headers.origin, allowedOrigin) });
    res.end(r.status === 204 ? '' : JSON.stringify(r.json));
    return true;
  };
}
