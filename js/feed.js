// "New from artists you follow" row for Home. Cached across Home rebuilds; hidden until there is something to show.
import { h } from './ui.js';
import { STYLES } from './state.js';
import { fetchFeed } from './account.js';

let items = null, loading = false;
export const refreshFeed = () => { items = null; };

export function followingRow({ hue, onPlay, onLoad }) {
  if (items === null && !loading) {
    loading = true;
    fetchFeed().then((list) => { items = list; loading = false; if (list.length) onLoad(); }, () => { items = []; loading = false; });
  }
  if (!items?.length) return null;
  return h('div', { class: 'recents following-row' },
    h('div', { class: 'recents-label' }, 'NEW FROM ARTISTS YOU FOLLOW'),
    h('div', { class: 'recents-row' }, items.slice(0, 12).map((t) => h('button', { class: 'recent', style: `--hue:${hue(t.style)}`, onclick: () => onPlay(t) },
      h('i'), h('b', {}, t.title || 'Untitled'), h('span', {}, [t.by?.name, STYLES[t.style]?.name].filter(Boolean).join(' · '))))));
}
