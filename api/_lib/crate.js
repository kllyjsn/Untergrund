import { STYLES, sanitize } from '../../js/state.js';
import { isDropDate } from '../../js/daily.js';

export const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const META = 'untergrund:crate:meta', STATES = 'untergrund:crate:states', REMIXES = 'untergrund:crate:remixes', LIMIT = 500, RATE_PER_HOUR = 30;
export const MAX_TRACK_BYTES = 200_000;
// Remix tree + Daily Drop indexes. Remixes and drop entries keep their state outside the rolling crate so the tree survives eviction.
const PLAYS = 'untergrund:crate:plays', KEPT = 'untergrund:crate:kept', KEPT_IDS = 'untergrund:crate:kept-ids', KEPT_LIMIT = 5000, BRANCH_LIMIT = 200;
const dropKey = (date) => `untergrund:drop:${date}`, childKey = (id) => `untergrund:crate:children:${id}`;
const DROP_TTL = 120 * 86400, PLAY_DEDUPE_SECONDS = 86400;
const branched = (meta) => !!(meta.drop || meta.remixOf?.id);
const uniq = (list) => { const seen = new Set(); return list.filter((t) => t?.id && !seen.has(t.id) && seen.add(t.id)); };

export function normalizeTrack(body) {
  if (!body?.state || !Array.isArray(body.state.patterns)) return null;
  const state = sanitize(body.state);
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: clean(body.title, 80) || 'Untitled Signal',
    artist: clean(body.artist, 40) || 'UNTERGRUND',
    style: STYLES[body.style] ? body.style : 'hypnotic',
    bpm: state.bpm,
    key: state.key,
    scale: state.scale,
    created: new Date().toISOString(),
    ...(state.remixOf && { remixOf: state.remixOf }),
    ...(state.drop && { drop: state.drop }),
    state,
  };
}

export const redisEnv = () => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
};

export async function redis(command) {
  const { url, token } = redisEnv();
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `redis ${res.status}`);
  return json.result;
}

export const redisStore = () => (redisEnv() ? {
  async list(n = 60) { return (await redis(['LRANGE', META, 0, n - 1])).map((s) => JSON.parse(s)); },
  async get(id) { const s = await redis(['HGET', STATES, id]) || await redis(['HGET', KEPT, id]); return s ? JSON.parse(s) : null; },
  async add({ state, ...meta }) {
    await redis(['HSET', STATES, meta.id, JSON.stringify({ ...meta, state })]);
    if (branched(meta)) {
      await redis(['HSET', KEPT, meta.id, JSON.stringify({ ...meta, state })]);
      await redis(['LPUSH', KEPT_IDS, meta.id]);
      const old = await redis(['LRANGE', KEPT_IDS, KEPT_LIMIT, -1]);
      if (old.length) { await redis(['HDEL', KEPT, ...old]); await redis(['LTRIM', KEPT_IDS, 0, KEPT_LIMIT - 1]); }
    }
    if (meta.drop) {
      await redis(['LPUSH', dropKey(meta.drop), JSON.stringify(meta)]);
      await redis(['LTRIM', dropKey(meta.drop), 0, BRANCH_LIMIT - 1]);
      await redis(['EXPIRE', dropKey(meta.drop), DROP_TTL]);
    }
    if (meta.remixOf?.id) {
      await redis(['LPUSH', childKey(meta.remixOf.id), JSON.stringify(meta)]);
      await redis(['LTRIM', childKey(meta.remixOf.id), 0, BRANCH_LIMIT - 1]);
    }
    await redis(['LPUSH', META, JSON.stringify(meta)]);
    const evicted = (await redis(['LRANGE', META, LIMIT, -1])).map((s) => JSON.parse(s).id).filter(Boolean);
    if (evicted.length) await redis(['HDEL', STATES, ...evicted]);
    await redis(['LTRIM', META, 0, LIMIT - 1]);
  },
  async remixes(id) { return Number(await redis(['HGET', REMIXES, id])) || 0; },
  async countRemix(id) { return Number(await redis(['HINCRBY', REMIXES, id, 1])) || 0; },
  async has(id) { return !!(await redis(['HEXISTS', STATES, id]) || await redis(['HEXISTS', KEPT, id])); },
  async dropList(date) { return (await redis(['LRANGE', dropKey(date), 0, BRANCH_LIMIT - 1])).map((s) => JSON.parse(s)); },
  async children(id, n = BRANCH_LIMIT) { return (await redis(['LRANGE', childKey(id), 0, n - 1])).map((s) => JSON.parse(s)); },
  async counts(ids) {
    if (!ids.length) return [];
    const [plays, remixes] = [await redis(['HMGET', PLAYS, ...ids]), await redis(['HMGET', REMIXES, ...ids])];
    return ids.map((_, i) => ({ plays: Number(plays[i]) || 0, remixes: Number(remixes[i]) || 0 }));
  },
  async countPlay(id, client) {
    const fresh = await redis(['SET', `untergrund:crate:played:${id}:${client}`, '1', 'NX', 'EX', PLAY_DEDUPE_SECONDS]);
    return fresh ? Number(await redis(['HINCRBY', PLAYS, id, 1])) || 0 : Number(await redis(['HGET', PLAYS, id])) || 0;
  },
  async allow(client) {
    const key = `untergrund:crate:rate:${client}`;
    const count = await redis(['INCR', key]);
    if (count === 1) await redis(['EXPIRE', key, 3600]);
    return count <= RATE_PER_HOUR;
  },
} : null);

export function memoryStore() {
  const tracks = [], kept = new Map(), drops = new Map(), kids = new Map();
  const hits = new Map(), remixes = new Map(), plays = new Map(), played = new Map();
  const push = (map, key, meta) => { const l = map.get(key) || []; l.unshift(meta); l.length = Math.min(l.length, BRANCH_LIMIT); map.set(key, l); };
  return {
    async allow(client) {
      const now = Date.now(), fresh = (list) => list.filter((t) => now - t < 3600e3);
      if (hits.size > 1000) for (const [key, list] of hits) if (!fresh(list).length) hits.delete(key);
      const recent = fresh(hits.get(client) || []);
      recent.push(now); hits.set(client, recent);
      return recent.length <= RATE_PER_HOUR;
    },
    async list(n = 60) { return tracks.slice(0, n).map(({ state, ...meta }) => meta); },
    async get(id) { return tracks.find((t) => t.id === id) || kept.get(id) || null; },
    async add(track) {
      tracks.unshift(track); tracks.length = Math.min(tracks.length, LIMIT);
      const { state, ...meta } = track;
      if (branched(meta)) { kept.set(meta.id, track); if (kept.size > KEPT_LIMIT) kept.delete(kept.keys().next().value); }
      if (meta.drop) push(drops, meta.drop, meta);
      if (meta.remixOf?.id) push(kids, meta.remixOf.id, meta);
    },
    async remixes(id) { return remixes.get(id) || 0; },
    async countRemix(id) { remixes.set(id, (remixes.get(id) || 0) + 1); return remixes.get(id); },
    async has(id) { return !!(await this.get(id)); },
    async dropList(date) { return [...(drops.get(date) || [])]; },
    async children(id, n = BRANCH_LIMIT) { return (kids.get(id) || []).slice(0, n); },
    async counts(ids) { return ids.map((id) => ({ plays: plays.get(id) || 0, remixes: remixes.get(id) || 0 })); },
    async countPlay(id, client) {
      const key = `${id}:${client}`, now = Date.now();
      if (!(played.get(key) > now)) { played.set(key, now + PLAY_DEDUPE_SECONDS * 1000); plays.set(id, (plays.get(id) || 0) + 1); }
      return plays.get(id) || 0;
    },
  };
}

export async function handleCrate(method, body, store, id = '', client = 'anon') {
  if (!store) return { status: 503, json: { enabled: false, tracks: [] } };
  if (method === 'GET' && id) {
    const track = await store.get(clean(id, 40));
    if (!track) return { status: 404, json: { error: 'not_found' } };
    const [count] = await store.counts([track.id]);
    return { status: 200, json: { track: { ...track, remixes: count.remixes, plays: count.plays, children: await remixTree(store, track.id) } } };
  }
  if (method === 'GET') return { status: 200, json: { enabled: true, tracks: await store.list() } };
  if (method === 'POST') {
    if (JSON.stringify(body || {}).length > MAX_TRACK_BYTES) return { status: 413, json: { error: 'too_large' } };
    const track = normalizeTrack(body);
    if (!track) return { status: 400, json: { error: 'invalid_track' } };
    if (!(await store.allow(clean(client, 64) || 'anon'))) return { status: 429, json: { error: 'rate_limited' } };
    await store.add(track);
    const { state, ...meta } = track;
    return { status: 201, json: { track: meta } };
  }
  return { status: 405, json: { error: 'method_not_allowed' } };
}

// One count per fork of a shared track; the remixer's client is rate limited like publishing.
export async function handleRemix(method, id, store, client = 'anon') {
  if (!store) return { status: 503, json: { enabled: false } };
  if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  const track = id && await store.get(clean(id, 40));
  if (!track) return { status: 404, json: { error: 'not_found' } };
  if (!(await store.allow(`remix:${clean(client, 64) || 'anon'}`))) return { status: 429, json: { error: 'rate_limited' } };
  return { status: 200, json: { remixes: await store.countRemix(track.id) } };
}

// Remixes of a track, newest first, with their counters (for the public page and the shared landing).
export async function remixTree(store, id, n = 24) {
  const list = uniq(await store.children(id, n));
  const counts = await store.counts(list.map((t) => t.id));
  return list.map((t, i) => ({ ...t, ...counts[i] }));
}

// Today's (or any day's) Daily Drop remixes ranked by plays, with remixes of a remix weighing more.
export async function handleDrop(method, date, store) {
  if (!store) return { status: 503, json: { enabled: false, tracks: [] } };
  if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
  if (!isDropDate(date)) return { status: 400, json: { error: 'bad_date' } };
  const list = uniq(await store.dropList(date));
  const counts = await store.counts(list.map((t) => t.id));
  const ranked = list.map((t, i) => ({ ...t, ...counts[i], score: counts[i].plays + counts[i].remixes * 3 }))
    .sort((a, b) => b.score - a.score || String(b.created).localeCompare(String(a.created)));
  return { status: 200, json: { enabled: true, drop: date, total: ranked.length, tracks: ranked.slice(0, 20).map(({ score, ...t }) => t) } };
}

// One play per listener per track per day.
export async function handlePlay(method, id, store, client = 'anon') {
  if (!store) return { status: 503, json: { enabled: false } };
  if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  id = clean(id, 40);
  if (!/^[a-z0-9-]{3,40}$/.test(id) || !(await store.has(id))) return { status: 404, json: { error: 'not_found' } };
  return { status: 200, json: { plays: await store.countPlay(id, clean(client, 64) || 'anon') } };
}
