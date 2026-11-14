import { pocketOf } from './groove.js';
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
  gtrsoft: [40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72],
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
  // The SONGS band: steel-string acoustic guitar and electric bass guitar.
  agtr: [40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72],
  ebass: [28, 31, 34, 37, 40, 43, 46, 49, 52, 55],
  // COUNTRY: a Fender clean off the bridge pickup for the lead, and a diatonic harmonica in C for the answers.
  tele: [52, 55, 59, 61, 64, 67, 71, 72, 74, 77, 80, 82, 85],
  hca: [48, 52, 55, 60, 64, 67, 72, 76, 79, 84],
  // More guitars: the archtop's magnetic pickup (JAZZ GTR), the SX guitar banjo, the green Gretsch (TWANG GTR).
  jazz: [40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72],
  banjo: [40, 42, 45, 49, 51, 54, 57, 60, 63, 68, 71],
  gretsch: [40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72],
};
// Measured pitch of a recording minus its name, in cents (python3 test/sampletune.py), for takes played a little off.
const GTR_TUNE = { 40: -4, 42: -2, 45: -8, 48: -6, 51: 8, 54: 4, 57: 9, 60: 4, 63: 2, 66: 2, 72: -2 };
// The staccato takes are read over their first 170 ms (they are damped by 250 ms): a muted pick attack rides sharp.
const MUTE_TUNE = { 40: 17, 42: 27, 45: 8, 48: 7, 51: 22, 54: 15, 57: 17, 60: 12, 63: 4, 66: 5, 69: -2 };
const MUTE_TUNE_B = { 40: 23, 42: 21, 45: 6, 48: 5, 51: 18, 54: 15, 57: 15, 60: 10, 66: 5, 69: -1, 72: -6 };
const JAZZ_TUNE = { 42: -7, 48: -10, 51: -3, 57: -3, 63: -3, 66: 4, 69: -3, 72: -4 };
const GRETSCH_TUNE = { 42: 19, 48: 6, 51: 5, 54: 5, 57: 10, 60: 7, 63: 6, 66: 4, 69: 2 };
// The guitar banjo was tuned up a little under a quarter tone.
const BANJO_TUNE = { 40: 41, 42: 41, 45: 48, 49: 39, 51: 43, 54: 34, 57: 13, 60: 30, 63: 41, 68: 23, 71: 10 };
const BAND_TUNE = { tele: { 55: -8 }, hca: { 48: -8 }, jazz: JAZZ_TUNE, jazzb: JAZZ_TUNE, gretsch: GRETSCH_TUNE, gretschb: GRETSCH_TUNE, banjo: BANJO_TUNE, gtr: GTR_TUNE, gtrsoft: GTR_TUNE, gtrb: GTR_TUNE, gtrsoftb: GTR_TUNE, gtrmute: MUTE_TUNE, gtrmuteb: MUTE_TUNE_B };
// Instruments recorded at two dynamics: the softly played layer loads with the instrument.
export const SOFT_LAYER = { piano: 'pianosoft', gtr: 'gtrsoft' };
// A second take of every guitar note, so a repeated strum alternates recordings instead of machine-gunning one.
// Loaded in the background once the first take is in; until then every hit plays the first take.
export const TAKES = { gtr: 'gtrb', gtrsoft: 'gtrsoftb', agtr: 'agtrb', gtrmute: 'gtrmuteb', jazz: 'jazzb', gretsch: 'gretschb' };
// The Hofner's staccato (fretting hand lifted right after the pick): the DRIVE GTR's palm-muted chug.
export const MUTE_LAYER = { gtr: 'gtrmute' };
// Background-only recordings: alternate takes and mutes, never waited on before a song starts.
const EXTRA_TAKES = Object.fromEntries([...Object.entries(TAKES), ...Object.entries(MUTE_LAYER)].map(([k, alt]) => [alt, BAND[k] || BAND.gtr]));
// STAB voice index -> recorded instrument.
export const STAB_BAND = { 7: 'piano', 8: 'gtr', 9: 'horn', 10: 'str', 11: 'gtr', 12: 'agtr', 13: 'jazz', 14: 'banjo', 15: 'gretsch' };
Object.assign(BAND, EXTRA_TAKES);
export const BAND_FILES = Object.entries(BAND).flatMap(([k, ns]) => ns.map((n) => `${k}_${n}`));
// Crash and toms of the same recorded kit, loaded only by the band pockets that play them (POP, R&B, ROCK, FOLK, COUNTRY).
export const KIT_EXTRA = ['crash_v2', 'crash_v3', 'htom_v8', 'htom_v14', 'ltom_v8', 'ltom_v14'];

const BASE = new URL('../samples/live/', import.meta.url);
// Samples are served with immutable caching: bump SAMPLES_REV whenever a file under samples/live changes.
const SAMPLES_REV = 4;
const sampleUrl = (file) => new URL(`${file}.flac?v=${SAMPLES_REV}`, BASE);
let buffers = null, loading = null, extra = null, extraLoading = null;
const band = {}, bandLoading = {}, names = new WeakMap();

export const bandKit = (name) => band[name] || null;
// Which recording a loaded set is ('gtr', 'gtrsoft', ...), so a player can reach its other takes.
export const bandName = (set) => names.get(set) || null;

export function loadBand(name) {
  if (SOFT_LAYER[name]) loadBand(SOFT_LAYER[name]);
  if (band[name]) for (const k of [TAKES[name], MUTE_LAYER[name]]) if (k) loadBand(k);
  if (band[name]) return Promise.resolve(band[name]);
  if (bandLoading[name]) return bandLoading[name];
  if (!BAND[name] || typeof fetch !== 'function' || typeof OfflineAudioContext === 'undefined') return Promise.resolve(null);
  const dec = new OfflineAudioContext(1, 1, 44100);
  bandLoading[name] = Promise.all(BAND[name].map(async (m) => {
    const res = await fetch(sampleUrl(`${name}_${m}`));
    if (!res.ok) throw new Error(`${name}_${m}: HTTP ${res.status}`);
    return [m + (BAND_TUNE[name]?.[m] ?? 0) / 100, await dec.decodeAudioData(await res.arrayBuffer())];
  })).then((entries) => {
    band[name] = entries; names.set(entries, name);
    for (const k of [TAKES[name], MUTE_LAYER[name]]) if (k) loadBand(k);
    return entries;
  }).catch((err) => { console.warn(`${name} samples unavailable, using synth voice`, err); return null; });
  return bandLoading[name];
}

export const liveKit = () => buffers;

// The recordings a song plays: 'kit' (drums + upright bass, for LIVE and HYBRID kits) and the chord instrument.
export function liveSets(st) {
  const out = Math.round(st?.master?.kit || 0) >= 1 ? ['kit'] : [];
  if (out.length && pocketOf(st.master)?.band) out.push('kitx');
  if (Math.round(st?.params?.acid?.voice || 0) === 5) out.push('ebass');
  const name = STAB_BAND[Math.round(st?.params?.stab?.voice || 0)];
  if (name) out.push(name, ...(SOFT_LAYER[name] ? [SOFT_LAYER[name]] : []));
  // Country's lead is a Telecaster whatever plays the chords, answered by a harmonica.
  if (pocketOf(st.master)?.walk) out.push('tele', 'hca');
  return out;
}
// A song's recordings plus their alternate takes and mutes: what an offline render waits for, so exports get every take.
export const withTakes = (names) => [...new Set(names.flatMap((n) => [n, TAKES[n], MUTE_LAYER[n], TAKES[MUTE_LAYER[n]]].filter(Boolean)))];
export const liveSet = (name) => (name === 'kit' ? buffers : name === 'kitx' ? extra : bandKit(name));
export const setsReady = (names) => names.every((n) => liveSet(n));
export const loadSets = (names) => Promise.all(names.map((n) => (n === 'kit' ? loadLiveKit() : n === 'kitx' ? loadKitExtra() : loadBand(n))));

export function loadKitExtra() {
  if (extra) return Promise.resolve(extra);
  if (extraLoading) return extraLoading;
  if (typeof fetch !== 'function' || typeof OfflineAudioContext === 'undefined') return Promise.resolve(null);
  const dec = new OfflineAudioContext(1, 1, 44100);
  extraLoading = Promise.all(KIT_EXTRA.map(async (name) => {
    const res = await fetch(sampleUrl(name));
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return [name, await dec.decodeAudioData(await res.arrayBuffer())];
  })).then((entries) => (extra = Object.fromEntries(entries)))
    .catch((err) => { console.warn('crash/tom samples unavailable', err); return null; });
  return extraLoading;
}

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
