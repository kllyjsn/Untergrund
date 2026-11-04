// Loudness metering after ITU-R BS.1770-4 / EBU R128: K-weighted, gated integrated loudness (LUFS) and
// 4x-oversampled true peak (dBTP). Pure (no Web Audio), so it runs in Node tests and inside a page.

// K-weighting = high shelf (head acoustics) then RLB high-pass, derived for any sample rate
// (the same analog prototypes libebur128 and pyloudnorm use; at 48 kHz they match the tables in BS.1770).
export function kWeighting(fs) {
  let K = Math.tan((Math.PI * 1681.974450955533) / fs), Q = 0.7071752369554196;
  const Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  K = Math.tan((Math.PI * 38.13547087602444) / fs); Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
}

function biquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], o = b[0] * v + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
  }
  return y;
}

const lufs = (z) => -0.691 + 10 * Math.log10(z);

// channels: arrays of samples (L, R, ...; surround weights are not needed here, every channel counts 1.0).
// Returns integrated loudness plus the per-block (400 ms, 75 % overlap) momentary loudness it was gated from.
export function loudness(channels, fs) {
  const [shelf, hp] = kWeighting(fs);
  const hop = Math.round(fs * 0.1), n = channels[0].length, hops = Math.floor(n / hop);
  const e = new Float64Array(hops);
  for (const ch of channels) {
    const y = biquad(biquad(ch, shelf), hp);
    for (let h = 0; h < hops; h++) { let s = 0; for (let i = h * hop, end = i + hop; i < end; i++) s += y[i] * y[i]; e[h] += s; }
  }
  const blocks = [];
  for (let j = 0; j + 4 <= hops; j++) blocks.push((e[j] + e[j + 1] + e[j + 2] + e[j + 3]) / (4 * hop));
  const mean = (zs) => zs.reduce((a, v) => a + v, 0) / zs.length;
  const abs = blocks.filter((z) => z > 0 && lufs(z) > -70);
  if (!abs.length) return { integrated: -Infinity, blocks: blocks.map(lufs) };
  const gate = lufs(mean(abs)) - 10;
  const rel = abs.filter((z) => lufs(z) > gate);
  return { integrated: lufs(mean(rel)), relativeGate: gate, blocks: blocks.map(lufs) };
}

export const integratedLoudness = (channels, fs) => loudness(channels, fs).integrated;

// 4x polyphase interpolator: Kaiser-windowed sinc cut at the original Nyquist. Phase 0 is the identity
// (sinc zeros fall on every 4th tap), so the true peak is never below the sample peak.
const TAPS = 16, UP = 4;
const PHASES = (() => {
  const N = TAPS * UP, mid = N / 2, beta = 7;
  const i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / 2 / k) ** 2; s += t; } return s; };
  const out = [];
  for (let p = 1; p < UP; p++) {
    const h = new Float64Array(TAPS);
    for (let k = 0; k < TAPS; k++) {
      const m = k * UP + p - mid, x = m / UP;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      h[k] = sinc * (i0(beta * Math.sqrt(Math.max(0, 1 - ((k * UP + p - mid) / mid) ** 2))) / i0(beta));
    }
    const sum = h.reduce((a, v) => a + v, 0);
    out.push(h.map((v) => v / sum));
  }
  return out;
})();

export function truePeak(channels) {
  let peak = 0;
  const half = TAPS / 2;
  for (const x of channels) {
    const n = x.length;
    for (let i = 0; i < n; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
    for (let i = 0; i + 1 < n; i++) {
      // Between x[i] and x[i+1]; skip quiet stretches that cannot beat the running peak.
      if (Math.abs(x[i]) < peak * 0.3 && Math.abs(x[i + 1]) < peak * 0.3) continue;
      for (const h of PHASES) {
        let s = 0;
        for (let k = 0; k < TAPS; k++) { const j = i + half - k; if (j >= 0 && j < n) s += h[k] * x[j]; }
        const a = Math.abs(s); if (a > peak) peak = a;
      }
    }
  }
  return peak;
}

export const dbtp = (channels) => 20 * Math.log10(truePeak(channels));
export const samplePeakDb = (channels) => { let p = 0; for (const x of channels) for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return 20 * Math.log10(p); };

// Mastering targets (integrated LUFS over the whole song). Club genres: -10, a modern club master. The quiet
// families keep their dynamics instead of being pushed into the limiter: the recorded jazz/hip-hop band and
// beatless ambient at -14, the orchestra and solo piano at -16 (still far louder than a typical classical
// release; a nocturne's hammer peaks sit ~17 dB over its average, so louder would clip the piano).
// Nothing may peak above -1 dBTP.
export const LOUDNESS_TARGET = { club: -10, quiet: -14, classical: -16, ceiling: -1 };
const TIER = { ambient: 'quiet', neosoul: 'quiet', boombap: 'quiet', symphony: 'classical', concerto: 'classical', nocturne: 'classical', repertoire: 'classical' };
export const targetFor = (style) => LOUDNESS_TARGET[TIER[style] || 'club'];

// Per-style make-up gain (dB) applied in front of the master limiter, measured with scripts/loudness.mjs.
export const MAKEUP_DB = {
  hypnotic: 3.6, industrial: 2.1, acid: 4.5, dub: 4.0, peak: 3.5, hardtechno: 2.1, deephouse: 3.0, minimal: 6.8,
  ukg: 2.5, euphoric: 3.5, neosoul: 1.8, boombap: 0.7, breaks: 3.7, electro: 3.9, dnb: 4.3, trance: 3.8,
  ambient: 2.4, amapiano: 3.0, afrobeats: 2.5, reggaeton: 3.4, bailefunk: 2.8, trap: 3.2, drill: 4.2,
  jerseyclub: 4.3, hyperpop: 3.2, symphony: 7.0, concerto: 5.5, nocturne: 11.9, repertoire: 5.8,
};
export const makeupGain = (style) => 10 ** ((MAKEUP_DB[style] || 0) / 20);
