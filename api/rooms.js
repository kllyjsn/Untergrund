// Club rooms on Vercel, backed by Upstash/Vercel KV (stateless + concurrency-safe; see api/_lib/rooms.js).
// vercel.json rewrites /api/rooms/:room[/events] here as ?room=&events=1, and /api/room-config as ?config=1
// (one function for all room routes keeps the Hobby plan's function count down).
import { createRooms, roomsKv, routeRooms, MAX_ROOM_BODY } from './_lib/rooms.js';

let rooms;

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  const query = { ...Object.fromEntries(url.searchParams), ...(req.query || {}) };
  res.setHeader('Cache-Control', 'no-store');
  if (query.config) return res.status(200).json({ apiBase: process.env.ROOMS_API_URL || '' });
  const room = String(query.room || '');
  const path = room ? `/api/rooms/${room}${query.events ? '/events' : ''}` : url.pathname;
  let body = null;
  if (req.method === 'POST') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {}); } catch { body = null; }
    if (body && JSON.stringify(body).length > MAX_ROOM_BODY) body = undefined;
  }
  if (rooms === undefined) { const kv = roomsKv(); rooms = kv ? createRooms({ kv }) : null; }
  let r;
  try { r = await routeRooms(rooms, { method: req.method, path, query, body }); }
  catch (err) { console.error('rooms failed', err.message); r = { status: 503, json: { error: 'rooms_unavailable' } }; }
  if (r.cache) res.setHeader('Cache-Control', r.cache);
  if (r.status === 204) return res.status(204).end();
  return res.status(r.status).json(r.json);
}
