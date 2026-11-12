// Home card for the Daily Drop: today's seed for everyone, a countdown to the next one, and today's top remixes.
import { h } from './ui.js';
import { STYLES } from './state.js';
import { dailyDrop, msToNextDrop, countdown } from './daily.js';
import { listDrop } from './crate.js';
import { track } from './analytics.js';
import { pushState, pushNotice, enablePush, disablePush, dropStreak, playedDays, markOffered } from './push.js';

let cache = { date: '', tracks: null, loading: false };
let ticker = 0;

const turnOn = (from) => enablePush().then((st) => { track('push', { kind: st === 'on' ? `on_${from}` : st }); return st; });
const FAILED = 'Couldn’t turn on alerts just now. Try again in a moment.';

// Streak + daily alerts, once they've played a drop (so the ask comes after they know what it is).
function alertsRow() {
  const st = pushState(), streak = dropStreak();
  const badge = streak > 1 ? h('b', { class: 'drop-streak' }, `${streak}-day streak`) : null;
  if (st === 'on') return h('div', { class: 'drop-alerts on' }, badge, h('span', {}, 'Daily alerts on'),
    h('button', { class: 'drop-alert-btn', type: 'button', onclick: () => disablePush().then(() => track('push', { kind: 'off' })) }, 'Turn off'));
  const failed = pushNotice() === 'failed';
  if (st === 'off' && playedDays().length) return h('div', { class: 'drop-alerts' + (failed ? ' failed' : '') }, badge,
    h('span', { role: 'status', title: failed ? FAILED : '' }, failed ? 'Couldn’t turn on alerts. Try again?' : 'Get each drop on your lock screen'),
    h('button', { class: 'drop-alert-btn', type: 'button', onclick: () => turnOn('card') }, 'Notify me'));
  return badge && h('div', { class: 'drop-alerts' }, badge, h('span', {}, 'Come back tomorrow to keep it going'));
}

// The one-time ask, shown while their first drop is playing. One button; dismiss is a quiet ×.
export function pushOffer() {
  document.querySelector('.push-offer')?.remove();
  markOffered();
  track('push', { kind: 'offer' });
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  const msg = h('span', { role: 'status' }, 'One new track a day, plus your streak. Nothing else.');
  const yes = h('button', { class: 'push-offer-yes', type: 'button', onclick: async () => {
    yes.disabled = true;
    const st = await turnOn('offer');
    if (st !== 'failed') return close();
    yes.disabled = false;
    msg.textContent = FAILED;
  } }, 'Notify me');
  const el = h('div', { class: 'push-offer', role: 'dialog', 'aria-label': 'Daily drop alerts' },
    h('div', { class: 'push-offer-text' }, h('b', {}, 'Get tomorrow’s drop'), msg), yes,
    h('button', { class: 'push-offer-no', type: 'button', 'aria-label': 'Not now', onclick: () => { close(); track('push', { kind: 'dismiss' }); } }, '×'));
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
}

export function dropCard({ hue, onMake, onPlay, onLoad, playingId = '', cue = false }) {
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
      h('button', { class: 'drop-make' + (cue ? ' cue' : ''), type: 'button', onclick: () => onMake(drop) }, 'Play it')),
    alertsRow(), remixes);
}
