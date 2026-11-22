// Real-stem Club vocal timing metrics, ported from Music's PR 297/301 review kit (an6.py, pitch.py).
// Pure functions over a recorded render (source start/offset/playbackRate events + grid steps) and the dry stem.
export const SR = 48000;
const MAXLAG = 600;

// Mono float samples from a PCM16 or float32 WAV (first channel).
export function readWav(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.getUint32(0, false) !== 0x52494646 || v.getUint32(8, false) !== 0x57415645) throw new Error('Not a WAV file');
  let fmt, data;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = String.fromCharCode(...buf.subarray(p, p + 4)), size = v.getUint32(p + 4, true);
    if (id === 'fmt ') fmt = { format: v.getUint16(p + 8, true), channels: v.getUint16(p + 10, true), rate: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true) };
    if (id === 'data') data = { at: p + 8, size: Math.min(size, buf.length - p - 8) };
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV is missing fmt or data');
  const width = fmt.bits / 8, frame = width * fmt.channels, n = Math.floor(data.size / frame), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const at = data.at + i * frame;
    if (fmt.format === 3 && fmt.bits === 32) out[i] = v.getFloat32(at, true);
    else if (fmt.format === 1 && fmt.bits === 16) out[i] = v.getInt16(at, true) / 32768;
    else throw new Error(`Unsupported WAV format ${fmt.format}/${fmt.bits}`);
  }
  return { rate: fmt.rate, channels: fmt.channels, samples: out };
}

// YIN as in an6.py / detector.py: fixed n-sample comparison plus 599 lags, CMND < .15, RMS gate .01.
export function yinAt(x, t, n = 2048, from = 0) {
  const i = Math.round((t - from) * SR) - n / 2;
  if (i < 0 || i + 2 * n > x.length) return NaN;
  let e = 0;
  for (let k = 0; k < n; k++) e += x[i + k] * x[i + k];
  if (Math.sqrt(e / n) < 0.01) return NaN;
  const sums = new Float64Array(n + MAXLAG + 1);
  for (let k = 0; k < n + MAXLAG; k++) sums[k + 1] = sums[k] + x[i + k] * x[i + k];
  const cm = new Float64Array(MAXLAG - 1);
  let acc = 0;
  for (let lag = 1; lag < MAXLAG; lag++) {
    let c = 0;
    for (let k = 0; k < n; k++) c += x[i + k] * x[i + k + lag];
    const d = Math.max(0, sums[n] + sums[n + lag] - sums[lag] - 2 * c);
    acc += d;
    cm[lag - 1] = d * lag / Math.max(acc, 1e-12);
  }
  return pick(cm);
}

// YIN as in pitch.py's corrected midpoint measurement: exactly n samples centred on t, mean squared lag differences.
export function yinCentred(x, t, n = 2048) {
  const i = Math.round(t * SR) - n / 2;
  if (i < 0 || i + n > x.length) return NaN;
  let e = 0;
  for (let k = 0; k < n; k++) e += x[i + k] * x[i + k];
  if (Math.sqrt(e / n) < 0.01) return NaN;
  const cm = new Float64Array(MAXLAG - 1);
  let acc = 0;
  for (let lag = 1; lag < MAXLAG; lag++) {
    let d = 0;
    for (let k = 0; k + lag < n; k++) { const q = x[i + k] - x[i + k + lag]; d += q * q; }
    d /= n - lag; acc += d;
    cm[lag - 1] = d * lag / Math.max(acc, 1e-12);
  }
  return pick(cm);
}

function pick(cm) {
  let k = -1;
  for (let j = 40; j < cm.length; j++) if (cm[j] < 0.15) { k = j; break; }
  if (k < 0) return NaN;
  while (k + 1 < cm.length && cm[k + 1] < cm[k]) k++;
  let lag = k;
  if (k >= 1 && k < cm.length - 1) {
    const [a, b, c] = [cm[k - 1], cm[k], cm[k + 1]], den = a - 2 * b + c;
    if (den) lag += 0.5 * (a - c) / den;
  }
  return SR / (lag + 1);
}

export const cents = (a, b) => 1200 * Math.log2(a / b);

function effective(src) {
  let out = [];
  for (const [value, at, kind] of src.events || []) {
    if (kind === 'c') out = out.filter(e => e[1] < at);
    else { out = out.filter(e => e[1] !== at); out.push([value, at, kind]); }
  }
  return out.sort((a, b) => a[1] - b[1]);
}

// Source playhead (s) and playbackRate at render time t; before the start it extrapolates at rate 1 (counterfactual).
export function sourceState(src, t) {
  if (t < src.at) return [src.offset + t - src.at, 1];
  let phase = src.offset, prev = src.at, rate = 1;
  for (const [value, at, kind] of effective(src)) {
    if (at < prev) { rate = value; continue; }
    const dt = Math.max(0, Math.min(t, at) - prev), slope = kind === 'l' && at > prev ? (value - rate) / (at - prev) : 0;
    phase += rate * dt + 0.5 * slope * dt * dt;
    if (t < at) return [phase, rate + slope * dt];
    prev = at; rate = value;
  }
  return [phase + rate * Math.max(0, t - prev), rate];
}

const endOf = (run, i) => Math.min(run.sources[i].stop ?? Infinity, run.sources[i + 1]?.at ?? Infinity);

// Signed vocal lateness (ms) against the scheduled grid, following the incoming source during replacements.
export function lockAt(run, t, length = 22) {
  const i = run.sources.findLastIndex((s, j) => s.at <= t && t < endOf(run, j));
  if (i < 0) return NaN;
  const [phase] = sourceState(run.sources[i], t);
  if (phase < 0 || phase >= length) return NaN;
  const f = phase / run.sd, ix = Math.floor(f), steps = run.steps;
  if (ix < 0 || ix + 1 >= steps.length) return NaN;
  return (t - (steps[ix].at + (f - ix) * (steps[ix + 1].at - steps[ix].at))) * 1000;
}

// Lock statistics sampled every 1 ms from T0+50 ms to T0+21.7 s; unvoiced regions included (as in Music's an6.py).
export function lockStats(run, { from = 1.05, to = 22.7, limit = 50, length = 22 } = {}) {
  let peak = 0, over = 0, run50 = 0, longest = 0, end = NaN, valid = 0;
  for (let k = 0; from + k * 0.001 <= to + 1e-9; k++) {
    const ms = lockAt(run, from + k * 0.001, length);
    if (!Number.isFinite(ms)) { run50 = 0; continue; }
    valid++; end = ms; peak = Math.max(peak, Math.abs(ms));
    if (Math.abs(ms) > limit) { over++; longest = Math.max(longest, ++run50); } else run50 = 0;
  }
  return { peakMs: peak, endMs: end, overS: over / 1000, longestOverS: longest / 1000, validSamples: valid };
}

// Largest pitch movement (cents per 10 ms) in the dry source within ±window of a playhead: a cut inside a moving note.
export function pitchMotion(dry, pos, window = 0.04, n = 2048) {
  let worst = 0, prev = NaN;
  for (let d = -window; d <= window + 1e-9; d += 0.01) {
    const f = yinCentred(dry, pos + d, n);
    if (Number.isFinite(f) && Number.isFinite(prev)) worst = Math.max(worst, Math.abs(cents(f, prev)));
    prev = f;
  }
  return worst;
}

// Every source replacement: voicing of the render on each side (YIN 1024 at -40/-20 ms and 0/+20 ms),
// content jump, and the simultaneous outgoing-vs-incoming pitch at the crossfade midpoint on the dry stem.
export function cuts(run, dry, { fadeMs = 30 } = {}) {
  return run.sources.slice(1).map((s, j) => {
    const prev = run.sources[j], seg = run.splices?.[j + 1], t = s.at;
    const voiced = seg ? [-0.04, -0.02, 0, 0.02].map(d => Number.isFinite(yinAt(seg.pcm, t + d, 1024, seg.from))) : [];
    const voicedBefore = voiced.slice(0, 2).filter(Boolean).length, voicedAfter = voiced.slice(2).filter(Boolean).length;
    const mid = t + fadeMs / 2000, [outPos, outRate] = sourceState(prev, mid), [inPos, inRate] = sourceState(s, mid);
    const sep = n => {
      const a = yinCentred(dry, outPos, n) * outRate, b = yinCentred(dry, inPos, n) * inRate;
      return Number.isFinite(a) && Number.isFinite(b) ? cents(b, a) : null;
    };
    const motion = Math.max(pitchMotion(dry, outPos), pitchMotion(dry, inPos));
    return { time: t - 1, step: s.step, jumpMs: (s.offset - sourceState(prev, t)[0]) * 1000,
      voicedBefore, voicedAfter, voiced: voicedBefore > 0 && voicedAfter > 0,
      outgoingS: outPos, incomingS: inPos, sep2048: sep(2048), sep4096: sep(4096), motionCents: motion };
  });
}

const r1 = n => n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10;
export const sepOf = c => Math.max(Math.abs(c.sep2048 ?? 0), Math.abs(c.sep4096 ?? 0));

export function scoreRun(run, dry) {
  const lock = lockStats(run), all = cuts(run, dry), voiced = all.filter(c => c.voiced);
  return { starts: run.sources.length, peakMs: r1(lock.peakMs), endMs: r1(lock.endMs), overS: Math.round(lock.overS * 1000) / 1000,
    longestOverS: Math.round(lock.longestOverS * 1000) / 1000, voicedCuts: voiced.length,
    maxSepCents: r1(Math.max(0, ...voiced.map(sepOf))), movingCuts: voiced.filter(c => c.motionCents >= 40).length,
    cuts: all.map(c => ({ ...c, jumpMs: r1(c.jumpMs), sep2048: r1(c.sep2048), sep4096: r1(c.sep4096), motionCents: r1(c.motionCents) })) };
}

// Advisory gate for a Club vocal PR, calibrated against Music's PR 297/301/302 verdicts (docs/vocal-timing-eval.md):
// hold = a forced fade clashes by about a semitone or more where base did not, or timing lock gets materially worse;
// notes = new voiced cuts that stay under a semitone, or a higher peak drift (Music shipped both with notes).
export const LIMITS = { semitone: 90, overS: 0.25, peakMs: 5 };
export function compare(base, head) {
  const hold = [], notes = [];
  for (const key of Object.keys(head)) {
    const b = base[key], h = head[key];
    if (!b) continue;
    if (h.maxSepCents >= LIMITS.semitone && h.maxSepCents > b.maxSepCents) hold.push(`${key}: forced-fade pitch separation ${b.maxSepCents} -> ${h.maxSepCents} c`);
    else if (h.voicedCuts > b.voicedCuts) notes.push(`${key}: voiced cuts ${b.voicedCuts} -> ${h.voicedCuts} (max ${h.maxSepCents} c)`);
    if (h.overS - b.overS > LIMITS.overS) hold.push(`${key}: time over 50 ms ${b.overS} -> ${h.overS} s`);
    if (h.peakMs - b.peakMs > LIMITS.peakMs && h.peakMs > 50) notes.push(`${key}: peak drift ${b.peakMs} -> ${h.peakMs} ms`);
  }
  return { verdict: hold.length ? 'hold' : notes.length ? 'notes' : 'pass', reasons: [...hold, ...notes] };
}
