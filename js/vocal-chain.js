// The sung vocal's channel strip, run once over the decoded stem (the stem never changes, so live, renders and exports
// play the same processed copy): high-pass, a light presence bump, a de-esser and gentle compression, then back to the
// stem's own level on its sung notes so js/sing.js's level calibration still holds. Reverb and the tempo-synced delay
// are sends in Engine (vocalFx). Settings per genre in VOCAL_FX (js/sing.js); docs/singer.md#vocal-chain.

// RBJ biquad coefficients.
function biquad(type, f, q, db, sr) {
  const w = (2 * Math.PI * f) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q), A = 10 ** (db / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'highshelf') {
    const s = 2 * Math.sqrt(A) * al;
    b0 = A * (A + 1 + (A - 1) * cs + s); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - s);
    a0 = A + 1 - (A - 1) * cs + s; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - s;
  } else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

export function filter(x, [b0, b1, b2, a1, a2]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
  }
  return y;
}

const coef = (ms, sr) => 1 - Math.exp(-1 / ((ms / 1000) * sr));

// RMS over the samples where the stem sings (within 30 dB of its loudest 10 ms).
export function sungRms(x, sr) {
  const w = Math.round(sr / 100), n = Math.floor(x.length / w), e = new Float64Array(n);
  let top = 0;
  for (let k = 0; k < n; k++) { let s = 0; for (let j = k * w; j < (k + 1) * w; j++) s += x[j] * x[j]; e[k] = s / w; top = Math.max(top, e[k]); }
  let s = 0, c = 0;
  for (let k = 0; k < n; k++) if (e[k] > top * 1e-3) { s += e[k]; c++; }
  return c ? Math.sqrt(s / c) : 0;
}

// fx: { hp: Hz, presence: [Hz, dB], deess: { hz, db: max cut, over: dB over the sung level that triggers it },
//       comp: { thr: dB re the sung level, ratio } }
export function processVocal(x, sr, fx) {
  const ref = sungRms(x, sr);
  if (!fx || !ref) return x;
  let y = filter(x, biquad('highpass', fx.hp || 90, 0.707, 0, sr));
  if (fx.hp2) y = filter(y, biquad('highpass', fx.hp, 0.707, 0, sr));
  if (fx.presence) y = filter(y, biquad('peaking', fx.presence[0], 0.9, fx.presence[1], sr));
  if (fx.deess) {
    // A sidechain on the sibilance band drives a high shelf down (up to deess.db) while it is over the threshold;
    // the shelf is re-tuned every 32 samples, so the vocal itself passes through one filter, in phase.
    const { hz = 6500, db = 8, over = -12 } = fx.deess, B = 32;
    const sc = filter(filter(y, biquad('highpass', hz, 0.707, 0, sr)), biquad('highpass', hz, 0.707, 0, sr));
    const thr = ref * 10 ** (over / 20), at = coef(1, sr), rel = coef(60, sr), out = new Float32Array(y.length);
    let env = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let k = 0; k < y.length; k += B) {
      const end = Math.min(y.length, k + B);
      for (let i = k; i < end; i++) { const a = Math.abs(sc[i]); env += (a > env ? at : rel) * (a - env); }
      const cut = env > thr ? Math.min(db, 0.75 * 20 * Math.log10(env / thr)) : 0;
      const [b0, b1, b2, a1, a2] = biquad('highshelf', hz * 0.85, 0.707, -cut, sr);
      for (let i = k; i < end; i++) {
        const v = y[i], o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = v; y2 = y1; y1 = o; out[i] = o;
      }
    }
    y = out;
  }
  if (fx.comp) {
    // RMS detector (10 ms attack, 150 ms release), soft knee of 6 dB.
    const { thr = -6, ratio = 2 } = fx.comp, t = 20 * Math.log10(ref) + thr, at = coef(10, sr), rel = coef(150, sr), knee = 6;
    let p = 0;
    for (let i = 0; i < y.length; i++) {
      const s = y[i] * y[i];
      p += (s > p ? at : rel) * (s - p);
      const lv = 10 * Math.log10(p + 1e-12), o = lv - t;
      const cut = o <= -knee / 2 ? 0 : o >= knee / 2 ? o * (1 - 1 / ratio) : ((o + knee / 2) ** 2 / (2 * knee)) * (1 - 1 / ratio);
      if (cut > 0) y[i] *= 10 ** (-cut / 20);
    }
  }
  const out = sungRms(y, sr), g = out ? ref / out : 1;
  for (let i = 0; i < y.length; i++) y[i] *= g;
  return y;
}

const done = new WeakMap();
// The processed copy of a decoded stem for these settings (cached per buffer and settings).
export function processedStem(buf, fx, ctx) {
  if (!fx || !ctx) return buf;
  const key = JSON.stringify(fx);
  let m = done.get(buf);
  if (!m) done.set(buf, (m = new Map()));
  if (m.has(key)) return m.get(key);
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(processVocal(buf.getChannelData(c), buf.sampleRate, fx));
  m.set(key, out);
  return out;
}
