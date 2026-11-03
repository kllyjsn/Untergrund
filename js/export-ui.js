// FILE menu: EXPORT STEMS (.zip of aligned WAVs) and EXPORT MIDI (.mid), for taking a song into Ableton or Logic.
import { h } from './ui.js';
import { sheet } from './sets.js';
import { stemsZip, exportName } from './stems.js';
import { songMidi, songBars } from './midi.js';

const closeMenu = (e) => e.currentTarget.closest('details')?.removeAttribute('open');

export function exportButtons({ getState, getBars, download, toast, track, reportError }) {
  const stems = h('button', { class: 'btn ghost', title: 'Every instrument as its own 24-bit / 48 kHz WAV, lined up, in one .zip', onclick: (e) => { closeMenu(e); openStems(); } }, 'EXPORT STEMS');
  const midi = h('button', { class: 'btn ghost', title: 'The notes of the whole song as a MIDI file, one track per instrument', onclick: (e) => {
    closeMenu(e);
    const state = getState();
    try {
      const r = songMidi(state, { loopBars: getBars() });
      download(new Blob([r.bytes], { type: 'audio/midi' }), exportName(state, '.mid'));
      toast(`MIDI saved · ${r.tracks.length} tracks · ${r.bars} bars`);
      track('export_midi', { bars: r.bars });
    } catch (err) { console.error(err); reportError(err, { kind: 'midi' }); toast('MIDI export failed: ' + err.message); }
  } }, 'EXPORT MIDI');

  function openStems() {
    const state = getState(), bars = songBars(state, getBars()), ctrl = new AbortController();
    let done = false;
    const { body, close } = sheet('EXPORT STEMS', { onClose: () => { if (!done) ctrl.abort(); } });
    const bar = h('i'), progress = h('div', { class: 'share-progress on' }, bar);
    const status = h('div', { class: 'pub-note set-status' }, `Rendering ${bars} bars, one WAV per instrument…`);
    const cancel = h('button', { class: 'btn ghost', onclick: () => close() }, 'CANCEL');
    body.append(h('div', { class: 'share' }, h('section', { class: 'share-sec' },
      h('p', { class: 'pub-note' }, 'Drop them all at bar 1 in Ableton or Logic and they line up. Together they make your mix, before the master effects.'),
      progress, status, h('div', { class: 'share-row' }, cancel))));
    let shown = -1;
    stemsZip(state, { loopBars: getBars(), signal: ctrl.signal, onProgress: (p) => {
      const pct = Math.round(p * 100);
      if (pct === shown) return;
      shown = pct; bar.style.width = `${pct}%`; status.textContent = `Rendering ${bars} bars… ${pct}%`;
    } }).then((out) => {
      done = true;
      download(out.blob, out.name);
      close();
      toast(`${out.stems} stems saved · 48 kHz / 24-bit`);
      track('export_stems', { bars: out.bars });
    }).catch((err) => {
      if (err.name === 'AbortError') return toast('Stem export cancelled');
      console.error(err); reportError(err, { kind: 'stems' });
      status.textContent = 'Could not export the stems: ' + err.message;
    });
  }
  return [stems, midi];
}
