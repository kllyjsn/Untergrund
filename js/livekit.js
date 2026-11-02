// Recorded acoustic kit and upright bass for the live-kit genres (CC0, see samples/live/LICENSE.md).
// Loads lazily; until the buffers arrive the engine keeps using the synthesized live voices.
export const LIVE_KIT = {
  kick: ['kick_v2_1', 'kick_v2_2', 'kick_v4_1', 'kick_v4_2'],
  snare: ['snare_v6', 'snare_v14', 'snare_v24', 'snare_v34', 'snare_rim'],
  hat: ['hh_v1_1', 'hh_v1_2', 'hh_v2_1', 'hh_v2_2', 'hh_v3_1', 'hh_v3_2', 'hh_v4_1', 'hh_v4_2', 'hh_half', 'hh_open'],
  ride: ['ride_v1_1', 'ride_v2_1', 'ride_v2_2', 'ride_v3_1'],
};
export const BASS_NOTES = [['c1', 24], ['eb1', 27], ['g1', 31], ['bb1', 34], ['d2', 38], ['f2', 41], ['a2', 45], ['c3', 48]];
export const LIVE_FILES = [
  ...Object.values(LIVE_KIT).flat(),
  ...BASS_NOTES.flatMap(([n]) => [`bass_${n}_a`, `bass_${n}_b`]),
];

// Recorded chord instruments, keyed by the MIDI note each sample was played at.
export const BAND = {
  piano: [48, 52, 57, 60, 64, 67, 71, 74, 77, 81, 84, 88],
  pianosoft: [48, 52, 57, 60, 64, 67, 71, 74, 77, 81, 84, 88],
  gtr: [40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72],
  horn: [53, 58, 62, 65, 67, 70, 74, 77, 81, 84],
  str: [55, 57, 59, 62, 66, 69, 72, 76, 79, 83, 86],
};
// STAB voice index -> recorded instrument.
export const STAB_BAND = { 7: 'piano', 8: 'gtr', 9: 'horn', 10: 'str' };
export const BAND_FILES = Object.entries(BAND).flatMap(([k, ns]) => ns.map((n) => `${k}_${n}`));

const BASE = new URL('../samples/live/', import.meta.url);
let buffers = null, loading = null;
const band = {}, bandLoading = {};

export const bandKit = (name) => band[name] || null;

export function loadBand(name) {
  if (name === 'piano') loadBand('pianosoft');
  if (band[name]) return Promise.resolve(band[name]);
  if (bandLoading[name]) return bandLoading[name];
  if (!BAND[name] || typeof fetch !== 'function' || typeof OfflineAudioContext === 'undefined') return Promise.resolve(null);
  const dec = new OfflineAudioContext(1, 1, 44100);
  bandLoading[name] = Promise.all(BAND[name].map(async (m) => {
    const res = await fetch(new URL(`${name}_${m}.wav`, BASE));
    if (!res.ok) throw new Error(`${name}_${m}: HTTP ${res.status}`);
    return [m, await dec.decodeAudioData(await res.arrayBuffer())];
  })).then((entries) => (band[name] = entries))
    .catch((err) => { console.warn(`${name} samples unavailable, using synth voice`, err); return null; });
  return bandLoading[name];
}

export const liveKit = () => buffers;

export function loadLiveKit() {
  if (buffers) return Promise.resolve(buffers);
  if (loading) return loading;
  if (typeof fetch !== 'function' || typeof OfflineAudioContext === 'undefined') return Promise.resolve(null);
  const dec = new OfflineAudioContext(1, 1, 44100);
  loading = Promise.all(LIVE_FILES.map(async (name) => {
    const res = await fetch(new URL(`${name}.wav`, BASE));
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return [name, await dec.decodeAudioData(await res.arrayBuffer())];
  })).then((entries) => (buffers = Object.fromEntries(entries)))
    .catch((err) => { console.warn('live kit samples unavailable, using synth voices', err); return null; });
  return loading;
}
