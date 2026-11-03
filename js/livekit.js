// Recorded acoustic kit and upright bass for the live-kit genres (CC0, see samples/live/LICENSE.md).
// Loads lazily; until the buffers arrive the engine keeps using the synthesized live voices.
export const LIVE_KIT = {
  kick: ['kick_v2_1', 'kick_v2_2', 'kick_v4_1', 'kick_v4_2'],
  snare: ['snare_v6', 'snare_v14', 'snare_v24', 'snare_v34', 'snare_rim'],
  hat: ['hh_v1_1', 'hh_v1_2', 'hh_v2_1', 'hh_v2_2', 'hh_v3_1', 'hh_v3_2', 'hh_v4_1', 'hh_v4_2', 'hh_half', 'hh_open'],
  ride: ['ride_v1_1', 'ride_v2_1', 'ride_v2_2', 'ride_v3_1'],
};
// Centers are the measured pitch of each recording (python3 test/sampletune.py), not its name: the Eb1 take
// was played about a quarter tone flat and Bb1 a tenth of a semitone flat, which left A1/B1 sour against the band.
export const BASS_NOTES = [['c1', 23.91], ['eb1', 26.76], ['g1', 31.04], ['bb1', 33.9], ['d2', 38.07], ['f2', 41.03], ['a2', 44.99], ['c3', 48.05]];
// Measured head pitch of the recorded snare (Hz): it rings F#3 -33 c whatever the song's key. The kick is left alone:
// its modes are inharmonic, so moving its 83 Hz peak onto the key put more of it off the grid, not less.
export const KIT_PITCH = { snare: 181.4 };
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
  // The CLASSICAL orchestra: loaded section by section, only when a score plays it.
  pianoext: [24, 28, 33, 36, 40, 43, 93, 96],
  pianoextsoft: [24, 28, 33, 36, 40, 43, 93, 96],
  cello: [36, 40, 43, 47, 50, 53, 57, 60, 64, 67],
  cb: [31, 34, 38, 42, 45],
  fl: [60, 64, 69, 72, 76, 81, 84],
  ob: [58, 62, 65, 70, 74, 77, 82],
  cl: [50, 53, 58, 62, 65, 70, 74],
  fh: [43, 46, 50, 53, 57, 60],
  tpt: [57, 60, 63, 67, 70, 74, 77, 81],
  harp: [47, 53, 60, 64, 71, 77, 81, 84, 91],
  timp: [42, 47, 50, 52, 55],
  timproll: [47, 52],
};
// Measured pitch of a recording minus its name, in cents (python3 test/sampletune.py), for takes played a little off.
const BAND_TUNE = { gtr: { 40: -4, 42: -2, 45: -8, 48: -6, 51: 8, 54: 4, 57: 9, 60: 4, 63: 2, 66: 2, 72: -2 } };
// STAB voice index -> recorded instrument.
export const STAB_BAND = { 7: 'piano', 8: 'gtr', 9: 'horn', 10: 'str' };
export const BAND_FILES = Object.entries(BAND).flatMap(([k, ns]) => ns.map((n) => `${k}_${n}`));

const BASE = new URL('../samples/live/', import.meta.url);
// Samples are served with immutable caching: bump SAMPLES_REV whenever a file under samples/live changes.
const SAMPLES_REV = 1;
const sampleUrl = (file) => new URL(`${file}.flac?v=${SAMPLES_REV}`, BASE);
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
    const res = await fetch(sampleUrl(`${name}_${m}`));
    if (!res.ok) throw new Error(`${name}_${m}: HTTP ${res.status}`);
    return [m + (BAND_TUNE[name]?.[m] ?? 0) / 100, await dec.decodeAudioData(await res.arrayBuffer())];
  })).then((entries) => (band[name] = entries))
    .catch((err) => { console.warn(`${name} samples unavailable, using synth voice`, err); return null; });
  return bandLoading[name];
}

export const liveKit = () => buffers;

// The recordings a song plays: 'kit' (drums + upright bass, for LIVE and HYBRID kits) and the chord instrument.
export function liveSets(st) {
  const out = Math.round(st?.master?.kit || 0) >= 1 ? ['kit'] : [];
  const name = STAB_BAND[Math.round(st?.params?.stab?.voice || 0)];
  if (name) out.push(name, ...(name === 'piano' ? ['pianosoft'] : []));
  return out;
}
export const liveSet = (name) => (name === 'kit' ? buffers : bandKit(name));
export const setsReady = (names) => names.every((n) => liveSet(n));
export const loadSets = (names) => Promise.all(names.map((n) => (n === 'kit' ? loadLiveKit() : loadBand(n))));

export function loadLiveKit() {
  if (buffers) return Promise.resolve(buffers);
  if (loading) return loading;
  if (typeof fetch !== 'function' || typeof OfflineAudioContext === 'undefined') return Promise.resolve(null);
  const dec = new OfflineAudioContext(1, 1, 44100);
  loading = Promise.all(LIVE_FILES.map(async (name) => {
    const res = await fetch(sampleUrl(name));
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return [name, await dec.decodeAudioData(await res.arrayBuffer())];
  })).then((entries) => (buffers = Object.fromEntries(entries)))
    .catch((err) => { console.warn('live kit samples unavailable, using synth voices', err); return null; });
  return loading;
}
