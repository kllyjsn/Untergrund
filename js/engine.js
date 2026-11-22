import { TRACKS, TRACK_IDS, CHORDS, DELAY_TIMES, SCALES, HAND_KIT, KIT_BACKBEAT, defaultParams } from './params.js';
import { PALETTE_INSTRUMENTS, PALETTE_DEFAULTS, instrumentFor } from './palette-defaults.js';
import { getSample, hasUserSample, sungNote, SUNG_LEN, SUNG_LOW, SUNG_NOTES, SUNG_VOWEL_COUNT } from './sampler.js';
import { vowelStyle, vowelVoxNote, vowelName, vowelHookDuration, playVowel, VOWEL_HOOK_DB, VOWEL_HOOK_EQ } from './vowels.js';
import { getChops } from './voice.js';
import { pickChop } from './hum.js';
import { liveSet, loadLiveKit, loadKitExtra, loadSnare, BASS_NOTES, BOOMBAP_BASS_CENTERS, KIT_PITCH, bandKit, loadBand, loadHand, STAB_BAND, HOOK_BAND, SAX_HOOK, SAX_LO, saxRoot, SOFT_LAYER, TAKES, MUTE_LAYER, bandName, BAND_LAYER, RECORDED_ORGAN, ANALOG_BASS } from './livekit.js';
import { compose, PART_SECTION } from './classical.js';
import { pocketOf, pocketLate, pocketVel, swingLate, swingDuration } from './groove.js';
import { isJazz, jazzStyle, jazzHarmony, jazzBass, jazzVoicing, jazzNotes, jazzNotches, JAZZ_MIX, BOSSA_RIM, BOSSA_BATIDA, bossaBass } from './jazz.js';
import { funkBass, FUNK_KICK, FUNK_SNARE, FUNK_COMP } from './jazzfunk.js';
import { leadPreset, dbGain, STAB_TRIM_DB, HOOK_TRIM_DB, HOOK_LOW_DB, STAB_SHELF_HZ, TECHNO_HOOK_SPACE } from './lead.js';
import { lowEnd } from './lowend.js';
import { HIPHOP } from './hiphop.js';
import { midiHz, makeNoise, makeIR, driveCurve, clipCurve, satCurve, SAT_HEADROOM } from './dsp.js';
import { biquad, filter as filterVocal, processedStem } from './vocal-chain.js';
import { makeupGain } from './loudness.js';
import { harmRoot, chordIv, stabNotes, hookSnap, voiceLead } from './harmony.js';
import { develop, motifPlan, stepDeg } from './motif.js';
import { MELODY_BARS, strongNote } from './melody.js';
import { patternAt } from './scope.js';
import { cleanChainEntries } from './chain.js';
import { funkHand } from './baile.js';
import { festivalTrap, festivalBuilds, festivalBuildStep } from './festival-build.js';

const DUCKED = new Set(['acid', 'stab', 'vox']);
const dampedChord = (e) => (e.state.artist?.style === 'breaks' && Math.round(e.state.params.stab.voice) === 1)
  || (e.state.artist?.style === 'reggaeton' && Math.round(e.state.params.stab.voice) === 3);
const BASS_COLOR = {
  bailefunk: { name: 'funk808', knock: 1.35, settle: 0.022, wave: 'sine', ratio: 2, harmonic: 0.32, tail: 0.12, decay: 0.09, round: 'sine', pick: 0.15, gain: 1.05 },
  reggaeton: { name: 'dembow', knock: 1.12, settle: 0.045, wave: 'sine', ratio: 4, harmonic: 0.55, tail: 0.35, decay: 0.12, round: 'sine', pick: 0.6 },
  afrobeats: { name: 'finger', knock: 1, settle: 0.018, wave: 'triangle', ratio: 3, harmonic: 0.8, tail: 0.25, decay: 0.07, round: 'triangle', pick: 1, gain: 0.85 },
  jerseyclub: { name: 'bounce', knock: 2.6, settle: 0.012, wave: 'sawtooth', ratio: 2, harmonic: 0.35, tail: 0.015, decay: 0.025, round: 'triangle', pick: 0.5, gain: 1.6, duckScale: 0.65, recoveryScale: 0.6 },
  phonk: { name: 'phonk', knock: 1.28, settle: 0.026, wave: 'sawtooth', ratio: 2, harmonic: 0.36, tail: 0.22, decay: 0.13, gain: 0.94 },
};
const LIQUID_CHORD = { wave: 'sawtooth', level: 0.3, attack: 0.065, release: 0.8, cutoff: 2600, spread: 14, fm: 0, width: 0.7, sideCutoff: 150, harmonics: 4200, upper: 0.35, airBand: 4, eq: [[1130, 0.7, 3]] };
const EUPHORIC_CHORD = { wave: 'sawtooth', level: 0.54, attack: 0.025, release: 0.85, cutoff: 2300, spread: 11, fm: 0 };
const DEEP_CHORD = { wave: 'triangle', level: 1.35, attack: 0.007, release: 0.45, cutoff: 1700, spread: 2, fm: 0.65, width: 0.25, presence: 'keys', eq: [[320, 0.8, -5], [950, 0.8, 3]] };
const GENRE_PALETTES = {
  deephouse: {
    name: 'velvet',
    chords: {
      default: DEEP_CHORD,
      1: DEEP_CHORD,
      3: { ...DEEP_CHORD, wave: 'sine', organ: 0.35, level: 1.65, attack: 0.005, fm: 0, release: 0.42, cutoff: 1900, presence: 'organ' },
      2: { ...DEEP_CHORD, level: 1.5, attack: 0.025, release: 0.6, fm: 0.28, cutoff: 1450, presence: 'pad' },
    },
    hook: { ...DEEP_CHORD, wave: 'sawtooth', harmonics: 4500, level: 0.42, attack: 0.012, release: 0.18, cutoff: 4000, spread: 6, width: 0.55, fm: 0.35, presence: false, eq: [], airBand: 1, breath: 0.08, breathDecay: 0.05, transpose: 24, range: [79, 91] },
    bass: { type: 'round', wave: 'triangle', fm: 0.65, level: 1, sub: 0.72, body: 0.8, cutoff: 760, decay: 0.16, grit: 0.5, sustain: 0.55, length: 0.88, balance: true, lowBand: { cutoff: 120, trim: -6, duck: 6 } },
  },
  euphoric: {
    name: 'uplift',
    chords: {
      default: EUPHORIC_CHORD,
      7: { ...EUPHORIC_CHORD, piano: true, level: 1, cutoff: 5800 },
      10: { ...EUPHORIC_CHORD, level: 0.5, attack: 0.055, release: 1.2, cutoff: 1800, spread: 13 },
      2: { ...EUPHORIC_CHORD, level: 1, attack: 0.05, release: 1.1 },
      4: { ...EUPHORIC_CHORD, wave: 'triangle', level: 0.7, attack: 0.012, release: 0.6, fm: 0.4 },
    },
    hook: { wave: 'sawtooth', level: 0.65, attack: 0.014, release: 0.17, cutoff: 2600, spread: 16, width: 0.85, fm: 0 },
    bass: { type: 'pluck', level: 1.1, sub: 0.72, body: 0.8, cutoff: 850, decay: 0.07, sustain: 0.32, length: 0.85 },
  },
  dnb: {
    name: 'liquid',
    bed: true,
    chords: {
      default: LIQUID_CHORD,
      10: { ...LIQUID_CHORD, attack: 0.09, release: 1.1, cutoff: 2200 },
      2: { ...LIQUID_CHORD, level: 0.23, attack: 0.075, cutoff: 2800, spread: 18 },
      1: { ...LIQUID_CHORD, wave: 'triangle', level: 0.35, attack: 0.006, release: 0.5, cutoff: 3200, fm: 0.7 },
      5: { ...LIQUID_CHORD, wave: 'triangle', level: 0.42, attack: 0.012, release: 0.32, cutoff: 3000, fm: 0.45 },
    },
    hook: { wave: 'triangle', level: 0.44, attack: 0.018, release: 0.16, cutoff: 4500, spread: 8, fm: 0.5, width: 0.7, breath: 0.18, breathDecay: 0.06, transpose: 12, range: [72, 90], harmonics: 6500, airBand: 4, eq: [[1130, 0.7, 3]] },
    bass: { level: 1, sub: 0.9, body: 0.5, movement: 230, spread: 14, midCut: [325, 0.7, 3] },
  },
};
export const paletteFor = (state, style = state.artist?.style) => Object.hasOwn(GENRE_PALETTES, style) ? GENRE_PALETTES[style] : undefined;
export const paletteColor = (state, style) => {
  const bank = paletteFor(state, style);
  return bank && (bank.chords[Math.round(state.params.stab.voice)] || bank.chords.default);
};
const paletteRegister = (pitch, color) => {
  pitch += color.transpose || 0;
  if (color.range) {
    while (pitch < color.range[0]) pitch += 12;
    while (pitch > color.range[1]) pitch -= 12;
  }
  return pitch;
};
export const paletteHookPitch = (state, pitch, voice, style) => {
  const color = paletteFor(state, style)?.hook;
  return !color || voice === 'chop' && getChops() ? pitch : paletteRegister(pitch, color);
};
// Chords sit under a sung line the way a mix rides the keys under a vocal: a little in the chorus, more in the verse
// and most in the breakdown, so the drop still lands over it. Songs with sections already set the verse level.
const STAB_UNDER_VOICE = { n: 0.84, v: 0.78, b: 0.45 };
// Lead voices balanced for a sung line, so the voice sits at the same level over the band whichever one sings it
// (the reed is forward, the flute sits back). Songs with sections drop the verse by its section level, so
// the verse is sung a little forward to stay on top of the band.
const SUNG_VOICE = { reed: 0.6, oboe: 0.6, flute: 1.3 };
const SHAPED_TECHNO_HOOKS = new Set(['metalstrike', 'softresonator', 'robotformant']);
// The harp files are labeled an octave above the recorded strings. For the hook, map file IDs to measured pitch and trim the lead-in.
const HARP_PLUCK = {
  47: [34.82, 0.026], 53: [40.91, 0.030], 60: [47.98, 0], 64: [51.94, 0.044], 71: [58.86, 0.028],
  77: [64.99, 0.006], 81: [68.91, 0], 84: [71.89, 0.002], 91: [78.95, 0.016],
};
// Wind takes: cents from the file's pitch, lead-in seconds to skip, gain trim in dB.
const WIND_HOOK = {
  tpt: {
    gain: 0.4, presence: [2700, 0.8, -2],
    takes: Object.fromEntries([57, 60, 63, 67, 70, 74, 77, 81].map((m) => [m, [0, 0, 0]])),
  },
  oboe: {
    gain: 1.23, presence: [2700, 0.8, 5.5],
    takes: { 58: [15, 0.048, 0], 62: [-4, 0.01, 0], 65: [-3, 0.01, 0], 70: [-3, 0.02, -2.3], 74: [1, 0, 1], 77: [3, 0.03, 0], 82: [6, 0, -1.5] },
    second: { 58: [2, 0.012, -1], 62: [-2, 0.012, -3], 65: [-1, 0.008, -3.7], 70: [-2, 0.032, -2.1], 74: [-1, 0.012, 1.9], 77: [0, 0.008, -3.8], 82: [2, 0, 1] },
  },
  // The MTG tenor was recorded 10-20 cents sharp.
  altosax: {
    gain: 2.8, presence: [2500, 0.8, 1.5],
    takes: { 52: [-2, 0, 0], 55: [1, 0, 0], 58: [1, 0, 0], 61: [0, 0, 0], 64: [0, 0, 0], 67: [-1, 0.03, 0], 70: [0, 0, 0], 73: [0, 0, 0], 76: [0, 0, 0], 79: [1, 0, 0] },
    second: { 52: [2, 0, 0], 55: [1, 0, 0], 58: [1, 0, 0], 61: [0, 0.02, 0], 64: [0, 0, 0], 67: [-1, 0.03, 0], 70: [0, 0, 0], 73: [1, 0, 0], 76: [0, 0, 0], 79: [1, 0, 0] },
  },
  tenorsax: {
    // The tenor's 1.5-3 kHz formant took over the mix's upper mids; darken it and keep its 700 Hz body.
    gain: 2.8, presence: [2400, 0.6, -10], lp: 1500, tone: [[250, 1, -2], [780, 1.2, 2.5], [1900, 0.9, -6]],
    takes: { 47: [11, 0.04, 0], 50: [8, 0, 0], 53: [18, 0, 0], 56: [14, 0, 0], 59: [19, 0.02, 0], 62: [20, 0, 0], 65: [21, 0.03, 0], 68: [12, 0, 0], 71: [19, 0.01, 0], 74: [36, 0, 0] },
    second: { 47: [11, 0, 0], 50: [4, 0, 0], 53: [14, 0, 0], 56: [11, 0, 0], 59: [16, 0.01, 0], 62: [18, 0.08, 0], 65: [20, 0, 0], 68: [17, 0.28, 0], 71: [19, 0.1, 0], 74: [21, 0, 0] },
  },
  airflute: {
    gain: 1.02, presence: [2950, 0.8, 6.2],
    takes: { 60: [1, 0.18, 3], 64: [-4, 0.11, 0], 69: [-18, 0.05, 0], 72: [-5, 0.01, 0], 76: [-5, 0.022, 0], 81: [-3, 0.022, -1.5], 84: [0, 0.043, 0] },
    second: { 60: [-36, 0.145, 3.8], 64: [-12, 0.105, 3], 69: [-2, 0.061, 0.8], 72: [2, 0.092, 3], 76: [0, 0.088, -0.5], 81: [0, 0.098, 0], 84: [0, 0.105, -3.2] },
  },
};
// Each genre's sax, in dB, matched to the synth reed it replaces (hook stem loudness over seeds): the recorded
// tongued attack carries less energy on the short riffs of Afrobeats, Reggaeton and Breaks than on sung lines.
const SAX_TRIM = { pop: -2.4, neosoul: -5.7, boombap: 3.5, trap: 1.1, afrobeats: 6.5, reggaeton: 4.5, breaks: 7.1 };
// Knob values the NEO-SOUL live-kit preset uses; the recorded samples play unaltered at these settings
const LIVE_REF = {
  kick: { tune: 52, decay: 0.5, drive: 0.2, click: 0.15, punch: 0.55 },
  snare: { tune: 200, decay: 0.22, snappy: 0.4 },
  ch: { tune: 1, decay: 0.05, tone: 3600 },
  oh: { tune: 1, decay: 0.32, tone: 6500 },
  ride: { tune: 1, decay: 1.4, tone: 3800 },
  acid: { cutoff: 320, drive: 0.3 },
};
const BOOMBAP_KICK_RATE = 2 ** (-19.6 / 1200);
const BACKBEAT_TOUCH = [0.42, 0.03, -0.42, -0.03];
const BACKBEAT_TAKE_TRIM = { 23: -1.15, 24: 0.2, 33: 0.25, 34: 0.3 };
const BACKBEAT_ATTACK_TRIM = [0, -0.25, 0.45, -0.05];
const hash = (n, k) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const EPS = 0.0001;
const SAMPLE_FADE = 1;
// The master compressors and oversamplers can still hold an attack whose source has started.
const WAKE_FLUSH = 0.024;
const WAKE_FADE = 0.002;
const ANALOG_BASS_GAIN = 4.4;
// Chord voices that sustain fill a breakdown on their own, so a smooth style only lifts the ones that decay.
const HELD_CHORDS = new Set(['pad', 'organ', 'strings', 'cello']);
export const STAB_VOICES = [null, 'keys', 'pad', 'organ', 'brass', 'pluck', 'bells', 'piano', 'guitar', 'horns', 'strings', 'driveGuitar', 'acoustic', 'jazzGuitar', 'banjo', 'twangGuitar', 'cello', 'clarinet', 'nylon', 'marimba'];
const GRIPPED = new Set(['guitar', 'driveGuitar', 'acoustic', 'jazzGuitar', 'banjo', 'twangGuitar', 'nylon']);
// Soft-knee, slightly asymmetric clipping: even harmonics like a pushed preamp tube.
const AMP_CURVE = (() => { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 2.2 + 0.18) - Math.tanh(0.18); } return c; })();
// How each recorded instrument is played: level, DECAY->length, strum spread, register shift, held like a bow.
// CLASSICAL orchestra: each part is a recorded player at its seat (pan), in its register, with its section on the mixer.
const ORCH = {
  vln1: { kinds: ['str'], gain: 0.95, lo: 55, hi: 93, pan: -0.42, lp: 7000, rel: 0.22, loop: true, hp: 180 },
  vln2: { kinds: ['str'], gain: 0.62, lo: 55, hi: 88, pan: -0.2, lp: 6000, rel: 0.2, loop: true, det: 9, off: 0.05, hp: 160 },
  vla: { kinds: ['cello', 'str'], gain: 0.62, lo: 48, hi: 79, pan: 0.12, lp: 5000, rel: 0.2, loop: true, det: -6, off: 0.03, hp: 120 },
  vc: { kinds: ['cello'], gain: 0.8, lo: 36, hi: 72, pan: 0.32, lp: 4500, rel: 0.22, loop: true },
  cb: { kinds: ['cb'], gain: 0.75, lo: 28, hi: 52, pan: 0.5, lp: 2500, rel: 0.25, loop: true },
  fl: { kinds: ['fl'], gain: 0.5, lo: 60, hi: 96, pan: -0.12, lp: 9000, rel: 0.12, loop: true, hp: 250 },
  ob: { kinds: ['ob'], gain: 0.5, lo: 58, hi: 88, pan: 0.08, lp: 8000, rel: 0.1, loop: true, hp: 220 },
  cl: { kinds: ['cl'], gain: 0.5, lo: 50, hi: 84, pan: -0.25, lp: 7000, rel: 0.1, loop: true, hp: 140 },
  hn: { kinds: ['fh'], gain: 0.42, lo: 41, hi: 72, pan: 0.28, lp: 3800, rel: 0.15, loop: true, hp: 60 },
  tpt: { kinds: ['tpt'], gain: 0.3, lo: 55, hi: 84, pan: 0.05, lp: 6000, rel: 0.08, loop: true, hp: 160 },
  harp: { kinds: ['harp'], gain: 0.55, lo: 40, hi: 96, pan: -0.5, lp: 8000, rel: 0.6 },
  timp: { kinds: ['timp'], gain: 0.85, lo: 40, hi: 57, pan: 0.15, lp: 3000, rel: 0.5 },
  pno: { kinds: ['pianoext', 'piano'], soft: ['pianoextsoft', 'pianosoft'], gain: 1.8, lo: 21, hi: 104, pan: 0, lp: 12000, rel: 0.3 },
  // The band's tonewheel organ (ROCK choruses): drawbars held under the guitars, the sustain looped.
  org: { kinds: ['org'], gain: 0.62, lo: 43, hi: 84, pan: 0.22, lp: 5200, rel: 0.09, loop: true, hp: 110 },
};
const kindsOf = (parts) => [...new Set(parts.flatMap((p) => [...ORCH[p].kinds, ...(ORCH[p].soft || []), ...(p === 'timp' ? ['timproll'] : [])]))];
export const ORCH_KINDS = kindsOf(Object.keys(ORCH));
// The recordings one score needs, so a solo-piano nocturne never downloads the orchestra.
export function scoreKinds(spec) { return kindsOf([...new Set(compose(spec).notes.map((n) => n[4]))]); }

// Sustain loop for a held orchestral note: the steady middle of the recording, cut at rising zero crossings
// so the seam does not click.
const LOOPS = new WeakMap();
function loopPoints(buf) {
  if (LOOPS.has(buf)) return LOOPS.get(buf);
  const d = buf.getChannelData(0), sr = buf.sampleRate, rise = (i) => { for (let k = i; k < d.length - 1; k++) if (d[k] <= 0 && d[k + 1] > 0) return k; return i; };
  const a = rise(Math.floor(d.length * 0.4)), b = rise(Math.floor(d.length * 0.85) - Math.floor(sr * 0.05));
  const out = b - a > sr * 0.2 ? [a / sr, b / sr] : [buf.duration * 0.4, buf.duration * 0.85];
  LOOPS.set(buf, out);
  return out;
}

// How the rhythm player treats a chord hit in each pocket: play is strum | chop | pick | roll, double
// pans a second take across the stereo field, fx is a pedal or amp effect.
export function guitarHand(kind, pocket, chorus) {
  const funk = pocket === 'R&B' || pocket === 'SOUL' || pocket === 'AFRO';
  const play = kind === 'banjo' && (pocket === 'FOLK' || pocket === 'COUNTRY') ? 'roll'
    : pocket === 'FOLK' && !chorus && (kind === 'agtr' || kind === 'gtr') ? 'pick'
      : funk && (kind === 'gtr' || kind === 'jazz') ? 'chop' : 'strum';
  const double = (kind === 'drive' && pocket === 'ROCK') || ((pocket === 'POP' || pocket === 'FOLK') && chorus && (kind === 'gtr' || kind === 'agtr'));
  const fx = funk && kind === 'gtr' ? 'chorus' : kind === 'gretsch' && pocket === 'COUNTRY' ? 'trem' : null;
  return { play, double, fx };
}

// Two strings a step apart, or a minor ninth, grate against each other while both ring.
const rubs = (a, b) => { const d = Math.abs(a - b); return d > 0 && (d <= 2 || d === 13); };

// Stop a ringing string; one not yet sounding is never started.
function damp(h, at) {
  if (h.at > at) { try { h.s.stop(at); } catch { /* already stopped */ } return; }
  h.g.gain.cancelScheduledValues(at); h.g.gain.setTargetAtTime(0, at, 0.025);
}

// How a guitarist grips a chord: the root on a low string with a fifth or more of air above it, the other
// tones (the fifth left out of five-note chords) within a hand's reach, never a half step or flat nine apart
// anywhere in the shape, and as close as possible to the last grip so the voices glide instead of jumping.
export function guitarGrip(root, iv, prev = null) {
  let bass = root;
  while (bass > 51) bass -= 12;
  while (bass < 40) bass += 12;
  let pcs = [...new Set(iv.slice(1).map((n) => ((n % 12) + 12) % 12))].filter((pc) => pc !== 0 && !(iv.length > 4 && pc === 7));
  let best = null, bestCost = Infinity;
  const pick = (k, chosen) => {
    if (k === pcs.length) {
      const g = [bass, ...chosen].sort((x, y) => x - y);
      if (g[1] - g[0] < 7 || g[g.length - 1] - bass > 26 || g[g.length - 1] > 76) return;
      for (let i = 2; i < g.length; i++) if (g[i] - g[i - 1] < 3) return;
      for (let i = 1; i < g.length; i++) for (let j = 0; j < i; j++) if ([1, 13].includes(g[i] - g[j])) return;
      const top = g[g.length - 1];
      let cost = (top - bass) * 0.15 + Math.max(0, 62 - top) + Math.max(0, top - 71);
      if (prev) cost += 2 * Math.abs(top - prev[prev.length - 1]) + g.slice(1).reduce((c, m) => c + Math.min(...prev.slice(1).map((q) => Math.abs(q - m))), 0) * 0.5;
      if (cost < bestCost) { bestCost = cost; best = g; }
      return;
    }
    for (let m = bass + pcs[k]; m <= bass + 26; m += 12) if (m >= bass + 5) pick(k + 1, [...chosen, m]);
  };
  pick(0, []);
  if (!best && CHORDS.slice(13).some((c) => c.iv.length === iv.length && c.iv.every((n, i) => n === iv[i]))) {
    // A guitar leaves out extensions that cannot fit the hand, retaining third and seventh.
    const all = pcs, third = all.includes(4) ? 4 : 3;
    const core = all.filter((pc) => [third, 10, 11].includes(pc));
    for (let count = all.length - 1; count >= core.length && !best; count--) {
      for (let mask = 1; mask < 2 ** all.length; mask++) {
        pcs = all.filter((_, i) => mask & (1 << i));
        if (pcs.length === count && core.every((pc) => pcs.includes(pc))) pick(0, []);
      }
    }
    pcs = all;
  }
  // No shape satisfies every rule (a cluster chord): stack the tones a third or more apart instead.
  if (!best) { best = [bass]; let floor = bass + 7; for (const pc of [...pcs].sort((x, y) => x - y)) { let m = bass + pc; while (m < floor) m += 12; best.push(m); floor = m + 3; } best.sort((x, y) => x - y); }
  return best;
}

// Generated impulse responses: [seconds, makeIR options]. The live variants replace the band and room spaces in a band mix.
const IR = {
  room: [0.7, { decay: 2.4, brightStart: 0.6, brightEnd: 0.15, predelay: 0.004, seed: 53 }],
  band: [1.2, { decay: 2.8, brightStart: 0.7, brightEnd: 0.2, predelay: 0.009, seed: 71 }],
  liveRoom: [0.6, { decay: 2.6, brightStart: 0.7, brightEnd: 0.2, predelay: 0.003, seed: 53, er: { n: 10, span: 0.025, gain: 0.6 } }],
  liveBand: [1.1, { decay: 3.2, brightStart: 0.75, brightEnd: 0.18, predelay: 0.006, seed: 71, er: { n: 14, span: 0.045, gain: 0.5 } }],
};

// Band channel strips, [lowshelf, bell, bell, highshelf] as [Hz, dB, Q]. No per-channel compressors: on the
// sampled kit and bass they flattened the played dynamics and pushed the bass under the kick; the bus glue levels the band.
const BAND_STRIP = {
  kick: { eq: [[60, 1.5], [380, -4, 1.1], [3800, 2.5, 1], null] },
  snare: { eq: [[110, -3], [220, 1.5, 1.4], [5000, 2.5, 0.9], [11000, 2]] },
  clap: { eq: [[160, -4], null, [4500, 0.5, 1], null] },
  ch: { eq: [[420, -6], null, [3500, -2, 1.2], [10000, 1]] },
  oh: { eq: [[420, -6], null, [3500, -2, 1.2], [10000, 1]] },
  ride: { eq: [[420, -5], null, [3000, -1.5, 1.2], [10000, 1]] },
  perc: { eq: [[300, -4], null, null, [10000, 1.5]] },
  acid: { eq: [[45, 1], [260, -3, 0.9], [850, 2, 1.2], [5000, -2]] },
  stab: { eq: [[140, -2], [320, -3, 0.8], [2600, 1.5, 0.9], [9000, 2]] },
};
// Neo-soul's Rhodes and its hook lines voice low, around 250 Hz, so they get a deeper, lower low-mid cut there.
const SOUL_STRIP = { ...BAND_STRIP, stab: { eq: [[140, -2], [250, -7, 0.9], [2600, 1.5, 0.9], [9000, 2]] } };

// Mastering per genre: [low shelf 90 Hz, low-mid bell 300 Hz, presence shelf 2.4 kHz, air shelf 10 kHz] in dB, and the
// side gain above 300 Hz. Set from the measured octave balance against js/audio-quality.js TARGET_CURVES: the band
// genres came out 6-13 dB heavy at 250 Hz and 7-12 dB short of 2-8 kHz, with an L/R correlation of 0.76-0.89.
export const MASTER_TONE = {
  hardtechno: [0, -1, 3.75, -0.5, 0.12],
  dub: [0, -2, 0, 0, 0],
  pop: [-1.5, -9, 4.5, 1.5, 0.6], rnb: [0, -7, 6.5, 2.5, 0.6], rock: [-4, -5, 4.5, 3, 0.6],
  folk: [3, -3, 0.5, 4, 0.5], country: [2, -3, 2.5, 4, 0.6],
};

const BAND_PLAY = {
  marimba: { gain: 1.35, len: 0.9, min: 0.15, max: 0.44, strum: 0.0015, shift: 0, lo: 48, hi: 84, lp: 7000, fade: 0.002, rel: 0.07, even: 0.35 },
  piano: { gain: 4, len: 4, min: 1.2, max: 3, pedal: 5, softBelow: 0.88, strum: 0.004, shift: 0, lo: 45, hi: 79, lp: 7000, rel: 0.18 },
  gtr: { gain: 4.4, len: 2.6, min: 0.6, softBelow: 0.75, strum: 0.006, shift: 0, lo: 40, hi: 74, lp: 2900, peak: [3600, 1.2, -6], soft: 1100, fade: 0.008, rel: 0.22, grip: true, even: 0.2 },
  horn: { gain: 2.2, len: 1.2, min: 0.25, strum: 0.003, shift: 12, lo: 53, hi: 81, lp: 4800, rel: 0.09 },
  str: { gain: 1.2, len: 2, min: 0.5, strum: 0, shift: 0, hold: true, lo: 55, hi: 79, lp: 4200, rel: 0.25 },
  cello: { gain: 1.05, len: 0.7, max: 0.94, strum: 0, shift: 0, hold: true, lo: 51, hi: 75, lp: 4100, body: [420, 0.8, -3], peak: [2750, 0.9, 2.8], fade: 0.02, rel: 0.17 },
  cl: { gain: 1.08, len: 0.75, min: 0.26, max: 0.53, strum: 0, shift: 0, lo: 55, hi: 78, lp: 4450, body: [480, 0.55, -7.5], peak: [2600, 0.8, 2.8], fade: 0.02, rel: 0.09 },
  // The hollow-body played through a cranked amp: power chords sustain, the cab rolls off the fizz.
  drive: { set: 'gtr', amp: true, gain: 3.2, len: 3.4, min: 0.18, strum: 0.004, shift: 0, lo: 40, hi: 64, lp: 5200, soft: 1800, fade: 0.008, rel: 0.12, grip: true, even: 0.15 },
  // Steel-string acoustic: a wider strum, bright top, long ring; the boxy low mids of the close mic dipped.
  agtr: { gain: 4.2, len: 3.2, min: 0.7, strum: 0.011, shift: 0, lo: 40, hi: 76, lp: 7800, body: [280, 1.1, -4], soft: 0, finger: [1700, 0.6, 3.2], fade: 0.01, rel: 0.3, grip: true, even: 0.35 },
  nylon: { gain: 2.2, len: 2.4, min: 0.25, strum: 0.002, shift: 0, lo: 40, hi: 76, lp: 10000, soft: 0, fade: 0.004, rel: 0.12, grip: true, even: 0.3 },
  // The archtop's magnetic pickup, neck position, tone rolled back: round, woody comping for soul and jazz chords.
  jazz: { gain: 9.5, len: 2.4, min: 0.5, softBelow: 0, strum: 0.005, shift: 0, lo: 43, hi: 72, lp: 3400, soft: 900, fade: 0.008, rel: 0.2, grip: true, even: 0.25 },
  // Six-string guitar banjo: a fast snappy strum that dies quickly, all top end.
  banjo: { gain: 5, len: 1.2, min: 0.3, strum: 0.007, shift: 0, lo: 45, hi: 79, lp: 9000, soft: 0, fade: 0.006, rel: 0.12, grip: true, even: 0.4 },
  // The green Gretsch hollow-body: bright, snappy, open chords that ring for country and rockabilly.
  gretsch: { gain: 4.2, len: 2.6, min: 0.6, softBelow: 0, strum: 0.006, shift: 0, lo: 40, hi: 74, lp: 4600, peak: [3400, 1.2, -4], soft: 1100, fade: 0.008, rel: 0.18, grip: true, even: 0.3 },
  // UK Garage's organ stab: the tonewheel organ keyed hard and let go, every note of the chord at once.
  org: { gain: 1.9, len: 1.6, min: 0.12, max: 0.8, strum: 0, shift: 0, lo: 52, hi: 79, lp: 5600, fade: 0.003, rel: 0.05, even: 0.15 },
};
// Country lead: the same guitar clean and bright off the bridge pickup, single notes with a slapback.
BAND_PLAY.twang = { ...BAND_PLAY.gtr, gain: 3, len: 1.4, min: 0.25, softBelow: 0, lo: 52, hi: 84, lp: 6800, grip: false, even: 0.4, rel: 0.12, oct: 0, slap: true };
// The rock band's riff guitar: the rhythm amp, double-stops up the neck.
BAND_PLAY.lead = { ...BAND_PLAY.drive, lo: 45, hi: 79, grip: false, even: 0.4, gain: 2.2, lp: 4400, soft: 1600, vib: 8, rel: 0.16, oct: -1, dyad: true };
// The pitch a non-gripped recorded chord voice sounds: shifted and kept in the register its samples were played in.
const REC_KIND = { piano: 'piano', horns: 'horn', strings: 'str', cello: 'cello', clarinet: 'cl', marimba: 'marimba' };
export function soundingPitch(voice, m) {
  const R = BAND_PLAY[REC_KIND[voice]];
  if (!R) return m;
  m += R.shift;
  while (m > R.hi + 0.5) m -= 12;
  while (m < R.lo - 0.5) m += 12;
  return m;
}
// The notes a chord stab plays, relative to root: voice-led, the top doubled an octave up in a chorus.
// A smooth style raises a lifted breakdown an octave and folds notes above A5 down, where their harmonics ring as a whistle.
export function stabPitches(e) {
  const p = e.state.params.stab, vo = Math.round(p.voice);
  const jazz = jazzStyle(e.state, e.playingPattern);
  if (jazz) {
    const h = e.harm || { r: 0, c: Math.round(p.chord) }, pedal = jazz === 'modal' && e.step % 16 === 0;
    let notes = pedal ? [48 + ((e.state.key + h.r) % 12 + 12) % 12] : jazzVoicing(h, e.state.key, jazz);
    if (jazz === 'bossa' && e.step % 8 === 0) {
      const thumb = 48 + ((e.state.key + h.r + (e.step % 16 === 8 ? 7 : 0)) % 12 + 12) % 12;
      notes = BOSSA_BATIDA[Math.floor(e.step / 16) % 2].includes(e.step % 16) ? [...new Set([thumb, ...notes])].sort((a, b) => a - b) : [thumb];
    }
    return { root: notes[0], vo, iv: notes.map((n) => n - notes[0]), pedal };
  }
  const { root, notes, home } = stabNotes(e.state, e.harm);
  const voiced = e.lastChord = voiceLead(notes, e.lastChord, home);
  const vi = (GRIPPED.has(STAB_VOICES[vo]) ? notes : voiced).map((m) => m - root);
  const iv = e.wide && !GRIPPED.has(STAB_VOICES[vo]) && vi.length > 2 ? [...vi, Math.max(...vi) + 12] : vi;
  if (vo <= 0) return { root, vo, iv };
  const top = e.smoothOn ? 81 - root : Infinity;
  return { root, vo, iv: [...new Set((e.smoothOn > 0 ? iv.map((m) => m + 12) : iv).map((m) => (m > top ? m - 12 * Math.ceil((m - top) / 12) : m)))] };
}

// The singing envelope of a vocal stem, ENV_RATE frames a second: 1 while it sings (from 40 ms before a phrase to 200 ms
// after it), 0 in its rests, smoothed (40 ms attack, 250 ms release). Engine.duckUnder() dips the band by it.
export const ENV_RATE = 50;
const envelopes = new WeakMap(), phraseGaps = new WeakMap();
export function vocalReanchorStep(step) {
  const last = Math.floor((step + 32) / 16) * 16;
  const phrase = Math.ceil((step + 1) / 64) * 64;
  return phrase <= step + 32 ? phrase : last;
}

export function vocalCrossfade(incoming) {
  return Float32Array.from({length:65}, (_, i) => incoming ? Math.sin(i / 64 * Math.PI / 2) : Math.cos(i / 64 * Math.PI / 2));
}

export const RUBATO_SPLICE_MAX_ADVANCE = 0.35;
const RUBATO_PITCH_MATCH_ADVANCE = 0.09;
const VOCAL_FADE_SECONDS = 0.03;
const VOCAL_FADE_PITCH_PROBES = [5, 15, 25];
const VOCAL_FADE_MIN_POWER_RATIO = 10 ** (-1.5 / 10);
const VOCAL_FADE_BAND_RATE = 48000, VOCAL_FADE_MIN_BAND_SHARE = .01;
const vocalFadeFilter = (type, hz) => [0.5411961, 1.3065630].map(q => biquad(type, hz, q, 0, VOCAL_FADE_BAND_RATE));
const vocalFadeBands = {
  low: vocalFadeFilter('lowpass', 500),
  mid: [...vocalFadeFilter('highpass', 500), ...vocalFadeFilter('lowpass', 2000)],
  presence: [...vocalFadeFilter('highpass', 2000), ...vocalFadeFilter('lowpass', 8000)],
};
const VOCAL_FADE_PHASE_TOLERANCE_RATIO = 10 ** (-0.25 / 10);
const VOCAL_FADE_MIN_PITCH_IMPROVEMENT = 10;
const RUBATO_EARLY_DRIFT_MS = 90;
const RUBATO_EARLY_MAX_PITCH_CENTS = 50;
const RUBATO_EARLY_MAX_CENTS_PER_10_MS = 40;

function vocalPitchAt(buffer, phase, samples) {
  const sr = buffer.sampleRate, stride = Math.max(1, Math.round(sr / 12000)), rate = sr / stride;
  const n = Math.round(rate * (samples / 48000)), center = Math.round(phase * sr), first = center - Math.floor(n / 2) * stride;
  const audio = buffer.getChannelData(0);
  if (first < 0 || first + n * stride > audio.length) return NaN;
  const frame = Float32Array.from({length:n}, (_, i) => audio[first + i * stride]);
  if (frame.reduce((e, x) => e + x * x, 0) / n < 0.0001) return NaN;
  const last = Math.floor(rate / 80), firstLag = Math.ceil(rate / 1170);
  let total = 0, a = Infinity, b = Infinity;
  for (let lag = 1; lag <= last; lag++) {
    let diff = 0;
    for (let i = 0; i < n - lag; i++) diff += (frame[i] - frame[i + lag]) ** 2;
    diff /= n - lag;
    total += diff;
    const c = diff * lag / Math.max(total, 1e-12);
    if (lag > firstLag && total >= 1e-12 && b < 0.15 && b <= a && b < c)
      return rate / (lag - 1 + 0.5 * (a - c) / (a - 2 * b + c));
    a = b;
    b = c;
  }
  return NaN;
}

function vocalFadeSample(audio, x) {
  const i = Math.floor(x), first = audio[i] ?? 0;
  return first + (x - i) * ((audio[i + 1] ?? 0) - first);
}

export function vocalFadePowerRatio(outgoing, buffer, from, to, rate) {
  const a = outgoing.getChannelData(0), b = buffer.getChannelData(0);
  // Slide a 5 ms window by one sample at 12 kHz so dips between fixed windows are not missed.
  const window = 60, frames = 6 * window;
  const blendedSuffix = new Float64Array(window), separateSuffix = new Float64Array(window);
  let ratio = 1, blendedPrefix = 0, separatePrefix = 0;
  for (let i = 0; i < frames; i++) {
    const f = (i + .5) / frames, t = f * VOCAL_FADE_SECONDS;
    const x = vocalFadeSample(a, (from + t * rate) * outgoing.sampleRate) * Math.cos(f * Math.PI / 2);
    const y = vocalFadeSample(b, (to + t) * buffer.sampleRate) * Math.sin(f * Math.PI / 2);
    const slot = i % window;
    const blended = (x + y) ** 2, separate = x * x + y * y;
    blendedPrefix += blended;
    separatePrefix += separate;
    const next = slot + 1;
    if (i >= window - 1) {
      const windowPower = separatePrefix + (separateSuffix[next] ?? 0);
      if (windowPower > 0) ratio = Math.min(ratio, (blendedPrefix + (blendedSuffix[next] ?? 0)) / windowPower);
    }
    blendedSuffix[slot] = blended;
    separateSuffix[slot] = separate;
    if (next === window) {
      // Sum the two sides of each overlapping window without subtracting away quiet samples.
      for (let j = window - 2; j >= 0; j--) {
        blendedSuffix[j] += blendedSuffix[j + 1];
        separateSuffix[j] += separateSuffix[j + 1];
      }
      blendedPrefix = separatePrefix = 0;
    }
  }
  return ratio;
}

export function vocalFadeBandPowerRatios(outgoing, buffer, from, to, rate) {
  const sr = VOCAL_FADE_BAND_RATE, window = sr * .005, frames = 6 * window, warmup = 3 * window;
  const a = outgoing.getChannelData(0), b = buffer.getChannelData(0);
  const x = new Float32Array(warmup + frames), y = new Float32Array(x.length);
  const full = new Float64Array(frames + 1);
  // Warm up with the actual outgoing signal, then filter each gain-weighted side independently.
  for (let i = -warmup; i < frames; i++) {
    const t = (i + .5) / sr, fade = Math.max(t, 0) / VOCAL_FADE_SECONDS * Math.PI / 2;
    const left = x[i + warmup] = vocalFadeSample(a, (from + t * rate) * outgoing.sampleRate) * Math.cos(fade);
    if (i < 0) continue;
    const right = y[i + warmup] = vocalFadeSample(b, (to + t) * buffer.sampleRate) * Math.sin(fade);
    full[i + 1] = full[i] + left ** 2 + right ** 2;
  }
  const blended = new Float64Array(frames + 1), separate = new Float64Array(frames + 1);
  const left = new Float32Array(x.length), right = new Float32Array(y.length);
  return Object.fromEntries(Object.entries(vocalFadeBands).map(([band, sections]) => {
    left.set(x); right.set(y);
    for (const section of sections) {
      filterVocal(left, section, left);
      filterVocal(right, section, right);
    }
    let ratio = 1;
    for (let i = 1; i <= frames; i++) {
      const l = left[warmup + i - 1], r = right[warmup + i - 1];
      blended[i] = blended[i - 1] + (l + r) ** 2;
      separate[i] = separate[i - 1] + l * l + r * r;
      if (i < window) continue;
      const start = i - window, power = separate[i] - separate[start];
      const total = full[i] - full[start];
      // Ignore nearly silent windows and bands with negligible local energy.
      if (total > full[frames] * 1e-6 && power >= total * VOCAL_FADE_MIN_BAND_SHARE)
        ratio = Math.min(ratio, (blended[i] - blended[start]) / power);
    }
    return [band, ratio];
  }));
}

const vocalPhaseAfterSlew = (voice, when) =>
  when - voice.origin + ((voice.slewRate ?? 1) - 1) * (when - (voice.slewEnd ?? when));

function rubatoSpliceTime(buffer, voice, origin, downbeat, ready, previousGrid, retiringUntil, requirePitchMatch = false) {
  const rate = voice.slewRate ?? 1, outgoing = voice.src.buffer;
  const first = Math.max(ready, retiringUntil, downbeat - RUBATO_SPLICE_MAX_ADVANCE, origin, voice.startAt);
  if (first > downbeat || (first === downbeat && !requirePitchMatch)) return requirePitchMatch ? null : downbeat;
  const outgoingPhase = when => vocalPhaseAfterSlew(voice, when);
  const short = new Map(), long = new Map();
  const pitches = (ms, wide) => {
    const frames = wide ? long : short;
    if (!frames.has(ms)) {
      const when = downbeat + ms / 1000;
      const samples = wide ? 4096 : 2048;
      const from = vocalPitchAt(outgoing, outgoingPhase(when), samples) * rate;
      const to = vocalPitchAt(buffer, when - origin, samples);
      frames.set(ms, [from, to]);
    }
    return frames.get(ms);
  };
  const cents = (a, b) => Math.abs(1200 * Math.log2(a / b));
  const separation = (ms, wide) => {
    const [from, to] = pitches(ms, wide);
    return cents(to, from);
  };
  // Keep the existing placement unless the wider search finds a clear improvement.
  let baseline = 0;
  const legacyFirst = Math.max(ready, previousGrid, downbeat - RUBATO_PITCH_MATCH_ADVANCE);
  if (!requirePitchMatch && retiringUntil <= legacyFirst && separation(15, false) > 100) {
    for (let ms = 5; downbeat - ms / 1000 >= Math.max(first, legacyFirst) - 1e-9; ms += 5) {
      if (VOCAL_FADE_PITCH_PROBES.every(center => separation(center - ms, false) <= 70)) {
        baseline = ms;
        break;
      }
    }
  }
  const worst = (ms, wide) => Math.max(...VOCAL_FADE_PITCH_PROBES.map(center => separation(center - ms, wide)));
  const baselinePitch = requirePitchMatch ? Infinity : Math.max(worst(baseline, false), worst(baseline, true));
  if (!requirePitchMatch && (!Number.isFinite(baselinePitch) || baselinePitch <= VOCAL_FADE_MIN_PITCH_IMPROVEMENT))
    return downbeat - baseline / 1000;
  const powerAt = ms => {
    const when = downbeat - ms / 1000;
    return vocalFadePowerRatio(outgoing, buffer, outgoingPhase(when), when - origin, rate);
  };
  const bandSafe = ms => {
    const when = downbeat - ms / 1000;
    return Object.values(vocalFadeBandPowerRatios(outgoing, buffer, outgoingPhase(when), when - origin, rate))
      .every(ratio => ratio >= VOCAL_FADE_MIN_POWER_RATIO);
  };
  const minPower = requirePitchMatch ? VOCAL_FADE_MIN_POWER_RATIO :
    Math.max(VOCAL_FADE_MIN_POWER_RATIO, powerAt(baseline) * VOCAL_FADE_PHASE_TOLERANCE_RATIO);
  const stable = ms => {
    let before = pitches(-25 - ms, false);
    if (!before.every(Number.isFinite)) return false;
    for (let offset = -15; offset <= 55; offset += 10) {
      const after = pitches(offset - ms, false);
      if (after.some((hz, i) => !Number.isFinite(hz) ||
          cents(hz, before[i]) > RUBATO_EARLY_MAX_CENTS_PER_10_MS)) return false;
      before = after;
    }
    return true;
  };
  let best = requirePitchMatch ? null : baseline;
  let bestPitch = requirePitchMatch ? RUBATO_EARLY_MAX_PITCH_CENTS : baselinePitch - VOCAL_FADE_MIN_PITCH_IMPROVEMENT;
  for (let ms = 0; downbeat - ms / 1000 >= first - 1e-9; ms += 5) {
    const shortPitch = worst(ms, false);
    if (!(shortPitch < bestPitch)) continue;
    const pitch = Math.max(shortPitch, worst(ms, true));
    if (pitch < bestPitch && powerAt(ms) >= minPower && (!requirePitchMatch || stable(ms)) && bandSafe(ms)) {
      best = ms;
      bestPitch = pitch;
    }
  }
  return best === null ? null : downbeat - best / 1000;
}

function hasUpcomingVocalGap(buffer, phase, span, rate = 1) {
  singingEnvelope(buffer);
  const end = phase + span * rate;
  return phraseGaps.get(buffer).some(g => g.from < end && g.to - Math.max(g.from, phase) >= 0.08 * rate);
}

export function singingEnvelope(buf) {
  let env = envelopes.get(buf);
  if (env) return env;
  const d = buf.getChannelData(0), w = Math.round(buf.sampleRate / ENV_RATE), n = Math.ceil(d.length / w), rms = new Float32Array(n);
  for (let k = 0; k < n; k++) { let e = 0; const end = Math.min(d.length, (k + 1) * w); for (let j = k * w; j < end; j++) e += d[j] * d[j]; rms[k] = Math.sqrt(e / w); }
  const gaps = [];
  let from = null;
  for (let k = 0; k < n; k++) {
    if (rms[k] < 0.01) from ??= k;
    else if (from !== null) { gaps.push({from:from / ENV_RATE, to:k / ENV_RATE}); from = null; }
  }
  phraseGaps.set(buf, gaps);
  const floor = Math.max(1e-4, rms.reduce((a, x) => Math.max(a, x), 0) * 0.03), on = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (rms[k] > floor) for (let j = Math.max(0, k - 2); j <= Math.min(n - 1, k + 10); j++) on[j] = 1;
  env = new Float32Array(n);
  const up = 1 - Math.exp(-1 / (0.04 * ENV_RATE)), down = 1 - Math.exp(-1 / (0.25 * ENV_RATE));
  for (let k = 0, y = 0; k < n; k++) { y += (on[k] - y) * (on[k] > y ? up : down); env[k] = y; }
  envelopes.set(buf, env);
  return env;
}

const LIM_TRIM = 1.4;
// The clipper rounds overs up to +6 dB over full scale instead of flat-topping them (see clipCurve).
const CLIP_HEADROOM = 2;
// The clipper tops out at 0.98; this trim keeps the master output (true peak, 4x oversampled) under -1 dBTP.
const OUT_TRIM = 0.78;
// Post-clipper headroom for Trap's saw, pad, and bells ensembles; leave their transients intact.
const TRAP_OUTPUT_DB = { 0: -0.8, 2: -0.3, 6: -0.3 };
const STYLE_OUTPUT_DB = { gfunk: -0.8, phonk: -0.8, electrohiphop: -0.5, euphoric: 0.7, neosoul: 0.6 };

// Six band-limited squares (808 cymbal cluster) summed once into a seamless 0.5 s loop.
// Each square is read from a one-period wavetable; a small LRU bounds memory as tunings change.
const METAL_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];
const METAL_MAX = 24, TABLE = 2048;
const metalCache = new Map();
function metallicBuf(mul, sr) {
  const k = Math.round(mul * 200), key = `${sr}:${k}`;
  let buf = metalCache.get(key);
  if (buf) { metalCache.delete(key); metalCache.set(key, buf); return buf; }
  const n = Math.floor(sr / 2), d = new Float32Array(n), tab = new Float32Array(TABLE + 1);
  const top = Math.min(20000, sr * 0.45);
  for (const f0 of METAL_FREQS) {
    const f = (f0 * k) / 200, cycles = Math.max(1, Math.round((f * n) / sr));
    tab.fill(0);
    for (let h = 1; h * f < top; h += 2) {
      const a = (0.16 * 4) / (Math.PI * h), w = (2 * Math.PI * h) / TABLE;
      for (let j = 0; j < TABLE; j++) tab[j] += a * Math.sin(w * j);
    }
    tab[TABLE] = tab[0];
    const step = (cycles * TABLE) / n;
    for (let i = 0; i < n; i++) { const x = (i * step) % TABLE, j = x | 0; d[i] += tab[j] + (tab[j + 1] - tab[j]) * (x - j); }
  }
  buf = new AudioBuffer({ length: n, sampleRate: sr, numberOfChannels: 1 });
  buf.copyToChannel(d, 0);
  metalCache.set(key, buf);
  if (metalCache.size > METAL_MAX) metalCache.delete(metalCache.keys().next().value);
  return buf;
}

export class Engine {
  get playbackStyle() { return this.replay808Style ?? this.state.artist?.style; }
  get minimal() { return (jazzStyle(this.state, this.playingPattern) ?? this.playbackStyle) === 'minimal'; }
  get playbackSeed() { return this.replaySeed ?? this.state.artist?.seed; }
  get hardTechno() { return this.state.artist?.style === 'hardtechno'; }
  constructor(ctx, state, { realtime = true, vocal = null, trackQueuedNotes = false, destination = null } = {}) {
    this.ctx = ctx;
    this.state = state;
    this.realtime = realtime;
    this.vocalOf = vocal;
    this.queuedNotes = trackQueuedNotes ? [] : null;
    this.queuedNotesPrunedAt = 0;
    this.editableHits = [];
    this.ducks = [];
    this.gatedBasses = new Map();
    this.continuousSources = [];
    this.noise = makeNoise(ctx, 2);
    this.buildMaster(destination);
    this.buildFx();
    this.buildChannels();
    if (state.artist?.style === 'dub') this.dubPadOut();
    this.buildAcid();
    this.applyAll();
  }

  get stepDur() { return (60 / this.state.bpm / 4) * (this.stepScale || 1); }
  get vocalStepDur() { return 60 / this.state.bpm / 4; }
  get vocalRubato() { return this.variableScoreTempo || this.stepDur !== this.vocalStepDur; }

  // ---------- graph ----------
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  filter(type, f, q = 0.707) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  // Panning is linear, so every mono voice at one seat can share a panner: one per seat, not one per oscillator.
  sidePans(seats, out) { return seats.map((v) => { const pan = this.ctx.createStereoPanner(); pan.pan.value = v; pan.connect(out); return pan; }); }
  comp(th, ratio, knee, atk, rel) {
    const c = this.ctx.createDynamicsCompressor();
    c.threshold.value = th; c.ratio.value = ratio; c.knee.value = knee; c.attack.value = atk; c.release.value = rel;
    return c;
  }

  buildMaster(destination) {
    const c = this.ctx;
    this.mix = this.gain(1);
    this.duck = this.gain(1);
    this.duck.connect(this.mix);
    this.djHP = this.filter('highpass', 10, 0.9);
    this.djLP = this.filter('lowpass', 21000, 0.9);
    this.arrLP = this.filter('lowpass', 21000, 0.7);
    // Mastering EQ and width (MASTER_TONE, applyTone): flat and mono-neutral until a genre sets them.
    this.toneLow = this.filter('lowshelf', 90, 0.7);
    this.toneMud = this.filter('peaking', 300, 0.7);
    this.tonePres = this.filter('highshelf', 2400, 0.7);
    this.toneAir = this.filter('highshelf', 10000, 0.7);
    this.widthIn = this.gain(1); this.widthOut = c.createChannelMerger(2);
    const split = c.createChannelSplitter(2), sideL = this.gain(0.5), sideR = this.gain(-0.5), sideHP = this.filter('highpass', 300, 0.7);
    this.widthL = this.gain(0); this.widthR = this.gain(0);
    this.widthIn.connect(split); split.connect(this.widthOut, 0, 0); split.connect(this.widthOut, 1, 1);
    split.connect(sideL, 0); split.connect(sideR, 1); sideL.connect(sideHP); sideR.connect(sideHP);
    sideHP.connect(this.widthL).connect(this.widthOut, 0, 0); sideHP.connect(this.widthR).connect(this.widthOut, 0, 1);
    this.glue = this.comp(-14, 2.5, 8, 0.015, 0.16);
    this.satIn = this.gain(1 / SAT_HEADROOM);
    this.sat = c.createWaveShaper(); this.sat.oversample = '4x';
    this.warm = this.filter('lowpass', 20000, 0.5);
    this.master = this.gain(0.85);
    this.limIn = this.gain(0.5);
    this.limiter = this.comp(-6, 12, 3, 0.002, 0.12);
    this.limTrim = this.gain(LIM_TRIM / CLIP_HEADROOM);
    this.secPreGain = this.gain(1);
    this.clip = c.createWaveShaper(); this.clip.curve = clipCurve(CLIP_HEADROOM); this.clip.oversample = '4x';
    this.out = this.gain(OUT_TRIM);
    // Euphoric sections lift into the clipper; other genres keep their post-clipper contrast.
    this.secGain = this.gain(1);
    // While the neural singer sings, the band dips under it (bandDuck) so the sung mix stays on the loudness target.
    this.bandDuck = this.gain(1);
    // ...and the limiter, which then works less, would still let it add about a dB: singTrim takes that back after it.
    this.singTrim = this.gain(1);
    this.festivalGate = this.gain(1);
    this.preMaster = this.gain(1);
    this.mix.connect(this.bandDuck).connect(this.preMaster);
    this.preMaster.connect(this.djHP).connect(this.djLP).connect(this.arrLP).connect(this.toneLow).connect(this.toneMud).connect(this.tonePres).connect(this.toneAir).connect(this.widthIn);
    this.widthOut.connect(this.glue).connect(this.satIn).connect(this.sat)
      .connect(this.warm).connect(this.master).connect(this.limIn).connect(this.limiter).connect(this.limTrim).connect(this.secPreGain).connect(this.clip).connect(this.secGain).connect(this.singTrim).connect(this.festivalGate);
    if (this.queuedNotes) {
      this.wakeGain = this.gain();
      this.festivalGate.connect(this.wakeGain).connect(this.out);
    } else this.festivalGate.connect(this.out);
    if (destination) {
      this.tailGain = this.gain();
      this.out.connect(this.tailGain).connect(destination);
    } else this.out.connect(c.destination);
    // The neural singer's stem (vocal(), js/sing.js): past the band's duck, into the master chain.
    this.vocalBus = this.gain(0);
    this.vocalOut = this.gain(1);
    this.vocalBus.connect(this.vocalOut).connect(this.preMaster);
    if (this.realtime) {
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.72;
      this.out.connect(this.analyser);
    }
  }

  buildFx() {
    const c = this.ctx;
    this.paletteFxCutoff = paletteFor(this.state, this.playbackStyle)?.chords.default.sideCutoff || 0;
    const widthOut = out => this.paletteWidthOut(out, this.paletteFxCutoff);
    // Reverb
    this.revIn = this.gain(1);
    this.revHP = this.filter('highpass', 240);
    this.revConv = c.createConvolver();
    this.revConv.buffer = makeIR(c, 3.8, { decay: 3.4, brightStart: 0.8, brightEnd: 0.1, predelay: 0.018 });
    this.revLP = this.filter('lowpass', 4500);
    this.revOut = this.gain(0.7);
    this.revIn.connect(this.revHP).connect(this.revConv).connect(this.revLP).connect(this.revOut).connect(widthOut(this.duck));
    // Short shared room so the whole band sounds like it plays in one space
    this.roomIn = this.gain(1);
    this.roomConv = c.createConvolver();
    this.roomConv.buffer = makeIR(c, ...IR.room);
    this.roomHP = this.filter('highpass', 160);
    this.roomOut = this.gain(0);
    this.roomIn.connect(this.roomHP).connect(this.roomConv).connect(this.roomOut).connect(widthOut(this.mix));
    // Recorded players get the body and air of a real room around them; dry mono samples read as a plug-in.
    this.bandIn = this.gain(1);
    this.bandConv = c.createConvolver();
    this.bandConv.buffer = makeIR(c, ...IR.band);
    this.bandOut = this.gain(0.45);
    this.bandIn.connect(this.filter('highpass', 140)).connect(this.bandConv).connect(this.filter('lowpass', 7000))
      .connect(this.bandOut).connect(widthOut(this.mix));

    // Ping-pong delay with band-limited feedback
    this.dlyIn = this.gain(1);
    this.dlyIn.channelCount = 1; this.dlyIn.channelCountMode = 'explicit';
    this.dlyHP = this.filter('highpass', 320);
    this.dlyLP = this.filter('lowpass', 4800);
    this.dL = c.createDelay(4); this.dR = c.createDelay(4);
    this.fb = this.gain(0.45);
    this.fbHP = this.filter('highpass', 260);
    this.fbLP = this.filter('lowpass', 3400);
    this.dlyIn.connect(this.dlyHP).connect(this.dlyLP).connect(this.dL);
    this.dL.connect(this.dR);
    this.dR.connect(this.fb).connect(this.fbHP).connect(this.fbLP).connect(this.dL);
    const merge = c.createChannelMerger(2);
    this.dL.connect(merge, 0, 0); this.dR.connect(merge, 0, 1);
    this.dlyOut = this.gain(0.65);
    merge.connect(this.dlyOut).connect(widthOut(this.duck));

    // Kick rumble: dark reverb of the kick, low-passed and hard-ducked by the kick itself
    this.rumbleIn = this.gain(1);
    this.rumbleConv = c.createConvolver();
    this.rumbleConv.buffer = makeIR(c, 2.6, { decay: 2.2, brightStart: 0.25, brightEnd: 0.04, predelay: 0.03, seed: 31 });
    this.rumbleLP = this.filter('lowpass', 150, 1.1);
    this.rumbleHP = this.filter('highpass', 34, 0.8);
    this.rumbleDuck = this.gain(1);
    this.rumbleOut = this.gain(2.2);
    this.rumbleOut.channelCount = 1; this.rumbleOut.channelCountMode = 'explicit';
    this.rumbleIn.connect(this.rumbleConv).connect(this.rumbleLP).connect(this.rumbleHP)
      .connect(this.rumbleDuck).connect(this.rumbleOut).connect(this.mix);

    // Momentary FX throw bus (fed by every channel)
    this.throwBus = this.gain(0);
    this.throwBus.connect(this.revIn);
    this.throwBus.connect(this.dlyIn);
  }

  buildChannels() {
    const c = this.ctx;
    this.ch = {};
    for (const t of TRACKS) {
      const input = this.gain(1);
      const level = this.gain(1);
      const pan = c.createStereoPanner();
      const rev = this.gain(0);
      const dly = this.gain(0);
      // The bass gets its own kick sidechain (see duckAt) on top of the shared pump.
      const sc = t.id === 'acid' ? this.gain(1) : null;
      // Channel strip: low shelf, two bells and an air shelf, flat (and bit-transparent) until a band mix sets it.
      const strip = [this.filter('lowshelf', 120), this.filter('peaking', 300, 1), this.filter('peaking', 3000, 1), this.filter('highshelf', 9000)];
      strip.forEach((f) => { f.gain.value = 0; });
      strip.reduce((a, f) => a.connect(f), input);
      const post = sc || level;
      if (sc) sc.connect(level);
      strip[3].connect(post);
      // CHORDS (keys, guitars) step out of the sung vocal's presence band while it sings (Engine.vocal, carve).
      const carve = t.id === 'stab' ? this.filter('peaking', 3000, 0.8) : null;
      if (carve) carve.gain.value = 0;
      level.connect(carve || pan);
      if (carve) carve.connect(pan);
      pan.connect(DUCKED.has(t.id) ? this.duck : this.mix);
      pan.connect(rev).connect(this.revIn);
      if (t.id !== 'vox') pan.connect(this.roomIn);
      pan.connect(dly).connect(this.dlyIn);
      pan.connect(this.throwBus);
      const ch = { input, level, pan, rev, dly, sc, strip, post, carve };
      if (t.id === 'stab') {
        ch.band = this.gain(1);
        ch.band.connect(input);
        ch.band.connect(this.bandIn);
      }
      if (t.id === 'kick') {
        ch.rumble = this.gain(0);
        level.connect(ch.rumble).connect(this.rumbleIn);
      }
      this.ch[t.id] = ch;
    }
    this.windDuck = this.gain(1);
    this.windDuck.connect(this.ch.stab.input);
  }

  buildAcid() {
    const c = this.ctx;
    const a = {};
    a.o1 = c.createOscillator(); a.o1.type = 'sawtooth';
    a.o2 = c.createOscillator(); a.o2.type = 'square';
    a.g1 = this.gain(1); a.g2 = this.gain(0);
    a.f1 = this.filter('lowpass', 400, 0);
    a.f2 = this.filter('lowpass', 400, 18);
    a.vca = this.gain(0);
    a.hp = this.filter('highpass', 28);
    a.pre = this.gain(0.55);
    a.shaper = c.createWaveShaper(); a.shaper.oversample = '4x';
    a.tame = this.filter('lowpass', 9500, 0.5);
    a.post = this.gain(1);
    a.env = c.createConstantSource(); a.env.offset.value = 0;
    a.o1.connect(a.g1).connect(a.f1);
    a.o2.connect(a.g2).connect(a.f1);
    a.f1.connect(a.f2).connect(a.vca).connect(a.hp).connect(a.pre).connect(a.shaper).connect(a.tame).connect(a.post).connect(this.ch.acid.input);
    a.env.connect(a.f1.detune);
    a.env.connect(a.f2.detune);
    this.startContinuous(a.o1); this.startContinuous(a.o2); this.startContinuous(a.env);
    this.acidNodes = a;
  }

  // One sound per part for a whole song: while `recLock` is set (main.js sets it per song), a recording is used from
  // the first note that needs it or not at all, so a slow download never swaps a synth stand-in for it mid-song.
  rec(name, lockOnUse = true) {
    const got = liveSet(name), lock = this.recLock;
    if (!lock || (!lockOnUse && !lock.has(name))) return got;
    if (!lock.has(name)) lock.set(name, !!got);
    return lock.get(name) ? got : null;
  }

  // ---------- params ----------
  setTo(param, v, immediate) {
    // this.at: a song handoff schedules the whole mix change onto its downbeat
    if (this.jamAt != null) {
      // Hold whatever automation is running (a section fade) up to the boundary so the outgoing bar plays out.
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(this.jamAt);
      else {
        const held = this.sectionLevelAt(param, this.jamAt);
        param.cancelScheduledValues(this.jamAt + 1 / this.ctx.sampleRate);
        if (held != null) param.linearRampToValueAtTime(held, this.jamAt);
      }
      param.setValueAtTime(v, this.jamAt);
      this.jamParams.add(param);
    } else if (this.at) param.setTargetAtTime(v, this.at, 0.004);
    else if (immediate) param.value = v;
    else param.setTargetAtTime(v, this.ctx.currentTime, 0.015);
  }

  // Where a running Hard Techno section fade has a track level at t, for browsers without cancelAndHoldAtTime.
  sectionLevelAt(param, t) {
    const fade = this.hardFade, id = fade && TRACK_IDS.find(k => this.ch[k].level.gain === param);
    if (!id || t <= fade.t || t >= this.hardFadeAt) return null;
    const from = fade.from[id] ?? 1, to = fade.to[id] ?? 1;
    return fade.levels[id] * (from + (to - from) * (t - fade.t) / (this.hardFadeAt - fade.t));
  }

  // The first sample frame at or after t, so fades and Jam edits on one boundary share an exact time.
  gridTime(t) {
    const rate = this.ctx.sampleRate;
    return Math.ceil(t * rate - 1e-6) / rate;
  }

  scheduleJamParams(params, at) {
    const state = this.state, previous = this.jamAt;
    this.jamParams ||= new Set();
    this.jamAt = this.gridTime(Math.max(this.ctx.currentTime + 1 / this.ctx.sampleRate, at));
    this.state = { ...state, params: { ...state.params, ...params } };
    try {
      this.schedulingJam = true;
      for (const [track, values] of Object.entries(params))
        for (const key of Object.keys(values)) this.applyParam(track, key, true);
    } finally { this.state = state; this.jamAt = previous; this.schedulingJam = false; }
  }

  scheduleJamDrive(v) {
    const a = this.acidNodes, c = this.ctx, now = c.currentTime, at = this.jamAt;
    if (!this.jamDrives) {
      const gain = c.createGain();
      a.pre.disconnect(a.shaper); a.shaper.disconnect(a.tame);
      a.pre.connect(a.shaper).connect(gain).connect(a.tame);
      this.jamDrives = [{ at: -Infinity, shaper: a.shaper, gain }];
    }
    for (const p of this.jamDrives.filter(p => p.at >= at)) {
      a.pre.disconnect(p.shaper); p.shaper.disconnect(); p.gain.disconnect();
    }
    this.jamDrives = this.jamDrives.filter(p => p.at < at);
    const shaper = c.createWaveShaper(), gain = c.createGain();
    shaper.oversample = '4x'; shaper.curve = driveCurve(v * .75); gain.gain.value = 0;
    a.pre.connect(shaper).connect(gain).connect(a.tame);
    this.jamDrives.push({ at, shaper, gain });
    const current = this.jamDrives.filter(p => p.at <= now).at(-1);
    for (const p of this.jamDrives.filter(p => p.at < current.at)) {
      a.pre.disconnect(p.shaper); p.shaper.disconnect(); p.gain.disconnect();
    }
    this.jamDrives = this.jamDrives.filter(p => p.at >= current.at);
    for (const p of this.jamDrives) {
      p.gain.gain.cancelScheduledValues(now);
      p.gain.gain.setValueAtTime(p === current ? 1 : 0, now + 1 / c.sampleRate);
    }
    let previous = current;
    for (const p of this.jamDrives.filter(p => p.at > now)) {
      previous.gain.gain.setValueAtTime(0, p.at);
      p.gain.gain.setValueAtTime(1, p.at);
      previous = p;
    }
    a.shaper = shaper;
  }

  cancelJamParams() {
    if (!this.jamParams?.size && !this.jamDrives) return;
    const now = this.ctx.currentTime, a = this.acidNodes;
    for (const param of this.jamParams) param.cancelScheduledValues(now);
    if (this.jamDrives) {
      for (const p of this.jamDrives) {
        a.pre.disconnect(p.shaper); p.shaper.disconnect(); p.gain.disconnect();
      }
      a.pre.connect(a.shaper).connect(a.tame);
      this.jamDrives = null;
    }
    this.jamParams.clear();
    this.applyAll();
  }

  applyAll() {
    const beforeClip = this.playbackStyle === 'euphoric';
    if (this.sectionBeforeClip !== beforeClip) {
      const inactive = (beforeClip ? this.secGain : this.secPreGain).gain;
      inactive.cancelScheduledValues(this.at || this.ctx.currentTime);
      this.setTo(inactive, 1, true);
      this.sectionBeforeClip = beforeClip;
    }
    for (const id of TRACK_IDS) for (const k of Object.keys(this.state.params[id])) this.applyParam(id, k, true);
    for (const k of Object.keys(this.state.master)) this.applyMaster(k, true);
    // Per-genre (and per-masterwork) make-up gain into the limiter so every song lands on its loudness target (js/loudness.js).
    const piece = this.state.patterns?.find((p) => p.score?.piece)?.score.piece;
    this.setTo(this.limIn.gain, 0.5 * makeupGain(this.state.artist?.style, piece), true);
    this.setTo(this.glue.threshold, this.hardTechno ? -8 : -14, true);
    this.setTo(this.glue.ratio, this.hardTechno ? 1.3 : 2.5, true);
    this.setTo(this.glue.attack, this.hardTechno ? 0.035 : 0.015, true);
    this.setTo(this.limiter.threshold, this.hardTechno ? -3 : -6, true);
    this.setTo(this.limiter.knee, this.hardTechno ? 1 : 3, true);
    this.applyOutputTrim(true);
    this.applyTone();
    this.applyPaletteWidth();
    this.applyStrips();
  }

  applyPaletteWidth() {
    const cutoff = paletteFor(this.state, this.playbackStyle)?.chords.default.sideCutoff || 0;
    if ((this.paletteFxCutoff || 0) === cutoff) return;
    for (const [source, out] of [[this.revOut, this.duck], [this.dlyOut, this.duck], [this.roomOut, this.mix], [this.bandOut, this.mix]]) {
      source.disconnect(this.paletteWidthOut(out, this.paletteFxCutoff));
      source.connect(this.paletteWidthOut(out, cutoff));
    }
    this.paletteFxCutoff = cutoff;
  }

  applyOutputTrim(immediate = false, time) {
    const voice = Math.round(this.state.params.stab.voice), festival = this.playbackStyle === 'trap' && (voice === 0 || voice === 2);
    if (!festival && this.festivalGate) {
      this.festivalGate.gain.cancelScheduledValues(this.ctx.currentTime);
      this.festivalGate.gain.setValueAtTime(1, this.ctx.currentTime);
    }
    const mix = JAZZ_MIX[jazzStyle(this.state, this.playingPattern)];
    const trim = this.minimal ? 0.32 : this.playbackStyle === 'trap' ? TRAP_OUTPUT_DB[voice] ?? 0 : jazzStyle(this.state, this.playingPattern) === 'bossa' ? voice === 7 ? mix.pianoOutput : voice === 8 ? mix.guitarOutput : mix.output : mix?.output ?? STYLE_OUTPUT_DB[this.playbackStyle] ?? 0;
    const level = this.hardTechno ? 0.89 : OUT_TRIM * dbGain(trim);
    if (Number.isFinite(time)) this.out.gain.setValueAtTime(level, time);
    else this.setTo(this.out.gain, level, immediate);
    const clipTrim = this.playbackStyle === 'neosoul' ? dbGain(-2.5) : jazzStyle(this.state, this.playingPattern) === 'jazzfunk' ? dbGain(-1.5) : 1;
    const clipLevel = clipTrim * (this.hardTechno ? 1 : LIM_TRIM) / CLIP_HEADROOM;
    if (Number.isFinite(time)) this.limTrim.gain.setValueAtTime(clipLevel, time);
    else this.setTo(this.limTrim.gain, clipLevel, immediate);
  }

  // The genre's mastering EQ and stereo width; the width lifts only the side above 300 Hz, so the mono fold-down is unchanged.
  applyTone() {
    this.tonePres.type = this.hardTechno ? 'peaking' : 'highshelf';
    this.tonePres.frequency.value = this.hardTechno ? 3200 : 2400;
    this.tonePres.Q.value = this.hardTechno ? 0.8 : 0.7;
    const [low, mud, pres, air, width] = MASTER_TONE[this.state.artist?.style] || [0, 0, 0, 0, 0];
    this.setTo(this.toneLow.gain, low, true); this.setTo(this.toneMud.gain, mud, true);
    if (this.hardLevels) this.tonePres.gain.cancelScheduledValues(this.at || this.ctx.currentTime);
    this.setTo(this.tonePres.gain, pres, true); this.setTo(this.toneAir.gain, air, true);
    this.setTo(this.widthL.gain, width, true); this.setTo(this.widthR.gain, -width, true);
  }

  // A band mix is EQ'd per instrument the way an engineer would: drums lose the boxy low mids, the bass gets
  // growl over mud, the chord instruments are carved out of 200-500 Hz and given presence.
  // Club styles keep flat strips: their voices are synthesized to sit already.
  applyStrips() {
    const pk = pocketOf(this.state.master), mode = pk?.band ? pk.name : this.soulBand() ? 'SOUL' : null;
    if (mode === this.stripMode) return;
    // A band plays in a live room: the band and drum spaces get early reflections and a shorter, drier tail.
    // During a handoff (this.at set) the change lands on the incoming song's downbeat, not when it is queued.
    const c = this.ctx, at = this.at > c.currentTime ? this.at : 0;
    const set = (prm, v) => (at ? prm.setValueAtTime(v, at) : (prm.value = v));
    if (!!mode !== !!this.stripMode) {
      const swap = () => {
        this.bandConv.buffer = makeIR(c, ...IR[mode ? 'liveBand' : 'band']);
        this.roomConv.buffer = makeIR(c, ...IR[mode ? 'liveRoom' : 'room']);
      };
      if (at && !(typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext)) setTimeout(swap, (at - c.currentTime) * 1000); else swap();
    }
    this.stripMode = mode;
    for (const id of TRACK_IDS) {
      const ch = this.ch[id], S = (mode && (mode === 'SOUL' ? SOUL_STRIP : BAND_STRIP)[id]) || null;
      ch.strip.forEach((f, k) => {
        const b = S?.eq?.[k];
        if (b) { set(f.frequency, b[0]); set(f.gain, b[1]); if (b[2]) set(f.Q, b[2]); } else set(f.gain, 0);
      });
    }
    if (!mode && this.smoothOn) this.smoothChords(this.smoothOn, at);
  }

  // A smooth style shelves its chords by db: a cut below 400 Hz under the bass, narrow dips at 2.5 and 2.95 kHz where chord harmonics ring, leaving the top open; when the bass drops out, wetter sends and a deeper dip.
  smoothChords(db, at = 0) {
    this.smoothOn = db;
    const roomAt = Math.max(at, this.ctx.currentTime);
    this.bandOut.gain.cancelScheduledValues(roomAt);
    this.bandOut.gain.setTargetAtTime(0.45 * (this.minimal && db ? dbGain(3.5) : 1), roomAt, 0.12);
    if (this.stripMode) return;
    const [shelf, mid, bell] = this.ch.stab.strip, t = Math.max(at, this.ctx.currentTime);
    const { rev, dly, level } = this.ch.stab, ps = this.state.params.stab, up = db > 0 ? 10 ** (db / 20) : 1, wet = db > 0 ? 1.6 : 1;
    for (const [prm, v] of [[shelf.frequency, db < 0 ? 400 : 120], [shelf.gain, Math.min(db, 0)], [bell.frequency, 2500], [bell.Q, 2.5], [bell.gain, db > 0 ? -20 : db ? -10 : 0], [mid.frequency, db ? 2950 : 300], [mid.Q, db ? 3 : 1], [mid.gain, db ? -8 : 0], [level.gain, ps.level * up], [rev.gain, ps.rev * wet], [dly.gain, ps.dly * wet]]) {
      prm.cancelScheduledValues(t);
      prm.setTargetAtTime(v, t, 0.12);
    }
  }

  setParam(tid, id, v) { this.state.params[tid][id] = v; this.applyParam(tid, id); }
  setMaster(id, v) { this.state.master[id] = v; this.applyMaster(id); }

  applyParam(tid, id, immediate = false) {
    if (id === 'tune' && (tid === 'ch' || tid === 'oh' || tid === 'ride')) {
      const tune = this.state.params[tid].tune, sr = this.ctx.sampleRate;
      for (const m of tid === 'ride' ? [2.05 * tune, 1.47 * tune] : [1.35 * tune]) metallicBuf(m, sr);
    }
    const v = this.state.params[tid][id];
    const ch = this.ch[tid];
    if (tid === 'stab' && id === 'voice') return this.applyOutputTrim(immediate);
    if (id === 'level') {
      const trim = tid === 'ch' && this.playbackStyle === 'euphoric' ? 10 ** (-1 / 20) : 1;
      const gain = v * trim * (tid === 'stab' && this.smoothOn > 0 ? 10 ** (this.smoothOn / 20) : 1), fade = this.hardFade;
      if (tid === 'stab' && this.dubPadBus) this.setTo(this.dubPadBus.gain, this.state.artist?.style === 'dub' ? gain : 0, immediate);
      if (this.jamAt == null || !this.hardTechno || this.hardFadeAt == null) return this.setTo(ch.level.gain, gain, immediate);
      // A Jam level edit rides Hard Techno's section fade at its boundary, wherever a clock re-anchor put that boundary.
      const from = fade.from[tid] ?? 1, to = fade.to[tid] ?? 1;
      const k = Math.min(1, Math.max(0, (this.jamAt - fade.t) / (this.hardFadeAt - fade.t)));
      this.setTo(ch.level.gain, gain * (from + (to - from) * k), immediate);
      if (k < 1) ch.level.gain.linearRampToValueAtTime(gain * to, this.hardFadeAt);
      return;
    }
    if (id === 'pan') return this.setTo(ch.pan.pan, v, immediate);
    if (id === 'rev') return this.setTo(ch.rev.gain, v * (tid === 'stab' && this.smoothOn > 0 ? 1.6 : 1), immediate);
    if (id === 'dly') return this.setTo(ch.dly.gain, v * (tid === 'stab' && this.state.artist?.style === 'dub' ? 0 : tid === 'stab' && this.smoothOn > 0 ? 1.6 : 1), immediate);
    if (tid === 'kick' && id === 'rumble') return this.setTo(ch.rumble.gain, v * v, immediate);
    if (tid === 'acid') {
      const a = this.acidNodes;
      if (id === 'wave') { this.setTo(a.g1.gain, 1 - v, immediate); this.setTo(a.g2.gain, v * 0.72, immediate); }
      if (id === 'cutoff') { this.setTo(a.f1.frequency, v, immediate); this.setTo(a.f2.frequency, v, immediate); }
      if (id === 'reso') { this.setTo(a.f2.Q, v, immediate); this.setTo(a.f1.Q, v * 0.12, immediate); }
      if (id === 'drive') {
        if (this.schedulingJam) this.scheduleJamDrive(v);
        else if (!immediate && !this.at && this.jamDrives) {
          for (const p of this.jamDrives) p.shaper.curve = driveCurve(v * .75);
          a.post.gain.cancelScheduledValues(this.ctx.currentTime);
        }
        else a.shaper.curve = driveCurve(v * 0.75);
        this.setTo(a.post.gain, 1.05 / (1 + v * 1.1), immediate);
      }
    }
  }

  applyMaster(id, immediate = false) {
    const m = this.state.master;
    const v = m[id];
    if (id === 'arr' && !v && this.festivalGate && festivalTrap(this.playbackStyle, this.state.params.stab.voice)) {
      this.festivalGate.gain.cancelScheduledValues(this.ctx.currentTime);
      this.setTo(this.festivalGate.gain, 1, immediate);
    }
    if (id === 'pocket' || id === 'kit') this.applyStrips();
    if (id === 'dj') {
      const { hp, lp, q } = djFilter(v);
      this.setTo(this.djHP.frequency, hp, immediate); this.setTo(this.djLP.frequency, lp, immediate);
      this.setTo(this.djHP.Q, q, immediate); this.setTo(this.djLP.Q, q, immediate);
    } else if (id === 'drive') {
      // A smooth style with no drive gets a straight line through the saturator's headroom: even its gentlest curve intermodulates held chords.
      this.sat.curve = !v && SMOOTH.has(this.playbackStyle) ? new Float32Array([-SAT_HEADROOM, SAT_HEADROOM]) : satCurve(v);
    } else if (id === 'volume') this.setTo(this.master.gain, v, immediate);
    else if (id === 'room') this.setTo(this.roomOut.gain, (v || 0) * 0.9, immediate);
    else if (id === 'warmth') this.setTo(this.warm.frequency, 20000 * Math.pow(0.22, v || 0), immediate);
    else if (id === 'revLevel') this.setTo(this.revOut.gain, v, immediate);
    else if (id === 'revTone') this.setTo(this.revLP.frequency, v, immediate);
    else if (id === 'dlyFb') {
      this.setTo(this.fb.gain, v, immediate);
      if (this.dubEcho) this.setTo(this.dubEcho.fb.gain, Math.max(0, Math.min(0.58, v)), immediate);
    } else if (id === 'dlyLevel') {
      this.setTo(this.dlyOut.gain, v, immediate);
      if (this.dubEcho) this.setTo(this.dubEcho.wet.gain, this.state.artist?.style === 'dub' ? v : 0, immediate);
    }
    else if (id === 'dlyTime') this.applyDelayTime(immediate);
  }

  applyDelayTime(immediate = false) {
    const steps = DELAY_TIMES[Math.round(this.state.master.dlyTime)].steps;
    const t = Math.min(3.9, steps * this.stepDur);
    if (this.dubEcho) this.setTo(this.dubEcho.delay.delayTime, t, immediate);
    if (immediate) { this.dL.delayTime.value = t; this.dR.delayTime.value = t; }
    else {
      const now = Math.max(this.ctx.currentTime, this.at || 0);
      this.dL.delayTime.setTargetAtTime(t, now, 0.08);
      this.dR.delayTime.setTargetAtTime(t, now, 0.08);
    }
  }

  // ---------- helpers ----------
  audibleTime(now) {
    const t = this.ctx.getOutputTimestamp?.()?.contextTime;
    return t > 0 && t <= now ? t : now - ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0));
  }

  startSource(src, t, ...args) {
    src.start(t, ...args);
    if (!this.queuedNotes) return;
    const now = this.ctx.currentTime;
    if (t <= now) return;
    if (now - this.queuedNotesPrunedAt > 0.25) {
      const cutoff = this.audibleTime(now) - WAKE_FLUSH;
      this.queuedNotes = this.queuedNotes.filter(note => note.t >= cutoff);
      this.queuedNotesPrunedAt = now;
    }
    const note = { src, t };
    this.queuedNotes.push(note);
    this.editingHit?.sources.push(note);
  }

  startContinuous(src) {
    src.start(0);
    this.continuousSources.push(src);
  }

  fadeRoomTail(at) {
    const end = at + 0.044;
    const gain = this.tailGain.gain;
    gain.setValueAtTime(1, at + 0.008);
    gain.linearRampToValueAtTime(0.24, at + 0.024);
    gain.linearRampToValueAtTime(0, end);
    for (const src of this.continuousSources) src.stop(end);
    this.continuousSources.length = 0;
    this.riser?.s.stop(end);
    this.riser = null;
    const endSignal = this.ctx.createConstantSource();
    endSignal.offset.value = 0;
    endSignal.connect(this.tailGain);
    endSignal.onended = () => {
      this.tailGain.disconnect();
      this.out.disconnect();
    };
    endSignal.start();
    endSignal.stop(end);
  }

  planHit(time, track, pattern, plan) {
    const hit = { time, track, pattern, plan, note: plan(), sources: [], ducks: [] };
    this.editableHits.push(hit);
    if (hit.note) this.renderHit(hit);
    return hit.note;
  }

  renderHit(hit) {
    if (!hit.note) return;
    const { method, args, step, scale, harm } = hit.note;
    const previous = { step: this.step, stepScale: this.stepScale, harm: this.harm };
    Object.assign(this, { step, stepScale: scale, harm, editingHit: hit });
    try { this[method](...args); }
    finally { Object.assign(this, previous, { editingHit: null }); }
  }

  pruneEditableHits(now) {
    this.editableHits = this.editableHits.filter(hit => hit.time + 0.08 >= now);
  }

  reviseHits(track, pattern) {
    if (!this.editableHits.length) return;
    const now = this.ctx.currentTime, ready = now + HIT_EDIT_GUARD;
    this.pruneEditableHits(now);
    const removed = new Set();
    let duckFrom = Infinity;
    this.revisingHits = true;
    try {
      for (const hit of this.editableHits) {
        if ((track && hit.track !== track) || (pattern != null && hit.pattern !== pattern)) continue;
        const next = hit.plan(), prev = hit.note;
        if (next?.key === prev?.key ||
            (next && next.time < ready) || (prev && prev.time < ready) ||
            hit.sources.some(src => src.t < ready)) continue;
        for (const note of hit.sources) {
          note.src.stop(now);
          removed.add(note);
        }
        for (const { t } of hit.ducks) duckFrom = Math.min(duckFrom, t);
        this.ducks = this.ducks.filter(d => !hit.ducks.includes(d));
        Object.assign(hit, { note: next, sources: [], ducks: [] });
        if (next) this.renderHit(hit);
        for (const { t } of hit.ducks) duckFrom = Math.min(duckFrom, t);
      }
    } finally {
      this.revisingHits = false;
      if (removed.size) this.queuedNotes = this.queuedNotes.filter(note => !removed.has(note));
      if (Number.isFinite(duckFrom)) this.rebuildDucks(duckFrom);
    }
  }

  discardQueuedNotes(now, wakeAt = null, frozenOutputTime = null) {
    this.vocalStop(now);
    const cutoff = wakeAt === null ? now : (frozenOutputTime ?? this.audibleTime(now)) - WAKE_FLUSH;
    if (wakeAt !== null && this.queuedNotes.some(note => note.t >= cutoff && note.t < now)) {
      const gain = this.wakeGain.gain;
      const openAt = Math.max(now + WAKE_FLUSH, wakeAt);
      const level = gain.value;
      if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
      else gain.cancelScheduledValues(now);
      gain.setValueAtTime(level, now);
      gain.linearRampToValueAtTime(0, now + WAKE_FADE);
      gain.setValueAtTime(0, openAt);
      gain.linearRampToValueAtTime(1, openAt + WAKE_FADE);
    }
    // stop() before a source's scheduled start prevents it from sounding.
    for (const { src, t } of this.queuedNotes) if (t >= cutoff) src.stop(now);
    this.queuedNotes.length = 0;
    this.editableHits.length = 0;
    this.ducks.length = 0;

    const acid = this.acidNodes;
    for (const p of [acid.env.offset, acid.o1.frequency, acid.o2.frequency, this.subVoice?.o.frequency]) p?.cancelScheduledValues(now);
    for (const p of [acid.vca.gain, this.subVoice?.amp.gain, this.mono?.amp.gain]) p?.cancelScheduledValues(now);
    for (const { freqs, waves = [], detunes = [], tone, lp } of this.gatedBasses.values()) {
      for (const p of [...freqs, ...waves, ...detunes, tone?.gain, lp.frequency, lp.Q]) p?.cancelScheduledValues(now);
    }
    this.acidRelease(now);
    for (const p of [this.duck.gain, this.rumbleDuck.gain, this.ch.acid.sc?.gain, this.windDuck?.gain, this.pocketLow?.duck.gain]) {
      if (!p) continue;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(p === this.pocketLow?.duck.gain ? 0 : 1, now, 0.01);
    }
  }

  noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    this.startSource(s, t, (t * 7.31) % 1.5);
    s.stop(t + dur);
    return s;
  }

  // `scale` folds a constant gain stage into the envelope (same curve, one node fewer).
  adEnv(param, t, peak, attack, decay, scale = 1) {
    param.setValueAtTime(EPS * scale, t);
    param.linearRampToValueAtTime(peak * scale, t + attack);
    param.exponentialRampToValueAtTime(EPS * scale, t + attack + decay);
  }

  // Live playback: unhook a finished hit from its long-lived bus as soon as its last source ends,
  // instead of leaving the silent chain attached until garbage collection.
  retire(src, ...nodes) {
    if (this.realtime) src.onended = () => { for (const n of nodes) n.disconnect(); };
  }

  duckAt(t, v) {
    if (jazzStyle(this.state, this.playingPattern)) return;
    const depth = this.state.master.duck * Math.min(1, v * 1.25) * 0.9;
    const funk = this.playbackStyle === 'bailefunk';
    // Pump recovers over roughly one beat so offbeat basslines and pads audibly breathe
    const parts = funk ? [] : [[this.duck.gain, depth, this.stepDur * 1.5, 0.0025, 0.03],
      [this.rumbleDuck.gain, 0.98, this.stepDur * 0.47, 0.0025, 0.03]];
    // Club low end: the kick owns the first few ms, then the bass comes straight back.
    const L = lowEnd(this.state.master), sc = this.ch.acid.sc?.gain;
    const color = this.bassColor();
    if (funk && sc) parts.push([sc, 1 - 10 ** (-1.5 / 20), 0.02, 0.002, 0.07]);
    else if (L && sc) parts.push([sc, L.dip * (color?.duckScale ?? 1) * Math.min(1, v * 1.2), L.rel * (color?.recoveryScale ?? 1), 0.002, 0.012]);
    // Keep the wind lead out of the glue compressor's way during a kick's attack.
    if (this.windDuck && !funk) parts.push([this.windDuck.gain, 0.62 * Math.min(1, v * 1.2), 0.045, 0.003, 0.035]);
    const low = paletteFor(this.state, this.playbackStyle)?.bass.lowBand;
    if (low) {
      this.pocketBassOut(low);
      parts.push([this.pocketLow.duck.gain, low.duck * Math.min(1, v * 1.25), 0.07, 0.002, 0.03, 0]);
    }
    const duck = { t, parts };
    if (this.queuedNotes) {
      this.ducks = this.ducks.filter(d => d.t + 0.03 >= this.ctx.currentTime);
      this.ducks.push(duck);
      this.editingHit?.ducks.push(duck);
    }
    if (!this.revisingHits) this.scheduleDuck(duck);
  }

  scheduleDuck({ t, parts }) {
    for (const [param, depth, release, attack, hold, rest = 1] of parts) {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(rest - depth, t, attack);
      param.setTargetAtTime(rest, t + hold, release);
    }
  }

  // Rebuild only future ducking; a hit already sounding keeps its current pump.
  rebuildDucks(from) {
    this.ducks.sort((a, b) => a.t - b.t);
    for (const param of [this.duck.gain, this.rumbleDuck.gain, this.ch.acid.sc?.gain, this.windDuck?.gain, this.pocketLow?.duck.gain]) {
      if (!param) continue;
      param.cancelScheduledValues(from);
      let previous;
      for (const duck of this.ducks) {
        if (duck.t >= from) break;
        if (duck.parts.some(p => p[0] === param)) previous = duck;
      }
      if (previous) {
        const [, , release, , hold, rest = 1] = previous.parts.find(p => p[0] === param);
        if (previous.t + hold >= from) param.setTargetAtTime(rest, previous.t + hold, release);
      }
    }
    for (const duck of this.ducks) if (duck.t >= from) this.scheduleDuck(duck);
  }

  // A live band (SOUL pocket on the LIVE kit) is balanced as recorded; level matching is for club mixes.
  soulBand() { return pocketOf(this.state.master)?.name === 'SOUL' || (Math.round(this.state.master.kit || 0) === 1 && this.state.artist?.style !== 'breaks'); }

  // Synth chord and lead voices go through a make-up gain so they sit level with the recorded players.
  // A lead preset's fixed EQ is linear and time-invariant, so every note of that preset shares one
  // stereo chain after its own pan instead of building three filters per note.
  leadTone(L, dst) {
    const tones = (this.leadTones ||= new Map());
    if (!tones.has(dst)) tones.set(dst, {});
    const byKey = tones.get(dst), key = `${L.thin}|${L.bite}|${L.tame}`;
    if (!byKey[key]) {
      // A lead sits on its harmonics, not its fundamental: shelve the low mids so it never muddies the mix.
      const thin = (byKey[key] = this.filter('lowshelf', 360, 0.7)); thin.gain.value = -L.thin;
      // Its level comes from the 1–2 kHz bite instead, under the harsh band.
      const bite = this.filter('peaking', 1400, 0.9); bite.gain.value = L.bite;
      // The 2–5 kHz presence band is where synth leads turn harsh; dip it rather than darken the whole voice.
      const presence = this.filter('peaking', 3200, 0.8); presence.gain.value = -L.tame;
      thin.connect(bite).connect(presence).connect(dst);
    }
    return byKey[key];
  }

  trimOut(key, db, dst, lowDb = 0, shelfHz = 800) {
    if (!db) return dst;
    const trims = (this.trims ||= new Map());
    if (!trims.has(dst)) trims.set(dst, {});
    const byKey = trims.get(dst);
    // Match level where the voice speaks: the make-up stays out of the 200–500 Hz mud band.
    if (!byKey[key]) {
      const g = (byKey[key] = this.gain(dbGain(db)));
      const shelf = this.filter('lowshelf', shelfHz, 0.7); shelf.gain.value = lowDb - db; g.connect(shelf).connect(dst);
    }
    return byKey[key];
  }

  chordTone(voice, dst) {
    const tone = {
      'afrobeats:1': [1300, -6.6], 'breaks:1': [650, -3.6],
      'reggaeton:3': [450, 3],
      'breaks:5': [1500, 0],
      'hyperpop:0': [1800, 2.9], 'hyperpop:5': [1800, 6.9], 'hyperpop:11': [1450, 13.1],
      'ukg:5': [1500, 6.1],
    }[`${this.state.artist?.style}:${voice}`];
    if (!tone) return dst;
    if (voice >= 7 && dst === this.ch.stab.input) dst = this.ch.stab.band;
    const tones = (this.chordTones ||= new Map());
    if (!tones.has(dst)) tones.set(dst, new Map());
    const byTone = tones.get(dst), key = tone.join();
    if (!byTone.has(key)) {
      const first = this.filter('lowpass', tone[0], 0.5411961), second = this.filter('lowpass', tone[0], 1.3065630);
      first.connect(second).connect(this.gain(dbGain(tone[1]))).connect(dst);
      byTone.set(key, first);
    }
    return byTone.get(key);
  }

  trigger(id, t, v, underHarp = false) {
    const kitMode = Math.round(this.state.master.kit || 0);
    if (kitMode === 1 && id === 'kick' && this.state.artist?.style === 'breaks') return this.kick(t, v);
    if (kitMode === KIT_BACKBEAT && id === 'kick') this.backbeatKickAt = t;
    if (kitMode === KIT_BACKBEAT && id === 'snare') {
      const kit = this.rec('snare');
      if (!kit) loadSnare();
      else if (this.sampledHit(kit, id, t, v, 2.5)) return;
    }
    // HYBRID: drum-machine kick and clap under recorded cymbals, the way house records sample their hats
    if (kitMode === 2 && (id === 'ch' || id === 'oh' || id === 'ride')) {
      const kit = this.rec('kit');
      if (!kit) loadLiveKit();
      else if (this.sampledHit(kit, id, t, v, id === 'ride' ? 8 : 3.5)) return;
    }
    if (kitMode === 1) {
      const kit = this.rec('kit');
      if (!kit) loadLiveKit();
      else if (this.sampledHit(kit, id, t, v)) return;
      switch (id) {
        case 'kick': return this.liveKick(t, v);
        case 'snare': return this.liveSnare(t, v);
        case 'ch': return this.brush(t, v, false);
        case 'oh': return this.brush(t, v, true);
        case 'ride': return this.liveRide(t, v);
      }
    }
    switch (id) {
      case 'kick': return this.kick(t, v);
      case 'clap': return this.clap(t, v);
      case 'snare': return this.snare(t, v);
      case 'ch': return this.hat(t, v, false);
      case 'oh': return this.hat(t, v, true);
      case 'ride': return this.ride(t, v);
      case 'perc': return this.perc(t, v);
      case 'stab': return this.stab(t, v, underHarp);
    }
  }

  // ---------- voices ----------

  hand(t, v, p, out, bongo) {
    // Congas/bongos: two drums (low/high) alternating, open tones and slaps.
    const c = this.ctx, n = this.handN = (this.handN || 0) + 1;
    const high = hash(n, 7) < 0.55, slap = v > 0.85 || hash(n, 9) < p.noise * 0.6;
    const f = (bongo ? 420 : 200) * Math.sqrt(p.tune / 240) * (high ? 1.45 : 1);
    const dec = Math.max(0.04, p.decay * (bongo ? 0.5 : 1.1) * (slap ? 0.45 : 1));
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * (1 + p.bend * 0.6), t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.015 + p.bend * 0.04);
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 1.59;
    const g = this.gain(0), g2 = this.gain(0);
    this.adEnv(g.gain, t, v * 0.85, 0.001, dec);
    this.adEnv(g2.gain, t, v * 0.25, 0.001, dec * 0.4);
    o.connect(g).connect(out); o2.connect(g2).connect(out);
    this.startSource(o, t); this.startSource(o2, t); o.stop(t + dec + 0.05); o2.stop(t + dec + 0.05);
    const nz = this.noiseSrc(t, 0.06), bp = this.filter('bandpass', Math.min(9000, f * (slap ? 9 : 5)), slap ? 1.2 : 2.5), ng = this.gain(0);
    this.adEnv(ng.gain, t, v * (slap ? 0.7 : 0.15 + p.noise * 0.3), 0.0005, slap ? 0.04 : 0.018);
    nz.connect(bp).connect(ng).connect(out);
  }
  shaker(t, v, p, out) {
    // Shaker: band-passed noise with a soft attack; off-beat hits lean in.
    const n = this.shakN = (this.shakN || 0) + 1, len = Math.max(0.03, p.decay * 0.5);
    const src = this.noiseSrc(t, len + 0.02);
    const hp = this.filter('highpass', Math.min(9000, 2500 + p.tune * 6), 0.6), lp = this.filter('lowpass', 11000, 0.5);
    const g = this.gain(0), lvl = v * (n % 2 ? 0.55 : 0.42) * (0.6 + p.noise * 0.8);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + Math.min(0.03, len * 0.35));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(hp).connect(lp).connect(g).connect(out);
  }
  clave(t, v, p, out) {
    const c = this.ctx, f = 1800 * Math.sqrt(p.tune / 240) * (this.state.artist?.style === 'dub' ? 0.5 : 1), dec = Math.max(0.02, p.decay * 0.25);
    for (const [m, l] of [[1, 0.8], [1.48, 0.25]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
      const g = this.gain(0); this.adEnv(g.gain, t, v * l, 0.0005, dec);
      o.connect(g).connect(out); this.startSource(o, t); o.stop(t + dec + 0.03);
    }
  }
  dust(t, sd, abs, crackleUntil = Infinity) {
    // Vinyl/tape bed: faint hiss plus sparse crackle, scheduled per step so it stops with transport.
    const d = this.state.master.dust || 0;
    // The hiss filter is linear and fixed, so every step's noise slice shares one band-pass and level.
    const dub = this.state.artist?.style === 'dub';
    if (!this.hiss) { const g = this.gain(d * 0.018); this.hiss = { bp: this.filter('bandpass', dub ? 3500 : 5200, dub ? 0.35 : 0.4), g, d, dub }; this.hiss.bp.connect(g).connect(this.mix); }
    if (this.hiss.dub !== dub) { this.hiss.bp.frequency.setValueAtTime(dub ? 3500 : 5200, t); this.hiss.bp.Q.setValueAtTime(dub ? 0.35 : 0.4, t); this.hiss.dub = dub; }
    if (this.hiss.d !== d) { this.hiss.g.gain.setValueAtTime(d * 0.018, t); this.hiss.d = d; }
    this.noiseSrc(t, sd).connect(this.hiss.bp);
    for (let k = 0; k < 3; k++) {
      if (hash(abs, k + 70) > d * 0.55) continue;
      const tt = t + hash(abs, k + 80) * sd;
      if (tt >= crackleUntil) continue;
      const c = this.noiseSrc(tt, 0.003);
      const f = this.filter('highpass', 1500 + hash(abs, k + 90) * 4000, 0.7), g = this.gain(d * (0.05 + hash(abs, k + 60) * 0.18));
      c.connect(f).connect(g).connect(this.mix);
    }
  }
  playBuf(buf, t, level, out, rate = 1, dur = 0, fx = {}) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.playbackRate.value = rate;
    const g = this.gain(level);
    let node = s;
    if (fx.drive > 0.01) {
      const sh = this.ctx.createWaveShaper(); sh.curve = driveCurve(Math.min(1, fx.drive), 1 / (1 + fx.drive));
      node = node.connect(sh);
    }
    for (const [freq, db] of fx.shelves || []) {
      if (Math.abs(db) < 0.3) continue;
      const f = this.ctx.createBiquadFilter(); f.type = 'highshelf'; f.frequency.value = freq; f.gain.value = db;
      node = node.connect(f);
    }
    for (const [freq, q, db] of fx.peaks || []) {
      if (Math.abs(db) < 0.3) continue;
      const f = this.ctx.createBiquadFilter(); f.type = 'peaking'; f.frequency.value = freq; f.Q.value = q; f.gain.value = db;
      node = node.connect(f);
    }
    for (let i = 0; fx.lp && i < (fx.lpStages || 1); i++) {
      const lp = this.filter('lowpass', fx.lp, 0.5);
      // The first 30 ms of a picked string is bright zing and pick noise; a thumb rounds it off.
      if (fx.lpTo && fx.lpTo < fx.lp) { lp.frequency.setValueAtTime(fx.lp, t); lp.frequency.exponentialRampToValueAtTime(fx.lpTo, t + 0.05); }
      else if (fx.lpFrom && fx.lpFrom < fx.lp) { lp.frequency.setValueAtTime(fx.lpFrom, t); lp.frequency.exponentialRampToValueAtTime(fx.lp, t + 0.09); }
      node = node.connect(lp);
    }
    if (fx.punch && Math.abs(fx.punch) > 0.02) {
      const pk = Math.max(0.2, level * (1 + fx.punch));
      g.gain.setValueAtTime(pk, t);
      g.gain.linearRampToValueAtTime(level, t + 0.04);
    }
    if (fx.strokeBody && dur >= 0.13) {
      g.gain.setValueAtTime(level, t + 0.05);
      g.gain.linearRampToValueAtTime(level * dbGain(fx.strokeBody), t + 0.072);
      g.gain.linearRampToValueAtTime(level, t + 0.118);
    }
    node.connect(g).connect(out);
    // A held lead note: vibrato that the player leans into after the pick attack.
    if (fx.vib && dur > 0.2) {
      const lfo = this.ctx.createOscillator(), depth = this.gain(0);
      lfo.frequency.value = 5.2 + hash(t, 31) * 0.8;
      depth.gain.setValueAtTime(0, t + 0.12); depth.gain.linearRampToValueAtTime(fx.vib, t + Math.min(0.45, dur * 0.6));
      lfo.connect(depth).connect(s.detune); this.startSource(lfo, t); lfo.stop(t + dur + 0.5);
    }
    // Held orchestral notes outlast their recording: loop the sustained middle, after the attack.
    if (fx.loop && dur > buf.duration / rate - 0.3) { const [a, b] = loopPoints(buf); s.loop = true; s.loopStart = a; s.loopEnd = b; }
    if (fx.offset || fx.fade) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level * (fx.attackGain ?? 1), t + (fx.fade || 0.006));
    }
    this.startSource(s, t, fx.offset || 0);
    if (dur) {
      // A score's note held past its recording (a final piano chord) would stop on a still-ringing sample: fade it
      // out before the sample runs out, at least 40 dB down by its last frame.
      const left = s.loop || !fx.ringOut ? Infinity : (buf.duration - (fx.offset || 0)) / rate, rel0 = fx.release || 0.05;
      const end = Math.min(dur, Math.max(0.02, left - SAMPLE_FADE)), rel = Math.min(rel0, (left - end) / 4.6);
      if (fx.attackGain != null && end > 0.03) {
        g.gain.setValueAtTime(level * fx.attackGain, t + 0.03);
        g.gain.linearRampToValueAtTime(level, t + Math.min(0.06, end));
      }
      g.gain.setValueAtTime(level * (end <= 0.03 ? (fx.attackGain ?? 1) : 1), t + end);
      g.gain.setTargetAtTime(0, t + end, rel);
      const stop = t + Math.min(end + Math.max(0.4, rel * 8), left + 0.01);
      s.stop(stop);
      return { s, g, stop };
    }
    return { s, g };
  }

  // The recorded kit follows the same TUNE/DECAY/TONE knobs as the synth kit; the live-kit preset is neutral.
  liveFx(id, buf, touch) {
    const p = this.state.params[id], ref = LIVE_REF[id], clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const center = id === 'kick' && this.playbackStyle === 'boombap' ? BOOMBAP_KICK_RATE : 1;
    const rate = clamp(ref.tune ? p.tune / ref.tune : 1, 0.6, 1.7) * center;
    const full = buf.duration / rate;
    const dur = p.decay < ref.decay ? Math.max(0.03, full * (p.decay / ref.decay)) : 0;
    const shelves = [];
    if (ref.tone) shelves.push([4500, clamp(9 * Math.log2(p.tone / ref.tone), -18, 12)]);
    if (ref.snappy != null) shelves.push([2500, clamp((p.snappy - ref.snappy) * 20, -12, 12)]);
    if (ref.click != null) shelves.push([3000, clamp((p.click - ref.click) * 22, -12, 15)]);
    // A shorter snare DECAY damps the shell ring (485-885 Hz) the way a towel or gel on the head does.
    const peaks = id === 'snare' && p.decay < ref.decay ? [[550, 1.5, -10 * (1 - p.decay / ref.decay)], [880, 2, -8 * (1 - p.decay / ref.decay)]] : [];
    if (jazzStyle(this.state, this.playingPattern) && id === 'ride') peaks.push([5000, 0.8, -3], [7800, 1, -2]);
    const drive = ref.drive != null ? Math.max(0, p.drive - ref.drive) * 1.2 : 0;
    const punch = ref.punch != null ? (p.punch - ref.punch) * 1.4 : 0;
    const fx = { shelves, peaks, drive, punch };
    if (jazzStyle(this.state, this.playingPattern) && id === 'ride') {
      Object.assign(fx, { fade: 0.005, attackGain: 0.65 });
      return { rate, dur: dur || full, fx };
    }
    if (id === 'snare' && Math.round(this.state.master.kit) === KIT_BACKBEAT) {
      peaks.push([650, 1.1, -8], [630, 3.5, -4], [1800, 0.8, 5.5]);
      if (touch != null) {
        peaks.push([1370, 0.75, 4.4 * touch], [3600, 1, 3.9 * touch]);
        // Put more motion in the body of the stroke without swinging the initial attack.
        fx.strokeBody = 8.3 * touch;
      }
      // Dampen the head before the hat roll; DECAY still controls when the fade starts.
      fx.release = 0.03;
      return { rate, dur: Math.min(dur || full, p.decay * 1.05), fx };
    }
    return { rate, dur, fx };
  }

  liveHit(kit, name, id, t, level, drift, durOverride, touch) {
    const buf = kit[name], o = this.liveFx(id, buf, touch);
    const rate = KIT_PITCH[id] ? o.rate * this.inKey(KIT_PITCH[id] * o.rate) : o.rate;
    this.playBuf(buf, t, level * dbGain(jazzStyle(this.state, this.playingPattern) === 'jazzfunk' && ['kick', 'snare', 'oh'].includes(id) ? JAZZ_MIX.jazzfunk[id] : 0), this.ch[id].input, drift * rate, durOverride ?? o.dur, o.fx);
  }

  // A drummer tunes the heads to the record: move a drum's pitch onto the key's root, fourth or fifth,
  // which sit under major and minor chords alike. Returns the playback-rate correction.
  inKey(f) {
    const m = 69 + 12 * Math.log2(f / 440), k = this.state.key || 0;
    let best = Infinity;
    for (const pc of [0, 5, 7]) { const d = Math.round((m - k - pc) / 12) * 12 + k + pc - m; if (Math.abs(d) < Math.abs(best)) best = d; }
    return Math.pow(2, best / 12);
  }


  // `lift` brings up softly recorded parts in a mix with machine drums.
  sampledHit(kit, id, t, v, lift = 1) {
    const all = (this.rr = (this.rr || 0) + 1), rrs = (this.rrs ||= {});
    const pitch = hash(all, 7) - 0.5, drift = 1 + pitch * 0.012;
    // Four takes round-robin the way a sampler does it: a random one, never the take just played.
    const take = (key, n) => { const last = rrs[key], k = last == null ? Math.floor(hash(all, 11) * n) : (last + 1 + Math.floor(hash(all, 11) * (n - 1))) % n; rrs[key] = k; return k + 1; };
    if (id === 'kick') {
      const layer = v > 0.82 ? 4 : v > 0.62 ? 3 : 2;
      this.liveHit(kit, `kick_v${layer}_${take(`kick${layer}`, layer === 3 ? 2 : 4)}`, 'kick', t, 0.95 * v ** 1.2, drift);
      this.duckAt(t, v * 0.7);
      return true;
    }
    if (id === 'snare') {
      if (jazzStyle(this.state, this.playingPattern) === 'bossa') {
        this.liveHit(kit, 'snare_rim', 'snare', t, 0.55 * v * dbGain(JAZZ_MIX.bossa.rim), drift);
        return true;
      }
      // Center hits only: a rimshot dropped onto random loud backbeats clanks like a cross-stick.
      const pair = v > 0.85 ? [34, 33] : v > 0.65 ? [24, 23] : v > 0.45 ? [14, 13] : v > 0.25 ? [6, 5] : [2, 5];
      let layer = pair[take(`snare${pair[0]}`, 2) - 1], rate = drift, touch, gain = 1;
      if (Math.round(this.state.master.kit) === KIT_BACKBEAT) {
        const awayFromKick = Math.abs(t - (this.backbeatKickAt ?? -Infinity)) >= 0.04;
        if (v > 0.85) {
          const accent = [34, 33, 24, 23][take('snareAccent', 4) - 1];
          if (awayFromKick) {
            layer = accent;
            rate = 1 + pitch * 0.026;
          }
        }
        if (awayFromKick && v > 0.6) {
          // Move between strong and soft strokes through a neutral bar in either direction.
          const bar = this.step == null ? all - 1 : Math.floor(this.step / 16);
          const phase = bar & 3;
          touch = BACKBEAT_TOUCH[phase] + 0.14 * (2 * hash(all, 47) - 1);
          // Balance the recorded takes first so round-robin changes don't dominate the phrase.
          gain = dbGain(0.65 * touch - 1.15 + BACKBEAT_ATTACK_TRIM[phase] + (BACKBEAT_TAKE_TRIM[layer] ?? 0));
        }
      }
      this.liveHit(kit, `snare_v${layer}`, 'snare', t, 0.85 * lift * v ** 1.4 * gain, rate, undefined, touch);
      return true;
    }
    if (id === 'ch') {
      // A darker TONE is a lighter touch: the hardest stick layer ticks like a clank under soft keys.
      const touch = Math.min(1, this.state.params.ch.tone / LIVE_REF.ch.tone);
      const layer = Math.max(1, Math.min(4, Math.ceil(touch < 1 ? 4 * v ** 1.5 * touch : v * 4)));
      this.liveHit(kit, `hh_v${layer}_${take(`hh${layer}`, 4)}`, 'ch', t, 0.32 * lift * v ** 1.5 * dbGain(JAZZ_MIX[jazzStyle(this.state, this.playingPattern)]?.hat || 0), drift);
      return true;
    }
    if (id === 'oh') {
      this.liveHit(kit, (v > 0.7 ? 'hh_open' : 'hh_half') + (take(v > 0.7 ? 'open' : 'half', 2) === 2 ? '_2' : ''), 'oh', t, 0.3 * lift * v, drift, 0.15 + this.state.params.oh.decay * 0.9);
      return true;
    }
    if (id === 'ride') {
      const layer = v > 0.85 ? 3 : v > 0.55 ? 2 : 1;
      const name = layer === 2 ? `ride_v2_${take('ride2', 2)}` : `ride_v${layer}_1`;
      this.liveHit(kit, name, 'ride', t, 0.3 * lift * v ** 1.3 * dbGain(JAZZ_MIX[jazzStyle(this.state, this.playingPattern)]?.ride || 0), drift);
      return true;
    }
    return false;
  }

  sampledBass(kit, t, m, len, accent) {
    let [name, center] = BASS_NOTES[0];
    for (const [n, c] of BASS_NOTES) if (Math.abs(c - m) < Math.abs(center - m)) [name, center] = [n, c];
    const out = this.ch.acid.input, p = this.state.params.acid, ref = LIVE_REF.acid;
    const fx = { shelves: [[700, Math.max(-24, Math.min(12, 8 * Math.log2(p.cutoff / ref.cutoff)))]], drive: Math.max(0, p.drive - ref.drive) * 1.4 };
    const chop = this.state.artist?.style === 'boombap';
    if (chop) { len = Math.min(len, 0.16 + p.decay * 0.16); Object.assign(fx, { lp: 900, fade: 0.003, attackGain: 1.12, release: 0.025 }); }
    const voice = Math.round(this.state.params.stab.voice), mix = JAZZ_MIX[jazzStyle(this.state, this.playingPattern)];
    const trim = jazzStyle(this.state, this.playingPattern) === 'bossa' ? voice === 7 ? mix.pianoBass : voice === 8 ? mix.guitarBass : mix.bass : mix?.bass || 0;
    const take = hash(t * 1000, 3) > 0.5 ? 0 : 1;
    if (chop) center = BOOMBAP_BASS_CENTERS[name][take];
    this.playBuf(kit[`bass_${name}_${take ? 'b' : 'a'}`], t, (accent ? 1.2 : 1) * (this.noteVel ?? 1) * (chop ? 1.2 : 1) * dbGain(trim), out, Math.pow(2, (m - center) / 12), len, fx);
    if (jazzStyle(this.state, this.playingPattern)) return;
    const sub = this.ctx.createOscillator(); sub.frequency.value = midiHz(m);
    const sg = this.gain(0);
    sg.gain.setValueAtTime(EPS, t);
    sg.gain.linearRampToValueAtTime(0.12, t + 0.01);
    sg.gain.setTargetAtTime(0.07, t + 0.05, 0.2);
    sg.gain.setTargetAtTime(0, t + len, 0.04);
    sub.connect(this.filter('lowpass', 120, 0.7)).connect(sg).connect(out);
    this.startSource(sub, t); sub.stop(t + len + 0.3);
  }

  funkDrum(id, t, v) {
    if (!(v > 0) || ![t, v].every(Number.isFinite)) return;
    const out = this.ch[id].input, p = this.state.params[id];
    if (id === 'clap') {
      const tail = Math.max(0.025, p.decay * 0.375);
      const noise = this.noiseSrc(t, tail + 0.04), bp = this.filter('bandpass', p.tone * 1.35, 0.75);
      const amp = this.gain(0);
      for (const offset of [0, 0.009, 0.018]) {
        amp.gain.setValueAtTime(0, t + offset);
        amp.gain.linearRampToValueAtTime(v * 2.1, t + offset + 0.002);
        amp.gain.exponentialRampToValueAtTime(EPS, t + offset + (offset === 0.018 ? tail : 0.008));
      }
      noise.connect(bp).connect(this.filter('lowpass', 5500, 0.6)).connect(amp).connect(out);
      return;
    }
    const kick = id === 'kick', step = this.step ?? Math.round(t / this.stepDur);
    if (kick) this.duckAt(t, v);
    const high = !kick && funkHand(step) === 2;
    const f = kick ? p.tune : p.tune * (high ? 1.25 : 0.82), len = kick ? 0.22 + p.decay * 0.65 : 0.22;
    const amp = this.gain(0), sh = this.ctx.createWaveShaper();
    sh.curve = driveCurve(kick ? 0.38 : 0.12); sh.oversample = '2x';
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(v * (kick ? 1.45 : 0.85), t + 0.003);
    amp.gain.exponentialRampToValueAtTime(EPS, t + len);
    sh.connect(this.filter('lowpass', kick ? 650 : 2400, 0.6)).connect(amp).connect(out);
    for (const [ratio, level] of kick ? [[1, 1]] : [[1, 1], [1.58, 0.3], [2.13, 0.12]]) {
      const osc = this.ctx.createOscillator();
      osc.frequency.setValueAtTime(f * ratio * (kick ? 2.8 : 1.8), t);
      osc.frequency.exponentialRampToValueAtTime(f * ratio, t + (kick ? 0.032 : 0.018));
      osc.connect(this.gain(level)).connect(sh);
      this.startSource(osc, t); osc.stop(t + len + 0.03);
    }
    const skin = this.noiseSrc(t, 0.045), slap = this.gain(0);
    this.adEnv(slap.gain, t, v * (kick ? 0.09 : 0.6), 0.002, kick ? 0.008 : 0.025);
    skin.connect(this.filter('bandpass', kick ? 1100 : high ? 2100 : 1500, 0.8)).connect(slap).connect(out);
  }

  funkStab(t, v, iv, root, dur, out) {
    if (!(v > 0) || ![t, v, root, dur].every(Number.isFinite) || !iv.length) return;
    const len = Math.max(0.08, Math.min(0.32, dur)), lp = this.filter('lowpass', 1600, 0.65), amp = this.gain(0);
    lp.frequency.setValueAtTime(2100, t); lp.frequency.exponentialRampToValueAtTime(650, t + len);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(v * 0.38 / Math.sqrt(iv.length), t + 0.008);
    amp.gain.exponentialRampToValueAtTime(EPS, t + len + 0.09);
    lp.connect(amp).connect(out);
    for (const note of iv) for (const cents of [-5, 5]) {
      const osc = this.ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.value = midiHz(root + note); osc.detune.value = cents;
      osc.connect(lp); this.startSource(osc, t); osc.stop(t + len + 0.12);
    }
  }

  funkVox(t, v, step) {
    if (!(v > 0) || ![t, v, step].every(Number.isFinite)) return;
    const { buffer, slices } = getSample(this.replay808Style ? null : this.state), p = this.state.params.vox;
    const notes = SCALES[this.state.scale]?.notes || SCALES.minor.notes;
    const phase = step % 32, answer = phase >= 16;
    const degree = notes[(answer ? phase < 28 ? 4 : 0 : phase < 3 ? 0 : phase < 6 ? 2 : 3) % notes.length];
    const rate = 2 ** ((Math.round(p.pitch) + degree - 12) / 12);
    const idx = ((Math.round(p.slice) + (answer ? phase < 28 ? 3 : 1 : phase < 3 ? 0 : phase < 6 ? 1 : 2)) % slices.length + slices.length) % slices.length, from = slices[idx];
    const len = Math.max(0.03, Math.min(0.14, p.length * this.stepDur, ((slices[idx + 1] ?? buffer.duration) - from) / rate));
    for (let i = 0; i < (phase === 30 ? 2 : 1); i++) {
      const at = t + i * this.stepDur * 0.5, src = this.ctx.createBufferSource(), amp = this.gain(0);
      src.buffer = buffer; src.playbackRate.value = rate;
      amp.gain.setValueAtTime(0, at); amp.gain.linearRampToValueAtTime(v * (i ? 0.75 : 1.2), at + 0.004);
      amp.gain.setValueAtTime(v * (i ? 0.75 : 1.2), at + Math.max(0.005, len - 0.018));
      amp.gain.linearRampToValueAtTime(0, at + len);
      src.connect(this.filter('bandpass', 1000 + degree * 35, 0.65)).connect(this.filter('lowpass', p.tone, 0.6)).connect(amp).connect(this.ch.vox.input);
      this.startSource(src, at, from, len + 0.02);
    }
  }

  kick(t, v) {
    if (this.playbackStyle === 'bailefunk') return this.funkDrum('kick', t, v);
    const c = this.ctx, p = this.state.params.kick, out = this.ch.kick.input;
    const f = p.tune, dec = p.decay;
    const o = c.createOscillator();
    const g = this.gain(0);
    const sh = c.createWaveShaper(); sh.curve = driveCurve(p.drive * 0.6, 0.92);
    if (this.hardTechno) sh.oversample = '4x';
    const start = f * (3 + p.punch * 9);
    o.frequency.setValueAtTime(start, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.006 + 0.014 * (1 - p.punch));
    o.frequency.exponentialRampToValueAtTime(f, t + 0.075);
    o.frequency.linearRampToValueAtTime(f * 0.9, t + dec + 0.05);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(v, t + 0.0012);
    g.gain.exponentialRampToValueAtTime(v * 0.62, t + dec * 0.32);
    g.gain.exponentialRampToValueAtTime(EPS, t + dec);
    o.connect(g).connect(sh);
    if (this.hardTechno) sh.connect(this.filter('lowpass', 4800, 0.6)).connect(out);
    else sh.connect(out);
    this.startSource(o, t); o.stop(t + dec + 0.08);
    this.retire(o, sh);

    if (p.click > 0.01) {
      const n = this.noiseSrc(t, 0.03);
      const bp = this.filter('bandpass', this.hardTechno ? 2200 : 3200, 0.6);
      const cg = this.gain(0);
      cg.gain.setValueAtTime(this.hardTechno ? EPS : p.click * v * 2.4, t);
      if (this.hardTechno) cg.gain.linearRampToValueAtTime(p.click * v * 1.6, t + 0.002);
      cg.gain.exponentialRampToValueAtTime(EPS, t + 0.014);
      n.connect(bp).connect(cg).connect(out);
    }
    this.duckAt(t, v);
  }

  clap(t, v) {
    if (this.playbackStyle === 'bailefunk') return this.funkDrum('clap', t, v);
    const p = this.state.params.clap, out = this.ch.clap.input;
    const sp = (0.6 + p.spread * 0.9) * (0.88 + hash(t * 997, 5) * 0.24);
    const offs = [0, 0.0105 * sp * (0.9 + hash(t * 991, 6) * 0.2), 0.021 * sp, 0.031 * sp * (0.94 + hash(t * 983, 7) * 0.12)];
    const last = offs[offs.length - 1];
    const n = this.noiseSrc(t, last + p.decay + 0.1);
    const bp = this.filter('bandpass', p.tone, 1.05);
    const hp = this.filter('highpass', 420);
    const body = this.filter('bandpass', Math.max(700, p.tone * 0.5), 0.9), bg = this.gain(0.6);
    n.connect(body).connect(bg).connect(hp);
    const g = this.gain(0), k = 3.4;
    g.gain.setValueAtTime(EPS * k, t);
    for (let i = 0; i < offs.length - 1; i++) {
      if (!this.hardTechno) g.gain.setValueAtTime(v * k, t + offs[i]);
      if (this.hardTechno) g.gain.linearRampToValueAtTime(v * k, t + offs[i] + 0.002);
      g.gain.exponentialRampToValueAtTime(v * 0.08 * k, t + offs[i] + 0.0095 * sp);
    }
    if (!this.hardTechno) g.gain.setValueAtTime(v * k, t + last);
    if (this.hardTechno) g.gain.linearRampToValueAtTime(v * k, t + last + 0.002);
    g.gain.exponentialRampToValueAtTime(EPS * k, t + last + p.decay);
    n.connect(bp).connect(hp).connect(g).connect(out);
    this.retire(n, g);
  }

  snare(t, v) {
    const c = this.ctx, p = this.state.params.snare, out = this.ch.snare.input;
    const body = this.gain(0), L = 0.55;
    for (const [mul, lvl] of [[1, L], [1.62, 0.3]]) {
      const o = c.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(p.tune * mul * 1.35, t);
      o.frequency.exponentialRampToValueAtTime(p.tune * mul, t + 0.03);
      if (lvl === L) o.connect(body); else o.connect(this.gain(lvl / L)).connect(body);
      this.startSource(o, t); o.stop(t + 0.3);
      if (lvl === L) this.retire(o, body);
    }
    this.adEnv(body.gain, t, v * (1.1 - p.snappy * 0.4), 0.001, 0.06 + p.decay * 0.35, L);
    body.connect(out);
    const n = this.noiseSrc(t, p.decay + 0.1);
    const hp = this.filter('highpass', 1300);
    const lp = this.filter('lowpass', 9000);
    const ng = this.gain(0);
    this.adEnv(ng.gain, t, v * (0.25 + p.snappy * 0.75), 0.001, p.decay);
    n.connect(hp).connect(lp).connect(ng).connect(out);
    this.retire(n, ng);
  }

  // Acoustic kit: modal drum heads, beater and wire noise, brushes and a sine-partial ride.
  liveKick(t, v) {
    const c = this.ctx, p = this.state.params.kick, out = this.ch.kick.input;
    const f = Math.max(42, Math.min(70, p.tune * 1.1)), dec = 0.22 + p.decay * 0.25;
    const sh = c.createWaveShaper(); sh.curve = driveCurve(0.25 + p.drive * 0.3);
    sh.connect(this.gain(0.95)).connect(out);
    for (const [mul, lvl, d] of [[1, v, dec], [1.58, v * 0.35, dec * 0.4], [2.3, v * 0.12, dec * 0.25]]) {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(f * mul * 1.9, t);
      o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.025);
      const g = this.gain(0);
      this.adEnv(g.gain, t, lvl, 0.002, d);
      o.connect(g).connect(sh);
      this.startSource(o, t); o.stop(t + d + 0.05);
    }
    const n = this.noiseSrc(t, 0.03), lp = this.filter('lowpass', 2600, 0.6), ng = this.gain(0);
    this.adEnv(ng.gain, t, v * (0.25 + p.click * 0.4), 0.001, 0.012);
    n.connect(lp).connect(ng).connect(out);
    this.duckAt(t, v * 0.7);
  }

  liveSnare(t, v) {
    const c = this.ctx, p = this.state.params.snare, out = this.ch.snare.input;
    const ghost = v < 0.6, f = Math.max(150, Math.min(260, p.tune));
    if (!ghost) {
      for (const [mul, lvl] of [[1, 0.5], [1.59, 0.28], [2.14, 0.14]]) {
        const o = c.createOscillator();
        o.frequency.setValueAtTime(f * mul * 1.12, t);
        o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.012);
        const g = this.gain(0);
        this.adEnv(g.gain, t, v * lvl, 0.001, 0.07 + p.decay * 0.12);
        o.connect(g).connect(out);
        this.startSource(o, t); o.stop(t + 0.3);
      }
    }
    const wires = 0.12 + p.decay * (ghost ? 0.15 : 0.45);
    const n = this.noiseSrc(t, wires + 0.05);
    const bp = this.filter('bandpass', ghost ? 4200 : 3200, 0.55), hp = this.filter('highpass', 900), ng = this.gain(0);
    ng.gain.setValueAtTime(EPS, t);
    ng.gain.linearRampToValueAtTime(v * (ghost ? 0.5 : 0.75) * (0.5 + p.snappy * 0.6), t + 0.002);
    ng.gain.exponentialRampToValueAtTime(v * 0.18, t + 0.03);
    ng.gain.exponentialRampToValueAtTime(EPS, t + wires);
    n.connect(bp).connect(hp).connect(ng).connect(out);
    if (v > 0.95) {
      const rim = c.createOscillator(); rim.type = 'triangle'; rim.frequency.value = 1680;
      const rg = this.gain(0); this.adEnv(rg.gain, t, 0.22, 0.0005, 0.018);
      rim.connect(rg).connect(out); this.startSource(rim, t); rim.stop(t + 0.05);
    }
  }

  brush(t, v, open) {
    const p = this.state.params[open ? 'oh' : 'ch'], out = this.ch[open ? 'oh' : 'ch'].input;
    const dur = open ? 0.18 + p.decay * 0.4 : 0.035 + p.decay * 0.12;
    const n = this.noiseSrc(t, dur + 0.05);
    const bp = this.filter('bandpass', 7800 * Math.min(1.2, p.tune), 0.45), hp = this.filter('highpass', Math.max(3500, p.tone * 0.8), 0.6);
    const g = this.gain(0);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(v * 1.2, t + (open ? 0.012 : 0.004));
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    n.connect(bp).connect(hp).connect(g).connect(out);
  }

  liveRide(t, v) {
    const c = this.ctx, p = this.state.params.ride, out = this.ch.ride.input;
    const base = 440 * p.tune, dec = Math.max(0.6, p.decay * 1.4);
    const bus = this.gain(1);
    const hp = this.filter('highpass', 700, 0.5);
    bus.connect(hp).connect(out);
    [[1, 0.25, 1], [2.64, 0.2, 0.8], [4.18, 0.16, 0.6], [5.53, 0.12, 0.5], [7.8, 0.1, 0.35], [11.2, 0.06, 0.25]].forEach(([m, lvl, d]) => {
      const o = c.createOscillator(); o.frequency.value = base * m * (1 + (m % 1) * 0.003);
      const g = this.gain(0);
      this.adEnv(g.gain, t, v * lvl, 0.001, dec * d);
      o.connect(g).connect(bus); this.startSource(o, t); o.stop(t + dec * d + 0.05);
    });
    const n = this.noiseSrc(t, 0.05), bp = this.filter('bandpass', 6500, 0.7), ng = this.gain(0);
    this.adEnv(ng.gain, t, v * 0.5, 0.0005, 0.025);
    n.connect(bp).connect(ng).connect(out);
  }

  metallic(t, mul, out) {
    const s = this.ctx.createBufferSource();
    s.buffer = metallicBuf(mul, this.ctx.sampleRate);
    s.loop = true;
    s.connect(out);
    this.startSource(s, t);
    return [s];
  }

  hat(t, v, open) {
    const p = this.state.params[open ? 'oh' : 'ch'], out = this.ch[open ? 'oh' : 'ch'].input;
    const soft = Math.min(1, v);
    const dur = p.decay * (0.8 + 0.25 * soft);
    const ring = 0.5 + 0.5 * soft;
    const bp = this.filter('bandpass', 10500 * Math.min(1.25, p.tune) * (0.74 + 0.26 * soft), 0.9);
    const hp = this.filter('highpass', p.tone * (0.8 + 0.2 * soft), 0.8);
    const oscs = this.metallic(t, 1.35 * p.tune, bp);
    const n = this.noiseSrc(t, dur + 0.05);
    n.connect(this.gain((0.55 + (1 - soft) * 0.35) / ring)).connect(bp);
    const env = this.gain(0);
    this.adEnv(env.gain, t, v * 3.4, 0.0008, dur, ring);
    bp.connect(hp);
    if (this.hardTechno) hp.connect(this.filter('lowpass', 10000, 0.6)).connect(env);
    else if (this.playbackStyle === 'phonk') hp.connect(this.phonkAir(7.8, 10000)).connect(env);
    else if (this.smoothOn) hp.connect(this.filter('lowpass', 7000, -3.0103)).connect(env);
    else hp.connect(env);
    for (const o of oscs) o.stop(t + dur + 0.05);
    if (open) {
      const choke = this.gain(1);
      env.connect(choke).connect(out);
      this.lastOpen = choke;
      this.retire(n, choke);
    } else {
      env.connect(out);
      this.retire(n, env);
      if (this.lastOpen) {
        this.lastOpen.gain.setTargetAtTime(0, t, 0.007);
        this.lastOpen = null;
      }
    }
  }

  ride(t, v) {
    const p = this.state.params.ride, out = this.ch.ride.input;
    const soft = Math.min(1, v);
    const bp = this.filter('bandpass', 7200 * p.tune * (0.8 + 0.2 * soft), 0.55);
    const oscs = this.metallic(t, 2.05 * p.tune, bp);
    const oscs2 = this.metallic(t, 1.47 * p.tune, bp);
    const wash = this.noiseSrc(t, p.decay + 0.05);
    wash.connect(this.gain(0.35)).connect(bp);
    const hp = this.filter('highpass', p.tone * (0.85 + 0.15 * soft), 0.7);
    const env = this.gain(0);
    env.gain.setValueAtTime(EPS, t);
    env.gain.linearRampToValueAtTime(v * (2.4 + 1.2 * soft), t + 0.001);
    env.gain.exponentialRampToValueAtTime(v * 1.1, t + 0.05);
    env.gain.exponentialRampToValueAtTime(EPS, t + p.decay);
    // A smooth style doubles the ride's highpass to 24 dB/oct, so the metallic partials below it don't ring at 3 kHz.
    if (this.smoothOn) bp.connect(hp).connect(this.filter('highpass', p.tone * (0.85 + 0.15 * soft), 0.7)).connect(env).connect(out);
    else bp.connect(hp).connect(env).connect(out);
    for (const o of [...oscs, ...oscs2]) o.stop(t + p.decay + 0.05);
    this.retire(wash, env);
  }

  perc(t, v) {
    const c = this.ctx, p = this.state.params.perc, out = this.ch.perc.input;
    let vo = Math.round(p.voice || 0);
    if (vo >= HAND_KIT.amapiano && vo <= HAND_KIT.bailefunk) {
      if (!(v > 0) || ![t, v].every(Number.isFinite)) return;
      if (this.recordedHands(vo, t, v, p, out)) return;
      if (vo === HAND_KIT.bailefunk) return this.funkDrum('perc', t, v);
      vo = vo === HAND_KIT.amapiano ? 3 : vo === HAND_KIT.reggaeton ? 2 : 1;
    }
    if (this.playbackStyle === 'bailefunk') return this.funkDrum('perc', t, v);
    if (this.hardTechno) this.hardPalette(t, v, [p.tune * 2], p.decay, out, 'metal');
    if (vo > 0) return this[['', 'hand', 'hand', 'shaker', 'clave'][vo]](t, v, p, out, vo === 2);
    const o = c.createOscillator(); o.type = 'sine';
    const f = p.tune;
    o.frequency.setValueAtTime(f * (1 + p.bend * 2.2), t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.02 + p.bend * 0.05);
    const g = this.gain(0);
    this.adEnv(g.gain, t, v * 0.9, 0.001, p.decay);
    o.connect(g).connect(out);
    this.startSource(o, t); o.stop(t + p.decay + 0.05);
    if (p.metal > 0.01) {
      const m = c.createOscillator(); m.type = 'square';
      m.frequency.value = f * 2.76;
      if (this.hardTechno) {
        m.detune.value = (hash(t * 97, 29) - 0.5) * 100;
        m.frequency.setValueAtTime(f * 2.76 * 1.12, t);
        m.frequency.exponentialRampToValueAtTime(f * 2.76 * 0.88, t + p.decay * 0.8);
      }
      const mf = this.filter('bandpass', f * 5.4, 3);
      const mg = this.gain(0);
      this.adEnv(mg.gain, t, v * p.metal * 0.5, 0.001, p.decay * 0.6);
      m.connect(mf).connect(mg).connect(out);
      this.startSource(m, t); m.stop(t + p.decay + 0.05);
    }
    if (p.noise > 0.01) {
      const n = this.noiseSrc(t, 0.12);
      const bp = this.filter('bandpass', Math.min(12000, f * 7), 1.6);
      const ng = this.gain(0);
      this.adEnv(ng.gain, t, v * p.noise * 0.9, 0.0008, 0.035);
      n.connect(bp).connect(ng).connect(out);
    }
  }

  recordedHands(kit, t, v, p, out) {
    const step = this.step ?? 0, bar = Math.floor(step / 16), beat = step % 16;
    const row = this.playingPattern?.steps?.perc, len = this.playingPattern?.len?.perc || 16;
    const cell = step % len;
    const hit = row?.slice(0, cell).filter(Boolean).length ?? beat;
    // The recorded articulations follow the written rhythm, with gains matched to the replaced hit peaks.
    let name, group = 0, ref, gain, gate, lp;
    if (kit === HAND_KIT.amapiano) {
      const open = row?.[cell] === 2;
      [name, ref, gain, gate, lp] = open ? ['conga', 320, 1.13, 0.14, 5700] : ['shaker', 320, 0.95, 0.09, 10500];
      group = open ? 2 : 0;
    } else if (kit === HAND_KIT.afrobeats) {
      [name, ref, gain, gate, lp] = [
        ['conga', 240, 2.18, 0.17, 6100], ['shaker', 240, 1.78, 0.12, 11400],
        ['cowbell', 240, 2.31, 0.15, 6500], ['conga', 240, 2.02, 0.13, 5400],
        ['shaker', 240, 1.87, 0.12, 11400],
      ][hit % 5];
      group = hit % 5 === 0 ? 2 : 0;
    } else if (kit === HAND_KIT.reggaeton) {
      [name, ref, gain, gate, lp] = hit % 3 === 1 ? ['conga', 260, 1.63, 0.15, 5200] : ['timbale', 260, 1.73, 0.15, 7400];
      group = name === 'conga' ? 2 : hit % 3 === 0 ? 0 : bar % 2 ? 4 : 2;
    } else {
      const answer = funkHand(step) === 2;
      [name, ref, gain, gate, lp] = answer ? ['cuica', 220, 2.08, 0.17, 6700] : ['timbale', 220, 2.03, 0.13, 6800];
      group = answer ? 0 : 2;
    }
    const takes = this.rec(name);
    if (!takes) { loadHand(name); return false; }
    const count = name === 'shaker' ? takes.length : 2;
    const variation = hash(step, 59);
    const take = takes[group + Math.floor(variation * count)];
    const rate = Math.max(0.65, Math.min(1.55, p.tune / ref)) * (0.985 + 0.03 * hash(step, 62));
    const dur = gate * Math.max(0.45, Math.min(2, p.decay / (kit === HAND_KIT.amapiano ? 0.09 : kit === HAND_KIT.afrobeats ? 0.2 : kit === HAND_KIT.reggaeton ? 0.15 : 0.18)));
    this.playBuf(take, t, v * gain, out, rate, dur, { lp, fade: 0.001, release: 0.025 });
    return true;
  }

  hardPalette(t, v, frequencies, dur, out, kind) {
    if (!this.hardTechno || !(v > 0) || !Number.isFinite(v) || !(dur > 0) || !Number.isFinite(dur)) return;
    const fs = frequencies.filter(f => Number.isFinite(f) && f > 0);
    if (!fs.length) return;
    const c = this.ctx, metal = kind === 'metal', air = kind === 'air';
    const formant = this.filter(kind === 'rave' ? 'lowpass' : 'bandpass', metal ? 1600 : air ? 680 : 3200, metal ? 0.8 : 1.1);
    formant.frequency.setValueAtTime(metal ? 1600 : air ? 680 : 3200, t);
    formant.frequency.exponentialRampToValueAtTime(metal ? 950 : air ? 1100 : 1200, t + dur * 0.7);
    const drive = c.createWaveShaper(); drive.curve = driveCurve(metal ? 0.32 : 0.5); drive.oversample = '4x';
    const vowel = metal ? drive : this.filter(air ? 'bandpass' : 'peaking', air ? 2600 : 1800, air ? 3.5 : 1.1);
    if (kind === 'rave') vowel.gain.value = -5;
    formant.connect(drive);
    if (!metal) {
      drive.connect(vowel);
      vowel.frequency.setValueAtTime(air ? 2600 : 1800, t);
      vowel.frequency.exponentialRampToValueAtTime(air ? 1300 : 650, t + dur * 0.7);
    }
    const cutoff = metal ? 4200 : 1800, amp = this.gain(0);
    const presence = this.filter('peaking', 2800, 0.7); presence.gain.value = metal ? -3 : 0;
    vowel.connect(presence).connect(this.filter('lowpass', cutoff, 0.6)).connect(this.filter('lowpass', cutoff, 0.6))
      .connect(this.filter('highpass', 350, 0.7)).connect(this.filter('highpass', 350, 0.7)).connect(amp).connect(out);
    const attack = metal ? 0.006 : air ? 0.18 : 0.025, release = Math.max(attack, dur * (air ? 0.55 : 0.12));
    const decay = Math.max(0.025, dur * (air ? 0.23 : 0.25)), end = t + Math.max(dur + 0.8, release + 8 * decay);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(v * (metal ? 0.22 : air ? 0.09 : 0.12) / Math.sqrt(fs.length), t + (kind === 'rave' ? 0.008 : attack));
    amp.gain.setTargetAtTime(0, t + release, decay);
    let last;
    for (const f of fs) {
      for (const side of metal ? [0] : [-1, 1]) {
        const car = c.createOscillator(); car.type = metal ? 'sine' : 'sawtooth';
        const detune = metal ? (hash(t * 97, 29) - 0.5) * 100 : side * (air ? 7 : 42);
        car.frequency.value = f; car.detune.setValueAtTime(detune + (kind === 'rave' ? 240 : 0), t);
        if (kind === 'rave') car.detune.setTargetAtTime(side * 42, t + 0.008, 0.014);
        if (kind === 'rave') {
          const pan = c.createStereoPanner(); pan.pan.value = side * 0.9;
          car.connect(pan).connect(formant);
        } else car.connect(formant);
        if (metal || air) {
          const mod = c.createOscillator(), index = this.gain(0);
          mod.frequency.value = f * (metal ? 2.414 : 1.618);
          if (metal) {
            mod.detune.value = detune;
            car.frequency.setValueAtTime(f * 1.08, t);
            car.frequency.exponentialRampToValueAtTime(f * 0.94, t + dur * 0.8);
            mod.frequency.setValueAtTime(f * 2.61, t);
            mod.frequency.exponentialRampToValueAtTime(f * 1.71, t + dur * 0.8);
          }
          index.gain.setValueAtTime(f * (metal ? 1.4 : 1.2), t);
          index.gain.exponentialRampToValueAtTime(f * 0.04, t + Math.max(0.08, dur * 0.7));
          mod.connect(index).connect(car.frequency); this.startSource(mod, t); mod.stop(end);
        }
        this.startSource(car, t); car.stop(end); last = car;
      }
    }
    this.retire(last, amp);
  }

  hardStabOut(out) {
    const buses = (this.hardStabBuses ||= new WeakMap());
    if (!buses.has(out)) {
      const tone = this.filter('highshelf', 1800); tone.gain.value = -5;
      const core = this.gain(1); core.channelCount = 1; core.channelCountMode = 'explicit';
      core.connect(tone).connect(out);
      buses.set(out, { core, rave: this.hardVoiceOut(tone, 0, false, 300, 5) });
    }
    return buses.get(out);
  }

  hardVoiceOut(out, presence = 0, bell = false, sideCutoff = 300, sideLevel = 1) {
    if (!this.hardTechno) return out;
    const buses = (this.hardVoiceBuses ||= new WeakMap());
    if (!buses.has(out)) buses.set(out, new Map());
    const tones = buses.get(out);
    const key = `${presence}:${bell}:${sideCutoff}:${sideLevel}`;
    if (tones.has(key)) return tones.get(key);
    const c = this.ctx, input = this.gain(1), split = c.createChannelSplitter(2), stereo = c.createChannelMerger(2);
    input.channelCount = 2; input.channelCountMode = 'explicit';
    const mid = this.gain(0.5), side = this.gain(0.5 * sideLevel), negative = this.gain(-1);
    input.connect(split);
    split.connect(mid, 0); split.connect(mid, 1);
    split.connect(side, 0); split.connect(negative, 1); negative.connect(side);
    mid.connect(stereo, 0, 0); mid.connect(stereo, 0, 1);
    const high = this.filter('highpass', sideCutoff, Math.SQRT1_2), invert = this.gain(-1);
    side.connect(high).connect(this.filter('highpass', sideCutoff, Math.SQRT1_2)).connect(invert);
    invert.connect(stereo, 0, 1);
    const positive = this.gain(-1); invert.connect(positive).connect(stereo, 0, 0);
    const tone = this.filter(bell ? 'peaking' : 'highshelf', bell ? 2800 : 1800, 0.7); tone.gain.value = presence;
    stereo.connect(tone).connect(out);
    tones.set(key, input);
    return input;
  }

  hardLead(t, v, f, dur, out) {
    if (!this.hardTechno || ![t, v, f, dur].every(Number.isFinite) || v <= 0 || f <= 0 || dur <= 0) return;
    const c = this.ctx, len = Math.max(0.08, dur * 0.92), end = t + len + 1.2;
    const stereo = c.createChannelMerger(2);
    stereo.connect(this.hardVoiceOut(out, -4, true));
    const voice = (detune, side) => {
      const osc = c.createOscillator(), mod = c.createOscillator(), index = this.gain(0);
      osc.type = 'sawtooth'; osc.frequency.value = f; osc.detune.value = detune;
      mod.frequency.value = f * 2;
      index.gain.setValueAtTime(f * 0.9, t);
      index.gain.exponentialRampToValueAtTime(f * 0.08, t + Math.max(0.06, len * 0.65));
      mod.connect(index).connect(osc.frequency);
      const motion = this.filter('lowpass', 4800, 0.6);
      motion.frequency.setValueAtTime(4800, t);
      motion.frequency.exponentialRampToValueAtTime(700, t + len * 0.55);
      motion.frequency.exponentialRampToValueAtTime(3200, t + len);
      const drive = c.createWaveShaper(); drive.curve = driveCurve(0.14); drive.oversample = '4x';
      const amp = this.gain(0);
      osc.connect(motion).connect(drive).connect(this.filter('lowpass', 5200, 0.6))
        .connect(this.filter('lowpass', 5200, 0.6)).connect(this.filter('highpass', 350, 0.7))
        .connect(this.filter('highpass', 350, 0.7)).connect(amp);
      const peak = v * 0.17 * (side ? 0.25 / Math.SQRT2 : 1);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + Math.min(0.08, len * 0.2));
      amp.gain.setTargetAtTime(peak * 0.55, t + Math.min(0.08, len * 0.2), 0.12);
      amp.gain.setTargetAtTime(0, t + len, 0.18);
      amp.connect(stereo, 0, 0);
      if (side) { const invert = this.gain(-1); amp.connect(invert).connect(stereo, 0, 1); }
      else amp.connect(stereo, 0, 1);
      for (const source of [osc, mod]) { this.startSource(source, t); source.stop(end); }
      this.retire(osc, amp, stereo);
    };
    voice(0, false); voice(-13, true); voice(13, true);
  }

  // FM electric piano: sine carrier, 1:1 modulator for the bark, 14:1 burst for the tine.
  keys(t, v, iv, root, p, out) {
    if (jazzStyle(this.state, this.playingPattern)) return this.jazzKeys(t, v, iv, root, p, out);
    const felt = this.minimal && !!this.smoothOn;
    if (felt && (!iv.length || !Number.isFinite(root) || !Number.isFinite(v) || v <= 0 || iv.some(n => !Number.isFinite(n)))) return;
    const c = this.ctx, end = t + Math.max(0.6, p.decay * 3) + 0.3;
    const funk = jazzStyle(this.state, this.playingPattern) === 'jazzfunk';
    const level = this.minimal ? Math.round(p.voice) === 7 ? 2.52 : 1.18 : 1;
    const damped = this.state.artist?.style === 'breaks' && Math.round(p.voice) === 1;
    const lp = this.filter('lowpass', funk ? Math.min(2600, p.cutoff * 1.3) : Math.min(9000, p.cutoff * (this.minimal ? 1.8 : 2.5)), this.minimal ? -3.0103 + Math.max(0, Math.min(20, p.reso)) : 0.5);
    if (felt) lp.frequency.value *= 0.75 + 0.5 * Math.max(0, Math.min(1, v));
    const trem = c.createStereoPanner();
    const lfo = c.createOscillator(); lfo.frequency.value = 4.8;
    const depth = this.gain(0.35); lfo.connect(depth);
    if (!felt) depth.connect(trem.pan);
    // Soft ARTICULATION is a mellow, felt-damped Rhodes; hard playing brings out the bark and the tine.
    const bite = 0.4 + 1.2 * Math.max(0, Math.min(1, p.env ?? 0.5));
    iv.forEach((n, k) => {
      const f = midiHz(root + n), vel = v * (0.85 + hash(t * 97, k) * 0.3);
      // A smooth style's upper tines bark less, as a real Rhodes does, so high chords stay round instead of ringing.
      const reg = damped ? Math.min(1, 200 / f) ** 4 : funk ? Math.min(1, 330 / f) ** 1.5 : this.minimal ? Math.min(1, 523 / f) : 1;
      const car = c.createOscillator(); car.frequency.value = f; car.detune.value = (k % 2 ? 1 : -1) * p.detune * 0.15;
      if (felt) car.detune.value += (hash(root + n, k + 91) - 0.5) * 1.6;
      const mod = c.createOscillator(); mod.frequency.value = f * (this.minimal ? 0.5 : 1);
      if (felt) mod.detune.value = car.detune.value;
      const modAmt = this.gain(0); mod.connect(modAmt).connect(car.frequency);
      modAmt.gain.setValueAtTime(f * (0.6 + vel * 1.6) * bite * reg * (felt ? 0.8 + 0.4 * Math.min(1, vel) : 1), t);
      modAmt.gain.setTargetAtTime(f * 0.15 * reg, t + 0.005, 0.12 + p.env * 0.3);
      const tine = c.createOscillator(); tine.frequency.value = f * 14;
      const tineAmt = this.gain(0); tine.connect(tineAmt).connect(car.frequency);
      tineAmt.gain.setValueAtTime(damped || funk ? 0 : f * 2.5 * vel * bite * (p.tine ?? 1) * (felt ? 0.65 : 1), t);
      tineAmt.gain.setTargetAtTime(0, t + 0.002, 0.018);
      const amp = this.gain(0);
      amp.gain.setValueAtTime(EPS, t);
      amp.gain.linearRampToValueAtTime((0.42 * vel * level) / Math.sqrt(iv.length), t + 0.004);
      amp.gain.setTargetAtTime(0, t + 0.01, Math.max(0.15, p.decay * (this.minimal ? 0.65 : 0.9)));
      if (felt) {
        const pan = c.createStereoPanner();
        pan.pan.value = Math.max(-0.35, Math.min(0.35, (k - (iv.length - 1) / 2) * 0.16 + (hash(root + n, 92) - 0.5) * 0.06));
        depth.connect(pan.pan);
        car.connect(amp).connect(pan).connect(lp);
        amp.gain.setTargetAtTime(0, t + Math.max(0.12, p.decay * 2.3), 0.06);
        const bar = c.createOscillator(), ring = this.gain(0), peak = 0.42 * vel * level / Math.sqrt(iv.length);
        bar.frequency.value = f * (2.01 + hash(root + n, 93) * 0.006);
        bar.detune.value = car.detune.value;
        ring.gain.setValueAtTime(0, t);
        ring.gain.linearRampToValueAtTime(peak * 0.06 * Math.min(1, vel) * (p.tine ?? 1), t + 0.002);
        ring.gain.setTargetAtTime(0, t + 0.004, 0.04 + 0.04 * p.env);
        bar.connect(ring).connect(pan);
        this.startSource(bar, t); bar.stop(end);
        const hammer = this.noiseSrc(t, 0.04), thump = this.gain(0);
        thump.gain.setValueAtTime(0, t);
        thump.gain.linearRampToValueAtTime(peak * 0.035 * Math.min(1, vel), t + 0.002);
        thump.gain.setTargetAtTime(0, t + 0.003, 0.007);
        hammer.connect(this.filter('highpass', 140, 0.5)).connect(this.filter('lowpass', Math.min(1100, f * 2), 0.5)).connect(thump).connect(pan);
      } else car.connect(amp).connect(lp);
      for (const o of [car, mod, tine]) { this.startSource(o, t); o.stop(end); }
    });
    if (felt) lp.connect(out); else lp.connect(trem).connect(out);
    this.startSource(lfo, t); lfo.stop(end);
  }

  jazzKeys(t, v, iv, root, p, out) {
    if (!iv.length) return;
    const style = jazzStyle(this.state, this.playingPattern);
    const envDefault = style === 'jazzfunk' ? 0.12 : 0.45, detuneDefault = style === 'jazzfunk' ? 0.6 : 12;
    const env = Number.isFinite(p.env) ? Math.max(0, Math.min(1, p.env)) : envDefault;
    const detune = Number.isFinite(p.detune) ? Math.max(0, Math.min(40, p.detune)) : detuneDefault;
    const articulation = 2 ** (env - envDefault), beating = 2 ** ((detune - detuneDefault) / 1200);
    const c = this.ctx, decay = Math.max(0.15, p.decay * 0.9) * articulation, end = t + Math.max(0.6, decay * 6) + 0.3;
    const velocity = Math.max(0, Math.min(1, v / (style === 'jazzfunk' ? dbGain(JAZZ_MIX.jazzfunk.comp) : 1)));
    const lp = this.filter('lowpass', Math.min(5200, p.cutoff * 2.2), 0.5);
    const body = this.filter('peaking', 420, 0.8); body.gain.value = -4;
    const trem = c.createStereoPanner(), lfo = c.createOscillator();
    lfo.frequency.value = 4.8;
    lfo.connect(this.gain(0.12)).connect(trem.pan);
    iv.forEach((n, k) => {
      const f = midiHz(root + n), level = v * (0.85 + hash(t * 97, k) * 0.3) / Math.sqrt(iv.length);
      const reg = Math.min(1, 520 / f), car = c.createOscillator(), mod = c.createOscillator();
      car.frequency.value = f; mod.frequency.value = f;
      const bark = this.gain(0);
      mod.connect(bark).connect(car.frequency);
      bark.gain.setValueAtTime(f * (0.35 + velocity ** 2 * 2.4) * reg * articulation, t);
      bark.gain.setTargetAtTime(f * (0.18 + 0.7 * velocity) * reg, t + 0.005, 0.11 * articulation);
      const bar = c.createOscillator(); bar.frequency.value = f * 1.0016 * beating;
      const amp = this.gain(0);
      amp.gain.setValueAtTime(EPS, t);
      amp.gain.linearRampToValueAtTime(0.42 * level, t + 0.004);
      amp.gain.setTargetAtTime(0, t + 0.012, decay);
      car.connect(amp);
      bar.connect(this.gain(0.18 / 0.82)).connect(amp);
      amp.connect(lp);
      const bell = c.createOscillator(); bell.frequency.value = f * 7.03;
      const strike = this.gain(0);
      strike.gain.setValueAtTime(0, t);
      strike.gain.linearRampToValueAtTime(level * 0.025 * velocity ** 2, t + 0.002);
      strike.gain.setTargetAtTime(0, t + 0.002, 0.028);
      bell.connect(strike).connect(lp);
      for (const source of [car, mod, bar, bell]) { this.startSource(source, t); source.stop(end); }
    });
    lp.connect(body).connect(trem).connect(out);
    this.startSource(lfo, t); lfo.stop(end);
  }

  stab(t, v, underHarp = false) {
    const c = this.ctx, p = this.state.params.stab;
    const { root, vo, iv, pedal } = stabPitches(this);
    if (jazzStyle(this.state, this.playingPattern) === 'jazzfunk') {
      const level = v * dbGain(JAZZ_MIX.jazzfunk.comp);
      this.keys(t, level, iv, root, p, this.ch.stab.input);
      if (Math.floor(this.step / 16) % 4 === 3 && this.step % 16 === 14) {
        const set = this.rec('horn');
        if (set) this.recordedNote(set, t, level * 0.08, root + iv.at(-1), 0.18, this.ch.stab.band, -4, 'horn', 0.5);
      }
      return;
    }
    if (jazzStyle(this.state, this.playingPattern)) {
      const name = vo === 18 ? 'nylon' : vo === 13 ? 'jazz' : jazzStyle(this.state, this.playingPattern) === 'bossa' && vo === 8 ? 'gtr' : 'piano', set = this.rec(name);
      if (!set) { loadBand(name); return this.keys(t, v, iv, root, p, this.ch.stab.input); }
      const bossa = jazzStyle(this.state, this.playingPattern) === 'bossa';
      const trim = bossa && vo === 18 ? JAZZ_MIX.bossa.nylonComp : bossa && vo === 7 ? JAZZ_MIX.bossa.pianoComp : bossa && vo === 8 ? JAZZ_MIX.bossa.guitarComp : JAZZ_MIX[jazzStyle(this.state, this.playingPattern)].comp;
      for (const [k, n] of iv.entries()) this.recordedNote(set, t + (name === 'nylon' ? k * 0.002 : 0), v * 0.62 * dbGain(trim), root + n, pedal ? this.stepDur * 14.4 : p.decay * (bossa ? 1 : 1.7), this.ch.stab.band, -2, name, bossa ? v * 0.6 : v);
      return;
    }
    if (this.playbackStyle === 'bailefunk') return this.funkStab(t, v, iv, root, p.decay, this.ch.stab.input);
    const palette = paletteFor(this.state, this.playbackStyle);
    if (palette) return this.paletteChord(t, v, iv, root, p, this.ch.stab.input, paletteColor(this.state, this.playbackStyle), Math.round(p.voice) === 1);
    if (this.state.artist?.style === 'dub') {
      this.dubPad(t, v, iv, root);
      return this.dubChord(t, v, iv, root, p, this.ch.stab.input);
    }
    const input = this.minimal && this.smoothOn && vo === 7 ? this.ch.stab.band : this.ch.stab.input;
    let trimmed = this.chordTone(vo, this.trimOut(`stab${vo}`, this.soulBand() ? 0 : STAB_TRIM_DB[vo] || 0, input, 0, STAB_SHELF_HZ[vo]));
    if (this.playbackStyle === 'phonk') trimmed = this.phonkMusicIn(trimmed);
    if (this.playbackStyle === 'trap' && (vo === 0 || vo === 2)) trimmed = this.technoHookOut('ravestack', trimmed);
    const layers = this.hardTechno ? this.hardStabOut(trimmed) : null, out = layers ? layers.core : trimmed;
    if (this.minimal && vo === 7) return this.keys(t, v, iv, root, p, out);
    if (layers) this.hardPalette(t, v, iv.map(n => midiHz(root + n)), Math.max(0.12, p.decay), layers.rave, 'rave');
    // A lifted breakdown plays decaying chords an octave up, filling it above the bass range it no longer shares.
    if (vo > 0) {
      if (STAB_VOICES[vo] === 'bells' && underHarp && this.rec('harp', false)) {
        return this.bells(t, v, iv, root, { ...p, decay: p.decay * 0.57 }, this.harpBacking(out));
      }
      return this[STAB_VOICES[vo]](t, v, iv, root, p, out);
    }
    const festival = this.playbackStyle === 'trap';
    const lp = this.filter('lowpass', p.cutoff, p.reso);
    const amp = this.gain(0);
    const env = c.createConstantSource();
    env.offset.setValueAtTime(p.env * 3600 * v, t);
    env.offset.setTargetAtTime(0, t + 0.004, Math.max(0.01, p.decay * 0.35));
    env.connect(lp.detune);
    const peak = (v * (festival ? 0.36 : 0.55)) / Math.sqrt(iv.length);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(peak, t + (this.hardTechno ? 0.018 : 0.003));
    amp.gain.setTargetAtTime(0, t + (this.hardTechno ? 0.04 : 0.012), Math.max(0.02, p.decay * 0.5));
    const end = t + p.decay * 4 + 0.2, pans = this.sidePans(festival ? [-0.8, 0, 0.8] : this.hardTechno ? [-0.85, 0.85] : [-0.55, 0.55], lp);
    for (const n of iv) {
      for (const side of festival ? [-1, 0, 1] : [-1, 1]) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = midiHz(root + n);
        o.detune.value = side * p.detune;
        if (this.hardTechno) {
          o.detune.setValueAtTime(240 + side * p.detune * 3.5, t);
          o.detune.setTargetAtTime(side * p.detune * 3.5, t + 0.008, 0.014);
        }
        o.connect(pans[festival ? side + 1 : side < 0 ? 0 : 1]);
        this.startSource(o, t); o.stop(end);
      }
    }
    if (festival) lp.connect(this.filter('highpass', 180, 0.5)).connect(amp).connect(out);
    else lp.connect(amp).connect(out);
    this.startSource(env, t); env.stop(end);
    this.retire(env, amp);
  }

  harpBacking(out) {
    const tones = (this.harpBackingTones ||= new WeakMap());
    if (!tones.has(out)) {
      const box = this.filter('peaking', 750, 0.9); box.gain.value = -2.5;
      const space = this.filter('peaking', 1450, 0.42); space.gain.value = -4.5;
      const shimmer = this.filter('highshelf', 1550); shimmer.gain.value = -2;
      box.connect(space).connect(shimmer).connect(out);
      tones.set(out, box);
    }
    return tones.get(out);
  }

  // One saw per chord note, except where 3 or more notes' harmonics land within 1.2% of each other at 1.9-3.4 kHz:
  // stacked there, they ring as one tone the chord never plays, so each note's share is cut 20 dB (10 dB where only 2 meet).
  // A lone harmonic at 2.2-2.5 kHz, where the ensemble's drift makes it swell, is trimmed 6 dB.
  chordSaws(notes) {
    if (this._saws?.ctx !== this.ctx) this._saws = { ctx: this.ctx, cache: new Map() };
    const fs = notes.map(midiHz), near = (a, b) => Math.abs(a - b) / a < 0.012;
    return fs.map((f, i) => {
      const n = Math.max(1, Math.min(64, Math.floor(12000 / f))), cut = [];
      for (let k = 1; k <= n; k++) {
        const h = k * f;
        if (h < 1900 || h > 3400) continue;
        const mates = fs.filter((g, j) => j !== i && Array.from({ length: Math.ceil(3500 / g) }, (_, q) => (q + 1) * g).some((x) => near(h, x))).length;
        if (mates) cut.push(`${k}:${mates >= 2 ? 0.1 : 0.3}`);
        else if (h > 2200 && h < 2500) cut.push(`${k}:0.5`);
      }
      const key = `${notes[i]}|${cut.join(',')}`;
      if (!this._saws.cache.has(key)) {
        // Scaled as the built-in saw is normalized, before the cuts, so a cut partial does not raise the note's level.
        const re = new Float32Array(n + 1), im = new Float32Array(n + 1), scale = new Map(cut.map((x) => x.split(':').map(Number)));
        let peak = 0;
        for (let i = 0; i < 1024; i++) { let y = 0; for (let k = 1; k <= n; k++) y += ((k % 2 ? 2 : -2) / (Math.PI * k)) * Math.sin((2 * Math.PI * k * i) / 1024); peak = Math.max(peak, Math.abs(y)); }
        for (let k = 1; k <= n; k++) im[k] = ((k % 2 ? 2 : -2) / (Math.PI * k * peak)) * (scale.get(k) ?? 1);
        this._saws.cache.set(key, this.ctx.createPeriodicWave(re, im, { disableNormalization: true }));
      }
      return this._saws.cache.get(key);
    });
  }

  paletteReference() {
    const { style, seed } = this.state.artist || {}, playback = this.playbackStyle, key = `${playback}:${style}:${seed}:${this.state.scale}`;
    if (this.paletteRef?.key !== key) {
      const params = defaultParams();
      const defaults = PALETTE_DEFAULTS[playback];
      params.stab.detune = defaults?.detune ?? params.stab.detune;
      params.acid.drive = defaults?.drive ?? params.acid.drive;
      if (style === playback && Number.isFinite(seed) && paletteFor(this.state, playback)) {
        params.stab.env = instrumentFor(PALETTE_INSTRUMENTS[style], seed)[4];
      }
      this.paletteRef = { key, stab: params.stab, acid: params.acid };
    }
    return this.paletteRef;
  }

  paletteChord(t, v, iv, root, p, out, color, keys = false) {
    if (!iv.length) return;
    let articulation = 1;
    if (keys) {
      const ref = this.paletteReference().stab;
      articulation = 2 ** ((p.env - ref.env) * 2);
      color = { ...color, spread: Math.max(0, color.spread + (p.detune - ref.detune) * 0.5), tine: p.tine ?? 1 };
    }
    if (color.piano) {
      const hp = this.filter('highpass', 160, 0.7), lp = this.filter('lowpass', color.cutoff, 0.6);
      hp.connect(lp).connect(this.gain(color.level)).connect(out);
      return this.piano(t, v, iv, root, { ...p, rev: Math.min(0.2, p.rev) }, hp);
    }
    if (color.presence) {
      const air = this.palettePresenceOut(out, Math.round(p.voice));
      if (color.presence === 'organ') this.organ(t, v, iv, root, p, air);
      else if (color.presence === 'pad') this.pad(t, v, iv, root, p, air);
      else this.keys(t, v, iv, root, p, air);
    }
    if (color.upper) this.paletteUpperFM(t, v, iv, root, p, out, color.upper);
    for (const band of color.eq || []) out = this.bodyFor(out, band);
    const release = Math.max(0.12, Math.min(color.release, p.decay)), hold = color.hold ?? 0.04, end = t + color.attack + hold + release * 6 + 0.02;
    const cutoff = color.cutoff * Math.max(0.5, Math.min(1.8, p.cutoff / 1800));
    const hp = this.filter('highpass', 180, 0.7), lp = this.filter('lowpass', cutoff, 0.6), amp = this.gain(0);
    lp.frequency.setValueAtTime(cutoff * (0.7 + 0.6 * v) * articulation, t);
    lp.frequency.setTargetAtTime(cutoff * 0.65, t + color.attack + 0.01, Math.max(0.04, release * 0.4));
    hp.connect(lp).connect(amp).connect(out);
    if (color.airBand) {
      const q = 20 * Math.log10(Math.SQRT1_2), band = this.filter('highpass', 1800, q), top = this.filter('lowpass', 6000, q);
      const lift = this.gain(color.airBand * Math.max(0, Math.min(1, (3200 - cutoff * 0.65) / 1800)));
      hp.connect(band).connect(top).connect(lift).connect(amp);
    }
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(v * color.level / Math.sqrt(iv.length), t + color.attack);
    amp.gain.setTargetAtTime(0, t + color.attack + hold, release);
    amp.gain.setValueAtTime(0, end);
    if (color.air) this.noiseSrc(t, end - t).connect(this.gain(color.air)).connect(hp);
    if (color.breath) {
      const air = this.filter('highpass', 2000, Math.SQRT1_2), top = this.filter('lowpass', 9000, Math.SQRT1_2);
      const breath = this.gain(color.breath);
      if (color.breathDecay) {
        breath.gain.setValueAtTime(0, t);
        breath.gain.linearRampToValueAtTime(color.breath, t + color.attack);
        breath.gain.setTargetAtTime(0, t + color.attack, color.breathDecay);
      }
      this.noiseSrc(t, end - t).connect(air).connect(top).connect(breath).connect(amp);
    }
    const width = color.width ?? 0.55, pans = this.sidePans([-width, width], color.sideCutoff ? this.paletteWidthOut(hp, color.sideCutoff) : hp);
    for (const n of iv) {
      const f = midiHz(root + n), wave = this.paletteWave(f, color);
      for (const side of [-1, 1]) {
        const o = this.ctx.createOscillator(); o.type = color.wave; o.frequency.value = f;
        o.detune.value = side * color.spread + Math.sin(t * 0.47 + n) * 1.4;
        o.setPeriodicWave(wave);
        o.connect(this.gain(0.5)).connect(pans[side < 0 ? 0 : 1]);
        this.startSource(o, t); o.stop(end);
      }
    }
  }

  paletteWidthOut(out, cutoff) {
    if (!cutoff) return out;
    const paths = (this.paletteWidths ||= new WeakMap());
    if (!paths.has(out)) {
      const input = this.gain(1), split = this.ctx.createChannelSplitter(2), stereo = this.ctx.createChannelMerger(2);
      input.channelCount = 2; input.channelCountMode = 'explicit';
      const mid = this.gain(0.5), side = this.gain(0.5), negative = this.gain(-1), invert = this.gain(-1);
      input.connect(split);
      split.connect(mid, 0); split.connect(mid, 1);
      split.connect(side, 0); split.connect(negative, 1); negative.connect(side);
      mid.connect(stereo, 0, 0); mid.connect(stereo, 0, 1);
      const high = this.filter('highpass', cutoff, 20 * Math.log10(Math.SQRT1_2)), top = this.filter('highpass', cutoff, 20 * Math.log10(Math.SQRT1_2));
      side.connect(high).connect(top);
      top.connect(stereo, 0, 0); top.connect(invert).connect(stereo, 0, 1);
      stereo.connect(out);
      paths.set(out, input);
    }
    return paths.get(out);
  }

  paletteUpperFM(t, v, iv, root, p, out, level) {
    if (!iv.length) return;
    const end = t + Math.max(0.6, p.decay * 3) + 0.3;
    const tone = this.filter('lowpass', Math.min(9000, p.cutoff * 2.5), 0.5), trim = this.gain(level);
    tone.connect(trim).connect(this.palettePresenceOut(this.paletteUpperOut(out), Math.round(p.voice)));
    const bite = 0.4 + 1.2 * Math.max(0, Math.min(1, p.env ?? 0.5));
    for (const [k, n] of iv.entries()) {
      const f = midiHz(root + n), vel = v * (0.85 + hash(t * 97, k) * 0.3);
      const reg = this.smoothOn ? Math.min(1, 523 / f) : 1;
      const car = this.ctx.createOscillator(), mod = this.ctx.createOscillator(), tine = this.ctx.createOscillator();
      car.frequency.value = mod.frequency.value = f;
      car.detune.value = (k % 2 ? 1 : -1) * p.detune * 0.15;
      tine.frequency.value = f * 14;
      const body = this.gain(0), strike = this.gain(0), amp = this.gain(0);
      mod.connect(body).connect(car.frequency);
      body.gain.setValueAtTime(f * (0.6 + vel * 1.6) * bite * reg, t);
      body.gain.setTargetAtTime(f * 0.15 * reg, t + 0.005, 0.12 + p.env * 0.3);
      tine.connect(strike).connect(car.frequency);
      strike.gain.setValueAtTime(f * 2.5 * vel * bite * (p.tine ?? 1), t);
      strike.gain.setTargetAtTime(0, t + 0.002, 0.018);
      amp.gain.setValueAtTime(EPS, t);
      amp.gain.linearRampToValueAtTime(0.42 * vel / Math.sqrt(iv.length), t + 0.004);
      amp.gain.setTargetAtTime(0, t + 0.01, Math.max(0.15, p.decay * 0.9));
      car.connect(amp).connect(tone);
      for (const o of [car, mod, tine]) { this.startSource(o, t); o.stop(end); }
    }
  }

  paletteUpperOut(out) {
    const paths = (this.paletteUppers ||= new WeakMap());
    if (!paths.has(out)) {
      const input = this.filter('lowpass', 5200, Math.SQRT1_2), right = this.ctx.createDelay(0.025);
      right.delayTime.value = 0.009;
      const cutoff = paletteFor(this.state, this.playbackStyle)?.chords.default.sideCutoff;
      const pans = this.sidePans([-0.8, 0.8], this.paletteWidthOut(out, cutoff));
      input.connect(this.gain(0.7)).connect(pans[0]);
      input.connect(right).connect(this.gain(0.7)).connect(pans[1]);
      paths.set(out, input);
    }
    return paths.get(out);
  }

  palettePresenceOut(out, voice) {
    const paths = (this.paletteAir ||= new WeakMap());
    if (!paths.has(out)) paths.set(out, new Map());
    const byVoice = paths.get(out);
    if (!byVoice.has(voice)) {
      const hp = this.filter('highpass', 1800, Math.SQRT1_2);
      hp.connect(this.gain(0.9)).connect(out);
      byVoice.set(voice, this.trimOut(`palette-presence${voice}`, STAB_TRIM_DB[voice] || 0, hp, 0, STAB_SHELF_HZ[voice]));
    }
    return byVoice.get(voice);
  }

  paletteWave(f, color) {
    const limit = color.harmonics ?? 1850;
    const waves = (this.paletteWaves ||= new Map()), key = `${f}:${color.wave}:${color.fm}:${color.organ || 0}:${color.tine ?? 1}:${limit}`;
    if (!waves.has(key)) {
      const count = Math.max(1, Math.min(32, Math.floor((limit - 100) / f))), re = new Float32Array(count + 1), im = new Float32Array(count + 1);
      for (let h = 1; h <= count; h++) {
        const edge = Math.min(1, Math.max(0, (limit - f * h) / 350));
        const core = color.wave === 'sawtooth' ? (h % 2 ? 1 : -1) / h : color.wave === 'triangle' ? (h % 2 ? (h % 4 === 1 ? 1 : -1) / (h * h) : 0) : h === 1 ? 1 : 0;
        im[h] = edge * (core + (h === 2 ? color.fm * 0.22 + (color.organ || 0) : h === 3 ? color.fm * 0.07 : 0)) * (h === 1 ? 1 : color.tine ?? 1);
      }
      if (im[1] === 0) im[1] = 1;
      waves.set(key, this.ctx.createPeriodicWave(re, im));
    }
    return waves.get(key);
  }

  paletteHook(t, v, f, dur, color, out) {
    const p = this.state.params.stab;
    return this.paletteChord(t, v, [0], paletteRegister(69 + 12 * Math.log2(f / 440), color), { ...p, decay: color.release }, out, { ...color, hold: Math.max(0.04, dur * 0.72) });
  }

  paletteBass(t, st, sd, holdNext, sliding, color) {
    if (color.type) return this.pocketBass(t, st, sd, holdNext, sliding, color);
    const c = this.ctx, p = this.state.params.acid, f = midiHz(this.bassMidi(st)), subF = midiHz(this.bassMidi(st, 36, 38));
    const from = this.monoNote(t, f, sliding), len = holdNext ? sd * 2 : sd * (1 + p.decay * 6), end = t + len + 0.3;
    const body = this.gain(1), lp = this.filter('lowpass', p.cutoff, Math.max(0.5, p.reso * 0.35)), amp = this.gain(0);
    lp.frequency.setValueAtTime(Math.min(9000, p.cutoff * (1 + p.envmod * 5 + (st.a ? p.accent * 2 : 0))), t);
    lp.frequency.setTargetAtTime(p.cutoff, t + 0.01, Math.max(0.03, p.decay * 0.6));
    const drive = c.createWaveShaper(); drive.curve = driveCurve(0.15 + p.drive * 0.7);
    const move = c.createOscillator(), depth = this.gain(color.movement);
    move.frequency.value = 0.17 + p.wave * 0.13;
    const phase = t * move.frequency.value * 2 * Math.PI;
    move.setPeriodicWave(c.createPeriodicWave(new Float32Array([0, Math.sin(phase)]), new Float32Array([0, Math.cos(phase)])));
    move.connect(depth).connect(lp.detune);
    this.startSource(move, t); move.stop(end);
    const vel = (st.a ? 0.95 : 0.8) * (this.noteVel ?? 1) * color.level;
    amp.gain.setValueAtTime(EPS, t); amp.gain.linearRampToValueAtTime(vel * 0.5, t + 0.008);
    amp.gain.setTargetAtTime(0, t + len, 0.04);
    const bodyOut = color.midCut ? this.filter('peaking', color.midCut[0], color.midCut[1]) : amp;
    if (color.midCut) {
      const cut = color.midCut[2] * Math.min(1, (this.noteVel ?? 1) * (st.a ? 1 : 0.85)) ** 2;
      bodyOut.gain.setValueAtTime(0, t);
      bodyOut.gain.linearRampToValueAtTime(-cut, t + 0.008);
      bodyOut.gain.setTargetAtTime(0, t + len, 0.04);
    }
    body.connect(lp).connect(drive).connect(bodyOut);
    if (bodyOut !== amp) bodyOut.connect(amp);
    amp.connect(this.ch.acid.input);
    for (const [type, det, level] of [['sawtooth', -color.spread, color.body], ['sawtooth', color.spread, color.body], ['sine', 0, color.sub]]) {
      const o = c.createOscillator(); o.type = type; o.detune.value = det;
      o.frequency.setValueAtTime(type === 'sine' ? subF : from, t);
      if (type !== 'sine' && from !== f) o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
      o.connect(this.gain(level)).connect(type === 'sine' ? amp : body);
      this.startSource(o, t); o.stop(end);
    }
    this.mono = { amp, f, end };
  }

  pocketReferenceGain(st, len, color, preamp) {
    if (!color.balance || Math.round(this.state.params.acid.voice) !== 5) return 1;
    const set = this.rec('ebass');
    if (!set?.length) return 1;
    const p = this.state.params.acid, note = this.bassMidi(st);
    let [m, buf] = set[0];
    for (const [n, b] of set) if (Math.abs(n - note) < Math.abs(m - note)) [m, buf] = [n, b];
    if (!buf?.length) return 1;
    const cache = (this.pocketRefs ||= new WeakMap());
    if (!cache.has(buf)) cache.set(buf, new Map());
    const known = cache.get(buf), key = `${note}:${len}:${p.cutoff}:${preamp}:${!!st.a}`;
    if (known.has(key)) return known.get(key);
    const sr = buf.sampleRate, rate = 2 ** ((note - m) / 12), n = Math.ceil((len + 0.25) * sr), clip = new Float32Array(n);
    const src = buf.getChannelData(0), gate = len / color.length;
    let envelopeEnergy = 0;
    const release = color.sustain + (1 - color.sustain) * Math.exp(-Math.max(0, len - 0.012) / color.decay);
    for (let i = 0; i < n; i++) {
      const t = i / sr, at = i * rate, j = Math.floor(at), mix = at - j;
      const sample = (src[j] || 0) * (1 - mix) + (src[j + 1] || 0) * mix;
      clip[i] = sample * (t <= gate ? 1 : Math.max(0, 1 - (t - gate) / 0.05));
      const env = t > len ? release * Math.exp(-(t - len) / 0.025) : t < 0.006 ? t / 0.006 : t < 0.012 ? 1 : color.sustain + (1 - color.sustain) * Math.exp(-(t - 0.012) / color.decay);
      envelopeEnergy += env * env;
    }
    const shelf = Math.max(-24, Math.min(10, 8 * Math.log2(p.cutoff / LIVE_REF.acid.cutoff)));
    const reference = filterVocal(clip, biquad('highshelf', 900, Math.SQRT1_2, shelf, sr));
    const low = filterVocal(reference, biquad('lowpass', 150, Math.SQRT1_2, 0, sr));
    let broadEnergy = 0, lowEnergy = 0;
    for (let i = 0; i < n; i++) { broadEnergy += reference[i] ** 2; lowEnergy += low[i] ** 2; }
    const bound = envelopeEnergy * ((color.body * preamp + color.sub) * color.level) ** 2 / 2;
    const touch = 1.1 * (st.a ? 1.15 : 1) / (st.a ? 1 : 0.82);
    const gain = Math.min(1, 10 ** (1 / 20) * touch * Math.sqrt(Math.min(broadEnergy, lowEnergy) / Math.max(1e-20, bound)));
    known.set(key, gain);
    return gain;
  }

  pocketBassOut(low) {
    if (!low) return this.ch.acid.input;
    if (!this.pocketLow) {
      const input = this.filter('lowshelf', low.cutoff, Math.SQRT1_2), duck = this.filter('lowshelf', low.cutoff, Math.SQRT1_2);
      input.gain.value = low.trim;
      input.connect(duck).connect(this.ch.acid.input);
      this.pocketLow = { input, duck };
    }
    return this.pocketLow.input;
  }

  pocketBass(t, st, sd, holdNext, sliding, color) {
    const c = this.ctx, p = this.state.params.acid, f = midiHz(this.bassMidi(st)), subF = midiHz(this.bassMidi(st, 36, Math.round(p.voice) === 5 ? 43 : 38));
    const drive = p.drive - this.paletteReference().acid.drive, preamp = 2 ** (drive * 2);
    const from = this.monoNote(t, f, sliding), len = (st.ap ? sd * 0.9 : holdNext ? sd * 2 : sd * (0.9 + p.decay * 2)) * color.length, end = t + len + 0.25;
    const cutoff = Math.max(100, Math.min(4000, color.cutoff * (0.55 + p.cutoff / 600)));
    const lp = this.filter('lowpass', cutoff, 0.6), amp = this.gain(0), vel = (st.a ? 1 : 0.82) * (this.noteVel ?? 1) * color.level * this.pocketReferenceGain(st, len, color, preamp);
    lp.frequency.setValueAtTime(cutoff * (st.a ? 1.3 : 1), t);
    lp.frequency.setTargetAtTime(cutoff * 0.45, t + 0.008, color.decay);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(vel, t + 0.006);
    amp.gain.setTargetAtTime(vel * color.sustain, t + 0.012, color.decay);
    amp.gain.setTargetAtTime(0, t + len, 0.025);
    if (drive > 0) {
      const shape = c.createWaveShaper(), wet = driveCurve(drive * 0.7);
      shape.curve = Float32Array.from(wet, (y, i) => { const x = i / (wet.length - 1) * 2 - 1; return x + drive * (y - x); });
      lp.connect(shape).connect(amp);
    } else lp.connect(amp);
    if (color.grit) {
      const sat = c.createWaveShaper(), hp = this.filter('highpass', 280, 0.7), top = this.filter('lowpass', 1600, 0.7);
      sat.curve = driveCurve(0.6);
      lp.connect(sat).connect(hp).connect(top).connect(this.gain(color.grit)).connect(amp);
    }
    amp.connect(this.pocketBassOut(color.lowBand));
    let depth;
    if (color.fm) {
      const mod = c.createOscillator(); depth = this.gain(0);
      mod.frequency.setValueAtTime(from * 3, t);
      if (from !== f) mod.frequency.exponentialRampToValueAtTime(f * 3, t + 0.04);
      depth.gain.setValueAtTime(f * color.fm, t);
      depth.gain.setTargetAtTime(f * 0.03, t + 0.006, color.decay * 0.45);
      mod.connect(depth); this.startSource(mod, t); mod.stop(end);
    }
    for (const [type, level, sub] of [[color.wave || 'triangle', color.body, false], ['sine', color.sub, true]]) {
      const o = c.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(sub ? subF : from, t);
      if (!sub && from !== f) o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
      if (!sub && depth) depth.connect(o.frequency);
      o.connect(this.gain(sub ? level : level * preamp)).connect(sub ? amp : lp);
      this.startSource(o, t); o.stop(end);
    }
    this.mono = { amp, f, end };
  }

  dubEchoOut(t) {
    if (!this.dubEcho) {
      const input = this.gain(1), delay = this.ctx.createDelay(4), fb = this.gain(0.52);
      const hp = this.filter('highpass', 240, 0.5), lp = this.filter('lowpass', 1450, 0.5);
      const spring = this.filter('allpass', 730, 0.5), spring2 = this.filter('allpass', 1750, 0.5);
      const tape = this.ctx.createWaveShaper();
      tape.curve = Float32Array.from({ length: 2049 }, (_, i) => Math.tanh(i / 1024 - 1));
      input.connect(delay).connect(hp).connect(lp).connect(tape).connect(spring).connect(spring2);
      spring2.connect(fb).connect(delay);
      const wet = this.gain(this.state.master.dlyLevel), mid = this.filter('peaking', 300, 0.7);
      const pan = this.ctx.createStereoPanner(); pan.pan.value = -0.3;
      mid.gain.value = this.dubBreakCut || 0;
      spring2.connect(wet).connect(mid).connect(pan).connect(this.duck);
      const spread = this.ctx.createDelay(0.025), right = this.ctx.createStereoPanner();
      spread.delayTime.value = 0.013; right.pan.value = 0.65;
      mid.connect(spread).connect(right).connect(this.duck);
      mid.connect(this.gain(0.18)).connect(this.revIn);
      this.dubEcho = { input, delay, fb, lp, tape, wet, mid };
    }
    const { delay, fb, input } = this.dubEcho;
    delay.delayTime.setValueAtTime(Math.min(3.9, DELAY_TIMES[Math.round(this.state.master.dlyTime)].steps * this.stepDur), t);
    fb.gain.setValueAtTime(Math.max(0, Math.min(0.58, this.state.master.dlyFb)), t);
    return input;
  }

  dubSection(t, active) {
    const changed = this.dubBreakdown !== active;
    this.dubBreakdown = active;
    const voice = Math.round(this.state.params.stab.voice), boost = active && voice === 5 ? 10 ** (2.2 / 20) : 1;
    if (boost !== this.dubBreakBoost) {
      this.dubBreakBoost = boost;
      this.mix.gain.cancelScheduledValues(t);
      if (active) this.mix.gain.setTargetAtTime(boost, t, 0.02);
      else this.mix.gain.setValueAtTime(1, t);
    }
    if (changed) for (const { hp, end } of this.dubPadFilters || []) {
      if (end > t) hp.frequency.setValueAtTime(active && voice === 0 ? 650 : 420, t);
    }
    const cut = active && Math.round(this.state.params.stab.voice) !== 3 ? -4 : 0;
    if (cut === this.dubBreakCut) return;
    this.dubBreakCut = cut;
    const gain = this.dubEcho?.mid.gain;
    if (gain) {
      gain.cancelScheduledValues(t);
      if (active) {
        gain.setTargetAtTime(cut, t, 0.06);
        gain.setValueAtTime(cut, t + 0.4);
      } else gain.setValueAtTime(0, t);
    }
  }

  dubRegister(iv, root) {
    const voice = Math.round(this.state.params.stab.voice);
    if (!this.dubBreakdown || !iv.length || ![0, 2, 5].includes(voice) || (voice === 2 && iv.length === 1)) return root;
    const low = root + Math.min(...iv);
    return root + (voice === 5 ? Math.max(0, 12 * Math.ceil((70 - low) / 12)) : low < 72 ? 12 : 0);
  }

  dubChord(t, v, iv, root, p, out) {
    root = this.dubRegister(iv, root);
    const color = [0, 2, 3, 5].indexOf(Math.round(p.voice)), dec = Math.max(0.07, Math.min(0.22, p.decay * 0.52));
    const end = t + dec * 7 + 0.1, amp = this.gain(0), hp = this.filter('highpass', 210, 0.5);
    const cutoff = Math.min(1500, 510 + p.cutoff * 0.35 + 140 * Math.sin(t * 0.29));
    const lp = this.filter('lowpass', cutoff, 0.55), lp2 = this.filter('lowpass', 1800, 0.5);
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.setTargetAtTime(380 + color * 45, t + 0.035, dec);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(v * 0.65 / Math.sqrt(iv.length), t + 0.016);
    amp.gain.setTargetAtTime(0, t + 0.04, dec);
    amp.gain.setValueAtTime(0, end);
    hp.connect(lp).connect(lp2).connect(amp).connect(out);
    amp.connect(this.gain(p.dly * 1.55 * this.ch.stab.level.gain.value)).connect(this.dubEchoOut(t));
    this.noiseSrc(t, end - t).connect(this.gain(0.007)).connect(hp);
    const pans = this.sidePans([-0.35, 0.35], hp);
    iv.forEach((n, k) => {
      const f = midiHz(root + n), real = new Float32Array(5), imag = new Float32Array(5);
      for (let h = 1; h < imag.length; h++) imag[h] = (h === 1 ? 1 : h === 2 ? [0.32, 0.2, 0.4, 0.25][color] ?? 0.3 : h === 3 ? 0.1 : 0.04) * Math.max(0, Math.min(1, (1700 - f * h) / 500));
      const wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: true });
      for (const side of [-1, 1]) {
        const o = this.ctx.createOscillator(); o.setPeriodicWave(wave);
        o.frequency.value = f; o.detune.value = side * (3 + Math.min(5, p.detune * 0.35));
        o.connect(this.gain(0.5)).connect(pans[side < 0 ? 0 : 1]);
        this.startSource(o, t + k * 0.0008); o.stop(end);
      }
    });
  }

  dubPadOut() {
    if (!this.dubPadBus) {
      this.dubPadBus = this.gain(this.state.params.stab.level);
      this.dubPadBus.connect(this.duck);
      this.dubPadBus.connect(this.gain(0.75)).connect(this.ch.stab.rev);
    }
    return this.dubPadBus;
  }

  dubPadLevel(iv, root, t) {
    const p = this.state.params.stab, color = [0, 2, 3, 5].indexOf(Math.round(p.voice));
    const response = (f, hz, q, high = false) => {
      const r2 = (f / hz) ** 2;
      return (high ? r2 * r2 : 1) / ((1 - r2) ** 2 + r2 / (q * q));
    };
    const cutoff = Math.min(1500, 510 + p.cutoff * 0.35 + 140 * Math.sin(t * 0.29)) * 0.65 + (380 + color * 45) * 0.35;
    let chord = 0, pad = 0;
    for (const n of iv) {
      const f = midiHz(root + n);
      for (let h = 1; h <= 11; h++) {
        const hz = f * h;
        if (h < 5) {
          const partial = (h === 1 ? 1 : h === 2 ? [0.32, 0.2, 0.4, 0.25][color] ?? 0.3 : h === 3 ? 0.1 : 0.04) * Math.max(0, Math.min(1, (1700 - hz) / 500));
          chord += partial ** 2 * response(hz, 210, 0.5, true) * response(hz, cutoff, 0.55) * response(hz, 1800, 0.5);
        }
        if (h % 2) pad += (8 / (Math.PI * Math.PI * h * h)) ** 2 * response(hz, 420, 0.5, true) * response(hz, 850, 0.5);
      }
    }
    const density = this.stabPat ? this.stabPat.filter(Boolean).length / ((this.stabLen || 16) * this.stepDur) : 1;
    const register = iv.reduce((sum, n) => sum + midiHz(root + n), 0) / iv.length;
    return Math.max(0.035, Math.min(0.3, 0.062 * Math.sqrt(chord / Math.max(pad, 1e-8)) * Math.sqrt(Math.max(0.5, Math.min(4, density))) * Math.sqrt(330 / Math.max(110, register))));
  }

  dubPad(t, v, iv, root) {
    if (!iv.length) return;
    if (this.dubPadAt != null && t - this.dubPadAt < this.stepDur * 48) return;
    this.dubPadAt = t;
    root += Math.min(12, this.dubRegister(iv, root) - root);
    const hold = this.stepDur * 24, end = t + hold + 5, amp = this.gain(0);
    const hp = this.filter('highpass', this.dubBreakdown && Math.round(this.state.params.stab.voice) === 0 ? 650 : 420, 0.5), lp = this.filter('lowpass', 850, 0.5);
    this.dubPadFilters = (this.dubPadFilters || []).filter((p) => p.end > t);
    this.dubPadFilters.push({ hp, end });
    lp.frequency.setValueAtTime(650, t); lp.frequency.linearRampToValueAtTime(1100, t + hold); lp.frequency.linearRampToValueAtTime(600, end);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(this.dubPadLevel(iv, root, t) * v / Math.sqrt(iv.length), t + 1.4);
    amp.gain.setTargetAtTime(0, t + hold, 1); amp.gain.setValueAtTime(0, end);
    hp.connect(lp).connect(amp).connect(this.dubPadOut());
    const pans = this.sidePans([-0.85, 0.85], hp);
    iv.forEach(n => {
      for (const side of [-1, 1]) {
        const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = midiHz(root + n);
        o.detune.setValueAtTime(side * 5, t); o.detune.linearRampToValueAtTime(-side * 3, end);
        o.connect(pans[side < 0 ? 0 : 1]); this.startSource(o, t); o.stop(end);
      }
    });
  }

  // Slow-swelling ensemble: three detuned saws per note, filter opens with ENV, DECAY sets release.
  pad(t, v, iv, root, p, out) {
    const c = this.ctx, atk = 0.04 + p.env * 0.9, hold = Math.max(this.stepDur * 4, p.decay * 1.2), end = t + atk + hold + p.decay * 2 + 0.2;
    const festival = this.playbackStyle === 'trap' && Math.round(p.voice) === 2;
    const lp = this.filter('lowpass', p.cutoff * 0.5, Math.max(0.5, p.reso * 0.4));
    lp.frequency.setValueAtTime(p.cutoff * 0.4, t);
    lp.frequency.linearRampToValueAtTime(p.cutoff, t + atk);
    const amp = this.gain(0), peak = (v * 0.3) / Math.sqrt(iv.length);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(peak, t + atk);
    amp.gain.setTargetAtTime(0, t + atk + hold, Math.max(0.1, p.decay * 0.6));
    const pans = this.sidePans(this.hardTechno ? [-0.9, 0, 0.9] : [-0.7, 0, 0.7], lp);
    // A smooth style's voices drift slowly (the outer two by 7 cents, the centre by 4), as a string ensemble's chorus does, so no partial holds one exact pitch.
    const drift = this.smoothOn ? [[0.31, 7], [0.19, 4], [0.47, 7]].map(([hz, cents]) => { const l = c.createOscillator(), g = this.gain(cents); l.frequency.value = hz; l.connect(g); this.startSource(l, t); l.stop(end); return g; }) : null;
    const waves = this.smoothOn ? this.chordSaws(iv.map((n) => root + n)) : null;
    iv.forEach((n, k) => {
      [-1, 0, 1].forEach((side) => {
        const o = c.createOscillator();
        if (waves) o.setPeriodicWave(waves[k]); else o.type = 'sawtooth';
        o.frequency.value = midiHz(root + n); o.detune.value = side * (4 + p.detune);
        if (this.hardTechno) {
          o.detune.setValueAtTime(240 + side * (4 + p.detune) * 3, t);
          o.detune.setTargetAtTime(side * (4 + p.detune) * 3, t + 0.008, 0.014);
        }
        if (drift) drift[side + 1].connect(o.detune);
        if (festival) {
          const motion = c.createOscillator(), depth = this.gain(8 + 4 * hash(root + n, side + 97));
          motion.frequency.value = 0.37 + 0.41 * hash(root + n, side + 53);
          motion.connect(depth).connect(o.detune);
          this.startSource(motion, t); motion.stop(end);
        }
        o.connect(pans[side + 1]); this.startSource(o, t); o.stop(end);
      });
    });
    // A smooth style's pad rolls its saw partials off at 24 dB/oct above about 1.7 kHz, and takes its air from a breath of noise between 5 and 9 kHz.
    if (this.smoothOn) {
      const lp2 = this.filter('lowpass', p.cutoff * 1.3, 0.5), hp = this.filter('highpass', 5000, 0.5), airTop = this.filter('lowpass', 9000, 0.5);
      lp.connect(lp2).connect(amp);
      const air = this.noiseSrc(t, end - t); air.loop = true;
      air.connect(hp).connect(airTop).connect(this.gain(0.05)).connect(amp);
    } else lp.connect(amp);
    if (this.playbackStyle === 'trap') amp.connect(this.filter('highpass', 180, 0.5)).connect(out);
    else amp.connect(out);
  }

  // Drawbar organ with key click and a rotary-style vibrato; DETUNE sets rotor depth.
  // UK Garage plays the recorded tonewheel organ (CC0); the other styles keep their drawbar synth.
  organ(t, v, iv, root, p, out) {
    if (RECORDED_ORGAN.has(this.playbackStyle)) return this.recorded('org', 'synthOrgan', t, v, iv, root, p, out);
    return this.synthOrgan(t, v, iv, root, p, out);
  }
  synthOrgan(t, v, iv, root, p, out) {
    const c = this.ctx, gate = Math.max(0.08, p.decay * 0.9), end = t + gate + 0.25;
    const damped = this.state.artist?.style === 'reggaeton' && Math.round(p.voice) === 3;
    const lp = this.filter('lowpass', Math.min(12000, p.cutoff * 3), 0.6);
    const amp = this.gain(0), peak = (v * 0.24) / Math.sqrt(iv.length);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.006);
    amp.gain.setTargetAtTime(0, t + gate, 0.05);
    const lfo = c.createOscillator(); lfo.frequency.value = 6.2;
    const vib = this.gain(p.detune * 0.4); lfo.connect(vib);
    for (const n of iv) {
      const f = midiHz(root + n);
      for (const [mul, lvl] of [[0.5, 0.6], [1, 1], [2, 0.55], [3, 0.3]]) {
        const roll = damped ? Math.max(0, Math.min(1, (1800 - f * mul) / 700)) ** 2 : 1;
        if (!roll) continue;
        const o = c.createOscillator(); o.frequency.value = f * mul; vib.connect(o.detune);
        const g = this.gain(lvl * roll); o.connect(g).connect(lp); this.startSource(o, t); o.stop(end);
      }
    }
    const ck = this.noiseSrc(t, 0.012), cbp = this.filter('bandpass', 2400, 0.8), cg = this.gain(0);
    this.adEnv(cg.gain, t, v * 0.12, 0.0005, 0.006);
    ck.connect(cbp).connect(cg).connect(out);
    lp.connect(amp).connect(out);
    this.startSource(lfo, t); lfo.stop(end);
  }

  // Brass section: saws scooping into pitch while the filter blooms; ENV sets the blare.
  // Recorded chord instruments (CC0): nearest sample per chord note, repitched; the synth voice covers loading.
  recorded(kind, fallback, t, v, iv, root, p, out) {
    const R = BAND_PLAY[kind], base = R.set || kind;
    let set = this.rec(base);
    if (!set) { loadBand(base); return this[fallback](t, v, iv, root, p, out); }
    if (out === this.ch.stab.input) out = this.ch.stab.band;
    if (kind === 'gtr' && this.playbackStyle === 'reggaeton') out = this.bodyFor(out, [2960, 6, -12]);
    const chord = R.grip && iv.length > 1, live = chord && this.step != null;
    const pk = live ? pocketOf(this.state.master) : null, hand = live ? guitarHand(kind, pk?.name, this.wide) : null;
    // Two takes of the rhythm part panned hard left and right; a pedal or amp effect per player, then the amp.
    let outs = hand?.double ? [this.panFor(out, -1, true), this.panFor(out, 1, false)] : [out];
    if (R.body) outs = outs.map((o) => this.bodyFor(o, R.body));
    if (hand?.fx === 'chorus') outs = outs.map((o) => this.chorusFor(o));
    if (hand?.fx === 'trem') outs = outs.map((o) => this.tremFor(o, t, this.wide ? 0 : 0.3));
    if (R.amp) outs = outs.map((o) => this.ampFor(o));
    const palm = R.amp && this.palm;
    // A palm mute plays the recorded staccato (it damps itself); until that loads, the open note is cut short and darkened.
    const muted = palm && MUTE_LAYER[base] && this.rec(MUTE_LAYER[base]);
    if (muted) set = muted;
    const tone = Math.max(-6, Math.min(3, 3 * Math.log2(p.cutoff / 1500))) - (palm ? (muted ? 1.5 : 4) : 0);
    const max = (this.stripMode && R.pedal) || R.max || Infinity;
    const dur = palm ? (muted ? Math.min(0.45, this.stepDur * 3) : Math.min(0.14, this.stepDur * 1.2)) : Math.min(max, Math.max(R.hold ? this.stepDur * 4 : R.min, p.decay * R.len * (this.stripMode && R.pedal ? 1.6 : 1)));
    const grip = chord ? guitarGrip(root, iv, this.lastGrip) : iv.map((n) => root + n), pedal = this.pedalFor(kind, t, iv, root);
    const same = chord && this.lastGrip && grip.join() === this.lastGrip.join();
    const gap = live ? this.stabGap() : 0;
    if (hand?.play === 'pick' || hand?.play === 'roll') return this.pickGrip(kind, set, t, v, grip, same, gap, dur, outs[0], tone, hand.play === 'roll', pk);
    // The strumming hand keeps moving at the part's subdivision: down on the beat, up on the "and"
    // (on every other 16th when the part has 16th hits). Upstrokes are quicker and catch fewer strings.
    const fine = live && this.stabPat?.some((x, i) => x && i % 2);
    const up = chord ? (!live ? (this.stroke = !this.stroke) === false : fine ? this.step % 2 === 1 : this.step % 4 !== 0) : hash(t, 21) > 0.5;
    const articulation = Math.max(0, Math.min(1, p.env ?? 0.5));
    const strum = R.strum * (0.45 + articulation * 1.8) * (live ? (up ? 0.7 : 1) * (0.8 + 0.4 * hash(t, 25)) : 1), even = R.even ?? 1;
    const beat = live ? (this.step % 16 === 0 ? 1.08 : this.step % 4 === 0 ? 1 : up ? 0.86 : 0.93) : 1;
    // A chop is a short stab on the top strings; an upstroke only catches the top strings, a little softer;
    // an offbeat downstroke sometimes misses the low string.
    let notes = hand?.play === 'chop' ? grip.slice(beat > 1 ? -4 : -3) : chord && up && grip.length > 3 ? grip.slice(-3) : grip;
    if (hand?.play === 'strum' && !up && this.step % 4 && notes.length > 4 && hash(t, 26) < 0.5) notes = notes.slice(1);
    const ring = hand?.play === 'chop' ? Math.min(dur, this.stepDur * Math.min(2, gap || 2) * 0.8) : dur, lift = chord && up ? 0.8 : 1;
    // A strummer starts the stroke a little early so the middle of the chord, not its last string, lands on the beat.
    const lead = chord ? Math.min((notes.length - 1) * strum * 0.5, Math.max(0, t - this.ctx.currentTime)) : 0;
    // A struck string stops its last note; on an upstroke of the same grip the low strings ring on.
    // Moving to a new grip, the fretting hand slides over the wound strings: a short squeak, now and then.
    if (chord && this.stripMode && !same && this.lastGrip && !palm && hash(t, 25) < 0.45) this.squeak(t - lead - 0.05, v * R.gain, outs[0]);
    if (chord) {
      const keep = [];
      for (const h of this.gripHeld || []) {
        if (same && !notes.includes(h.m) && h.end > t) { keep.push(h); continue; }
        damp(h, t - lead);
      }
      this.gripHeld = keep; this.lastGrip = grip;
    }
    outs.forEach((o, d) => {
      // The second take: a few ms late, a hair out of tune, its own stroke speed.
      const late = d ? 0.008 + 0.01 * hash(t, 27) : 0, cents = d ? (hash(t, 28) - 0.5) * 0.08 : 0, sp = d ? strum * (0.85 + 0.3 * hash(t, 29)) : strum;
      // The second take leaves out the root (the first take carries the low end).
      (d && notes.length > 2 ? notes.slice(1) : notes).forEach((m, k, take) => {
        const order = up ? take.length - 1 - k : k + notes.length - take.length;
        const at = t - lead + late + order * sp + (hash(t * 3 + k + d * 17, 22) - 0.5) * (0.003 + articulation * 0.006) * even;
        const sweep = notes.length > 1 ? order / (notes.length - 1) - 0.5 : 0;
        const accent = (1 + sweep * (articulation - 0.5) * 0.35) * beat;
        const lvl = ((palm ? 0.8 : 1) * lift * v * R.gain * accent * (1 - 0.15 * even + 0.3 * even * hash(t + k + d * 5, 23))) / Math.sqrt(grip.length);
        // A single-note fill rings briefly and is stopped by the next chord like any other string.
        const len = R.grip && !chord ? Math.min(ring, 0.9) : ring;
        const h = this.recordedNote(set, at, lvl, m + R.shift + cents, len, o, d ? 0 : tone, kind, v);
        if (R.grip && h) { h.m = m; h.at = at; h.end = at + len; (this.gripHeld ||= []).push(h); }
        if (pedal && h) { h.end ??= at + len; pedal.push(h); }
      });
    });
    if (hand?.play === 'chop') this.scratch(kind, base, t, v, grip.slice(-3), gap, outs, pk);
  }

  // A melody played on the chord player's own guitar is fretted on a string the chord was ringing: chord
  // strings that rub against it stop (and are not picked while it sounds).
  leadOver(m, t, ring, R) {
    while (m > R.hi + 0.5) m -= 12;
    while (m < R.lo - 0.5) m += 12;
    for (const h of this.gripHeld || []) {
      if (h.m < 0 || h.end <= t || h.at >= t + ring || !rubs(h.m, m)) continue;
      damp(h, t); h.end = Math.max(t, h.at);
    }
    this.leadHeld = [...(this.leadHeld || []).filter((x) => x.end > t), { m, at: t, end: t + ring }];
  }
  rubsLead(m, at) { return (this.leadHeld || []).some((x) => x.at <= at && x.end > at && rubs(x.m, m)); }

  // Muting the part stops the strings it already scheduled (picks, scratches, ringing chords).
  quietGrip(t) { for (const h of this.gripHeld || []) damp(h, t); this.gripHeld = []; }

  // Steps from this chord hit to the next one in the part (16 if it is the only one in the bar).
  stabGap() {
    const pat = this.stabPat, n = this.stabLen || pat?.length || 16;
    if (!pat) return 0;
    for (let k = 1; k < 16; k++) if (pat[(this.step + k) % n]) return k;
    return 16;
  }

  // The step's own offset from the grid (swing and the pocket's push), so notes between hits sit like the hits.
  stepLate(pk, s) { return swingLate(this.state, s, this.stepDur) + pocketLate(pk, 'stab', s % 16); }

  // Fingerstyle between chord hits. Guitar: Travis picking, the thumb alternating bass strings on the beats
  // (pinched with the top string on 1 and 3) and the fingers on the top strings on the offbeat 8ths.
  // Banjo: a forward roll, thumb-index-middle across every 16th. Each string rings until it is picked again.
  // Fingertips are rounder and quieter than a pick: the thumb leads, the fingers sit under it and now and then
  // rest, and a finger never sounds a string that rubs against the melody note the same hand is holding.
  pickGrip(kind, set, t, v, grip, same, gap, dur, out, tone, roll, pk) {
    const R = BAND_PLAY[kind], n = grip.length, sd = this.stepDur, s0 = this.step, F = !roll && R.finger;
    if (F) dur = Math.min(dur, F[2]);
    const held = (this.gripHeld || []).filter((h) => h.end > t);
    if (!same) { for (const h of held) damp(h, t); held.length = 0; }
    this.gripHeld = held; this.lastGrip = grip;
    const bass = [0, n >= 5 ? 2 : Math.min(1, n - 1)], top = [n - 1, n - 2, n - 1, n - 3].map((i) => Math.max(bass[1] + 1, i) % n);
    for (let k = 0; k < Math.min(gap || 4, 16); k++) {
      const s = s0 + k, i = s % 16;
      const play = roll ? [[[0, n - 2, n - 1, n - 3, n - 2, n - 1, n - 3, n - 1][i % 8], i % 4 ? 0.75 : 1]]
        : i % 4 === 0 ? [[bass[(i >> 2) % 2], i % 8 ? 0.85 : 1], ...(i % 8 === 0 ? [[n - 1, F ? 0.6 : 0.7]] : [])]
          : i % 4 === 2 ? (F && k && hash(s, 34) < 0.22 ? [] : [[top[(i >> 2) % 4], F ? 0.62 : 0.78]])
            : k === 0 ? [[0, 0.9], [n - 1, 0.7]] : [];
      const at0 = t + k * sd + this.stepLate(pk, s) - this.stepLate(pk, s0);
      for (const [j, role] of play) {
        const m = grip[Math.max(0, j)], at = at0 + (hash(s * 1.3 + j, 32) - 0.5) * 0.014;
        if (F && role < 0.8 && this.rubsLead(m, at)) continue;
        for (const h of held) if (h.m === m && h.end > at) { damp(h, at); h.end = at; }
        const vel = v * role * (0.9 + 0.2 * hash(s + j, 33)), lvl = vel * R.gain * 0.7;
        const h = this.recordedNote(set, at, lvl, m + R.shift, dur, out, tone, kind, vel, !!F);
        if (h) { h.m = m; h.at = at; h.end = at + dur; held.push(h); }
      }
    }
  }

  // Funk scratches: the strumming hand keeps going on the empty 16ths with the strings muted, a dead "chk".
  scratch(kind, base, t, v, top, gap, outs, pk) {
    const R = BAND_PLAY[kind], set = MUTE_LAYER[base] && this.rec(MUTE_LAYER[base]);
    if (!set) return;
    const odds = pk?.name === 'AFRO' ? 0.6 : 0.45, s0 = this.step;
    // One muted string stands in for the dead strum: a scratch is noise, not pitch, and keeps the per-hit node count down.
    // Only on the "e" and "a" 16ths, so it never flams against a fill or lick on the 8ths.
    for (let k = 1; k < Math.min(gap, 8); k++) {
      const s = s0 + k;
      if (s % 2 === 0 || hash(s, 30) >= odds) continue;
      const m = top[s % 2 ? top.length - 1 : 0] + R.shift, at = t + k * this.stepDur + this.stepLate(pk, s) - this.stepLate(pk, s0);
      let i = 0;
      for (let j = 1; j < set.length; j++) if (Math.abs(set[j][0] - m) < Math.abs(set[i][0] - m)) i = j;
      const [c, buf] = set[i];
      const h = this.playBuf(buf, at, v * R.gain * 0.2 * (0.8 + 0.4 * hash(s, 31)), outs[s % outs.length], Math.pow(2, (m - c) / 12), 0.05, { lp: 2400, release: 0.02 });
      if (h) { h.m = -1; h.at = at; h.end = at + 0.07; (this.gripHeld ||= []).push(h); }
    }
  }

  // A double-tracked part's seat, after its amp. Each take is trimmed (distortion evens out the level) and
  // scooped at 350 Hz, where two takes pile up. The first take keeps the low end in the middle (a
  // Linkwitz-Riley split, so the bands sum flat); the second has none, so the lows never comb or smear.
  panFor(dest, pan, lows) {
    const pans = (this.pans ||= new Map()), key = `${pan}:${lows}`;
    let m = pans.get(dest);
    if (!m) pans.set(dest, (m = new Map()));
    if (!m.has(key)) {
      const inp = this.filter('peaking', 350, 1), p = this.ctx.createStereoPanner(), trim = this.gain(0.5);
      inp.gain.value = -3; inp.connect(trim);
      p.pan.value = pan; p.connect(dest);
      if (lows) trim.connect(this.filter('lowpass', 250)).connect(this.filter('lowpass', 250)).connect(dest);
      trim.connect(this.filter('highpass', 250)).connect(this.filter('highpass', 250)).connect(p);
      m.set(key, inp);
    }
    return m.get(key);
  }

  // Reuse a player's body EQ across notes without sharing it between instruments on the same strip.
  bodyFor(dest, [f, q, db]) {
    const all = (this.bodies ||= new Map());
    if (!all.has(dest)) all.set(dest, new Map());
    const tones = all.get(dest), key = `${f}|${q}|${db}`;
    if (!tones.has(key)) {
      const eq = this.filter('peaking', f, q);
      eq.gain.value = db; eq.connect(dest); tones.set(key, eq);
    }
    return tones.get(key);
  }

  // A chorus pedal for clean funk and soul guitar: two slowly swept short delays spread left and right of the dry signal.
  chorusFor(dest) {
    const all = (this.choruses ||= new Map());
    if (all.has(dest)) return all.get(dest);
    const inp = this.gain(1), lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.8;
    inp.connect(this.gain(0.7)).connect(dest);
    for (const side of [-1, 1]) {
      const d = this.ctx.createDelay(0.05), depth = this.gain(0.0022 * side), pan = this.ctx.createStereoPanner();
      d.delayTime.value = 0.011; pan.pan.value = 0.6 * side;
      lfo.connect(depth).connect(d.delayTime);
      inp.connect(d).connect(this.gain(0.25)).connect(pan).connect(dest);
    }
    this.startContinuous(lfo);
    all.set(dest, inp);
    return inp;
  }

  // An amp's tremolo, pulsing in 8ths: the twang guitar's verse sound (depth 0 opens it up for the chorus).
  tremFor(dest, t, depth) {
    const all = (this.trems ||= new Map());
    let tr = all.get(dest);
    if (!tr) {
      const inp = this.gain(1), lfo = this.ctx.createOscillator(), amt = this.gain(0);
      inp.connect(dest); inp.gain.value = 1;
      lfo.connect(amt).connect(inp.gain); this.startContinuous(lfo);
      all.set(dest, (tr = { inp, lfo, amt }));
    }
    tr.lfo.frequency.setValueAtTime(1 / (2 * this.stepDur), t);
    tr.amt.gain.setValueAtTime(depth / 2, t);
    tr.inp.gain.setValueAtTime(1 - depth / 2, t);
    return tr.inp;
  }

  // A pianist in a band holds the pedal through a chord and changes it on the next one: a new chord damps the
  // last within ~80 ms, so notes can ring their full length without blurring into the change.
  pedalFor(kind, t, iv, root) {
    if (!this.stripMode || !BAND_PLAY[kind]?.pedal) return null;
    const key = iv.map((n) => (root + n) % 12).sort((a, b) => a - b).join();
    if (key !== this.pedalKey) {
      for (const h of this.pedalHeld || []) { h.g.gain.cancelScheduledValues(t); h.g.gain.setTargetAtTime(0, t, 0.03); }
      this.pedalHeld = []; this.pedalKey = key;
    } else if (this.pedalHeld) this.pedalHeld = this.pedalHeld.filter((h) => (h.stop ?? h.end) > t);
    return (this.pedalHeld ||= []);
  }

  // A fret-hand squeak: band-passed noise swept up the wound strings, ~25-35 dB under the strum.
  squeak(t, v, out) {
    if (t <= this.ctx.currentTime) return;
    const len = 0.06 + hash(t, 26) * 0.05, n = this.noiseSrc(t, len), bp = this.filter('bandpass', 1500 + hash(t, 27) * 900, 5), g = this.gain(0);
    bp.frequency.setValueAtTime(bp.frequency.value, t); bp.frequency.exponentialRampToValueAtTime(bp.frequency.value * 1.9, t + len);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(Math.min(0.2, 0.012 * v), t + len * 0.4); g.gain.linearRampToValueAtTime(0, t + len);
    n.connect(bp).connect(g).connect(out);
  }

  // Kept in the register the instrument was played in; every note lands a little differently and softer
  // notes are darker, the way hammers and plectrums behave. Released through a damper, not a gate.
  recordedNote(set, t, level, m, dur, out, tone = 0, kind = null, vel = 1, finger = false) {
    if (this.playbackStyle === 'rnb' && kind === 'jazz') level *= dbGain(-10);
    const R = BAND_PLAY[kind], F = finger && R?.finger;
    if (R) { while (m > R.hi + 0.5) m -= 12; while (m < R.lo - 0.5) m += 12; }
    if (out === this.ch.stab.input) out = this.ch.stab.band;
    const touch = 1 - 0.2 * (R?.even ?? 1) + 0.4 * (R?.even ?? 1) * hash(t * 7 + m, 24), hv = Math.max(0.25, Math.min(1.2, vel * touch));
    // Soft touches play the softly struck or plucked recording: a different tone, not just a quieter one.
    if (hv < (R?.softBelow ?? 0) && this.rec(SOFT_LAYER[kind])) set = this.rec(SOFT_LAYER[kind]);
    let i = 0;
    for (let j = 1; j < set.length; j++) if (Math.abs(set[j][0] - m) < Math.abs(set[i][0] - m)) i = j;
    let [c, buf] = set[i];
    // Round robin: every other hit on a string plays the second take of that note.
    const take = TAKES[bandName(set)], alt = take && this.rec(take);
    if (alt?.[i]) {
      const rr = (this.takeTurn ||= new WeakMap()), n = rr.get(buf) || 0;
      rr.set(buf, n + 1);
      if (n % 2) [c, buf] = alt[i];
    }
    return this.playBuf(buf, t, level * touch, out, Math.pow(2, (m - c) / 12), dur, {
      shelves: [[3000, tone]], peaks: [...(R?.peak ? [R.peak] : []), ...(kind === 'str' ? HIPHOP[this.state.artist?.style]?.strEq ?? [] : []), ...(jazzStyle(this.state, this.playingPattern) === 'bossa' && kind === 'jazz' ? jazzNotches(kind, c, Math.pow(2, (m - c) / 12)) : [])], lp: R ? R.lp * (F ? F[1] : 1) * (0.4 + 0.6 * hv) : 0, lpFrom: F ? F[0] : R?.soft ?? 0, fade: R?.fade ?? 0, release: R ? R.rel : 0.05, vib: R?.vib || 0,
    });
  }
  // A guitar amp for the DRIVE GTR: tightened lows into an asymmetric tube-style clipper, then a 4x12 cab
  // (body bump, scooped fizz, steep top roll-off). One amp per destination, shared by every string.
  // Slapback: one short repeat, no feedback, darker than the dry note.
  slapFor(dest) {
    const slaps = (this.slaps ||= new Map());
    if (slaps.has(dest)) return slaps.get(dest);
    const inp = this.gain(1), d = this.ctx.createDelay(0.5), g = this.gain(0.3);
    d.delayTime.value = 0.11;
    inp.connect(dest);
    inp.connect(this.filter('highpass', 350, 0.7)).connect(this.filter('lowpass', 3500, 0.7)).connect(d).connect(g).connect(dest);
    slaps.set(dest, inp);
    return inp;
  }

  ampFor(dest, lead = false) {
    if (dest === this.ch.stab.input) dest = this.ch.stab.band;
    const amps = (this.amps ||= new Map()), key = dest;
    const known = lead ? this.leadAmps?.get(dest) : amps.get(dest);
    if (known) return known;
    // The lead channel: less gain, a vocal mid push and a darker cab, so single notes sing instead of buzz.
    const inp = this.gain(1), hp = this.filter('highpass', lead ? 220 : 120, 0.7), mid = this.filter('peaking', lead ? 1100 : 850, 0.9);
    mid.gain.value = lead ? 7 : 5;
    const sh = this.ctx.createWaveShaper();
    sh.curve = AMP_CURVE; sh.oversample = '4x';
    const body = this.filter('peaking', 140, 1.1), fizz = this.filter('peaking', 3200, 1.4), cab = this.filter('lowpass', 4300, 0.9), cab2 = this.filter('lowpass', 6500, 0.6);
    body.gain.value = lead ? 0 : 3; fizz.gain.value = lead ? -9 : -5;
    if (lead) cab.frequency.value = 3400;
    inp.connect(hp).connect(mid).connect(this.gain(lead ? 1.4 : 7)).connect(sh).connect(body).connect(fizz).connect(cab).connect(cab2).connect(this.gain(lead ? 0.42 : 0.16)).connect(dest);
    if (lead) (this.leadAmps ||= new Map()).set(dest, inp); else amps.set(key, inp);
    return inp;
  }

  // Electric bass guitar (fingerstyle, recorded), with the same tone and drive knobs as the upright.
  ebass(t, st, sd, holdNext) {
    const set = this.rec('ebass');
    if (!set) { loadBand('ebass'); return this.bass(t, st, sd, holdNext); }
    const p = this.state.params.acid, m = this.bassMidi(st);
    let len = st.ap ? sd * 0.9 : holdNext ? sd * 2 : sd * (0.9 + p.decay * 2);
    // A band's bassist holds each note into the next one (up to two beats) instead of stopping short.
    if (this.stripMode && this.acidGap && !st.ap) len = Math.max(len, (this.acidGapSeconds ?? Math.min(8, this.acidGap) * sd) - 0.025);
    this.acidGap = 0;
    let [c, buf] = set[0];
    for (const [cm, b] of set) if (Math.abs(cm - m) < Math.abs(c - m)) [c, buf] = [cm, b];
    const ref = LIVE_REF.acid, fx = { shelves: [[900, Math.max(-24, Math.min(10, 8 * Math.log2(p.cutoff / ref.cutoff)))]], drive: Math.max(0, p.drive - ref.drive) * 1.4, release: 0.05 };
    // A harder pluck is brighter: the finger digs in and the string's upper partials speak.
    if (this.stripMode) { const vel = Math.min(1.2, (this.noteVel ?? 1) * (st.a ? 1.15 : 1)); fx.lp = 1400 + 3600 * vel * vel; }
    const soul = this.state.artist?.style === 'neosoul';
    if (soul) Object.assign(fx, { lp: 1100, lpTo: 180, lpStages: 2, peaks: [[750, 0.7, 15]], fade: 0.006, release: 0.06 });
    this.playBuf(buf, t, 1.1 * (st.a ? 1.15 : 1) * (this.noteVel ?? 1) * (soul ? 0.85 : 1) * dbGain(jazzStyle(this.state, this.playingPattern) === 'jazzfunk' ? JAZZ_MIX.jazzfunk.bass : 0), this.ch.acid.input, Math.pow(2, (m - c) / 12) * (1 + (hash(t * 1000, 5) - 0.5) * 0.002), len, fx);
    if (soul) {
      const sub = this.ctx.createOscillator(), g = this.gain(0), v = 0.035 * (st.a ? 1.15 : 1) * (this.noteVel ?? 1);
      sub.frequency.value = midiHz(this.bassMidi(st, 36, 38));
      g.gain.setValueAtTime(EPS, t);
      g.gain.linearRampToValueAtTime(v, t + 0.01);
      g.gain.setTargetAtTime(v * 0.55, t + 0.04, 0.12);
      g.gain.setTargetAtTime(0, t + len, 0.04);
      sub.connect(g).connect(this.ch.acid.input);
      this.startSource(sub, t); sub.stop(t + len + 0.4);
    }
  }

  // Crash and toms of the recorded kit, for the band pockets. Without the samples the open hat and snare stand in.
  crash(t, v) {
    const kit = this.rec('kitx');
    if (!kit) { loadKitExtra(); return this.trigger('oh', t, v * 0.8); }
    this.playBuf(kit[v > 0.8 ? 'crash_v3' : 'crash_v2'], t, 0.42 * v, this.ch.oh.input, 1 + (hash(t, 31) - 0.5) * 0.01, 2.8, { release: 0.4 });
  }
  tom(t, v, high) {
    const kit = this.rec('kitx');
    if (!kit) { loadKitExtra(); return this.trigger('snare', t, v); }
    this.playBuf(kit[`${high ? 'htom' : 'ltom'}_v${v > 0.7 ? 14 : 8}`], t, 0.55 * v, this.ch.snare.input, 1, 1.2, { release: 0.15 });
  }

  // One section bus per orchestra part: seat panning, then dry into the mix plus the room and the hall.
  orchBus(part) {
    this.orchBuses ||= {};
    if (this.orchBuses[part]) return this.orchBuses[part];
    const O = ORCH[part], g = this.gain(1), pan = this.ctx.createStereoPanner();
    pan.pan.value = O.pan;
    (O.hp ? g.connect(this.filter('highpass', O.hp, 0.6)) : g).connect(pan);
    pan.connect(this.mix); pan.connect(this.gain(0.4)).connect(this.bandIn); pan.connect(this.gain(0.24)).connect(this.revIn);
    return (this.orchBuses[part] = g);
  }
  orchSet(part, soft = false) {
    const O = ORCH[part], kinds = soft && O.soft ? O.soft : O.kinds, sets = kinds.map((k) => bandKit(k));
    if (sets.some((x) => !x)) { kinds.forEach((k) => loadBand(k)); return null; }
    return sets.flat();
  }
  orchLevel(part) {
    const sec = PART_SECTION[part];
    return this.state.orchMute?.[sec] ? 0 : this.state.orch?.[sec] ?? 1;
  }
  orch(part, t, m, dur, vel) {
    const O = ORCH[part], lvl = this.orchLevel(part);
    if (!O || lvl <= 0.001) return null;
    while (m > O.hi) m -= 12; while (m < O.lo) m += 12;
    const roll = part === 'timp' && dur > 1.2;
    const set = roll ? bandKit('timproll') : this.orchSet(part, part === 'pno' && vel < 0.55);
    if (!set) { if (roll) loadBand('timproll'); return part === 'pno' && vel < 0.55 ? this.orch(part, t, m, dur, 0.56) : null; }
    let [c, buf] = set[0];
    for (const [cm, b] of set) if (Math.abs(cm - m) < Math.abs(c - m)) [c, buf] = [cm, b];
    // Dynamics change colour as well as level: a pianissimo section is darker than a fortissimo one.
    const touch = 0.92 + 0.16 * hash(t * 7 + m, 31), level = O.gain * lvl * Math.pow(vel, 1.5) * touch * 0.55;
    // Short bowed notes are played détaché: skip the slow sustain swell and lift the bow quickly.
    const short = O.loop && dur > 0 && dur < 0.32;
    return this.playBuf(buf, t + (O.off || 0) * hash(t, m), level, this.orchBus(part), Math.pow(2, (m - c + (O.det || 0) / 100) / 12), dur, {
      lp: O.lp * (0.35 + 0.65 * vel), release: short ? 0.06 : O.rel, loop: O.loop, offset: short ? 0.035 : 0, ringOut: true,
    });
  }
  // Played by hand (screen, keyboard, MIDI): sounds now and rings until released.
  pianoDown(m, vel = 0.7) {
    const t = this.ctx.currentTime + 0.005, h = this.orch('pno', t, m, 0, vel);
    if (!h) { loadBand('pianoext'); loadBand('pianoextsoft'); loadBand('piano'); return null; }
    return h;
  }
  pianoUp(h, damp = 0.25) {
    if (!h) return;
    const t = this.ctx.currentTime;
    h.g.gain.cancelScheduledValues(t); h.g.gain.setValueAtTime(h.g.gain.value, t); h.g.gain.setTargetAtTime(0, t, damp);
    try { h.s.stop(t + damp * 8); } catch {}
  }
  piano(...a) { return this.recorded('piano', 'keys', ...a); }
  // A band's second layer for this section: cello on the root, viola on a middle chord tone, violins on the top
  // an octave up, each bowed through the bar; or the piano doubling the chords on beats 1 and 3.
  bandLayer(t, sec, i16, style) {
    const L = BAND_LAYER[style]?.[sec], fader = this.state.params.stab.level ?? 1;
    if (!L || fader <= 0.001) return;
    // The layer rides the CHORDS fader: its level goes as vel^1.5 (orch), so vel scales by fader^(2/3).
    const { root, notes } = stabNotes(this.state, this.harm), sd = this.stepDur, v = L.v * fader ** (2 / 3);
    // Folded into the part's range here, as orch() would, so a MIDI export (Recorder.orch) gets the pitch that sounds.
    const fit = (part, m) => { const O = ORCH[part]; while (m > O.hi) m -= 12; while (m < O.lo) m += 12; return m; };
    for (const part of L.parts) {
      if (part === 'pno') {
        notes.forEach((m, k) => this.orch('pno', t + k * 0.004 + hash(t, m) * 0.006, fit('pno', m + 12), 8 * sd * 0.95, v * (i16 ? 0.92 : 1)));
        continue;
      }
      // The organist holds the whole chord through the bar, keyed together.
      if (part === 'org') {
        if (!i16) notes.forEach((m) => this.orch('org', t, fit('org', m + 12), 16 * sd * 0.98, v));
        continue;
      }
      if (i16) continue;
      const m = part === 'vc' ? root - 12 : part === 'vla' ? notes[1] ?? root : Math.max(...notes) + 12;
      this.orch(part, t, fit(part, m), 16 * sd * 1.02, v * (part === 'vln1' ? 0.85 : part === 'vla' ? 0.9 : 1));
    }
  }
  driveGuitar(...a) { return this.recorded('drive', 'pluck', ...a); }
  acoustic(...a) { return this.recorded('agtr', 'pluck', ...a); }
  nylon(...a) { return this.recorded('nylon', 'pluck', ...a); }
  jazzGuitar(...a) { return this.recorded('jazz', 'keys', ...a); }
  banjo(...a) { return this.recorded('banjo', 'pluck', ...a); }
  twangGuitar(...a) { return this.recorded('gretsch', 'pluck', ...a); }
  guitar(...a) { return this.recorded('gtr', 'pluck', ...a); }
  horns(...a) { return this.recorded('horn', 'brass', ...a); }
  strings(...a) { return this.recorded('str', 'pad', ...a); }
  cello(...a) { return this.recorded('cello', 'pad', ...a); }
  clarinet(...a) { return this.recorded('cl', 'keys', ...a); }
  marimba(...a) { return this.recorded('marimba', 'pluck', ...a); }

  brass(t, v, iv, root, p, out) {
    const c = this.ctx, gate = Math.max(0.08, p.decay * 0.8), end = t + gate + 0.4;
    const lp = this.filter('lowpass', p.cutoff * 0.4, Math.max(0.7, p.reso * 0.5));
    lp.frequency.setValueAtTime(p.cutoff * 0.35, t);
    lp.frequency.linearRampToValueAtTime(Math.min(14000, p.cutoff * (1 + p.env * 3) * (0.7 + v * 0.3)), t + 0.06);
    lp.frequency.setTargetAtTime(p.cutoff * 0.8, t + 0.08, 0.15);
    const amp = this.gain(0), peak = (v * 0.36) / Math.sqrt(iv.length);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.025);
    amp.gain.setTargetAtTime(peak * 0.75, t + 0.05, 0.1);
    amp.gain.setTargetAtTime(0, t + gate, 0.06);
    const pans = this.sidePans([-0.4, 0.4], lp);
    iv.forEach((n, k) => {
      for (const side of [-1, 1]) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = midiHz(root + n);
        o.detune.setValueAtTime(-60 + side * p.detune * 0.5, t);
        o.detune.linearRampToValueAtTime(side * p.detune * 0.5, t + 0.04 + k * 0.004);
        o.connect(pans[side < 0 ? 0 : 1]); this.startSource(o, t); o.stop(end);
      }
    });
    lp.connect(amp).connect(out);
  }

  // Bright pluck, strummed: the filter snaps shut over DECAY; ENV sets how bright the snap is.
  pluck(t, v, iv, root, p, out) {
    const c = this.ctx, dec = Math.max(0.04, p.decay * 0.35);
    iv.forEach((n, k) => {
      const tt = t + k * 0.011, end = tt + dec * 5 + 0.1, f = midiHz(root + n);
      const lp = this.filter('lowpass', p.cutoff, p.reso * 0.7);
      lp.frequency.setValueAtTime(Math.min(16000, p.cutoff * (1.5 + p.env * 6)), tt);
      lp.frequency.setTargetAtTime(Math.max(200, p.cutoff * 0.5), tt + 0.003, dec * 0.5);
      const amp = this.gain(0), peak = (v * 0.38) / Math.sqrt(iv.length);
      amp.gain.setValueAtTime(EPS, tt);
      amp.gain.linearRampToValueAtTime(peak, tt + 0.002);
      amp.gain.setTargetAtTime(0, tt + 0.004, dec);
      const a = c.createOscillator(); a.type = 'sawtooth'; a.frequency.value = f; a.detune.value = -p.detune * 0.5;
      const b = c.createOscillator(); b.type = 'square'; b.frequency.value = f; b.detune.value = p.detune * 0.5;
      const bg = this.gain(0.5); b.connect(bg).connect(lp); a.connect(lp);
      const pan = c.createStereoPanner(); pan.pan.value = ((k % 3) - 1) * 0.35;
      lp.connect(amp).connect(pan).connect(out);
      for (const o of [a, b]) { this.startSource(o, tt); o.stop(end); }
    });
  }

  // FM bells and mallets: ENV sets the strike brightness, DECAY the ring, DETUNE the shimmer.
  bells(t, v, iv, root, p, out) {
    const c = this.ctx, ring = Math.max(0.2, p.decay * 1.6);
    const lp = this.filter('lowpass', Math.min(16000, p.cutoff * 2.5), 0.5);
    iv.forEach((n, k) => {
      const tt = t + k * 0.018, f = midiHz(root + 12 + n), end = tt + ring * 4;
      const car = c.createOscillator(); car.frequency.value = f; car.detune.value = (k % 2 ? 1 : -1) * p.detune * 0.2;
      const mod = c.createOscillator(); mod.frequency.value = f * 3.5;
      const ma = this.gain(0); mod.connect(ma).connect(car.frequency);
      ma.gain.setValueAtTime(f * (0.5 + p.env * 4) * v, tt);
      ma.gain.setTargetAtTime(f * 0.05, tt + 0.002, ring * 0.25);
      const amp = this.gain(0);
      amp.gain.setValueAtTime(EPS, tt);
      amp.gain.linearRampToValueAtTime((v * 0.3) / Math.sqrt(iv.length), tt + 0.002);
      amp.gain.setTargetAtTime(0, tt + 0.004, ring);
      car.connect(amp).connect(lp);
      for (const o of [car, mod]) { this.startSource(o, tt); o.stop(end); }
    });
    lp.connect(out);
  }

  vox(t, v, step) {
    if (vowelStyle(this.playbackStyle) && !hasUserSample()) {
      const note = vowelVoxNote(this.state, this.playbackStyle, step, this.stepDur, this.harmRoot());
      if (playVowel(this, t, v, note.midi, note.duration, note.name, this.ch.vox.input, this.state.params.vox.tone, !['ukg', 'jerseyclub', 'bailefunk'].includes(this.playbackStyle))) return;
    }
    if (this.playbackStyle === 'bailefunk') return this.funkVox(t, v, step);
    // Saved set timelines omit song metadata, so never borrow the listener's project seed.
    const c = this.ctx, p = this.state.params.vox, owner = this.replay808Style ? null : this.state, sample = getSample(owner);
    if (this.playbackStyle === 'euphoric' && sample.source === 'synth') return this.sungVox(t, v, step, owner);
    const { buffer, slices } = sample;
    const jump = hash(step, 1) < p.scatter ? Math.floor(hash(step, 2) * slices.length) : 0;
    const idx = (Math.round(p.slice) + jump) % slices.length;
    const from = slices[idx], to = slices[idx + 1] ?? buffer.duration;
    const notes = SCALES[this.state.scale]?.notes || SCALES.minor.notes;
    const degree = hash(step, 3) < p.melody ? notes[Math.floor(hash(step, 4) * notes.length)] : 0;
    const rate = 2 ** ((Math.round(p.pitch) + degree) / 12);
    const dur = Math.max(0.03, Math.min((to - from) / rate, p.length * this.stepDur));
    this.voxChop(t, v, buffer, from, dur, rate);
  }

  // Euphoric chops: the sung voice already holds every vowel on every pitch, so a chop plays a chord
  // tone of the bar in the song's key at its own pitch (playback rate 1, formants where a singer has them).
  sungVox(t, v, step, owner) {
    const p = this.state.params.vox, iv = chordIv(this.harm, this.state.params.stab);
    const tone = hash(step, 3) < p.melody ? iv[Math.floor(hash(step, 4) * iv.length)] : 0;
    const vowel = Math.round(p.slice) + (hash(step, 1) < p.scatter ? Math.floor(hash(step, 2) * SUNG_VOWEL_COUNT) : 0);
    const home = Math.min(SUNG_LOW + SUNG_NOTES - 8, Math.max(SUNG_LOW + 7, 66 + Math.round(p.pitch))), prev = this.voxPrev ?? home, target = this.state.key + this.harmRoot() + tone + Math.round(p.pitch);
    let midi = prev + ((target - prev) % 12 + 18) % 12 - 6;
    if (midi - home > 7) midi -= 12;
    else if (home - midi > 7) midi += 12;
    this.voxPrev = midi;
    const dur = Math.max(0.06, Math.min(SUNG_LEN, p.length * this.stepDur)), release = Math.min(0.06, Math.max(0.03, dur * 0.4));
    this.voxChop(t, v, sungNote(owner, vowel, midi), 0, dur, 1, release, { curve: true });
    for (const side of [-1, 1]) this.voxChop(t + (side < 0 ? 0.009 : 0.014), v * 0.25, sungNote(owner, vowel, midi, side < 0 ? 1 : 2), 0, dur, 2 ** (side * 6 / 1200), release, { curve: true, pan: side * 0.45 });
  }

  voxChop(t, v, buffer, from, dur, rate, release = 0.015, { curve = false, pan = 0 } = {}) {
    const c = this.ctx, p = this.state.params.vox, src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = p.tone; lp.Q.value = 0.7;
    const amp = this.gain(0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(v, t + 0.004);
    if (curve) amp.gain.setValueCurveAtTime(Float32Array.from({ length: 32 }, (_, i) => v * Math.cos(Math.PI / 2 * i / 31)), t + dur - release, release);
    else {
      amp.gain.setValueAtTime(v, t + Math.max(0.005, dur - release));
      amp.gain.linearRampToValueAtTime(0, t + dur);
    }
    let out = src.connect(lp).connect(amp);
    if (pan) {
      const panner = c.createStereoPanner();
      panner.pan.value = pan;
      out = out.connect(panner);
    }
    out.connect(this.ch.vox.input);
    this.startSource(src, t, from, dur + 0.02);
  }

  lick(t, v, k) {
    const p = this.state.params.stab, h = this.harm;
    const iv = CHORDS[h ? h.c : Math.round(p.chord)].iv;
    const n = iv[k % iv.length] + 12 * Math.floor(k / iv.length);
    if (this.playbackStyle === 'bailefunk') return this.funkStab(t, v, [n], 60 + this.state.key + Math.round(p.octave) * 12 + this.harmRoot(), p.decay, this.ch.stab.input);
    if (this.hardTechno) return this.hardLead(t, v * 0.12, midiHz(60 + this.state.key + Math.round(p.octave) * 12 + this.harmRoot() + n), Math.max(0.12, p.decay), this.ch.stab.input);
    const vo = Math.round(p.voice), lead = vo > 1 ? STAB_VOICES[vo] : 'keys';
    const style = this.state.artist?.style;
    const out = style === 'breaks' || style === 'reggaeton' ? this.chordTone(vo, this.ch.stab.input) : this.ch.stab.input;
    return this[lead](t, v, [n], 60 + this.state.key + Math.round(p.octave) * 12 + this.harmRoot(), p, out);
  }

  // The user's own voice, one chop per note: the nearest-pitched chop, retuned by playback rate.
  chopNote(vc, t, v, midi, dur, expression = {}, index = null, out = this.ch.stab.input) {
    const fixed = vc.chops[index];
    const pick = fixed ? { index, rate: fixed.midi === null ? 1 : 2 ** ((midi - fixed.midi) / 12) } : pickChop(vc.chops, midi, Math.round(t * 8));
    if (!pick) return;
    const c = this.ctx, ch = vc.chops[pick.index], rate = Math.max(0.25, Math.min(4, pick.rate));
    const len = Math.max(0.06, Math.min((ch.end - ch.start) / rate, dur * 1.1 + 0.08));
    const src = c.createBufferSource();
    src.buffer = vc.buffer;
    src.playbackRate.value = rate;
    const lp = this.filter('lowpass', 3200 + 3800 * (1 - (expression.warmth ?? 0.5)), 0.6);
    const amp = this.gain(0);
    const g = Math.min(1.2, v) * 0.75;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(g, t + 0.006);
    amp.gain.setValueAtTime(g, t + Math.max(0.008, len - 0.04));
    amp.gain.linearRampToValueAtTime(0, t + len);
    src.connect(lp).connect(amp).connect(out);
    this.startSource(src, t, ch.start, Math.min(ch.end - ch.start, (len + 0.02) * rate));
    src.stop(t + len + 0.05);
  }

  harpHook(set, t, v, m, dur) {
    const best = set.reduce((pick, take) => Math.abs(HARP_PLUCK[take[0]][0] - m) < Math.abs(HARP_PLUCK[pick[0]][0] - m) ? take : pick);
    const [center, offset] = HARP_PLUCK[best[0]];
    const out = this.trimOut('hook-harpplk', 4, this.hookBus || this.ch.stab.input, -2, 700);
    const tones = (this.harpTones ||= new WeakMap());
    if (!tones.has(out)) {
      const dip = this.filter('peaking', 640, 2.6); dip.gain.value = -3.8;
      const box = this.filter('peaking', 780, 1.5); box.gain.value = -2.65;
      const harmonics = this.filter('peaking', 1650, 1.1); harmonics.gain.value = 0.9;
      const presence = this.filter('peaking', 2200, 0.8); presence.gain.value = 3;
      dip.connect(presence).connect(box).connect(harmonics).connect(out);
      tones.set(out, dip);
    }
    // Keep the closing accent in range, and trim strings pitched above the recording.
    const level = 2.85 * Math.min(v, 0.8) * dbGain(1.35 - Math.min(3.3, Math.max(0, m - 81) * 0.42));
    const attackTrim = Math.min(1.3, Math.max(0, m - 82) * 0.22) * Math.min(1, Math.max(0, v - 0.36) / 0.15);
    return this.playBuf(best[1], t, level, tones.get(out), 2 ** ((m - center) / 12), Math.max(0.06, dur * 0.92), {
      lp: 3100 + 2300 * Math.min(1, v / 1.3), offset, fade: 0.007, release: 0.09, ringOut: true,
      attackGain: attackTrim > 0 ? dbGain(-attackTrim) : undefined,
    });
  }

  windHook(set, t, v, m, dur, voice, strong, { harm, take = 0 }) {
    const { gain: base, presence, takes, second, lp = 3850, tone = [] } = WIND_HOOK[voice];
    const gain = base * dbGain(voice.endsWith('sax') ? SAX_TRIM[this.playbackStyle] ?? 0 : 0);
    const alt = TAKES[HOOK_BAND[voice]] && this.rec(TAKES[HOOK_BAND[voice]]);
    // The longer primary take can sustain through holds after transposition.
    const useAlt = alt && (take + (harm ? 1 : 0)) % 2 && dur <= 0.85;
    const [pitch, buf] = (useAlt ? alt : set).reduce((best, note) => Math.abs(note[0] - m) < Math.abs(best[0] - m) ? note : best);
    const [cents, offset, trim] = (useAlt ? second : takes)[pitch];
    // Vary the air and tongue by song step so late joins and offline renders use the same attack.
    const step = (this.step ?? 0) * 2 + (harm ? 1 : 0);
    const air = hash(step, m + 29), tongue = hash(step, m + 71), touch = Math.min(1, v);
    const out = this.trimOut(`hook-${voice}`, 1, this.hookBus || this.windDuck, -4, 500);
    const eq = tone.reduce((o, band) => this.bodyFor(o, band), this.bodyFor(this.bodyFor(out, presence), [780, 1.2, -2.5]));
    const rate = 2 ** ((m - pitch - cents / 100) / 12);
    return this.playBuf(buf, t, gain * touch * dbGain(trim + (air - 0.5) * 1.2) * dbGain(jazzStyle(this.state, this.playingPattern) === 'bossa' && voice === 'tpt' ? JAZZ_MIX.bossa.trumpetLead : JAZZ_MIX[jazzStyle(this.state, this.playingPattern)]?.lead || 0), eq,
      rate, Math.max(0.06, dur * 0.92), {
        peaks: jazzStyle(this.state, this.playingPattern) ? jazzNotches(useAlt ? TAKES[HOOK_BAND[voice]] : HOOK_BAND[voice], pitch, rate) : [],
        lp: lp + 2100 * touch + 650 * (air - 0.5), offset: offset + tongue * 0.012,
        fade: (voice === 'tpt' ? 0.025 : strong ? 0.007 : 0.012) + 0.009 * (1 - tongue),
        attackGain: (strong ? 1.04 : 0.9) + (tongue - 0.5) * 0.24,
        release: 0.055, ringOut: true, ...(voice === 'tpt' ? { vib: 6 } : {}),
      });
  }

  shapedTechnoHook(t, v, f, dur, voice, strong, brightness) {
    const c = this.ctx, len = Math.max(0.06, dur * 0.92), end = t + len + 0.6;
    const amp = this.gain(0), oscs = [];
    const osc = (type, hz, level, out) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = hz;
      o.connect(this.gain(level)).connect(out); oscs.push(o);
      return o;
    };
    const metal = voice === 'metalstrike', soft = voice === 'softresonator';
    const out = this.technoHookOut(voice);
    const lp = this.filter('lowpass', metal ? 3500 : soft ? 4400 : 3650, 0.6);
    lp.connect(amp).connect(out);
    if (metal) {
      // The strike has inharmonic steel sidebands; the settled note still has a clear pitch.
      const body = this.filter('highpass', 420, 0.8);
      const carrier = osc('sine', f * 2, 0.67, body), depth = this.gain(0);
      const strike = hash(this.step ?? 0, 955);
      carrier.frequency.setValueAtTime(f * (2.23 + strike * 0.52), t);
      carrier.frequency.exponentialRampToValueAtTime(f * 1.81, t + 0.23);
      const strikeHz = f * (3.55 + strike * 0.8);
      const mod = osc('sine', strikeHz, 1, depth);
      mod.frequency.setValueAtTime(strikeHz, t);
      mod.frequency.exponentialRampToValueAtTime(f * 1.67, t + 0.12);
      depth.gain.setValueAtTime(f * (strong ? 4.1 : 3.35) * brightness, t);
      depth.gain.setTargetAtTime(0, t + 0.004, 0.035);
      depth.connect(carrier.frequency);
      osc('triangle', f, 0.43, lp);
      body.connect(lp);
    } else if (soft) {
      // Moving upper partials leave a hollow space above the fundamental.
      const color = hash(this.step ?? 0, 141);
      const partials = this.filter('highpass', 2150, 0.65), drift = 1.63;
      partials.connect(lp);
      osc('sine', f, 0.42, lp);
      const ring = osc('sine', f * 8, 0.74, partials);
      ring.frequency.setValueAtTime(f * (8 - drift * (0.65 - 0.47 * color)), t);
      ring.frequency.exponentialRampToValueAtTime(f * (8 + drift * (0.43 + 0.36 * color)), t + Math.max(0.23, len));
      const halo = osc('sine', f * 12, 0.28, partials);
      halo.frequency.setValueAtTime(f * (12 + drift * color), t);
      halo.frequency.linearRampToValueAtTime(f * (12 - drift), t + Math.max(0.30, len));
    } else {
      // Two moving parallel formants make a short, voiced syllable, not another filter pluck.
      const source = this.gain(1), low = this.filter('bandpass', 650, 3.1), high = this.filter('bandpass', 2050, 3.2);
      const vowel = hash(t, 711), change = Math.min(len * 0.68, 0.092);
      low.frequency.setValueAtTime(650 + vowel * 260, t);
      low.frequency.exponentialRampToValueAtTime(430 + vowel * 120, t + change);
      high.frequency.setValueAtTime(2280 + vowel * 410, t);
      high.frequency.exponentialRampToValueAtTime((1700 + vowel * 380) * (0.8 + 0.2 * brightness), t + change);
      osc('sawtooth', f, 0.74, source);
      osc('square', f * 2, 0.21, source);
      osc('sine', f, 0.13, lp);
      source.connect(low).connect(this.gain(0.9)).connect(lp);
      source.connect(high).connect(this.gain(1.82)).connect(lp);
    }
    const attack = metal ? 0.005 : soft ? 0.078 : 0.009;
    const peak = v * (metal ? 0.63 : soft ? 0.58 : 0.64);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + attack);
    amp.gain.setTargetAtTime(peak * (metal ? 0.16 : soft ? 0.62 : 0.55), t + attack, metal ? 0.036 : 0.084);
    amp.gain.setTargetAtTime(0, t + (soft ? Math.max(len, attack) : len), soft ? 0.22 : 0.048);
    for (const o of oscs) { this.startSource(o, t); o.stop(end); }
    this.retire(oscs.at(-1), amp);
  }

  technoHookOut(voice, dest = this.hookBus || this.ch.stab.input) {
    const space = TECHNO_HOOK_SPACE[voice];
    const tones = (this.technoHookTones ||= new WeakMap());
    if (!tones.has(dest)) tones.set(dest, new Map());
    const paths = tones.get(dest);
    if (!paths.has(voice)) {
      const input = this.filter('peaking', space.eq[0], space.eq[1]);
      input.gain.value = space.eq[2];
      // A sub-millisecond delay sweep spreads narrow upper harmonics more than the fundamental.
      const rates = [6.7, 11.3, 17.9];
      const excursion = rates.length * space.diffusion;
      const center = Math.max(0.00075, excursion);
      const diffuse = this.ctx.createDelay(Math.max(0.002, center + excursion));
      diffuse.delayTime.value = center;
      const depth = this.gain(space.diffusion);
      if (!this.technoHookMotion) {
        this.technoHookMotion = this.gain(1);
        for (const rate of rates) {
          const lfo = this.ctx.createOscillator();
          lfo.frequency.value = rate;
          lfo.connect(this.technoHookMotion);
          this.startContinuous(lfo);
        }
      }
      this.technoHookMotion.connect(depth).connect(diffuse.delayTime);
      input.connect(diffuse).connect(this.gain(0.87)).connect(dest);
      const sides = this.filter('highpass', 520, 0.7);
      sides.channelCount = 1; sides.channelCountMode = 'explicit';
      diffuse.connect(sides);
      const seats = this.sidePans([-0.9, 0.9], dest);
      space.taps.forEach((time, i) => {
        const tap = this.ctx.createDelay(0.025); tap.delayTime.value = time;
        sides.connect(tap).connect(this.gain(space.width)).connect(seats[i]);
      });
      paths.set(voice, input);
    }
    return paths.get(voice);
  }

  phonkAir(db, hz = 8000) {
    const shelf = this.filter('highshelf', hz);
    shelf.gain.value = db;
    return shelf;
  }

  phonkMusicIn(out) {
    const buses = (this.phonkMusicBuses ||= new WeakMap());
    if (!buses.has(out)) {
      const input = this.gain(), high = this.filter('highpass', 420), delay = this.ctx.createDelay(0.02);
      const side = this.ctx.createChannelMerger(2);
      const width = 1.42;
      high.channelCount = 1;
      high.channelCountMode = 'explicit';
      delay.delayTime.value = 0.011;
      input.connect(out);
      // The high-passed reflection lives entirely in the side, leaving the dry fold-down intact.
      input.connect(high).connect(delay);
      delay.connect(this.gain(width)).connect(side, 0, 0);
      delay.connect(this.gain(-width)).connect(side, 0, 1);
      side.connect(out);
      buses.set(out, input);
    }
    return buses.get(out);
  }

  phonkBell(t, v, f, dur, strong) {
    const len = Math.min(0.19, dur * 1.1), end = t + len + 0.2;
    const amp = this.gain(0), tone = this.filter('lowpass', Math.min(3200, 1450 + 2 * f), 0.55);
    const ring = this.filter('peaking', 3100, 4);
    ring.gain.value = -2;
    const air = this.phonkAir(2);
    tone.connect(ring).connect(air).connect(amp).connect(this.phonkMusicIn(this.hookBus || this.ch.stab.input));
    const strike = v * (strong ? 0.33 : 0.27);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(strike, t + 0.003);
    amp.gain.setTargetAtTime(strike * 0.31, t + 0.003, 0.027);
    amp.gain.setTargetAtTime(0, t + len, 0.032);
    const partials = [['square', 1, 0.39], ['square', 1.49, 0.18], ['sine', 1, 0.48]];
    const sources = partials.map(([type, ratio, level]) => {
      const osc = this.ctx.createOscillator(), g = this.gain(level);
      osc.type = type;
      osc.frequency.value = f * ratio;
      osc.connect(g).connect(tone);
      this.startSource(osc, t);
      osc.stop(end);
      return osc;
    });
    this.retire(sources.at(-1), tone, ring, air, amp);
  }

  // Song hook: one lead note per call, snapped to the current chord on strong beats so it follows the changes.
  hook(t, v, n, dur, voice, oct = 0, strong = false, b = 1, up = false, expression = {}) {
    const c = this.ctx, p = this.state.params.stab, h = this.harm;
    v *= 1.3;
    n = hookSnap(n, h, p, strong, up);
    const k = this.state.key > 6 ? this.state.key - 12 : this.state.key;
    if (vowelStyle(this.playbackStyle) && (voice === 'vocal' || voice === 'chop')) {
      const vc = voice === 'chop' && getChops(), out = this.hookBus || this.ch.stab.input;
      if (vc) return this.chopNote(vc, t, v, 60 + k + oct * 12 + n, dur, expression, null, out);
      if (!hasUserSample() && playVowel(this, t, v * 10 ** (VOWEL_HOOK_DB[this.playbackStyle] / 20), 60 + k + oct * 12 + n, vowelHookDuration(this.playbackStyle, dur), vowelName(this.playbackStyle, Math.floor((this.step || 0) / 64)), out, 5000, !['ukg', 'jerseyclub', 'bailefunk'].includes(this.playbackStyle), VOWEL_HOOK_EQ[this.playbackStyle])) return;
    }
    if (voice === 'tapekeys') {
      const out = this.hookBus || this.ch.stab.input;
      return this.keys(t, v * 0.53, [n], 60 + k + oct * 12, { ...p, cutoff: 680, env: 0.08, tine: 0.08, decay: dur * 0.52 }, out);
    }
    if (voice === 'phonkbell') return this.phonkBell(t, v, midiHz(60 + k + oct * 12 + n), dur, strong);
    if (this.playbackStyle === 'bailefunk') return this.funkStab(t, v * 0.7, [n], 60 + k + oct * 12, dur, this.hookBus || this.ch.stab.input);
    const palette = paletteFor(this.state, this.playbackStyle);
    if (palette && (voice !== 'chop' || !getChops())) return this.paletteHook(t, v, midiHz(60 + k + oct * 12 + n), dur, palette.hook, this.hookBus || this.ch.stab.input);
    if (this.minimal && (voice !== 'chop' || !getChops())) return this.minimalHook(t, v, midiHz(60 + k + oct * 12 + n), dur, this.hookBus || this.ch.stab.input);
    if (this.state.artist?.style === 'dub') return this.dubChord(t, v * 0.38, [0], 60 + k + oct * 12 + n, { ...p, decay: Math.min(0.3, dur) }, this.hookBus || this.ch.stab.input);
    if (dampedChord(this) && (voice === 'vocal' || voice === 'reed')) {
      const name = Math.round(p.voice) === 1 ? 'keys' : 'organ';
      const out = this.trimOut(`hook-${name}`, 4, this.hookBus || this.ch.stab.input, -4, 500);
      let root = 60 + k + oct * 12 + n;
      while (root > 79) root -= 12;
      while (root < 48) root += 12;
      return this[name](t, v, [0], root, { ...p, decay: Math.max(0.1, dur / 0.9) }, out);
    }
    if (voice === 'reed' && SAX_HOOK[this.playbackStyle]) voice = SAX_HOOK[this.playbackStyle];
    const wind = Object.hasOwn(WIND_HOOK, voice);
    if (wind) {
      const name = HOOK_BAND[voice], set = this.rec(name);
      const root = SAX_LO[voice] ? saxRoot(this.playbackStyle, 60 + k, oct) : 60 + k + oct * 12;
      if (set) return this.windHook(set, t, v, root + n, dur, voice, strong, expression);
      loadBand(name);
      voice = 'reed';
    }
    if (voice === 'harpplk') {
      const harp = this.rec('harp');
      if (harp) return this.harpHook(harp, t, v, 60 + k + oct * 12 + n, dur);
      loadBand('harp');
      voice = 'softmallet';
    }
    if (voice === 'marimba') {
      const set = this.rec('marimba');
      if (set) {
        // The F4 recording's upper partial lands near 3 kHz after transposing to the hook notes.
        const out = this.bodyFor(this.hookBus || this.ch.stab.band, [2915, 2.5, -20]);
        return this.recordedNote(set, t, v * 1.55, 60 + k + oct * 12 + n, Math.max(0.11, dur * 1.2), out, 0, 'marimba', v);
      }
      loadBand('marimba');
      voice = 'mallet';
    }
    if (voice === 'chop') {
      const vc = getChops();
      if (vc) return this.chopNote(vc, t, v, 60 + k + oct * 12 + n, dur, expression, null, this.hookBus || this.ch.stab.input);
      voice = 'vocal';
    }
    voice = { saw: 'analog', sq: 'pulse', flute: 'reed', bell: 'mallet', pluck: 'warm' }[voice] || voice;
    if (SHAPED_TECHNO_HOOKS.has(voice)) return this.shapedTechnoHook(t, v, midiHz(60 + k + oct * 12 + n), dur, voice, strong, b);
    const warmth = expression.warmth ?? 0.5;
    // Genres on a recorded instrument let that player take the melody too; synth-pop leads stay synths.
    const synth = voice === 'ravestack' || voice === 'acidlead';
    const twang = !wind && !synth && pocketOf(this.state.master)?.walk && this.rec('gtr');
    const band = twang ? 'gtr' : !wind && !synth && voice !== 'pulse' && voice !== 'funkwhistle' && STAB_BAND[Math.round(p.voice)], set = band && this.rec(band);
    if (set) {
      const kind = twang ? 'twang' : Math.round(p.voice) === 11 ? 'lead' : band, R = BAND_PLAY[kind], ring = R.hold ? dur * 1.05 : Math.max(R.min * 0.6, dur * 1.5);
      let dest = this.hookBus || this.ch.stab.input;
      if (jazzStyle(this.state, this.playingPattern)) dest = this.trimOut('jazz-recorded-lead', JAZZ_MIX[jazzStyle(this.state, this.playingPattern)].lead, dest, JAZZ_MIX[jazzStyle(this.state, this.playingPattern)].lead);
      if (R.amp) dest = this.ampFor(dest === this.ch.stab.input ? this.ch.stab.band : dest, R.lead);
      if (R.slap) {
        dest = this.slapFor(dest);
        // A country double-stop: a sixth under the melody on the strong notes.
        const m6 = 60 + k + (oct + R.oct) * 12 + n, scale = SCALES[this.state.scale]?.notes || SCALES.major.notes;
        const lo = scale.includes((((m6 - 9 - 60 - k) % 12) + 12) % 12) ? m6 - 9 : m6 - 8;
        if (strong && lo >= R.lo) this.recordedNote(set, t + 0.006, Math.min(1.3, v) * R.gain * 0.36, lo, ring, dest, 0, kind, v / 1.3);
      }
      const m = 60 + k + (oct + (R.oct || 0)) * 12 + n, g = Math.min(1.3, v) * R.gain * 0.6;
      // A rock riff is a double-stop: the melody note with its fifth underneath, through the rhythm amp.
      if (R.dyad && m - 5 >= R.lo) this.recordedNote(set, t + 0.004, g * 0.7, m - 5, ring, dest, 0, kind, v / 1.3);
      if (R.grip) this.leadOver(m, t, ring, R);
      return this.recordedNote(set, t, g, m, ring, dest, 0, kind, v / 1.3);
    }
    const f = midiHz(60 + k + oct * 12 + n), preset = leadPreset(voice, pocketOf(this.state.master)?.name);
    const L = this.hardTechno ? { ...preset, cut: 380, env: 500, spread: 10, atk: 0.18, sus: 0.45, rel: 0.6, level: 0.12, bite: 0, air: 0.2 } : preset;
    const hdb = this.soulBand() ? 0 : HOOK_TRIM_DB[voice] || 0;
    const festival = this.playbackStyle === 'trap' && [0, 2].includes(Math.round(p.voice)), lift = festival && Math.round(p.voice) === 2 ? 3 : 0;
    const out = this.trimOut(`hook-${voice}:${hdb + lift}`, hdb + lift, synth ? this.technoHookOut(voice) : this.hookBus || this.ch.stab.input, (voice === 'softmallet' ? 4 : HOOK_LOW_DB) + lift);
    if (this.hardTechno) this.hardPalette(t, v / 1.3 * L.level, [f * 2], Math.max(0.2, dur), out, 'air');
    if (this.hardTechno) return this.hardLead(t, v * L.level, f, dur, out);
    const len = Math.max(0.06, dur * 0.92), end = t + len + 0.6, vn = Math.min(1, v / 1.3);
    // Played legato into a close note, the lead slides there instead of re-striking.
    const prev = this.lastLead, semis = prev ? Math.abs(12 * Math.log2(f / prev.f)) : 0;
    const from = !expression.harm && L.glide && prev && t > prev.t && t - prev.end < 0.09 && semis > 0.5 && semis <= 7 ? prev.f : 0;
    const glide = from ? L.glide * (0.6 + (0.4 * semis) / 7) : 0;
    if (!expression.harm) this.lastLead = { f, t, end: t + len };
    const amp = this.gain(0), pan = c.createStereoPanner();
    pan.pan.value = (hash(t * 13, 5) - 0.5) * 0.3;
    const tame = this.filter('lowpass', (1800 + 1200 * b + 800 * (1 - warmth)) * L.air, 0.5);
    // Character: soft tube-style saturation, a little per-note pitch drift, and vibrato that only
    // develops on held notes, the way a player leans into a sustained note.
    const tubeAmt = 0.04 + 0.06 * warmth, tubeK = 1 + Math.round(tubeAmt * 100) / 100 * 14;
    const tube = c.createWaveShaper(); tube.curve = driveCurve(tubeAmt, Math.tanh(tubeK) / tubeK);
    amp.connect(tube).connect(tame).connect(pan).connect(this.leadTone(L, out));
    const oscs = [], drift = (hash(t * 7, 11) - 0.5) * 9;
    const vib = len > 0.24 && L.vib[1] ? c.createOscillator() : null, vibDepth = vib ? this.gain(0) : null;
    if (vib) {
      const rate = L.vib[0] + hash(t, 12) * 0.6, wait = Math.min(0.22, len * 0.3);
      const depth = L.vib[1] * (0.6 + 0.8 * (expression.feel ?? 0.4)) * Math.min(1, len / 0.8);
      vib.frequency.setValueAtTime(rate * 0.85, t);
      vib.frequency.linearRampToValueAtTime(rate * 1.08, t + len);
      vibDepth.gain.setValueAtTime(0, t);
      vibDepth.gain.setValueAtTime(0, t + wait);
      vibDepth.gain.linearRampToValueAtTime(depth, t + Math.max(wait + 0.05, len * 0.85));
      vib.connect(vibDepth);
      oscs.push(vib);
    }
    const osc = (type, freq, det = 0, g = 1, dst = null) => {
      const o = c.createOscillator(), mul = freq / f; o.type = type; o.detune.value = det + drift;
      if (L.bend) {
        o.detune.setValueAtTime(det + drift + (from ? 0 : L.bend * vn), t);
        o.detune.linearRampToValueAtTime(det + drift, t + 0.032);
        o.detune.linearRampToValueAtTime(det + drift - L.bend * 0.35, t + Math.max(0.07, len));
      }
      if (from) { o.frequency.setValueAtTime(from * mul, t); o.frequency.exponentialRampToValueAtTime(freq, t + glide); } else o.frequency.value = freq;
      if (vibDepth) vibDepth.connect(o.detune);
      const og = this.gain(g); o.connect(og).connect(dst); oscs.push(o); return o;
    };
    // Filter envelope: harder notes open further and brighter, then settle back.
    const velFilter = (lp, base, env, dec) => {
      const top = Math.min(16000, (base + env * Math.pow(vn, 1.5)) * b), rest = Math.min(top, base * b * (0.8 + 0.4 * vn));
      lp.frequency.setValueAtTime(top * 0.6, t);
      lp.frequency.linearRampToValueAtTime(top, t + 0.012);
      lp.frequency.setTargetAtTime(rest, t + 0.014, dec);
    };
    if (L.stack) {
      const lp = this.filter('lowpass', L.cut, L.q);
      velFilter(lp, L.cut, L.env, L.dec);
      for (let i = 0; i < L.uni; i++) osc(L.wave, f, L.uni > 1 ? ((i / (L.uni - 1)) * 2 - 1) * L.spread : 0, L.mix / Math.sqrt(L.uni), lp);
      if (L.body) osc(L.body[0], f * L.body[2], 0, L.body[1], lp);
      // A sine an octave down gives high leads body; it stays out of the low-mid mud band.
      if (L.sub && f / 2 >= 500) osc('sine', f / 2, 0, L.sub, amp);
      lp.connect(amp);
      const pk = L.level * v;
      amp.gain.setValueAtTime(EPS, t);
      amp.gain.linearRampToValueAtTime(pk, t + L.atk);
      amp.gain.setTargetAtTime(pk * L.sus, t + L.atk, L.hold);
      amp.gain.setTargetAtTime(0, t + Math.max(len, L.atk + 0.02), L.rel);
    } else if (voice === 'vocal') {
      const body = this.filter('lowpass', 1900 + 700 * b, 0.7);
      velFilter(body, L.cut + 400, L.env, L.dec);
      const vowelA = this.filter('bandpass', 720 + 100 * b, 2.2);
      const vowelB = this.filter('bandpass', 1180 + 220 * b, 2.8);
      const source = this.gain(0.75), formants = this.gain(0.22);
      osc('triangle', f, 0, 0.8, source);
      osc('sawtooth', f, 2, 0.16, source);
      source.connect(body).connect(amp);
      source.connect(vowelA).connect(formants);
      source.connect(vowelB).connect(formants);
      formants.connect(amp);
      amp.gain.setValueAtTime(EPS, t);
      amp.gain.linearRampToValueAtTime(0.3 * v, t + 0.025);
      amp.gain.setTargetAtTime(0.24 * v, t + 0.05, 0.18);
      amp.gain.setTargetAtTime(0, t + len, 0.09);
    } else if (voice === 'reed') {
      const lp = this.filter('lowpass', 1500 + 900 * b, 0.7);
      velFilter(lp, L.cut, L.env, L.dec);
      const car = osc('sine', f, 0, 0.8, lp); const tri = osc('triangle', f, 3, 0.25, lp);
      const lfo = c.createOscillator(); lfo.frequency.value = 5.2; const lg = this.gain(0);
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(9, t + Math.min(0.4, len));
      lfo.connect(lg); lg.connect(car.detune); lg.connect(tri.detune); oscs.push(lfo);
      const br = this.noiseSrc(t, len + 0.1), bp = this.filter('bandpass', Math.min(9000, f * 2.5), 1.5), bg = this.gain(0);
      bg.gain.setValueAtTime(0.018 * v, t); bg.gain.setTargetAtTime(0.007 * v, t + 0.03, 0.05); bg.gain.setTargetAtTime(0, t + len, 0.05);
      br.connect(bp).connect(bg).connect(lp);
      lp.connect(amp);
      amp.gain.setValueAtTime(EPS, t);
      amp.gain.linearRampToValueAtTime(0.36 * v, t + 0.03);
      amp.gain.setTargetAtTime(0.3 * v, t + 0.05, 0.2);
      amp.gain.setTargetAtTime(0, t + len, 0.07);
    } else if (voice === 'softmallet') {
      const attack = 0.01 + 0.009 * (1 - vn);
      const body = Math.min(0.34, 0.15 + len * 0.24);
      const head = this.filter('lowpass', 2100 + 500 * b, 0.5);
      head.connect(amp);
      const car = osc('sine', f, 0, 1, head);
      const mod = c.createOscillator(), strike = this.gain(0);
      mod.frequency.value = f * 2.5;
      mod.connect(strike).connect(car.frequency); oscs.push(mod);
      strike.gain.setValueAtTime(f * (0.15 + 0.15 * vn) * b, t);
      strike.gain.setTargetAtTime(0, t + attack, 0.024);
      const overtone = this.gain(0.32 + 0.11 * vn);
      osc('sine', f * 2, 1.5, 1, overtone); overtone.connect(amp);
      overtone.gain.setTargetAtTime(0.12, t + attack, body * 0.64);
      amp.gain.setValueAtTime(EPS, t);
      amp.gain.linearRampToValueAtTime(0.335 * v, t + attack);
      amp.gain.setTargetAtTime(0, t + attack, body);
      amp.gain.setTargetAtTime(0, t + len, 0.09);
    } else if (voice === 'mallet') {
      const ring = Math.max(0.35, Math.min(1.4, len * 1.2));
      const blp = this.filter('lowpass', 1900 + 1300 * b, 0.5); blp.connect(amp);
      const car = osc('sine', f, 0, 1, blp);
      const mod = c.createOscillator(); mod.frequency.value = f * 2.5; const ma = this.gain(0);
      mod.connect(ma).connect(car.frequency); oscs.push(mod);
      ma.gain.setValueAtTime(f * (0.3 + 0.35 * b) * v, t); ma.gain.setTargetAtTime(f * 0.04, t + 0.002, ring * 0.2);
      amp.gain.setValueAtTime(EPS, t);
      amp.gain.linearRampToValueAtTime(0.34 * v, t + 0.004);
      amp.gain.setTargetAtTime(0, t + 0.004, ring * 0.45);
    }
    for (const o of oscs) { this.startSource(o, t); o.stop(end); }
    this.retire(oscs[oscs.length - 1], pan);
  }

  harmRoot() { return harmRoot(this.harm); }

  // Keep bass roots in the octave where club systems carry weight. Key changes
  // alter the pitch class without accidentally moving the whole bass line up.
  bassMidi(st, base = 36, high = 43) {
    let n = base + this.state.key + st.n + Math.round(this.state.params.acid.tune) + this.harmRoot();
    if (jazzStyle(this.state, this.playingPattern)) return Math.max(28, Math.min(50, n));
    // Bass lines are written in the key, but over the bar's chord a note a half step off a chord tone
    // (a minor third under a major ninth chord) rubs like a detuned string; slide it onto that tone.
    const h = this.harm;
    if (h && !st.ap) {
      const pc = (x) => ((x % 12) + 12) % 12, iv = CHORDS[h.c].iv, rel = pc(n - base - this.state.key - this.harmRoot());
      const tones = iv.map(pc), core = iv.filter((x) => x < 12).map(pc);
      if (!tones.includes(rel)) n += [[core, -1], [core, 1], [tones, -1], [tones, 1]].find(([set, d]) => set.includes(pc(rel + d)))?.[1] ?? 0;
    }
    while (n > high) n -= 12;
    while (n < high - 11) n += 12;
    return n;
  }

  bassColor() { return BASS_COLOR[this.playbackStyle]; }

  minimalHook(t, v, f, dur, out) {
    if (!(v > 0) || !(f > 0) || !(dur > 0) || ![t, v, f, dur].every(Number.isFinite)) return;
    let input = this.minimalHooks?.get(out);
    if (!input) {
      input = this.gain(0.5);
      input.connect(this.comp(0, 4, 3, 0.001, 0.05)).connect(this.gain(2)).connect(out);
      (this.minimalHooks ||= new WeakMap()).set(out, input);
    }
    const p = this.state.params.stab, env = Math.max(0, Math.min(1, p.env)), decay = Math.min(0.25, 0.07 + dur * 0.18);
    const hp = this.filter('highpass', 180, -3.0103), lp = this.filter('lowpass', Math.min(5000, p.cutoff * (0.8 + env)), -3.0103), amp = this.gain(0);
    const car = this.ctx.createOscillator(), mod = this.ctx.createOscillator(), depth = this.gain(0);
    car.type = 'triangle'; car.frequency.value = f; car.detune.value = p.detune * 0.6;
    mod.frequency.value = f * 1.5;
    mod.connect(depth).connect(car.frequency);
    depth.gain.setValueAtTime(f * (0.06 + env * 0.3 + (p.tine ?? 0.15) * 0.1), t);
    depth.gain.setTargetAtTime(0, t + 0.012, 0.03);
    const register = Math.log2(f / 440), level = Math.round(p.voice) === 7 ? 10.7 - register * 6 : 7.7 + register * 3.5;
    this.adEnv(amp.gain, t, v * 0.65 * dbGain(Math.max(2, Math.min(20, level))), 0.012 + env * 0.012, decay * 4);
    car.connect(hp).connect(lp).connect(amp).connect(input);
    for (const o of [car, mod]) { this.startSource(o, t); o.stop(t + decay * 7 + 0.05); }
  }

  minimalBass(t, st, sd, holdNext) {
    if (!st || !(sd > 0) || ![t, st.n, sd].every(Number.isFinite)) return;
    const p = this.state.params.acid, f = midiHz(this.bassMidi(st)), subF = midiHz(this.bassMidi(st, 36, 38));
    const len = st.ap ? sd * 0.9 : holdNext ? sd * 2 : sd * (0.9 + p.decay * 2), vel = (st.a ? 0.9 + p.accent : 0.82) * (1 - p.drive * 0.2) * (this.noteVel ?? 1);
    const body = this.ctx.createOscillator(), mod = this.ctx.createOscillator(), sub = this.ctx.createOscillator(), depth = this.gain(0);
    body.frequency.value = f; mod.frequency.value = f * 2; sub.frequency.value = subF;
    mod.connect(depth).connect(body.frequency);
    depth.gain.setValueAtTime(f * (0.2 + (p.edge ?? 0.5) + p.envmod * 2), t);
    depth.gain.setTargetAtTime(f * 0.08, t + 0.004, 0.018);
    const lp = this.filter('lowpass', 250 + p.cutoff * 0.45, -3.0103), grit = this.ctx.createWaveShaper(), hit = this.gain(0), amp = this.gain(0);
    grit.curve = driveCurve(0.08 + p.drive * 0.6);
    body.connect(grit).connect(lp).connect(hit).connect(this.ch.acid.input);
    this.adEnv(hit.gain, t, vel * 0.7, 0.002, 0.035 + p.decay * 0.12);
    const subTone = this.filter('lowshelf', 60, 0.7); subTone.gain.value = -1;
    sub.connect(amp).connect(subTone).connect(this.ch.acid.input);
    body.connect(this.filter('lowpass', 180, -3.0103)).connect(this.gain(1.1)).connect(amp);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.006);
    amp.gain.setTargetAtTime(vel * 0.55, t + 0.02, 0.12);
    amp.gain.setTargetAtTime(0, t + len, 0.03);
    if (this.minimalMono?.end > t) for (const node of this.minimalMono.amps) node.gain.setTargetAtTime(0, t, 0.004);
    this.minimalMono = { end: t + len + 0.2, amps: [amp, hit] };
    const click = this.noiseSrc(t, 0.012), tone = this.filter('bandpass', 650 + f * 2, -3.0103), touch = this.gain(0);
    this.minimalMono.touch = touch;
    this.adEnv(touch.gain, t, vel * 0.045, 0.001, 0.005);
    click.connect(tone).connect(touch).connect(this.ch.acid.input);
    for (const o of [body, mod, sub]) { this.startSource(o, t); o.stop(t + len + 0.25); }
  }

  // Round finger-style bass: triangle + sine, short pluck through a gentle lowpass.
  bass(t, st, sd, holdNext) {
    const c = this.ctx, p = this.state.params.acid;
    const color = this.bassColor();
    const note = this.bassMidi(st), f = midiHz(note), subF = midiHz(this.bassMidi(st, 36, 38));
    // A chromatic approach note leads into the next bar and gets out of the way when the chord lands.
    const len = st.ap ? sd * 0.9 : holdNext ? sd * 2 : sd * (0.9 + p.decay * 2);
    if (Math.round(this.state.master.kit || 0) === 1 && this.state.artist?.style !== 'breaks') {
      const kit = this.rec('kit');
      if (kit) return this.sampledBass(kit, t, note, len, st.a);
      loadLiveKit();
    }
    const tri = c.createOscillator(); tri.type = color?.round ?? 'triangle'; tri.frequency.value = f;
    const sub = c.createOscillator(); sub.frequency.value = subF;
    const lp = this.filter('lowpass', 180 + p.cutoff * 0.6 + (st.a ? 500 : 0), 0.7);
    lp.frequency.setTargetAtTime(160 + p.cutoff * 0.3, t + 0.01, 0.08);
    const grit = this.ctx.createWaveShaper(); grit.curve = driveCurve(0.18 + p.drive * 0.5);
    const pick = this.noiseSrc(t, 0.02), pbp = this.filter('bandpass', 1100 + f * 4, 1.2), pg = this.gain(0);
    this.adEnv(pg.gain, t, (st.a ? 0.16 : 0.1) * (color?.pick ?? 1) * (color?.gain ?? 1), 0.0008, 0.012);
    pick.connect(pbp).connect(pg).connect(this.ch.acid.input);
    const amp = this.gain(0), vel = (st.a ? 1 : 0.82) * (1 - p.drive * 0.2) * (this.noteVel ?? 1) * (color?.gain ?? 1);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.006);
    amp.gain.setTargetAtTime(vel * 0.55, t + 0.02, 0.12);
    amp.gain.setTargetAtTime(0, t + len, 0.03);
    const subLevel = this.gain(0.72);
    // A smooth style rolls off the grit's new harmonics above 1.5 kHz at 24 dB/oct, so the bass keeps its definition without tones up among the chords.
    if (color) { tri.connect(lp); lp.connect(grit).connect(this.filter('lowpass', 650, 0.7)).connect(this.filter('lowpass', 650, 0.7)).connect(amp); }
    else if (this.smoothOn) { tri.connect(lp); lp.connect(grit).connect(this.filter('lowpass', 1500, 0.7)).connect(this.filter('lowpass', 1500, 0.7)).connect(amp); } else { tri.connect(lp); lp.connect(grit).connect(amp); }
    sub.connect(subLevel).connect(amp);
    amp.connect(this.ch.acid.input);
    const oscs = [tri, sub];
    if (color) {
      const touch = c.createOscillator(); touch.type = color.wave; touch.frequency.value = f * color.ratio;
      const level = this.gain(0);
      this.adEnv(level.gain, t, color.harmonic * 0.4, 0.006, color.decay);
      touch.connect(level).connect(lp); this.startSource(touch, t); touch.stop(t + len + 0.3);
    }
    // An optional saw layer under the same filter gives the note upper harmonics the triangle lacks.
    if (p.edge) { const saw = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = f; saw.connect(this.gain(p.edge)).connect(lp); oscs.push(saw); }
    for (const o of oscs) { this.startSource(o, t); o.stop(t + len + 0.3); }
  }

  // Choke the previous mono voice; Reese and log drum reuse its pitch on slide steps.
  monoNote(t, f, sliding) {
    const prev = this.mono;
    if (prev && prev.end > t) prev.amp.gain.setTargetAtTime(0, t, sliding ? 0.02 : 0.006);
    this.mono = null;
    return prev && sliding && prev.end > t ? prev.f : f;
  }

  // Tuned 808: sine sub with a pitch knock, long tail on DECAY, CUTOFF/DRIVE add harmonics; slides glide.
  eight08(t, st, sd, holdNext, sliding, kickAt) {
    const c = this.ctx, p = this.state.params.acid;
    const color = this.bassColor();
    const f = midiHz(this.bassMidi(st, 36, 38));
    const len = holdNext ? sd * 2 : 0.15 + p.decay * 1.6, end = t + len + 0.4;
    const decay = Math.max(0.05, len * 0.45), prev = this.mono;
    if (sliding && prev?.eight08 && prev.end > t) {
      // Keep oscillator phase and the envelope's current level through the slide.
      const drill = (this.replay808Style ?? this.state.artist?.style) === 'drill' && f !== prev.f;
      const kickGap = kickAt - t;
      // Let the kick speak first, without pushing the octave into the next step.
      const flickDelay = Math.abs(kickGap) < 0.02 ? Math.max(0.017, Math.min(kickGap + 0.045, sd * 0.5)) : 0.017;
      prev.eight08.forEach((x, i) => {
        const flick = drill && i === 1;
        if (drill && i === 1) x.frequency.cancelScheduledValues(t);
        x.frequency.setTargetAtTime(f * (color && i ? color.ratio : i + 1), t + (flick ? flickDelay : 0), flick ? 0.0055 : 0.0225);
        x.stop(end);
      });
      if (drill) {
        const g = prev.octave.gain;
        const accentAt = t + (flickDelay > 0.017 ? flickDelay : 0);
        g.cancelScheduledValues(t);
        g.setTargetAtTime(0.38, accentAt, Math.min(0.012, sd * 0.12));
        g.setTargetAtTime(0.2, accentAt + Math.min(0.032, sd * 0.32), Math.min(0.02, sd * 0.2));
      }
      prev.amp.gain.cancelScheduledValues(t);
      prev.amp.gain.setTargetAtTime(0, t, decay);
      prev.amp.gain.setTargetAtTime(0, end - 0.09, 0.009);
      Object.assign(prev, { f, end });
      return;
    }
    this.monoNote(t, f, false);
    const knock = sliding ? 1 : color?.knock ?? 1.9;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f * knock, t);
    o.frequency.exponentialRampToValueAtTime(f, t + (color?.settle ?? 0.03));
    const sh = c.createWaveShaper(); sh.curve = driveCurve(0.1 + p.drive * 0.85);
    const lp = this.filter('lowpass', Math.max(80, p.cutoff * 2), 0.7);
    const amp = this.gain(0), vel = (st.a ? 1 : 0.85) * (1 + p.accent * (st.a ? 0.2 : 0)) * 0.9 * (this.noteVel ?? 1) * (color?.gain ?? 1);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.004);
    amp.gain.setTargetAtTime(0, t + 0.02, decay);
    // The longest decays can still be audible when the oscillators stop.
    amp.gain.setTargetAtTime(0, end - 0.09, 0.009);
    // A quiet octave harmonic lets the 808 line read on small speakers without lifting the sub.
    const h2 = c.createOscillator(); h2.type = color?.wave ?? 'triangle';
    h2.frequency.setValueAtTime(f * knock * (color?.ratio ?? 2), t);
    h2.frequency.exponentialRampToValueAtTime(f * (color?.ratio ?? 2), t + (color?.settle ?? 0.03));
    const h2g = this.gain(color ? 0 : 0.2);
    if (color) {
      h2g.gain.setValueAtTime(0, t);
      h2g.gain.linearRampToValueAtTime(color.harmonic, t + 0.004);
      h2g.gain.setTargetAtTime(color.tail, t + 0.008, color.decay);
    }
    o.connect(sh).connect(lp).connect(amp).connect(this.ch.acid.input);
    h2.connect(h2g);
    if (color?.name === 'finger') h2g.connect(this.filter('lowpass', 350, 0.7)).connect(lp);
    else h2g.connect(lp);
    const eight08 = [o, h2];
    for (const x of eight08) { this.startSource(x, t); x.stop(end); }
    this.mono = { amp, f, end, eight08, octave: h2g };
  }

  // UK Garage's bass: a recorded Roland SH-2 (CC0) with its sub oscillator, played mono, each note choking the last.
  // The filter opens on the attack (CUTOFF, ENV MOD, ACCENT) and closes onto CUTOFF; a slide glides the pitch.
  analogBass(t, st, sd, holdNext, sliding) {
    const set = this.rec('abass'), p = this.state.params.acid, m = this.bassMidi(st), f = midiHz(m), prev = this.mono?.amp.gain;
    // The last note's release is already scheduled: drop it so the choke is not undone by it.
    if (prev && this.mono.end > t) { if (prev.cancelAndHoldAtTime) prev.cancelAndHoldAtTime(t); else prev.cancelScheduledValues(t); }
    const from = this.monoNote(t, f, sliding), len = holdNext ? sd * 2 : sd * (1 + p.decay * 6);
    let [c, buf] = set[0];
    for (const [cm, b] of set) if (Math.abs(cm - m) < Math.abs(c - m)) [c, buf] = [cm, b];
    const rate = Math.pow(2, (m - c) / 12), vel = (st.a ? 0.95 : 0.8) * (this.noteVel ?? 1);
    const close = Math.max(500, p.cutoff * 2.2), open = Math.max(close * 1.5, Math.min(10000, p.cutoff * (3 + p.envmod * 8 + (st.a ? (p.accent ?? 0.5) * 3 : 0))));
    const h = this.playBuf(buf, t, vel * ANALOG_BASS_GAIN, this.ch.acid.input, rate, len, { lp: open, lpTo: close, fade: 0.003, release: 0.04, loop: true });
    if (from !== f) { h.s.playbackRate.setValueAtTime(rate * (from / f), t); h.s.playbackRate.exponentialRampToValueAtTime(rate, t + 0.08); }
    this.mono = { amp: h.g, f, end: t + len + 0.3 };
  }
  // Reese: two detuned saws beating against each other plus a sine sub. SAW/SQR sets the detune spread,
  // ENV MOD sweeps the filter, RESO adds bite.
  reese(t, st, sd, holdNext, sliding) {
    if (ANALOG_BASS.has(this.playbackStyle)) {
      if (this.rec('abass')) return this.analogBass(t, st, sd, holdNext, sliding);
      loadBand('abass');
    }
    const c = this.ctx, p = this.state.params.acid;
    const f = midiHz(this.bassMidi(st)), subF = midiHz(this.bassMidi(st, 36, 38));
    const from = this.monoNote(t, f, sliding), len = holdNext ? sd * 2 : sd * (1 + p.decay * 6), end = t + len + 0.3;
    const lp = this.filter('lowpass', p.cutoff, Math.max(0.5, p.reso * 0.35));
    lp.frequency.setValueAtTime(Math.min(9000, p.cutoff * (1 + p.envmod * 5 + (st.a ? p.accent * 2 : 0))), t);
    lp.frequency.setTargetAtTime(p.cutoff, t + 0.01, Math.max(0.03, p.decay * 0.6));
    const sh = c.createWaveShaper(); sh.curve = driveCurve(0.15 + p.drive * 0.7);
    const amp = this.gain(0), vel = (st.a ? 0.95 : 0.8) * (this.noteVel ?? 1);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(vel * 0.5, t + 0.008);
    amp.gain.setTargetAtTime(0, t + len, 0.04);
    const spread = 8 + p.wave * 30;
    for (const [type, det, lvl] of [['sawtooth', -spread, 0.5], ['sawtooth', spread, 0.5], ['sine', 0, 0.9]]) {
      const o = c.createOscillator(); o.type = type; o.detune.value = det;
      const target = type === 'sine' ? subF : f;
      o.frequency.setValueAtTime(type === 'sine' ? subF : from, t);
      if (type !== 'sine' && from !== f) o.frequency.exponentialRampToValueAtTime(target, t + 0.08);
      const g = this.gain(lvl);
      o.connect(g).connect(type === 'sine' ? amp : lp);
      this.startSource(o, t); o.stop(end);
    }
    lp.connect(sh);
    if (this.hardTechno) { sh.oversample = '4x'; sh.connect(this.filter('lowpass', 2400, 0.6)).connect(amp); }
    else sh.connect(amp);
    amp.connect(this.ch.acid.input);
    this.mono = { amp, f, end };
  }

  // Amapiano log drum: a hollow, pitched knock. Sine body with a fast pitch drop, a second-harmonic
  // triangle for the wooden tone and a bandpassed click. CUTOFF sets brightness, DRIVE the grit.
  logdrum(t, st, sd, holdNext, sliding) {
    const c = this.ctx, p = this.state.params.acid, out = this.ch.acid.input;
    const f = midiHz(48 + this.state.key + st.n + Math.round(p.tune) + this.harmRoot());
    const from = this.monoNote(t, f, sliding), len = holdNext ? sd * 2 : 0.1 + p.decay * 0.8, end = t + len + 0.3;
    const o = c.createOscillator(), o2 = c.createOscillator(); o2.type = 'triangle';
    o.frequency.setValueAtTime(sliding ? from : f * 2.4, t);
    o.frequency.exponentialRampToValueAtTime(f, t + (sliding ? 0.07 : 0.025));
    o2.frequency.setValueAtTime(sliding ? from * 2 : f * 4, t);
    o2.frequency.exponentialRampToValueAtTime(f * 2, t + 0.02);
    const g2 = this.gain(0); this.adEnv(g2.gain, t, 0.3, 0.001, Math.max(0.03, len * 0.3));
    const sh = c.createWaveShaper(); sh.curve = driveCurve(0.15 + p.drive * 0.8);
    const lp = this.filter('lowpass', Math.max(200, p.cutoff * 3), 0.7);
    const amp = this.gain(0), vel = (st.a ? 1 : 0.8) * (1 + p.accent * (st.a ? 0.25 : 0)) * 0.8 * (this.noteVel ?? 1);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.002);
    amp.gain.setTargetAtTime(0, t + 0.01, Math.max(0.04, len * 0.35));
    o.connect(sh); o2.connect(g2).connect(sh);
    sh.connect(lp).connect(amp).connect(out);
    this.startSource(o, t); this.startSource(o2, t); o.stop(end); o2.stop(end);
    const nz = this.noiseSrc(t, 0.03), bp = this.filter('bandpass', Math.min(6000, f * 8), 3), ng = this.gain(0);
    this.adEnv(ng.gain, t, 0.25 * vel, 0.0005, 0.012);
    nz.connect(bp).connect(ng).connect(out);
    this.mono = { amp, f, end };
    const sub = lowEnd(this.state.master)?.sub[4];
    if (sub) this.subLayer(t, f, Math.max(0.12, len * 0.7), sub * vel, sliding);
  }

  // Clean sine sub under bass voices that have none. One mono voice, so legato notes glide
  // rather than stack; folded into 33–66 Hz where it adds weight without reaching the low mids.
  subLayer(t, f, len, vel, sliding) {
    while (f > 66) f /= 2;
    while (f < 33) f *= 2;
    let s = this.subVoice;
    if (!s) {
      const o = this.ctx.createOscillator(), amp = this.gain(0);
      o.frequency.value = f; o.connect(amp).connect(this.ch.acid.input); this.startContinuous(o);
      s = this.subVoice = { o, amp };
    }
    s.o.frequency.cancelScheduledValues(t); s.o.frequency.setTargetAtTime(f, t, sliding ? 0.03 : 0.001);
    s.amp.gain.cancelScheduledValues(t);
    s.amp.gain.setTargetAtTime(vel, t, 0.004);
    s.amp.gain.setTargetAtTime(0, t + len, 0.04);
  }

  // FM bass: a driven upper voice over a steady fundamental, with a velocity-sensitive index sweep.
  fmBass(t, st, sd, holdNext, sliding) {
    const c = this.ctx, p = this.state.params.acid;
    const f = midiHz(this.bassMidi(st)), from = this.monoNote(t, f, sliding);
    const len = sd * (holdNext ? 1.2 : 0.62 + p.decay), end = t + len + 0.35;
    const car = c.createOscillator(), mod = c.createOscillator(), sub = c.createOscillator();
    const ratio = 2 + 2 * p.wave;
    for (const [o, k] of [[car, 2], [mod, ratio], [sub, 1]]) {
      o.frequency.setValueAtTime(from * k, t);
      if (from !== f) o.frequency.exponentialRampToValueAtTime(f * k, t + 0.045);
      this.startSource(o, t); o.stop(end);
    }
    const acc = st.a ? p.accent : 0, index = this.gain(0), vel = (st.a ? 1 : 0.83) * (this.noteVel ?? 1);
    index.gain.setValueAtTime(f * (0.55 + p.envmod * 6 + acc), t);
    index.gain.setTargetAtTime(f * (0.35 + p.envmod * 1.7), t + 0.008, 0.05);
    mod.connect(index).connect(car.frequency);
    const drive = c.createWaveShaper(); drive.curve = driveCurve(p.drive * 0.55); drive.oversample = '2x';
    const lp = this.filter('lowpass', Math.min(2800, p.cutoff * (1 + p.envmod)), p.reso * 0.5);
    const amp = this.gain(0);
    car.connect(drive).connect(lp).connect(this.gain(0.72)).connect(amp);
    sub.connect(this.gain(0.88)).connect(amp);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.58 * vel, t + 0.008);
    amp.gain.setTargetAtTime(0, t + len, 0.025);
    amp.connect(this.ch.acid.input);
    this.mono = { amp, f, end };
    this.retire(sub, amp);
  }

  // A single gated oscillator bank for the whole song. Fast pulse lines don't allocate nodes per hit.
  buildPulseBass() {
    const c = this.ctx, lp = this.filter('lowpass', 700, 1), amp = this.gain(0), drive = c.createWaveShaper();
    const waves = [], freqs = [];
    for (const wave of ['sine', 'sawtooth', 'square']) {
      const o = c.createOscillator(), gain = this.gain(0);
      o.type = wave; o.connect(gain).connect(lp); this.startContinuous(o);
      waves.push(gain.gain); freqs.push(o.frequency);
    }
    lp.connect(drive).connect(amp).connect(this.ch.acid.input);
    return { freqs, waves, lp, drive, amp };
  }

  pulseBass(t, st, sd, holdNext, sliding, slideUntil = t) {
    const p = this.state.params.acid;
    if (!this.gatedBasses.has(7)) this.gatedBasses.set(7, this.buildPulseBass());
    const a = this.gatedBasses.get(7);
    const { freqs, waves, lp, drive, amp } = a, f = midiHz(this.bassMidi(st));
    const len = sd * (0.88 - 0.25 * p.wave) + p.decay * 0.23;
    if (this.mono) this.monoNote(t, f, false);
    freqs.forEach((target, i) => {
      const hz = f * (i ? 2 : 1);
      if (sliding) target.setTargetAtTime(hz, t, 0.019); else target.setValueAtTime(hz, t);
    });
    waves[0].setValueAtTime(1, t);
    waves[1].setValueAtTime((1 - p.wave) * 0.18, t);
    waves[2].setValueAtTime(p.wave * 0.62, t);
    lp.Q.setValueAtTime(p.reso * 0.5, t);
    lp.frequency.cancelScheduledValues(t);
    lp.frequency.setValueAtTime(p.cutoff * (1 + p.envmod * (st.a ? 2 : 1)), t);
    lp.frequency.setTargetAtTime(p.cutoff, t + 0.01, 0.035);
    if (a.driveAmount !== p.drive) { drive.curve = driveCurve(p.drive * 0.42); a.driveAmount = p.drive; }
    const v = (st.a ? 0.74 + 0.15 * p.accent : 0.63) * (0.65 + 0.53 * p.wave) * (this.noteVel ?? 1);
    amp.gain.cancelScheduledValues(t);
    if (!sliding) amp.gain.setTargetAtTime(0, t, 0.001);
    amp.gain.setTargetAtTime(v, t + (sliding ? 0 : 0.003), 0.0025);
    amp.gain.setTargetAtTime(v * 0.51, t + 0.008, 0.036);
    const release = holdNext ? Math.max(t + len, t + sd * 1.15, slideUntil) : t + len;
    amp.gain.setTargetAtTime(0, release, 0.016);
  }

  buildHarmonicBass(wide) {
    const c = this.ctx, amp = this.gain(0), drive = c.createWaveShaper(), lp = this.filter('lowpass', 500, 0.7);
    const tone = this.gain(wide ? 0.81 : 0.5);
    const sub = c.createOscillator();
    sub.connect(this.gain(wide ? 1.24 : 0.88)).connect(amp);
    this.startContinuous(sub);
    const freqs = [sub.frequency], detunes = [];
    const seats = wide ? this.sidePans([-0.48, 0.48], lp) : [lp];
    for (const dest of seats) {
      const o = c.createOscillator(); o.type = wide ? 'sawtooth' : 'triangle';
      if (wide) o.connect(this.filter('highpass', 260, 0.7)).connect(dest);
      else o.connect(dest);
      this.startContinuous(o);
      freqs.push(o.frequency); detunes.push(o.detune);
    }
    lp.connect(drive);
    const upper = wide ? drive.connect(this.filter('highpass', 220, 0.7)).connect(this.filter('highpass', 220, 0.7)) : drive;
    if (wide) {
      const shelf = this.filter('highshelf', 650);
      shelf.gain.value = 3.5;
      upper.connect(shelf).connect(tone);
    } else upper.connect(tone);
    tone.connect(amp).connect(this.ch.acid.input);
    return { freqs, detunes, tone, lp, drive, amp };
  }

  harmonicBass(t, st, sd, holdNext, sliding, slideUntil = t) {
    const p = this.state.params.acid, voice = Math.round(p.voice), wide = voice === 8;
    if (!this.gatedBasses.has(voice)) this.gatedBasses.set(voice, this.buildHarmonicBass(wide));
    const bank = this.gatedBasses.get(voice), { freqs, detunes, tone, lp, drive, amp } = bank;
    const f = midiHz(this.bassMidi(st)), sub = midiHz(this.bassMidi(st, 36, 38));
    if (this.mono) this.monoNote(t, f, false);
    for (const [i, param] of freqs.entries()) {
      const hz = i ? f * 2 : sub;
      if (wide && sliding) param.setTargetAtTime(hz, t, 0.02); else param.setValueAtTime(hz, t);
    }
    if (wide) detunes.forEach((param, i) => param.setValueAtTime((i ? 1 : -1) * (10 + p.wave * 34), t));
    else tone.gain.setValueAtTime(0.3 + 0.8 * p.wave, t);
    lp.Q.setValueAtTime(0.5 + p.reso * 0.25, t);
    lp.frequency.cancelScheduledValues(t);
    const accent = st.a ? p.accent : 0;
    lp.frequency.setValueAtTime(Math.min(7500, p.cutoff * (1 + 2 * p.envmod + accent)), t);
    lp.frequency.setTargetAtTime(p.cutoff, t + 0.003, wide ? 0.065 : 0.007);
    if (bank.driveAmount !== p.drive) { drive.curve = driveCurve(0.45 * p.drive); bank.driveAmount = p.drive; }
    const v = (wide ? 1 : 1.75) * (0.56 + 0.24 * accent) * (this.noteVel ?? 1);
    const gain = amp.gain;
    gain.cancelScheduledValues(t);
    if (!wide || !sliding) gain.setTargetAtTime(0, t, 0.001);
    if (wide) {
      gain.setTargetAtTime(v, t + (sliding ? 0 : 0.003), 0.003);
      gain.setTargetAtTime(v * 0.72, t + 0.016, 0.033);
      const release = holdNext ? Math.max(t + sd * 1.15, slideUntil) : t + sd * (0.64 + 2.8 * p.decay);
      gain.setTargetAtTime(0, release, 0.013);
    } else {
      const len = Math.min(sd * 0.85, p.decay);
      gain.setValueAtTime(v * 0.12, t + 0.003);
      gain.linearRampToValueAtTime(v, t + 0.006);
      gain.linearRampToValueAtTime(v * 0.3, t + len * 0.72);
      gain.linearRampToValueAtTime(0, t + len);
    }
  }

  acid(t, st, sliding, holdNext, sd, slideUntil, kickAt) {
    if (st.until != null && Math.round(this.state.params.acid.voice) === 4) return;
    if (st.until != null) {
      const input = this.ch.acid.input, gate = this.gain(1), vo = Math.round(this.state.params.acid.voice);
      gate.connect(input);
      gate.gain.setValueAtTime(1, Math.max(t, st.until - 0.008));
      gate.gain.linearRampToValueAtTime(0, st.until);
      this.ch.acid.input = gate;
      try {
        const result = this.acidVoice(t, st, false, false, sd, slideUntil, kickAt);
        if (vo === 0 || vo >= 7) {
          const amp = vo === 0 ? this.acidNodes.vca : this.gatedBasses.get(vo)?.amp;
          for (const node of [amp, this.subVoice?.amp]) if (node) {
            node.gain.cancelScheduledValues(st.until - 0.018);
            node.gain.setTargetAtTime(0, st.until - 0.018, 0.003);
            node.gain.setValueAtTime(0, st.until);
          }
          gate.gain.setValueAtTime(1, st.targetAt);
        }
        return result;
      } finally { this.ch.acid.input = input; }
    }
    return this.acidVoice(t, st, sliding, holdNext, sd, slideUntil, kickAt);
  }

  acidVoice(t, st, sliding, holdNext, sd, slideUntil, kickAt) {
    const a = this.acidNodes, p = this.state.params.acid;
    if (this.minimal && Math.round(p.voice) === 1) {
      if (this.mono) {
        this.mono.amp.gain.cancelScheduledValues(t);
        this.mono.amp.gain.setTargetAtTime(0, t, 0.005);
        this.mono = null;
      }
      for (const { amp: { gain } } of this.gatedBasses.values()) {
        gain.cancelScheduledValues(t); gain.setTargetAtTime(0, t, 0.005);
      }
      a.vca.gain.setTargetAtTime(0, t, 0.005);
      return this.minimalBass(t, st, sd, holdNext);
    }
    if (this.minimalMono) {
      for (const node of [...this.minimalMono.amps, this.minimalMono.touch]) if (node) {
        node.gain.cancelScheduledValues(t); node.gain.setTargetAtTime(0, t, 0.004);
      }
      this.minimalMono = null;
    }
    const palette = paletteFor(this.state, this.playbackStyle);
    if (palette) {
      a.vca.gain.setTargetAtTime(0, t, 0.005);
      return this.paletteBass(t, st, sd, holdNext, sliding, palette.bass);
    }
    if (this.state.artist?.style === 'dub') {
      a.vca.gain.setTargetAtTime(0, t, 0.005);
      return this.dubSub(t, st, sd, holdNext);
    }
    const vo = Math.round(p.voice);
    for (const [voice, { amp: { gain } }] of this.gatedBasses) if (vo !== voice) {
      gain.cancelScheduledValues(t); gain.setTargetAtTime(0, t, 0.005);
    }
    if (vo > 0) { a.vca.gain.setTargetAtTime(0, t, 0.005); return this[['', 'bass', 'eight08', 'reese', 'logdrum', 'ebass', 'fmBass', 'pulseBass', 'harmonicBass', 'harmonicBass'][vo]](t, st, sd, holdNext, sliding, vo === 2 ? kickAt : slideUntil); }
    const f = midiHz(this.bassMidi(st)), sub = lowEnd(this.state.master)?.sub[0];
    if (sub) this.subLayer(t, midiHz(this.bassMidi(st, 36, 38)), holdNext ? sd * 1.05 : sd * 0.6, sub * (st.a ? 1 : 0.85) * (this.noteVel ?? 1), sliding);
    for (const o of [a.o1, a.o2]) {
      if (sliding) o.frequency.setTargetAtTime(f, t, 0.024);
      else o.frequency.setValueAtTime(f, t);
    }
    const acc = st.a ? p.accent : 0;
    if (!sliding) {
      const amt = 200 + p.envmod * 4400 + acc * 2600;
      const dec = Math.max(0.03, p.decay * (1 - acc * 0.5));
      a.env.offset.cancelScheduledValues(t);
      a.env.offset.setTargetAtTime(amt, t, 0.0015);
      a.env.offset.setTargetAtTime(0, t + 0.007, dec / 3);
      a.vca.gain.cancelScheduledValues(t);
      a.vca.gain.setTargetAtTime((0.6 + acc * 0.5) * (this.noteVel ?? 1), t, 0.0015);
    } else if (acc) {
      a.env.offset.setTargetAtTime(acc * 2200, t, 0.004);
      a.env.offset.setTargetAtTime(0, t + 0.01, p.decay / 3);
    }
    if (!holdNext) a.vca.gain.setTargetAtTime(0, t + sd * 0.55, 0.006);
  }

  dubSub(t, st, sd, holdNext) {
    const f = midiHz(this.bassMidi(st, 36, 38)), len = holdNext ? sd * 1.9 : sd * 1.15;
    const amp = this.gain(0), lp = this.filter('lowpass', 180, 0.5), hp = this.filter('highpass', 27, 0.5);
    const vel = (st.a ? 1 : 0.85) * (this.noteVel ?? 1);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(vel * 1.3, t + 0.012);
    amp.gain.setTargetAtTime(vel * 0.65, t + 0.04, 0.12); amp.gain.setTargetAtTime(0, t + len, 0.055);
    const end = t + len + 0.5; amp.gain.setValueAtTime(0, end);
    lp.connect(hp).connect(amp).connect(this.ch.acid.input);
    for (const [ratio, gain] of [[1, 1], [2, 0.08], [3, 0.025]]) {
      const o = this.ctx.createOscillator(); o.frequency.value = f * ratio;
      o.connect(this.gain(gain)).connect(lp); this.startSource(o, t); o.stop(end);
    }
  }

  acidRelease(t) {
    this.acidNodes.vca.gain.setTargetAtTime(0, t, 0.008);
    for (const { amp: { gain } } of this.gatedBasses.values()) {
      gain.cancelScheduledValues(t);
      gain.setTargetAtTime(0, t, 0.008);
    }
    this.subVoice?.amp.gain.setTargetAtTime(0, t, 0.01);
    if (this.mono) {
      const g = this.mono.amp.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, 0.01);
      this.mono = null;
    }
  }

  // ---------- arrangement FX ----------
  tonalSweep(t, dur, amt, down = false) {
    if (!(dur > 0) || !Number.isFinite(dur) || !(amt > 0) || !Number.isFinite(amt)) return null;
    const c = this.ctx, lp = this.filter('lowpass', down ? 2600 : 350, 0.9), g = this.gain(0), gate = this.gain(0.2);
    const root = (down ? 36 : 48) + (Number.isFinite(this.state.key) ? this.state.key : 0);
    lp.frequency.setValueAtTime(down ? 2600 : 350, t);
    lp.frequency.exponentialRampToValueAtTime(down ? 180 : 3200, t + dur);
    lp.Q.setValueAtTime(0.9, t);
    lp.Q.linearRampToValueAtTime(down ? 0.7 : 1.4, t + dur * 0.8);
    lp.Q.linearRampToValueAtTime(0.7, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((down ? 0.06 : 0.16) * amt, t + dur * (down ? 0.25 : 0.8));
    g.gain.linearRampToValueAtTime(0, t + dur);
    const half = this.stepDur / 2, ticks = Math.max(1, Math.round(dur / half));
    gate.gain.setValueAtTime(0.2, t);
    for (let tick = 0; tick < ticks;) {
      const span = down || tick < ticks / 3 ? 4 : tick < ticks * 2 / 3 ? 2 : 1;
      const at = t + tick * half, end = Math.min(t + dur, at + span * half), width = end - at;
      gate.gain.linearRampToValueAtTime(1, at + width * 0.16);
      gate.gain.linearRampToValueAtTime(1, at + width * 0.5);
      gate.gain.linearRampToValueAtTime(0.2, end);
      tick += span;
    }
    let s;
    for (const [i, semitone] of [0, 12, 24, 7].entries()) {
      const o = c.createOscillator(), voice = this.gain(0);
      o.type = 'sawtooth'; o.detune.value = i % 2 ? 3 : -3;
      o.frequency.setValueAtTime(midiHz(root + semitone), t);
      const levels = [[0.65, 0.4, 0.18], [0.08, 0.5, 0.15], [EPS, 0.12, 0.45], [0.18, 0.15, 0.1]][i];
      if (down) levels.reverse();
      voice.gain.setValueAtTime(levels[0], t);
      voice.gain.linearRampToValueAtTime(levels[1], t + dur / 2);
      voice.gain.linearRampToValueAtTime(levels[2], t + dur);
      o.connect(voice).connect(lp); this.startSource(o, t); o.stop(t + dur + 0.1); s = o;
    }
    lp.connect(gate).connect(g); g.connect(this.mix); g.connect(this.revIn);
    return { s, g };
  }

  hardSection(t, cur, pos, len, next) {
    if (!this.hardTechno) return;
    const dur = this.stepDur * 16;
    const profile = (scene, at = 1) => {
      const build = scene === 5, brk = scene === 4 || build;
      const lift = build ? at : 0, early = scene === 0 || scene === 1;
      return { kick: brk ? 0.7 + 0.3 * lift : 1, acid: brk ? 0.7 + 0.3 * lift : 1,
        ch: brk ? 0.8 + 0.2 * lift : early ? 0.75 : 1, oh: brk ? 0.8 + 0.2 * lift : early ? 0.8 : 1,
        perc: brk ? 0.65 + 0.35 * lift : early ? 0.7 : 1, clap: brk ? 0.65 + 0.35 * lift : 1,
        snare: brk ? 0.65 + 0.35 * lift : 1, ride: brk ? 0.7 + 0.3 * lift : 1,
        stab: scene === 2 ? 0.45 + 0.55 * Math.min(1, at * 4) : 1, vox: 1,
        bite: early ? -2.5 : scene === 2 ? -4.5 + 3 * Math.max(0, at * 2 - 1) : brk ? -1.5 + 5.25 * lift : MASTER_TONE.hardtechno[2],
        db: brk ? -3.25 * (1 - lift) : scene === 0 ? -5 : scene === 1 ? -4 : scene === 2 ? -1 : 0 };
    };
    const target = pos === len - 1 && next !== cur && next != null ? profile(next, 0) : profile(cur, (pos + 1) / len);
    const prev = this.hardLevels || profile(cur, 0);
    this.hardFadeAt = this.gridTime(t + dur);
    this.hardFade = {t, from: prev, to: target, levels: Object.fromEntries(TRACK_IDS.map(id => [id, this.state.params[id].level]))};
    for (const id of TRACK_IDS) {
      const p = this.ch[id].level.gain, level = this.state.params[id].level;
      if (!this.hardLevels) p.setValueAtTime(level * (prev[id] ?? 1), t);
      p.linearRampToValueAtTime(level * (target[id] ?? 1), this.hardFadeAt);
    }
    if (!this.hardLevels) {
      this.secGain.gain.setValueAtTime(10 ** (prev.db / 20), t);
      this.tonePres.gain.cancelScheduledValues(t);
      this.tonePres.gain.setValueAtTime(prev.bite, t);
    }
    if (cur === 5 && pos === len - 1 && next === 6) {
      this.secGain.gain.linearRampToValueAtTime(10 ** (target.db / 20), t + dur - 0.08);
      target.db -= 0.3;
    }
    this.secGain.gain.linearRampToValueAtTime(10 ** (target.db / 20), t + dur);
    this.tonePres.gain.linearRampToValueAtTime(target.bite, t + dur);
    this.hardLevels = target;
    if (cur === 5 && pos === 0) this.tonalSweep(t, dur * len, 0.8);
    if (cur === 4 && pos === 0) this.tonalSweep(t, dur * 2, 0.4, true);
  }

  festivalGap(t, dur, amount = 1) {
    if (!(amount > 0) || !festivalTrap(this.playbackStyle, this.state.params.stab.voice)) return;
    const g = this.festivalGate?.gain;
    if (!g) return;
    g.setValueAtTime(1, t);
    g.exponentialRampToValueAtTime(0.16 ** amount, t + Math.min(0.06, dur * 0.25));
    g.exponentialRampToValueAtTime(0.0003 ** amount, t + dur - 0.004);
    g.linearRampToValueAtTime(1, t + dur);
  }

  sweep(t, dur, amt, profile) {
    if (this.hardTechno) return this.tonalSweep(t, dur, amt);
    const s = profile?.tone ? this.ctx.createOscillator() : this.noiseSrc(t, dur + 0.05);
    const bp = this.filter('bandpass', profile?.low || 500, profile ? 0.7 : 2), g = this.gain(0);
    if (profile?.tone) {
      s.type = 'triangle'; s.frequency.setValueAtTime(profile.low, t);
      s.frequency.exponentialRampToValueAtTime(profile.high, t + dur);
      this.startSource(s, t); s.stop(t + dur + 0.05);
    }
    bp.frequency.setValueAtTime(profile?.low || 500, t); bp.frequency.exponentialRampToValueAtTime(profile?.high || 8000, t + dur);
    g.gain.setValueAtTime(EPS, t);
    if (profile) {
      for (let i = 1; i <= 16; i++) g.gain.linearRampToValueAtTime((profile.tone ? 0.12 : 0.32) * amt * (i / 16) ** profile.curve, t + dur * 0.97 * i / 16);
    } else g.gain.exponentialRampToValueAtTime(0.32 * amt, t + dur * 0.97);
    g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(bp).connect(g); g.connect(this.mix); g.connect(this.revIn);
    return { s, g };
  }

  impact(t, amt) {
    if (this.hardTechno) { this.tonalSweep(t, 16 * this.stepDur, amt * 0.45, true); return; }
    const o = this.ctx.createOscillator(), g = this.gain(0);
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    this.adEnv(g.gain, t, 0.5 * amt, 0.002, 0.9);
    o.connect(g).connect(this.mix); this.startSource(o, t); o.stop(t + 1.2);
    const n = this.noiseSrc(t, 1.6), hp = this.filter('highpass', 3000, 0.5), ng = this.gain(0);
    this.adEnv(ng.gain, t, 0.16 * amt, 0.001, 1.4);
    n.connect(hp);
    if (this.hardTechno) hp.connect(this.filter('lowpass', 7500, 0.6)).connect(this.gain(0.55)).connect(ng);
    else hp.connect(ng);
    ng.connect(this.mix); ng.connect(this.revIn);
  }

  sectionGain(t, db, ramp = 0) {
    const g = (this.playbackStyle === 'euphoric' ? this.secPreGain : this.secGain).gain, v = 10 ** (db / 20);
    g.cancelScheduledValues(t);
    if (ramp) {
      const [from, dur, hold = 0] = ramp, start = 10 ** (from / 20);
      g.setValueAtTime(start, t);
      if (hold) g.setValueAtTime(start, t + hold);
      if (dur) g.linearRampToValueAtTime(v, t + hold + dur);
    } else g.setTargetAtTime(v, t, 0.012);
  }

  hardFilter(t, targets) {
    const f = this.arrLP.frequency, points = this.hardFilterRamp || [[f.value, this.ctx.currentTime]];
    let [value, start] = points[0];
    for (const [next, end] of points.slice(1)) {
      if (t < end) { value *= (next / value) ** Math.max(0, (t - start) / (end - start)); break; }
      value = next; start = end;
    }
    if (f.cancelAndHoldAtTime) f.cancelAndHoldAtTime(t);
    else { f.cancelScheduledValues(t); f.exponentialRampToValueAtTime(value, t); }
    for (const [v, end] of targets) f.exponentialRampToValueAtTime(v, end);
    const past = points.filter((p) => p[1] < t);
    let first = 0;
    while (first + 1 < past.length && past[first + 1][1] <= this.ctx.currentTime) first++;
    this.hardFilterRamp = [...past.slice(first), [value, t], ...targets];
  }

  // Breakdowns start dark and open back up over the whole section
  breakSweep(t, dur, smooth) {
    const f = this.arrLP.frequency;
    if (this.hardTechno) {
      this.hardFilter(t, [[10000, t + Math.min(dur * 0.25, 16 * this.stepDur)], [18000, t + dur]]);
    } else {
      f.cancelScheduledValues(t);
      // A smooth style glides into the dark over a beat instead of cutting to it.
      if (smooth) { f.setValueAtTime(f.value, t); f.setTargetAtTime(900, t, 0.12); f.setTargetAtTime(18000, t + 0.6, dur / 3); } else { f.setValueAtTime(700, t); f.exponentialRampToValueAtTime(18000, t + dur); }
    }
    this.arrClosed = true;
  }

  // A smooth drop: the bar before it slowly closes the filter, and the drop opens it back up, with no riser or boom.
  dropDip(t, dur) {
    const f = this.arrLP.frequency;
    f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.exponentialRampToValueAtTime(4000, t + dur);
    this.arrClosed = true;
  }

  breakOpen(t, smooth) {
    if (!this.arrClosed) return;
    const f = this.arrLP.frequency;
    if (this.hardTechno) this.hardFilter(t, [[21000, t + 16 * this.stepDur]]);
    else { f.cancelScheduledValues(t); f.setTargetAtTime(21000, t, smooth ? 0.09 : 0.02); }
    this.arrClosed = false;
  }

  // ---------- performance (realtime) ----------
  setThrow(on) { this.throwBus.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.012); }

  riserStart() {
    if (this.riser) return;
    const now = this.ctx.currentTime;
    // Audible within a beat, peaks after 2 bars
    const dur = this.stepDur * 32;
    if (this.hardTechno) { this.riser = this.tonalSweep(now, dur, 1); return; }
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const bp = this.filter('bandpass', 400, 2.5);
    const g = this.gain(0);
    bp.frequency.setValueAtTime(400, now);
    bp.frequency.exponentialRampToValueAtTime(9000, now + dur);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.12, now + 0.05);
    g.gain.linearRampToValueAtTime(this.hardTechno ? 0.25 : 0.55, now + dur);
    s.connect(bp).connect(g);
    g.connect(this.mix); g.connect(this.revIn);
    s.start(now);
    this.riser = { s, g };
  }

  riserStop() {
    if (!this.riser) return;
    const now = this.ctx.currentTime;
    const { s, g } = this.riser;
    if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(now); else g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(0, now, 0.03);
    s.stop(now + 0.6);
    this.riser = null;
  }

  // ---------- song handoff (GENERATE while playing) ----------
  // The outgoing song thins out into the switch downbeat t1: the DJ high-pass climbs with
  // the drop sweep's noise riser, then both are gone exactly on t1 so the next kick lands full.
  handoffOut(t0, t1) {
    this.handoffCancel();
    const dur = Math.max(0.05, t1 - t0), end = t1 - Math.min(0.012, dur / 4);
    const { hp, q } = djFilter(this.state.master.dj || 0);
    const f = this.djHP.frequency, Q = this.djHP.Q;
    f.cancelScheduledValues(t0); f.setValueAtTime(hp, t0); f.exponentialRampToValueAtTime(Math.max(hp, 1100), end);
    Q.cancelScheduledValues(t0); Q.setValueAtTime(q, t0); Q.linearRampToValueAtTime(Math.max(q, 3.2), end);
    this.handoff = { t1, end, noise: this.sweep(t0, dur, 0.7) };
  }

  // Called while scheduling the switch step: every param of the new song lands on t1, not now.
  handoffIn(t1) {
    this.hardFadeAt = null;
    if (this.jamParams?.size || this.jamDrives) this.scheduleJamParams(this.state.params, t1);
    const h = this.handoff;
    this.handoff = null;
    this.at = this.gridTime(Math.max(this.ctx.currentTime, t1));
    try { this.applyAll(); this.applyDelayTime(); } finally { this.at = 0; }
    this.acidRelease(t1);
    this.breakOpen(t1);
    if (!h) return;
    const { hp, q } = djFilter(this.state.master.dj || 0);
    const f = this.djHP.frequency, Q = this.djHP.Q;
    f.cancelScheduledValues(h.end + 1e-4); f.exponentialRampToValueAtTime(hp, t1);
    Q.cancelScheduledValues(h.end + 1e-4); Q.linearRampToValueAtTime(q, t1);
  }

  // Stop (or a seek) before the switch: put the DJ filter back and silence the riser.
  handoffCancel() {
    const h = this.handoff;
    if (!h) return;
    this.handoff = null;
    const now = this.ctx.currentTime;
    h.noise.g.gain.cancelScheduledValues(now); h.noise.g.gain.setValueAtTime(0, now);
    try { h.noise.s.stop(now); } catch {}
    const { hp, q } = djFilter(this.state.master.dj || 0);
    for (const [p, v] of [[this.djHP.frequency, hp], [this.djHP.Q, q]]) {
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else p.cancelScheduledValues(now);
      p.setTargetAtTime(v, now, 0.03);
    }
  }

  prepareVocal(state = this.state) {
    const v = this.vocalOf?.(state);
    if (!v) return;
    this.vocalSends(v.fx, true);
    const buffer = processedStem(v.buf, v.fx, this.ctx);
    singingEnvelope(v.buf);
    if (buffer !== v.buf) singingEnvelope(buffer);
  }

  // Integrate the same future rate ramp as the grid without interrupting the stem.
  slewVocal(delta, from, duration, rate, endRate, profile = null) {
    const cur = this.vocalNow;
    if (!cur || from + 1e-9 < cur.at || from < this.ctx.currentTime + 0.005 ||
        Math.abs(rate - (cur.slewRate ?? 1)) > 1e-12) return false;
    const end = from + duration + delta;
    if (end <= (cur.slewEnd ?? -Infinity) || from + 1e-9 < (cur.slewEnd ?? -Infinity)) return false;
    const param = cur.src.playbackRate;
    if (cur.slewEnd === undefined || cur.slewRate === 1)
      param.setValueAtTime(cur.slewRate ?? 1, Math.max(from, cur.slewEnd ?? from));
    else if (from > cur.slewEnd + 1e-9)
      param.linearRampToValueAtTime(rate, from);
    param.linearRampToValueAtTime(endRate, end);
    if (cur.slewEnd !== undefined && from > cur.slewEnd + 1e-9)
      cur.origin += (1 - cur.slewRate) * (from - cur.slewEnd);
    cur.slewEnd = end;
    cur.slewRate = endRate;
    cur.slewProfile = profile;
    cur.origin += delta;
    return true;
  }

  cancelVocalSlew() {
    const cur = this.vocalNow;
    if (!cur || cur.slewEnd === undefined || cur.slewRate === 1) return;
    const end = Math.max(this.ctx.currentTime, cur.slewEnd);
    cur.origin += (1 - cur.slewRate) * (end - cur.slewEnd + 1 / this.ctx.sampleRate);
    const param = cur.src.playbackRate;
    param.cancelScheduledValues(end + 1 / this.ctx.sampleRate);
    param.setValueAtTime(1, end + 1 / this.ctx.sampleRate);
    cur.slewEnd = end + 1 / this.ctx.sampleRate;
    cur.slewRate = 1;
    cur.slewProfile = null;
  }

  // Keep a continuous stem across bars; discarding the queue on a clock jump stops it.
  // On wake, gridTime can precede t: advance the source offset instead of moving the stem.
  vocal(t, pos, step = 0, gridTime, reanchor = false, settling = false, gapSpan) {
    const v = pos >= 0 ? this.vocalOf?.(this.state) : null, cur = this.vocalNow;
    const sd = this.vocalStepDur;
    const phase = v ? (pos * 16 + step) * sd - v.ms / 1000 : 0;
    let origin = (gridTime ?? t) - phase;
    const continuous = cur && v && cur.buf === v.buf && (cur.next === pos || (reanchor && cur.next === pos + 1) || (settling && pos >= cur.next - 1)) && cur.sd === sd && cur.ms === v.ms;
    if (continuous && (settling || Math.abs(origin - cur.origin) <= 0.03)) {
      if (reanchor && !settling) {
        if (cur.gapCorrection) cur.gapCorrection = null;
        cur.correction = null;
      }
      cur.next = pos + 1;
      this.vocalBus.gain.setTargetAtTime(v.gain, t, 0.02);
      return true;
    }
    let forced = false, crossfade = null, alignment = null, fallbackFadeGuard;
    if (continuous && reanchor) {
      const errorMs = (origin - cur.origin) * 1000;
      const index = pos * 16 + step, rubato = this.vocalRubato;
      const newCorrection = () => ({id:this.vocalCorrectionSerial = (this.vocalCorrectionSerial || 0) + 1, forceFrom:null, forceStep:null});
      // A pending rubato gap must not interrupt the transport's own slew.
      alignment = rubato ? cur.gapCorrection ||= newCorrection() : cur.correction ||= newCorrection();
      if (rubato) {
        alignment.forceFrom ??= index;
        const downbeat = Math.ceil(index / 16) * 16;
        const waitDeadline = Math.ceil((alignment.forceFrom + 32) / 16) * 16;
        alignment.forceStep = Math.abs(errorMs) > 100 + 1e-6 ? downbeat : Math.max(downbeat, waitDeadline);
      } else if (Math.abs(errorMs) > 60 + 1e-6) {
        if (alignment.forceFrom === null) {
          alignment.forceFrom = index;
          alignment.forceStep = vocalReanchorStep(index);
        }
        if (index > alignment.forceStep) alignment.forceStep = Math.ceil(index / 16) * 16;
      } else {
        alignment.forceFrom = alignment.forceStep = null;
      }
      const buffer = processedStem(v.buf, v.fx, this.ctx);
      const voices = [...(this.vocalRetiring || []), cur];
      singingEnvelope(buffer);
      const ready = Math.max(this.ctx.currentTime + 0.02, ...voices.map(voice => voice.slewEnd ?? -Infinity));
      const quiet = (at, source = buffer) => {
        const audio = source.getChannelData(0), window = Math.ceil(source.sampleRate * 0.06);
        const first = Math.floor(at * source.sampleRate);
        if (first < 0 || first + window > audio.length) return false;
        let energy = 0;
        for (let i = first; i < first + window; i++) energy += audio[i] * audio[i];
        return energy / window < 0.0001;
      };
      const quietDuringFade = (voice, when) => {
        const rate = voice.slewRate ?? 1;
        const phase = when - voice.origin + (rate - 1) * (when - (voice.slewEnd ?? when));
        const source = voice.src.buffer;
        singingEnvelope(source);
        return phraseGaps.get(source).some(g => g.from <= phase && phase + 0.06 * rate <= g.to);
      };
      const findGap = (anchor, first, last, shift) => {
        for (const g of phraseGaps.get(buffer)) {
          const end = g.to - 0.08 - Math.max(0, shift);
          const start = rubato ? Math.max(first, g.from - Math.min(0, shift)) : end;
          if (start < first || start > Math.min(end, last) || start < g.from || !quiet(start)) continue;
          const when = anchor + start;
          const audible = voices.filter(voice => voice.startAt <= when && (voice.until ?? Infinity) > when);
          if (audible.every(voice => rubato ? quietDuringFade(voice, when) : quiet(when - voice.origin, voice.src.buffer)))
            return {start, onset:g.to};
        }
      };
      let silence, previousGrid;
      if (rubato) {
        const grid = gridTime ?? t, prev = alignment.grid;
        const consecutive = prev?.index === index - 1 && prev.grid < grid;
        if (consecutive) previousGrid = prev.grid;
        const plan = consecutive ? alignment.gapPlan : null;
        alignment.grid = {index, grid, origin};
        alignment.gapPlan = null;
        // Keep the early gap's phase, but don't commit audio until the scheduler reaches its time.
        if (plan && plan.when <= grid) {
          silence = findGap(plan.origin, Math.max(plan.when, ready) - plan.origin, grid - plan.origin, plan.origin - cur.origin);
          if (silence) origin = plan.origin;
        }
        if (!silence && consecutive && (!plan || plan.when <= grid || alignment.forceStep === index)) {
          silence = findGap(prev.origin, Math.max(prev.grid, ready) - prev.origin, grid - prev.origin, prev.origin - cur.origin);
          if (silence) origin = prev.origin;
        }
        if (!silence && (!plan || plan.when <= grid || alignment.forceStep === index))
          silence = findGap(origin, Math.max(phase, ready - origin), phase, origin - cur.origin);
        if (!silence && plan?.when > grid) alignment.gapPlan = plan;
        else if (!silence && alignment.forceStep > index) {
          const future = findGap(origin, Math.max(phase, ready - origin), phase + 16 * sd, origin - cur.origin);
          if (future) {
            const when = origin + future.start;
            // Queue early only if the gap is safely before the scheduler's earliest deadline.
            if (when - grid < (gapSpan?.(alignment.forceStep - index) ?? 0)) silence = future;
            else alignment.gapPlan = {origin, when};
          }
        }
        if (silence) t = origin + silence.start;
      } else {
        const latest = ((alignment.forceFrom ?? index) + 32) * sd - v.ms / 1000;
        silence = findGap(origin, Math.max(phase, ready - origin), latest, t - cur.origin - phase);
        if (silence) t += silence.start - phase;
      }
      const gap = !!silence;
      forced = !gap && alignment.forceStep === index;
      if (forced && (t < this.ctx.currentTime + 0.02 || phase < 0 || phase >= v.buf.duration)) {
        alignment.forceStep += 16;
        forced = false;
      }
      const mandatoryRubato = rubato && forced;
      const retiringUntil = rubato && !gap ? Math.max(...(this.vocalRetiring || []).map(voice => voice.until)) : -Infinity;
      let spliceAdvance = 0;
      if (rubato && !gap && previousGrid != null && t >= ready) {
        let tryEarly = false;
        if (!forced && index % 4 === 0 && alignment.forceStep > Math.ceil(index / 16) * 16 &&
            phase >= 0 && phase < buffer.duration && Math.abs(errorMs) > RUBATO_EARLY_DRIFT_MS) {
          const span = gapSpan?.(16), bar = Number.isFinite(span) ? span : 16 * sd;
          const rate = cur.slewRate ?? 1;
          const outgoingPhase = t - cur.origin + (rate - 1) * (t - (cur.slewEnd ?? t));
          // Keep waiting if either playhead can reach a phrase gap before the next downbeat.
          tryEarly = !hasUpcomingVocalGap(buffer, phase, bar) &&
            !hasUpcomingVocalGap(cur.src.buffer, outgoingPhase, bar, rate);
        }
        if (forced || tryEarly) {
          const spliceAt = rubatoSpliceTime(buffer, cur, origin, t, ready, previousGrid, retiringUntil, tryEarly);
          if (spliceAt !== null && spliceAt >= this.ctx.currentTime + 0.02) {
            forced = true;
            alignment.forceStep = index;
            spliceAdvance = t - spliceAt;
            t = spliceAt;
          }
        }
      }
      if (mandatoryRubato) {
        if (t < cur.startAt || t < (cur.slewEnd ?? -Infinity) || t < retiringUntil) fallbackFadeGuard = {unmeasured:true};
        else {
          const outgoing = cur.src.buffer, from = vocalPhaseAfterSlew(cur, t), to = gridTime == null ? phase : t - origin;
          const rate = cur.slewRate ?? 1, broadband = vocalFadePowerRatio(outgoing, buffer, from, to, rate);
          const ratios = {broadband, ...vocalFadeBandPowerRatios(outgoing, buffer, from, to, rate)};
          if (Object.values(ratios).some(ratio => ratio < VOCAL_FADE_MIN_POWER_RATIO))
            fallbackFadeGuard = {dipDb:Object.fromEntries(Object.entries(ratios).map(([band, ratio]) => [band, -10 * Math.log10(Math.max(ratio, 1e-12))]))};
        }
      }
      this.vocalCorrection = { at:t, origin, previousOrigin:cur.origin, errorMs:(origin - cur.origin) * 1000, gap, nextOnset:silence?.onset,
        correctionId:alignment.id, forced, forceStep:alignment.forceStep, spliceAdvance, crossfadeSeconds:forced ? VOCAL_FADE_SECONDS : null,
        fallbackFadeGuard };
      if (!gap && !forced) {
        cur.next = pos + 1;
        this.vocalBus.gain.setTargetAtTime(v.gain, t, 0.02);
        return false;
      }
    }
    if (forced) {
      crossfade = this.ctx.createGain();
      crossfade.connect(this.vocalBus);
      crossfade.gain.setValueCurveAtTime(vocalCrossfade(false), t, VOCAL_FADE_SECONDS);
      const voices = [...(this.vocalRetiring || []), cur].filter(voice =>
        (voice.until ?? Infinity) > this.ctx.currentTime && voice.origin + voice.src.buffer.duration > this.ctx.currentTime);
      for (const output of new Set(voices.map(voice => voice.output || voice.g))) {
        output.disconnect(this.vocalBus);
        output.connect(crossfade);
      }
      let remaining = voices.length;
      this.vocalRetiring = voices.map(voice => {
        const until = Math.min(voice.until ?? Infinity, voice.startAt >= t ? t : t + VOCAL_FADE_SECONDS);
        voice.src.stop(until);
        voice.src.addEventListener?.('ended', () => { if (!--remaining) crossfade.disconnect(); }, {once:true});
        return {...voice, output:crossfade, stopAt:t, until};
      });
      this.vocalNow = null;
    } else this.vocalStop(t);
    if (!v) return;
    if (phase >= v.buf.duration) return;
    if (!forced) this.vocalSends(v.fx);
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = processedStem(v.buf, v.fx, this.ctx);
    if (gridTime != null) t = Math.max(t, this.ctx.currentTime + 0.005);
    const off = gridTime == null ? phase : t - origin;
    if (off >= v.buf.duration) return;
    if (forced) {
      g.gain.setValueAtTime(0, this.ctx.currentTime);
      g.gain.setValueCurveAtTime(vocalCrossfade(true), t, VOCAL_FADE_SECONDS);
    } else if (off > 0.001) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.012); }
    src.connect(g).connect(this.vocalBus);
    if (!forced) this.vocalBus.gain.setValueAtTime(v.gain, t);
    if (off < 0) this.startSource(src, t - off); else this.startSource(src, t, off);
    if (fallbackFadeGuard) this.lastVocalFallbackFadeGuard = {at:t, step:pos * 16 + step, ...fallbackFadeGuard};
    this.vocalNow = { src, g, buf: v.buf, next: pos + 1, sd, ms: v.ms, origin, at: t - Math.min(0, off), startAt:off < 0 ? t - off : t };
    if (forced) return true;
    if (v.duck < 1) this.duckUnder(v.buf, this.bandDuck.gain, v.duck, t, t - off);
    if (v.lift < 1) this.duckUnder(v.buf, this.singTrim.gain, v.lift, t, t - off);
    // hookCarve: the exported hook stem's copy of the CHORDS channel (js/stems.js).
    for (const carve of [this.ch.stab?.carve, this.hookCarve]) {
      if (!carve || !v.fx?.carve) continue;
      carve.frequency.setValueAtTime(v.fx.carve.hz, t);
      this.duckUnder(v.buf, carve.gain, -v.fx.carve.db, t, t - off, 0);
    }
    return true;
  }

  // The vocal's reverb (a plate, or a short room) and tempo-synced slap/delay sends, built on first use, set per genre
  // (VOCAL_FX in js/sing.js): they return through vocalOut, so they ride the vocal's level and its stem.
  vocalSends(fx, prepare = false) {
    const c = this.ctx, now = c.currentTime;
    if (!this.vocalFx) {
      const plateSend = this.gain(0), plate = c.createConvolver(), dlySend = this.gain(0);
      const dly = c.createDelay(2), fb = this.gain(0), hp = this.filter('highpass', 280), lp = this.filter('lowpass', 4800);
      this.vocalBus.connect(plateSend).connect(this.filter('highpass', 220)).connect(plate).connect(this.vocalOut);
      this.vocalBus.connect(dlySend).connect(hp).connect(lp).connect(dly).connect(this.vocalOut);
      dly.connect(fb).connect(hp);
      this.vocalFx = { plateSend, plate, dlySend, dly, fb, ir: '', impulses: new Map() };
    }
    const F = this.vocalFx, r = fx?.reverb || { kind: 'plate', sec: 1.8, send: 0.16 }, d = fx?.delay;
    // A plate, or a short, darker room: its own IR so the reverb stays in the vocal's stem.
    const room = r.kind === 'room', sec = r.sec || (room ? 0.8 : 1.8), ir = `${r.kind}:${sec}`;
    if (!F.impulses.has(ir)) {
      F.impulses.set(ir, makeIR(c, sec, room ? { decay: 4.5, brightStart: 0.6, brightEnd: 0.2, predelay: 0.006, seed: 89 }
        : { decay: 3.2, brightStart: 0.9, brightEnd: 0.35, predelay: 0.012, seed: 97 }));
    }
    if (F.ir !== ir && (!prepare || !F.ir)) {
      F.plate.buffer = F.impulses.get(ir);
      F.ir = ir;
    }
    if (prepare) return;
    F.plateSend.gain.setTargetAtTime(r.send, now, 0.02);
    F.dly.delayTime.setTargetAtTime(d ? Math.min(1.9, (d.beats * 60) / this.state.bpm) : 0.25, now, 0.02);
    F.dlySend.gain.setTargetAtTime(d ? d.send : 0, now, 0.02);
    F.fb.gain.setTargetAtTime(d ? d.fb : 0, now, 0.02);
  }

  // A gain that follows the stem's singing envelope down to `depth`; t0 is when the stem's first sample plays.
  // `rest` is its value where the stem is silent (a filter's dB gain rests at 0).
  duckUnder(buf, p, depth, t, t0, rest = 1) {
    const env = singingEnvelope(buf), start = Math.max(t, t0) + 0.02;
    const i = Math.ceil((start - t0) * ENV_RATE), n = env.length - i;
    if (n < 2) return;
    const curve = new Float32Array(n);
    for (let k = 0; k < n; k++) curve[k] = rest + env[i + k] * (depth - rest);
    p.setTargetAtTime(curve[0], t + 1 / this.ctx.sampleRate, 0.01);
    p.setValueCurveAtTime(curve, t0 + i / ENV_RATE, (n - 1) / ENV_RATE);
  }

  vocalStop(t = this.ctx.currentTime) {
    const cur = this.vocalNow, retiring = (this.vocalRetiring || []).filter(v => v.until > this.ctx.currentTime);
    const voices = [...retiring.filter(v => v.stopAt > t), ...(cur ? [cur] : [])];
    this.vocalRetiring = retiring.filter(v => v.stopAt <= t);
    if (!voices.length) return;
    this.vocalNow = null;
    const carves = [this.ch.stab?.carve?.gain, this.hookCarve?.gain].filter(Boolean);
    for (const p of [this.bandDuck.gain, this.singTrim.gain, ...carves]) {
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t);
      // A held curve's rounded endpoint can extend just past t.
      p.setTargetAtTime(carves.includes(p) ? 0 : 1, t + 1 / this.ctx.sampleRate, 0.08);
    }
    for (const voice of voices) {
      if (voice.g.gain.cancelAndHoldAtTime) voice.g.gain.cancelAndHoldAtTime(t); else voice.g.gain.cancelScheduledValues(t);
      voice.g.gain.setTargetAtTime(0, t + 1 / this.ctx.sampleRate, 0.008);
      try { voice.src.stop(t + 0.06); } catch { /* not started */ }
      this.vocalRetiring.push({...voice, stopAt:t, until:t + 0.06});
    }
  }

  panic() {
    const now = this.ctx.currentTime;
    this.voxPrev = undefined;
    this.vocalStop(now);
    this.handoffCancel();
    this.breakOpen(now);
    this.acidRelease(now);
    this.riserStop();
    this.setThrow(false);
  }
}

// DJ filter knob (-1 low-pass .. +1 high-pass) to cutoffs and resonance.
export function djFilter(v) {
  return { hp: v > 0 ? 10 * Math.pow(2, v * 10.3) : 10, lp: v < 0 ? 21000 * Math.pow(2, v * 9.2) : 21000, q: 0.9 + Math.abs(v) * 3.5 };
}

export function parseChain(str) {
  return (str || '').toUpperCase().replace(/[^A-H]/g, '').split('').map((ch) => ch.charCodeAt(0) - 65);
}

const DRUMS = new Set(['kick', 'clap', 'snare', 'ch', 'oh', 'ride', 'perc']);
// Hats choke other hits; acid slides and stab voicings also carry state across steps.
const EDITABLE_HITS = new Set(['kick', 'clap', 'snare', 'ride', 'perc', 'vox']);
const HIT_EDIT_GUARD = 0.012;

// Alternate repeats within a phrase and on the next pass, without a counter to reset on seek.
function windTake(notes, index, pitchIndex, pass) {
  const pitch = notes[index][pitchIndex];
  for (let i = 0; i < index; i++) if (notes[i]?.[pitchIndex] === pitch) pass++;
  return pass % 2;
}

// Is the hook sounding at (or about to play) step hi? A note started k steps ago still rings for its length.
function hookBusy(hk, hi, hm) {
  const plays = (j) => hk.s[j] && (hm > 1 || j < 16);
  for (let k = 0; k < 16; k++) { const j = (hi - k + 32) % 32; if (plays(j) && hk.s[j][1] > k) return true; }
  return plays((hi + 1) % 32);
}

// Output level per song section (dB). The verse sits under the chorus; the chorus's small lift keeps the
// song's integrated loudness where it was and stays inside the -1 dBTP ceiling.
const SECTION_DB = { verse: -1.8, chorus: 0.45 };
// Pop's and country's bands already play a much fuller chorus than their verse (pop's moving chorus, country's
// boom-chick verse; pop's chorus strings), so their verse gives back less level.
// Styles that move between sections with filter glides instead of risers, snare rolls and impacts.
const SMOOTH = new Set(['minimal']);
const STYLE_SECTION_DB = { pop: { verse: -0.9 }, rnb: { chorus: 0.25 }, deephouse: { chorus: 0.25 }, country: { verse: -0.8 } };

export class Sequencer {
  constructor(engine, state) {
    this.e = engine;
    this.s = state;
    this.cur = state.current;
    this.queued = null;
    this.chainPos = 0;
    // Transport step the playing song started on (a GENERATE handoff keeps the clock running).
    this.origin = 0;
    this.roll = null;
    this.acidPrevSlide = false;
    this.acidMuted = false;
  }

  startAt(abs, t) {
    this.e.voxPrev = undefined;
    const chain = this.s.chainOn ? parseChain(this.s.chain) : [];
    const bar = Math.floor(abs / 16), offset = abs % 16;
    const pos = chain.length ? bar % chain.length : -1;
    this.cur = pos >= 0 ? chain[pos] : this.s.current;
    this.chainPos = bar + (offset ? 1 : 0);
    this.origin = 0;
    this.queued = null;
    this.acidPrevSlide = false;
    this.finished = false;
    if (offset && pos >= 0 && !(this.s.ending && chain.length >= 16 && bar >= chain.length))
      this.verseFillSwell(t, chain, pos, offset);
  }

  rewind(abs, t) {
    const step = abs - this.origin, bar = Math.floor(step / 16);
    this.chainPos = bar;
    if (step % 16 !== 0) this.advanceBar(bar * 16, t, step % 16);
  }

  // The same score durations as tick(), without advancing the sequencer or queueing audio.
  gridSpan(abs, steps, skip) {
    const first = abs - this.origin, stepInBar = first % 16, firstBar = this.chainPos - 1;
    const n = this.songBars, nominal = this.e.vocalStepDur;
    let duration = 0, tempo;
    for (let offset = 0; offset < steps; offset++) {
      const step = first + offset;
      if (!offset || step % 16 === 0) {
        const bar = firstBar + Math.floor((stepInBar + offset) / 16);
        if (offset && skip?.(bar)) return 0;
        const pos = n ? bar % n : -1;
        const pat = patternAt(this.s.patterns[pos >= 0 ? this.chainArr[pos] : this.cur], pos);
        tempo = pat?.score ? compose(pat.score).tempo : null;
      }
      duration += offset === 0 ? this.e.stepDur : (tempo?.[step % tempo.length] || 1) * nominal;
    }
    if (skip?.(firstBar + Math.floor((stepInBar + steps) / 16))) return 0;
    return duration;
  }

  // Song form: C and G are drops, E and F breakdowns, D and H one-bar fills/switches
  advanceBar(abs, t, offset = 0) {
    if (abs % 16 !== 0) return;
    const chain = this.s.chainOn ? parseChain(this.s.chain) : [];
    const style = this.e.playbackStyle ?? this.s.artist?.style;
    const seed = this.e.playbackSeed ?? this.s.artist?.seed;
    const buildKey = `${this.s.chainOn}:${this.s.chain}:${style}:${this.s.params.stab.voice}:${seed}`;
    if (this.festivalKey !== buildKey) {
      this.festivalKey = buildKey;
      this.festivalPlan = this.s.chainOn ? festivalBuilds(chain.map((i) => 'ABCDEFGH'[i]).join(''), style, this.s.params.stab.voice, seed) : [];
    }
    const arr = this.s.master.arr || 0;
    this.dropNow = !!this.dropNext; this.dropNext = false;
    this.songBars = chain.length; this.chainArr = chain;
    this.chainEntries = cleanChainEntries(this.s.chain, this.s.chainEntries);
    if (this.liftChain !== this.s.chain) {
      // The final chorus: the last run of peak bars, if an earlier peak came before it.
      let i = chain.length - 1;
      while (i >= 0 && chain[i] !== 6) i--;
      while (i > 0 && (chain[i - 1] === 6 || chain[i - 1] === 7)) i--;
      this.liftChain = this.s.chain; this.liftFrom = i > 0 && chain.slice(0, i).includes(6) ? i : -1;
    }
    if (chain.length) {
      const n = chain.length, p = this.chainPos % n, prev = this.chainPos ? this.cur : -1;
      // Past the last bar of a song with an ending (even if a stalled main thread skipped its steps): finished, silent.
      if (this.s.ending && n >= 16 && this.chainPos >= n) { this.finished = true; return; }
      this.cur = chain[p]; this.chainPos++;
      let a = p, b = p;
      while (a > 0 && chain[a - 1] === this.cur) a--;
      while (b < n - 1 && chain[b + 1] === this.cur) b++;
      this.runPos = p - a; this.runLen = b - a + 1;
      const peak = (x) => x === 2 || x === 6, brk = (x) => x === 4 || x === 5, fill = this.cur === 3 || this.cur === 7;
      if (arr) {
        this.dropNext = peak(chain[(p + 1) % n]) && !peak(this.cur) && !(fill && peak(prev));
        if (!this.breakFilterPlanned && arr >= 0.75 && brk(this.cur) && !brk(prev)) {
          let k = 0; while (k < n && brk(chain[(p + k) % n])) k++;
          this.e.breakSweep(t, k * 16 * this.e.stepDur, SMOOTH.has(style));
        }
      }
      if (!this.breakFilterPlanned && (!arr || !brk(this.cur))) this.e.breakOpen(t, SMOOTH.has(style));
      if (this.festivalPlan.length) {
        this.dropNow = !!arr && this.festivalPlan.some((b) => b.drop === p);
        this.dropNext = !!arr && this.festivalPlan.some((b) => b.drop === p + 1);
      }
      this.sectionLevel(t, p, offset);
      return;
    }
    this.dropNow = false; this.runLen = 0;
    this.level(t, 0);
    this.e.breakOpen(t);
    if (this.queued !== null) { this.cur = this.queued; this.queued = null; }
  }

  // Verses sit under the chorus. A pre-chorus or a written verse fill can swell into it.
  sectionLevel(t, pos, offset) {
    if (this.s.artist?.style === 'hardtechno') {
      this.e.hardSection?.(t, this.cur, this.runPos, this.runLen, this.chainArr[this.chainPos]);
      return;
    }
    const pats = this.s.patterns, sec = pats[this.cur]?.sec;
    if (!sec) {
      if (this.verseFillSwell(t, this.chainArr, pos, offset)) return;
      return this.level(t, pats.some((p) => p.sec) ? this.secDb ?? 0 : 0);
    }
    const db = { ...SECTION_DB, ...STYLE_SECTION_DB[this.s.artist?.style] };
    if (sec !== 'pre') return this.level(t, db[sec] ?? 0);
    const { verse: v, chorus: c } = db, at = (k) => v + ((c - v) * k) / this.runLen;
    this.level(t, at(this.runPos + 1), [at(this.runPos), 16 * this.e.stepDur]);
  }

  verseFillSwell(t, chain, pos, offset) {
    const pats = this.s.patterns, fill = pats[chain[pos]], style = this.s.artist?.style;
    if (!fill?.verseSwell || fill.sec || style === 'hardtechno' ||
        pats[chain[pos - 1]]?.sec !== 'verse' || pats[chain[pos + 1]]?.sec !== 'chorus') return false;
    // Keep the first beat at verse level and lift through the pickup before the chorus lands.
    const db = { ...SECTION_DB, ...STYLE_SECTION_DB[style] }, sd = this.e.stepDur;
    const start = 4, end = 14, crest = db.chorus + 0.5;
    const left = Math.max(0, end - Math.max(start, offset)), span = end - start;
    const v = 10 ** (db.verse / 20), c = 10 ** (crest / 20);
    const from = left === span ? db.verse : left === 0 ? crest : 20 * Math.log10(c + (v - c) * left / span);
    this.level(t, crest, [from, left * sd, Math.max(0, start - offset) * sd]);
    return true;
  }

  level(t, db, ramp) {
    const beforeClip = this.e.playbackStyle === 'euphoric';
    if (db === this.secDb && !ramp && beforeClip === this.secBeforeClip) return;
    this.secDb = db;
    this.secBeforeClip = beforeClip;
    this.e.sectionGain(t, db, ramp);
  }

  tick(abs, t, roomGridTime, editable = false, vocalSettling = false, crackleUntil = Infinity) {
    abs -= this.origin || 0;
    const s = this.s, e = this.e;
    this.advanceBar(abs, t);
    if (this.finished && this.songBars) return this.cur;
    const n = this.songBars || 0, pos = n ? (this.chainPos - 1) % n : -1, lf = this.liftFrom;
    if (s.artist?.style === 'dub' || e.dubBreakdown === true) e.dubSection?.(t, s.artist?.style === 'dub' && s.chainOn && pos >= 48 && pos < 56 && (this.cur === 4 || this.cur === 5));
    if (abs % 16 === 0) e.vocal(t, pos, 0, roomGridTime, false, vocalSettling);
    const pat = patternAt(s.patterns[this.cur], pos);
    const firstTick = !e.playingPattern, previousJazz = jazzStyle(s, e.playingPattern);
    e.playingPattern = pat;
    if (firstTick || (abs % 16 === 0 && previousJazz !== jazzStyle(s, pat))) e.applyOutputTrim?.(false, t);
    const bar = Math.floor(abs / 16), vary = s.master.vary || 0;
    e.harm = pat.prog?.length ? pat.prog[bar % pat.prog.length] : null;
    e.step = abs;
    e.stabPat = pat.steps.stab; e.stabLen = pat.len.stab || 16;
    e.wide = pat.sec === 'chorus';
    const sd = e.stepDur;
    const tt = t + swingLate(s, abs, sd);
    if (pat.jazz && isJazz(pat.jazz.style)) {
      if (e.smoothOn) e.smoothChords(0, t);
      this.smooth = false;
      e.harm = this.jazzHarmonyAt(pat, bar, pos);
      return this.jazzStep(pat, abs, tt, pos, n);
    }
    const kl = this.keyLift = s.ending && pat.lift && lf > 0 && (pos >= lf || (pos === lf - 1 && abs % 16 >= 12)) ? pat.lift : 0;
    if (s.ending && n >= 16 && pos === n - 1 && !pat.score) return this.ending(pat, abs % 16, tt, sd, kl);
    // Turnaround: the last beat of a section anticipates the next section's first chord.
    const nx = n && pos + 1 < n && this.chainArr[pos + 1] !== this.cur ? patternAt(s.patterns[this.chainArr[pos + 1]], pos + 1) : null;
    if (nx && abs % 16 >= 12 && pat.prog?.length && nx.prog?.length) e.harm = nx.prog[(bar + 1) % nx.prog.length];
    if (kl && e.harm) e.harm = { r: e.harm.r + kl, c: e.harm.c };
    const pk = pocketOf(s.master);
    if ((s.master.dust || 0) > 0.01) e.dust(t, sd, abs, crackleUntil);
    const arr = s.master.arr || 0, i16 = abs % 16;
    const festival = this.festivalPlan?.length > 0;
    const buildAmount = arr * 2;
    if (festival && !arr) this.dropNow = this.dropNext = false;
    const build = festival ? festivalBuildStep(this.festivalPlan, pos, i16, buildAmount) : null;
    if (build?.sweepStart) e.sweep(t, build.durationSteps * sd, build.strength, build.sweep);
    if (build?.lowOff && i16 === 0) e.acidRelease(t);
    if (build?.gapStart) e.festivalGap?.(t, build.gapSteps * sd, buildAmount);
    if (build?.gap) return this.cur;
    if (build && !build.drop && !s.mutes.snare && (!TRACK_IDS.some((id) => s.solos[id]) || s.solos.snare)) {
      for (const hit of build.rolls) e.trigger('snare', t + hit.offset * sd, hit.velocity);
    }
    const sung = pat.hook?.m && !pat.hook.h ? this.sungBar(bar, n ? pos : bar) : null;
    const hookStep = sung ? this.songBars && !sung.hook.m.c && sung.notes.some((o) => o.at === i16 && i16 % 8) : pat.hook && pat.hm ? pat.hook.s[abs % 32] : 0;
    const hard = s.artist?.style === 'hardtechno';
    if (hard && this.cur === 5 && this.runLen > 0) {
      const drum = (s.artist.seed || 0) % 2 ? 'clap' : 'snare';
      const progress = (this.runPos + i16 / 16) / this.runLen;
      const every = progress < 1 / 3 ? 2 : 1;
      if (i16 % every === 0 && !s.mutes[drum]) {
        e.trigger(drum, t, 0.1 + 0.25 * progress);
        if (progress >= 2 / 3) e.trigger(drum, t + sd / 2, (0.1 + 0.25 * progress) * 0.85);
      }
    }
    this.smooth = SMOOTH.has(e.playbackStyle ?? s.artist?.style);
    // The chords make room under the bass while it plays and fill the low mids back in when it drops out.
    const held = HELD_CHORDS.has(STAB_VOICES[s.params.stab.voice]);
    const sc = !this.smooth ? 0 : !s.mutes.acid && pat.steps.acid.some((st) => st?.on) ? (held ? -6 : -12) : held ? -2 : 0.5;
    if (sc !== (e.smoothOn || 0)) {
      e.smoothChords(sc, t);
      // A lifted breakdown opens on a chord so its first bar does not fall into a gap.
      const soloed = Object.values(s.solos || {}).some(Boolean);
      if (sc > 0 && i16 === 0 && !s.mutes.stab && (!soloed || s.solos.stab)) e.trigger('stab', t, 0.45);
    }
    if (!festival && this.dropNext && this.smooth) { if (i16 === 0) e.dropDip(t, 16 * sd); } else if (!festival && this.dropNext && !hard) {
      if (i16 === 0) e.sweep(t, 16 * sd, arr);
      if (i16 >= 8 && !s.mutes.snare) {
        const rv = (0.25 + (0.6 * (i16 - 8)) / 7) * arr;
        e.trigger('snare', tt, rv);
        if (i16 >= 12) e.trigger('snare', tt + sd / 2, rv * 0.85);
      }
    }
    if (this.dropNow && i16 === 0 && !this.smooth) e.impact(t, arr);
    if (pat.score) this.scoreStep(pat.score, abs, t, sd);
    else { e.stepScale = 1; e.variableScoreTempo = false; }
    const anySolo = TRACK_IDS.some((id) => s.solos[id]);
    const rp = arr && !vary && n && !pat.score && (this.runLen >= 8 || (hard && this.runLen >= 4)) ? this.runPos : -1;
    // A song verse running straight into the pre-chorus fills its own last bar (no D/H turnaround follows it).
    const turn = pat.sec && (this.cur === 2 || this.cur === 6) && this.runPos === this.runLen - 1 && pos + 1 < n && ![3, 7].includes(this.chainArr[pos + 1]);
    const fillAt = turn ? 12 : rp >= 0 && (this.cur === 2 || this.cur === 6) && rp % 8 === 7 && rp < this.runLen - 1 ? (rp % 16 === 15 ? 8 : 12) : 16;
    // A band drummer marks each new section with a crash and plays the fills around the toms.
    const band = pk?.band && Math.round(s.master.kit || 0) === 1;
    // The rhythm guitar palm-mutes the verse and breakdown and opens up for the pre-chorus and chorus.
    e.palm = band && (this.cur === 2 || this.cur === 4);
    if (band && i16 === 0 && pos > 0 && this.chainArr[pos - 1] !== this.cur && pat.steps.kick.some(Boolean) && !s.mutes.oh && (!anySolo || s.solos.oh)) {
      e.crash(tt + pocketLate(pk, 'oh', 0), this.cur === 6 || this.cur === 7 ? 1 : 0.7);
    }
    // A queued fill keeps its instrument when a single track is edited.
    const roller = rp >= 0 && i16 >= fillAt && pat.steps.snare.some(Boolean) ? 'snare' : 'clap';
    const grid = { abs, tt, bar, i16, vary, rp, pos, n, fillAt, roller, pk, band, sung, hum: s.master.humanize || 0, liveKit: Math.round(s.master.kit || 0) === 1 };
    const hitContext = editable ? { e, cur: this.cur, runLen: this.runLen, smooth: this.smooth, build: this.build } : null;
    let kickAt;
    for (const id of TRACK_IDS) {
      const on = !s.mutes[id] && (!anySolo || s.solos[id]);
      if (build?.lowOff && (id === 'kick' || id === 'acid')) continue;
      if (build && !build.drop && (id === 'snare' || (['ch', 'oh', 'ride'].includes(id) && build.thin))) continue;
      if (build?.drop && on && id === 'kick') { e.trigger('kick', t, buildAmount); kickAt = t; continue; }
      if (build?.drop && on && id === 'acid') {
        e.noteVel = buildAmount;
        e.acid(t, { ...(pat.steps.acid.find((st) => st.on) || { n: 0 }), on: true, s: false, a: true }, false, false, sd);
        this.acidPrevSlide = false; this.acidMuted = false;
        continue;
      }
      const len = pat.len[id] || 16;
      const i = abs % len;
      if (id === 'acid') {
        if (!on) {
          if (!this.acidMuted) e.acidRelease(tt);
          this.acidMuted = true; this.acidPrevSlide = false;
          continue;
        }
        this.acidMuted = false;
        // A bass player leans on the one and plays the in-between notes softer
        e.noteVel = pk ? pocketVel(pk, 'acid', i16) * (1 + (hash(abs, 93) - 0.5) * 0.1) : 1;
        const walk = pk?.walk && (i16 === 12 || i16 === 14) && e.harm ? this.walkUp(pat, nx, bar, kl) : null;
        if (walk) {
          e.acid(tt + pocketLate(pk, 'acid', i16), { on: true, n: walk[i16 === 12 ? 0 : 1] - (e.harm.r - kl), a: false, s: false, ap: true }, false, false, sd);
          this.acidPrevSlide = false; this.walked = bar;
          continue;
        }
        const pickup = vary && i16 === 15 && len === 16 && this.walked !== bar ? this.bassPickup(pat, nx || pat, bar, t, tt, sd, pk) : null;
        if (pickup) {
          e.noteVel *= 0.55;
          e.acid(pickup.t, pickup.st, false, false, sd);
          this.acidPrevSlide = false;
        } else {
          const feel = s.master.humanize || 0;
          const bassLean = feel * (i % 4 ? 0.032 : 0.009);
          let slideUntil;
          if ((s.params.acid.voice === 7 || s.params.acid.voice === 8) && pat.steps.acid[i].s) {
            const nextSwing = swingLate(s, abs + 1, sd);
            const nextLean = feel * (((i + 1) % len) % 4 ? 0.032 : 0.009);
            // Leave time for the next hit to cancel this fallback release.
            slideUntil = t + sd + nextSwing + nextLean + pocketLate(pk, 'acid', (i16 + 1) % 16) + 0.001;
          }
          this.acidStep(pat, i, len, tt + bassLean + pocketLate(pk, 'acid', i16), sd, slideUntil, kickAt);
        }
        continue;
      }
      if (this.roll === id && id !== 'stab') {
        const r = this.rollCount = (this.rollCount || 0) + 1;
        const base = 0.45 + Math.min(0.5, r * 0.02);
        e.trigger(id, tt, base);
        e.trigger(id, tt + sd / 2, base * 0.8);
        if (id === 'kick') kickAt = tt;
        continue;
      }
      if (!hard && this.dropNext && id === 'kick' && i16 >= (this.smooth ? 15 : arr >= 0.75 ? 12 : 14)) continue;
      if (this.dropNext && id === 'snare' && arr > 0 && i16 >= 8 && !this.smooth) continue;
      if (editable && EDITABLE_HITS.has(id)) {
        const step = e.step, scale = e.stepScale, harm = e.harm;
        const hit = e.planHit(t, id, hitContext.cur, () => {
          if (this.s !== s || s.mutes[id] || (TRACK_IDS.some(k => s.solos[k]) && !s.solos[id])) return null;
          const current = patternAt(s.patterns[hitContext.cur], pos);
          if (!current) return null;
          const hit = this.gridHit.call(hitContext, id, current, grid);
          return hit && { ...hit, key: JSON.stringify([hit.method, ...hit.args]), step, scale, harm };
        });
        if (id === 'kick') kickAt = hit?.time;
        continue;
      }
      if (!on) { if (id === 'stab' && e.gripHeld?.length) e.quietGrip(tt); continue; }
      // Accompaniment listens to the lead. Do not stack a chord stab on top of
      // the hook's important notes; the gap makes the motif read as intentional.
      if (id === 'stab' && hookStep && !paletteFor(s, e.playbackStyle ?? s.artist?.style)?.bed) continue;
      const hit = this.gridHit(id, pat, grid);
      if (hit) e[hit.method](...hit.args);
      if (id === 'kick') kickAt = hit?.time;
    }
    // A band adds players by section (BAND_LAYER): strings under the changes, a piano doubling the strum.
    if (band && i16 % 8 === 0 && pat.sec && !pat.score && !s.mutes.stab && (!anySolo || s.solos.stab)) e.bandLayer(tt, pat.sec, i16, s.artist?.style);
    const hm = pat.hm || 0, scale = SCALES[s.scale]?.notes || SCALES.minor.notes;
    const hk = sung ? null : pat.hook && !pat.hook.h && this.songBars ? (pat.sec === 'pre' ? this.climb(pat.hook, bar % 4, scale) : this.motif(pat.hook, motifPlan(bar, this.songBars, this.cur, pat.hook.s.filter(Boolean).length), scale)) : pat.hook;
    const leadOn = !s.mutes.stab && (!anySolo || s.solos.stab), busy = sung ? this.songBars && leadOn && sung.busy[i16] : this.songBars && hk && hm && leadOn && hookBusy(hk, abs % 32, hm);
    const sp = pat.steps.stab;
    // Licks fill the lead's rests instead of talking over it.
    const lick = this.lickCell(i16, vary);
    if (lick && leadOn && !busy && !(this.songBars && ((hk && hm) || sung?.any) && i16 === 15) && bar % 8 === 7 && !sp[abs % (pat.len.stab || 16)]) {
      e.lick(tt, lick.v, lick.k);
    }
    if (this.songBars && hk && hm && leadOn) this.interplay(pat, hk, abs, bar, tt, sd, busy, anySolo, !!hk.s[abs % 32]);
    if (this.songBars && sung?.part && leadOn) this.interplay(pat, pat.hook, abs, bar, tt, sd, busy, anySolo, sung.notes.some((o) => o.at === i16));
    if (sung && leadOn) this.sing(sung, i16, bar, tt, sd, scale);
    if (hk && hm && !s.mutes.stab && (!anySolo || s.solos.stab)) {
      const hi = abs % 32, st = hk.s[hi];
      const x = hk.x || { space: 0.4, risk: 0.4, feel: 0.4, warmth: 0.5 };
      // One remembered motif, played like a musician: breathe in phrase three,
      // lean into answers, then spend the octave leap only at the peak (in a song, only in the chorus).
      const ph = Math.floor(bar / 2) % 4;
      const breathe = hm > 1 && ph === 2 && hi < 16 && hash(abs, 95) < 0.2 + x.space * 0.45;
      // The lead also drops out for the last half bar before a drop, leaving the riser and snare roll alone; a smooth style keeps it playing.
      if (st && (hm > 1 || hi < 16) && !breathe && !(this.dropNext && i16 >= 8 && !this.smooth)) {
        const lift = (hm > 1 && hi >= 16 && (hk.up || (ph === 3 && x.risk >= 0.3)) && (!pat.sec || pat.sec === 'chorus') ? 12 : 0) + (this.keyLift || 0);
        const b = 0.58 + 0.42 * ((bar % 8) / 7);
        const answer = hi >= 16;
        const phraseVel = [0.82, 0.92, 0.72, 1][ph] * (answer ? 1.04 : 0.96);
        const lean = (answer ? 0.006 : -0.003) * x.feel + (hash(hi, 97) - 0.5) * 0.008 * x.feel;
        const resolve = hm > 1 && answer && ph === 1 && !hk.s.slice(hi + 1).some(Boolean);
        const strong = !hk.h && (hi % 4 === 0 || st[1] >= 2), ht = tt + lean + (s.master.humanize || 0) * 0.008;
        const expression = Object.hasOwn(WIND_HOOK, hk.v)
          ? { ...x, take: windTake(hk.s, hi, 0, Math.floor(abs / 32)) } : x;
        const duration = swingDuration(s, abs, st[1], sd);
        e.hook(ht, Math.min(1, st[2] * phraseVel), st[0] + lift, duration, hk.v, hk.o, strong, b, !hk.h && resolve, expression);
        // At the peak a second player doubles the answer's held notes a third below.
        if (this.cur === 6 && answer && hm > 1 && st[1] >= 3 && !hk.h && this.songBars) e.hook(ht + 0.004, Math.min(1, st[2] * phraseVel) * 0.55, stepDeg(st[0], -2, scale) + lift, duration, hk.v, hk.o, strong, b, false, { ...expression, harm: 1 });
      }
    }
    if (this.roll === null) this.rollCount = 0;
    return this.cur;
  }

  gridHit(id, pat, { abs, tt, bar, i16, vary, rp, pos, n, fillAt, roller, pk, band, sung, hum, liveKit }) {
    const i = abs % (pat.len[id] || 16);
    let v = pat.steps[id][i];
    if (vary) {
      const k = TRACK_IDS.indexOf(id), roll = hash(abs * 1.37 + bar, k + 40);
      if (v && (id === 'ch' || id === 'perc' || id === 'ride' || id === 'vox') && roll < vary * 0.18) v = 0;
      else if (!v && id === 'snare' && roll < vary * (bar % 4 === 3 && i >= 12 ? 0.7 : 0.1)) v = 0.45;
      else if (!v && id === 'ch' && roll < vary * 0.12) v = 0.4;
      else if (!v && id === 'kick' && i % 4 === 3 && roll < vary * 0.08) v = 0.6;
      if (bar % 8 === 7 && i >= 12 && (id === 'kick' || id === 'stab') && hash(bar, k) < vary) v = 0;
    }
    if (rp >= 0) v = this.build(id, v, pat, i16, rp, pos < n / 2, fillAt, roller);
    // Ghost hats: the hand keeps moving between the written hits, barely touching the cymbal
    if (pk?.ghost && !v && id === 'ch' && i16 % 2 && pat.steps.ch.some(Boolean) && hash(abs * 1.91 + bar, 97) < pk.ghost) v = 0.26;
    const k = TRACK_IDS.indexOf(id), drum = DRUMS.has(id), cym = id === 'ch' || id === 'ride' || id === 'oh';
    const late = hum * ((id === 'snare' || id === 'clap') ? 0.03 : id === 'perc' ? (i % 2 ? 0.02 : 0.008) : cym ? (i % 2 ? 0.016 : 0.006) : id === 'kick' ? -0.003 : id === 'stab' || id === 'acid' ? 0.016 : 0);
    // Drummer feel: the whole kit breathes together over 8 bars and pushes into each 4-bar fill
    const phrase = drum ? hum * (0.007 * Math.sin((Math.PI * 2 * abs) / 128 + 1.3) - (bar % 4 === 3 && i >= 8 ? 0.005 : 0)) : 0;
    const ht = tt + late + phrase + (hash(bar, k + 60) - 0.5) * hum * 0.006 + (hash(abs, k) - 0.5) * hum * 0.008
      + (pk ? pocketLate(pk, id, i16) + (hash(abs, k + 70) - 0.5) * pk.jitter / 1000 : 0);
    const pv = pk ? pocketVel(pk, id, i16) : 1;
    const accent = cym && !pk ? (i % 4 === 0 ? 1 : i % 2 === 0 ? 0.84 : 0.68) : 1;
    const swell = drum ? 1 - hum * 0.1 * (3 - (bar % 4)) / 3 : 1;
    const hv = (1 - hum * 0.22 * hash(abs, k + 20)) * (1 - hum * (1 - accent)) * swell * pv;
    const ghostSnare = id === 'snare' && liveKit;
    const under = id === 'stab' && n && sung?.any ? STAB_UNDER_VOICE[pat.sec && sung.part === 'v' ? 'n' : sung.part] ?? STAB_UNDER_VOICE.n : 1;
    const vel = (v === 2 ? 1 : v === 1 ? (ghostSnare ? 0.45 : 0.78) : v) * hv * under;
    if (!v) return null;
    if (id === 'vox') return { method: 'vox', args: [ht, vel, this.e.playbackStyle === 'bailefunk' ? abs : i], time: ht };
    if (band && id === 'snare' && (this.cur === 3 ? i16 >= 12 : i16 >= fillAt))
      return { method: 'tom', args: [ht, vel, i16 < 14], time: ht };
    const underHarp = id === 'stab' && n && pat.hook?.v === 'harpplk' && (sung ? sung.any : pat.hm);
    return { method: 'trigger', args: underHarp ? [id, ht, vel, true] : [id, ht, vel], time: ht };
  }

  // With arrangement dynamics on (arr > 0), styles without humanized variation (vary 0, the techno family) develop their long runs by arrangement instead:
  // the intro brings in hats then percussion, the outro takes them away again, the first drop holds its ride back for
  // a phrase, the peak's second phrase opens up off-16th hats, every 8 bars ends on a snare/clap roll over a dropped
  // kick (two beats at 16-bar ends), and every fourth bar turns around on the percussion.
  jazzHarmonyAt(pat, bar, pos) {
    if (pat.jazz?.progBars !== 1 || pos < 0 || !this.songBars) return jazzHarmony(pat, bar);
    pos %= this.chainArr.length;
    let start = pos;
    const sec = this.chainEntries?.[pos]?.sec;
    if (sec != null) {
      while (start > 0 && this.chainEntries[start - 1].sec === sec) start--;
      return jazzHarmony(pat, pos - start);
    }
    const group = (slot) => slot < 2 ? slot : slot - slot % 2;
    while (start > 0 && group(this.chainArr[start - 1]) === group(this.chainArr[pos])) start--;
    return jazzHarmony(pat, pos - start);
  }

  jazzGrid(pat, id, abs, written, played, accents = []) {
    const row = pat.steps[id], len = pat.len[id] || 16;
    const generated = len === 16 && row.length === 16 && row.every((v, i) => id === 'acid'
      ? v.on === written.includes(i) && !v.n && !v.a && !v.s
      : !!v === written.includes(i));
    if (id === 'acid') return generated ? played : row[abs % len];
    const base = accents.includes(abs % 16) ? 1 : 0.78;
    const v = generated ? played && (row[abs % len] || (base === 1 ? 2 : 1)) : row[abs % len];
    return v ? (v === 2 ? 1 : v === 1 ? 0.78 : v) / base : 0;
  }

  jazzHook(pat, abs, t, sd) {
    if (!pat.hook.h) return false;
    const note = pat.hook.s[abs % 32];
    if (note) this.e.hook(t, note[2], note[0], swingDuration(this.s, abs, note[1], sd), pat.hook.v, pat.hook.o, false, 0.8, false, pat.hook.x);
    return true;
  }

  jazzStep(pat, abs, t, pos, bars) {
    if (pat.jazz.style === 'jazzfunk') return this.jazzfunkStep(pat, abs, t, pos, bars);
    if (pat.jazz.style === 'bossa') return this.bossaStep(pat, abs, t, pos, bars);
    const e = this.e, s = this.s, i = abs % 16, bar = Math.floor(abs / 16), sd = e.stepDur;
    const { style, seed } = pat.jazz, solo = this.cur === 2;
    const enabled = (id) => !s.mutes[id] && (!Object.values(s.solos).some(Boolean) || s.solos[id]);
    const final = s.ending && bars && pos === bars - 1;
    if (final && i) return this.cur;
    const nextPat = bars && this.chainArr[pos + 1] != null ? s.patterns[this.chainArr[pos + 1]] : pat;
    const next = this.jazzHarmonyAt(nextPat, bar + 1, pos + 1), h = e.harm;
    const bass = jazzBass(style, s.key, h, next, bar);
    for (const id of ['ride', 'ch', 'kick', 'snare']) {
      if (!enabled(id) || !pat.steps[id][i]) continue;
      let v = id === 'ride' ? ([4, 12].includes(i) ? 0.76 : i % 4 ? 0.4 : 0.6) : id === 'ch' ? 0.45 : id === 'kick' ? 0.18 : 0.23;
      if (style === 'modal') v *= 0.85 + 0.3 * hash(bar, i + 71);
      e.trigger(id, t, v);
    }
    if (!final && bar % 8 === 7 && i === 14) {
      if (enabled('snare') && pat.steps.snare.some(Boolean)) e.trigger('snare', t, 0.37);
      if (enabled('kick') && pat.steps.kick.some(Boolean)) e.trigger('kick', t, 0.32);
    }
    if (enabled('acid') && (i % 4 === 0 && pat.steps.acid[i]?.on || !final && bar % 8 === 6 && i === 14 && pat.steps.acid[12]?.on)) {
      const m = i === 14 ? bass[3] + (bass[3] < 49 ? 1 : -1) : bass[i / 4];
      const st = { on: true, n: m - 36 - s.key - harmRoot(h), ap: true, a: false, s: false };
      e.noteVel = i === 0 ? 0.85 : 0.76;
      e.acid(t, st, false, false, final ? sd * 8 : swingDuration(s, abs, i === 12 && bar % 8 === 6 ? 2 : 4, sd), undefined, t);
      e.noteVel = 1;
    }
    if (enabled('stab') && (final || pat.steps.stab[i] && (!solo || bar % 2 === 0 || i === 6))) e.trigger('stab', t, style === 'modal' ? 0.62 : solo ? 0.42 : 0.56);
    if (enabled('stab') && pat.hook && pat.hm && !this.jazzHook(pat, abs, t, sd)) {
      const notes = final ? [[0, 8, h.r + CHORDS[h.c].iv[1], 0.7]] : jazzNotes(style, seed, bar, h, solo);
      for (const [at, dur, n, v] of notes) if (at === i) e.hook(t, v, n, swingDuration(s, abs, dur, sd), pat.hook.v, pat.hook.o, i % 8 === 0, 0.8, false, pat.hook.x);
    }
    return this.cur;
  }

  jazzfunkStep(pat, abs, t, pos, bars) {
    const e = this.e, s = this.s, i = abs % 16, bar = Math.floor(abs / 16), sd = e.stepDur;
    const enabled = (id) => !s.mutes[id] && (!Object.values(s.solos).some(Boolean) || s.solos[id]);
    const final = s.ending && bars && pos === bars - 1;
    if (final && i) return this.cur;
    const accent = (id) => pat.steps[id][abs % (pat.len[id] || 16)] === 2 ? 1 / 0.78 : 1;
    if (!final) {
      const kick = this.jazzGrid(pat, 'kick', abs, FUNK_KICK[0], FUNK_KICK[bar % 2].includes(i));
      const snare = this.jazzGrid(pat, 'snare', abs, FUNK_SNARE, FUNK_SNARE.includes(i), [4, 12]);
      if (enabled('kick') && kick) e.trigger('kick', t, 0.65 * kick);
      if (enabled('snare') && snare) e.trigger('snare', t, (i % 8 === 4 ? 0.72 : 0.18) * snare);
      if (enabled('ch') && pat.steps.ch[abs % (pat.len.ch || 16)]) e.trigger('ch', t, (i % 4 === 0 ? 0.32 : i % 2 ? 0.17 : 0.23) * accent('ch'));
      if (enabled('oh') && pat.steps.oh[abs % (pat.len.oh || 16)]) e.trigger('oh', t, 0.24 * accent('oh'));
    }
    const bass = funkBass(s.key, e.harm, bar), note = bass.find(([at]) => at === i);
    const st = this.jazzGrid(pat, 'acid', abs, funkBass(0, pat.prog?.[0] || e.harm, 0).map(([at]) => at), { on: !!note, n: 0, a: false, s: false });
    if (enabled('acid') && st?.on) {
      const [, dur, m, v] = note || [i, 1, bass[0][2], 0.75];
      e.noteVel = v;
      e.acid(t, { ...st, n: m - 36 - s.key - harmRoot(e.harm) + st.n, ap: true }, false, false, swingDuration(s, abs, final ? 6 : dur, sd), undefined, t);
      e.noteVel = 1;
    }
    const comp = this.jazzGrid(pat, 'stab', abs, FUNK_COMP[0], final || FUNK_COMP[bar % 2].includes(i));
    if (enabled('stab') && comp) e.trigger('stab', t, (this.cur === 2 ? 0.48 : 0.6) * comp);
    if (enabled('stab') && pat.hook && pat.hm && !this.jazzHook(pat, abs, t, sd)) {
      const notes = final ? [[0, 6, e.harm.r + CHORDS[e.harm.c].iv[1], 0.7]] : jazzNotes('jazzfunk', pat.jazz.seed, bar, e.harm, this.cur === 2);
      for (const [at, dur, pitch, v] of notes) if (at === i) {
        const k = s.key > 6 ? s.key - 12 : s.key;
        let n = pitch;
        if (pat.hook.v === 'tpt') {
          while (60 + k + n < 69) n += 12;
          while (60 + k + n > 80) n -= 12;
        }
        e.hook(t, v, n, swingDuration(s, abs, dur, sd), pat.hook.v, pat.hook.o, i % 4 === 0, 0.7, false, pat.hook.x);
      }
    }
    return this.cur;
  }

  bossaStep(pat, abs, t, pos, bars) {
    const e = this.e, s = this.s, i = abs % 16, bar = Math.floor(abs / 16), sd = e.stepDur;
    const enabled = (id) => !s.mutes[id] && (!Object.values(s.solos).some(Boolean) || s.solos[id]);
    const final = s.ending && bars && pos === bars - 1;
    if (final && i) return this.cur;
    const nextPat = bars && this.chainArr[pos + 1] != null ? s.patterns[this.chainArr[pos + 1]] : pat;
    const h = e.harm, next = this.jazzHarmonyAt(nextPat, bar + 1, pos + 1), parity = bar % 2;
    const accent = (id) => pat.steps[id][abs % (pat.len[id] || 16)] === 2 ? 1 / 0.78 : 1;
    if (!final) {
      const rim = this.jazzGrid(pat, 'snare', abs, BOSSA_RIM[0], BOSSA_RIM[parity].includes(i));
      if (enabled('kick') && pat.steps.kick[abs % (pat.len.kick || 16)]) e.trigger('kick', t, (i % 8 === 0 ? 0.2 : 0.08) * accent('kick'));
      if (enabled('ch') && pat.steps.ch[abs % (pat.len.ch || 16)]) e.trigger('ch', t, (i % 4 === 0 ? 0.29 : 0.23) * accent('ch'));
      if (enabled('oh') && pat.steps.oh[abs % (pat.len.oh || 16)]) e.trigger('oh', t, 0.2 * accent('oh'));
      if (enabled('snare') && rim) e.trigger('snare', t, 0.29 * rim);
    }
    const bass = bossaBass(s.key, h, next), note = bass.find(([at]) => at === i), st = pat.steps.acid[abs % (pat.len.acid || 16)];
    if (enabled('acid') && st?.on) {
      const [, dur, m, v] = note || [i, 1, bass[0][2], 0.75];
      e.noteVel = v;
      e.acid(t, { ...st, n: m - 36 - s.key - harmRoot(h) + st.n, ap: true }, false, false, (final ? 8 : dur) * sd, undefined, t);
      e.noteVel = 1;
    }
    const comp = this.jazzGrid(pat, 'stab', abs, [...new Set([0, 8, ...BOSSA_BATIDA[0]])], final || i % 8 === 0 || BOSSA_BATIDA[parity].includes(i));
    if (enabled('stab') && comp) e.trigger('stab', t, (i % 8 === 0 ? 0.5 : 0.43) * comp);
    if (enabled('stab') && pat.hook && pat.hm && !this.jazzHook(pat, abs, t, sd)) {
      const notes = final ? [[0, 8, h.r + CHORDS[h.c].iv[1], 0.6]] : jazzNotes('bossa', pat.jazz.seed, bar, h, this.cur === 2);
      for (const [at, dur, n, v] of notes) if (at === i) e.hook(t, v, n, dur * sd, pat.hook.v, pat.hook.o, i % 8 === 0, 0.8, false, pat.hook.x);
    }
    return this.cur;
  }

  // Country bass walks up the scale into a change: the two scale tones under the next root, on beat 4 and its "and".
  walkUp(pat, nx, bar, kl) {
    const prog = pat.prog, next = (nx?.prog?.length ? nx.prog : prog)?.[(bar + 1) % (nx?.prog?.length || prog?.length || 1)];
    if (!prog?.length || !next || next.r === prog[bar % prog.length].r || hash(bar, 95) > 0.5) return null;
    const T = next.r, scale = SCALES[this.s.scale]?.notes || SCALES.major.notes;
    const below = [...new Set(scale.map((d) => { let x = ((d % 12) + 12) % 12; while (x >= T) x -= 12; while (x < T - 12) x += 12; return x; }))].sort((a, b) => b - a);
    return below.length >= 2 ? [below[1], below[0]] : null;
  }

  build(id, v, pat, i16, rp, intro, fillAt, roller) {
    const cur = this.cur, rl = this.runLen, has = (x) => pat.steps[x].some(Boolean);
    if (cur === 0) {
      if (id === 'ch' && (intro ? rp < 2 : rp >= rl - 2)) return 0;
      if (id === 'perc' && (intro ? rp < 4 : rp >= rl - 4)) return 0;
      return v;
    }
    if (cur !== 2 && cur !== 6) return v;
    if (cur === 2 && id === 'ride' && rp < (rl >= 15 ? 8 : 4)) return 0;
    if (cur === 6 && id === 'ch' && !v && rp >= 8 && i16 % 2 && has('ch')) return 0.28;
    if (i16 >= fillAt) {
      if (id === 'kick' && i16 >= 12) return 0;
      if (id === roller) return this.smooth ? (i16 === 15 ? 0.3 : v) : 0.22 + (0.5 * (i16 - fillAt)) / (15 - fillAt);
    }
    if (id === 'perc' && fillAt === 16 && rp % 4 === 3 && !v && (i16 === 13 || i16 === 15) && has('perc')) return 0.5;
    return v;
  }

  // Parts that listen to the lead. In grooves and peaks the bass answers the hook's rests with an off-beat octave,
  // or a walk into the next chord; breakdowns get a quiet guide-tone line (3rds and 7ths) under the B-phrase.
  interplay(pat, hk, abs, bar, t, sd, busy, anySolo, leadStarts) {
    if (this.s.artist?.style === 'hardtechno') return;
    const s = this.s, e = this.e, i16 = abs % 16, len = pat.len.acid || 16, a = pat.steps.acid;
    if ((this.cur === 2 || this.cur === 6) && (i16 === 6 || i16 === 14) && !busy && !a[abs % len]?.on &&
        !s.mutes.acid && (!anySolo || s.solos.acid) && a.some((x) => x?.on) && hash(bar * 2 + (i16 > 8), 96) < 0.6) {
      const nx = i16 === 14 && pat.prog?.length > 1 ? pat.prog[(bar + 1) % pat.prog.length] : null;
      const d = nx ? harmRoot(nx) - harmRoot(e.harm) : 0;
      e.noteVel = 0.62;
      e.acid(t, { on: true, n: d ? d - Math.sign(d) : 12, a: false, s: false, answer: 1 }, false, false, sd);
      this.acidPrevSlide = false;
    }
    if ((this.cur === 4 || this.cur === 5) && i16 % 8 === 0 && !leadStarts) {
      const ns = hk.s.filter(Boolean).map((x) => x[0]), home = 12 * Math.round(ns.reduce((p, q) => p + q, 0) / ns.length / 12) - 12;
      const iv = chordIv(e.harm, s.params.stab), r = harmRoot(e.harm) + (this.keyLift || 0), prev = this.counter ?? home + r + iv[1];
      const cands = [iv[1], iv[3] ?? iv[2]].flatMap((x) => [-12, 0, 12].map((o) => home + r + x + o)).filter((m) => m !== prev || i16 === 0);
      const n = cands.reduce((b, m) => (Math.abs(m - prev) < Math.abs(b - prev) ? m : b));
      this.counter = n;
      e.hook(t + 0.003, 0.3, n, 8 * sd, hk.v, hk.o, true, 0.5, false, { ...(hk.x || {}), harm: 1, counter: 1 });
    }
  }

  // Vocal-length melodies (js/melody.js): which part a scene sings. Breakdowns sing the bridge, quiet scenes the
  // verse, full ones the chorus; a one-bar fill finishes the phrase of the section it closes.
  singPart(p, i, pq, prev) {
    if (!p?.hook?.m?.n?.length || p.hook.h || !p.hm) return null;
    if (i === 4 || i === 5) return 'b';
    if ((i === 3 || i === 7) && pq && prev !== i) { const q = this.singPart(pq, prev); if (q) return q; }
    return p.hm > 1 ? 'n' : 'v';
  }

  // The sung notes starting in one bar (with the pickup into the next section's first phrase), and the steps where
  // the singer is still holding a note, so licks and bass answers stay out of the way. Cached per bar.
  sungBar(bar, P) {
    const c = this.sungAt;
    if (c && c.bar === bar && c.P === P && c.cur === this.cur && c.s === this.s) return c;
    const n = this.songBars, ch = this.chainArr, B = MELODY_BARS;
    const at = (k) => (n ? ch[((k % n) + n) % n] : this.cur);
    const pp = (k) => patternAt(this.s.patterns[at(k)], n ? ((k % n) + n) % n : -1);
    const part = (k) => this.singPart(pp(k), at(k), pp(k - 1), at(k - 1));
    const hook = pp(P).hook, wind = Object.hasOwn(WIND_HOOK, hook?.v);
    const takeAt = (xs, i, k) => wind ? windTake(xs, i, 2, Math.floor((bar + k - P) / B)) : undefined;
    const notesIn = (k) => {
      const cb = ((k % B) + B) % B, out = [], q = part(k), nq = cb === B - 1 && part(k + 1);
      if (q) {
        const xs = pp(k).hook.m[q] || [], sh = this.register(at(k), bar + k - P, pp(k).hook, q, cb);
        xs.forEach((x, i) => { if (x[0] >= cb * 16 && x[0] < cb * 16 + 16) out.push({ at: x[0] - cb * 16, x, q, sh, take: takeAt(xs, i, k) }); });
      }
      if (nq) {
        const xs = pp(k + 1).hook.m[nq] || [], sh = this.register(at(k + 1), bar + k + 1 - P, pp(k + 1).hook, nq, 0);
        xs.forEach((x, i) => { if (x[0] < 0) out.push({ at: 16 + x[0], x, q: nq, pickup: 1, sh, take: takeAt(xs, i, k + 1) }); });
      }
      return out;
    };
    const notes = notesIn(P), busy = Array(16).fill(false);
    for (const { at: a, x } of notesIn(P - 1)) for (let j = 0; j < a + x[1] - 16 && j < 16; j++) busy[j] = true;
    for (const { at: a, x } of notes) for (let j = a; j < Math.min(16, a + x[1]); j++) busy[j] = true;
    for (const { at: a } of notes) if (a > 0) busy[a - 1] = true;
    if (notesIn(P + 1).some((o) => o.at === 0)) busy[15] = true;
    return (this.sungAt = { bar, P, cur: this.cur, s: this.s, notes, busy, hook, part: part(P), any: notes.length > 0 || busy.some(Boolean) });
  }

  // Section register of the sung line, in scale steps (the same moves as the riff hook's vhook and climb()): the verse
  // sits 2 steps down; the pre-chorus starts there and climbs, each bar above the last and staying under the chorus's
  // top note; the bridge drops if it would reach that note. Only the chorus sings the peak. Cached per hook.
  register(i, bar, hk, q, cb) {
    const sec = this.s.patterns[i]?.sec;
    if (sec === 'verse') return -2;
    if (sec !== 'pre' && sec !== 'bridge') return 0;
    const scale = SCALES[this.s.scale]?.notes || SCALES.minor.notes, j = ((bar % 4) + 4) % 4, B = MELODY_BARS;
    const c = (this.regs ??= new WeakMap()), key = `${sec}:${q}:${cb}:${j}:${scale.join()}`;
    if (!c.has(hk)) c.set(hk, new Map());
    const m = c.get(hk);
    if (m.has(key)) return m.get(key);
    const xs = hk.m[q] || [], top = Math.max(...hk.m.n.map((x) => x[2]));
    const hiOf = (ys) => Math.max(-Infinity, ...ys.map((x) => x[2]));
    const under = (n, k, room = 0) => { const lim = stepDeg(top, -room, scale); while (k > -6 && stepDeg(n, k, scale) >= lim) k--; return k; };
    let k = 0;
    if (sec === 'bridge') k = under(hiOf(xs), 0);
    else for (let d = 0, hi = -Infinity; d <= j; d++) {
      const b = (((cb - j + d) % B) + B) % B, t = hiOf(xs.filter((x) => x[0] >= b * 16 && x[0] < b * 16 + 16));
      k = -2 + d;
      if (t === -Infinity) continue;
      while (k < d && stepDeg(t, k, scale) <= hi) k++;
      k = under(t, k, 3 - d);
      hi = Math.max(hi, stepDeg(t, k, scale));
    }
    m.set(key, k);
    return k;
  }

  // Sing the notes that start on this step: pitch and length as written, the verse a little softer than the chorus,
  // a breath before a drop, and at the peak a second voice a third under the held notes of the answering phrase.
  sing(sung, i16, bar, t, sd, scale) {
    const s = this.s, e = this.e, hk = sung.hook, x = hk.x || { space: 0.4, risk: 0.4, feel: 0.4, warmth: 0.5 };
    for (const o of sung.notes) {
      if (o.at !== i16 || (this.dropNext && i16 >= 8 && !o.pickup)) continue;
      const [start, dur, w, vel, ph] = o.x, lift = this.keyLift || 0, semi = o.sh ? stepDeg(w, o.sh, scale) : w;
      const sec = o.q === 'v' ? (s.patterns[this.cur]?.sec ? 1.15 : 0.82) : o.q === 'b' ? 0.6 : 1, strong = strongNote(start, dur);
      const ht = t + (hash(start, 97) - 0.5) * 0.008 * x.feel + (s.master.humanize || 0) * 0.008;
      const b = 0.58 + 0.42 * ((((bar % 8) + 8) % 8) / 7), v = Math.min(1, vel * sec) * (SUNG_VOICE[hk.v] ?? 1);
      const expression = o.take == null ? x : { ...x, take: o.take };
      const duration = swingDuration(s, bar * 16 + i16, dur, sd);
      e.hook(ht, v, semi + lift, duration, hk.v, hk.o, strong, b, false, expression);
      if (this.cur === 6 && o.q === 'n' && ph % 2 === 1 && dur >= 6 && this.songBars) e.hook(ht + 0.004, v * 0.55, stepDeg(semi, -2, scale) + lift, duration, hk.v, hk.o, strong, b, false, { ...expression, harm: 1 });
    }
  }

  // The last bar of a generated song: one final downbeat on the home chord, left to ring out.
  ending(pat, i16, t, sd, kl = 0) {
    // The transport reads this after the bar has rung out and stops instead of looping back to the intro.
    if (i16 === 15) this.finished = true;
    if (i16) return this.cur;
    const s = this.s, e = this.e, anySolo = TRACK_IDS.some((id) => s.solos[id]), on = (id) => !s.mutes[id] && (!anySolo || s.solos[id]);
    const home = pat.prog?.length ? pat.prog.find((h) => h.r === 0) || pat.prog[0] : null;
    e.harm = home && { r: home.r + kl, c: home.c };
    if (on('kick')) e.trigger('kick', t, 1);
    if (on('acid')) e.acid(t, { on: true, n: 0, a: true, s: false }, false, false, sd);
    // The final chord is struck and left to ring: no picking pattern or scratches after it.
    if (on('stab')) { const st = e.step; e.step = null; e.trigger('stab', t, 0.85); e.step = st; }
    const hk = pat.hook;
    if (hk && on('stab')) {
      const ns = hk.s.filter(Boolean).map((x) => x[0]), tonic = 12 * Math.round(ns.reduce((a, b) => a + b, 0) / ns.length / 12) + kl;
      e.hook(t, 0.8, tonic, 16 * sd, hk.v, hk.o, true, 1, false, hk.x || {});
    }
    e.impact(t, Math.max(0.4, s.master.arr || 0));
    return this.cur;
  }

  // A pre-chorus sequences the hook up one scale step per bar, from the verse register into the chorus.
  climb(hk, k, scale) {
    if (!k) return hk;
    const c = (this.climbs ??= new WeakMap());
    if (!c.has(hk)) c.set(hk, new Map());
    const m = c.get(hk), key = `${k}:${scale.join()}`;
    if (!m.has(key)) m.set(key, { ...hk, s: hk.s.map((x) => (x ? [stepDeg(x[0], k, scale), x[1], x[2]] : 0)) });
    return m.get(key);
  }

  // The hook as developed for this point in the song (see js/motif.js), cached per hook and variant.
  motif(hk, kind, scale) {
    if (kind === 'orig') return hk;
    const c = (this.motifs ??= new WeakMap());
    if (!c.has(hk)) c.set(hk, new Map());
    const m = c.get(hk), key = `${kind}:${scale.join()}`;
    if (!m.has(key)) m.set(key, { ...hk, s: develop(hk.s, kind, scale) });
    return m.get(key);
  }

  // A classical score plays through, bar after bar, instead of looping one bar of steps.
  scoreStep(spec, abs, t, sd) {
    // A masterwork plays in its written key; a generated piece follows the KEY control.
    const sc = compose(spec), pos = abs % sc.at.length, k = spec.piece ? 0 : this.s.key > 6 ? this.s.key - 12 : this.s.key;
    this.scoreBar = Math.floor(pos / (sc.barLen || 16));
    // A generated song plays its score once: after the final chord's step the transport lets it ring and stops.
    if (this.s.ending && !sc.waiting && abs >= sc.at.length - 1) this.finished = true;
    if (sc.tempo !== this.scoreTempo) {
      this.scoreTempo = sc.tempo;
      this.variableScoreTempo = sc.tempo.some(scale => scale !== 1);
    }
    this.e.variableScoreTempo = this.variableScoreTempo;
    this.e.stepScale = sc.tempo[pos];
    sd *= sc.tempo[pos];
    const hum = this.s.master.humanize ?? 0.4;
    // off: the performer's roll / melody lead, in seconds.
    for (const [at, m, d, v, part, off = 0] of sc.at[pos]) {
      const lean = (hash(at * 3 + m, 33) - 0.5) * (0.006 + hum * 0.014);
      this.e.orch(part, Math.max(t - 0.03, t + (at - Math.floor(at)) * sd + lean + off), m + k, d * sd, v);
    }
  }

  lickCell(i16, vary) {
    const cell = (this.s.artist?.seed || 0) + i16;
    return i16 % 2 === 0 && hash(cell, 77) < vary * 0.28 ? { k: Math.floor(hash(cell, 78) * 6), v: 0.35 + hash(cell, 79) * 0.3 } : null;
  }

  bassPickup(pat, next, bar, t, tt, sd, pk) {
    const s = this.s, e = this.e, vary = s.master.vary || 0;
    const period = 4 * Math.max(1, Math.ceil(0.25 / vary));
    if (!vary || Math.round(s.params.acid.voice) === 4 || bar % period !== period - 1 || (next.len.acid || 16) !== 16) return null;
    const h = next.prog?.[(bar + 1) % next.prog.length], targetStep = next.steps.acid[0];
    if (!h || h.r === e.harm?.r || !targetStep?.on || targetStep.ap) return null;
    const high = Math.round(s.params.acid.voice) === 2 ? 38 : 43;
    const target = Engine.prototype.bassMidi.call({ state: s, harm: h, harmRoot: () => harmRoot(h) }, targetStep, 36, high);
    const scale = SCALES[s.scale]?.notes || SCALES.minor.notes;
    const pitch = [target - 1, target + 1, target - 2, target + 2].find((m) => m >= high - 11 && m <= high && scale.includes(((m - s.key) % 12 + 12) % 12));
    if (pitch == null) return null;
    const at = tt + pocketLate(pk, 'acid', 15), targetAt = t + sd + (s.master.humanize || 0) * 0.009 + pocketLate(pk, 'acid', 0);
    const until = targetAt - 0.008;
    if (until - at < 0.035) return null;
    const n = pitch - 36 - s.key - Math.round(s.params.acid.tune) - harmRoot(e.harm);
    return { t: at, st: { on: true, n, a: false, s: false, ap: true, until, target, targetAt } };
  }

  acidStep(pat, i, len, t, sd, slideUntil, kickAt) {
    const steps = pat.steps.acid;
    const st = steps[i];
    if (!st.on) { this.acidPrevSlide = false; return; }
    const next = steps[(i + 1) % len];
    let gap = 1;
    while (gap < len && !steps[(i + gap) % len].on) gap++;
    this.e.acidGap = gap;
    const span = st.s && next.on ? 2 : 1;
    if (this.s.master.swing8) this.e.acidGapSeconds = swingDuration(this.s, this.e.step, Math.min(8, gap), sd);
    const vel = this.e.noteVel;
    this.e.noteVel = (vel ?? 1) * (st.v ?? 1);
    this.e.acid(t, st, this.acidPrevSlide, st.s && next.on, swingDuration(this.s, this.e.step, span, sd) / span, slideUntil, kickAt);
    this.e.noteVel = vel;
    this.e.acidGap = 0;
    this.e.acidGapSeconds = undefined;
    this.acidPrevSlide = !!st.s;
  }
}
