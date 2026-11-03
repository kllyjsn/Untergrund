// YOUR VOICE as an instrument: a short recording cut into 3-6 pitched chops that the hook can sing.
// The take stays in this device's IndexedDB (sampler.js) and is never uploaded.
import { putRecord, getRecord, normalize } from './sampler.js';
import { sliceChops } from './hum.js';

const KEY = 'voice-chops';
let current = null;
const listeners = new Set();

export const getChops = () => current;
export const onChops = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function makeBuffer(data, sampleRate) {
  const buffer = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate });
  buffer.copyToChannel(data, 0);
  return buffer;
}

const mono = (channels) => {
  if (channels.length < 2) return channels[0].slice();
  const out = new Float32Array(channels[0].length);
  for (let i = 0; i < out.length; i++) out[i] = (channels[0][i] + channels[1][i]) / 2;
  return out;
};

// A playable voice from one take, or null when nothing usable was sung (too quiet / no onsets).
export function buildVoice({ channels, sampleRate }, name = 'MY VOICE', chops = null) {
  const data = mono(channels);
  normalize([data]);
  chops ||= sliceChops(data, sampleRate);
  if (!chops.length) return null;
  return { buffer: makeBuffer(data, sampleRate), data, sampleRate, chops, name };
}

export function setVoice(take, name = 'MY VOICE', store = true, chops = null) {
  const v = take.buffer ? take : buildVoice(take, name, chops);
  if (!v) return null;
  current = v;
  if (store) putRecord(KEY, { name: v.name, sampleRate: v.sampleRate, data: v.data, chops: v.chops });
  listeners.forEach((fn) => fn(current));
  return current;
}

export function clearVoice() {
  current = null;
  putRecord(KEY, null);
  listeners.forEach((fn) => fn(null));
}

export async function restoreVoice() {
  const r = await getRecord(KEY);
  if (r?.data?.length && r.chops?.length) setVoice({ channels: [r.data], sampleRate: r.sampleRate }, r.name, false, r.chops);
}
