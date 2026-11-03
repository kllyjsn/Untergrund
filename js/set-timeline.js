// A live set as replayable UNTERGRUND state: the opening state plus a timeline of
// [path, value] changes at ms offsets. Pure and deterministic (shared by browser and api/).
import { STYLES, sanitize } from './state.js';

export const TIMELINE_VERSION = 1;
export const MAX_TIMELINE_BYTES = 180_000;
export const MAX_EVENTS = 6000;
export const MAX_SET_MS = 6 * 3600e3;
export const MIN_SET_MS = 15000;
// What a DJ performs with. `current` is the pattern on deck; replay queues it for the next bar.
export const LIVE_KEYS = ['bpm', 'swing', 'key', 'scale', 'current', 'chainOn', 'chain', 'params', 'master', 'mutes', 'solos', 'orch', 'orchMute', 'patterns'];

const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const SEG = /^[A-Za-z0-9_-]{1,32}$/;

export function liveView(state) {
  const out = {};
  for (const k of LIVE_KEYS) if (state?.[k] !== undefined) out[k] = state[k];
  return copy(out);
}

// Smallest set of [path, value] ops that turns `a` into `b`. A 1-element op ([path]) deletes.
export function diffOps(a, b, path = [], ops = []) {
  if (a === b) return ops;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) diffOps(a[i], b[i], [...path, i], ops);
    return ops;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) if (!(k in b)) ops.push([[...path, k]]);
    for (const k of Object.keys(b)) diffOps(a[k], b[k], [...path, k], ops);
    return ops;
  }
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return ops;
  if (b === undefined) ops.push([path]);
  else ops.push([path, copy(b)]);
  return ops;
}

export function applyOps(target, ops) {
  for (const op of ops) {
    const [path, value] = op;
    if (!path.length) continue;
    let node = target;
    for (let i = 0; i < path.length - 1; i++) {
      if (node[path[i]] === null || typeof node[path[i]] !== 'object') node[path[i]] = typeof path[i + 1] === 'number' ? [] : {};
      node = node[path[i]];
    }
    const last = path[path.length - 1];
    if (op.length < 2) { if (Array.isArray(node)) node.splice(last, 1); else delete node[last]; }
    else node[last] = copy(value);
  }
  return target;
}

// Records `capture()` samples against a clock; `finish()` returns the timeline.
export function createTimelineRecorder({ state, style, startsAt, dj = '', room = '', title = '' }) {
  const t0 = +startsAt;
  let last = liveView(state), lastStyle = style;
  const timeline = { v: TIMELINE_VERSION, style, dj, room, title, initial: copy(last), events: [], duration: 0 };
  return {
    timeline,
    capture(next, nextStyle, now) {
      const t = Math.max(0, Math.round(now - t0));
      const view = liveView(next), ops = diffOps(last, view);
      if (nextStyle && nextStyle !== lastStyle) ops.push([['style'], nextStyle]);
      timeline.duration = Math.max(timeline.duration, Math.min(MAX_SET_MS, t));
      if (!ops.length || timeline.events.length >= MAX_EVENTS) return false;
      last = view; lastStyle = nextStyle || lastStyle;
      if (t === 0) { applyOps(timeline.initial, ops.filter((o) => o[0][0] !== 'style')); if (nextStyle) timeline.style = lastStyle; return true; }
      const prev = timeline.events[timeline.events.length - 1];
      if (prev && prev.t === t) prev.ops.push(...ops);
      else timeline.events.push({ t, ops });
      return true;
    },
    finish(now) {
      if (Number.isFinite(now)) timeline.duration = Math.max(timeline.duration, Math.min(MAX_SET_MS, Math.round(now - t0)));
      return compactTimeline(timeline);
    },
  };
}

// State (+ style) at `t` ms: initial with every event at or before t applied.
export function stateAt(timeline, t) {
  const s = copy(timeline.initial);
  let style = timeline.style;
  for (const ev of timeline.events) {
    if (ev.t > t) break;
    for (const op of ev.ops) if (op[0][0] === 'style') style = op[1]; else applyOps(s, [op]);
  }
  return { state: s, style };
}

// Events with from < t <= to, for incremental replay.
export function eventsBetween(timeline, from, to) {
  return timeline.events.filter((ev) => ev.t > from && ev.t <= to);
}

// Step position at `t` ms, integrating every tempo change on the way (late joiners land on the beat).
export function stepAt(timeline, t) {
  let bpm = +timeline.initial.bpm || 132, at = 0, steps = 0;
  for (const ev of timeline.events) {
    if (ev.t > t) break;
    const op = ev.ops.findLast?.((o) => o[0].length === 1 && o[0][0] === 'bpm') ?? [...ev.ops].reverse().find((o) => o[0].length === 1 && o[0][0] === 'bpm');
    if (!op) continue;
    steps += (ev.t - at) / (15000 / bpm); at = ev.t; bpm = +op[1] || bpm;
  }
  return { steps: steps + (t - at) / (15000 / bpm), bpm };
}

// The cut [start, end] ms as its own timeline starting at 0.
export function trimTimeline(timeline, start, end) {
  const a = Math.max(0, Math.min(timeline.duration, Math.round(start)));
  const b = Math.max(a, Math.min(timeline.duration, Math.round(end)));
  const { state, style } = stateAt(timeline, a);
  const events = timeline.events.filter((ev) => ev.t > a && ev.t <= b).map((ev) => ({ t: ev.t - a, ops: copy(ev.ops) }));
  return { ...timeline, style, initial: state, events, duration: b - a };
}

// Keeps a timeline under the byte budget by folding adjacent events (later values win).
export function compactTimeline(timeline, maxBytes = MAX_TIMELINE_BYTES) {
  let tl = timeline;
  while (JSON.stringify(tl).length > maxBytes && tl.events.length > 1) {
    const events = [];
    for (let i = 0; i < tl.events.length; i += 2) {
      const a = tl.events[i], b = tl.events[i + 1];
      events.push(b ? { t: b.t, ops: [...a.ops, ...b.ops] } : a);
    }
    tl = { ...tl, events: events.map((ev) => ({ t: ev.t, ops: dedupeOps(ev.ops) })) };
  }
  return tl;
}

function dedupeOps(ops) {
  const seen = new Map();
  ops.forEach((op, i) => seen.set(JSON.stringify(op[0]), i));
  return ops.filter((op, i) => seen.get(JSON.stringify(op[0])) === i);
}

const okPath = (p) => Array.isArray(p) && p.length >= 1 && p.length <= 8 && (LIVE_KEYS.includes(p[0]) || (p[0] === 'style' && p.length === 1)) &&
  p.every((s, i) => (i === 0 ? typeof s === 'string' : (typeof s === 'string' && SEG.test(s) && s !== '__proto__' && s !== 'constructor' && s !== 'prototype') || (Number.isInteger(s) && s >= 0 && s < 4096)));

// Validates untrusted timelines (rooms + jukebox). Returns null when unusable.
export function normalizeTimeline(raw) {
  if (!raw || typeof raw !== 'object' || !raw.initial || typeof raw.initial !== 'object') return null;
  if (JSON.stringify(raw).length > MAX_TIMELINE_BYTES * 1.2) return null;
  const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
  const initial = liveView(sanitize({ ...raw.initial, patterns: Array.isArray(raw.initial.patterns) ? raw.initial.patterns : undefined }));
  const duration = Math.max(0, Math.min(MAX_SET_MS, Math.round(+raw.duration || 0)));
  const events = [];
  let prev = 0;
  for (const ev of Array.isArray(raw.events) ? raw.events.slice(0, MAX_EVENTS) : []) {
    const t = Math.round(+ev?.t);
    if (!Number.isFinite(t) || t <= prev - 1 || t > duration || !Array.isArray(ev.ops)) continue;
    const ops = ev.ops.filter((op) => Array.isArray(op) && (op.length === 1 || op.length === 2) && okPath(op[0]) && (op[0][0] !== 'style' || STYLES[op[1]]));
    if (ops.length) { events.push({ t, ops: copy(ops) }); prev = t; }
  }
  return { v: TIMELINE_VERSION, style: STYLES[raw.style] ? raw.style : 'hypnotic', dj: clean(raw.dj, 28), room: clean(raw.room, 32), title: clean(raw.title, 80), initial, events, duration };
}

// Drives a replay from a clock: tick(now) applies everything due since the last tick.
export function createReplayer(timeline, { startsAt, apply, onEnd }) {
  let cursor = -1, done = false;
  const working = stateAt(timeline, -1);
  return {
    get done() { return done; },
    tick(now) {
      if (done) return;
      const t = now - startsAt;
      if (cursor < 0) {
        const at = Math.max(0, t);
        Object.assign(working, stateAt(timeline, at));
        cursor = at;
      } else {
        const due = eventsBetween(timeline, cursor, t);
        if (due.length) {
          for (const ev of due) for (const op of ev.ops) if (op[0][0] === 'style') working.style = op[1]; else applyOps(working.state, [op]);
          apply?.(copy(working.state), working.style);
        }
        cursor = Math.max(cursor, t);
      }
      if (t >= timeline.duration) { done = true; onEnd?.(); }
    },
    snapshot: () => copy(working),
  };
}
