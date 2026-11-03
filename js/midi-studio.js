// Studio MIDI: LEARN (click a control, move a knob or hit a pad), the setup sheet
// (mapping list, clock out / clock follow) and the clock hooks the transport calls.
// The logic lives in js/midi-core.js; this file only touches Web MIDI and the DOM.
import { h, norm, denorm } from './ui.js';
import { sheet } from './sets.js';
import { createMidiHub, targetParam, targetKind, targetLabel, sourceLabel } from './midi-core.js';

const SUPPORTED = typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
const UNSUPPORTED_MSG = 'MIDI controllers need Chrome, Edge or Firefox. Safari doesn\'t support Web MIDI yet.';
const ON_KEY = 'untergrund.midi', CLOCK_KEY = 'untergrund.midi.clock';
let api = null, hub = null, connecting = null, learn = false, denied = false, banner = null, observer = null, looping = false, redrawSetup = null;
const strips = new Set();

const readClock = () => { try { return JSON.parse(localStorage.getItem(CLOCK_KEY) || '{}') || {}; } catch { return {}; } };
const saveClock = (c) => { try { localStorage.setItem(CLOCK_KEY, JSON.stringify(c)); } catch {} };

let toastTimer = 0;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = h('div', { class: 'toast' }); document.body.append(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------------- controls on screen ----------------
function resolveTarget(el) {
  const k = el.closest?.('.knob[data-param]');
  if (k) {
    const p = k.dataset.param;
    if (k.closest('.master')) return `master:${p}`;
    const row = k.closest('.row[data-id]');
    if (row) return `track:${row.dataset.id}:${p}`;
    if (k.closest('.editor')) return `track:${api.selected()}:${p}`;
    if (p === 'swing') return 'swing';
    return null;
  }
  const perf = el.closest?.('.btn.perf');
  if (perf) return `pad:${perf.querySelector('small')?.textContent}`;
  const m = el.closest?.('.row[data-id] .m');
  if (m) return `mute:${m.closest('.row').dataset.id}`;
  const pat = el.closest?.('.pat[data-i]');
  if (pat) return `pattern:${pat.dataset.i}`;
  if (el.closest?.('.btn.play')) return 'transport:play';
  return null;
}
function controlEl(target) {
  const [kind, a, b] = target.split(':');
  if (kind === 'master') return document.querySelector(`.master .knob[data-param="${a}"]`);
  if (kind === 'swing') return document.querySelector('.top .knob[data-param="swing"]');
  if (kind === 'track') return document.querySelector(`.row[data-id="${a}"] .knob[data-param="${b}"]`)
    || (api.selected() === a ? document.querySelector(`.editor .knob[data-param="${b}"]`) : null);
  return null;
}
function stateValue(target) {
  const [kind, a, b] = target.split(':'), s = api.state();
  if (kind === 'master') return s.master[a];
  if (kind === 'swing') return s.swing;
  if (kind === 'track') return s.params[a]?.[b];
  return null;
}
function getNorm(target) {
  const q = targetParam(target); if (!q) return null;
  const el = controlEl(target), v = el?._ctl ? el._ctl.get() : stateValue(target);
  return v == null ? null : Math.max(0, Math.min(1, norm(q, v)));
}
function setNorm(target, n) {
  const q = targetParam(target); if (!q) return;
  const v = denorm(q, n), el = controlEl(target);
  if (el?._ctl) return el._ctl.set(v);
  const [kind, a, b] = target.split(':');
  if (kind === 'master') api.setMaster(a, v);
  else if (kind === 'track') api.setParam(a, b, v);
  else if (kind === 'swing') { api.state().swing = v; api.persist(); }
}
function press(target, down) {
  const [kind, a] = target.split(':');
  if (kind === 'pad') return api.pad(a, down);
  if (!down) return;
  if (kind === 'transport') return api.toggle();
  if (kind === 'mute') return document.querySelector(`.row[data-id="${a}"] .m`)?.click();
  if (kind === 'pattern') return document.querySelector(`.pat[data-i="${a}"]`)?.click();
}

// ---------------- clock in ----------------
const dateAt = (perfMs) => Date.now() - (performance.now() - perfMs);
function onClock(ev) {
  if (ev.type === 'tempo') {
    const v = Math.max(40, Math.min(240, ev.bpm)), box = document.querySelector('.top .numbox.bpm');
    if (box?._ctl) box._ctl.set(v); else { api.state().bpm = v; api.persist(); }
    paintStrips();
    return;
  }
  if (ev.type === 'stop') return api.stop();
  // A step from the clock's sender: line our transport up with it (it already sounded there).
  const at = dateAt(ev.ts) - api.latency() * 1000;
  if (ev.type === 'start' || ev.type === 'continue') { api.play(ev.step); api.align(ev.step, at, 1); return; }
  if (ev.type === 'step' && api.playing()) api.align(ev.step, at, 0.2);
}

// ---------------- clock out (called by the transport) ----------------
function syncTimebase(ctx) {
  const ts = ctx.getOutputTimestamp?.();
  if (ts && ts.performanceTime > 0 && ts.contextTime > 0) hub.timebase.update(ts.contextTime, ts.performanceTime);
  else hub.timebase.update(ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0), performance.now());
}
export function midiClockStart(ctx, step, t) { if (hub?.clockOutput && ctx) { syncTimebase(ctx); hub.clockStart(step, t); } }
export function midiClockStep(ctx, abs, t, stepSec) { if (hub?.clockOutput && ctx) { syncTimebase(ctx); hub.clockStep(abs, t, stepSec); } }
export function midiClockStop() { hub?.clockStop(); }

// ---------------- connect ----------------
function connect({ quiet = false } = {}) {
  if (!SUPPORTED) { if (!quiet) toast(UNSUPPORTED_MSG); return Promise.resolve(null); }
  if (hub) return Promise.resolve(hub);
  return connecting || (connecting = navigator.requestMIDIAccess().then((access) => {
    denied = false;
    hub = createMidiHub(access, {
      storage: localStorage, now: () => performance.now(),
      actions: {
        get: getNorm, set: setNorm, press, clock: onClock, changed: () => { paintStrips(); paintMapped(); redrawSetup?.(); },
        learned: (target, src) => {
          const el = document.querySelector('.midi-armed');
          el?.classList.remove('midi-armed');
          toast(`${targetLabel(target)} ← ${sourceLabel(src)}`);
          setBanner(`${targetLabel(target)} is mapped. Click another control, or DONE.`);
          paintMapped();
        },
        pickup: throttle((target, n, cur) => toast(`${targetLabel(target)}: turn ${n < cur ? 'up' : 'down'} to pick it up`), 1500),
        wake: () => { if (looping) return; looping = true; let last = performance.now();
          const loop = (now) => { const go = hub.frame(Math.min(0.1, (now - last) / 1000)); last = now; if (go) requestAnimationFrame(loop); else looping = false; };
          requestAnimationFrame(loop); },
      },
    });
    const c = readClock();
    if (c.follow) hub.follow(c.follow);
    if (c.out && c.out !== c.follow) hub.clockOut(c.out);
    try { localStorage.setItem(ON_KEY, '1'); } catch {}
    paintStrips();
    return hub;
  }, () => { denied = true; connecting = null; paintStrips(); if (!quiet) toast('MIDI access was blocked. Allow it in the address bar, then try again.'); return null; }));
}
function throttle(f, ms) { let t = 0; return (...a) => { const n = Date.now(); if (n - t > ms) { t = n; f(...a); } }; }

export function initMidi(a) {
  api = a;
  if (!SUPPORTED || localStorage.getItem(ON_KEY) !== '1') return;
  // Reconnect quietly only when the browser already allowed it (no surprise permission prompt).
  const q = navigator.permissions?.query?.({ name: 'midi' });
  if (!q) return;
  q.then((p) => { if (p.state === 'granted') connect({ quiet: true }); }, () => {});
}

// ---------------- LEARN ----------------
function setBanner(text) {
  if (!banner) return;
  banner.querySelector('span').textContent = text;
}
function paintMapped() {
  if (!learn || !hub) return;
  const names = hub.inputs().map((i) => i.name);
  const mapped = new Set(names.flatMap((n) => Object.values(hub.store(n).map)));
  for (const el of document.querySelectorAll('.knob[data-param], .btn.perf, .row[data-id] .m, .pat[data-i], .btn.play')) {
    const t = resolveTarget(el);
    el.classList.toggle('midi-mapped', !!t && mapped.has(t));
  }
}
function onLearnDown(e) {
  if (!learn || e.target.closest('.midi-banner, .midi-strip')) return;
  const t = resolveTarget(e.target);
  if (!t || !targetKind(t)) return;
  e.preventDefault(); e.stopPropagation();
  if (e.type !== 'pointerdown') return;
  document.querySelector('.midi-armed')?.classList.remove('midi-armed');
  e.target.closest('.knob, .btn, .pat, .m')?.classList.add('midi-armed');
  hub?.arm(t);
  setBanner(`Now move a knob or hit a pad for ${targetLabel(t)}.`);
}
function onLearnKey(e) { if (learn && e.key === 'Escape') { e.stopPropagation(); setLearn(false); } }
async function setLearn(on) {
  if (on && !(await connect())) return;
  learn = on;
  document.body.classList.toggle('midi-learn', on);
  hub?.disarm();
  document.querySelector('.midi-armed')?.classList.remove('midi-armed');
  if (on) {
    const none = !hub.inputs().length;
    banner = h('div', { class: 'midi-banner', role: 'status' },
      h('span', {}, none ? 'Plug in a MIDI controller, then click a knob or pad here.' : 'Click a knob or pad, then move a control on your MIDI gear.'),
      h('button', { class: 'btn accent', onclick: () => setLearn(false) }, 'DONE'));
    document.body.append(banner);
    for (const t of ['pointerdown', 'click']) document.addEventListener(t, onLearnDown, true);
    window.addEventListener('keydown', onLearnKey, true);
    observer = new MutationObserver(() => paintMapped());
    observer.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
    paintMapped();
  } else {
    banner?.remove(); banner = null;
    for (const t of ['pointerdown', 'click']) document.removeEventListener(t, onLearnDown, true);
    window.removeEventListener('keydown', onLearnKey, true);
    observer?.disconnect(); observer = null;
    for (const el of document.querySelectorAll('.midi-mapped')) el.classList.remove('midi-mapped');
  }
  paintStrips();
}

// ---------------- master-panel strip ----------------
function statusText() {
  if (!SUPPORTED) return 'Needs Chrome, Edge or Firefox';
  if (denied) return 'Access blocked';
  if (!hub) return 'Knobs, pads and clock';
  const ins = hub.inputs();
  const parts = [ins.length ? ins.map((i) => i.name).join(', ') : 'No controller plugged in'];
  if (hub.following) parts.push(`following ${hub.following}${hub.follower.bpm ? ` · ${hub.follower.bpm.toFixed(1)} BPM` : ''}`);
  if (hub.clockOutput) parts.push(`clock → ${hub.clockOutput}`);
  return parts.join(' · ');
}
function paintStrips() {
  for (const s of [...strips]) {
    if (!s.el.isConnected) { strips.delete(s); continue; }
    s.learn.classList.toggle('on', learn);
    s.learn.setAttribute('aria-pressed', String(learn));
    s.status.textContent = statusText();
    s.status.title = s.status.textContent;
  }
}
export function midiStrip() {
  const learnBtn = h('button', { class: 'btn toggle', title: 'Map a knob or pad to your MIDI controller', 'aria-pressed': String(learn), onclick: () => setLearn(!learn) }, 'LEARN');
  const setup = h('button', { class: 'btn ghost', title: 'Mapped controls and MIDI clock', onclick: openSetup }, 'SETUP');
  const status = h('div', { class: 'midi-status-line' });
  const el = h('div', { class: 'midi-strip' }, h('div', { class: 'glabel' }, 'MIDI'), h('div', { class: 'midi-row' }, learnBtn, setup), status);
  strips.add({ el, learn: learnBtn, status });
  queueMicrotask(paintStrips);
  return el;
}

// ---------------- setup sheet ----------------
async function openSetup() {
  const { body } = sheet('MIDI');
  if (!SUPPORTED) { body.append(h('p', { class: 'midi-note' }, UNSUPPORTED_MSG)); return; }
  body.append(h('p', { class: 'midi-note' }, 'Connecting…'));
  if (!(await connect())) { body.replaceChildren(h('p', { class: 'midi-note' }, 'MIDI access was blocked. Allow MIDI for this site in the address bar, then open this again.')); return; }
  const draw = () => {
    if (!body.isConnected) return;
    const ins = hub.inputs(), outs = hub.outputs(), c = readClock();
    const pick = (label, list, value, onchange, hint) => h('label', { class: 'club-field set-field midi-field' }, h('span', {}, label),
      h('select', { class: 'sel', onchange: (e) => { onchange(e.target.value || null); draw(); } },
        h('option', { value: '' }, 'OFF'), list.map((p) => { const o = h('option', { value: p.name }, p.name); if (p.name === value) o.selected = true; return o; })),
      h('small', {}, hint));
    const devices = ins.length ? ins.map((i) => {
      const st = hub.store(i.name), groups = new Map();
      for (const r of st.list()) { if (!groups.has(r.target)) groups.set(r.target, { label: r.label, srcs: [] }); groups.get(r.target).srcs.push(r); }
      const rows = [...groups.entries()];
      const list = rows.length ? h('ul', { class: 'midi-maps' }, rows.map(([target, g]) => h('li', {}, h('span', {}, g.label), h('small', {}, g.srcs.map((r) => r.source).join(' · ')),
        h('button', { class: 'btn ghost x', title: 'Remove', 'aria-label': `Remove ${g.label}`, onclick: () => { for (const r of g.srcs) st.remove(r.src); draw(); paintMapped(); } }, '×'))))
        : h('p', { class: 'midi-note' }, 'Nothing mapped. Tap LEARN, click a control, then move a knob.');
      const more = h('details', { class: 'midi-more' }, h('summary', {}, st.custom ? `${rows.length} mapped controls` : `Standard layout · ${rows.length} controls`), list);
      if (st.custom && rows.length <= 8) more.open = true;
      return h('div', { class: 'midi-dev' },
        h('div', { class: 'midi-dev-head' }, h('b', {}, i.name),
          st.custom ? h('button', { class: 'btn ghost', onclick: () => { st.reset(); draw(); paintMapped(); } }, 'STANDARD') : null,
          h('button', { class: 'btn ghost', onclick: () => { st.clear(); draw(); paintMapped(); } }, 'CLEAR ALL')),
        st.custom ? null : h('p', { class: 'midi-note' }, 'Knobs on CC 21–28 or 70–77 run the master; drum pads (channel 10) play ROLL, THROW, RISER, play/stop, mutes and patterns.'),
        rows.length ? more : list);
    }) : [h('p', { class: 'midi-note' }, 'No MIDI controller found. Plug one in by USB (or pair it over Bluetooth) and it shows up here.')];
    body.replaceChildren(
      h('p', { class: 'midi-note' }, 'Tap LEARN, click any knob or pad, then move a control on your gear. Knobs pick up when they reach the on-screen value, so nothing jumps.'),
      ...devices,
      h('div', { class: 'glabel' }, 'CLOCK'),
      pick('SEND CLOCK TO', outs.filter((o) => o.name !== c.follow), c.out && c.out !== c.follow ? c.out : null, (v) => { saveClock({ ...readClock(), out: v }); hub.clockOut(v); },
        'Drum machines and DAWs follow this tempo, play and stop.'),
      pick('FOLLOW CLOCK FROM', ins, c.follow, (v) => {
        const next = { ...readClock(), follow: v };
        if (v && next.out === v) { next.out = null; hub.clockOut(null); }
        saveClock(next); hub.follow(v);
      }, 'UNTERGRUND takes tempo, start and stop from this device.'));
  };
  redrawSetup = () => (body.isConnected ? draw() : (redrawSetup = null));
  draw();
}
