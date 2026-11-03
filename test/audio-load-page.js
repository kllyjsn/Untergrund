// In-browser audio-graph load probe (driven by scripts/audio-load.mjs): per-hit node churn, concurrent voices and
// offline render speed of a song's busiest bars, plus a realtime run that reads AudioContext playback stats.
import { clone, defaultState, generate, applyOverrides, arrangement, songChain } from '/js/state.js';
import { renderBars } from '/js/render.js';
import { Engine, Sequencer, parseChain } from '/js/engine.js';

export function songFor(style, seed) {
  const s = defaultState(), g = generate(style, seed);
  applyOverrides(s, g);
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  if (g.key != null) s.key = g.key;
  if (g.scale) s.scale = g.scale;
  s.chainOn = true;
  s.chain = songChain(style, seed);
  return s;
}

const CREATE = ['createGain', 'createBiquadFilter', 'createOscillator', 'createBufferSource', 'createConstantSource', 'createStereoPanner',
  'createWaveShaper', 'createConvolver', 'createDelay', 'createDynamicsCompressor', 'createChannelMerger', 'createChannelSplitter', 'createAnalyser'];
const SOURCES = new Set(['Oscillator', 'BufferSource', 'ConstantSource']);

// Tags every node the context creates; after `arm()` nodes count as per-hit (created while the song plays).
function probe(ctx) {
  const meta = new Map(), list = [];
  let perHit = false;
  for (const name of CREATE) {
    const orig = ctx[name].bind(ctx);
    ctx[name] = (...a) => { const n = orig(...a); const m = { kind: name.slice(6), perHit, out: [], start: null, stop: null }; meta.set(n, m); list.push(m); return n; };
  }
  const P = AudioNode.prototype, S = AudioScheduledSourceNode.prototype, B = AudioBufferSourceNode.prototype;
  const conn = P.connect, start = S.start, stop = S.stop, bstart = Object.getOwnPropertyDescriptor(B, 'start')?.value;
  P.connect = function (dst, ...r) { const m = meta.get(this); if (m && dst instanceof AudioNode) { const d = meta.get(dst); if (d) m.out.push(d); } return conn.call(this, dst, ...r); };
  const onStart = (node, when = 0, offset = 0, dur) => {
    const m = meta.get(node);
    if (m) { m.start = when; const b = node.buffer; if (b && !node.loop) m.natural = when + Math.max(0, (dur ?? (b.duration - offset))) / Math.max(1e-3, node.playbackRate.value); if (dur != null) m.stop = Math.min(m.stop ?? Infinity, when + dur); }
  };
  S.start = function (...a) { onStart(this, ...a); return start.apply(this, a); };
  if (bstart) B.start = function (...a) { onStart(this, ...a); return bstart.apply(this, a); };
  S.stop = function (when = 0) { const m = meta.get(this); if (m) m.stop = Math.min(m.stop ?? Infinity, when); return stop.call(this, when); };
  return {
    arm() { perHit = true; },
    restore() { P.connect = conn; S.start = start; S.stop = stop; if (bstart) B.start = bstart; },
    list,
  };
}

// Lifetimes: a source lives from start to stop (or the end of its buffer); every per-hit node downstream lives as long
// as anything feeding it does. Shared buses (created before playback) are left out: they are the fixed graph.
function analyse(list, t0, t1) {
  const hit = list.filter((m) => m.perHit);
  for (const m of hit) { m.a = Infinity; m.b = -Infinity; }
  for (const s of hit) {
    if (!SOURCES.has(s.kind) || s.start == null) continue;
    const a = s.start, b = Math.min(s.stop ?? Infinity, s.natural ?? Infinity, t1 + 30);
    const stack = [s];
    while (stack.length) {
      const m = stack.pop();
      if (!m.perHit || (m.a <= a && m.b >= b)) continue;
      m.a = Math.min(m.a, a); m.b = Math.max(m.b, b);
      stack.push(...m.out);
    }
  }
  const sweep = (ms) => {
    const ev = [];
    for (const m of ms) if (m.b > m.a) { ev.push([Math.max(m.a, t0), 1], [Math.max(m.b, t0), -1]); }
    ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let cur = 0, max = 0, area = 0, last = t0;
    for (const [t, d] of ev) {
      const tt = Math.min(t, t1);
      if (tt > last) { area += cur * (tt - last); last = tt; }
      cur += d; if (t <= t1) max = Math.max(max, cur);
    }
    return { max, avg: area / (t1 - t0) };
  };
  const byKind = {};
  for (const m of hit) byKind[m.kind] = (byKind[m.kind] || 0) + 1;
  return { created: hit.length, byKind, nodes: sweep(hit), voices: sweep(hit.filter((m) => SOURCES.has(m.kind))), fixed: list.length - hit.length };
}

// Per-bar per-hit node counts over the whole song (scheduling only, nothing rendered).
async function scan(state, bars) {
  await renderBars(state, 1, { tail: 0 }); // loads every sample the song needs
  const ctx = new OfflineAudioContext(2, 128, 48000), pr = probe(ctx);
  try {
    const e = new Engine(ctx, JSON.parse(JSON.stringify(state)), { realtime: false }), seq = new Sequencer(e, e.state);
    pr.arm();
    const per = [];
    for (let abs = 0, t = 0.05; abs < bars * 16; abs++) { const n0 = pr.list.length; seq.tick(abs, t); t += e.stepDur; per[abs >> 4] = (per[abs >> 4] || 0) + pr.list.length - n0; }
    return per;
  } finally { pr.restore(); }
}

export async function measure(style, seed, { bars = 8, songBars = 0 } = {}) {
  const state = songFor(style, seed);
  const chain = parseChain(state.chain);
  const total = songBars || (chain.length > 1 ? chain.length : 64);
  const per = await scan(state, total);
  let best = 0, bestSum = -1;
  for (let i = 0; i + bars <= per.length; i++) { const sum = per.slice(i, i + bars).reduce((a, b) => a + b, 0); if (sum > bestSum) { bestSum = sum; best = i; } }
  let pr, t0 = 0;
  const buf = await renderBars(state, bars, {
    startBar: best, tail: 2,
    onContext: (ctx) => { pr = probe(ctx); },
    onEngine: () => pr.arm(),
    onScheduled: () => { pr.restore(); t0 = performance.now(); },
  });
  const ms = performance.now() - t0;
  const idle = clone(state); for (const id of Object.keys(idle.params)) idle.mutes[id] = true;
  for (const k of Object.keys(idle.orchMute || {})) idle.orchMute[k] = true;
  let t1 = 0;
  const ib = await renderBars(idle, bars, { startBar: best, tail: 2, onScheduled: () => { t1 = performance.now(); } });
  const idleMs = performance.now() - t1;
  const span = buf.duration - 2 - 0.05;
  const a = analyse(pr.list, 0.05, 0.05 + span);
  let peak = 0, sum = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += d[i] * d[i]; } }
  return { style, seed, startBar: best, bars, bpm: state.bpm, seconds: span, renderMs: ms, speed: ms / 1000 / buf.duration, idleSpeed: idleMs / 1000 / ib.duration,
    perSec: a.created / span, perBar: a.created / bars, ...a, peak, rms: Math.sqrt(sum / (buf.length * buf.numberOfChannels)) };
}

// Realtime: play the busiest bars through a real AudioContext with the app's lookahead scheduler.
export async function realtime(style, seed, { startBar = 0, seconds = 8, latencyHint = 'playback' } = {}) {
  const state = songFor(style, seed);
  await renderBars(state, 1, { tail: 0 });
  const ctx = new AudioContext({ latencyHint });
  await ctx.resume();
  const e = new Engine(ctx, state), seq = new Sequencer(e, state);
  const chain = parseChain(state.chain);
  if (startBar && chain.length) { seq.chainPos = startBar; seq.cur = chain[(startBar - 1) % chain.length]; }
  let abs = chain.length ? startBar * 16 : 0, next = ctx.currentTime + 0.1, late = 0;
  const caps = [];
  let rc = null;
  if (ctx.renderCapacity) { rc = ctx.renderCapacity; rc.addEventListener('update', (ev) => caps.push({ avg: ev.averageLoad, peak: ev.peakLoad, under: ev.underrunRatio })); rc.start({ updateInterval: 1 }); }
  const stats0 = ctx.playbackStats ? JSON.parse(JSON.stringify(ctx.playbackStats.toJSON?.() ?? ctx.playbackStats)) : null;
  const w0 = performance.now(), c0 = ctx.currentTime;
  const end = w0 + seconds * 1000;
  await new Promise((done) => {
    const id = setInterval(() => {
      if (next < ctx.currentTime) late++;
      while (next < ctx.currentTime + 0.12) { seq.tick(abs++, next); next += e.stepDur; }
      if (performance.now() > end) { clearInterval(id); done(); }
    }, 15);
  });
  const stats = ctx.playbackStats ? (ctx.playbackStats.toJSON?.() ?? { ...ctx.playbackStats }) : null;
  // No playbackStats/renderCapacity: a headless context renders to a timer-driven null sink, so an audio thread
  // that cannot keep up shows as its clock falling behind the wall clock.
  const clock = (ctx.currentTime - c0) / ((performance.now() - w0) / 1000);
  rc?.stop?.();
  await ctx.close();
  return { style, latencyHint, clock, baseLatency: ctx.baseLatency, lateTicks: late, hasPlaybackStats: !!stats, stats0, stats, hasRenderCapacity: !!rc, caps };
}

// Render cost of each track alone over the same window (minus the idle graph), to see where the audio thread goes.
export async function trackCost(style, seed, { startBar = 0, bars = 8 } = {}) {
  const state = songFor(style, seed), out = {};
  const timed = async (s) => { let t0 = 0; const b = await renderBars(s, bars, { startBar, tail: 2, onScheduled: () => { t0 = performance.now(); } }); return (performance.now() - t0) / 1000 / b.duration; };
  const idle = clone(state); for (const id of Object.keys(idle.params)) idle.mutes[id] = true;
  const base = await timed(idle);
  for (const id of Object.keys(state.params)) {
    if (state.mutes[id]) continue;
    const s = clone(state); for (const k of Object.keys(s.params)) s.mutes[k] = k !== id;
    out[id] = +((await timed(s)) - base).toFixed(3);
  }
  return { base: +base.toFixed(3), ...out };
}

// Fixed-seed PCM of a window for before/after sound-neutrality checks (base64 Float32 per channel).
export async function renderPcm(style, seed, { startBar = 0, bars = 4 } = {}) {
  const buf = await renderBars(songFor(style, seed), bars, { startBar, tail: 2 });
  const ch = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const b = new Uint8Array(buf.getChannelData(c).buffer); let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    ch.push(btoa(s));
  }
  return { sampleRate: buf.sampleRate, ch };
}

// Median offline render speed (render time / audio duration) over several renders of the same window.
export async function timing(style, seed, { startBar = 0, bars = 8, reps = 5 } = {}) {
  const state = songFor(style, seed), out = [];
  for (let i = 0; i < reps; i++) {
    let t0 = 0;
    const b = await renderBars(state, bars, { startBar, tail: 2, onScheduled: () => { t0 = performance.now(); } });
    out.push((performance.now() - t0) / 1000 / b.duration);
  }
  out.sort((a, b) => a - b);
  return out[out.length >> 1];
}
