// User-owned audio for the VOX track: mic recordings, local files, or the built-in synth choir.
// Audio never leaves the device and is never fetched from the internet.
const DB = 'untergrund.samples', STORE = 'samples', KEY = 'current', MAX_SEC = 20;
let current = null;
const listeners = new Set();

export const onSample = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getSample = () => current || (current = synthSample());

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

export function synthVoxChannels(sr = 48000) {
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
      src[i] = 2 * ph - 1 + (Math.random() * 2 - 1) * 0.04;
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

function normalize(channels, target = 0.9) {
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

function synthSample() {
  const channels = synthVoxChannels();
  const buffer = makeBuffer(channels, 48000);
  return { buffer, name: 'SYNTH VOX', source: 'synth', slices: detectSlices(channels[0], 48000, buffer.duration) };
}

function setSample(buffer, name, source, store = true) {
  current = { buffer, name, source, slices: detectSlices(buffer.getChannelData(0), buffer.sampleRate, buffer.duration) };
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
export const useSynthVox = () => setSample(synthSample().buffer, 'SYNTH VOX', 'synth');

export async function startRecording(maxSec = MAX_SEC) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve, reject) => {
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      try { resolve(await setFromArrayBuffer(await new Blob(chunks).arrayBuffer(), `REC ${stamp}`, 'mic')); }
      catch (err) { reject(err); }
    };
  });
  rec.start();
  const timer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), maxSec * 1000);
  return { done, stop: () => { clearTimeout(timer); if (rec.state !== 'inactive') rec.stop(); return done; } };
}

const idb = () => new Promise((resolve, reject) => {
  const q = indexedDB.open(DB, 1);
  q.onupgradeneeded = () => q.result.createObjectStore(STORE);
  q.onsuccess = () => resolve(q.result);
  q.onerror = () => reject(q.error);
});

async function persist(record) {
  try {
    const store = (await idb()).transaction(STORE, 'readwrite').objectStore(STORE);
    if (record) store.put(record, KEY); else store.delete(KEY);
  } catch {}
}

export async function restoreSample() {
  try {
    const db = await idb();
    const record = await new Promise((resolve, reject) => {
      const q = db.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    if (record?.channels?.length) setSample(makeBuffer(record.channels, record.sampleRate), record.name, record.source, false);
  } catch {}
}
