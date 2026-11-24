import { handlePage, renderMissing, SITE } from './_lib/pages.js';
import { handlePublicApi } from './_lib/public-api.js';
import { ogImage, artSeed } from './_lib/og.js';
import { clubImage } from './_lib/og-club.js';
import { redisKv } from './_lib/kv.js';
import { redisStore } from './_lib/crate.js';
import { createRooms, roomsKv } from './_lib/rooms.js';

let rooms;

export default async function handler(req, res) {
  const site = process.env.PUBLIC_SITE_URL || SITE;
  if (rooms === undefined) { const kv = roomsKv(); rooms = kv ? createRooms({ kv }) : null; }
  if (req.query?.publicApi) {
    const kv = redisKv();
    const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const r = await handlePublicApi({ method: req.method, route: req.query.publicApi, id: req.query.publicId, ip },
      { kv, crate: redisStore(), rooms, rateKv: kv, site });
    for (const [name, value] of Object.entries(r.headers)) res.setHeader(name, value);
    return r.status === 204 ? res.status(204).end() : res.status(r.status).json(r.json);
  }
  try {
    const r = await handlePage(req.query || {}, { kv: redisKv(), crate: redisStore(), site, og: { ogImage, artSeed, clubImage }, rooms });
    if (r.location) { res.setHeader('Location', r.location); return res.status(r.status).end(); }
    res.setHeader('Content-Type', r.type);
    res.setHeader('Cache-Control', r.cache);
    res.status(r.status).send(r.body);
  } catch (err) {
    console.error(err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(503).send(renderMissing(req.query?.a ? 'artist' : 'track', req.query?.a || req.query?.t || '', { site, enabled: false }));
  }
}
