// CLASSICAL stage: the ORCHESTRA desk (one fader + mute per section) and a PIANO you play yourself,
// from the screen, the computer keyboard, or any MIDI keyboard (with sustain pedal).
import { h } from './ui.js';
import { SECTIONS, PART_SECTION, compose } from './classical.js';
import { loadBand } from './livekit.js';
import { scoreKinds } from './engine.js';
import { loadPiece, REPERTOIRE, writtenScore } from './repertoire.js';
import { practiceView, practiceOpen, practiceInput, closePractice } from './practice-ui.js';

const LABEL = { strings: 'STRINGS', winds: 'WOODWINDS', brass: 'BRASS', harp: 'HARP', timpani: 'TIMPANI', piano: 'PIANO' };
const KEYS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';', "'"];
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);
const PIANO_KINDS = ['pianoext', 'pianoextsoft', 'piano', 'pianosoft'];

let deps = null, octave = 4, sustain = false, pedal = false, computerKeys = true, midi = null;
const held = new Map(), ringing = new Map(), keyEls = new Map(), typed = new Map();
// PRACTICE: the keyboard spans the piece's range and a falling-notes canvas sits on top of it.
let span = null, overlay = null;

export async function preloadScore(spec) {
  if (spec?.piece) await loadPiece(spec.piece);
  return Promise.all([...new Set([...scoreKinds(spec), ...PIANO_KINDS])].map((k) => loadBand(k)));
}
export const loadPiano = () => Promise.all(PIANO_KINDS.map((k) => loadBand(k)));

function lit(m, on) { keyEls.get(m)?.classList.toggle('down', on); }
function noteOn(m, vel = 0.7) {
  deps.ensureAudio();
  const e = deps.engine();
  if (!e) return;
  if (held.has(m)) e.pianoUp(held.get(m), 0.04);
  if (ringing.has(m)) { e.pianoUp(ringing.get(m), 0.04); ringing.delete(m); }
  held.set(m, e.pianoDown(m, vel));
  lit(m, true);
  practiceInput(m, vel);
}
function noteOff(m) {
  const hd = held.get(m);
  held.delete(m);
  lit(m, false);
  if (!hd) return;
  if (sustain || pedal) ringing.set(m, hd); else deps.engine()?.pianoUp(hd);
}
function damp() {
  if (sustain || pedal) return;
  for (const hd of ringing.values()) deps.engine()?.pianoUp(hd, 0.35);
  ringing.clear();
}

function connectMidi(status) {
  if (!navigator.requestMIDIAccess) { status.textContent = 'MIDI NOT SUPPORTED IN THIS BROWSER'; return; }
  navigator.requestMIDIAccess().then((access) => {
    midi = access;
    const bind = () => {
      const ins = [...access.inputs.values()];
      for (const i of ins) i.onmidimessage = onMidi;
      status.textContent = ins.length ? `MIDI · ${ins.map((i) => i.name).join(', ').slice(0, 40)}` : 'MIDI · PLUG IN A KEYBOARD';
      status.classList.toggle('on', ins.length > 0);
    };
    access.onstatechange = bind;
    bind();
    loadPiano();
  }, () => { status.textContent = 'MIDI ACCESS DENIED'; });
}
function onMidi({ data: [st, a, b] }) {
  if (!deps) return;
  const cmd = st & 0xf0;
  if (cmd === 0x90 && b > 0) noteOn(a, 0.15 + 0.85 * (b / 127));
  else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) noteOff(a);
  else if (cmd === 0xb0 && a === 64) { pedal = b >= 64; ui.pedal?.classList.toggle('on', pedal || sustain); damp(); }
}

const ui = {};
function redrawKeys() {
  const kb = document.querySelector('.piano-wrap');
  if (!kb) return;
  const x = kb.scrollLeft;
  kb.replaceChildren(keyboard());
  kb.scrollLeft = x;
  if (ui.oct) ui.oct.textContent = `C${octave - 1} – C${octave + 1}`;
}
function keyboard() {
  keyEls.clear();
  const lo = span ? span[0] : octave * 12, hi = span ? span[1] : lo + 24, keys = [];
  for (let m = lo; m <= hi; m++) {
    const pc = m % 12, black = BLACK.has(pc), label = KEYS[m - octave * 12] || '';
    const el = h('button', { class: 'pk ' + (black ? 'black' : 'white'), 'aria-label': `${NAMES[pc]}${Math.floor(m / 12) - 1}`, 'data-m': m },
      label ? h('kbd', {}, label.toUpperCase()) : null, pc === 0 ? h('small', {}, `C${Math.floor(m / 12) - 1}`) : null);
    const down = (e) => {
      e.preventDefault();
      el.releasePointerCapture?.(e.pointerId);
      const r = el.getBoundingClientRect(), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      noteOn(m, e.pressure && e.pressure !== 0.5 ? 0.2 + 0.8 * e.pressure : 0.35 + 0.6 * y);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerenter', (e) => { if (e.buttons & 1 && !held.has(m)) down(e); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => held.has(m) && noteOff(m));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    keyEls.set(m, el);
    keys.push(el);
  }
  // Black keys sit on the boundary between white keys.
  let white = 0;
  const nWhite = keys.filter((k) => k.classList.contains('white')).length;
  for (const k of keys) {
    if (k.classList.contains('white')) { white++; continue; }
    k.style.left = `calc(${(white / nWhite) * 100}% - var(--bw) / 2)`;
  }
  const kb = h('div', { class: 'piano-keys', style: `--white:${nWhite}` }, keys);
  return overlay ? h('div', { class: 'piano-stage', style: `--white:${nWhite}` }, overlay, kb) : kb;
}

function sectionStrip(k) {
  const s = deps.state(), level = s.orch?.[k] ?? 1, muted = !!s.orchMute?.[k];
  const out = h('output', {}, `${Math.round(level * 100)}`);
  const range = h('input', { type: 'range', min: 0, max: 150, step: 1, value: Math.round(level * 100), 'aria-label': `${LABEL[k]} level`,
    oninput: (e) => { deps.state().orch[k] = +e.target.value / 100; out.textContent = e.target.value; deps.persist(); } });
  const mute = h('button', { class: 'orch-mute' + (muted ? ' on' : ''), 'aria-pressed': String(muted), title: `Mute ${LABEL[k]}`,
    onclick: () => { const st = deps.state(); st.orchMute[k] = !st.orchMute[k]; mute.classList.toggle('on', st.orchMute[k]); mute.setAttribute('aria-pressed', String(st.orchMute[k])); strip.classList.toggle('muted', st.orchMute[k]); deps.persist(); } }, 'M');
  const strip = h('div', { class: 'orch-strip' + (muted ? ' muted' : '') }, h('b', {}, LABEL[k]), range, out, mute);
  return strip;
}

// { state(), engine(), ensureAudio(), persist(), score } — score is the current pattern's score spec (or null)
export function concertPanel(d) {
  deps = d;
  const sc = d.score && compose(d.score);
  const status = h('span', { class: 'midi-status' + (midi?.inputs.size ? ' on' : '') }, midi ? (midi.inputs.size ? 'MIDI · CONNECTED' : 'MIDI · PLUG IN A KEYBOARD') : 'USB / BLUETOOTH MIDI');
  const meta = sc?.meta, piece = d.score?.piece;
  // PRACTICE: learn a piano piece from the REPERTOIRE (string quartets are listen-only).
  const raw = meta?.ensemble === 'piano' ? writtenScore(piece) : null;
  if (practiceOpen() && practiceOpen() !== (raw && piece)) closePractice();
  const pv = raw && practiceOpen() === piece ? practiceView({
    piece, raw, ensureAudio: d.ensureAudio, engine: d.engine, keyEl: (m) => keyEls.get(m),
    setOctave: (o) => { octave = Math.max(1, Math.min(6, o)); redrawKeys(); },
  }) : null;
  span = pv?.span || null;
  overlay = pv?.canvas || null;
  const kb = h('div', { class: 'piano-wrap' }, keyboard());
  const redraw = redrawKeys;
  ui.oct = h('span', { class: 'oct' }, `C${octave - 1} – C${octave + 1}`);
  ui.pedal = h('button', { class: 'btn ghost pedal' + (sustain || pedal ? ' on' : ''), 'aria-pressed': String(sustain), title: 'Sustain pedal (hold Shift, or a MIDI pedal)',
    onclick: () => { sustain = !sustain; ui.pedal.classList.toggle('on', sustain || pedal); ui.pedal.setAttribute('aria-pressed', String(sustain)); damp(); } }, 'PEDAL');
  const ck = h('button', { class: 'btn ghost ck' + (computerKeys ? ' on' : ''), title: 'Play the piano with A–L (black keys W E T Y U O P), Z / X change octave',
    onclick: () => { computerKeys = !computerKeys; ck.classList.toggle('on', computerKeys); } }, 'KEYS');
  const form = sc ? h('div', { class: 'score-map' }, sc.sections.map((x) => h('i', { style: `flex:${x.len || 1}`, title: x.name, 'data-at': x.at }, h('span', {}, x.name)))) : null;
  ui.form = form;
  loadPiano();
  const rerender = () => { const el = document.querySelector('section.concert'); if (el) el.replaceWith(concertPanel(deps)); };
  const practice = raw ? h('button', { class: 'btn ghost practice-btn' + (pv ? ' on' : ''), 'aria-pressed': String(!!pv), title: 'Learn this piece: notes fall onto the keys',
    onclick: () => { if (pv) closePractice(); else { d.stopTransport?.(); d.ensureAudio(); practiceOpen(piece); } rerender(); } }, pv ? 'DONE' : 'PRACTICE') : null;
  const head = meta
    ? h('div', { class: 'concert-head' }, h('span', { class: 'np-eyebrow' }, 'REPERTOIRE'),
      h('p', {}, h('b', {}, `${meta.composer} · ${meta.title}`), ` · ${meta.work} · ${sc.bars} bars`),
      h('small', { class: 'rep-credit' }, `${meta.license === 'CC0-1.0' ? 'CC0' : 'Public-domain'} score · ${meta.source}`))
    : h('div', { class: 'concert-head' }, h('span', { class: 'np-eyebrow' }, 'CLASSICAL STAGE'),
      h('p', {}, sc && !sc.waiting ? `${sc.bars} bars · ${sc.sections.length} sections · play along on the recorded grand` : 'Generate a piece, then play along on the recorded grand.'));
  // The catalogue of masterworks, by composer; tap one to hear it performed.
  const used = new Set(meta ? sc.notes.map((n) => PART_SECTION[n[4]]) : []);
  const current = d.score?.piece;
  const rep = d.repertoire ? h('div', { class: 'rep-list', role: 'list' },
    REPERTOIRE.map((p) => h('button', { class: 'rep' + (p.id === current ? ' on' : ''), role: 'listitem', 'aria-current': p.id === current ? 'true' : null, 'data-piece': p.id, onclick: () => d.onPiece?.(p.id) },
      h('b', {}, p.title), h('span', {}, `${p.composer.split(' ').pop()} · ${p.ensemble === 'piano' ? 'piano' : 'strings'}`)))) : null;
  return h('section', { class: 'concert' + (pv ? ' practicing' : '') },
    head,
    pv ? null : rep,
    pv ? pv.controls : form,
    h('div', { class: 'concert-grid' },
      h('div', { class: 'orch' }, h('div', { class: 'concert-label' }, 'ORCHESTRA'), (meta ? SECTIONS.filter((k) => used.has(k)) : SECTIONS).map(sectionStrip)),
      h('div', { class: 'piano' },
        h('div', { class: 'piano-bar' }, h('div', { class: 'concert-label' }, 'PIANO'), practice,
          h('button', { class: 'btn ghost', 'aria-label': 'Octave down', onclick: () => { octave = Math.max(1, octave - 1); redraw(); } }, '‹'), ui.oct,
          h('button', { class: 'btn ghost', 'aria-label': 'Octave up', onclick: () => { octave = Math.min(6, octave + 1); redraw(); } }, '›'),
          ui.pedal, ck,
          h('button', { class: 'btn ghost midi', onclick: () => connectMidi(status) }, status)),
        kb)));
}

// Light the section of the form that is playing.
export function concertBar(bar) {
  const f = ui.form;
  if (!f?.isConnected) return;
  for (const el of f.children) el.classList.toggle('now', false);
  const cells = [...f.children], i = cells.findLastIndex((el) => +el.dataset.at <= bar);
  cells.forEach((el, j) => { el.classList.toggle('now', j === i); el.classList.toggle('past', j < i); });
}

const typing = (el) => el && (el.tagName === 'INPUT' && el.type !== 'range' || el.tagName === 'TEXTAREA' || el.isContentEditable);
window.addEventListener('keydown', (e) => {
  if (!deps || !computerKeys || !document.querySelector('.concert') || typing(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'shift') { pedal = true; ui.pedal?.classList.add('on'); return; }
  if (k === 'z' || k === 'x') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) { octave = Math.max(1, Math.min(6, octave + (k === 'x' ? 1 : -1))); redrawKeys(); } return; }
  const i = KEYS.indexOf(k);
  if (i < 0) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (!e.repeat) { typed.set(k, octave * 12 + i); noteOn(octave * 12 + i, 0.72); }
}, true);
window.addEventListener('keyup', (e) => {
  if (!deps) return;
  const k = e.key.toLowerCase();
  if (k === 'shift') { pedal = false; ui.pedal?.classList.toggle('on', sustain); damp(); return; }
  if (typed.has(k)) { e.stopImmediatePropagation(); noteOff(typed.get(k)); typed.delete(k); }
}, true);
// A tab switch or lost touch must never leave a note ringing forever.
const releaseAll = () => {
  pedal = false;
  ui.pedal?.classList.toggle('on', sustain);
  for (const m of [...held.keys()]) noteOff(m);
  typed.clear();
  damp();
};
window.addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => document.hidden && releaseAll());
