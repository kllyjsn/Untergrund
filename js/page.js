// Hydrates the server-rendered public pages (/t/<id>, /a/<handle>): artwork, instant playback, follow, share.
import { h } from './ui.js';
import { drawArtwork, artSeed } from './artwork.js';
import { STYLES } from './state.js';
import { KEYS, SCALES } from './params.js';
import { TRAITS } from './artist.js';
import { createPlayer, songBars } from './player.js';
import { follow, getAccount, fetchPublicTrack } from './account.js';

const data = JSON.parse(document.getElementById('page-data').textContent);
const main = document.getElementById('page');
const line = (t) => [STYLES[t.style]?.name, t.bpm && `${t.bpm} BPM`, `${KEYS[t.key] ?? ''} ${(SCALES[t.scale]?.name || 'minor').toLowerCase()}`.trim()].filter(Boolean).join(' · ');
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
let toastTimer = 0;
function toast(msg) {
  let el = document.querySelector('.pp-toast');
  if (!el) { el = h('div', { class: 'pp-toast', role: 'status' }); document.body.append(el); }
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}
async function share(url, title) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); }
}
const art = (track, size = 900) => {
  const c = drawArtwork(track.state, { title: track.title, style: STYLES[track.style]?.name, seed: artSeed(track.id), size });
  c.setAttribute('aria-label', `Cover art for ${track.title}`);
  return c;
};

const counted = new Set();
function countPlay(id) {
  if (!id || counted.has(id) || data.kind === 'missing') return;
  counted.add(id);
  fetch(`/api/tracks?play=${encodeURIComponent(id)}`, { method: 'POST' }).catch(() => {});
}

const player = createPlayer({ onBar: (bar, total) => current?.onBar(bar, total), onEnd: () => current?.onEnd() });
let current = null;

function trackView(track, artist, { localOnly = false } = {}) {
  const page = main.querySelector('.pp-track') || h('article', { class: 'pp-track' });
  const total = songBars(track.state), secs = player.duration(track.state);
  const cells = Array.from({ length: total }, () => h('i'));
  const time = h('span', { class: 'pp-time' }, fmt(secs));
  const btn = h('button', { class: 'pp-play', type: 'button', 'aria-label': `Play ${track.title}` }, h('i'), h('span', {}, 'Play'));
  const setBtn = (on) => { btn.classList.toggle('on', on); btn.lastChild.textContent = on ? 'Stop' : 'Play'; btn.setAttribute('aria-label', `${on ? 'Stop' : 'Play'} ${track.title}`); document.body.classList.toggle('pp-playing', on); };
  const ctl = {
    onBar: (bar) => { cells.forEach((c, i) => { c.className = i < bar ? 'past' : i === bar ? 'now' : ''; }); time.textContent = `${fmt((bar / total) * secs)} / ${fmt(secs)}`; },
    onEnd: () => { setBtn(false); cells.forEach((c) => { c.className = ''; }); time.textContent = fmt(secs); },
  };
  btn.onclick = () => {
    if (player.playing && current === ctl) { player.stop(); ctl.onEnd(); return; }
    current = ctl; player.play(track.state); setBtn(true); countPlay(track.id);
  };
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: artist?.name || track.artist || 'UNTERGRUND', album: 'UNTERGRUND' });
  const by = artist ? h('a', { class: 'pp-by', href: `/a/${artist.handle}` }, artist.name) : h('span', { class: 'pp-by' }, track.artist || 'UNTERGRUND');
  const url = `${location.origin}/t/${track.id}`;
  page.replaceChildren(
    h('div', { class: 'pp-art' }, art(track)),
    h('div', { class: 'pp-info' },
      h('span', { class: 'pp-eyebrow' }, 'TRACK'),
      h('h1', {}, track.title),
      by,
      h('div', { class: 'pp-meta' }, line(track)),
      remixOf(track),
      h('div', { class: 'pp-progress', 'aria-hidden': 'true' }, h('div', { class: 'pp-cells' }, cells), time),
      h('div', { class: 'pp-actions' }, btn),
      h('div', { class: 'pp-links' },
        localOnly ? null : h('button', { class: 'pp-link', type: 'button', onclick: () => share(url, track.title) }, 'Share'),
        h('a', { class: 'pp-link', href: `/?track=${encodeURIComponent(track.id)}` }, 'Remix in UNTERGRUND')),
      h('p', { class: 'pp-note' }, localOnly ? 'Only this browser can open this page until public storage is connected.' : 'Played live by UNTERGRUND in your browser. Nothing is streamed.')));
  if (!page.isConnected) main.replaceChildren(page);
  const remixes = localOnly ? [] : data.remixes || [];
  main.querySelector('.pp-remixes')?.remove();
  if (remixes.length) main.append(h('section', { class: 'pp-tracks pp-remixes' }, h('div', { class: 'pp-label' }, `REMIXES · ${remixes.length}`),
    h('ol', { class: 'pp-list' }, trackRows(remixes, (t) => [t.artist, line(t), t.plays ? `${t.plays} play${t.plays === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')))));
}

function remixOf(track) {
  const r = track.remixOf;
  if (r?.title && r.id) return h('div', { class: 'pp-credit' }, 'Remix of ', h('a', { href: `/t/${encodeURIComponent(r.id)}` }, r.title), ` by ${r.artist || 'UNTERGRUND'}`);
  const drop = track.drop || track.state?.drop;
  if (drop) return h('div', { class: 'pp-credit' }, `Remix of the Daily Drop · ${drop}`);
  return r?.title ? h('div', { class: 'pp-credit' }, `Remix of ${r.title} by ${r.artist || 'UNTERGRUND'}`) : null;
}

function trackRows(tracks, sub = line) {
  const rows = tracks.map((t) => {
    const play = h('button', { class: 'pp-row-play', type: 'button', 'aria-label': `Play ${t.title}` }, h('i'));
    const bar = h('i', { class: 'pp-row-bar' });
    const ctl = {
      onBar: (b, total) => { bar.style.width = `${((b + 1) / total) * 100}%`; },
      onEnd: () => { play.classList.remove('on'); bar.style.width = '0'; const next = rows[rows.indexOf(row) + 1]; if (next && current === ctl) next.querySelector('.pp-row-play').click(); },
    };
    play.onclick = async () => {
      if (player.playing && current === ctl) { player.stop(); current = null; play.classList.remove('on'); bar.style.width = '0'; return; }
      play.classList.add('busy');
      if (!t.state) t.state = (await fetchPublicTrack(t.id))?.track?.state;
      play.classList.remove('busy');
      if (!t.state) return toast('Couldn’t load that track');
      countPlay(t.id);
      document.querySelectorAll('.pp-row-play.on').forEach((b) => b.classList.remove('on'));
      document.querySelectorAll('.pp-row-bar').forEach((b) => { b.style.width = '0'; });
      current = ctl; player.play(t.state); play.classList.add('on');
    };
    const row = h('li', { class: 'pp-row' },
      h('a', { href: `/t/${t.id}` }, h('img', { src: `/api/page?og=${encodeURIComponent(t.id)}`, alt: '', loading: 'lazy' }),
        h('span', {}, h('b', {}, t.title), h('small', {}, sub(t)))), play, bar);
    return row;
  });
  return rows;
}

function artistView(artist, tracks) {
  const root = main.querySelector('.pp-artist');
  const avatar = artist.avatar ? h('img', { class: 'pp-avatar', src: artist.avatar, alt: '' }) : h('div', { class: 'pp-avatar', 'aria-hidden': 'true' }, artist.name.slice(0, 2).toUpperCase());
  const followers = h('b', {}, String(artist.followers)), followWord = h('span', {}, '');
  const setFollowers = (n) => { followers.textContent = String(n); followWord.textContent = n === 1 ? ' follower' : ' followers'; };
  setFollowers(artist.followers);
  const followBtn = h('button', { class: 'pp-play pp-follow', type: 'button', hidden: true }, h('span', {}, 'Follow'));
  const url = `${location.origin}/a/${artist.handle}`;
  const dna = artist.dna && TRAITS.map(([id, label]) => h('div', { class: 'pp-trait' }, h('span', {}, label), h('i', { style: `--v:${artist.dna[id] ?? 0}%` }), h('b', {}, String(artist.dna[id] ?? 0))));
  const rows = trackRows(tracks);
  root.replaceChildren(
    h('div', { class: 'pp-hero' }, avatar,
      h('div', { class: 'pp-who' },
        h('span', { class: 'pp-eyebrow' }, 'ARTIST'),
        h('h1', {}, artist.name),
        h('div', { class: 'pp-handle' }, `@${artist.handle}`),
        artist.bio ? h('p', { class: 'pp-bio' }, artist.bio) : null,
        h('div', { class: 'pp-stats' }, h('span', {}, followers, followWord), h('span', {}, h('b', {}, String(tracks.length)), tracks.length === 1 ? ' track' : ' tracks'),
          artist.soundcloud ? h('a', { href: artist.soundcloud, target: '_blank', rel: 'noopener' }, 'SoundCloud') : null),
        h('div', { class: 'pp-actions' }, followBtn, h('button', { class: 'pp-link', type: 'button', onclick: () => share(url, artist.name) }, 'Share')))),
    dna ? h('section', { class: 'pp-dna' }, h('div', { class: 'pp-label' }, 'ARTIST DNA'), dna) : null,
    h('section', { class: 'pp-tracks' }, h('div', { class: 'pp-label' }, 'TRACKS'),
      rows.length ? h('ol', { class: 'pp-list' }, rows) : h('p', { class: 'pp-note' }, 'No tracks yet. Follow to hear the first one.')));

  fetch(`/api/account?handle=${encodeURIComponent(artist.handle)}`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((info) => {
    if (!info) return;
    let on = info.isFollowing;
    const paint = () => { followBtn.classList.toggle('on', on); followBtn.firstChild.textContent = info.isMe ? 'Edit your page' : on ? 'Following' : 'Follow'; };
    followBtn.hidden = false; paint();
    setFollowers(info.artist.followers);
    followBtn.onclick = async () => {
      if (info.isMe) { location.href = '/?artist'; return; }
      followBtn.disabled = true;
      try { const r = await follow(artist.handle, !on); on = r.following; setFollowers(r.followers); paint(); toast(on ? `Following ${artist.name}` : 'Unfollowed'); }
      catch (e) { toast(e.message); }
      followBtn.disabled = false;
    };
  }).catch(() => {});
  getAccount();
}

function localTrack(id) {
  try { return (JSON.parse(localStorage.getItem('untergrund.crate.v1')) || []).find((t) => t.id === id && t.state) || null; } catch { return null; }
}

if (data.kind === 'track') trackView(data.track, data.artist);
else if (data.kind === 'artist') artistView(data.artist, data.tracks);
else if (data.kind === 'missing' && data.what === 'track') {
  const t = localTrack(data.id);
  if (t) { document.title = `${t.title} — UNTERGRUND`; trackView(t, null, { localOnly: true }); }
}
