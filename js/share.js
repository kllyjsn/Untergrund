// The viral loop UI: share sheet (link, phone share, 9:16 video, embed code) and the landing a shared link opens.
import { h } from './ui.js';
import { STYLES } from './state.js';
import { saveTrack } from './crate.js';
import { sheet } from './sets.js';
import { drawArtwork } from './artwork.js';
import { encodeSong, songLink, embedCode, creditLine } from './share-code.js';
import { exportVideo, videoMime } from './video.js';
import { track as trackEvent, reportError } from './analytics.js';

export const track = (name, props = {}) => { try { trackEvent(name, props); window.untergrundTrack?.(name, props); } catch {} };
const isPhone = () => matchMedia('(max-width: 760px), (pointer: coarse)').matches;
const seedOf = (str) => [...String(str)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untergrund';
const art = (song, size) => drawArtwork(song.state, { title: song.title, style: STYLES[song.style]?.name, seed: seedOf(song.title + song.artist), size });

async function copy(text, toast, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { prompt(`Copy the ${what.toLowerCase()}:`, text); }
}

// Short /?t=<id> when the crate backend stores it; otherwise the whole song rides in the URL.
const linkCache = new Map();
export async function shareLinks(song, origin = location.origin) {
  const code = await encodeSong(song);
  let ref = linkCache.get(code);
  if (!ref) {
    const id = song.trackId && !String(song.trackId).startsWith('local-') ? song.trackId : '';
    ref = id ? { id } : { code };
    if (!id) {
      const { shared, track: saved } = await saveTrack({ title: song.title, artist: song.artist, style: song.style, state: song.state }).catch(() => ({}));
      if (shared && saved?.id) ref = { id: saved.id };
    }
    linkCache.set(code, ref);
  }
  return { link: songLink(origin, ref), embed: songLink(origin, ref, '/embed.html'), short: !!ref.id };
}

export function countRemix(id) {
  if (!id || String(id).startsWith('local-')) return;
  fetch(`/api/tracks?remix=${encodeURIComponent(id)}`, { method: 'POST' }).catch(() => {});
}

export function openShare({ song, toast, hue, download, source = 'studio', beforeExport }) {
  let ctrl = null, videoUrl = '';
  const { body } = sheet('SHARE', { onClose: () => { ctrl?.abort(); if (videoUrl) URL.revokeObjectURL(videoUrl); } });
  const linkBox = h('input', { class: 'inp share-link', readonly: '', value: 'Making your link…', 'aria-label': 'Song link' });
  linkBox.onfocus = () => linkBox.select();
  let links = null;
  const ready = shareLinks(song).then((l) => { links = l; linkBox.value = l.link; return l; })
    .catch((err) => { console.error(err); linkBox.value = 'Could not make a link for this song.'; });
  const withLinks = (fn) => async () => { const l = links || await ready; if (l) fn(l); };
  const text = `${song.title} by ${song.artist}, made in UNTERGRUND`;
  const canShare = !!navigator.share && isPhone();

  const linkBtns = h('div', { class: 'share-row' },
    canShare && h('button', { class: 'btn', onclick: withLinks(async (l) => {
      try { await navigator.share({ title: song.title, text, url: l.link }); track('share_link_copied', { what: 'song_sent' }); } catch {}
    }) }, 'SEND'),
    h('button', { class: 'btn ghost', onclick: withLinks((l) => { copy(l.link, toast, 'Link'); track('share_link_copied', { what: 'song' }); }) }, 'COPY LINK'));

  let seconds = 15;
  const chosen = () => seconds;
  const lenBtns = [15, 30].map((s) => h('button', { class: 'family-tab' + (s === seconds ? ' on' : ''), onclick: () => {
    if (ctrl) return;
    seconds = s; lenBtns.forEach((b, i) => b.classList.toggle('on', [15, 30][i] === s));
  } }, `${s} SEC`));
  const bar = h('i'), progress = h('div', { class: 'share-progress' }, bar);
  const status = h('div', { class: 'pub-note set-status' }, 'The best part of your song, sized for TikTok, Reels and Shorts.');
  const preview = h('div', { class: 'share-preview' });
  const mime = videoMime();
  const make = h('button', { class: 'btn accent share-make', onclick: async () => {
    if (ctrl) { ctrl.abort(); return; }
    ctrl = new AbortController();
    beforeExport?.();
    const seconds = chosen();
    make.textContent = 'CANCEL'; preview.innerHTML = ''; progress.classList.add('on');
    body.closest('.overlay')?.classList.add('exporting'); lenBtns.forEach((b) => b.setAttribute('disabled', ''));
    let shown = -1;
    try {
      const out = await exportVideo(song, { seconds, hue, signal: ctrl.signal, onProgress: (p, msg) => { const pct = Math.round(p * 50) * 2; if (pct === shown) return; shown = pct; bar.style.width = `${pct}%`; status.textContent = msg; } });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      videoUrl = URL.createObjectURL(out.blob);
      const name = `${slug(song.title)}-untergrund-${seconds}s.${out.ext}`;
      const file = new File([out.blob], name, { type: out.blob.type });
      const shareable = isPhone() && navigator.canShare?.({ files: [file] });
      preview.append(h('video', { src: videoUrl, controls: '', playsinline: '', loop: '', class: 'share-video' }),
        h('div', { class: 'share-row' },
          shareable && h('button', { class: 'btn accent', onclick: async () => {
            try { await navigator.share({ files: [file], title: song.title, text: `${text} · untergrund.sh` }); track('share_link_copied', { what: 'video_sent' }); } catch {}
          } }, 'POST VIDEO'),
          h('button', { class: 'btn' + (shareable ? ' ghost' : ' accent'), onclick: () => { download(out.blob, name); track('share_link_copied', { what: 'video_saved' }); } }, 'SAVE VIDEO')));
      status.textContent = `Ready: ${seconds} seconds, 1080×1920 ${out.ext.toUpperCase()}.${shareable ? '' : ' Save it, then post it from your phone.'}`;
      track('video_export', { kind: `${seconds}s`, genre: song.style });
    } catch (err) {
      status.textContent = err.name === 'AbortError' ? 'Cancelled.' : `Could not make the video: ${err.message}`;
      if (err.name !== 'AbortError') { console.error(err); reportError(err, { kind: 'video_export' }); }
    }
    ctrl = null; make.textContent = 'MAKE VIDEO'; progress.classList.remove('on');
    body.closest('.overlay')?.classList.remove('exporting'); lenBtns.forEach((b) => b.removeAttribute('disabled'));
  } }, 'MAKE VIDEO');
  if (!mime) { make.disabled = true; status.textContent = 'This browser cannot make videos. Open UNTERGRUND in Chrome or Safari to make one.'; }

  const credit = creditLine(song.remixOf);
  body.append(h('div', { class: 'share' },
    h('div', { class: 'share-head' }, art(song, 240),
      h('div', {}, h('b', {}, song.title), h('small', {}, `${song.artist} · ${STYLES[song.style]?.name || ''} · ${song.state.bpm} BPM`), credit && h('small', { class: 'share-credit' }, credit))),
    h('section', { class: 'share-sec' }, h('h3', {}, 'VIDEO'), h('div', { class: 'share-row' }, ...lenBtns), make, progress, status, preview),
    h('section', { class: 'share-sec' }, h('h3', {}, 'LINK'), h('p', { class: 'pub-note' }, 'Anyone who opens it hears the song right away. No account needed.'), linkBox, linkBtns),
    h('section', { class: 'share-sec' }, h('h3', {}, 'EMBED'), h('p', { class: 'pub-note' }, 'A small player for your site or blog.'),
      h('button', { class: 'btn ghost', onclick: withLinks((l) => { copy(embedCode(l.embed, song.title), toast, 'Embed code'); track('share_link_copied', { what: 'embed' }); }) }, 'COPY EMBED CODE'))));
}

// Full-screen landing for a shared song: one big PLAY (the first tap also unlocks audio), then REMIX.
export function openSharedLanding({ load, play, stop, remix, share, close, isPlaying }) {
  let song = null, done = false;
  const ov = h('div', { class: 'shared', role: 'dialog', 'aria-label': 'Shared song' });
  const artBox = h('div', { class: 'shared-art' });
  const title = h('h1', {}, 'Loading the song…'), meta = h('div', { class: 'shared-meta' }), credit = h('div', { class: 'shared-credit' });
  const label = h('span', {}, 'PLAY');
  const playBtn = h('button', { class: 'shared-play', 'aria-label': 'Play', disabled: '' }, h('i'), label);
  const remixBtn = h('button', { class: 'btn ghost shared-remix', disabled: '' }, 'REMIX IT');
  const shareBtn = h('button', { class: 'btn ghost', disabled: '' }, 'SHARE');
  const exit = () => { if (done) return; done = true; ov.remove(); removeEventListener('keydown', onKey, true); };
  const leave = () => { exit(); close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); leave(); } };
  const sync = () => { const on = isPlaying(); ov.classList.toggle('on', on); label.textContent = on ? 'STOP' : 'PLAY'; playBtn.setAttribute('aria-label', on ? 'Stop' : 'Play'); };
  playBtn.onclick = () => {
    if (!song) return;
    if (isPlaying()) stop(); else play(song);
    sync();
  };
  remixBtn.onclick = () => { if (!song) return; exit(); remix(song); };
  shareBtn.onclick = () => song && share(song);
  ov.append(h('div', { class: 'shared-card' },
    h('div', { class: 'shared-brand' }, h('i'), 'UNTERGRUND'),
    artBox, title, meta, credit, playBtn,
    h('div', { class: 'shared-actions' }, remixBtn, shareBtn),
    h('button', { class: 'shared-own', onclick: leave }, 'Make your own song →')));
  document.body.append(ov);
  addEventListener('keydown', onKey, true);
  Promise.resolve(load).then((s) => {
    if (!s) throw new Error('missing');
    song = s;
    artBox.append(art(s, 600));
    title.textContent = s.title;
    meta.textContent = `${s.artist} · ${STYLES[s.style]?.name || ''} · ${s.state.bpm} BPM`;
    credit.textContent = [creditLine(s.remixOf), s.remixes ? `${s.remixes} remix${s.remixes === 1 ? '' : 'es'}` : ''].filter(Boolean).join(' · ');
    [playBtn, remixBtn, shareBtn].forEach((b) => b.removeAttribute('disabled'));
    track('shared_open', { kind: s.trackId ? 'short' : 'code', genre: s.style });
  }).catch(() => {
    title.textContent = 'This song link is broken.';
    meta.textContent = 'It may have been cut off when it was copied.';
    artBox.remove(); playBtn.remove(); remixBtn.remove(); shareBtn.remove();
  });
  return { sync, close: exit };
}
