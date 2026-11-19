import { fft, quantile } from './audio-quality.js';

export const PERCEPTUAL_METRICS = {
  harshTransients: 'Upper-mid attack salience',
  transitionJolt: 'Abrupt, sustained changes in level or tonal balance',
  sectionJolt: 'Transition jolt at known arrangement boundaries only',
  lackOfSmoothness: 'Short-timescale level and tonal jitter',
  toyLikeTimbre: 'Persistent narrow upper-mid resonance (not instrument realism)',
};

const EDGES = [0, 160, 500, 2000, 5000, 8000, 16000];
const HOP_SEC = 0.02, RADIUS = 8;
const clamp = (x) => Math.max(0, Math.min(1, x));
const score = (x) => x == null ? null : +(100 * x).toFixed(2);
const sum = (a) => a.reduce((s, x) => s + x, 0);

function features(L, R, fs) {
  const size = 2 ** Math.round(Math.log2(fs * 0.04)), hop = Math.round(fs * HOP_SEC), hz = fs / size;
  const win = Float64Array.from({ length: size }, (_, j) => 0.5 - 0.5 * Math.cos(2 * Math.PI * j / size));
  const re = new Float64Array(size), im = new Float64Array(size), p = new Float64Array(size / 2);
  const edges = EDGES.map((f) => Math.min(p.length, Math.ceil(f / hz)));
  const toneLo = Math.ceil(700 / hz), toneHi = Math.min(p.length - 1, Math.ceil(4500 / hz));
  const frames = [];
  for (let i = 0; i + size <= L.length; i += hop) {
    for (let j = 0; j < size; j++) { re[j] = L[i + j] * win[j]; im[j] = R[i + j] * win[j]; }
    fft(re, im);
    // Pack L and R into one complex FFT. Mirrored-bin power is the stereo sum, not a mono fold-down.
    for (let k = 1; k < p.length; k++) p[k] = re[k] ** 2 + im[k] ** 2 + re[size - k] ** 2 + im[size - k] ** 2;
    const bands = edges.slice(1).map((end, b) => {
      let energy = 0;
      for (let k = Math.max(1, edges[b]); k < end; k++) energy += p[k];
      return energy;
    });
    let peak = 0;
    for (let k = toneLo; k < toneHi; k++) peak = Math.max(peak, p[k - 1] + p[k] + p[k + 1]);
    frames.push({ bands, energy: sum(bands), peak });
  }
  return { frames, offset: size / (2 * fs), hop: hop / fs, fullScale: 0.75 * size ** 2 };
}

// Compare two stereo band-energy vectors. The level term saturates at 18 dB and the
// tonal term is total variation of the normalized spectra; easing changes scores lower.
function change(a, b, floor) {
  const e = sum(a), f = sum(b);
  const level = clamp(Math.abs(10 * Math.log10(Math.max(e, floor) / Math.max(f, floor))) / 18);
  const color = e >= floor && f >= floor ? sum(a.map((v, i) => Math.abs(v / e - b[i] / f))) / 2 : 0;
  return 0.5 * level + 0.5 * color;
}

function medianBands(frames, from, to) {
  const block = frames.slice(from, to);
  return EDGES.slice(1).map((_, b) => quantile(block.map((f) => f.bands[b]), 0.5));
}

// Scores use the same PCM algorithm on masters, stems and listening excerpts. The last
// is only a resonance proxy on a mix; skip it on known non-instrument stems.
export function analyzePerceptual(L, R, fs, { boundaries = [], instrument = true } = {}) {
  const { frames, offset, hop, fullScale } = features(L, R, fs);
  const ref = quantile(frames.map((f) => f.energy), 0.9) ?? 0;
  const floor = Math.max(ref * 1e-3, fullScale * 10 ** (-75 / 10));
  const attacks = [], jitters = [], transitions = [], section = [], resonances = [];
  const active = frames.filter((f) => f.energy >= floor);
  const bright = (f) => f.bands[3] + 0.5 * f.bands[4];
  const transitionAt = (i) => {
    if (i < RADIUS || i + RADIUS > frames.length) return null;
    const a = medianBands(frames, i - RADIUS, i), b = medianBands(frames, i, i + RADIUS);
    return Math.max(sum(a), sum(b)) >= floor ? change(a, b, floor) : null;
  };
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if (b.energy >= floor && b.energy >= ref * 0.05) {
      const prev = frames.slice(Math.max(0, i - 5), i);
      const background = quantile(prev.map(bright), 0.5);
      attacks.push(Math.sqrt(clamp((bright(b) - background) / b.energy)));
    }
    if (Math.max(a.energy, b.energy) >= floor) jitters.push(change(a.bands, b.bands, floor));
    if (i % 4 === 0) {
      const jolt = transitionAt(i);
      if (jolt != null) transitions.push(jolt);
    }
    if (instrument && b.energy >= floor && a.energy >= floor) {
      // A concentrated upper-mid peak counts more if the surrounding band balance
      // hardly moves. Drum/FX stems are excluded by the caller, not by audio labels.
      const body = b.bands[1] + b.bands[2] + b.bands[3] + b.bands[4];
      if (body > 0) resonances.push(clamp(b.peak / body) * Math.sqrt(clamp(b.peak / b.energy)) * (1 - change(a.bands, b.bands, floor)));
    }
  }
  for (const t of boundaries) {
    const jolt = transitionAt(Math.round((t - offset) / hop));
    if (jolt != null) section.push(jolt);
  }
  return {
    harshTransients: score(attacks.length >= 10 ? quantile(attacks, 0.98) : null),
    transitionJolt: score(transitions.length >= 5 ? quantile(transitions, 0.95) : null),
    sectionJolt: score(quantile(section, 0.9)),
    lackOfSmoothness: score(jitters.length >= 10 ? sum(jitters) / jitters.length : null),
    toyLikeTimbre: score(resonances.length >= 10 ? quantile(resonances, 0.85) : null),
    activeSec: +(active.length * hop).toFixed(2),
    sectionBoundaries: section.length,
  };
}
