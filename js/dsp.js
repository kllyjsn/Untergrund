export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function makeNoise(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = rng(90210);
  for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
  return buf;
}

// Stereo exponentially-decaying noise impulse that darkens over time (plate/hall-ish).
export function makeIR(ctx, seconds, { decay = 3, brightStart = 0.85, brightEnd = 0.08, predelay = 0.012, seed = 7 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const r = rng(seed + ch * 101);
    let y = 0;
    const pre = Math.floor(predelay * sr);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const a = brightStart + (brightEnd - brightStart) * Math.sqrt(t);
      y += a * ((r() * 2 - 1) - y);
      const env = i < pre ? 0 : Math.pow(1 - t, decay) * Math.min(1, (i - pre) / (sr * 0.004));
      d[i] = y * env;
    }
  }
  return buf;
}

const curveCache = new Map();
export function driveCurve(amount) {
  const key = Math.round(amount * 100);
  if (curveCache.has(key)) return curveCache.get(key);
  const n = 4096;
  const k = 1 + (key / 100) * 14;
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  curveCache.set(key, c);
  return c;
}

// Waveshaper input is clamped to [-1, 1]. Transparent below 0.88, smooth knee up to a 0.98 ceiling (~ -0.2 dBFS).
export function clipCurve() {
  const n = 8192;
  const c = new Float32Array(n);
  const knee = 0.88, ceil = 0.98, w = ceil - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a < knee ? a : knee + w * Math.tanh((a - knee) / w);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

export function encodeWav(channels, sampleRate) {
  const nCh = channels.length;
  const len = channels[0].length;
  const bytesPer = 3;
  const dataSize = len * nCh * bytesPer;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * bytesPer, true);
  v.setUint16(32, nCh * bytesPer, true); v.setUint16(34, 24, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < nCh; ch++) {
      let s = Math.max(-1, Math.min(1, channels[ch][i]));
      let x = Math.round(s * 8388607);
      if (x < 0) x += 16777216;
      v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255);
      o += 3;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Unity small-signal gain soft saturator. Input is pre-scaled by 1/HEADROOM so the
// waveshaper's [-1, 1] input range covers +12 dB of mix level.
export const SAT_HEADROOM = 4;
const satCache = new Map();
export function satCurve(amount) {
  const key = Math.round(amount * 100);
  if (satCache.has(key)) return satCache.get(key);
  const n = 8192;
  const d = 0.25 + (key / 100) * 1.35;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = ((i / (n - 1)) * 2 - 1) * SAT_HEADROOM;
    c[i] = Math.tanh(s * d) / d;
  }
  satCache.set(key, c);
  return c;
}
