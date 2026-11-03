// Hum-to-hook and voice-chop DSP. Pure functions over Float32Array buffers: no Web Audio, no network,
// so the same code runs in the browser and in Node tests (test/hum.mjs).

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteLabel = (m) => NOTE_NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

// Box-filtered decimation to ~16 kHz: plenty for voice pitch and ~10x cheaper for YIN.
function decimate(data, sr) {
  const f = Math.max(1, Math.floor(sr / 16000));
  if (f === 1) return { x: data, sr };
  const x = new Float32Array(Math.floor(data.length / f));
  for (let i = 0; i < x.length; i++) { let s = 0; for (let j = 0; j < f; j++) s += data[i * f + j]; x[i] = s / f; }
  return { x, sr: sr / f };
}

// YIN (de Cheveigné & Kawahara 2002) on one frame. Returns { f0, conf } with f0 = 0 when unvoiced.
export function yin(x, at, W, sr, fmin = 70, fmax = 1000, threshold = 0.15) {
  const tMin = Math.max(2, Math.floor(sr / fmax)), tMax = Math.min(Math.floor(sr / fmin), x.length - at - W - 1);
  if (tMax <= tMin + 2) return { f0: 0, conf: 0 };
  const d = new Float32Array(tMax + 2);
  for (let tau = 1; tau <= tMax + 1; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const v = x[at + j] - x[at + j + tau]; s += v * v; }
    d[tau] = s;
  }
  let run = 0;
  const dn = new Float32Array(tMax + 2);
  dn[0] = 1;
  for (let tau = 1; tau <= tMax + 1; tau++) { run += d[tau]; dn[tau] = run ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = tMin; t <= tMax; t++) {
    if (dn[t] < threshold) { while (t + 1 <= tMax && dn[t + 1] < dn[t]) t++; tau = t; break; }
  }
  if (tau < 0) return { f0: 0, conf: 0 };
  const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1], den = a - 2 * b + c;
  const shift = den ? Math.max(-1, Math.min(1, (a - c) / (2 * den))) : 0;
  return { f0: sr / (tau + shift), conf: 1 - b };
}

// Frame-by-frame pitch + loudness, 10 ms hops. Frames below the noise gate are unvoiced (midi = null).
export function pitchTrack(data, sampleRate, { hop = 0.01, win = 0.032, fmin = 70, fmax = 1000 } = {}) {
  const { x, sr } = decimate(data, sampleRate);
  const H = Math.max(1, Math.round(hop * sr)), W = Math.round(win * sr), tMax = Math.ceil(sr / fmin) + 2;
  const frames = [];
  for (let at = 0; at + W + tMax < x.length || (at + W < x.length && !frames.length); at += H) {
    let s = 0;
    for (let j = 0; j < W; j++) s += x[at + j] * x[at + j];
    frames.push({ t: (at + W / 2) / sr, at, rms: Math.sqrt(s / W), midi: null, conf: 0 });
  }
  const rmsSorted = frames.map((f) => f.rms).sort((a, b) => a - b);
  const floor = rmsSorted[Math.floor(rmsSorted.length * 0.1)] || 0, peak = rmsSorted[rmsSorted.length - 1] || 0;
  const gate = Math.max(1e-4, floor * 4, peak * 0.08);
  for (const f of frames) {
    if (f.rms < gate) continue;
    const { f0, conf } = yin(x, f.at, W, sr, fmin, fmax);
    if (f0) { f.midi = hzToMidi(f0); f.conf = conf; }
  }
  // 5-frame median on voiced runs removes one-frame octave slips.
  const raw = frames.map((f) => f.midi);
  for (let i = 0; i < frames.length; i++) {
    if (raw[i] === null) continue;
    const near = raw.slice(Math.max(0, i - 2), i + 3).filter((m) => m !== null);
    frames[i].midi = median(near);
  }
  return { frames, gate, peak, hop: H / sr };
}

// Group voiced frames into notes. A new note starts on silence or when the pitch settles
// more than `split` semitones away for `hold` frames; glides between notes are too short to count.
export function segmentNotes(track, { split = 0.6, hold = 3, minDur = 0.07, gap = 2 } = {}) {
  const { frames, hop } = track;
  const notes = [], glides = [];
  let seg = null, dev = [], quiet = 0;
  const close = (endIdx) => {
    if (seg && seg.m.length) {
      const dur = (endIdx - seg.i0) * hop, at = frames[seg.i0].t - hop / 2;
      if (dur >= minDur) notes.push({ start: at, end: at + dur, midi: median(seg.m), rms: median(seg.r) });
      else glides.push(at);
    }
    seg = null; dev = [];
  };
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.midi === null || (seg && f.rms < 0.3 * median(seg.r))) {
      if (seg && ++quiet > gap) close(i - quiet + 1);
      continue;
    }
    quiet = 0;
    if (!seg) { seg = { i0: i, m: [f.midi], r: [f.rms] }; continue; }
    if (Math.abs(f.midi - median(seg.m)) > split) {
      dev.push(i);
      if (dev.length >= hold) {
        const at = dev[0], keep = dev.map((k) => frames[k]);
        close(at);
        seg = { i0: at, m: keep.map((k) => k.midi), r: keep.map((k) => k.rms) };
      }
      continue;
    }
    for (const k of dev) { seg.m.push(frames[k].midi); seg.r.push(frames[k].rms); }
    dev = [];
    seg.m.push(f.midi); seg.r.push(f.rms);
  }
  close(frames.length - quiet);
  // A dropped glide leaves a hole; the next note owns it so its onset lands where the move began.
  for (let j = 1; j < notes.length; j++) {
    const holeAt = notes[j - 1].end, holeLen = notes[j].start - holeAt;
    const glided = glides.some((g) => g >= holeAt - 1e-6 && g < notes[j].start);
    if (glided && holeLen > 0 && holeLen <= 0.12) notes[j].start = holeAt;
  }
  return notes;
}

// Nearest in-key pitch (absolute MIDI). `key` is the root pitch class 0-11, `scale` its semitone set.
export function snapToScale(midi, key, scale) {
  const pcs = new Set(scale.map((n) => (((key + n) % 12) + 12) % 12));
  let best = Math.round(midi), bd = Infinity;
  for (let m = Math.floor(midi) - 2; m <= Math.ceil(midi) + 2; m++) {
    const d = Math.abs(m - midi);
    if (pcs.has(((m % 12) + 12) % 12) && d < bd - 1e-9) { best = m; bd = d; }
  }
  return best;
}

// Krumhansl-Kessler key profiles; the first and last notes weigh a little more (melodies home there).
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export function detectKey(notes) {
  const w = new Array(12).fill(0);
  notes.forEach((n, i) => {
    const pc = ((Math.round(n.midi) % 12) + 12) % 12;
    w[pc] += (n.end - n.start || 0.1) * (i === 0 ? 1.25 : i === notes.length - 1 ? 1.5 : 1);
  });
  const corr = (p, r) => {
    const mx = w.reduce((a, b) => a + b, 0) / 12, mp = p.reduce((a, b) => a + b, 0) / 12;
    let sxy = 0, sx = 0, sy = 0;
    for (let i = 0; i < 12; i++) { const a = w[(i + r) % 12] - mx, b = p[i] - mp; sxy += a * b; sx += a * a; sy += b * b; }
    return sx && sy ? sxy / Math.sqrt(sx * sy) : 0;
  };
  let best = { key: 0, scale: 'minor', score: -Infinity };
  for (let r = 0; r < 12; r++) {
    for (const [scale, p] of [['major', MAJOR], ['minor', MINOR]]) {
      const score = corr(p, r);
      if (score > best.score + 1e-9) best = { key: r, scale, score };
    }
  }
  return best;
}

// Onto the song's 16th grid: the first sung note is the downbeat. A hum longer than the
// hook is read at double time before anything is cut.
export function quantize(notes, { bpm, steps = 32, maxLen = 16 } = {}) {
  if (!notes.length) return { notes: [], scale: 1 };
  const sd = 60 / bpm / 4, origin = notes[0].start;
  const span = (notes[notes.length - 1].end - origin) / sd;
  const scale = span > steps + 2 ? 0.5 : 1;
  const out = [];
  for (const n of notes) {
    let step = Math.round(((n.start - origin) * scale) / sd);
    const prev = out[out.length - 1];
    if (prev && step <= prev.step) step = prev.step + 1;
    if (step >= steps) break;
    const len = Math.max(1, Math.round(((n.end - n.start) * scale) / sd));
    if (prev) prev.len = Math.max(1, Math.min(prev.len, step - prev.step));
    out.push({ step, len: Math.min(len, maxLen, steps - step), midi: n.midi, rms: n.rms });
  }
  return { notes: out, scale };
}

// Quantized notes -> the engine's 2-bar hook ({v,o,s,x}); s[step] = [semitones from the key root at
// MIDI 60+key, length in steps, velocity]. Octave-shifted into the lead register; h:1 marks it as sung
// so the engine plays it as written instead of bending strong beats to chord tones.
export function hookFromNotes(qnotes, { key = 0, scale = [0, 2, 3, 5, 7, 8, 10], voice = 'warm' } = {}) {
  const k = key > 6 ? key - 12 : key, base = 60 + k;
  const rel = qnotes.map((n) => snapToScale(n.midi, key, scale) - base);
  const shift = rel.length ? -12 * Math.round((median(rel) - 5) / 12) : 0;
  const loud = Math.max(1e-9, ...qnotes.map((n) => n.rms || 0));
  const s = Array.from({ length: 32 }, () => 0);
  qnotes.forEach((n, i) => {
    let semi = rel[i] + shift;
    while (semi > 36) semi -= 12;
    while (semi < -24) semi += 12;
    const v = i === 0 ? 0.86 : 0.7 + 0.28 * Math.min(1, (n.rms || 0) / loud);
    s[n.step] = [semi, n.len, +v.toFixed(3)];
  });
  return { v: voice, o: 0, s, x: { space: 0.1, risk: 0.2, feel: 0.5, warmth: 0.6 }, h: 1 };
}

// Whole pipeline for one recording: pitch track -> notes -> key (detected, or the song's) -> grid -> hook.
export function analyzeHum(data, sr, { bpm = 120, key = null, scale = null, scaleNotes = null, voice } = {}) {
  const track = pitchTrack(data, sr);
  const raw = segmentNotes(track);
  const found = detectKey(raw);
  const useKey = key ?? found.key, useScale = scale ?? found.scale;
  const notesInKey = scaleNotes || (useScale === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]);
  const q = quantize(raw, { bpm });
  const hook = q.notes.length ? hookFromNotes(q.notes, { key: useKey, scale: notesInKey, voice }) : null;
  return { track, raw, notes: q.notes, timeScale: q.scale, hook, key: useKey, scale: useScale, detected: found };
}

// Voice chops: cut a recording into 3-6 sung/spoken pieces at onsets (loudness rises after a dip,
// or a new pitch), each with its median pitch so it can be retuned to any note.
export function sliceChops(data, sr, { min = 3, max = 6 } = {}) {
  const track = pitchTrack(data, sr);
  const { frames, gate, hop } = track;
  const regions = [];
  let a = -1, quiet = 0;
  for (let i = 0; i <= frames.length; i++) {
    const on = i < frames.length && frames[i].rms >= gate;
    if (on) { if (a < 0) a = i; quiet = 0; } else if (a >= 0 && ++quiet > 4) { regions.push([a, i - quiet + 1]); a = -1; quiet = 0; }
  }
  if (a >= 0) regions.push([a, frames.length - quiet]);
  // Split a region where the sung pitch changes (a melody on one breath).
  const notes = segmentNotes(track);
  let cuts = [];
  for (const [i0, i1] of regions) {
    const t0 = frames[i0].t, t1 = frames[i1 - 1].t + hop;
    if (t1 - t0 < 0.06) continue;
    const inside = notes.filter((n) => n.start >= t0 - 0.02 && n.end <= t1 + 0.02);
    if (inside.length < 2) { cuts.push([t0, t1]); continue; }
    inside.forEach((n, j) => cuts.push([j ? n.start : t0, j < inside.length - 1 ? inside[j + 1].start : t1]));
  }
  while (cuts.length && cuts.length < min) {
    let li = 0;
    cuts.forEach((c, i) => { if (c[1] - c[0] > cuts[li][1] - cuts[li][0]) li = i; });
    const [s, e] = cuts[li];
    if (e - s < 0.24) break;
    cuts.splice(li, 1, [s, (s + e) / 2], [(s + e) / 2, e]);
  }
  const level = (s, e) => {
    const fs = frames.filter((f) => f.t >= s && f.t < e);
    return fs.length ? fs.reduce((x, f) => x + f.rms, 0) / fs.length : 0;
  };
  if (cuts.length > max) {
    cuts = cuts.map((c) => [...c, (c[1] - c[0]) * level(c[0], c[1])]).sort((x, y) => y[2] - x[2]).slice(0, max).map((c) => [c[0], c[1]]);
  }
  cuts.sort((x, y) => x[0] - y[0]);
  return cuts.map(([s, e]) => {
    const fs = frames.filter((f) => f.t >= s && f.t < e && f.midi !== null);
    const midi = fs.length >= 3 ? median(fs.map((f) => f.midi)) : null;
    return { start: Math.max(0, s - 0.005), end: Math.min(data.length / sr, e + 0.01), midi, rms: level(s, e) };
  });
}

// Which chop sings MIDI note `target`: the nearest pitched one (a couple of semitones of slack lets
// neighbours take turns), retuned by playback rate. Unpitched chops play as they are.
export function pickChop(chops, target, turn = 0) {
  const pitched = chops.map((c, i) => [c, i]).filter(([c]) => c.midi !== null);
  if (!pitched.length) { const i = ((turn % chops.length) + chops.length) % chops.length; return chops.length ? { index: i, rate: 1 } : null; }
  const dist = (c) => Math.abs(target - c.midi);
  const best = Math.min(...pitched.map(([c]) => dist(c)));
  const near = pitched.filter(([c]) => dist(c) <= best + 2);
  const [c, index] = near[((turn % near.length) + near.length) % near.length];
  return { index, rate: 2 ** ((target - c.midi) / 12) };
}

// Each chop's in-key home note: the pitch it is tuned to when auditioned on its own.
export const tuneChops = (chops, key, scale) => chops.map((c) => ({ ...c, note: c.midi === null ? null : snapToScale(c.midi, key, scale) }));
