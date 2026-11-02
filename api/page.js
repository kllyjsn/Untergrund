import { handlePage, renderMissing, SITE } from './_lib/pages.js';
import { ogImage, artSeed } from './_lib/og.js';
import { redisKv } from './_lib/kv.js';
import { redisStore } from './_lib/crate.js';

export default async function handler(req, res) {
  const site = process.env.PUBLIC_SITE_URL || SITE;
  try {
    const r = await handlePage(req.query || {}, { kv: redisKv(), crate: redisStore(), site, og: { ogImage, artSeed } });
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
