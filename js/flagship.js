// Flagship shelf for Home: admin-pinned real releases (config/flagship.js), each with its artist credit and real counts.
// Cached across Home rebuilds; hidden when nothing is pinned or storage is off.
import { h } from './ui.js';
import { STYLES } from './state.js';
import { drawArtwork, artSeed } from './artwork.js';

let items = null, loading = false;
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

export function flagshipShelf({ onPlay, onLoad }) {
  if (items === null && !loading) {
    loading = true;
    fetch('/api/flagship').then((r) => (r.ok ? r.json() : { tracks: [] })).then((j) => {
      items = (j.tracks || []).filter((t) => t?.id && t.state);
      loading = false;
      if (items.length) onLoad();
    }, () => { items = []; loading = false; });
  }
  if (!items?.length) return null;
  return h('section', { class: 'flagship', 'aria-label': 'Flagship releases' },
    h('div', { class: 'flagship-head' }, h('span', { class: 'recents-label' }, 'FLAGSHIP'), h('span', { class: 'flagship-sub' }, 'Made in UNTERGRUND by the artists who use it')),
    h('div', { class: 'flagship-row' }, items.map((t) => h('article', { class: 'flag' },
      h('button', { class: 'flag-art', type: 'button', 'aria-label': `Play ${t.title} by ${t.by}`, onclick: () => onPlay(t) }, cover(t), h('i')),
      h('a', { class: 'flag-title', href: `/t/${encodeURIComponent(t.id)}` }, t.title),
      t.artist ? h('a', { class: 'flag-by', href: `/a/${encodeURIComponent(t.artist.handle)}` }, t.artist.name) : h('span', { class: 'flag-by' }, t.by),
      h('span', { class: 'flag-meta' }, counts(t) || STYLES[t.style]?.name || '')))));
}
