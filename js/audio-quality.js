// Rendered-audio quality measurements for scripts/audio-benchmark.mjs: pure functions over PCM (no Web Audio),
// so they run inside the render page and in Node tests. See docs/audio-benchmark.md for what each one means.
import { kWeighting, loudness, truePeak } from './loudness.js';

const db = (x) => 10 * Math.log10(Math.max(x, 1e-20));
const r = (v, p = 2) => (Number.isFinite(v) ? +v.toFixed(p) : null);
export const quantile = (xs, q) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * q)))] : null; };

function biquad(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], o = b[0] * v + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
  }
  return y;
}
// RBJ Butterworth low-pass (Q 0.707), normalized so a[] holds a1, a2 like js/loudness.js.
export function lowpass(fs, f) {
  const w = (2 * Math.PI * f) / fs, al = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), a0 = 1 + al;
  return { b: [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0], a: [(-2 * c) / a0, (1 - al) / a0] };
}
const lp = (x, fs, f) => biquad(biquad(x, lowpass(fs, f)), lowpass(fs, f));

// K-weighted energy per 100 ms hop, summed over channels (BS.1770: loudness = -0.691 + 10 log10(energy)).
export function kHops(channels, fs) {
  const [shelf, hp] = kWeighting(fs), hop = Math.round(fs / 10), n = Math.floor(channels[0].length / hop), e = new Float64Array(n);
  for (const ch of channels) {
    const y = biquad(biquad(ch, shelf), hp);
    for (let h = 0; h < n; h++) { let s = 0; for (let i = h * hop, end = i + hop; i < end; i++) s += y[i] * y[i]; e[h] += s / hop; }
  }
  return e;
}
const lufsOf = (z) => -0.691 + db(z);
const mean = (xs) => xs.reduce((a, v) => a + v, 0) / Math.max(1, xs.length);
// Mean K-weighted loudness of the hops in [a, b) seconds (ungated; used for bars and sections).
const spanLufs = (hops, a, b) => { const i = Math.max(0, Math.floor(a * 10)), j = Math.min(hops.length, Math.max(i + 1, Math.floor(b * 10))); return lufsOf(mean(Array.from(hops.subarray(i, j)))); };

// EBU Tech 3342 loudness range: short-term (3 s) loudness, absolute gate -70, relative gate -20 LU, p95 - p10.
export function loudnessRange(hops) {
  const st = [];
  for (let i = 0; i + 30 <= hops.length; i++) { let s = 0; for (let k = i; k < i + 30; k++) s += hops[k]; st.push(lufsOf(s / 30)); }
  const abs = st.filter((v) => v > -70);
  if (!abs.length) return 0;
  const gate = lufsOf(mean(abs.map((v) => 10 ** ((v + 0.691) / 10)))) - 20, rel = abs.filter((v) => v > gate);
  return quantile(rel, 0.95) - quantile(rel, 0.1);
}

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
// Hann-windowed power spectra of a mono signal, one per hop (calls onFrame(power, frameIndex)).
function stft(x, size, hop, onFrame) {
  const win = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const re = new Float64Array(size), im = new Float64Array(size), p = new Float64Array(size / 2);
  let f = 0;
  for (let s = 0; s + size <= Math.max(size, x.length); s += hop, f++) {
    for (let i = 0; i < size; i++) { re[i] = (x[s + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
    onFrame(p, f);
  }
  return f;
}
const mono = (L, R) => { const m = new Float32Array(L.length); for (let i = 0; i < L.length; i++) m[i] = (L[i] + R[i]) / 2; return m; };

export const BANDS = { sub: [20, 60], bass: [60, 200], lowMid: [200, 500], mid: [500, 2000], presence: [2000, 5000], brilliance: [5000, 10000], air: [10000, 20000] };
const OCTAVES = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
// Long-term average spectrum of the mono sum: energy share per band, octave-band tilt (dB/octave; pink noise = 0),
// and the spectral centroid. Frames quieter than 40 dB under the loudest are skipped so silence doesn't count.
export function spectrum(L, R, fs, { size = 8192 } = {}) {
  const m = mono(L, R), half = size / 2, hz = fs / size, acc = new Float64Array(half), energy = [];
  stft(m, size, half, (p) => { let e = 0; for (let k = 1; k < half; k++) e += p[k]; energy.push(e); });
  const top = Math.max(...energy);
  let used = 0;
  stft(m, size, half, (p, f) => { if (energy[f] > top * 1e-4) { for (let k = 0; k < half; k++) acc[k] += p[k]; used++; } });
  const band = (lo, hi) => { let e = 0; for (let k = Math.ceil(lo / hz); k < Math.min(half, Math.ceil(hi / hz)); k++) e += acc[k]; return e; };
  const total = band(20, Math.min(20000, fs / 2)) || 1e-20, out = { shares: {} };
  for (const [k, [lo, hi]] of Object.entries(BANDS)) out.shares[k] = r(band(lo, Math.min(hi, fs / 2)) / total, 4);
  const pts = OCTAVES.filter((f) => f * Math.SQRT2 < fs / 2).map((f) => [Math.log2(f / 1000), db(band(f / Math.SQRT2, f * Math.SQRT2))]);
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
  const slope = pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  out.tilt = r(slope);
  // Per-octave energy density of a band (dB): mud = how far 200-500 Hz stands above the louder of its neighbours
  // (60-200 Hz, 500 Hz-2 kHz), harshness = 2-5 kHz against the 500 Hz-2 kHz mids. Neither depends on sub or air.
  const dens = (lo, hi) => db(band(lo, Math.min(hi, fs / 2)) / Math.log2(Math.min(hi, fs / 2) / lo));
  out.mudBumpDb = r(dens(200, 500) - Math.max(dens(60, 200), dens(500, 2000)), 1);
  out.harshBumpDb = r(dens(2000, 5000) - dens(500, 2000), 1);
  let num = 0; for (let k = 1; k < half; k++) num += k * hz * acc[k];
  out.centroid = Math.round(num / (band(0, fs / 2) || 1e-20));
  out.octaves = pts.map(([x, y]) => [Math.round(1000 * 2 ** x), r(y - db(total), 1)]);
  out.used = used;
  return out;
}

// Stereo image: energy-weighted L/R correlation, its 5th percentile over loud 400 ms blocks, side/mid ratio,
// mono fold-down loss ((L+R)/2 on both channels vs the stereo mix, LU) and side energy under 120 Hz.
export function stereo(L, R, fs) {
  const n = L.length, blk = Math.round(fs * 0.4), blocks = [];
  let sll = 0, srr = 0, slr = 0;
  for (let s = 0; s + blk <= n; s += blk) {
    let ll = 0, rr = 0, lr = 0;
    for (let i = s; i < s + blk; i++) { ll += L[i] * L[i]; rr += R[i] * R[i]; lr += L[i] * R[i]; }
    sll += ll; srr += rr; slr += lr;
    blocks.push([ll + rr, lr / Math.sqrt(ll * rr + 1e-30)]);
  }
  const loud = Math.max(...blocks.map((b) => b[0]), 1e-30), active = blocks.filter((b) => b[0] > loud * 1e-3).map((b) => b[1]);
  const M = mono(L, R), S = new Float32Array(n);
  for (let i = 0; i < n; i++) S[i] = (L[i] - R[i]) / 2;
  const e = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return s; };
  const lowM = lp(M, fs, 120), lowS = lp(S, fs, 120);
  const st = loudness([L, R], fs).integrated, mo = loudness([M, M], fs).integrated;
  return {
    correlation: r(slr / Math.sqrt(sll * srr + 1e-30), 3), correlationP5: r(quantile(active, 0.05), 3),
    sideToMidDb: r(db(e(S)) - db(e(M)), 1), monoLossLu: r(Number.isFinite(mo) ? mo - st : -99), lowSideDb: r(db(e(lowS)) - db(e(lowM)), 1),
  };
}

// 10 ms RMS envelope in dBFS.
export function envelope(channels, fs, from = 0, to = Infinity, step = 0.01) {
  const w = Math.round(fs * step), a = Math.max(0, Math.round(from * fs)), b = Math.min(channels[0].length, Math.round(to * fs)), out = [];
  for (let i = a; i + w <= b; i += w) { let s = 0; for (const ch of channels) for (let j = i; j < i + w; j++) s += ch[j] * ch[j]; out.push(db(s / (w * channels.length))); }
  return out;
}

// The ending, from the final hit to the end of the render: how long the ring-out takes to fall 40 dB below
// its peak (extrapolated from the decay rate of the last 2 s when the render ends first; 999 = not decaying: a stuck
// tail), the biggest 10 ms drop while still audible (an abrupt cut shows as a cliff), where the render ends relative
// to the song's loudness, and dead air: time the song still runs (songEnd, when playback stops) after the ring-out.
export function ending(channels, fs, finalHit, refLufs, songEnd = null) {
  const env = envelope(channels, fs, Math.max(0, finalHit - 0.02));
  const pk = Math.max(...env.slice(0, 80)), iPk = env.indexOf(pk);
  let t40 = null, measured = true;
  for (let i = env.length - 1; i > iPk; i--) if (env[i] > pk - 40) { t40 = i + 1 < env.length ? (i + 1 - iPk) * 0.01 : null; break; }
  if (t40 == null) {
    measured = false;
    const n = Math.min(200, env.length - iPk - 1), xs = Array.from({ length: n }, (_, k) => env.length - n + k), mx = mean(xs), my = mean(xs.map((i) => env[i]));
    const rate = xs.reduce((a, i) => a + (i - mx) * (env[i] - my), 0) / xs.reduce((a, i) => a + (i - mx) ** 2, 0) / 0.01;
    t40 = rate < -0.1 ? Math.min(999, (env.length - iPk) * 0.01 + (env[env.length - 1] - (pk - 40)) / -rate) : 999;
  }
  let cliff = 0;
  for (let i = iPk + 1; i < env.length; i++) if (env[i - 1] > pk - 50) cliff = Math.max(cliff, env[i - 1] - env[i]);
  const tail = envelope(channels, fs, channels[0].length / fs - 0.5), hops = kHops(channels.map((c) => c.subarray(c.length - Math.round(fs * 0.5))), fs);
  return {
    t40: r(t40, 1), t40Measured: measured, deadAirSec: songEnd != null ? r(Math.max(0, songEnd - finalHit - t40), 1) : null, cliffDb: r(cliff, 1), peakDb: r(pk, 1), tailDb: r(mean(tail), 1),
    tailLu: r(lufsOf(mean(Array.from(hops))) - refLufs, 1),
    envelope: env.filter((_, i) => i % 5 === 0).map((v) => r(Math.max(v, -120), 1)),
  };
}

// Silence the listener would notice: time before the music starts, and the longest stretch inside the song where
// 400 ms loudness sits 35 LU under the song's integrated loudness (a phantom gap / dropout).
export function silence(hops, integrated, from, to) {
  const quiet = (i) => lufsOf((hops[i] + (hops[i + 1] || 0) + (hops[i + 2] || 0) + (hops[i + 3] || 0)) / 4) < integrated - 35;
  let lead = 0; while (lead < hops.length && quiet(lead)) lead++;
  let gap = 0, run = 0;
  for (let i = Math.floor(from * 10); i < Math.min(hops.length - 3, Math.floor(to * 10)); i++) { run = quiet(i) ? run + 1 : 0; gap = Math.max(gap, run); }
  return { leadSec: r(lead / 10, 1), maxGapSec: r(gap / 10, 1) };
}

// Limiter strain from taps on the limiter's input and output: gain reduction per 10 ms while music plays.
// makeupDb: the compressor's fixed make-up gain (DynamicsCompressorNode adds one), measured by the caller on a signal
// far below threshold, so the reduction is absolute. Without it the least-reduced 0.5% of frames is taken as 0 dB.
export function limiter([iL, iR, oL, oR], fs, gateLufs = -Infinity, hops = null, makeupDb = null) {
  const w = Math.round(fs / 100), d = Math.round(fs * 0.006), gr = [];
  for (let i = d; i + w <= iL.length; i += w) {
    let a = 0, b = 0;
    for (let j = i; j < i + w; j++) { a += iL[j - d] * iL[j - d] + iR[j - d] * iR[j - d]; b += oL[j] * oL[j] + oR[j] * oR[j]; }
    const h = hops ? hops[Math.min(hops.length - 1, Math.floor(i / (fs / 10)))] : 1;
    if (a > 1e-7 * w && lufsOf(h) > gateLufs) gr.push(10 * Math.log10(b / a));
  }
  const top = makeupDb ?? [...gr].sort((x, y) => y - x)[Math.floor(gr.length * 0.005)] ?? 0;
  for (let k = 0; k < gr.length; k++) gr[k] = Math.min(0, gr[k] - top);
  const jumps = gr.slice(1).map((v, i) => Math.abs(v - gr[i])), share = (t) => r(gr.filter((v) => v < -t).length / Math.max(1, gr.length), 4);
  return { grMean: r(mean(gr)), grP1: r(quantile(gr, 0.01) ?? 0), strainShare: share(3), over6Share: share(6), grJumpP99: r(quantile(jumps, 0.99) ?? 0) };
}

// A master WaveShaper stage on its own input x (gain * tap), y = curve(x) with the WaveShaper's lookup (linear
// interpolation, input clamped to [-1, 1]). Per 10 ms frame of music: the most it takes off a peak relative to its
// small-signal gain (dB), and whether its input went past full scale, where the curve is flat (hard clipping).
// Sample points only: the node shapes a 4x-oversampled signal, so inter-sample peaks are shaved a little more.
export function shaper([L, R], fs, { gain = 1, curve }, gateLufs = -Infinity, hops = null) {
  const n = curve.length, w = Math.round(fs / 100), shave = [], i0 = Math.floor((n - 1) / 2) - 1, i1 = Math.ceil((n - 1) / 2) + 1;
  const g0 = (curve[i1] - curve[i0]) / ((i1 - i0) * 2 / (n - 1));
  let hard = 0, frames = 0, peak = 0;
  const shape = (x) => { const p = (Math.max(-1, Math.min(1, x)) + 1) / 2 * (n - 1), i = Math.min(n - 2, Math.floor(p)); return curve[i] + (curve[i + 1] - curve[i]) * (p - i); };
  for (let i = 0; i + w <= L.length; i += w) {
    const h = hops ? hops[Math.min(hops.length - 1, Math.floor(i / (fs / 10)))] : 1;
    if (!(lufsOf(h) > gateLufs)) continue;
    let s = 0, over = false, pk = 0;
    for (const ch of [L, R]) for (let j = i; j < i + w; j++) { const x = Math.abs(ch[j] * gain); if (x > pk) pk = x; }
    if (pk > peak) peak = pk;
    if (pk >= 1) over = true;
    // The peak sample carries the most compression on a monotonic curve.
    if (pk > 1e-4) s = Math.max(0, 20 * Math.log10((g0 * pk) / Math.max(1e-9, Math.abs(shape(pk)))));
    frames++; shave.push(s); if (over) hard++;
  }
  const share = (t) => r(shave.filter((v) => v > t).length / Math.max(1, frames), 4);
  return { share1Db: share(1), share3Db: share(3), shaveP50Db: r(quantile(shave, 0.5) ?? 0), shaveP99Db: r(quantile(shave, 0.99) ?? 0), shaveMaxDb: r(Math.max(0, ...shave)), hardShare: r(hard / Math.max(1, frames), 4), inPeakDb: r(20 * Math.log10(peak || 1e-10)) };
}

// Crest factor per span (sample peak over RMS, dB) for spans within 10 LU of the loudest one: low crest = transients
// flattened by limiting/clipping. times: span boundaries (s).
export function crest(L, R, fs, times) {
  const spans = [];
  for (let k = 0; k + 1 < times.length; k++) {
    const a = Math.max(0, Math.round(times[k] * fs)), b = Math.min(L.length, Math.round(times[k + 1] * fs));
    if (b - a < fs * 0.1) continue;
    let pk = 0, sq = 0;
    for (const ch of [L, R]) for (let i = a; i < b; i++) { const v = Math.abs(ch[i]); if (v > pk) pk = v; sq += v * v; }
    const rms = db(sq / (2 * (b - a)));
    spans.push({ rms, crest: 20 * Math.log10(pk || 1e-10) - rms });
  }
  const loud = Math.max(...spans.map((x) => x.rms)), body = spans.filter((x) => x.rms > loud - 10).map((x) => x.crest);
  return { p10Db: r(quantile(body, 0.1), 1), p50Db: r(quantile(body, 0.5), 1), n: body.length };
}

// Everything measured on the master output. opts: barTimes (s, bar starts plus the end of the last bar),
// sections [{ label, from, to }] in bars, finalHit (s), target (LUFS), lim (4 tap channels), full (whole song).
export function analyzeMix(L, R, fs, { barTimes = [], sections = [], finalHit = null, songEnd = null, target = -10, lim = null, clip = null, sat = null, makeupDb = null, crestTimes = null, barNotes = null, refLufs = null, start = 0.05 } = {}) {
  const hops = kHops([L, R], fs), I = loudness([L, R], fs).integrated;
  let clipRuns = 0, run = 0, dc = 0, samplePeak = 0;
  for (const ch of [L, R]) for (let i = 0; i < ch.length; i++) {
    const a = Math.abs(ch[i]); if (a > samplePeak) samplePeak = a; dc += ch[i];
    if (a >= 0.999) { if (++run === 2) clipRuns++; } else run = 0;
  }
  const out = {
    peak: { samplePeakDb: r(20 * Math.log10(samplePeak || 1e-10)), truePeakDb: r(20 * Math.log10(truePeak([L, R]) || 1e-10)), clipRuns, dcDb: r(20 * Math.log10(Math.abs(dc / (2 * L.length)) + 1e-10), 1) },
    loudness: { integrated: r(I), deltaTarget: r(I - target), lra: r(loudnessRange(hops), 1) },
    spectrum: spectrum(L, R, fs),
    stereo: stereo(L, R, fs),
  };
  if (lim) out.limiter = limiter(lim, fs, I - 10, hops, makeupDb);
  if (lim && clip) out.clipper = shaper(lim.slice(2), fs, clip, I - 10, hops);
  if (sat) out.saturator = shaper(sat.taps, fs, sat, I - 10, hops);
  const ct = crestTimes ?? (barTimes.length > 1 ? barTimes : null);
  if (ct) out.crest = crest(L, R, fs, ct);
  const end = barTimes.length ? barTimes[barTimes.length - 1] : songEnd ?? L.length / fs;
  out.silence = silence(hops, I, barTimes[0] ?? start, finalHit != null ? Math.min(end, finalHit) : end);
  if (barTimes.length > 2) {
    const bars = barTimes.slice(0, -1).map((t, i) => r(spanLufs(hops, t, barTimes[i + 1]), 1));
    const body = bars.slice(0, -1).filter(Number.isFinite);
    out.arrangement = { barLufs: bars, contrastLu: r(quantile(body, 0.9) - quantile(body, 0.1), 1) };
    if (sections.length) {
      const per = (xs, s) => (xs ? r(mean(xs.slice(s.from, s.to)), 1) : undefined);
      out.arrangement.sections = sections.map((s) => ({ ...s, lufs: r(spanLufs(hops, barTimes[s.from], barTimes[s.to]), 1), notesPerBar: per(barNotes?.notes, s), voices: per(barNotes?.voices, s) }));
      const lvl = (labels) => { const ss = out.arrangement.sections.filter((s) => labels.includes(s.label)); return ss.length ? lufsOf(mean(ss.map((s) => 10 ** ((s.lufs + 0.691) / 10) * (s.to - s.from))) / mean(ss.map((s) => s.to - s.from))) : null; };
      const peak = lvl(['C', 'G']), intro = lvl(['A']), brk = lvl(['E', 'F']);
      out.arrangement.peakOverIntroLu = peak != null && intro != null ? r(peak - intro, 1) : null;
      out.arrangement.peakOverBreakdownLu = peak != null && brk != null ? r(peak - brk, 1) : null;
      // The same comparison in notes: onsets per bar (ratio) and parts playing per bar (difference), bar-weighted.
      const avg = (labels, k) => { const ss = out.arrangement.sections.filter((s) => labels.includes(s.label) && s[k] != null); const n = ss.reduce((a, s) => a + s.to - s.from, 0); return n ? ss.reduce((a, s) => a + s[k] * (s.to - s.from), 0) / n : null; };
      if (barNotes && peak != null && brk != null) {
        const pn = avg(['C', 'G'], 'notesPerBar'), bn = avg(['E', 'F'], 'notesPerBar');
        out.arrangement.peakOverBreakdownNotes = bn > 0 ? r(pn / bn, 2) : null;
        out.arrangement.peakOverBreakdownVoices = r(avg(['C', 'G'], 'voices') - avg(['E', 'F'], 'voices'), 1);
      }
    }
  }
  if (finalHit != null) out.ending = ending([L, R], fs, finalHit, refLufs ?? I, songEnd);
  return out;
}

// Pre-master stems over one window. stems: [{ id, left, right, notes }] (notes = onsets the song plays in the window),
// kicks: kick onsets (s). Per-stem loudness relative to the stem sum, energetic masking (share of a stem's energy in
// time-frequency cells where the rest of the band is 10 dB louder), and kick/bass low-end collision at each kick.
export function analyzeStems(stems, fs, { kicks = [] } = {}) {
  const n = stems[0].left.length, sumL = new Float32Array(n), sumR = new Float32Array(n);
  for (const s of stems) for (let i = 0; i < n; i++) { sumL[i] += s.left[i]; sumR[i] += s.right[i]; }
  const mix = loudness([sumL, sumR], fs).integrated;
  const size = 2048, hop = 1024, hz = fs / size, edges = [];
  for (let f = 40; f < Math.min(16000, fs / 2); f *= 2 ** (1 / 3)) edges.push([Math.max(1, Math.round(f / hz)), Math.max(2, Math.round((f * 2 ** (1 / 3)) / hz))]);
  const cells = stems.map((s) => {
    const m = mono(s.left, s.right), out = [];
    stft(m, size, hop, (p) => { out.push(edges.map(([a, b]) => { let e = 0; for (let k = a; k < Math.min(b, size / 2); k++) e += p[k]; return e; })); });
    return out;
  });
  const total = cells[0].map((fr, f) => fr.map((_, b) => cells.reduce((a, c) => a + c[f][b], 0)));
  const rows = stems.map((s, k) => {
    let all = 0, buried = 0, sq = 0;
    cells[k].forEach((fr, f) => fr.forEach((e, b) => { all += e; if (total[f][b] - e > 10 * e) buried += e; }));
    for (let i = 0; i < n; i++) sq += s.left[i] * s.left[i] + s.right[i] * s.right[i];
    const rms = db(sq / (2 * n)), l = loudness([s.left, s.right], fs).integrated;
    return { id: s.id, notes: s.notes ?? null, rmsDb: r(rms, 1), relLu: Number.isFinite(l) ? r(l - mix, 1) : null, buriedShare: all > 0 ? r(buried / all, 3) : null, active: rms > -70 };
  });
  const out = { mixLufs: r(mix), stems: rows, missing: rows.filter((s) => s.id !== 'fx' && (s.notes ?? 0) >= 2 && !s.active).map((s) => s.id) };
  const kick = stems.find((s) => s.id === 'kick'), bass = stems.find((s) => s.id === 'acid');
  if (kick && bass && kicks.length >= 4 && rows.find((x) => x.id === 'acid').active) {
    const kl = lp(mono(kick.left, kick.right), fs, 120), bl = lp(mono(bass.left, bass.right), fs, 120), ratios = [];
    for (const t of kicks) {
      const a = Math.round(t * fs), b = Math.min(n, a + Math.round(fs * 0.06));
      if (a < 0 || b - a < fs * 0.03) continue;
      let ek = 0, eb = 0; for (let i = a; i < b; i++) { ek += kl[i] * kl[i]; eb += bl[i] * bl[i]; }
      if (ek > 1e-6 * (b - a)) ratios.push(db(eb) - db(ek));
    }
    if (ratios.length >= 4) out.kickBass = { hits: ratios.length, collisionMedianDb: r(quantile(ratios, 0.5), 1), collisionP90Db: r(quantile(ratios, 0.9), 1) };
  }
  return out;
}
