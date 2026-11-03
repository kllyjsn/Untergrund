// A small dry-mix OfflineAudioContext for Node tests, so CI can render the real engine without a browser.
// Mono, 128-sample blocks, band-limited oscillators, Web Audio biquad/param maths. Reverb, echo and
// dynamics are left out (convolver/delay are silent, compressors pass through): tests measure the dry voices.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const BLOCK = 128;

export class AudioBuffer {
  constructor(channels, length, sampleRate) {
    if (typeof channels === 'object') ({ numberOfChannels: channels = 1, length, sampleRate } = channels);
    this.numberOfChannels = channels; this.length = length; this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(i) { return this.data[i]; }
  copyToChannel(src, i, at = 0) { this.data[i].set(src.subarray(0, this.length - at), at); }
  copyFromChannel(dst, i, at = 0) { dst.set(this.data[i].subarray(at, at + dst.length)); }
}

class Param {
  constructor(ctx, value) { this.ctx = ctx; this.v = value; this.defaultValue = value; this.events = []; this.inputs = []; }
  get value() { return this.v; }
  set value(x) { this.v = x; }
  add(e) {
    let i = this.events.length;
    while (i && this.events[i - 1].t > e.t) i--;
    this.events.splice(i, 0, e);
    return this;
  }
  setValueAtTime(v, t) { return this.add({ k: 's', t, v }); }
  linearRampToValueAtTime(v, t) { return this.add({ k: 'l', t, v }); }
  exponentialRampToValueAtTime(v, t) { return this.add({ k: 'e', t, v }); }
  setTargetAtTime(v, t, tc) { return this.add({ k: 'g', t, v, tc: Math.max(1e-6, tc) }); }
  setValueCurveAtTime(curve, t, d) { curve.forEach((v, i) => this.add({ k: 'l', t: t + (d * i) / Math.max(1, curve.length - 1), v })); return this; }
  cancelScheduledValues(t) { this.events = this.events.filter((e) => e.t < t); return this; }
  cancelAndHoldAtTime(t) { const v = this.at(t); this.cancelScheduledValues(t); return this.setValueAtTime(v, t); }
  // Value of the scheduled timeline at time T (walks a cursor forward; rendering only moves forward).
  at(T) {
    const ev = this.events;
    if (!ev.length) return this.v;
    if (!this.c || this.c.T > T) this.c = { i: -1, start: this.v, T: 0 };
    const c = this.c;
    while (c.i + 1 < ev.length && ev[c.i + 1].t <= T) { c.start = this.seg(c, ev[c.i + 1].t, true); c.i++; }
    c.T = T;
    return this.seg(c, T, false);
  }
  seg(c, T, ending) {
    const ev = this.events, e = ev[c.i], n = ev[c.i + 1], t0 = e ? e.t : 0;
    const base = e ? (e.k === 'g' ? e.v + (c.start - e.v) * Math.exp(-(T - e.t) / e.tc) : e.v) : c.start;
    if (n && (n.k === 'l' || n.k === 'e') && !(ending && T === n.t)) {
      const v0 = e && e.k === 'g' ? c.start : base, span = Math.max(1e-9, n.t - t0), x = Math.min(1, Math.max(0, (T - t0) / span));
      if (n.k === 'l') return v0 + (n.v - v0) * x;
      if (v0 * n.v > 0) return v0 * Math.pow(n.v / v0, x);
      return x < 1 ? v0 : n.v;
    }
    if (ending && n && T === n.t && (n.k === 'l' || n.k === 'e')) return n.v;
    return base;
  }
  fill(b, out) {
    const sr = this.ctx.sampleRate, t0 = (b * BLOCK) / sr;
    if (!this.events.length) out.fill(this.v);
    else for (let i = 0; i < BLOCK; i++) out[i] = this.at(t0 + i / sr);
    for (let k = this.inputs.length - 1; k >= 0; k--) {
      const s = this.inputs[k].pull(b);
      if (s === DEAD) { this.inputs.splice(k, 1); continue; }
      if (s) for (let i = 0; i < BLOCK; i++) out[i] += s[i];
    }
    return out;
  }
  constant(b) { return !this.inputs.length && (!this.events.length || this.events.at(-1).t * this.ctx.sampleRate < b * BLOCK - 1); }
}

const DEAD = Symbol('dead');

class Node {
  constructor(ctx) { this.ctx = ctx; this.inputs = []; this.b = -1; this.out = null; this.buf = new Float32Array(BLOCK); this.channelCount = 2; this.channelCountMode = 'max'; this.channelInterpretation = 'speakers'; }
  connect(dst) { (dst instanceof Param ? dst.inputs : dst.inputs).push(this); return dst; }
  disconnect() { this.cut = true; }
  // Sum of inputs for block b, or null when they are all silent, or DEAD when none can sound again.
  mix(b) {
    let any = null;
    for (let k = this.inputs.length - 1; k >= 0; k--) {
      const n = this.inputs[k], s = n.cut ? DEAD : n.pull(b);
      if (s === DEAD) { this.inputs.splice(k, 1); continue; }
      if (!s) continue;
      if (!any) { any = this.sum || (this.sum = new Float32Array(BLOCK)); any.set(s); } else for (let i = 0; i < BLOCK; i++) any[i] += s[i];
    }
    if (!any && !this.inputs.length) return DEAD;
    return any;
  }
  pull(b) {
    if (this.b === b) return this.out;
    if (this.busy) return null;
    this.busy = true; this.b = b;
    try { this.out = this.process(b); } finally { this.busy = false; }
    return this.out;
  }
}

class Gain extends Node {
  constructor(ctx) { super(ctx); this.gain = new Param(ctx, 1); this.g = new Float32Array(BLOCK); }
  process(b) {
    const x = this.mix(b);
    if (!x || x === DEAD) return x;
    const g = this.gain.fill(b, this.g), y = this.buf;
    for (let i = 0; i < BLOCK; i++) y[i] = x[i] * g[i];
    return y;
  }
}

class Pass extends Node { process(b) { return this.mix(b); } }
class Silent extends Node { process() { return DEAD; } }

class Panner extends Node {
  constructor(ctx) { super(ctx); this.pan = new Param(ctx, 0); }
  process(b) {
    const x = this.mix(b);
    if (!x || x === DEAD) return x;
    // Mono input through an equal-power panner, folded back to the mean of the two channels.
    const p = Math.max(-1, Math.min(1, this.pan.at((b * BLOCK) / this.ctx.sampleRate))), a = ((p + 1) * Math.PI) / 4;
    const g = (Math.cos(a) + Math.sin(a)) / 2, y = this.buf;
    for (let i = 0; i < BLOCK; i++) y[i] = x[i] * g;
    return y;
  }
}

class Shaper extends Node {
  constructor(ctx) { super(ctx); this.curve = null; this.oversample = 'none'; }
  process(b) {
    const x = this.mix(b);
    if (!x || x === DEAD || !this.curve) return x;
    const c = this.curve, n = c.length - 1, y = this.buf;
    for (let i = 0; i < BLOCK; i++) {
      const v = Math.max(0, Math.min(n, ((x[i] + 1) / 2) * n)), j = Math.min(n - 1, Math.floor(v)), f = v - j;
      y[i] = c[j] + (c[j + 1] - c[j]) * f;
    }
    return y;
  }
}

class Biquad extends Node {
  constructor(ctx) {
    super(ctx); this.type = 'lowpass';
    this.frequency = new Param(ctx, 350); this.Q = new Param(ctx, 1); this.gain = new Param(ctx, 0); this.detune = new Param(ctx, 0);
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  coef(b) {
    const t = (b * BLOCK) / this.ctx.sampleRate, sr = this.ctx.sampleRate, nyq = sr / 2;
    const fq = (p) => p.at(t) + p.inputs.reduce((s, n) => { const o = n.pull(b); return s + (o && o !== DEAD ? o[0] : 0); }, 0);
    const f = Math.max(1, Math.min(nyq * 0.999, fq(this.frequency) * Math.pow(2, fq(this.detune) / 1200)));
    const Q = fq(this.Q), G = fq(this.gain), w = (2 * Math.PI * f) / sr, cw = Math.cos(w), sw = Math.sin(w), A = Math.pow(10, G / 40);
    let b0, b1, b2, a0, a1, a2;
    if (this.type === 'lowpass' || this.type === 'highpass') {
      const al = sw / (2 * Math.pow(10, Q / 20)), lp = this.type === 'lowpass';
      b1 = lp ? 1 - cw : -(1 + cw); b0 = b2 = lp ? (1 - cw) / 2 : (1 + cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
    } else if (this.type === 'bandpass') {
      const al = sw / (2 * Math.max(1e-4, Q)); b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
    } else if (this.type === 'notch') {
      const al = sw / (2 * Math.max(1e-4, Q)); b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
    } else if (this.type === 'peaking') {
      const al = sw / (2 * Math.max(1e-4, Q)); b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
    } else if (this.type === 'lowshelf' || this.type === 'highshelf') {
      const al = (sw / 2) * Math.sqrt(2), s = 2 * Math.sqrt(A) * al, h = this.type === 'highshelf' ? -1 : 1;
      b0 = A * ((A + 1) - h * (A - 1) * cw + s); b1 = 2 * h * A * ((A - 1) - h * (A + 1) * cw); b2 = A * ((A + 1) - h * (A - 1) * cw - s);
      a0 = (A + 1) + h * (A - 1) * cw + s; a1 = -2 * h * ((A - 1) + h * (A + 1) * cw); a2 = (A + 1) + h * (A - 1) * cw - s;
    } else { b0 = 1; b1 = b2 = a1 = a2 = 0; a0 = 1; }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  process(b) {
    const x = this.mix(b);
    if (x === DEAD && Math.abs(this.y1) + Math.abs(this.y2) < 1e-7) return DEAD;
    if ((!x || x === DEAD) && Math.abs(this.y1) + Math.abs(this.y2) + Math.abs(this.x1) < 1e-7) { this.x1 = this.x2 = this.y1 = this.y2 = 0; return x === DEAD ? DEAD : null; }
    const [b0, b1, b2, a1, a2] = this.coef(b), y = this.buf;
    let { x1, x2, y1, y2 } = this;
    for (let i = 0; i < BLOCK; i++) {
      const v = x && x !== DEAD ? x[i] : 0, o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
    }
    Object.assign(this, { x1, x2, y1, y2 });
    return y;
  }
}

class Source extends Node {
  constructor(ctx) { super(ctx); this.t0 = Infinity; this.t1 = Infinity; this.onended = null; }
  start(t = 0) { this.t0 = Math.max(0, t); }
  stop(t = 0) { this.t1 = Math.max(this.t0 === Infinity ? 0 : this.t0, t); }
  process(b) {
    const sr = this.ctx.sampleRate, s0 = b * BLOCK, a = Math.ceil(this.t0 * sr), z = Math.ceil(this.t1 * sr);
    if (s0 >= z || this.t0 === Infinity) return this.t0 === Infinity ? null : DEAD;
    if (s0 + BLOCK <= a) return null;
    const y = this.buf; y.fill(0);
    this.render(b, Math.max(0, a - s0), Math.min(BLOCK, z - s0), y);
    return y;
  }
}

const TABLE = 2048, tables = {};
function wavetable(type, harmonics) {
  const key = type + harmonics;
  if (tables[key]) return tables[key];
  const w = new Float32Array(TABLE + 1);
  for (let n = 1; n <= harmonics; n++) {
    let a = 0;
    if (type === 'sawtooth') a = (2 / Math.PI) * ((n % 2 ? 1 : -1) / n);
    else if (type === 'square') a = n % 2 ? 4 / (Math.PI * n) : 0;
    else if (type === 'triangle') a = n % 2 ? (8 / (Math.PI * Math.PI)) * ((((n - 1) / 2) % 2 ? -1 : 1) / (n * n)) : 0;
    else if (n === 1) a = 1;
    if (a) for (let i = 0; i < TABLE; i++) w[i] += a * Math.sin((2 * Math.PI * n * i) / TABLE);
  }
  w[TABLE] = w[0];
  return (tables[key] = w);
}

class Osc extends Source {
  constructor(ctx) { super(ctx); this.type = 'sine'; this.frequency = new Param(ctx, 440); this.detune = new Param(ctx, 0); this.phase = 0; this.f = new Float32Array(BLOCK); this.d = new Float32Array(BLOCK); }
  setPeriodicWave() { this.type = 'sine'; }
  render(b, i0, i1, y) {
    const sr = this.ctx.sampleRate, f = this.frequency.fill(b, this.f), d = this.detune.fill(b, this.d);
    const fixed = this.detune.constant(b) && this.frequency.constant(b);
    let ph = this.phase, w = null, step = 0;
    const pick = (hz) => {
      const lim = Math.max(1, Math.floor(sr / 2 / Math.max(1, Math.abs(hz))));
      let h = 1; while (h * 2 <= lim && h < 512) h *= 2;
      return wavetable(this.type, this.type === 'sine' ? 1 : h);
    };
    if (fixed) { const hz = f[0] * Math.pow(2, d[0] / 1200); step = hz / sr; w = pick(hz); }
    for (let i = i0; i < i1; i++) {
      if (!fixed) { const hz = f[i] * Math.pow(2, d[i] / 1200); step = hz / sr; if (!w || (i & 31) === 0) w = pick(hz); }
      const p = ph * TABLE, j = Math.floor(p), fr = p - j;
      y[i] = w[j] + (w[j + 1] - w[j]) * fr;
      ph += step; ph -= Math.floor(ph);
    }
    this.phase = ph;
  }
}

class Constant extends Source {
  constructor(ctx) { super(ctx); this.offset = new Param(ctx, 1); this.o = new Float32Array(BLOCK); }
  render(b, i0, i1, y) { const o = this.offset.fill(b, this.o); for (let i = i0; i < i1; i++) y[i] = o[i]; }
}

class BufferSrc extends Source {
  constructor(ctx) { super(ctx); this.buffer = null; this.loop = false; this.loopStart = 0; this.loopEnd = 0; this.playbackRate = new Param(ctx, 1); this.detune = new Param(ctx, 0); this.r = new Float32Array(BLOCK); this.dt = new Float32Array(BLOCK); }
  start(t = 0, offset = 0, dur) { super.start(t); this.pos = null; this.offset = offset || 0; if (dur != null) this.t1 = Math.min(this.t1, this.t0 + dur); }
  render(b, i0, i1, y) {
    const buf = this.buffer;
    if (!buf) return;
    if (!this.mono) { const m = new Float32Array(buf.length); for (const ch of buf.data) for (let i = 0; i < m.length; i++) m[i] += ch[i] / buf.numberOfChannels; this.mono = m; }
    const m = this.mono, k = buf.sampleRate / this.ctx.sampleRate, r = this.playbackRate.fill(b, this.r), dt = this.detune.fill(b, this.dt);
    if (this.pos == null) this.pos = this.offset * buf.sampleRate;
    const ls = this.loopStart * buf.sampleRate, le = this.loopEnd ? this.loopEnd * buf.sampleRate : m.length;
    let p = this.pos;
    for (let i = i0; i < i1; i++) {
      if (this.loop && p >= le) p = ls + ((p - ls) % Math.max(1, le - ls));
      if (p >= m.length - 1) { this.t1 = Math.min(this.t1, (b * BLOCK + i) / this.ctx.sampleRate); break; }
      const j = Math.floor(p), f = p - j;
      y[i] = m[j] + (m[j + 1] - m[j]) * f;
      p += r[i] * Math.pow(2, dt[i] / 1200) * k;
    }
    this.pos = p;
  }
}

class Compressor extends Pass {
  constructor(ctx) {
    super(ctx); this.reduction = 0;
    for (const [k, v] of [['threshold', -24], ['knee', 30], ['ratio', 12], ['attack', 0.003], ['release', 0.25]]) this[k] = new Param(ctx, v);
  }
}
class Analyser extends Silent { constructor(ctx) { super(ctx); this.fftSize = 2048; this.smoothingTimeConstant = 0.8; } }
class Convolver extends Silent { constructor(ctx) { super(ctx); this.buffer = null; this.normalize = true; } }
class Delay extends Silent { constructor(ctx) { super(ctx); this.delayTime = new Param(ctx, 0); } }

function decodeWav(ab) {
  const v = new DataView(ab instanceof ArrayBuffer ? ab : ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength));
  let o = 12, fmt = null, data = null;
  while (o + 8 <= v.byteLength) {
    const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)), n = v.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { tag: v.getUint16(o + 8, true), ch: v.getUint16(o + 10, true), sr: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === 'data') data = [o + 8, Math.min(n, v.byteLength - o - 8)];
    o += 8 + n + (n % 2);
  }
  if (!fmt || !data) throw new Error('not a WAV file');
  const bytes = fmt.bits / 8, frames = Math.floor(data[1] / (bytes * fmt.ch)), out = new AudioBuffer(fmt.ch, frames, fmt.sr);
  for (let i = 0; i < frames; i++) for (let c = 0; c < fmt.ch; c++) {
    const p = data[0] + (i * fmt.ch + c) * bytes;
    out.data[c][i] = fmt.tag === 3 ? v.getFloat32(p, true) : bytes === 2 ? v.getInt16(p, true) / 32768 : bytes === 3 ? ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) / 8388608) : (v.getUint8(p) - 128) / 128;
  }
  return out;
}

export class OfflineAudioContext {
  constructor(channels, length, sampleRate) {
    if (typeof channels === 'object') ({ numberOfChannels: channels = 1, length, sampleRate } = channels);
    this.length = length; this.sampleRate = sampleRate; this.currentTime = 0; this.state = 'suspended';
    this.destination = new Pass(this); this.destination.maxChannelCount = 2;
    this.tap = null;
  }
  createGain() { return new Gain(this); }
  createBiquadFilter() { return new Biquad(this); }
  createOscillator() { return new Osc(this); }
  createConstantSource() { return new Constant(this); }
  createBufferSource() { return new BufferSrc(this); }
  createStereoPanner() { return new Panner(this); }
  createWaveShaper() { return new Shaper(this); }
  createChannelMerger() { return new Pass(this); }
  createChannelSplitter() { return new Pass(this); }
  createDynamicsCompressor() { return new Compressor(this); }
  createAnalyser() { return new Analyser(this); }
  createConvolver() { return new Convolver(this); }
  createDelay() { return new Delay(this); }
  createPeriodicWave() { return {}; }
  createBuffer(ch, len, sr) { return new AudioBuffer(ch, len, sr); }
  async decodeAudioData(ab) {
    const b = new Uint8Array(ab);
    if (String.fromCharCode(...b.subarray(0, 4)) !== 'fLaC') return decodeWav(ab);
    // The bundled samples ship as FLAC; ffmpeg (on CI's ubuntu image) turns them into PCM WAV.
    const wav = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-f', 'wav', '-c:a', 'pcm_s16le', 'pipe:1'], { input: b, maxBuffer: 1 << 28 });
    return decodeWav(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength));
  }
  async resume() {}
  // Render a mono buffer from `node` (default: the destination).
  async startRendering(node = this.tap || this.destination) {
    const out = new AudioBuffer(1, this.length, this.sampleRate), d = out.data[0];
    this.state = 'running';
    for (let b = 0; b * BLOCK < this.length; b++) {
      this.currentTime = (b * BLOCK) / this.sampleRate;
      const s = node.pull(b);
      if (s && s !== DEAD) d.set(s.subarray(0, Math.min(BLOCK, this.length - b * BLOCK)), b * BLOCK);
    }
    this.state = 'closed';
    return out;
  }
}

// Lets js/livekit.js load the bundled CC0 samples from disk.
export function installGlobals() {
  globalThis.OfflineAudioContext = OfflineAudioContext;
  globalThis.AudioBuffer = AudioBuffer;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, ...rest) => {
    const u = String(url);
    if (!u.startsWith('file:')) return real(url, ...rest);
    try { const buf = await readFile(new URL(u)); return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }; }
    catch { return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }; }
  };
}
