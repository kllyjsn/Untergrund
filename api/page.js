import { handlePage, renderMissing, SITE } from './_lib/pages.js';
import { ogImage, artSeed } from './_lib/og.js';
import { clubImage } from './_lib/og-club.js';
import { redisKv } from './_lib/kv.js';
import { redisStore } from './_lib/crate.js';
import { createRooms, roomsKv } from './_lib/rooms.js';
import { handleHealth, redisHealthCheck } from './_lib/health.js';

let rooms;

export default async function handler(req, res) {
  if (req.query?.health === '1') {
    const { status, json } = await handleHealth(req.method, { checkStorage: redisHealthCheck() });
    res.setHeader('Cache-Control', 'no-store');
    if (status === 405) res.setHeader('Allow', 'GET');
    return res.status(status).json(json);
  }
  const site = process.env.PUBLIC_SITE_URL || SITE;
  if (rooms === undefined) { const kv = roomsKv(); rooms = kv ? createRooms({ kv }) : null; }
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
