// PRACTICE view: falling notes over the concert piano, Wait / Play-along runs, live feedback and a
// summary. The scoring lives in js/practice.js; the piano (screen, computer keys, MIDI) in js/concert.js.
import { h } from './ui.js';
import { timeline, createSession, keyRange, bestOctave, recordBest, HANDS } from './practice.js';

const SETTINGS = 'untergrund.practice', BEST = 'untergrund.practice.best';
const COLOR = { 0: '#7fd8ff', 1: '#ffb56b' }, OK = '#7dffa8', BAD = '#ff5c74';
const LOOK = 3; // seconds of music visible above the keys
const HAND_LABEL = { right: 'RIGHT', left: 'LEFT', both: 'BOTH' };
const read = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return { ...d }; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const P = { piece: null, api: null, raw: null, opts: null, from: 0, to: 0, loop: false, session: null, running: false, last: 0, summary: null, newBest: false, ui: {}, marks: [], autos: [], lit: new Set(), geo: null, raf: 0 };

export function practiceOpen(id) {
  if (id && id !== P.piece) {
    closePractice();
    P.piece = id; P.opts = read(SETTINGS, { mode: 'wait', hands: 'right', speed: 0.6, other: true });
    P.from = 0; P.to = 0; P.loop = false; P.summary = null; P.session = null;
  }
  return P.piece;
}

export function closePractice() {
  pause();
  silence();
  clearLit();
  if (P.raf) cancelAnimationFrame(P.raf);
  Object.assign(P, { piece: null, api: null, raw: null, session: null, summary: null, raf: 0, ui: {}, marks: [] });
}

function silence() {
  const e = P.api?.engine();
  for (const a of P.autos) { clearTimeout(a.on); clearTimeout(a.off); a.el?.classList.remove('pr-auto'); if (e && a.hd) e.pianoUp(a.hd, 0.08); }
  P.autos = [];
}

function fresh() {
  silence();
  clearLit();
  const tl = timeline(P.raw, { hands: HANDS[P.opts.hands], from: P.from, to: P.to });
  P.session = createSession(tl, { mode: P.opts.mode, speed: P.opts.speed, autoOther: P.opts.other, loop: P.loop });
  P.running = false;
  P.marks = [];
}

export function practiceView(api) {
  P.api = api; P.raw = api.raw;
  const bars = P.raw.bars;
  if (!P.to || P.to > bars) { P.from = 0; P.to = bars; }
  if (!P.session) { fresh(); queueMicrotask(() => P.api?.setOctave(bestOctave(P.session.tl))); }
  P.ui.canvas = h('canvas', { class: 'pr-canvas', 'aria-label': 'Falling notes' });
  P.geo = null;
  P.ui.controls = controls();
  if (!P.raf) P.raf = requestAnimationFrame(frame);
  return { controls: P.ui.controls, canvas: P.ui.canvas, span: keyRange(P.raw) };
}

// ---------- controls ----------
function seg(label, value, items, pick) {
  return h('div', { class: 'pr-seg', role: 'group', 'aria-label': label },
    items.map(([v, text, title]) => h('button', { class: 'pr-opt' + (v === value ? ' on' : ''), 'aria-pressed': String(v === value), title, onclick: (e) => { e.currentTarget.blur(); pick(v); } }, text)));
}
function setOpt(k, v) {
  P.opts[k] = v;
  write(SETTINGS, P.opts);
  P.summary = null;
  fresh();
  if (k === 'hands') P.api.setOctave(bestOctave(P.session.tl));
  refresh();
}
function setRange(from, to, loop = P.loop) {
  const bars = P.raw.bars;
  P.from = Math.max(0, Math.min(bars - 1, from));
  P.to = Math.max(P.from + 1, Math.min(bars, to));
  P.loop = loop;
  P.summary = null;
  fresh();
  refresh();
}
function refresh() {
  const old = P.ui.controls;
  P.ui.controls = controls();
  old?.replaceWith(P.ui.controls);
}

function controls() {
  const o = P.opts, raw = P.raw, bars = raw.bars;
  const sections = (raw.sections || []).map((x, i, a) => ({ name: x.name, from: x.at, to: a[i + 1]?.at ?? bars }));
  const cur = P.from === 0 && P.to === bars ? 'all' : sections.findIndex((x) => x.from === P.from && x.to === P.to);
  const pick = h('select', { class: 'pr-select', 'aria-label': 'Bars to practise',
    onchange: (e) => { const v = e.target.value; if (v === 'all') setRange(0, bars); else if (v !== 'custom') setRange(sections[+v].from, sections[+v].to); } },
    h('option', { value: 'all' }, `Whole piece · ${bars} bars`),
    sections.map((x, i) => h('option', { value: String(i) }, /^BARS? /.test(x.name) ? x.name[0] + x.name.slice(1).toLowerCase() : `${x.name} · bars ${x.from + 1}–${x.to}`)),
    cur === -1 ? h('option', { value: 'custom' }, `Bars ${P.from + 1}–${P.to}`) : null);
  pick.value = cur === -1 ? 'custom' : String(cur);
  const num = (value, set, label) => h('input', { class: 'pr-num', type: 'number', inputmode: 'numeric', min: 1, max: bars, value, 'aria-label': label,
    onchange: (e) => set(Math.round(+e.target.value) || 1) });
  const speed = h('output', {}, `${Math.round(o.speed * 100)}%`);
  const s = P.session, other = o.hands === 'right' ? 'LEFT' : 'RIGHT';
  P.ui.run = h('button', { class: 'pr-go', onclick: (e) => { e.currentTarget.blur(); toggleRun(); } }, runLabel());
  P.ui.stop = h('button', { class: 'btn ghost pr-stop', onclick: (e) => { e.currentTarget.blur(); finish(); } }, 'STOP');
  P.ui.stop.hidden = !(s?.started && !s.done);
  P.ui.bar = h('b', {}, '');
  P.ui.section = h('span', {}, '');
  P.ui.count = h('span', { class: 'pr-count' }, '');
  P.ui.panel = h('div', { class: 'pr-panel' }, P.summary ? summary() : hint());
  const best = read(BEST, {})[P.piece];
  return h('div', { class: 'practice' },
    h('div', { class: 'pr-row' },
      seg('Mode', o.mode, [['wait', 'WAIT', 'The music waits for you'], ['play', 'PLAY ALONG', 'The music keeps going and scores you']], (v) => setOpt('mode', v)),
      seg('Hands', o.hands, Object.entries(HAND_LABEL).map(([k, v]) => [k, v, k === 'both' ? 'Both hands' : `${v[0]}${v.slice(1).toLowerCase()} hand`]), (v) => setOpt('hands', v)),
      h('label', { class: 'pr-speed' }, h('span', {}, 'SPEED'),
        h('input', { type: 'range', min: 25, max: 100, step: 5, value: Math.round(o.speed * 100), 'aria-label': 'Speed',
          oninput: (e) => { o.speed = +e.target.value / 100; speed.textContent = `${e.target.value}%`; P.session?.setSpeed(o.speed); write(SETTINGS, o); } }), speed)),
    h('div', { class: 'pr-row' },
      h('div', { class: 'pr-pick' }, pick,
        h('button', { class: 'pr-opt pr-toggle' + (P.loop ? ' on' : ''), 'aria-pressed': String(P.loop), title: 'Repeat these bars', onclick: () => setRange(P.from, P.to, !P.loop) }, 'LOOP')),
      h('span', { class: 'pr-bars' }, 'BARS', num(P.from + 1, (v) => setRange(v - 1, Math.max(v, P.to)), 'First bar'), '–', num(P.to, (v) => setRange(Math.min(P.from, v - 1), v), 'Last bar')),
      o.hands === 'both' ? null : h('button', { class: 'pr-opt pr-toggle' + (o.other ? ' on' : ''), 'aria-pressed': String(o.other), title: `The ${other.toLowerCase()} hand plays itself`, onclick: () => setOpt('other', !o.other) }, `HEAR ${other} HAND`)),
    h('div', { class: 'pr-row pr-status' }, P.ui.run, P.ui.stop,
      h('div', { class: 'pr-where' }, P.ui.bar, P.ui.section), P.ui.count,
      best ? h('span', { class: 'pr-best' }, `BEST ${best.accuracy}%`) : null),
    P.ui.panel);
}
function runLabel() {
  const s = P.session;
  return P.running ? 'PAUSE' : s?.started && !s.done ? 'RESUME' : 'START';
}
function hint() {
  return h('p', { class: 'pr-hint' },
    P.opts.mode === 'wait' ? 'Play the lit keys. The music waits for you.' : 'Play each note as it reaches the keys. Green is right, red is wrong.',
    h('span', { class: 'pr-keys' }, ' Computer keys: A–L, black keys W E T Y U O P, Z / X octave, Shift pedal, Space start.'));
}
function summary() {
  const m = P.summary;
  const lean = m.lean == null || Math.abs(m.lean) < 25 ? '' : m.lean < 0 ? ', a little early' : ', a little late';
  const facts = [
    m.mode === 'play' ? `${m.hits} of ${m.judged} notes` : `${m.hits} notes right`,
    `${m.wrong} wrong`,
    m.mode === 'play' ? `${m.missed} missed` : null,
    m.timing != null ? `timing ±${m.timing} ms${lean}` : null,
    m.pass > 1 ? `${m.pass} times through` : null,
  ].filter(Boolean).join(' · ');
  return h('div', { class: 'pr-sum' },
    h('div', { class: 'pr-acc' }, h('b', {}, m.accuracy == null ? '–' : `${m.accuracy}%`), h('span', {}, P.newBest ? 'NEW BEST' : 'ACCURACY')),
    h('div', { class: 'pr-facts' }, h('p', {}, facts),
      m.worst.length ? h('div', { class: 'pr-worst' }, h('span', {}, 'PRACTISE'),
        m.worst.map((w) => h('button', { class: 'pr-opt', title: `Loop bar ${w.bar + 1}`, onclick: () => setRange(w.bar, w.bar + 1, true) }, `BAR ${w.bar + 1}`))) : h('p', {}, 'Clean run.')));
}

// ---------- running ----------
function toggleRun() { if (P.running) pause(); else start(); }
function start() {
  if (!P.session) return;
  P.api.ensureAudio();
  if (P.session.done) fresh();
  if (P.summary) { P.summary = null; P.ui.panel?.replaceChildren(hint()); }
  P.running = true;
  P.last = performance.now();
  syncButtons();
}
function pause() {
  if (!P.running) return;
  P.running = false;
  silence();
  syncButtons();
}
function finish() {
  const s = P.session;
  if (!s) return;
  P.running = false;
  silence();
  s.done = true;
  P.summary = s.summary();
  const { store, best } = recordBest(read(BEST, {}), P.piece, P.summary);
  P.newBest = best && P.summary.accuracy > 0;
  if (best) write(BEST, store);
  refresh();
}
function syncButtons() {
  if (P.ui.run) P.ui.run.textContent = runLabel();
  if (P.ui.stop) P.ui.stop.hidden = !(P.session?.started && !P.session.done);
}

function step(now) {
  const dt = Math.min(0.25, (now - P.last) / 1000);
  P.last = now;
  handle(P.session.advance(dt));
}
function handle(out) {
  for (const a of out.autos || []) sound(a);
  for (const n of out.missed || []) { flash(n.m, false); P.marks.push({ m: n.m, ok: false, text: 'MISSED', t: performance.now() }); }
  if (out.looped) silence();
  if (out.ended) finish();
}
function sound(a) {
  const e = P.api.engine();
  if (!e) return;
  const hd = e.orch('pno', e.ctx.currentTime + 0.01 + a.delay, a.m, a.d, a.v * 0.85);
  const el = P.api.keyEl(a.m), rec = { hd, el };
  if (el) {
    rec.on = setTimeout(() => { el.style.setProperty('--pr', COLOR[a.hand]); el.classList.add('pr-auto'); }, a.delay * 1000);
    rec.off = setTimeout(() => { el.classList.remove('pr-auto'); P.autos = P.autos.filter((x) => x !== rec); }, (a.delay + Math.min(a.d, 1.2)) * 1000);
  }
  P.autos.push(rec);
}
function flash(m, ok) {
  const el = P.api?.keyEl(m);
  if (!el) return;
  const c = ok ? 'pr-ok' : 'pr-bad';
  el.classList.remove('pr-ok', 'pr-bad');
  void el.offsetWidth;
  el.classList.add(c);
  setTimeout(() => el.classList.remove(c), 320);
}

// Called by the piano for every key you play (screen, computer keys, MIDI).
export function practiceInput(m) {
  const s = P.session;
  if (!P.piece || !s || !P.ui.canvas?.isConnected || s.done && !P.running) return;
  if (!P.running) {
    if (P.opts.mode !== 'wait' || s.started) return;
    start();
  }
  step(performance.now());
  const r = s.press(m);
  if (r.ok == null) return;
  flash(m, r.ok);
  if (r.ok && r.err != null) P.marks.push({ m, ok: Math.abs(r.err) <= 90, text: Math.abs(r.err) < 30 ? 'ON TIME' : `${r.err > 0 ? '+' : ''}${r.err} ms`, t: performance.now() });
  if (!r.ok) P.marks.push({ m, ok: false, text: 'WRONG', t: performance.now() });
  for (const a of r.autos || []) sound(a);
  syncButtons();
}

// ---------- drawing ----------
function frame(now) {
  P.raf = 0;
  const cv = P.ui.canvas;
  if (!P.piece) return;
  if (!cv?.isConnected) { closePractice(); return; }
  if (P.running) step(now);
  if (P.session) draw(now);
  P.raf = requestAnimationFrame(frame);
}

function keyGeo(cv) {
  const keys = cv.nextElementSibling;
  if (P.geo?.keys === keys && P.geo.w === cv.clientWidth) return P.geo;
  const map = new Map();
  for (const el of keys?.children || []) map.set(+el.dataset.m, { x: el.offsetLeft, w: el.offsetWidth, black: el.classList.contains('black') });
  return (P.geo = { keys, w: cv.clientWidth, map });
}
function clearLit() { for (const el of P.lit) el.classList.remove('pr-want'); P.lit.clear(); }
function lightWanted(s) {
  const e = s.mode === 'wait' ? (s.waiting() || (!s.started ? s.tl.events.find((x) => x.want.length) : null)) : null;
  const want = new Set();
  if (e) for (const n of e.notes) if (n.target && !e.got.has(n.m)) { const el = P.api.keyEl(n.m); if (el) { el.style.setProperty('--pr', COLOR[n.hand]); want.add(el); } }
  for (const el of P.lit) if (!want.has(el)) el.classList.remove('pr-want');
  for (const el of want) el.classList.add('pr-want');
  P.lit = want;
}

function draw(now) {
  const cv = P.ui.canvas, s = P.session, tl = s.tl;
  const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const geo = keyGeo(cv), hue = P.ui.hue || (P.ui.hue = getComputedStyle(cv).getPropertyValue('--hue').trim() || '#d8b4fe');
  const pps = H / LOOK, y = (t) => H - ((t - s.pos) / s.speed) * pps;
  const wrap = cv.closest('.piano-wrap'), left = wrap?.scrollLeft || 0;

  // Lanes at every C, bar lines with numbers.
  g.fillStyle = 'rgba(255,255,255,.045)';
  for (const [m, k] of geo.map) if (m % 12 === 0) g.fillRect(k.x - 1, 0, 1, H);
  g.font = '600 10px ui-monospace, Menlo, monospace';
  for (let b = tl.from; b <= tl.to; b++) {
    const yb = y(tl.secOf(b * tl.barLen));
    if (yb < -2 || yb > H) continue;
    g.fillStyle = b === tl.to ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.1)';
    g.fillRect(0, yb, W, 1);
    if (b < tl.to) { g.fillStyle = 'rgba(255,255,255,.45)'; g.fillText(String(b + 1), left + 6, yb - 4); }
  }

  // Notes, from the hit line up: your hand bright, the other hand faint, played ones turn green or red.
  const waiting = s.mode === 'wait' ? s.waiting() : null, pulse = 0.75 + 0.25 * Math.sin(now / 140);
  for (const n of tl.notes) {
    const y0 = y(n.t);
    if (y0 < 0) break;
    const y1 = y0 - (n.d / s.speed) * pps;
    if (y1 > H) continue;
    const k = geo.map.get(n.m);
    if (!k) continue;
    const top = Math.max(0, y1), bot = Math.min(H - 2, y0);
    if (bot - top < 1) continue;
    g.globalAlpha = n.target ? (waiting && n.ev === waiting && n.status !== 'hit' ? pulse : 1) : 0.2;
    g.fillStyle = g.strokeStyle = n.status === 'hit' ? OK : n.status === 'missed' ? BAD : COLOR[n.hand];
    const pad = k.black ? 1 : 2;
    g.beginPath();
    if (g.roundRect) g.roundRect(k.x + pad, top, k.w - 2 * pad, bot - top, 4); else g.rect(k.x + pad, top, k.w - 2 * pad, bot - top);
    g.fill();
    if (!n.target) { g.globalAlpha = 0.5; g.stroke(); }
  }
  g.globalAlpha = 1;
  g.fillStyle = hue;
  g.fillRect(0, H - 2, W, 2);

  // Feedback marks rise from the key you played.
  g.textAlign = 'center';
  P.marks = P.marks.filter((mk) => now - mk.t < 900);
  for (const mk of P.marks) {
    const k = geo.map.get(mk.m), age = (now - mk.t) / 900;
    if (!k) continue;
    g.globalAlpha = 1 - age;
    g.fillStyle = mk.ok ? OK : BAD;
    g.fillText(mk.text, Math.max(left + 28, Math.min(left + (wrap?.clientWidth || W) - 28, k.x + k.w / 2)), H - 14 - age * 30);
  }
  g.globalAlpha = 1;
  g.textAlign = 'start';

  lightWanted(s);
  reach(s);
  status(s);
  follow(s, wrap, geo);
}

function status(s) {
  const tl = s.tl;
  let bar = tl.from;
  while (bar + 1 < tl.to && tl.secOf((bar + 1) * tl.barLen) <= s.pos + 1e-6) bar++;
  const sec = tl.sections.findLast((x) => x.at <= bar);
  const text = `BAR ${bar + 1} / ${tl.bars}`;
  if (P.ui.bar && P.ui.bar.textContent !== text) P.ui.bar.textContent = text;
  const name = sec ? sec.name : '';
  if (P.ui.section && P.ui.section.textContent !== name) P.ui.section.textContent = name;
  const c = s.started ? [`${s.hits} RIGHT`, `${s.wrong.length} WRONG`, s.mode === 'play' ? `${s.missed} MISSED` : null].filter(Boolean).join(' · ') : '';
  if (P.ui.count && P.ui.count.textContent !== c) P.ui.count.textContent = c;
}

// Computer keys cover 18 notes: move them to the next notes you need to play.
function reach(s) {
  const e = s.tl.events.find((x) => !x.complete && x.t + 0.2 > s.pos);
  if (!e || e === P.reached) return;
  P.reached = e;
  const need = e.want.filter((m) => !e.got.has(m));
  if (!need.length || need.every((m) => P.api.keyEl(m)?.querySelector('kbd'))) return;
  const lo = Math.min(...need), o = Math.max(1, Math.min(6, Math.floor(lo / 12)));
  P.api.setOctave(o);
}

// On a phone the keyboard scrolls sideways: keep the next notes in view.
function follow(s, wrap, geo) {
  if (!wrap || wrap.scrollWidth <= wrap.clientWidth + 2) return;
  let lo = Infinity, hi = -Infinity;
  for (const n of s.tl.notes) {
    if (n.t > s.pos + 1.6 * s.speed) break;
    if (!n.target || n.t + n.d < s.pos) continue;
    const k = geo.map.get(n.m);
    if (k) { lo = Math.min(lo, k.x); hi = Math.max(hi, k.x + k.w); }
  }
  if (lo === Infinity) return;
  const cw = wrap.clientWidth, sl = wrap.scrollLeft;
  if (lo >= sl + 6 && hi <= sl + cw - 6) return;
  const target = Math.max(0, Math.min(wrap.scrollWidth - cw, (lo + hi) / 2 - cw / 2));
  wrap.scrollLeft = sl + (target - sl) * 0.18;
}

// A tab switch or lost focus pauses the run (the piano itself releases every held note and the pedal).
if (typeof window !== 'undefined') {
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => document.hidden && pause());
  const active = (e) => P.piece && P.ui.canvas?.isConnected && e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey
    && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || false;
  window.addEventListener('keydown', (e) => { if (!active(e)) return; e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) toggleRun(); }, true);
  window.addEventListener('keyup', (e) => { if (active(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}
