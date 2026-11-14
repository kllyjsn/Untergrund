// Library: every song made in this browser, newest first, like a music app's library. Tap one to play it;
// PLAY plays the list in order (then Radio keeps going). LIKED shows the songs you loved. The Jukebox is one tap away.
import { h } from './ui.js';
import { sheet } from './sets.js';
import { drawArtwork, artSeed } from './artwork.js';
import { parseChain } from './engine.js';
import { songFingerprint } from './listen.js';

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
export function songSeconds(state) {
  const bars = state?.chainOn ? parseChain(state.chain || '').length : 0;
  return bars && state.bpm ? (bars * 4 * 60) / state.bpm : 0;
}

// tracks(): libraryTracks (re-read on every paint); styles: STYLES; isLoved/isDowned(fp); nowFp(): fingerprint playing now;
// onPlay(items, i): play items[i] and queue the rest; radio: { on(), toggle() }.
export function openLibrary({ tracks, styles, hue, isLoved, isDowned, nowFp, onPlay, onJukebox, onCreate, radio, onClose }) {
  let filter = 'all';
  let items = [];
  const lib = sheet('LIBRARY', { onClose });
  const { body } = lib;
  body.closest('.modal')?.classList.add('lib-modal');
  body.closest('.overlay')?.classList.add('lib-ov');
  const list = h('div', { class: 'lib-list', role: 'list' });
  const tabs = h('div', { class: 'jb-tabs lib-tabs', role: 'group', 'aria-label': 'Show' });
  const radioBtn = h('button', { class: 'btn ghost lib-radio', type: 'button', onclick: () => { radio.toggle(); paintRadio(); } }, 'RADIO');
  const playAll = h('button', { class: 'btn accent lib-play', type: 'button', onclick: () => { const v = visible(); if (v.length) onPlay(v, 0); paint(); } }, 'PLAY');
  const visible = () => items.filter((t) => (filter === 'liked' ? isLoved(t.fp) : true));
  function paintRadio() {
    const on = radio.on();
    radioBtn.classList.toggle('on', on);
    radioBtn.setAttribute('aria-pressed', String(on));
    radioBtn.title = on ? 'Radio on: when the list ends, new songs keep coming' : 'Radio off: music stops after each song';
  }
  function paintTabs() {
    const liked = items.filter((t) => isLoved(t.fp)).length;
    tabs.replaceChildren(...[['all', `SONGS ${items.length}`], ['liked', `LIKED ${liked}`]].map(([id, label]) =>
      h('button', { class: 'family-tab' + (filter === id ? ' on' : ''), 'aria-pressed': String(filter === id), onclick: () => { filter = id; paint(); } }, label)));
  }
  function row(t, i, v, playingFp) {
    const s = styles[t.style], secs = songSeconds(t.state), now = playingFp === t.fp;
    const art = h('span', { class: 'lib-art', 'aria-hidden': 'true' });
    requestAnimationFrame(() => { try { art.append(drawArtwork(t.state, { title: t.title, style: s?.name, seed: artSeed(`${t.title}|${s?.name}`), size: 96 })); } catch {} });
    return h('button', { class: 'lib-row' + (now ? ' now' : '') + (isDowned(t.fp) ? ' downed' : ''), role: 'listitem', style: `--hue:${hue(t.style)}`, title: `Play “${t.title || 'Untitled'}”`,
      onclick: () => { onPlay(v, i); paint(); } },
      art,
      h('span', { class: 'lib-text' }, h('b', {}, t.title || 'Untitled'), h('span', {}, [t.artist, s?.name].filter(Boolean).join(' · '))),
      isLoved(t.fp) ? h('i', { class: 'lib-loved', title: 'Loved', 'aria-label': 'Loved' }) : h('i', { class: 'lib-gap', 'aria-hidden': 'true' }),
      h('span', { class: 'lib-time' }, secs ? fmt(secs) : ''));
  }
  function paint() {
    items = tracks().map((t) => ({ ...t, fp: songFingerprint(t.state) }));
    paintRadio();
    paintTabs();
    const v = visible(), playingFp = nowFp();
    list.replaceChildren(...(v.length ? v.map((t, i) => row(t, i, v, playingFp)) : [h('div', { class: 'jb-empty' },
      filter === 'liked' ? 'Songs you love show up here. Tap the heart while one plays.' : 'Every song you make lands here.',
      filter === 'liked' ? '' : h('button', { class: 'btn accent', onclick: () => { lib.close(); onCreate(); } }, 'GENERATE A SONG'))]));
    playAll.disabled = !v.length;
  }
  body.append(
    h('div', { class: 'lib-head' }, playAll, radioBtn, tabs),
    list,
    h('button', { class: 'lib-jukebox', type: 'button', onclick: () => { lib.close(); onJukebox(); } },
      h('span', {}, h('b', {}, 'JUKEBOX'), h('small', {}, 'Songs and sets everyone published')), h('i', { 'aria-hidden': 'true' })));
  paint();
  return { el: body, close: lib.close, paint };
}
