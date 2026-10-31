import { STYLES, sanitize } from '../../js/state.js';

const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const META = 'untergrund:crate:meta', STATES = 'untergrund:crate:states', LIMIT = 500;
export const MAX_TRACK_BYTES = 200_000;

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
    state,
  };
}

const redisEnv = () => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
};

async function redis(command) {
  const { url, token } = redisEnv();
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `redis ${res.status}`);
  return json.result;
}

export const redisStore = () => (redisEnv() ? {
  async list(n = 60) { return (await redis(['LRANGE', META, 0, n - 1])).map((s) => JSON.parse(s)); },
  async get(id) { const s = await redis(['HGET', STATES, id]); return s ? JSON.parse(s) : null; },
  async add({ state, ...meta }) {
    await redis(['HSET', STATES, meta.id, JSON.stringify({ ...meta, state })]);
    await redis(['LPUSH', META, JSON.stringify(meta)]);
    await redis(['LTRIM', META, 0, LIMIT - 1]);
  },
} : null);

export function memoryStore() {
  const tracks = [];
  return {
    async list(n = 60) { return tracks.slice(0, n).map(({ state, ...meta }) => meta); },
    async get(id) { return tracks.find((t) => t.id === id) || null; },
    async add(track) { tracks.unshift(track); tracks.length = Math.min(tracks.length, LIMIT); },
  };
}

export async function handleCrate(method, body, store, id = '') {
  if (!store) return { status: 503, json: { enabled: false, tracks: [] } };
  if (method === 'GET' && id) {
    const track = await store.get(clean(id, 40));
    return track ? { status: 200, json: { track } } : { status: 404, json: { error: 'not_found' } };
  }
  if (method === 'GET') return { status: 200, json: { enabled: true, tracks: await store.list() } };
  if (method === 'POST') {
    if (JSON.stringify(body || {}).length > MAX_TRACK_BYTES) return { status: 413, json: { error: 'too_large' } };
    const track = normalizeTrack(body);
    if (!track) return { status: 400, json: { error: 'invalid_track' } };
    await store.add(track);
    const { state, ...meta } = track;
    return { status: 201, json: { track: meta } };
  }
  return { status: 405, json: { error: 'method_not_allowed' } };
}
