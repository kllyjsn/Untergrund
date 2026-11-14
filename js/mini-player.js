// The mini-player: the song you hear, on every screen (above the phone tab bar, along the bottom on desktop).
// Art, title, love / not for me, play-pause and next; tap the title to go back to Now Playing. Never shown over GENERATE.
import { h } from './ui.js';
import { drawArtwork, artSeed } from './artwork.js';

export function createMiniPlayer({ onOpen, onToggle, onNext, onRadio }) {
  const art = h('span', { class: 'mini-art', 'aria-hidden': 'true' });
  const title = h('b', {}), sub = h('span', {});
  const fill = h('i', { class: 'mini-fill' });
  const react = h('span', { class: 'mini-react' });
  const reasons = h('div', { class: 'mini-why-wrap' });
  const play = h('button', { class: 'mini-play', type: 'button', onclick: onToggle }, h('i', { 'aria-hidden': 'true' }));
  const next = h('button', { class: 'mini-next', type: 'button', title: 'Next song', 'aria-label': 'Next song', onclick: onNext }, h('i', { 'aria-hidden': 'true' }));
  const radio = h('button', { class: 'mini-radio', type: 'button', onclick: onRadio }, 'RADIO');
  const el = h('div', { class: 'miniplayer', role: 'region', 'aria-label': 'Now playing', hidden: '' },
    reasons,
    h('button', { class: 'mini-open', type: 'button', title: 'Open Now Playing', onclick: onOpen }, art, h('span', { class: 'mini-text' }, title, sub)),
    react, radio, play, next,
    h('span', { class: 'mini-progress', 'aria-hidden': 'true' }, fill));
  let key = '', artKey = '';
  return {
    el,
    // song: { title, artist, styleName, hue, state, playing, radio, listen } (listen: the id of the listen, to rebuild reactions)
    paint(song, reactions) {
      const k = [song.title, song.artist, song.styleName, song.playing, song.radio, song.listen].join('|');
      if (k === key) return;
      key = k;
      el.style.setProperty('--hue', song.hue);
      title.textContent = song.title;
      sub.textContent = [song.artist, song.styleName].filter(Boolean).join(' · ');
      play.classList.toggle('on', !!song.playing);
      play.setAttribute('aria-label', song.playing ? 'Pause' : 'Play');
      play.title = song.playing ? 'Pause (Space)' : 'Play (Space)';
      radio.classList.toggle('on', !!song.radio);
      radio.setAttribute('aria-pressed', String(!!song.radio));
      radio.title = song.radio ? 'Radio on: a new song starts when this one ends' : 'Radio off: music stops when this song ends';
      const ak = `${song.title}|${song.styleName}`;
      if (ak !== artKey && song.state) {
        artKey = ak;
        try { art.replaceChildren(drawArtwork(song.state, { title: song.title, style: song.styleName, seed: artSeed(ak), size: 96 })); } catch { art.replaceChildren(); }
      }
      const r = reactions();
      react.replaceChildren(...[r.buttons].filter(Boolean));
      reasons.replaceChildren(...[r.reasons].filter(Boolean));
    },
    progress(pct) { fill.style.width = `${Math.max(0, Math.min(100, pct))}%`; },
    show(on) {
      if (el.hidden === !on) return;
      el.hidden = !on;
      document.body.classList.toggle('mini-on', on);
    },
  };
}
