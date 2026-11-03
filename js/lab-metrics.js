const db = (value) => 20 * Math.log10(Math.max(value, 1e-9));
const round = (value, places = 3) => +value.toFixed(places);

export function validateBenchmark(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Benchmark must be a JSON object');
  if (!manifest.id || !Array.isArray(manifest.pairs) || !manifest.pairs.length) throw new Error('Benchmark needs an id and at least one pair');
  const pairIds = new Set();
  for (const pair of manifest.pairs) {
    if (!pair.id || pairIds.has(pair.id)) throw new Error('Every pair needs a unique id');
    pairIds.add(pair.id);
    for (const side of ['a', 'b']) {
      const candidate = pair[side];
      if (!candidate?.id || (!candidate.url && !candidate.file)) throw new Error(`${pair.id}.${side} needs id plus url or file`);
    }
  }
  return manifest;
}

export function analyzePcm(channels, sampleRate, { bpm = 0, renderMs = 0 } = {}) {
  const length = Math.min(...channels.map((channel) => channel.length));
  let peak = 0, sum = 0, dc = 0, clips = 0, crossings = 0;
  let low = 0, lowMid = 0, lowEnergy = 0, midEnergy = 0, highEnergy = 0;
  let prev = 0;
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate);
  const midAlpha = 1 - Math.exp((-2 * Math.PI * 2500) / sampleRate);
  const window = Math.max(1, Math.round(sampleRate * 0.01));
  const envelope = [];
  let windowEnergy = 0;
  for (let i = 0; i < length; i++) {
    let sample = 0;
    for (const channel of channels) sample += channel[i] / channels.length;
    const abs = Math.abs(sample);
    peak = Math.max(peak, abs);
    sum += sample * sample;
    dc += sample;
    if (abs >= 0.999) clips++;
    if (i && (sample >= 0) !== (prev >= 0)) crossings++;
    prev = sample;
    low += lowAlpha * (sample - low);
    lowMid += midAlpha * (sample - lowMid);
    const mid = lowMid - low;
    const high = sample - lowMid;
    lowEnergy += low * low;
    midEnergy += mid * mid;
    highEnergy += high * high;
    windowEnergy += sample * sample;
    if ((i + 1) % window === 0) {
      envelope.push(Math.sqrt(windowEnergy / window));
      windowEnergy = 0;
    }
  }
  const rms = Math.sqrt(sum / length);
  const sortedEnv = [...envelope].sort((a, b) => a - b);
  const floor = sortedEnv[Math.floor(sortedEnv.length * 0.55)] || 0;
  const onsets = [];
  for (let i = 2; i < envelope.length - 1; i++) {
    const rise = envelope[i] - envelope[i - 2];
    if (envelope[i] > floor * 1.8 && rise > Math.max(0.006, floor * 0.45) && i - (onsets.at(-1) ?? -10) > 4) onsets.push(i);
  }
  let gridErrorMs = null;
  if (bpm > 0 && onsets.length) {
    const step = 60 / bpm / 4;
    const errors = onsets.map((index) => {
      const time = index * 0.01;
      return Math.abs(time - Math.round(time / step) * step);
    });
    gridErrorMs = round(errors.reduce((a, b) => a + b, 0) / errors.length * 1000, 1);
  }
  const totalBand = Math.max(1e-12, lowEnergy + midEnergy + highEnergy);
  const duration = length / sampleRate;
  return {
    duration: round(duration, 2),
    peakDb: round(db(peak), 2),
    rmsDb: round(db(rms), 2),
    crestDb: round(db(peak) - db(rms), 2),
    clips,
    dc: round(dc / length, 6),
    lowShare: round(lowEnergy / totalBand),
    midShare: round(midEnergy / totalBand),
    highShare: round(highEnergy / totalBand),
    zeroCrossingsPerSecond: round(crossings / duration, 1),
    onsets: onsets.length,
    gridErrorMs,
    renderRatio: renderMs ? round(renderMs / 1000 / duration) : null,
    flags: [
      clips ? 'clipping' : null,
      Math.abs(dc / length) > 0.005 ? 'dc-offset' : null,
      db(peak) > -0.1 ? 'low-headroom' : null,
      renderMs && renderMs / 1000 > duration ? 'slower-than-realtime' : null,
    ].filter(Boolean),
  };
}

export function summarizeRatings(results) {
  const candidates = {};
  for (const result of results) {
    for (const side of ['left', 'right']) {
      const id = result.identity[side];
      const bucket = candidates[id] ||= { ratings: [], replay: 0, release: 0, appearances: 0, flags: 0 };
      bucket.appearances++;
      bucket.ratings.push(...Object.values(result.ratings[side]).map(Number));
      if (result.replay === side) bucket.replay++;
      if (result.release === side) bucket.release++;
      bucket.flags += result.metrics[side]?.flags?.length || 0;
    }
  }
  return Object.fromEntries(Object.entries(candidates).map(([id, value]) => [id, {
    appearances: value.appearances,
    meanRating: round(value.ratings.reduce((a, b) => a + b, 0) / Math.max(1, value.ratings.length), 2),
    replayWins: value.replay,
    releaseWins: value.release,
    technicalFlags: value.flags,
  }]));
}

// Where a mix's energy sits: the sub (30–60 Hz) a club system moves air with, low bass (60–120 Hz),
// low-mid mud (200–500 Hz) and the 2–5 kHz presence band where leads turn harsh. Levels are dBFS RMS
// of the content inside each band; shares are fractions of the 20 Hz–Nyquist energy.
export const BANDS = { sub: [30, 60], low: [60, 120], mud: [200, 500], harsh: [2000, 5000] };

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

export function spectralBands(channels, sampleRate, { size = 8192 } = {}) {
  const length = Math.min(...channels.map((channel) => channel.length));
  const half = size / 2, power = new Float64Array(half), win = new Float64Array(size);
  let winPower = 0;
  for (let i = 0; i < size; i++) { win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size); winPower += win[i] * win[i]; }
  const re = new Float64Array(size), im = new Float64Array(size);
  let frames = 0;
  for (let start = 0; start < length || !frames; start += half) {
    for (let i = 0; i < size; i++) {
      let s = 0;
      if (start + i < length) for (const channel of channels) s += channel[start + i] / channels.length;
      re[i] = s * win[i]; im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < half; k++) power[k] += (2 * (re[k] * re[k] + im[k] * im[k])) / (size * winPower);
    frames++;
    if (start + size >= length) break;
  }
  const hz = sampleRate / size, sum = (lo, hi) => {
    let e = 0;
    for (let k = Math.ceil(lo / hz); k < Math.min(half, Math.ceil(hi / hz)); k++) e += power[k];
    return e / frames;
  };
  const total = Math.max(1e-20, sum(20, sampleRate / 2)), out = { totalDb: round(10 * Math.log10(total), 1) };
  for (const [name, [lo, hi]] of Object.entries(BANDS)) {
    const e = sum(lo, hi);
    out[`${name}Db`] = round(10 * Math.log10(Math.max(e, 1e-20)), 1);
    out[`${name}Share`] = round(e / total);
  }
  return out;
}

// ITU-R BS.1770 K-weighting (high shelf + low cut), so levels compare the way ears hear them.
function biquad(x, b0, b1, b2, a0, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
export function kWeight(x, sampleRate) {
  let w = (2 * Math.PI * 1681.974450955533) / sampleRate, A = Math.pow(10, 3.999843853973347 / 40), al = Math.sin(w) / (2 * 0.7071752369554196), c = Math.cos(w), r = 2 * Math.sqrt(A) * al;
  const s = biquad(x, A * (A + 1 + (A - 1) * c + r), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - r), A + 1 - (A - 1) * c + r, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - r);
  w = (2 * Math.PI * 38.13547087602444) / sampleRate; al = Math.sin(w) / (2 * 0.5003270373238773); c = Math.cos(w);
  return biquad(s, (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
}
// Integrated loudness without gating (fine for comparing renders of the same length).
export function lufs(channels, sampleRate) {
  let e = 0, n = 0;
  for (const ch of channels) { const k = kWeight(ch, sampleRate); for (let i = 0; i < k.length; i++) e += k[i] * k[i]; n = k.length; }
  return -0.691 + 10 * Math.log10(e / Math.max(1, n) + 1e-20);
}
