import { createHash } from 'node:crypto';
import { handleError, publicArtistPage, publicTrack, trackMeta } from './accounts.js';
import { routeRooms } from './rooms.js';
import { openApi } from './public-openapi.js';

export const PUBLIC_API_LIMIT = 120;
const getPaths = { tracks: 'tracks', rooms: 'rooms', 'openapi.json': 'openapi' };
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After',
};

export function publicApiRoute(path) {
  const parts = path.replace(/\/$/, '').split('/');
  const [, api, version, resource, id] = parts;
  if (api !== 'api' || version !== 'v1') return null;
  if (parts.length === 4 && Object.hasOwn(getPaths, resource)) return { route: getPaths[resource] };
  if (parts.length === 5 && (resource === 'tracks' || resource === 'artists')) {
    try { return { route: resource === 'tracks' ? 'track' : 'artist', id: decodeURIComponent(id) }; } catch {}
  }
  return { route: 'missing' };
}

function reply(status, json, cache = 'no-store', headers = {}) {
  return { status, json, headers: { ...cors, 'Cache-Control': cache, ...headers } };
}
const error = (status, code, message, headers) => reply(status, { error: { code, message } }, 'no-store', headers);
const missing = () => error(404, 'not_found', 'The requested resource was not found.');
const unavailable = () => error(503, 'service_unavailable', 'The requested data is temporarily unavailable.');
const success = (data, seconds = 30) => reply(200, { data }, `public, max-age=${seconds}, s-maxage=${seconds}`);

async function quota(kv, ip, now) {
  const digest = createHash('sha256').update(ip || 'unknown').digest('hex');
  const key = `untergrund:public-api:v1:${Math.floor(now / 60000)}:${digest}`;
  const result = await kv.pipe([['INCR', key], ['EXPIRE', key, 120]]);
  if (!Number.isInteger(result?.[0]) || result[1] !== 1) throw new Error('quota_storage_unavailable');
  return result[0];
}

const publicTrackMeta = (track, site) => ({
  ...trackMeta(track),
  url: `${site}/t/${encodeURIComponent(track.id)}`,
  embedUrl: `${site}/embed.html?t=${encodeURIComponent(track.id)}`,
});

export async function handlePublicApi({ method, route, id, ip }, { kv, crate, rooms, rateKv, site, now = Date.now() }) {
  if (method === 'OPTIONS') return reply(204, null, 'no-store', { 'Access-Control-Max-Age': '600' });
  if (method !== 'GET') return error(405, 'method_not_allowed', 'Use GET for this read-only API.', { Allow: 'GET, OPTIONS' });
  if (route === 'openapi') return reply(200, openApi, 'public, max-age=300, s-maxage=3600');
  if (!['tracks', 'track', 'artist', 'rooms'].includes(route)) return missing();
  try {
    if (rateKv && await quota(rateKv, ip, now) > PUBLIC_API_LIMIT) {
      return error(429, 'rate_limited', 'Too many requests. Try again next minute.', { 'Retry-After': String(Math.ceil((60000 - now % 60000) / 1000)) });
    }
    if (route === 'rooms') {
      if (!rooms) return unavailable();
      const { json } = await routeRooms(rooms, { method: 'GET', path: '/api/rooms' });
      return success({ rooms: json.rooms.map((room) => ({ ...room, url: `${site}/r/${encodeURIComponent(room.id)}` })) }, 5);
    }
    if (route === 'artist') {
      if (typeof id !== 'string' || handleError(id)) return missing();
      if (!kv) return unavailable();
      const page = await publicArtistPage(kv, id);
      if (!page) return missing();
      return success({ artist: { ...page.artist, url: `${site}/a/${encodeURIComponent(page.artist.handle)}` }, tracks: page.tracks.map((t) => publicTrackMeta(t, site)) });
    }
    if (route === 'track' && (typeof id !== 'string' || !/^[a-z0-9-]{3,40}$/.test(id))) return missing();
    if (route === 'track' ? !kv && !crate : !crate) return unavailable();
    if (route === 'tracks') return success({ tracks: (await crate.list(60)).map((t) => publicTrackMeta(t, site)) });
    const published = await publicTrack(kv, crate, id);
    if (!published) return missing();
    return success({ track: publicTrackMeta(published.track, site), creator: published.artist });
  } catch {
    return unavailable();
  }
}
