// Home release shelf: curated picks, or recent public releases when no pick resolves.
import { h } from './ui.js';
import { STYLES } from './state.js';
import { drawArtwork, artSeed } from './artwork.js';
import { songLink } from './share-code.js';

let items = null, loading = false, recent = false;
const covers = new Map();

function cover(t) {
  if (!covers.has(t.id)) {
    const c = drawArtwork(t.state, { title: t.title, style: STYLES[t.style]?.name, seed: artSeed(t.id), size: 320 });
    c.setAttribute('aria-hidden', 'true');
    covers.set(t.id, c);
  }
  return covers.get(t.id);
}

const counts = (t) => [t.plays ? `${t.plays.toLocaleString('en-US')} play${t.plays === 1 ? '' : 's'}` : '', t.remixes ? `${t.remixes} remix${t.remixes === 1 ? '' : 'es'}` : ''].filter(Boolean).join(' · ');

const isClassical = (track) => STYLES[track.style]?.family === 'CLASSICAL';
export const flagshipTrackHref = (track) => songLink('', { id: track.id, release: !isClassical(track) });

function playControl(track, onPlay) {
  const attrs = { class: 'flag-art', 'aria-label': `Play ${track.title} by ${track.by}` };
  return isClassical(track)
    ? h('a', { ...attrs, href: flagshipTrackHref(track) }, cover(track), h('i'))
    : h('button', { ...attrs, type: 'button', onclick: () => onPlay(track) }, cover(track), h('i'));
}

export function flagshipShelf({ onPlay, onLoad }) {
  if (items === null && !loading) {
    loading = true;
    fetch('/api/flagship').then((r) => (r.ok ? r.json() : { tracks: [] })).then((j) => {
      items = (j.tracks || []).filter((t) => t?.id && t.state);
      recent = j.kind === 'recent';
      loading = false;
      if (items.length) onLoad();
    }, () => { items = []; loading = false; });
  }
  if (!items?.length) return null;
  return h('section', { class: 'flagship', 'aria-label': recent ? 'Recent public releases' : 'Flagship releases' },
    h('div', { class: 'flagship-head' }, h('span', { class: 'recents-label' }, recent ? 'RECENT PUBLIC RELEASES' : 'FLAGSHIP'), h('span', { class: 'flagship-sub' }, 'Made in UNTERGRUND by the artists who use it')),
    h('div', { class: 'flagship-row' }, items.map((t) => h('article', { class: 'flag' },
      playControl(t, onPlay),
      h('a', { class: 'flag-title', href: flagshipTrackHref(t) }, t.title),
      t.artist ? h('a', { class: 'flag-by', href: `/a/${encodeURIComponent(t.artist.handle)}` }, t.artist.name) : h('span', { class: 'flag-by' }, t.by),
      h('span', { class: 'flag-meta' }, counts(t) || STYLES[t.style]?.name || '')))));
}
