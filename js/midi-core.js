// MIDI studio logic with no browser APIs: message parsing, the learned-mapping store,
// CC smoothing + soft takeover, clock-in tempo following and clock-out tick scheduling.
// The Web MIDI / DOM glue lives in js/midi-studio.js; tests in test/midi.mjs.
import { TRACK_BY_ID, MASTER_PARAMS, MIX_PARAMS, PATTERN_NAMES } from './params.js';

export const PPQN = 24, TICKS_PER_STEP = 6; // one UNTERGRUND step is a 16th note = one MIDI beat (SPP unit)
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ---------------- messages ----------------
export function parseMessage(data) {
  const st = data?.[0];
  if (st == null) return null;
  if (st >= 0xf0) {
    const rt = { 0xf8: 'clock', 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop' }[st];
    if (rt) return { type: rt };
    if (st === 0xf2) return { type: 'spp', pos: (data[1] & 0x7f) | ((data[2] & 0x7f) << 7) };
    return null;
  }
  const cmd = st & 0xf0, ch = st & 0x0f, a = data[1] & 0x7f, b = (data[2] ?? 0) & 0x7f;
  if (cmd === 0xb0) return { type: 'cc', ch, num: a, val: b };
  if (cmd === 0x90 && b > 0) return { type: 'noteon', ch, num: a, val: b };
  if (cmd === 0x80 || cmd === 0x90) return { type: 'noteoff', ch, num: a, val: 0 };
  return null;
}
// A mapping source: 'cc:<ch>:<num>' or 'note:<ch>:<num>'; ch may be '*' (any channel).
export const sourceOf = (m) => (m && (m.type === 'cc' || m.type === 'noteon' || m.type === 'noteoff') ? `${m.type === 'cc' ? 'cc' : 'note'}:${m.ch}:${m.num}` : null);
export function sourceLabel(src) {
  const [kind, ch, num] = String(src).split(':');
  const where = ch === '*' ? '' : ` · CH ${+ch + 1}`;
  if (kind === 'cc') return `CC ${num}${where}`;
  return `NOTE ${NOTE[num % 12]}${Math.floor(num / 12) - 1}${where}`;
}

// ---------------- targets ----------------
// 'track:<id>:<param>', 'master:<id>', 'swing', 'pad:<R|T|Y>', 'mute:<id>', 'pattern:<0-7>', 'transport:play'
const PADS = { R: 'ROLL', T: 'THROW', Y: 'RISER' };
const SWING = { id: 'swing', label: 'SWING', min: 0, max: 0.6, def: 0.06 };
const MASTER_BY_ID = Object.fromEntries(MASTER_PARAMS.map((q) => [q.id, q]));
export function targetParam(target) {
  const [kind, a, b] = String(target).split(':');
  if (kind === 'master') return MASTER_BY_ID[a] || null;
  if (kind === 'swing') return SWING;
  if (kind === 'track') return TRACK_BY_ID[a] ? [...TRACK_BY_ID[a].params, ...MIX_PARAMS].find((q) => q.id === b) || null : null;
  return null;
}
// range = a knob value; hold = press and release; press = acts on press only
export function targetKind(target) {
  const kind = String(target).split(':')[0];
  if (kind === 'pad') return 'hold';
  if (kind === 'mute' || kind === 'pattern' || kind === 'transport') return 'press';
  return targetParam(target) ? 'range' : null;
}
export function targetLabel(target) {
  const [kind, a, b] = String(target).split(':');
  if (kind === 'master') return `MASTER · ${MASTER_BY_ID[a]?.label || a}`;
  if (kind === 'swing') return 'SWING';
  if (kind === 'track') return `${TRACK_BY_ID[a]?.name || a} · ${targetParam(target)?.label || b}`;
  if (kind === 'pad') return PADS[a] || a;
  if (kind === 'mute') return `MUTE · ${TRACK_BY_ID[a]?.name || a}`;
  if (kind === 'pattern') return `PATTERN ${PATTERN_NAMES[a] ?? a}`;
  if (kind === 'transport') return 'PLAY / STOP';
  return String(target);
}

// Generic fallback for controllers nobody has mapped yet: the two common knob banks
// (CC 21–28 and 70–77, any channel) drive the master macros; drum pads on channel 10
// (GM notes 36–51) play the performance pads, transport, mutes and patterns.
export const MACROS = ['dj', 'duck', 'drive', 'revLevel', 'dlyLevel', 'dlyFb', 'humanize', 'volume'];
export function defaultMap() {
  const map = {};
  MACROS.forEach((id, i) => { map[`cc:*:${21 + i}`] = `master:${id}`; map[`cc:*:${70 + i}`] = `master:${id}`; });
  Object.assign(map, { 'cc:*:74': 'master:dj', 'cc:*:7': 'master:volume', 'cc:*:91': 'master:revLevel', 'cc:*:93': 'master:dlyLevel' });
  ['pad:R', 'pad:T', 'pad:Y', 'transport:play', 'mute:kick', 'mute:clap', 'mute:snare', 'mute:ch'].forEach((t, i) => { map[`note:9:${36 + i}`] = t; });
  for (let i = 0; i < 8; i++) map[`note:9:${44 + i}`] = `pattern:${i}`;
  return map;
}

const KEY = 'untergrund.midi.map:';
// Learned mappings, saved per device name. A device nobody has touched uses defaultMap().
export class MappingStore {
  constructor(storage, device = 'ANY') {
    this.storage = storage; this.device = device || 'ANY';
    let saved = null;
    try { saved = JSON.parse(storage?.getItem(KEY + this.device) || 'null'); } catch {}
    this.map = saved && typeof saved.map === 'object' ? { ...saved.map } : defaultMap();
    this.custom = !!saved;
  }
  save() { this.custom = true; try { this.storage?.setItem(KEY + this.device, JSON.stringify({ v: 1, map: this.map })); } catch {} }
  // Exact channel first, then the any-channel entry.
  get(src) {
    if (!src) return null;
    if (this.map[src]) return this.map[src];
    const [kind, , num] = src.split(':');
    return this.map[`${kind}:*:${num}`] || null;
  }
  // A control has one source: learning it again replaces the old one(s).
  learn(src, target) {
    for (const [s, t] of Object.entries(this.map)) if (t === target || s === src) delete this.map[s];
    this.map[src] = target;
    this.save();
  }
  remove(src) { delete this.map[src]; this.save(); }
  clear() { this.map = {}; this.save(); }
  reset() { this.map = defaultMap(); this.custom = false; try { this.storage?.removeItem(KEY + this.device); } catch {} }
  sourcesFor(target) { return Object.keys(this.map).filter((s) => this.map[s] === target); }
  list() { return Object.entries(this.map).map(([src, target]) => ({ src, target, label: targetLabel(target), source: sourceLabel(src) })).sort((a, b) => a.label.localeCompare(b.label) || a.src.localeCompare(b.src)); }
}

// ---------------- CC smoothing + soft takeover ----------------
// 7-bit CC moves in 1/127 jumps; glide each control toward its latest value (one-pole, tau seconds)
// so filters and levels sweep instead of zippering. Values are normalized 0..1.
export function createSmoother({ tau = 0.03, epsilon = 0.0005 } = {}) {
  const st = new Map();
  return {
    set(key, target, current) {
      const s = st.get(key);
      if (s) s.target = target; else st.set(key, { value: current ?? target, target });
    },
    step(dt) {
      const out = [], a = 1 - Math.exp(-Math.max(0, dt) / tau);
      for (const [key, s] of st) {
        s.value += (s.target - s.value) * a;
        if (Math.abs(s.target - s.value) < epsilon) { s.value = s.target; st.delete(key); }
        out.push([key, s.value]);
      }
      return out;
    },
    get active() { return st.size > 0; },
    cancel(key) { st.delete(key); },
  };
}
// A hardware knob only grabs a control once it reaches (or crosses) the control's current
// value, so loading a pattern or dragging on screen never makes the sound jump.
export function createTakeover({ window = 0.04, moved = 0.02 } = {}) {
  const st = new Map();
  return {
    accept(key, incoming, current) {
      const s = st.get(key) || { engaged: false, prev: null, wrote: null };
      st.set(key, s);
      if (s.engaged && s.wrote != null && Math.abs(current - s.wrote) > moved) s.engaged = false;
      if (!s.engaged && (Math.abs(incoming - current) <= window || (s.prev != null && (s.prev - current) * (incoming - current) <= 0))) s.engaged = true;
      s.prev = incoming;
      return s.engaged;
    },
    // The value actually applied (after smoothing) — anything else changing it releases the knob.
    wrote(key, value) { const s = st.get(key); if (s) s.wrote = value; },
    release(key) { st.delete(key); },
  };
}

// ---------------- clock in ----------------
// Follows an external 24 ppqn clock: tempo from a trimmed mean of recent tick intervals,
// smoothed and only reported when it moves ≥ 0.1 BPM; start/continue/stop/SPP become
// transport events and every 6th tick a step event (for phase alignment).
export function createClockFollower({ window = 48, alpha = 0.08, gapMs = 250 } = {}) {
  let last = null, iv = [], est = null, shown = null, running = false, ticks = 0, pendingStart = null, spp = 0;
  const bpmOf = (ms) => 60000 / (ms * PPQN);
  const f = {
    get bpm() { return shown; },
    get running() { return running; },
    get step() { return Math.floor(ticks / TICKS_PER_STEP); },
    message(m, ts) {
      const ev = [];
      if (!m) return ev;
      if (m.type === 'spp') { spp = m.pos; if (!running) ticks = m.pos * TICKS_PER_STEP; return ev; }
      if (m.type === 'start') { pendingStart = 'start'; ticks = 0; spp = 0; return ev; }
      if (m.type === 'continue') { pendingStart = 'continue'; ticks = spp * TICKS_PER_STEP; return ev; }
      if (m.type === 'stop') { if (running || pendingStart) ev.push({ type: 'stop' }); running = false; pendingStart = null; spp = Math.floor(ticks / TICKS_PER_STEP); return ev; }
      if (m.type !== 'clock') return ev;
      if (last != null) {
        const d = ts - last;
        if (d > gapMs || d <= 0) iv = [];
        else {
          iv.push(d); if (iv.length > window) iv.shift();
          if (iv.length >= 6) {
            const s = [...iv].sort((a, b) => a - b), cut = Math.floor(s.length / 6);
            const mid = s.slice(cut, s.length - cut), mean = mid.reduce((a, b) => a + b, 0) / mid.length;
            const b = bpmOf(mean);
            // Snap to a real tempo change quickly, glide through jitter slowly.
            est = est == null || Math.abs(b - est) > 4 ? b : est + (b - est) * alpha;
            const r = Math.round(est * 10) / 10;
            if (shown == null || Math.abs(r - shown) >= 0.1) { shown = r; ev.push({ type: 'tempo', bpm: r }); }
          }
        }
      }
      last = ts;
      if (pendingStart) { running = true; ev.push({ type: pendingStart, step: Math.floor(ticks / TICKS_PER_STEP), ts }); pendingStart = null; }
      else if (running && ticks % TICKS_PER_STEP === 0) ev.push({ type: 'step', step: ticks / TICKS_PER_STEP, ts });
      if (running) ticks++;
      return ev;
    },
    reset() { last = null; iv = []; est = null; shown = null; running = false; ticks = 0; pendingStart = null; spp = 0; },
  };
  return f;
}

// ---------------- clock out ----------------
// Maps AudioContext time to performance.now() (what MIDIOutput.send timestamps use).
// Feed it (contextTime s, performanceTime ms) pairs — ideally ctx.getOutputTimestamp(), which
// already accounts for output latency — and it keeps a smoothed offset so ticks don't jitter.
export function createTimebase({ alpha = 0.05, jumpMs = 50 } = {}) {
  let off = null;
  return {
    update(contextTime, performanceTime) {
      const o = performanceTime - contextTime * 1000;
      if (!Number.isFinite(o)) return off;
      off = off == null || Math.abs(o - off) > jumpMs ? o : off + (o - off) * alpha;
      return off;
    },
    toPerf(audioSec) { return off == null ? null : audioSec * 1000 + off; },
    get offset() { return off; },
  };
}
// Six clock ticks per step at even spacing (clock stays straight under swing).
export function stepTicks(perfMs, stepMs) {
  return Array.from({ length: TICKS_PER_STEP }, (_, k) => perfMs + (k * stepMs) / TICKS_PER_STEP);
}
// Sends clock to one output. send(bytes, timestampMs) — a MIDIOutput.send.
export function createClockSender(send, { nudgeMs = 0, clear } = {}) {
  let running = false, next = null;
  const out = (bytes, ts) => send(bytes, Math.max(0, ts + nudgeMs));
  return {
    get running() { return running; },
    start(step, perfMs) {
      step = Math.max(0, Math.floor(step));
      if (step === 0) out([0xfa], perfMs - 1);
      else { const p = clamp(step, 0, 0x3fff); out([0xf2, p & 0x7f, p >> 7], perfMs - 2); out([0xfb], perfMs - 1); }
      running = true; next = step;
    },
    step(abs, perfMs, stepMs) {
      if (!running || abs < next) return;
      for (const t of stepTicks(perfMs, stepMs)) out([0xf8], t);
      next = abs + 1;
    },
    stop(nowMs) { if (!running) return; running = false; next = null; clear?.(); send([0xfc], nowMs); },
  };
}

// ---------------- controller hub ----------------
// Wires a MIDIAccess (real or fake) to the studio. actions:
//   get(target) -> current normalized 0..1 (range targets), set(target, n), press(target, down),
//   learned(target, src), clock(event), wake() (start calling frame(dt) — smoothing is running),
//   changed() (devices / mappings changed).
export function createMidiHub(access, { storage, actions = {}, now = () => 0 } = {}) {
  const stores = new Map(), bound = new Set(), smoother = createSmoother(), takeover = createTakeover();
  const follower = createClockFollower(), timebase = createTimebase();
  let armed = null, followName = null, outName = null, sender = null, nudgeMs = 0;
  const store = (name) => { const k = name || 'ANY'; if (!stores.has(k)) stores.set(k, new MappingStore(storage, k)); return stores.get(k); };
  const inputs = () => [...(access?.inputs?.values?.() || [])];
  const outputs = () => [...(access?.outputs?.values?.() || [])];

  function onMessage(input, e) {
    const m = parseMessage(e.data);
    if (!m) return;
    if (m.type === 'clock' || m.type === 'start' || m.type === 'continue' || m.type === 'stop' || m.type === 'spp') {
      if (followName && input.name === followName) for (const ev of follower.message(m, e.timeStamp ?? now())) actions.clock?.(ev);
      return;
    }
    const src = sourceOf(m);
    if (armed) {
      if (m.type === 'noteoff' || (m.type === 'cc' && targetKind(armed) !== 'range' && m.val < 64)) return;
      const target = armed; armed = null;
      store(input.name).learn(src, target);
      takeover.release(target);
      actions.learned?.(target, src, input.name);
      actions.changed?.();
      return;
    }
    const target = store(input.name).get(src), kind = target && targetKind(target);
    if (!kind) return;
    if (kind === 'range') {
      if (m.type !== 'cc') { if (m.type === 'noteon') actions.set?.(target, m.val / 127); return; }
      const n = m.val / 127, cur = actions.get?.(target), q = targetParam(target);
      if (cur == null) return;
      if (!takeover.accept(target, n, cur)) { actions.pickup?.(target, n, cur); return; }
      if (q?.step) { smoother.cancel(target); takeover.wrote(target, n); actions.set?.(target, n); return; }
      const was = smoother.active;
      smoother.set(target, n, cur);
      if (!was) actions.wake?.();
      return;
    }
    const down = m.type === 'noteon' || (m.type === 'cc' && m.val >= 64);
    if (kind === 'hold') actions.press?.(target, down);
    else if (down) actions.press?.(target, true);
  }
  function bind() {
    for (const i of inputs()) {
      if (bound.has(i)) continue;
      bound.add(i);
      i.addEventListener('midimessage', (e) => onMessage(i, e));
    }
    if (outName) useOutput(outName);
    actions.changed?.();
  }
  function useOutput(name) {
    const o = outputs().find((x) => x.name === name);
    if (sender?.running && sender.port !== o) sender.stop(now());
    if (!o) { if (!name) sender = null; return; }
    if (sender?.port === o) return;
    sender = createClockSender((b, ts) => { try { o.send(b, ts); } catch {} }, { nudgeMs, clear: () => { try { o.clear?.(); } catch {} } });
    sender.port = o;
  }
  if (access) {
    if (access.addEventListener) access.addEventListener('statechange', bind); else access.onstatechange = bind;
    bind();
  }
  return {
    inputs, outputs, store, timebase, follower,
    get armed() { return armed; },
    arm(target) { armed = target; },
    disarm() { armed = null; },
    // Steps the CC glide; call every animation frame while it returns true.
    frame(dt) {
      for (const [target, n] of smoother.step(dt)) { takeover.wrote(target, n); actions.set?.(target, n); }
      return smoother.active;
    },
    follow(name) { followName = name || null; follower.reset(); actions.changed?.(); },
    get following() { return followName; },
    clockOut(name, opts = {}) { outName = name || null; if (opts.nudgeMs != null) nudgeMs = opts.nudgeMs; if (sender?.running) sender.stop(now()); sender = null; useOutput(outName); actions.changed?.(); },
    get clockOutput() { return outName && sender ? outName : null; },
    clockStart(step, audioSec) { const t = timebase.toPerf(audioSec); if (sender && t != null) sender.start(step, t); },
    clockStep(abs, audioSec, stepSec) { const t = timebase.toPerf(audioSec); if (sender && t != null) sender.step(abs, t, stepSec * 1000); },
    clockStop() { sender?.stop(now()); },
  };
}
