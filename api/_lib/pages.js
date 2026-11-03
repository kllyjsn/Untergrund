// Server-rendered shells for /a/<handle> and /t/<id>: per-page Open Graph/Twitter meta plus readable markup;
// js/page.js hydrates them (artwork, instant in-browser playback, follow).
import { KEYS, SCALES } from '../../js/params.js';
import { STYLES } from '../../js/state.js';
import { publicArtistPage, publicTrack } from './accounts.js';
import { remixTree } from './crate.js';

export const SITE = 'https://www.untergrund.sh';
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const keyName = (t) => `${KEYS[t.key] ?? ''} ${(SCALES[t.scale]?.name || 'MINOR').toLowerCase()}`.trim();
export const trackLine = (t) => [STYLES[t.style]?.name, t.bpm && `${t.bpm} BPM`, keyName(t)].filter(Boolean).join(' · ');

function meta({ title, description, url, image, type = 'website', alt = '', extra = '' }) {
  return `<title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(url)}" />
  <meta property="og:type" content="${esc(type)}" />
  <meta property="og:site_name" content="UNTERGRUND" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:image" content="${esc(image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(alt || title)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(image)}" />
  <meta name="twitter:image:alt" content="${esc(alt || title)}" />${extra}`;
}

function shell(head, body, data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#070708" />
  ${head}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter+Tight:wght@500;700;900&display=swap" rel="stylesheet" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%23070708'/><rect x='6' y='6' width='20' height='20' fill='none' stroke='%23ff2b2b' stroke-width='3'/><rect x='13' y='13' width='6' height='6' fill='%23ff2b2b'/></svg>" />
  <link rel="stylesheet" href="/css/style.css" />
  <link rel="stylesheet" href="/css/pages.css" />
</head>
<body class="pp">
  <header class="pp-top"><a class="pp-brand" href="/"><span class="logo"><b></b></span><span>UNTERGRUND</span></a><a class="pp-make" href="/">Make a track</a></header>
  <main id="page" class="pp-main">${body}</main>
  <script id="page-data" type="application/json">${safeJson(data)}</script>
  <script type="module" src="/js/page.js"></script>
</body>
</html>`;
}

// "Remix of <parent>" (or of a Daily Drop) and the remixes of this track, as plain links for crawlers and no-JS readers.
export function remixOfHtml(track) {
  const r = track.remixOf;
  if (r?.title && r.id) return `<div class="pp-credit">Remix of <a href="/t/${esc(r.id)}">${esc(r.title)}</a> by ${esc(r.artist || 'UNTERGRUND')}</div>`;
  const drop = track.drop || track.state?.drop;
  if (drop) return `<div class="pp-credit">Remix of the Daily Drop · ${esc(drop)}</div>`;
  return r?.title ? `<div class="pp-credit">Remix of ${esc(r.title)} by ${esc(r.artist || 'UNTERGRUND')}</div>` : '';
}
export function remixListHtml(remixes = []) {
  if (!remixes.length) return '';
  const items = remixes.map((t) => `<li><a href="/t/${esc(t.id)}"><b>${esc(t.title)}</b><small>${esc([t.artist, trackLine(t)].filter(Boolean).join(' · '))}</small></a></li>`).join('');
  return `<section class="pp-tracks pp-remixes"><span class="pp-label">REMIXES · ${remixes.length}</span><ol class="pp-list">${items}</ol></section>`;
}

export function renderTrackPage({ track, artist, remixes = [] }, { site = SITE } = {}) {
  const by = artist?.name || track.artist || 'UNTERGRUND';
  const url = `${site}/t/${encodeURIComponent(track.id)}`;
  const title = `${track.title} — ${by}`;
  const description = `${trackLine(track)}. Made in UNTERGRUND. Tap to play it instantly in your browser.`;
  const image = `${site}/api/page?og=${encodeURIComponent(track.id)}`;
  const head = meta({ title, description, url, image, type: 'music.song', alt: `Cover art for ${track.title}`,
    extra: artist ? `\n  <meta property="music:musician" content="${esc(`${site}/a/${artist.handle}`)}" />` : '' });
  const byline = artist ? `<a class="pp-by" href="/a/${esc(artist.handle)}">${esc(by)}</a>` : `<span class="pp-by">${esc(by)}</span>`;
  const body = `<article class="pp-track">
    <div class="pp-art" aria-hidden="true"></div>
    <div class="pp-info">
      <span class="pp-eyebrow">TRACK</span>
      <h1>${esc(track.title)}</h1>
      ${byline}
      <div class="pp-meta">${esc(trackLine(track))}</div>
      ${remixOfHtml(track)}
      <div class="pp-actions"><button class="pp-play" type="button" disabled><i></i><span>Play</span></button></div>
      <p class="pp-note">Played live by UNTERGRUND in your browser. Nothing is streamed.</p>
    </div>
  </article>
  ${remixListHtml(remixes)}`;
  return shell(head, body, { kind: 'track', site, track, artist, remixes });
}

export function renderArtistPage({ artist, tracks }, { site = SITE } = {}) {
  const url = `${site}/a/${artist.handle}`;
  const title = `${artist.name} (@${artist.handle}) on UNTERGRUND`;
  const description = artist.bio || `${tracks.length} track${tracks.length === 1 ? '' : 's'} made in UNTERGRUND. Follow to hear what ${artist.name} makes next.`;
  const image = tracks[0] ? `${site}/api/page?og=${encodeURIComponent(tracks[0].id)}` : `${site}/social-card.png`;
  const head = meta({ title, description, url, image, type: 'profile', alt: `${artist.name} on UNTERGRUND`,
    extra: `\n  <meta property="profile:username" content="${esc(artist.handle)}" />` });
  const list = tracks.map((t) => `<li><a href="/t/${esc(t.id)}"><b>${esc(t.title)}</b><small>${esc(trackLine(t))}</small></a></li>`).join('');
  const body = `<section class="pp-artist">
    <div class="pp-hero">
      <div class="pp-avatar" aria-hidden="true">${esc(artist.name.slice(0, 2).toUpperCase())}</div>
      <div class="pp-who">
        <span class="pp-eyebrow">ARTIST</span>
        <h1>${esc(artist.name)}</h1>
        <div class="pp-handle">@${esc(artist.handle)}</div>
        ${artist.bio ? `<p class="pp-bio">${esc(artist.bio)}</p>` : ''}
        <div class="pp-stats"><span><b>${artist.followers}</b> ${artist.followers === 1 ? 'follower' : 'followers'}</span><span><b>${tracks.length}</b> ${tracks.length === 1 ? 'track' : 'tracks'}</span></div>
      </div>
    </div>
    <ol class="pp-list">${list}</ol>
  </section>`;
  return shell(head, body, { kind: 'artist', site, artist, tracks });
}

export function renderMissing(kind, id, { site = SITE, enabled = true } = {}) {
  const head = meta({ title: 'UNTERGRUND — Make music that moves', description: 'Generate, refine, perform, and release original music in your browser.',
    url: `${site}/${kind === 'artist' ? 'a' : 't'}/${encodeURIComponent(id)}`, image: `${site}/social-card.png` });
  const what = kind === 'artist' ? 'artist page' : 'track';
  const body = `<section class="pp-missing">
    <h1>${enabled ? `This ${what} isn’t here.` : `Public ${what}s are almost live.`}</h1>
    <p>${enabled ? 'The link may be mistyped, or the page was removed.' : 'Public storage isn’t connected yet, so pages only open in the browser that made them.'}</p>
    <a class="pp-play pp-cta" href="/"><span>Make a track</span></a>
  </section>`;
  return shell(head, body, { kind: 'missing', site, what: kind, id: String(id).slice(0, 40), enabled });
}

// Shared by api/page.js and server.mjs. Returns { status, type, body, cache }.
export async function handlePage(query, { kv, crate, site = SITE, og }) {
  const cache = 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400';
  if (query.og) {
    const t = await publicTrack(kv, crate, query.og);
    if (!t) return { status: 302, location: '/social-card.png' };
    const { ogImage, artSeed } = og;
    return { status: 200, type: 'image/png', body: ogImage(t.track.state, artSeed(t.track.id)), cache: 'public, max-age=86400, s-maxage=31536000, immutable' };
  }
  const html = (status, body, c = cache) => ({ status, type: 'text/html; charset=utf-8', body, cache: c });
  if (query.t) {
    const t = await publicTrack(kv, crate, query.t);
    if (t && crate?.children) t.remixes = await remixTree(crate, t.track.id).catch(() => []);
    return t ? html(200, renderTrackPage(t, { site })) : html(404, renderMissing('track', query.t, { site, enabled: !!(kv || crate) }), 'no-store');
  }
  if (query.a) {
    const p = await publicArtistPage(kv, query.a);
    return p ? html(200, renderArtistPage(p, { site })) : html(404, renderMissing('artist', query.a, { site, enabled: !!kv }), 'no-store');
  }
  return html(404, renderMissing('track', '', { site, enabled: !!kv }), 'no-store');
}
