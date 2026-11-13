// LIVE NOW: the public live-rooms directory (GET /api/rooms) and the room cards shown on Home and in the Club lobby.
// The directory is optional: a 404, an error or `enabled: false` hides every live surface.
import { h } from './ui.js';
import { STYLES } from './state.js';

const PRIVACY_KEY = 'untergrund.room-public.v1';
const MY_ROOM_KEY = 'untergrund.my-room.v1';
const ROOM = /^[a-z0-9-]{2,32}$/;
const SHAPES = ['block', 'round', 'visor'], COLORS = ['lime', 'red', 'blue', 'violet', 'bone'], GEAR = ['none', 'hood', 'goggles', 'antenna', 'phones'];
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const one = (v, list, fallback) => list.includes(v) ? v : fallback;

export const OFF = Object.freeze({ loaded: true, enabled: false, rooms: [] });

// Cleans whatever /api/rooms returned into what the cards can trust; busiest rooms first.
export function normalizeDirectory(json) {
  if (!json || json.enabled !== true || !Array.isArray(json.rooms)) return OFF;
  const seen = new Set();
  const rooms = json.rooms.flatMap((r) => {
    const id = String(r?.id || '').toLowerCase();
    if (!ROOM.test(id) || seen.has(id)) return [];
    seen.add(id);
    const dj = r.dj || {};
    return [{
      id,
      title: text(r.title, 80) || 'Live Machine Set',
      artist: text(r.artist, 40) || 'UNTERGRUND',
      style: STYLES[r.style] ? r.style : '',
      bpm: Number.isFinite(+r.bpm) && +r.bpm > 0 ? Math.round(+r.bpm) : 0,
      key: text(r.key, 24),
      listeners: Math.max(1, Math.floor(+r.listeners) || 1),
      dj: { name: text(dj.name, 28) || 'DJ', shape: one(dj.shape, SHAPES, 'block'), color: one(dj.color, COLORS, 'lime'), gear: one(dj.gear, GEAR, 'none') },
      startsAt: +r.startsAt || 0,
      replay: r.replay === true,
    }];
  });
  rooms.sort((a, b) => b.listeners - a.listeners || b.startsAt - a.startsAt || a.id.localeCompare(b.id));
  return { loaded: true, enabled: true, rooms };
}

export const roomLine = (r) => [r.dj?.name, STYLES[r.style]?.name, r.bpm && `${r.bpm} BPM`].filter(Boolean).join(' · ');
export const listening = (n) => `${n} listening`;
export const directorySignature = (d) => JSON.stringify([d.enabled, d.rooms.map((r) => [r.id, r.title, r.listeners, r.dj.name, r.replay])]);

let directory = { loaded: false, enabled: false, rooms: [] }, inflight = null, fetchedAt = 0;
export const liveDirectory = () => directory;

export function fetchLiveRooms({ maxAge = 4000 } = {}) {
  if (inflight) return inflight;
  if (directory.loaded && Date.now() - fetchedAt < maxAge) return Promise.resolve(directory);
  inflight = fetch('/api/rooms', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null), () => null)
    .catch(() => null)
    .then((json) => { directory = normalizeDirectory(json); fetchedAt = Date.now(); inflight = null; return directory; });
  return inflight;
}

// Polls while the page is visible; onChange only fires when what the cards show changed.
export function watchLiveRooms(onChange, { every = 12000 } = {}) {
  let last = directorySignature(directory), timer = 0, stopped = false;
  const tick = async () => {
    if (stopped) return;
    if (document.visibilityState !== 'hidden') {
      const d = await fetchLiveRooms({ maxAge: every / 2 });
      const sig = directorySignature(d);
      if (sig !== last && !stopped) { last = sig; onChange(d); }
      if (!d.enabled && d.loaded) { stopped = true; return; }
    }
    timer = setTimeout(tick, every);
  };
  tick();
  return () => { stopped = true; clearTimeout(timer); };
}

// Public by default; "private" means link-only (not listed in LIVE NOW). Remembered per room.
function privacyMap(store = globalThis.localStorage) {
  try { return JSON.parse(store?.getItem(PRIVACY_KEY) || '{}') || {}; } catch { return {}; }
}
export const isRoomPublic = (id, store) => privacyMap(store)[id] !== false;
export function setRoomPublic(id, pub, store = globalThis.localStorage) {
  const map = privacyMap(store);
  if (pub) delete map[id]; else map[id] = false;
  try { store?.setItem(PRIVACY_KEY, JSON.stringify(map)); } catch {}
}

// The room this browser hosts when it goes live from Home: "<name>-<4 chars>", kept so the link stays the same.
export function myRoom(name = '', store = globalThis.localStorage, rand = Math.random) {
  const saved = store?.getItem(MY_ROOM_KEY);
  if (saved && ROOM.test(saved)) return saved;
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 22) || 'room';
  const id = `${base}-${rand().toString(36).slice(2, 6).padEnd(4, '0')}`;
  store?.setItem(MY_ROOM_KEY, id);
  return id;
}
export const setMyRoom = (id, store = globalThis.localStorage) => { if (ROOM.test(id)) store?.setItem(MY_ROOM_KEY, id); };

export const roomInviteUrl = (id, origin = globalThis.location?.origin || '') => `${origin}/r/${encodeURIComponent(id)}`;

const liveDot = () => h('i', { class: 'lr-dot', 'aria-hidden': 'true' });

// One live room. `avatar` renders the DJ (club.js avatarNode), `hue` maps a style to its color.
export function roomCard(r, { onJoin, avatar, hue, mine = false, big = false }) {
  return h('button', { class: `lr-card${big ? ' big' : ''}${mine ? ' mine' : ''}`, type: 'button', style: `--hue:${hue?.(r.style) || 'var(--green)'}`,
    'aria-label': `Join ${r.title} by ${r.dj.name} in ${r.id}, ${listening(r.listeners)}`, onclick: () => onJoin(r) },
    h('span', { class: 'lr-dj', 'aria-hidden': 'true' }, avatar ? avatar(r.dj) : null),
    h('span', { class: 'lr-body' },
      h('span', { class: 'lr-state' }, liveDot(), mine ? 'YOU’RE LIVE' : r.replay ? 'REPLAY' : 'LIVE', h('em', {}, listening(r.listeners))),
      h('b', {}, r.title),
      h('small', {}, roomLine(r)),
      big ? h('small', { class: 'lr-room' }, r.id) : null));
}

// The quiet "go live" tile: the empty state, and the nudge after GENERATE.
export function goLiveTile({ playing, title, onGoLive, empty }) {
  return h('button', { class: 'lr-card lr-go', type: 'button', onclick: () => onGoLive() },
    h('span', { class: 'lr-go-mark', 'aria-hidden': 'true' }, h('i')),
    h('span', { class: 'lr-body' },
      h('span', { class: 'lr-state' }, 'GO LIVE'),
      h('b', {}, playing && title ? `Play “${title}” to a room` : empty ? 'Be the first room tonight' : 'Start your own room'),
      h('small', {}, playing ? 'Public by default. Anyone can drop in.' : 'Your set plays in sync for everyone.')));
}

// Home strip. Always returns an element so a poll can swap it in place; hidden when the directory is off.
export function liveNowRow({ dir = directory, onJoin, onGoLive, onLobby, avatar, hue, playing, title, mine }) {
  if (!dir.enabled) return h('section', { class: 'live-now', hidden: '' });
  const n = dir.rooms.length, people = dir.rooms.reduce((s, r) => s + r.listeners, 0);
  const rooms = mine ? [...dir.rooms].sort((a, b) => (b.id === mine) - (a.id === mine)) : dir.rooms;
  const cards = rooms.slice(0, 12).map((r) => roomCard(r, { onJoin, avatar, hue, mine: r.id === mine }));
  // While a track plays, GO LIVE leads the row: it is the next thing to do with it. Hidden while you're live.
  const tile = mine ? null : goLiveTile({ playing, title, onGoLive, empty: !n });
  return h('section', { class: 'live-now', 'aria-label': 'Live rooms' },
    h('div', { class: 'lr-head' },
      h('span', { class: `lr-title${n ? ' on' : ''}` }, liveDot(), 'LIVE NOW'),
      h('span', { class: 'lr-count' }, n ? `${n} ${n === 1 ? 'ROOM' : 'ROOMS'} · ${people} LISTENING` : 'NO ROOMS LIVE'),
      n ? h('button', { class: 'lr-all', type: 'button', onclick: () => onLobby() }, 'ALL ROOMS') : null),
    h('div', { class: 'lr-row' }, playing ? [tile, ...cards] : [...cards, tile]));
}
