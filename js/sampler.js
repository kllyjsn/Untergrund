// User-owned audio for the VOX track: mic recordings, local files, or the built-in synth choir.
// Audio never leaves the device and is never fetched from the internet.
import { rng } from './dsp.js';

const DB = 'untergrund.samples', STORE = 'samples', KEY = 'current', MAX_SEC = 20;
let current = null, songSeed = 0;
const listeners = new Set();
const synths = new Map();
export const hasUserSample = () => !!current && current.source !== 'synth';

export const onSample = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const voxSeed = (state) => Number.isFinite(state?.artist?.seed) ? state.artist.seed : 0;
export const getSample = (state) => {
  if (state !== undefined) songSeed = voxSeed(state);
  if (!current || (current.source === 'synth' && current.seed !== songSeed)) current = cachedSynth(songSeed);
  return current;
};
export const prepareSample = (state) => current && current.source !== 'synth' ? current : cachedSynth(voxSeed(state));

function cachedSynth(seed) {
  const sample = synths.get(seed) || synthSample(seed);
  synths.delete(seed);
  synths.set(seed, sample);
  if (synths.size > 8) {
    for (const key of synths.keys()) {
      if (key !== 0 && key !== seed && key !== current?.seed) { synths.delete(key); break; }
    }
  }
  return sample;
}

function makeBuffer(channels, sampleRate) {
  const buffer = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate });
  channels.forEach((data, i) => buffer.copyToChannel(data, i));
  return buffer;
}

function bandpass(input, sr, fc, bw, gain, out) {
  const w0 = 2 * Math.PI * fc / sr, alpha = Math.sin(w0) / (2 * (fc / bw));
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = (alpha * x - alpha * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] += y * gain;
  }
}

export function synthVoxChannels(sr = 48000, seed = 0) {
  const random = rng((seed | 0) ^ 0x564f5801);
  const vowels = [[730, 1090, 2440], [570, 840, 2410], [300, 870, 2240], [270, 2290, 3010], [530, 1840, 2480], [660, 1720, 2410], [440, 1020, 2240], [490, 1350, 1690]];
  const notes = [0, 3, 7, 10, 12, 7, 5, 3];
  const seg = Math.floor(0.42 * sr), len = Math.floor(seg * 0.92);
  const out = new Float32Array(seg * vowels.length);
  vowels.forEach((formants, k) => {
    const f0 = 220 * 2 ** (notes[k] / 12);
    const src = new Float32Array(len);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      ph += f0 * (1 + 0.006 * Math.sin(2 * Math.PI * 5.2 * i / sr)) / sr;
      ph -= Math.floor(ph);
      src[i] = 2 * ph - 1 + (random() * 2 - 1) * 0.04;
    }
    const voiced = new Float32Array(len);
    formants.forEach((fc, j) => bandpass(src, sr, fc, [80, 90, 120][j], [1, 0.55, 0.3][j], voiced));
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / (0.04 * sr)) * Math.min(1, (len - i) / (0.08 * sr));
      out[k * seg + i] = voiced[i] * env;
    }
  });
  normalize([out]);
  return [out];
}

// A sung voice for pop-house chops: each vowel recorded on every pitch from C4 to B4, so chops
// land on chord tones at their own pitch instead of being sped up (no chipmunk formants).
// Additive glottal source (-6 dB/oct) shaped by five soprano formants, with breath, a pitch scoop,
// delayed vibrato and slow drift; each note fades in and out inside its segment so chops never click.
const SUNG_VOWELS = [
  [[800, 1150, 2900, 3900, 4950], [80, 90, 120, 130, 140]],
  [[450, 800, 2830, 3800, 4950], [70, 80, 100, 130, 135]],
  [[350, 2000, 2800, 3600, 4950], [60, 100, 120, 150, 200]],
  [[660, 1700, 2400, 3500, 4950], [80, 100, 120, 150, 200]],
  [[325, 700, 2700, 3800, 4950], [50, 60, 170, 180, 200]],
  [[270, 2140, 2950, 3900, 4950], [60, 90, 100, 120, 120]],
];
export const SUNG_LOW = 55, SUNG_NOTES = 20, SUNG_LEN = 0.46, SUNG_VOWEL_COUNT = SUNG_VOWELS.length;
const SCHWA = [500, 1500, 2500, 3500, 4950];
const FORMANT_GAIN = [1, 0.5, 0.2, 0.14, 0.05];
const SINE = Float32Array.from({ length: 4097 }, (_, i) => Math.sin(2 * Math.PI * i / 4096));

export function sungNoteChannels(sr = 24000, seed = 0, vowelIndex = 0, note = 0) {
  const vowel = SUNG_VOWELS[vowelIndex], random = rng(((seed | 0) ^ 0x53554e47) + vowelIndex * 7919 + note * 104729);
  const len = Math.round(SUNG_LEN * sr), block = 64;
  const out = new Float32Array(len);
  const tract = (f, [fs, bs]) => fs.reduce((a, fc, j) => a + FORMANT_GAIN[j] / Math.hypot(1 - (f / fc) ** 2, f * bs[j] / (fc * fc)), 0);
  const f0 = 440 * 2 ** ((SUNG_LOW + note - 69) / 12);
  const harmonics = Math.floor(Math.min(8000, sr * 0.45) / f0), phase = Float64Array.from({ length: harmonics }, () => random());
  const rateHz = 5 + random() * 0.8, vibPhase = random() * Math.PI * 2;
  let drift = 0, shimmer = 0, step = f0 / sr;
  const amps = new Float64Array(harmonics), voiced = new Float32Array(len), breath = new Float32Array(len), noise = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const tm = i / sr;
    if (i % block === 0) {
      drift = drift * 0.97 + (random() * 2 - 1) * 0.6;
      shimmer = shimmer * 0.8 + (random() * 2 - 1) * 0.01;
      const glide = Math.min(1, tm / 0.035), shape = [vowel[0].map((fc, j) => fc + (SCHWA[j] - fc) * 0.5 * (1 - glide)), vowel[1]];
      const scoop = -35 * Math.max(0, 1 - tm / 0.07);
      const vib = 22 * Math.min(1, Math.max(0, (tm - 0.12) / 0.18)) * Math.sin(2 * Math.PI * rateHz * tm + vibPhase);
      const f = f0 * 2 ** ((scoop + vib + drift + (random() * 2 - 1) * 4) / 1200);
      for (let h = 0; h < harmonics; h++) amps[h] = tract((h + 1) * f, shape) / (h + 1) * (1 + shimmer);
      step = f / sr;
    }
    let x = 0;
    for (let h = 0; h < harmonics; h++) {
      let ph = phase[h] + (h + 1) * step;
      ph -= Math.floor(ph);
      phase[h] = ph;
      const pos = ph * 4096, j = pos | 0;
      x += amps[h] * (SINE[j] + (SINE[j + 1] - SINE[j]) * (pos - j));
    }
    voiced[i] = x;
    noise[i] = random() * 2 - 1;
  }
  vowel[0].forEach((fc, j) => bandpass(noise, sr, fc, vowel[1][j] * 2, FORMANT_GAIN[j], breath));
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(voiced[i]));
  for (let i = 0; i < len; i++) {
    const tm = i / sr, rest = (len - i) / sr;
    const env = Math.sin(Math.PI / 2 * Math.min(1, tm / 0.012)) * Math.sin(Math.PI / 2 * Math.min(1, rest / 0.06));
    out[i] = 0.8 * (voiced[i] / peak * (0.9 + 0.1 * Math.sin(2 * Math.PI * 3.1 * tm)) + breath[i] * (0.05 + 0.25 * Math.max(0, 1 - tm / 0.03))) * env;
  }
  return [out];
}

const sungs = new Map();
// One sung note per (seed, vowel, pitch), built on first use (a few ms) so no song start waits on all of them.
export function sungNote(state, vowel, midi, take = 0) {
  const k = ((vowel % SUNG_VOWELS.length) + SUNG_VOWELS.length) % SUNG_VOWELS.length;
  let n = midi - SUNG_LOW;
  while (n < 0) n += 12;
  while (n >= SUNG_NOTES) n -= 12;
  const seed = voxSeed(state) + take * 977, key = `${seed}:${k}:${n}`;
  if (!sungs.has(key)) {
    if (sungs.size >= 6 * SUNG_VOWELS.length * SUNG_NOTES) sungs.delete(sungs.keys().next().value);
    sungs.set(key, makeBuffer(sungNoteChannels(24000, seed, k, n), 24000));
  }
  return sungs.get(key);
}

export function normalize(channels, target = 0.9) {
  let peak = 0;
  for (const d of channels) for (const v of d) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (const d of channels) for (let i = 0; i < d.length; i++) d[i] *= target / peak;
}

export function detectSlices(data, sr, duration, count = 8) {
  const hop = Math.round(sr * 0.01), env = [];
  for (let i = 0; i + hop <= data.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += data[j] * data[j];
    env.push(Math.sqrt(s / hop));
  }
  const flux = env.map((v, i) => [Math.max(0, v - (env[i - 1] || 0)), i]).sort((a, b) => b[0] - a[0]);
  const picks = [];
  for (const [v, i] of flux) {
    if (picks.length >= count || v < 0.02) break;
    if (picks.every((p) => Math.abs(p - i) >= 8)) picks.push(i);
  }
  if (picks.length < count / 2) return Array.from({ length: count }, (_, k) => (k * duration) / count);
  return picks.map((i) => (Math.max(0, i - 1) * hop) / sr).sort((a, b) => a - b);
}

function synthSample(seed = songSeed) {
  const channels = synthVoxChannels(48000, seed);
  const buffer = makeBuffer(channels, 48000);
  return { buffer, name: 'SYNTH VOX', source: 'synth', seed, slices: detectSlices(channels[0], 48000, buffer.duration) };
}

function setSample(buffer, name, source, store = true) {
  current = { buffer, name, source, slices: detectSlices(buffer.getChannelData(0), buffer.sampleRate, buffer.duration) };
  if (source === 'synth') current.seed = songSeed;
  if (store) persist(source === 'synth' ? null : {
    name, source, sampleRate: buffer.sampleRate,
    channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice()),
  });
  listeners.forEach((fn) => fn(current));
  return current;
}

export async function setFromArrayBuffer(arrayBuffer, name, source) {
  const decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(arrayBuffer);
  const len = Math.min(decoded.length, MAX_SEC * decoded.sampleRate);
  const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, i) => decoded.getChannelData(i).slice(0, len));
  normalize(channels);
  return setSample(makeBuffer(channels, decoded.sampleRate), String(name).slice(0, 40).toUpperCase(), source);
}

export const loadAudioFile = async (file) => setFromArrayBuffer(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ''), 'file');
export const useSynthVox = () => setSample(cachedSynth(songSeed).buffer, 'SYNTH VOX', 'synth');

// Mic capture shared by VOX, hum-to-hook and the voice instrument. Resolves with the decoded take
// (mono/stereo Float32Arrays) without touching the VOX sample; `stream` is exposed for level meters.
export async function recordMic(maxSec = MAX_SEC, constraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw Object.assign(new Error('This browser cannot record audio here'), { name: 'NotSupportedError' });
  }
  const nativeAudioMode = (recording) => {
    try { if (navigator.audioSession) navigator.audioSession.type = recording ? 'play-and-record' : 'playback'; } catch {}
    window.__untergrundNative?.post({ type: 'audioMode', recording });
  };
  nativeAudioMode(true);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  } catch (error) {
    nativeAudioMode(false);
    throw error;
  }
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve, reject) => {
    rec.onerror = (event) => {
      stream.getTracks().forEach((t) => t.stop());
      nativeAudioMode(false);
      reject(event.error || new Error('Microphone recording failed'));
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      nativeAudioMode(false);
      try {
        const decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await new Blob(chunks).arrayBuffer());
        const len = Math.min(decoded.length, Math.ceil(maxSec * decoded.sampleRate));
        resolve({ sampleRate: decoded.sampleRate, channels: Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, i) => decoded.getChannelData(i).slice(0, len)) });
      } catch (err) { reject(err); }
    };
  });
  rec.start();
  const timer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), maxSec * 1000);
  return { stream, done, stop: () => { clearTimeout(timer); if (rec.state !== 'inactive') rec.stop(); return done; } };
}

export async function startRecording(maxSec = MAX_SEC) {
  const mic = await recordMic(maxSec);
  const done = mic.done.then(({ channels, sampleRate }) => {
    normalize(channels);
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return setSample(makeBuffer(channels, sampleRate), `REC ${stamp}`, 'mic');
  });
  return { done, stop: () => { mic.stop(); return done; } };
}

const idb = () => new Promise((resolve, reject) => {
  const q = indexedDB.open(DB, 1);
  q.onupgradeneeded = () => q.result.createObjectStore(STORE);
  q.onsuccess = () => resolve(q.result);
  q.onerror = () => reject(q.error);
});

// Local-only storage for the user's recordings (this device's IndexedDB; never uploaded).
export async function putRecord(key, record) {
  try {
    const store = (await idb()).transaction(STORE, 'readwrite').objectStore(STORE);
    if (record) store.put(record, key); else store.delete(key);
  } catch {}
}
const persist = (record) => putRecord(KEY, record);

export async function getRecord(key) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const q = db.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  } catch { return null; }
}

export async function restoreSample() {
  try {
    const record = await getRecord(KEY);
    if (record?.channels?.length) setSample(makeBuffer(record.channels, record.sampleRate), record.name, record.source, false);
  } catch {}
}
