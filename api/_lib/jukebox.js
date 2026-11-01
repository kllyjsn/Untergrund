// Public jukebox: published songs (stored in the crate as replayable state) and recorded sets (audio in Vercel Blob).
import { STYLES } from '../../js/state.js';
import { redisEnv, redis, normalizeTrack, MAX_TRACK_BYTES } from './crate.js';

const KEY = 'untergrund:jukebox', LIMIT = 1000, RATE_PER_HOUR = 20;
const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
export const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/sets\/[A-Za-z0-9._-]+$/;

export function normalizeEntry(b) {
  const kind = b?.kind === 'set' || b?.kind === 'song' ? b.kind : null;
  if (!kind) return null;
  const base = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, kind,
    title: clean(b.title, 80) || 'Untitled Signal', artist: clean(b.artist, 40) || 'UNTERGRUND',
    style: STYLES[b.style] ? b.style : 'hypnotic', bpm: Math.round(num(b.bpm, 0, 220)), created: new Date().toISOString(),
  };
  if (kind === 'song') return base;
  const url = String(b.url || '');
  if (url.length > 400 || !BLOB_URL.test(url)) return null;
  const duration = num(b.duration, 1, 6 * 3600), start = num(b.start, 0, duration - 1), end = num(b.end || duration, start + 1, duration);
  const peaks = Array.isArray(b.peaks) ? b.peaks.slice(0, 400).map((p) => Math.round(num(p, 0, 1) * 100) / 100) : [];
  return { ...base, url, duration, start, end, peaks };
}

const rateKey = (client) => `untergrund:jukebox:rate:${client}`;
export const redisJukebox = () => (redisEnv() ? {
  async list(n = 200) { return (await redis(['LRANGE', KEY, 0, n - 1])).map((s) => JSON.parse(s)); },
  async add(entry) { await redis(['LPUSH', KEY, JSON.stringify(entry)]); await redis(['LTRIM', KEY, 0, LIMIT - 1]); },
  async allow(client) {
    const count = await redis(['INCR', rateKey(client)]);
    if (count === 1) await redis(['EXPIRE', rateKey(client), 3600]);
    return count <= RATE_PER_HOUR;
  },
} : null);

export function memoryJukebox() {
  const items = [], hits = new Map();
  return {
    async list(n = 200) { return items.slice(0, n); },
    async add(entry) { items.unshift(entry); items.length = Math.min(items.length, LIMIT); },
    async allow(client) {
      const now = Date.now(), recent = (hits.get(client) || []).filter((t) => now - t < 3600e3);
      recent.push(now); hits.set(client, recent);
      return recent.length <= RATE_PER_HOUR;
    },
  };
}

export async function handleJukebox(method, body, { store, crate, client = 'anon', uploads = false }) {
  if (!store) return { status: 503, json: { enabled: false, uploads: false, items: [] } };
  if (method === 'GET') return { status: 200, json: { enabled: true, uploads, items: await store.list() } };
  if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  if (JSON.stringify(body || {}).length > MAX_TRACK_BYTES) return { status: 413, json: { error: 'too_large' } };
  const entry = normalizeEntry(body);
  const track = entry?.kind === 'song' ? normalizeTrack(body) : null;
  if (!entry || (entry.kind === 'song' && (!track || !crate))) return { status: 400, json: { error: 'invalid_entry' } };
  if (!(await store.allow(clean(client, 64) || 'anon'))) return { status: 429, json: { error: 'rate_limited' } };
  if (track) { await crate.add(track); entry.trackId = track.id; entry.bpm = track.bpm; }
  await store.add(entry);
  return { status: 201, json: { item: entry } };
}
