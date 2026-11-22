import { pocketOf } from './groove.js';
import { RHODES_STYLES } from './rhodes.js';
import { HAND_KIT, MARIMBA_STAB, KIT_BACKBEAT } from './params.js';
// Recorded acoustic kit and upright bass for the live-kit genres (CC0, see samples/live/LICENSE.md).
// Loads lazily; until the buffers arrive the engine keeps using the synthesized live voices.
export const LIVE_KIT = {
  kick: ['kick_v2_1', 'kick_v2_2', 'kick_v2_3', 'kick_v2_4', 'kick_v3_1', 'kick_v3_2', 'kick_v4_1', 'kick_v4_2', 'kick_v4_3', 'kick_v4_4'],
  snare: ['snare_v2', 'snare_v5', 'snare_v6', 'snare_v13', 'snare_v14', 'snare_v23', 'snare_v24', 'snare_v33', 'snare_v34', 'snare_rim'],
  hat: [1, 2, 3, 4].flatMap((v) => [1, 2, 3, 4].map((r) => `hh_v${v}_${r}`)).concat(['hh_half', 'hh_half_2', 'hh_open', 'hh_open_2']),
  ride: ['ride_v1_1', 'ride_v2_1', 'ride_v2_2', 'ride_v3_1'],
};
// Centers are the measured pitch of each recording (python3 test/sampletune.py), not its name: the Eb1 take
// was played about a quarter tone flat and Bb1 a tenth of a semitone flat, which left A1/B1 sour against the band.
export const BASS_NOTES = [['c1', 23.91], ['eb1', 26.76], ['g1', 31.04], ['bb1', 33.9], ['d2', 38.07], ['f2', 41.03], ['a2', 44.99], ['c3', 48.05]];
// Boom Bap chops the attack before the note settles. MIDI centers for takes A and B over the first 225 ms.
export const BOOMBAP_BASS_CENTERS = {
  c1: [24.09, 24.027], eb1: [26.709, 26.726], g1: [31.035, 31.1], bb1: [34.033, 34.021],
  d2: [38.119, 38.175], f2: [41.11, 41.105], a2: [45.173, 45.115], c3: [48.042, 48.079],
};
// Measured head pitch of the recorded snare (Hz): it rings F#3 -33 c whatever the song's key. The kick is left alone:
// its modes are inharmonic, so moving its 83 Hz peak onto the key put more of it off the grid, not less.
export const KIT_PITCH = { snare: 181.4 };
export const LIVE_FILES = [
  ...Object.values(LIVE_KIT).flat(),
  ...BASS_NOTES.flatMap(([n]) => [`bass_${n}_a`, `bass_${n}_b`]),
];

// Recorded chord instruments, keyed by the MIDI note each sample was played at.
export const BAND = {
  rhodes: [28, 31, 34, 37, 40, 43, 46, 49, 52, 55, 58, 61, 64, 86, 89, 93, 96, 100],
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
  nylon: [40, 45, 48, 52, 55, 59, 64, 67, 69],
  ebass: [28, 31, 34, 37, 40, 43, 46, 49, 52, 55],
  // More guitars: the archtop's magnetic pickup (JAZZ GTR), the SX guitar banjo, the green Gretsch (TWANG GTR).
  jazz: [40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72],
  banjo: [40, 42, 45, 49, 51, 54, 57, 60, 63, 68, 71],
  gretsch: [40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72],
  marimba: [48, 55, 59, 65, 72, 79, 83],
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
const BAND_TUNE = { nylon: { 40: -6.7, 45: 2.3, 48: -2.9, 52: -9.6, 55: 10.4, 59: -3.6, 64: -19.7, 67: -11.6, 69: -17 }, jazz: JAZZ_TUNE, jazzb: JAZZ_TUNE, gretsch: GRETSCH_TUNE, gretschb: GRETSCH_TUNE, banjo: BANJO_TUNE, gtr: GTR_TUNE, gtrsoft: GTR_TUNE, gtrb: GTR_TUNE, gtrsoftb: GTR_TUNE, gtrmute: MUTE_TUNE, gtrmuteb: MUTE_TUNE_B };
BAND_TUNE.rhodes = { 28: 0.23, 31: 2.49, 34: 3.23, 37: 2.93, 40: 2.83, 43: 2.51, 46: 0.44, 49: 1.39, 52: -1.24, 55: 1.37, 58: -2.82, 61: 1.67, 64: 5.15, 86: -0.63, 89: -0.72, 93: -6.84, 96: -4.38, 100: 7.88 };
// Instruments recorded at two dynamics: the softly played layer loads with the instrument.
export const SOFT_LAYER = { piano: 'pianosoft', gtr: 'gtrsoft' };
// Alternate woodwind and guitar takes for repeated notes.
// Loaded in the background once the first take is in; until then every hit plays the first take.
export const TAKES = { gtr: 'gtrb', gtrsoft: 'gtrsoftb', agtr: 'agtrb', gtrmute: 'gtrmuteb', jazz: 'jazzb', gretsch: 'gretschb', ob: 'obb', fl: 'flb' };
// The Hofner's staccato (fretting hand lifted right after the pick): the DRIVE GTR's palm-muted chug.
export const MUTE_LAYER = { gtr: 'gtrmute' };
// Background-only recordings: alternate takes and mutes, never waited on before a song starts.
const EXTRA_TAKES = Object.fromEntries([...Object.entries(TAKES), ...Object.entries(MUTE_LAYER)].map(([k, alt]) => [alt, BAND[k] || BAND.gtr]));
// STAB voice index -> recorded instrument.
export const STAB_BAND = { 7: 'piano', 8: 'gtr', 9: 'horn', 10: 'str', 11: 'gtr', 12: 'agtr', 13: 'jazz', 14: 'banjo', 15: 'gretsch', 16: 'cello', 17: 'cl', 18: 'nylon', [MARIMBA_STAB]: 'marimba' };
export const HOOK_BAND = { harpplk: 'harp', oboe: 'ob', airflute: 'fl', tpt: 'tpt', marimba: 'marimba' };
Object.assign(BAND, EXTRA_TAKES);
export const BAND_FILES = Object.entries(BAND).flatMap(([k, ns]) => ns.map((n) => `${k}_${n}`));
// Crash and toms of the same recorded kit, loaded only by the band pockets that play them (POP, R&B, ROCK, FOLK, COUNTRY).
export const KIT_EXTRA = ['crash_v2', 'crash_v3', 'htom_v8', 'htom_v14', 'ltom_v8', 'ltom_v14'];
const HANDS = {
  shaker: ['shaker_1', 'shaker_2', 'shaker_4', 'shaker_7'],
  conga: ['conga_tap_1', 'conga_tap_2', 'conga_open_1', 'conga_open_2'],
  cowbell: ['cowbell_1', 'cowbell_2'],
  timbale: ['timbale_closed_1', 'timbale_closed_2', 'timbale_low_1', 'timbale_low_2', 'timbale_high_1', 'timbale_high_2'],
  cuica: ['cuica_1', 'cuica_2'],
};
const HAND_SETS = {
  [HAND_KIT.amapiano]: ['shaker', 'conga'],
  [HAND_KIT.afrobeats]: ['conga', 'shaker', 'cowbell'],
  [HAND_KIT.reggaeton]: ['conga', 'timbale'],
  [HAND_KIT.bailefunk]: ['timbale', 'cuica'],
};
export const HAND_FILES = Object.values(HANDS).flat();

const BASE = new URL('../samples/live/', import.meta.url);
// Samples are served with immutable caching: bump SAMPLES_REV when replacing an existing recording.
const SAMPLES_REV = 5;
const sampleUrl = (file) => new URL(`${file}.flac?v=${SAMPLES_REV}`, BASE);
let buffers = null, loading = null, extra = null, extraLoading = null;
let snare = null, snareLoading = null;
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
// A band's second layer by section (Engine.bandLayer), on the recorded orchestra: vc cello, vla viola, vln1 violins,
// pno the concert grand. Loudness of the part is v.
export const BAND_LAYER = {
  pop: { pre: { parts: ['vc'], v: 0.5 }, chorus: { parts: ['vln1', 'vla', 'vc'], v: 0.55 }, bridge: { parts: ['vla', 'vc'], v: 0.5 } },
  rnb: { chorus: { parts: ['vln1', 'vla'], v: 0.45 }, bridge: { parts: ['vln1', 'vla', 'vc'], v: 0.45 } },
  rock: { chorus: { parts: ['pno'], v: 0.64 }, bridge: { parts: ['vla', 'vc'], v: 0.5 } },
  folk: { pre: { parts: ['vc'], v: 0.45 }, chorus: { parts: ['vc', 'vla'], v: 0.5 }, bridge: { parts: ['vln1', 'vla', 'vc'], v: 0.45 } },
  country: { pre: { parts: ['pno'], v: 0.62 }, chorus: { parts: ['pno', 'vla'], v: 0.62 }, bridge: { parts: ['vln1', 'vla'], v: 0.45 } },
};
const LAYER_SETS = { vc: ['cello'], vla: ['cello', 'str'], vln1: ['str'], pno: ['pianoext', 'piano', 'pianoextsoft', 'pianosoft'] };
const layerSets = (style) => [...new Set(Object.values(BAND_LAYER[style] || {}).flatMap((x) => x.parts.flatMap((p) => LAYER_SETS[p])))];
export function liveSets(st) {
  const mode = Math.round(st?.master?.kit || 0), fullKit = mode === 1 || mode === 2;
  const out = fullKit ? ['kit'] : mode === KIT_BACKBEAT ? ['snare'] : [];
  const patterns = [st?.pattern, ...(st?.patterns || [])].filter(Boolean);
  if (RHODES_STYLES.has(st?.artist?.style) && (Math.round(st?.params?.stab?.voice) <= 1 || patterns.some((p) => p.hook?.v === 'tapekeys'))
      || patterns.some((p) => p.jazz?.style === 'jazzfunk')) out.push('rhodes');
  if (st?.patterns?.some((p) => p.jazz?.style === 'jazzfunk') || st?.pattern?.jazz?.style === 'jazzfunk') out.push('horn');
  if (fullKit && pocketOf(st.master)?.band) out.push('kitx');
  if (Math.round(st?.params?.acid?.voice || 0) === 5) out.push('ebass');
  out.push(...(HAND_SETS[Math.round(st?.params?.perc?.voice || 0)] || []));
  const name = STAB_BAND[Math.round(st?.params?.stab?.voice || 0)];
  if (name) out.push(name, ...(SOFT_LAYER[name] ? [SOFT_LAYER[name]] : []));
  for (const p of [st?.pattern, ...(st?.patterns || [])]) {
    const v = p?.hook?.v, voice = Object.hasOwn(HOOK_BAND, v) && HOOK_BAND[v];
    if (voice) out.push(voice, ...(TAKES[voice] ? [TAKES[voice]] : []));
  }
  // Country's lead is a Telecaster whatever plays the chords.
  if (pocketOf(st.master)?.walk && name !== 'gtr') out.push('gtr', 'gtrsoft');
  if (fullKit && pocketOf(st.master)?.band) out.push(...layerSets(st.artist?.style));
  return [...new Set(out)];
}
// A song's recordings plus their alternate takes and mutes: what an offline render waits for, so exports get every take.
export const withTakes = (names) => [...new Set(names.flatMap((n) => [n, TAKES[n], MUTE_LAYER[n], TAKES[MUTE_LAYER[n]]].filter(Boolean)))];
export const liveSet = (name) => (name === 'kit' ? buffers : name === 'kitx' ? extra : name === 'snare' ? snare || buffers : bandKit(name));
export const setsReady = (names) => names.every((n) => liveSet(n));
export const loadSets = (names) => Promise.all(names.map((n) => (n === 'kit' ? loadLiveKit() : n === 'kitx' ? loadKitExtra() : n === 'snare' ? loadSnare() : Object.hasOwn(HANDS, n) ? loadHand(n) : loadBand(n))));

export function loadHand(name) {
  if (band[name]) return Promise.resolve(band[name]);
  if (bandLoading[name]) return bandLoading[name];
  if (!Object.hasOwn(HANDS, name) || typeof fetch !== 'function' || typeof OfflineAudioContext === 'undefined') return Promise.resolve(null);
  const dec = new OfflineAudioContext(1, 1, 44100);
  bandLoading[name] = Promise.all(HANDS[name].map(async (file) => {
    const res = await fetch(sampleUrl(file));
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    return dec.decodeAudioData(await res.arrayBuffer());
  })).then((takes) => (band[name] = takes))
    .catch((err) => { console.warn(`${name} samples unavailable, using synth voice`, err); return null; });
  return bandLoading[name];
}

export function loadSnare() {
  if (snare || buffers) return Promise.resolve(snare || buffers);
  if (snareLoading) return snareLoading;
  if (typeof fetch !== 'function' || typeof OfflineAudioContext === 'undefined') return Promise.resolve(null);
  const dec = new OfflineAudioContext(1, 1, 44100);
  snareLoading = Promise.all(LIVE_KIT.snare.map(async (name) => {
    const res = await fetch(sampleUrl(name));
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return [name, await dec.decodeAudioData(await res.arrayBuffer())];
  })).then((entries) => (snare = Object.fromEntries(entries)))
    .catch((err) => { console.warn('snare samples unavailable, using synth voice', err); return null; });
  return snareLoading;
}

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
