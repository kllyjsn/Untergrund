// Home card for the Daily Drop: today's seed for everyone, a countdown to the next one, and today's top remixes.
import { h } from './ui.js';
import { STYLES } from './state.js';
import { dailyDrop, msToNextDrop, countdown } from './daily.js';
import { listDrop } from './crate.js';

let cache = { date: '', tracks: null, loading: false };
let ticker = 0;

export function dropCard({ hue, onMake, onPlay, onLoad, playingId = '' }) {
  const drop = dailyDrop();
  if (cache.date !== drop.date) cache = { date: drop.date, tracks: null, loading: false };
  if (cache.tracks === null && !cache.loading) {
    cache.loading = true;
    listDrop(drop.date).then(({ tracks }) => { cache.tracks = tracks; cache.loading = false; if (tracks.length) onLoad(); }, () => { cache.tracks = []; cache.loading = false; });
  }
  const left = h('b', {}, countdown(msToNextDrop()));
  const next = h('span', { class: 'drop-next', title: 'Time until the next drop' }, h('span', {}, 'Next drop in '), left);
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (!next.isConnected) return clearInterval(ticker);
    if (dailyDrop().date !== drop.date) { clearInterval(ticker); return onLoad(); }
    left.textContent = countdown(msToNextDrop());
  }, 30e3);
  const top = (cache.tracks || []).slice(0, 3);
  const remixes = top.length ? h('ol', { class: 'drop-remixes', 'aria-label': 'Top remixes today' }, top.map((t, i) =>
    h('li', {}, h('button', { class: 'drop-remix' + (t.id === playingId ? ' on' : ''), type: 'button', 'aria-label': `Play ${t.title} by ${t.artist}`, onclick: () => onPlay(t) },
      h('i', { 'aria-hidden': 'true' }), h('b', {}, t.title || 'Untitled'),
      h('span', {}, [t.artist, i === 0 && t.plays ? `${t.plays} play${t.plays === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')))))) : null;
  return h('div', { class: 'drop-card', style: `--drop:${hue(drop.style)}` },
    h('div', { class: 'drop-head' }, h('span', { class: 'drop-eyebrow' }, `Today’s drop · ${STYLES[drop.style].name}`), next),
    h('div', { class: 'drop-body' },
      h('div', { class: 'drop-title' }, h('b', {}, drop.title), h('span', {}, 'The same track for everyone today. Make it yours.')),
      h('button', { class: 'drop-make', type: 'button', onclick: () => onMake(drop) }, 'Play it')),
    remixes);
}
