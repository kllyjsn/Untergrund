// Publish-to-SoundCloud modal: connect account, auto metadata + artwork, render + upload, share, and growth stats.
import { h } from './ui.js';
import { KEYS } from './params.js';
import { STYLES } from './state.js';
import { drawArtwork, canvasToBlob } from './artwork.js';
import * as sc from './soundcloud.js';

const WORDS_A = ['Beton', 'Stahl', 'Nacht', 'Tief', 'Dunkel', 'Strom', 'Schacht', 'Nebel', 'Kessel', 'Puls', 'Kammer', 'Vakuum', 'Spree', 'Transit', 'Signal'];
const WORDS_B = ['Ritual', 'Schicht', 'Garage', 'Frequenz', 'Maschine', 'Hall', 'Tunnel', 'Werk', 'Zone', 'Bunker', 'Druck', 'Kreis', 'Linie', 'Feld', 'Raum'];
const LICENSES = [
  ['all-rights-reserved', 'All rights reserved'],
  ['cc-by', 'CC BY — DJs/remixers may use with credit'],
  ['cc-by-nc', 'CC BY-NC — non-commercial use with credit'],
  ['cc-by-sa', 'CC BY-SA — share-alike'],
];
const STORE = 'untergrund.releases';
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const randomTitle = () => (Math.random() < 0.7 ? `${pick(WORDS_A)} ${pick(WORDS_B)}` : `${pick(WORDS_A)}${pick(WORDS_B).toLowerCase()}`);
const releases = () => { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } };
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const fmtNum = (n) => (n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k' : String(n ?? 0));

export function autoTags(state, style) {
  const s = STYLES[style]?.name.toLowerCase() || '';
  return ['techno', s && `${s} techno`, 'berlin techno', 'warehouse', 'underground techno', `${state.bpm} bpm`,
    `${KEYS[state.key]} ${state.scale || 'minor'}`, 'electronic', 'synthesizer', state.artist?.name?.toLowerCase(), 'untergrund'].filter(Boolean);
}

export function autoDescription(state, style, bars) {
  const s = STYLES[style]?.name.toLowerCase() || 'techno';
  return [`${s[0].toUpperCase() + s.slice(1)} techno · ${state.bpm} BPM · ${KEYS[state.key]} ${state.scale || 'minor'} · ${bars} bars.`,
    '', 'Made in UNTERGRUND from its own synths and royalty-free (CC0) recorded instruments.',
    'DJs: free download is on, play it out and tag me.', '', 'Follow for a new track every week.'].join('\n');
}

// Consecutive ISO weeks (ending this week or last) with at least one release.
export function weekStreak(dates) {
  const week = (d) => Math.floor((new Date(d).getTime() / 864e5 + 3) / 7);
  const set = new Set(dates.map(week));
  let w = week(Date.now());
  if (!set.has(w)) w -= 1;
  let n = 0;
  while (set.has(w)) { n++; w--; }
  return n;
}

export function openPublish({ getState, getStyle, render, toast, audio = null, title: presetTitle = '' }) {
  const state = getState();
  const style = getStyle();
  let seed = (Math.random() * 1e9) | 0;
  let busy = false;

  const close = () => { if (!busy) ov.remove(); };
  const ov = h('div', { class: 'overlay', onclick: (e) => e.target === ov && close() });
  const body = h('div', { class: 'pub-body' });
  const modal = h('div', { class: 'modal panel pub' },
    h('div', { class: 'pub-head' }, h('div', { class: 'mtitle' }, 'PUBLISH · SOUNDCLOUD'), h('button', { class: 'btn ghost', onclick: close }, 'CLOSE')),
    body);
  ov.append(modal);
  document.body.append(ov);
  const onKey = (e) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onKey, true); } e.stopPropagation(); };
  window.addEventListener('keydown', onKey, true);
  new MutationObserver((_, o) => { if (!ov.isConnected) { window.removeEventListener('keydown', onKey, true); o.disconnect(); } }).observe(document.body, { childList: true });

  body.append(h('div', { class: 'pub-note' }, 'Checking SoundCloud…'));
  sc.getConfig().then((cfg) => {
    body.innerHTML = '';
    if (!cfg.enabled) return body.append(setupHelp());
    body.append(accountBar(), form(), growthPanel());
  });

  function setupHelp() {
    return h('div', { class: 'pub-setup' },
      h('p', {}, 'SoundCloud publishing is not configured on this server yet.'),
      h('ol', {},
        h('li', {}, 'Register an app at soundcloud.com/you/apps.'),
        h('li', {}, 'Set its redirect URI to ', h('code', {}, `${location.origin}/sc-callback.html`)),
        h('li', {}, 'Set ', h('code', {}, 'SOUNDCLOUD_CLIENT_ID'), ' and ', h('code', {}, 'SOUNDCLOUD_CLIENT_SECRET'), ' on the server and redeploy.')),
      h('p', { class: 'dim' }, 'Until then, EXPORT WAV and upload manually.'));
  }

  // ---- account ----
  const acct = h('div', { class: 'pub-acct' });
  function accountBar() { renderAccount(); return acct; }
  async function renderAccount() {
    acct.innerHTML = '';
    if (!sc.isConnected()) {
      acct.append(h('div', { class: 'dim' }, 'Connect your SoundCloud account to publish straight from the groovebox.'),
        h('button', { class: 'btn sc', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; b.textContent = 'CONNECTING…';
          try { await sc.connect(); toast('SoundCloud connected'); renderAccount(); refreshGrowth(); updatePublishBtn(); }
          catch (err) { toast(err.message); b.disabled = false; b.textContent = 'CONNECT SOUNDCLOUD'; }
        } }, 'CONNECT SOUNDCLOUD'));
      return;
    }
    acct.append(h('div', { class: 'dim' }, 'Loading account…'));
    try {
      const u = await sc.me();
      acct.innerHTML = '';
      acct.append(
        h('div', { class: 'who' }, u.avatar_url ? h('img', { src: u.avatar_url, alt: '' }) : h('i'),
          h('div', {}, h('a', { href: u.permalink_url, target: '_blank', rel: 'noopener' }, u.username),
            h('div', { class: 'dim' }, `${fmtNum(u.followers_count)} followers · ${fmtNum(u.track_count)} tracks`))),
        h('button', { class: 'btn ghost', onclick: () => { sc.disconnect(); renderAccount(); refreshGrowth(); updatePublishBtn(); } }, 'DISCONNECT'));
    } catch (err) {
      acct.innerHTML = '';
      acct.append(h('div', { class: 'dim' }, err.message), h('button', { class: 'btn ghost', onclick: () => { sc.disconnect(); renderAccount(); } }, 'RECONNECT'));
    }
  }

  // ---- release form ----
  let pubBtn, fields;
  function updatePublishBtn() { if (pubBtn) pubBtn.disabled = busy || !sc.isConnected(); }
  function form() {
    const barOpts = [32, 64, 96, 128, 160];
    const defBars = state.chainOn ? 128 : 64;
    const secs = (b) => (b * 4 * 60) / state.bpm;
    fields = {
      title: h('input', { class: 'inp', value: state.artist?.title || randomTitle(), maxlength: 100 }),
      bars: h('select', { class: 'sel' }, barOpts.map((b) => { const o = h('option', { value: b }, `${b} bars · ${fmtDur(secs(b))}`); if (b === defBars) o.selected = true; return o; })),
      genre: h('input', { class: 'inp', value: 'Techno', maxlength: 40 }),
      tags: h('input', { class: 'inp', value: autoTags(state, style).join(', ') }),
      desc: h('textarea', { class: 'inp', rows: 6 }),
      sharing: h('select', { class: 'sel' }, h('option', { value: 'public' }, 'Public'), h('option', { value: 'private' }, 'Private (test first)')),
      downloadable: h('input', { type: 'checkbox', checked: true }),
      license: h('select', { class: 'sel' }, LICENSES.map(([v, l]) => h('option', { value: v }, l))),
    };
    fields.desc.value = autoDescription(state, style, defBars);
    fields.bars.onchange = () => { fields.desc.value = autoDescription(state, style, +fields.bars.value); };
    if (presetTitle) fields.title.value = presetTitle;
    const art = h('div', { class: 'pub-art' });
    const paint = () => { art.innerHTML = ''; art.append(drawArtwork(state, { title: fields.title.value || 'UNTITLED', style: STYLES[style]?.name, seed, size: 600 })); };
    fields.title.oninput = paint;
    paint();

    const progress = h('div', { class: 'pub-progress' }, h('i'));
    const status = h('div', { class: 'pub-status dim' });
    const result = h('div', { class: 'pub-result' });
    pubBtn = h('button', { class: 'btn accent pub-go', onclick: () => publish({ progress, status, result }) }, 'RENDER + PUBLISH');
    updatePublishBtn();

    const row = (label, el, hint) => h('label', { class: 'pub-row' }, h('span', {}, label), el, hint ? h('small', { class: 'dim' }, hint) : null);
    return h('div', { class: 'pub-form' },
      h('div', { class: 'pub-left' }, art,
        h('div', { class: 'pub-art-tools' },
          h('button', { class: 'btn ghost', onclick: () => { seed = (Math.random() * 1e9) | 0; paint(); } }, 'NEW ARTWORK'),
          h('button', { class: 'btn ghost', onclick: () => { fields.title.value = randomTitle(); paint(); } }, 'NEW TITLE'))),
      h('div', { class: 'pub-right' },
        row('TITLE', fields.title),
        h('div', { class: 'pub-two' }, audio ? null : row('LENGTH', fields.bars, state.chainOn ? 'follows your chain' : 'loops current pattern — turn on CHAIN for an arrangement'), row('GENRE', fields.genre)),
        row('TAGS', fields.tags, 'comma separated — specific tags are how listeners find you'),
        row('DESCRIPTION', fields.desc),
        h('div', { class: 'pub-two' }, row('VISIBILITY', fields.sharing), row('LICENSE', fields.license)),
        h('label', { class: 'pub-check' }, fields.downloadable, h('span', {}, 'Free download (DJs can play it out)')),
        pubBtn, progress, status, result));
  }

  async function publish({ progress, status, result }) {
    const title = fields.title.value.trim();
    if (!title) return toast('Give it a title');
    busy = true; updatePublishBtn(); result.innerHTML = '';
    const bar = progress.firstChild;
    const set = (p, msg) => { progress.classList.add('on'); bar.style.width = `${Math.round(p * 100)}%`; status.textContent = msg; };
    try {
      const bars = +fields.bars.value;
      set(0.03, `Rendering ${bars} bars offline…`);
      const wav = audio || await render(bars);
      set(0.25, 'Drawing artwork…');
      const artwork = await canvasToBlob(drawArtwork(state, { title, style: STYLES[style]?.name, seed, size: 1200 }));
      const meta = { title, description: fields.desc.value, genre: fields.genre.value.trim(), sharing: fields.sharing.value,
        tags: fields.tags.value.split(',').map((t) => t.trim()).filter(Boolean), downloadable: fields.downloadable.checked, license: fields.license.value };
      const mb = (wav.size / 1048576).toFixed(1);
      const track = await sc.uploadTrack(wav, artwork, meta, (p) => set(0.3 + p * 0.68, `Uploading ${mb} MB to SoundCloud… ${Math.round(p * 100)}%`));
      set(1, 'Published — SoundCloud is processing the audio (usually under a minute).');
      const list = releases(); list.push({ id: track.id, title, url: track.permalink_url, at: new Date().toISOString() });
      localStorage.setItem(STORE, JSON.stringify(list.slice(-200)));
      result.append(shareBox(track, title));
      toast(`“${title}” is on SoundCloud`);
      renderAccount(); refreshGrowth();
    } catch (err) {
      console.error(err);
      progress.classList.remove('on'); status.textContent = 'Failed: ' + err.message;
    }
    busy = false; updatePublishBtn();
  }

  function shareBox(track, title) {
    const url = track.permalink_url;
    const text = `New track: ${title} — ${state.bpm} BPM, made in UNTERGRUND.`;
    const copy = (s, msg) => navigator.clipboard?.writeText(s).then(() => toast(msg), () => toast('Copy failed'));
    const embed = `<iframe width="100%" height="166" scrolling="no" frameborder="no" allow="autoplay" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff2b2b"></iframe>`;
    const link = (label, href) => h('a', { class: 'btn ghost', href, target: '_blank', rel: 'noopener' }, label);
    return h('div', { class: 'pub-share' },
      h('a', { class: 'pub-link', href: url, target: '_blank', rel: 'noopener' }, url),
      h('div', { class: 'pub-share-btns' },
        h('button', { class: 'btn', onclick: () => copy(url, 'Link copied') }, 'COPY LINK'),
        link('POST ON X', `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`),
        link('WHATSAPP', `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`),
        link('TELEGRAM', `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`),
        h('button', { class: 'btn ghost', onclick: () => copy(embed, 'Embed code copied') }, 'EMBED')));
  }

  // ---- growth ----
  const growth = h('div', { class: 'pub-growth' });
  function growthPanel() { refreshGrowth(); return growth; }
  async function refreshGrowth() {
    growth.innerHTML = '';
    let tracks = [];
    if (sc.isConnected()) { try { tracks = await sc.myTracks(50); } catch { /* stats are best-effort */ } }
    const dates = tracks.length ? tracks.map((t) => t.created_at) : releases().map((r) => r.at);
    const sum = (k) => tracks.reduce((n, t) => n + (t[k] ?? (k === 'favoritings_count' ? t.likes_count : 0) ?? 0), 0);
    const streak = weekStreak(dates);
    const last = dates.length ? Math.max(...dates.map((d) => new Date(d).getTime())) : 0;
    const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
    const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l));
    growth.append(
      h('div', { class: 'mlabel' }, 'GROWTH'),
      h('div', { class: 'stats' }, stat(fmtNum(sum('playback_count')), 'plays'), stat(fmtNum(sum('favoritings_count')), 'likes'),
        stat(fmtNum(sum('reposts_count')), 'reposts'), stat(`${streak}w`, 'release streak')),
      h('div', { class: 'pub-nudge' }, days == null ? 'First release — consistency beats virality: aim for one track a week.'
        : days >= 7 ? `${days} days since your last release — publish this week to keep momentum.` : `Released ${days === 0 ? 'today' : days + 'd ago'} — next one due in ${7 - days}d.`),
      tracks.length ? h('div', { class: 'pub-tracks' }, tracks.slice(0, 5).map((t) =>
        h('a', { href: t.permalink_url, target: '_blank', rel: 'noopener' }, h('span', {}, t.title),
          h('small', {}, `${fmtNum(t.playback_count)} ▶ · ${fmtNum(t.favoritings_count ?? t.likes_count)} ♥`)))) : null,
      h('ul', { class: 'pub-tips' },
        h('li', {}, 'Free download + CC BY license = DJs can legally play it out. That is how techno tracks spread.'),
        h('li', {}, 'Use specific tags (style, BPM, key). Listeners and DJs search that way.'),
        h('li', {}, 'Send each release to techno repost channels and collectives yourself, and answer every comment.'),
        h('li', {}, 'Avoid follow-for-follow or bought plays. SoundCloud removes them and it can get your account banned.')));
  }
}
