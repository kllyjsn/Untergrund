import { TRACKS, TRACK_IDS, CHORDS, DELAY_TIMES, SCALES, KIT_BACKBEAT } from './params.js';
import { getSample } from './sampler.js';
import { getChops } from './voice.js';
import { pickChop } from './hum.js';
import { liveSet, loadLiveKit, loadKitExtra, loadSnare, BASS_NOTES, KIT_PITCH, bandKit, loadBand, STAB_BAND, HOOK_BAND, SOFT_LAYER, TAKES, MUTE_LAYER, bandName, BAND_LAYER } from './livekit.js';
import { compose, PART_SECTION } from './classical.js';
import { pocketOf, pocketLate, pocketVel } from './groove.js';
import { leadPreset, dbGain, STAB_TRIM_DB, HOOK_TRIM_DB, HOOK_LOW_DB, STAB_SHELF_HZ } from './lead.js';
import { lowEnd } from './lowend.js';
import { midiHz, makeNoise, makeIR, driveCurve, clipCurve, satCurve, SAT_HEADROOM } from './dsp.js';
import { processedStem } from './vocal-chain.js';
import { makeupGain } from './loudness.js';
import { harmRoot, chordIv, stabNotes, hookSnap, voiceLead } from './harmony.js';
import { develop, motifPlan, stepDeg } from './motif.js';
import { MELODY_BARS, strongNote } from './melody.js';
import { patternAt } from './scope.js';

const DUCKED = new Set(['acid', 'stab', 'vox']);
// Chords sit under a sung line the way a mix rides the keys under a vocal: a little in the chorus, more in the verse
// and most in the breakdown, so the drop still lands over it. Songs with sections already set the verse level.
const STAB_UNDER_VOICE = { n: 0.84, v: 0.78, b: 0.45 };
// Lead voices balanced for a sung line, so the voice sits at the same level over the band whichever one sings it
// (the reed is forward, the flute sits back). Songs with sections drop the verse by its section level, so
// the verse is sung a little forward to stay on top of the band.
const SUNG_VOICE = { reed: 0.6, oboe: 0.6, flute: 1.3 };
// The harp files are labeled an octave above the recorded strings. For the hook, map file IDs to measured pitch and trim the lead-in.
const HARP_PLUCK = {
  47: [34.82, 0.026], 53: [40.91, 0.030], 60: [47.98, 0], 64: [51.94, 0.044], 71: [58.86, 0.028],
  77: [64.99, 0.006], 81: [68.91, 0], 84: [71.89, 0.002], 91: [78.95, 0.016],
};
// Wind takes: cents from the file's pitch, lead-in seconds to skip, gain trim in dB.
const WIND_HOOK = {
  oboe: {
    gain: 1.23, presence: [2700, 0.8, 5.5],
    takes: { 58: [15, 0.048, 0], 62: [-4, 0.01, 0], 65: [-3, 0.01, 0], 70: [-3, 0.02, -2.3], 74: [1, 0, 1], 77: [3, 0.03, 0], 82: [6, 0, -1.5] },
    second: { 58: [2, 0.012, -1], 62: [-2, 0.012, -3], 65: [-1, 0.008, -3.7], 70: [-2, 0.032, -2.1], 74: [-1, 0.012, 1.9], 77: [0, 0.008, -3.8], 82: [2, 0, 1] },
  },
  airflute: {
    gain: 1.02, presence: [2950, 0.8, 6.2],
    takes: { 60: [1, 0.18, 3], 64: [-4, 0.11, 0], 69: [-18, 0.05, 0], 72: [-5, 0.01, 0], 76: [-5, 0.022, 0], 81: [-3, 0.022, -1.5], 84: [0, 0.043, 0] },
    second: { 60: [-36, 0.145, 3.8], 64: [-12, 0.105, 3], 69: [-2, 0.061, 0.8], 72: [2, 0.092, 3], 76: [0, 0.088, -0.5], 81: [0, 0.098, 0], 84: [0, 0.105, -3.2] },
  },
};
// Knob values the NEO-SOUL live-kit preset uses; the recorded samples play unaltered at these settings
const LIVE_REF = {
  kick: { tune: 52, decay: 0.5, drive: 0.2, click: 0.15, punch: 0.55 },
  snare: { tune: 200, decay: 0.22, snappy: 0.4 },
  ch: { tune: 1, decay: 0.05, tone: 3600 },
  oh: { tune: 1, decay: 0.32, tone: 6500 },
  ride: { tune: 1, decay: 1.4, tone: 3800 },
  acid: { cutoff: 320, drive: 0.3 },
};
const BACKBEAT_TOUCH = [0.42, 0.03, -0.42, -0.03];
const BACKBEAT_TAKE_TRIM = { 23: -1.15, 24: 0.2, 33: 0.25, 34: 0.3 };
const BACKBEAT_ATTACK_TRIM = [0, -0.25, 0.45, -0.05];
const hash = (n, k) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const EPS = 0.0001;
const SAMPLE_FADE = 1;
// Chord voices that sustain fill a breakdown on their own, so a smooth style only lifts the ones that decay.
const HELD_CHORDS = new Set(['pad', 'organ', 'strings', 'cello']);
const STAB_VOICES = [null, 'keys', 'pad', 'organ', 'brass', 'pluck', 'bells', 'piano', 'guitar', 'horns', 'strings', 'driveGuitar', 'acoustic', 'jazzGuitar', 'banjo', 'twangGuitar', 'cello', 'clarinet'];
const GRIPPED = new Set(['guitar', 'driveGuitar', 'acoustic', 'jazzGuitar', 'banjo', 'twangGuitar']);
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
  const pcs = [...new Set(iv.slice(1).map((n) => ((n % 12) + 12) % 12))].filter((pc) => pc !== 0 && !(iv.length > 4 && pc === 7));
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
  pop: [-1.5, -9, 4.5, 1.5, 0.6], rnb: [0, -7, 6.5, 2.5, 0.6], rock: [-4, -5, 4.5, 3, 0.6],
  folk: [3, -3, 0.5, 4, 0.5], country: [2, -3, 2.5, 4, 0.6],
};

const BAND_PLAY = {
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
  // The archtop's magnetic pickup, neck position, tone rolled back: round, woody comping for soul and jazz chords.
  jazz: { gain: 9.5, len: 2.4, min: 0.5, softBelow: 0, strum: 0.005, shift: 0, lo: 43, hi: 72, lp: 3400, soft: 900, fade: 0.008, rel: 0.2, grip: true, even: 0.25 },
  // Six-string guitar banjo: a fast snappy strum that dies quickly, all top end.
  banjo: { gain: 5, len: 1.2, min: 0.3, strum: 0.007, shift: 0, lo: 45, hi: 79, lp: 9000, soft: 0, fade: 0.006, rel: 0.12, grip: true, even: 0.4 },
  // The green Gretsch hollow-body: bright, snappy, open chords that ring for country and rockabilly.
  gretsch: { gain: 4.2, len: 2.6, min: 0.6, softBelow: 0, strum: 0.006, shift: 0, lo: 40, hi: 74, lp: 4600, peak: [3400, 1.2, -4], soft: 1100, fade: 0.008, rel: 0.18, grip: true, even: 0.3 },
};
// Country lead: the same guitar clean and bright off the bridge pickup, single notes with a slapback.
BAND_PLAY.twang = { ...BAND_PLAY.gtr, gain: 3, len: 1.4, min: 0.25, softBelow: 0, lo: 52, hi: 84, lp: 6800, grip: false, even: 0.4, rel: 0.12, oct: 0, slap: true };
// The rock band's riff guitar: the rhythm amp, double-stops up the neck.
BAND_PLAY.lead = { ...BAND_PLAY.drive, lo: 45, hi: 79, grip: false, even: 0.4, gain: 2.2, lp: 4400, soft: 1600, vib: 8, rel: 0.16, oct: -1, dyad: true };
// The singing envelope of a vocal stem, ENV_RATE frames a second: 1 while it sings (from 40 ms before a phrase to 200 ms
// after it), 0 in its rests, smoothed (40 ms attack, 250 ms release). Engine.duckUnder() dips the band by it.
export const ENV_RATE = 50;
const envelopes = new WeakMap();
export function singingEnvelope(buf) {
  let env = envelopes.get(buf);
  if (env) return env;
  const d = buf.getChannelData(0), w = Math.round(buf.sampleRate / ENV_RATE), n = Math.ceil(d.length / w), rms = new Float32Array(n);
  for (let k = 0; k < n; k++) { let e = 0; const end = Math.min(d.length, (k + 1) * w); for (let j = k * w; j < end; j++) e += d[j] * d[j]; rms[k] = Math.sqrt(e / w); }
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
  get hardTechno() { return this.state.artist?.style === 'hardtechno'; }
  constructor(ctx, state, { realtime = true, vocal = null, trackQueuedNotes = false } = {}) {
    this.ctx = ctx;
    this.state = state;
    this.realtime = realtime;
    this.vocalOf = vocal;
    this.queuedNotes = trackQueuedNotes ? [] : null;
    this.queuedNotesPrunedAt = 0;
    this.editableHits = [];
    this.ducks = [];
    this.noise = makeNoise(ctx, 2);
    this.buildMaster();
    this.buildFx();
    this.buildChannels();
    this.buildAcid();
    this.applyAll();
  }

  get stepDur() { return (60 / this.state.bpm / 4) * (this.stepScale || 1); }

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

  buildMaster() {
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
    this.clip = c.createWaveShaper(); this.clip.curve = clipCurve(CLIP_HEADROOM); this.clip.oversample = '4x';
    this.out = this.gain(OUT_TRIM);
    // Song sections (Sequencer.sectionLevel) after the clipper, so the limiter and clipper see the same signal.
    this.secGain = this.gain(1);
    // While the neural singer sings, the band dips under it (bandDuck) so the sung mix stays on the loudness target.
    this.bandDuck = this.gain(1);
    // ...and the limiter, which then works less, would still let it add about a dB: singTrim takes that back after it.
    this.singTrim = this.gain(1);
    this.preMaster = this.gain(1);
    this.mix.connect(this.bandDuck).connect(this.preMaster);
    this.preMaster.connect(this.djHP).connect(this.djLP).connect(this.arrLP).connect(this.toneLow).connect(this.toneMud).connect(this.tonePres).connect(this.toneAir).connect(this.widthIn);
    this.widthOut.connect(this.glue).connect(this.satIn).connect(this.sat)
      .connect(this.warm).connect(this.master).connect(this.limIn).connect(this.limiter).connect(this.limTrim).connect(this.clip).connect(this.secGain).connect(this.singTrim).connect(this.out);
    this.out.connect(c.destination);
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
    // Reverb
    this.revIn = this.gain(1);
    this.revHP = this.filter('highpass', 240);
    this.revConv = c.createConvolver();
    this.revConv.buffer = makeIR(c, 3.8, { decay: 3.4, brightStart: 0.8, brightEnd: 0.1, predelay: 0.018 });
    this.revLP = this.filter('lowpass', 4500);
    this.revOut = this.gain(0.7);
    this.revIn.connect(this.revHP).connect(this.revConv).connect(this.revLP).connect(this.revOut).connect(this.duck);
    // Short shared room so the whole band sounds like it plays in one space
    this.roomIn = this.gain(1);
    this.roomConv = c.createConvolver();
    this.roomConv.buffer = makeIR(c, ...IR.room);
    this.roomHP = this.filter('highpass', 160);
    this.roomOut = this.gain(0);
    this.roomIn.connect(this.roomHP).connect(this.roomConv).connect(this.roomOut).connect(this.mix);
    // Recorded players get the body and air of a real room around them; dry mono samples read as a plug-in.
    this.bandIn = this.gain(1);
    this.bandConv = c.createConvolver();
    this.bandConv.buffer = makeIR(c, ...IR.band);
    this.bandIn.connect(this.filter('highpass', 140)).connect(this.bandConv).connect(this.filter('lowpass', 7000))
      .connect(this.gain(0.45)).connect(this.mix);

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
    merge.connect(this.dlyOut).connect(this.duck);

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
    a.o1.start(0); a.o2.start(0); a.env.start(0);
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
    if (this.at) param.setTargetAtTime(v, this.at, 0.004);
    else if (immediate) param.value = v;
    else param.setTargetAtTime(v, this.ctx.currentTime, 0.015);
  }

  applyAll() {
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
    this.setTo(this.limTrim.gain, (this.hardTechno ? 1 : LIM_TRIM) / CLIP_HEADROOM, true);
    this.setTo(this.out.gain, this.hardTechno ? 0.98 : OUT_TRIM, true);
    this.applyTone();
    this.applyStrips();
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
    if (id === 'level') return this.setTo(ch.level.gain, v * (tid === 'stab' && this.smoothOn > 0 ? 10 ** (this.smoothOn / 20) : 1), immediate);
    if (id === 'pan') return this.setTo(ch.pan.pan, v, immediate);
    if (id === 'rev') return this.setTo(ch.rev.gain, v * (tid === 'stab' && this.smoothOn > 0 ? 1.6 : 1), immediate);
    if (id === 'dly') return this.setTo(ch.dly.gain, v * (tid === 'stab' && this.smoothOn > 0 ? 1.6 : 1), immediate);
    if (tid === 'kick' && id === 'rumble') return this.setTo(ch.rumble.gain, v * v, immediate);
    if (tid === 'acid') {
      const a = this.acidNodes;
      if (id === 'wave') { this.setTo(a.g1.gain, 1 - v, immediate); this.setTo(a.g2.gain, v * 0.72, immediate); }
      if (id === 'cutoff') { this.setTo(a.f1.frequency, v, immediate); this.setTo(a.f2.frequency, v, immediate); }
      if (id === 'reso') { this.setTo(a.f2.Q, v, immediate); this.setTo(a.f1.Q, v * 0.12, immediate); }
      if (id === 'drive') {
        a.shaper.curve = driveCurve(v * 0.75);
        this.setTo(a.post.gain, 1.05 / (1 + v * 1.1), immediate);
      }
    }
  }

  applyMaster(id, immediate = false) {
    const m = this.state.master;
    const v = m[id];
    if (id === 'pocket' || id === 'kit') this.applyStrips();
    if (id === 'dj') {
      const { hp, lp, q } = djFilter(v);
      this.setTo(this.djHP.frequency, hp, immediate); this.setTo(this.djLP.frequency, lp, immediate);
      this.setTo(this.djHP.Q, q, immediate); this.setTo(this.djLP.Q, q, immediate);
    } else if (id === 'drive') {
      this.sat.curve = satCurve(v);
    } else if (id === 'volume') this.setTo(this.master.gain, v, immediate);
    else if (id === 'room') this.setTo(this.roomOut.gain, (v || 0) * 0.9, immediate);
    else if (id === 'warmth') this.setTo(this.warm.frequency, 20000 * Math.pow(0.22, v || 0), immediate);
    else if (id === 'revLevel') this.setTo(this.revOut.gain, v, immediate);
    else if (id === 'revTone') this.setTo(this.revLP.frequency, v, immediate);
    else if (id === 'dlyFb') this.setTo(this.fb.gain, v, immediate);
    else if (id === 'dlyLevel') this.setTo(this.dlyOut.gain, v, immediate);
    else if (id === 'dlyTime') this.applyDelayTime(immediate);
  }

  applyDelayTime(immediate = false) {
    const steps = DELAY_TIMES[Math.round(this.state.master.dlyTime)].steps;
    const t = Math.min(3.9, steps * this.stepDur);
    if (immediate) { this.dL.delayTime.value = t; this.dR.delayTime.value = t; }
    else {
      const now = Math.max(this.ctx.currentTime, this.at || 0);
      this.dL.delayTime.setTargetAtTime(t, now, 0.08);
      this.dR.delayTime.setTargetAtTime(t, now, 0.08);
    }
  }

  // ---------- helpers ----------
  startSource(src, t, ...args) {
    src.start(t, ...args);
    if (!this.queuedNotes) return;
    const now = this.ctx.currentTime;
    if (t <= now) return;
    if (now - this.queuedNotesPrunedAt > 0.25) {
      this.queuedNotes = this.queuedNotes.filter(note => note.t > now);
      this.queuedNotesPrunedAt = now;
    }
    const note = { src, t };
    this.queuedNotes.push(note);
    this.editingHit?.sources.push(note);
  }

  planHit(time, track, pattern, plan) {
    const hit = { time, track, pattern, plan, note: plan(), sources: [], ducks: [] };
    this.editableHits.push(hit);
    if (hit.note) this.renderHit(hit);
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

  discardQueuedNotes(now) {
    this.vocalStop(now);
    // stop() before a source's scheduled start prevents it from sounding.
    for (const { src, t } of this.queuedNotes) if (t > now) src.stop(now);
    this.queuedNotes.length = 0;
    this.editableHits.length = 0;
    this.ducks.length = 0;

    const acid = this.acidNodes;
    for (const p of [acid.env.offset, acid.o1.frequency, acid.o2.frequency, this.subVoice?.o.frequency]) p?.cancelScheduledValues(now);
    for (const p of [acid.vca.gain, this.subVoice?.amp.gain, this.mono?.amp.gain]) p?.cancelScheduledValues(now);
    this.acidRelease(now);
    for (const p of [this.duck.gain, this.rumbleDuck.gain, this.ch.acid.sc?.gain, this.windDuck?.gain]) {
      if (!p) continue;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(1, now, 0.01);
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
    const depth = this.state.master.duck * Math.min(1, v * 1.25) * 0.9;
    // Pump recovers over roughly one beat so offbeat basslines and pads audibly breathe
    const parts = [[this.duck.gain, depth, this.stepDur * 1.5, 0.0025, 0.03],
      [this.rumbleDuck.gain, 0.98, this.stepDur * 0.47, 0.0025, 0.03]];
    // Club low end: the kick owns the first few ms, then the bass comes straight back.
    const L = lowEnd(this.state.master), sc = this.ch.acid.sc?.gain;
    if (L && sc) parts.push([sc, L.dip * Math.min(1, v * 1.2), L.rel, 0.002, 0.012]);
    // Keep the wind lead out of the glue compressor's way during a kick's attack.
    if (this.windDuck) parts.push([this.windDuck.gain, 0.62 * Math.min(1, v * 1.2), 0.045, 0.003, 0.035]);
    const duck = { t, parts };
    if (this.queuedNotes) {
      this.ducks = this.ducks.filter(d => d.t + 0.03 >= this.ctx.currentTime);
      this.ducks.push(duck);
      this.editingHit?.ducks.push(duck);
    }
    if (!this.revisingHits) this.scheduleDuck(duck);
  }

  scheduleDuck({ t, parts }) {
    for (const [param, depth, release, attack, hold] of parts) {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(1 - depth, t, attack);
      param.setTargetAtTime(1, t + hold, release);
    }
  }

  // Rebuild only future ducking; a hit already sounding keeps its current pump.
  rebuildDucks(from) {
    this.ducks.sort((a, b) => a.t - b.t);
    for (const param of [this.duck.gain, this.rumbleDuck.gain, this.ch.acid.sc?.gain, this.windDuck?.gain]) {
      if (!param) continue;
      param.cancelScheduledValues(from);
      let previous;
      for (const duck of this.ducks) {
        if (duck.t >= from) break;
        if (duck.parts.some(p => p[0] === param)) previous = duck;
      }
      if (previous) {
        const [, , release, , hold] = previous.parts.find(p => p[0] === param);
        if (previous.t + hold >= from) param.setTargetAtTime(1, previous.t + hold, release);
      }
    }
    for (const duck of this.ducks) if (duck.t >= from) this.scheduleDuck(duck);
  }

  // A live band (SOUL pocket on the LIVE kit) is balanced as recorded; level matching is for club mixes.
  soulBand() { return pocketOf(this.state.master)?.name === 'SOUL' || Math.round(this.state.master.kit || 0) === 1; }

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

  trigger(id, t, v, underHarp = false) {
    const kitMode = Math.round(this.state.master.kit || 0);
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
    const c = this.ctx, f = 1800 * Math.sqrt(p.tune / 240), dec = Math.max(0.02, p.decay * 0.25);
    for (const [m, l] of [[1, 0.8], [1.48, 0.25]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
      const g = this.gain(0); this.adEnv(g.gain, t, v * l, 0.0005, dec);
      o.connect(g).connect(out); this.startSource(o, t); o.stop(t + dec + 0.03);
    }
  }
  dust(t, sd, abs) {
    // Vinyl/tape bed: faint hiss plus sparse crackle, scheduled per step so it stops with transport.
    const d = this.state.master.dust || 0;
    // The hiss filter is linear and fixed, so every step's noise slice shares one band-pass and level.
    if (!this.hiss) { const g = this.gain(d * 0.018); this.hiss = { bp: this.filter('bandpass', 5200, 0.4), g, d }; this.hiss.bp.connect(g).connect(this.mix); }
    if (this.hiss.d !== d) { this.hiss.g.gain.setValueAtTime(d * 0.018, t); this.hiss.d = d; }
    this.noiseSrc(t, sd).connect(this.hiss.bp);
    for (let k = 0; k < 3; k++) {
      if (hash(abs, k + 70) > d * 0.55) continue;
      const tt = t + hash(abs, k + 80) * sd, c = this.noiseSrc(tt, 0.003);
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
    if (fx.lp) {
      const lp = this.filter('lowpass', fx.lp, 0.5);
      // The first 30 ms of a picked string is bright zing and pick noise; a thumb rounds it off.
      if (fx.lpFrom && fx.lpFrom < fx.lp) { lp.frequency.setValueAtTime(fx.lpFrom, t); lp.frequency.exponentialRampToValueAtTime(fx.lp, t + 0.09); }
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
    const rate = clamp(ref.tune ? p.tune / ref.tune : 1, 0.6, 1.7);
    const full = buf.duration / rate;
    const dur = p.decay < ref.decay ? Math.max(0.03, full * (p.decay / ref.decay)) : 0;
    const shelves = [];
    if (ref.tone) shelves.push([4500, clamp(9 * Math.log2(p.tone / ref.tone), -18, 12)]);
    if (ref.snappy != null) shelves.push([2500, clamp((p.snappy - ref.snappy) * 20, -12, 12)]);
    if (ref.click != null) shelves.push([3000, clamp((p.click - ref.click) * 22, -12, 15)]);
    // A shorter snare DECAY damps the shell ring (485-885 Hz) the way a towel or gel on the head does.
    const peaks = id === 'snare' && p.decay < ref.decay ? [[550, 1.5, -10 * (1 - p.decay / ref.decay)], [880, 2, -8 * (1 - p.decay / ref.decay)]] : [];
    const drive = ref.drive != null ? Math.max(0, p.drive - ref.drive) * 1.2 : 0;
    const punch = ref.punch != null ? (p.punch - ref.punch) * 1.4 : 0;
    const fx = { shelves, peaks, drive, punch };
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
    this.playBuf(buf, t, level, this.ch[id].input, drift * rate, durOverride ?? o.dur, o.fx);
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
      this.liveHit(kit, `hh_v${layer}_${take(`hh${layer}`, 4)}`, 'ch', t, 0.32 * lift * v ** 1.5, drift);
      return true;
    }
    if (id === 'oh') {
      this.liveHit(kit, (v > 0.7 ? 'hh_open' : 'hh_half') + (take(v > 0.7 ? 'open' : 'half', 2) === 2 ? '_2' : ''), 'oh', t, 0.3 * lift * v, drift, 0.15 + this.state.params.oh.decay * 0.9);
      return true;
    }
    if (id === 'ride') {
      const layer = v > 0.85 ? 3 : v > 0.55 ? 2 : 1;
      const name = layer === 2 ? `ride_v2_${take('ride2', 2)}` : `ride_v${layer}_1`;
      this.liveHit(kit, name, 'ride', t, 0.3 * lift * v ** 1.3, drift);
      return true;
    }
    return false;
  }

  sampledBass(kit, t, m, len, accent) {
    let [name, center] = BASS_NOTES[0];
    for (const [n, c] of BASS_NOTES) if (Math.abs(c - m) < Math.abs(center - m)) [name, center] = [n, c];
    const out = this.ch.acid.input, p = this.state.params.acid, ref = LIVE_REF.acid;
    const fx = { shelves: [[700, Math.max(-24, Math.min(12, 8 * Math.log2(p.cutoff / ref.cutoff)))]], drive: Math.max(0, p.drive - ref.drive) * 1.4 };
    this.playBuf(kit[`bass_${name}_${hash(t * 1000, 3) > 0.5 ? 'a' : 'b'}`], t, (accent ? 1.2 : 1) * (this.noteVel ?? 1), out, Math.pow(2, (m - center) / 12), len, fx);
    const sub = this.ctx.createOscillator(); sub.frequency.value = midiHz(m);
    const sg = this.gain(0);
    sg.gain.setValueAtTime(EPS, t);
    sg.gain.linearRampToValueAtTime(0.12, t + 0.01);
    sg.gain.setTargetAtTime(0.07, t + 0.05, 0.2);
    sg.gain.setTargetAtTime(0, t + len, 0.04);
    sub.connect(this.filter('lowpass', 120, 0.7)).connect(sg).connect(out);
    this.startSource(sub, t); sub.stop(t + len + 0.3);
  }

  kick(t, v) {
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
    bp.connect(hp).connect(env).connect(out);
    for (const o of [...oscs, ...oscs2]) o.stop(t + p.decay + 0.05);
    this.retire(wash, env);
  }

  perc(t, v) {
    const c = this.ctx, p = this.state.params.perc, out = this.ch.perc.input;
    const vo = Math.round(p.voice || 0);
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

  // FM electric piano: sine carrier, 1:1 modulator for the bark, 14:1 burst for the tine.
  keys(t, v, iv, root, p, out) {
    const c = this.ctx, end = t + Math.max(0.6, p.decay * 3) + 0.3;
    const lp = this.filter('lowpass', Math.min(9000, p.cutoff * 2.5), 0.5);
    const trem = c.createStereoPanner();
    const lfo = c.createOscillator(); lfo.frequency.value = 4.8;
    const depth = this.gain(0.35); lfo.connect(depth).connect(trem.pan);
    // Soft ARTICULATION is a mellow, felt-damped Rhodes; hard playing brings out the bark and the tine.
    const bite = 0.4 + 1.2 * Math.max(0, Math.min(1, p.env ?? 0.5));
    iv.forEach((n, k) => {
      const f = midiHz(root + n), vel = v * (0.85 + hash(t * 97, k) * 0.3);
      const car = c.createOscillator(); car.frequency.value = f; car.detune.value = (k % 2 ? 1 : -1) * p.detune * 0.15;
      const mod = c.createOscillator(); mod.frequency.value = f;
      const modAmt = this.gain(0); mod.connect(modAmt).connect(car.frequency);
      modAmt.gain.setValueAtTime(f * (0.6 + vel * 1.6) * bite, t);
      modAmt.gain.setTargetAtTime(f * 0.15, t + 0.005, 0.12 + p.env * 0.3);
      const tine = c.createOscillator(); tine.frequency.value = f * 14;
      const tineAmt = this.gain(0); tine.connect(tineAmt).connect(car.frequency);
      tineAmt.gain.setValueAtTime(f * 2.5 * vel * bite * (p.tine ?? 1), t);
      tineAmt.gain.setTargetAtTime(0, t + 0.002, 0.018);
      const amp = this.gain(0);
      amp.gain.setValueAtTime(EPS, t);
      amp.gain.linearRampToValueAtTime((0.42 * vel) / Math.sqrt(iv.length), t + 0.004);
      amp.gain.setTargetAtTime(0, t + 0.01, Math.max(0.15, p.decay * 0.9));
      car.connect(amp).connect(lp);
      for (const o of [car, mod, tine]) { this.startSource(o, t); o.stop(end); }
    });
    lp.connect(trem).connect(out);
    this.startSource(lfo, t); lfo.stop(end);
  }

  stab(t, v, underHarp = false) {
    const c = this.ctx, p = this.state.params.stab;
    const h = this.harm;
    const { root, notes, home } = stabNotes(this.state, h);
    const vo = Math.round(p.voice), voiced = this.lastChord = voiceLead(notes, this.lastChord, home);
    // A song's chorus opens the voicing: the top voice doubled an octave up.
    const vi = (GRIPPED.has(STAB_VOICES[vo]) ? notes : voiced).map((m) => m - root);
    const iv = this.wide && !GRIPPED.has(STAB_VOICES[vo]) && vi.length > 2 ? [...vi, Math.max(...vi) + 12] : vi, out = this.trimOut(`stab${vo}`, this.soulBand() ? 0 : STAB_TRIM_DB[vo] || 0, this.ch.stab.input, 0, STAB_SHELF_HZ[vo]);
    // A lifted breakdown plays decaying chords an octave up, filling it above the bass range it no longer shares.
    if (vo > 0) {
      const pitches = this.smoothOn > 0 ? iv.map((m) => m + 12) : iv;
      if (STAB_VOICES[vo] === 'bells' && underHarp && this.rec('harp', false)) {
        return this.bells(t, v, pitches, root, { ...p, decay: p.decay * 0.57 }, this.harpBacking(out));
      }
      return this[STAB_VOICES[vo]](t, v, pitches, root, p, out);
    }
    const lp = this.filter('lowpass', p.cutoff, p.reso);
    const amp = this.gain(0);
    const env = c.createConstantSource();
    env.offset.setValueAtTime(p.env * 3600 * v, t);
    env.offset.setTargetAtTime(0, t + 0.004, Math.max(0.01, p.decay * 0.35));
    env.connect(lp.detune);
    const peak = (v * 0.55) / Math.sqrt(iv.length);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(peak, t + (this.hardTechno ? 0.018 : 0.003));
    amp.gain.setTargetAtTime(0, t + (this.hardTechno ? 0.04 : 0.012), Math.max(0.02, p.decay * 0.5));
    const end = t + p.decay * 4 + 0.2, pans = this.sidePans([-0.55, 0.55], lp);
    for (const n of iv) {
      for (const side of [-1, 1]) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = midiHz(root + n);
        o.detune.value = side * p.detune;
        o.connect(pans[side < 0 ? 0 : 1]);
        this.startSource(o, t); o.stop(end);
      }
    }
    lp.connect(amp).connect(out);
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

  // Slow-swelling ensemble: three detuned saws per note, filter opens with ENV, DECAY sets release.
  pad(t, v, iv, root, p, out) {
    const c = this.ctx, atk = 0.04 + p.env * 0.9, hold = Math.max(this.stepDur * 4, p.decay * 1.2), end = t + atk + hold + p.decay * 2 + 0.2;
    const lp = this.filter('lowpass', p.cutoff * 0.5, Math.max(0.5, p.reso * 0.4));
    lp.frequency.setValueAtTime(p.cutoff * 0.4, t);
    lp.frequency.linearRampToValueAtTime(p.cutoff, t + atk);
    const amp = this.gain(0), peak = (v * 0.3) / Math.sqrt(iv.length);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(peak, t + atk);
    amp.gain.setTargetAtTime(0, t + atk + hold, Math.max(0.1, p.decay * 0.6));
    const pans = this.sidePans([-0.7, 0, 0.7], lp);
    iv.forEach((n) => {
      [-1, 0, 1].forEach((side) => {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = midiHz(root + n); o.detune.value = side * (4 + p.detune);
        o.connect(pans[side + 1]); this.startSource(o, t); o.stop(end);
      });
    });
    lp.connect(amp).connect(out);
  }

  // Drawbar organ with key click and a rotary-style vibrato; DETUNE sets rotor depth.
  organ(t, v, iv, root, p, out) {
    const c = this.ctx, gate = Math.max(0.08, p.decay * 0.9), end = t + gate + 0.25;
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
        const o = c.createOscillator(); o.frequency.value = f * mul; vib.connect(o.detune);
        const g = this.gain(lvl); o.connect(g).connect(lp); this.startSource(o, t); o.stop(end);
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
  stepLate(pk, s) { return (s % 2 ? (this.state.swing || 0) * this.stepDur * 0.5 : 0) + pocketLate(pk, 'stab', s % 16); }

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
    lfo.start();
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
      lfo.connect(amt).connect(inp.gain); lfo.start();
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
      shelves: [[3000, tone]], peaks: R?.peak ? [R.peak] : [], lp: R ? R.lp * (F ? F[1] : 1) * (0.4 + 0.6 * hv) : 0, lpFrom: F ? F[0] : R?.soft ?? 0, fade: R?.fade ?? 0, release: R ? R.rel : 0.05, vib: R?.vib || 0,
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
    if (this.stripMode && this.acidGap && !st.ap) len = Math.max(len, Math.min(8, this.acidGap) * sd - 0.025);
    this.acidGap = 0;
    let [c, buf] = set[0];
    for (const [cm, b] of set) if (Math.abs(cm - m) < Math.abs(c - m)) [c, buf] = [cm, b];
    const ref = LIVE_REF.acid, fx = { shelves: [[900, Math.max(-24, Math.min(10, 8 * Math.log2(p.cutoff / ref.cutoff)))]], drive: Math.max(0, p.drive - ref.drive) * 1.4, release: 0.05 };
    // A harder pluck is brighter: the finger digs in and the string's upper partials speak.
    if (this.stripMode) { const vel = Math.min(1.2, (this.noteVel ?? 1) * (st.a ? 1.15 : 1)); fx.lp = 1400 + 3600 * vel * vel; }
    this.playBuf(buf, t, 1.1 * (st.a ? 1.15 : 1) * (this.noteVel ?? 1), this.ch.acid.input, Math.pow(2, (m - c) / 12) * (1 + (hash(t * 1000, 5) - 0.5) * 0.002), len, fx);
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
      if (i16) continue;
      const m = part === 'vc' ? root - 12 : part === 'vla' ? notes[1] ?? root : Math.max(...notes) + 12;
      this.orch(part, t, fit(part, m), 16 * sd * 1.02, v * (part === 'vln1' ? 0.85 : part === 'vla' ? 0.9 : 1));
    }
  }
  driveGuitar(...a) { return this.recorded('drive', 'pluck', ...a); }
  acoustic(...a) { return this.recorded('agtr', 'pluck', ...a); }
  jazzGuitar(...a) { return this.recorded('jazz', 'keys', ...a); }
  banjo(...a) { return this.recorded('banjo', 'pluck', ...a); }
  twangGuitar(...a) { return this.recorded('gretsch', 'pluck', ...a); }
  guitar(...a) { return this.recorded('gtr', 'pluck', ...a); }
  horns(...a) { return this.recorded('horn', 'brass', ...a); }
  strings(...a) { return this.recorded('str', 'pad', ...a); }
  cello(...a) { return this.recorded('cello', 'pad', ...a); }
  clarinet(...a) { return this.recorded('cl', 'keys', ...a); }

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
    const c = this.ctx, p = this.state.params.vox, sample = getSample();
    const { buffer, slices } = sample;
    const jump = hash(step, 1) < p.scatter ? Math.floor(hash(step, 2) * slices.length) : 0;
    const idx = (Math.round(p.slice) + jump) % slices.length;
    const from = slices[idx], to = slices[idx + 1] ?? buffer.duration;
    const notes = SCALES[this.state.scale]?.notes || SCALES.minor.notes;
    const degree = hash(step, 3) < p.melody ? notes[Math.floor(hash(step, 4) * notes.length)] : 0;
    const rate = 2 ** ((Math.round(p.pitch) + degree) / 12);
    const dur = Math.max(0.03, Math.min((to - from) / rate, p.length * this.stepDur));
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = p.tone; lp.Q.value = 0.7;
    const amp = this.gain(0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(v, t + 0.004);
    amp.gain.setValueAtTime(v, t + Math.max(0.005, dur - 0.015));
    amp.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(lp).connect(amp).connect(this.ch.vox.input);
    this.startSource(src, t, from, dur + 0.02);
  }

  lick(t, v, k) {
    const p = this.state.params.stab, h = this.harm;
    const iv = CHORDS[h ? h.c : Math.round(p.chord)].iv;
    const n = iv[k % iv.length] + 12 * Math.floor(k / iv.length);
    const vo = Math.round(p.voice), lead = vo > 1 ? STAB_VOICES[vo] : 'keys';
    return this[lead](t, v, [n], 60 + this.state.key + Math.round(p.octave) * 12 + this.harmRoot(), p, this.ch.stab.input);
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
    const { gain, presence, takes, second } = WIND_HOOK[voice];
    const alt = this.rec(TAKES[HOOK_BAND[voice]]);
    // The longer primary take can sustain through holds after transposition.
    const useAlt = alt && (take + (harm ? 1 : 0)) % 2 && dur <= 0.85;
    const [pitch, buf] = (useAlt ? alt : set).reduce((best, note) => Math.abs(note[0] - m) < Math.abs(best[0] - m) ? note : best);
    const [cents, offset, trim] = (useAlt ? second : takes)[pitch];
    // Vary the air and tongue by song step so late joins and offline renders use the same attack.
    const step = (this.step ?? 0) * 2 + (harm ? 1 : 0);
    const air = hash(step, m + 29), tongue = hash(step, m + 71), touch = Math.min(1, v);
    const out = this.trimOut(`hook-${voice}`, 1, this.hookBus || this.windDuck, -4, 500);
    const eq = this.bodyFor(this.bodyFor(out, presence), [780, 1.2, -2.5]);
    return this.playBuf(buf, t, gain * touch * dbGain(trim + (air - 0.5) * 1.2), eq,
      2 ** ((m - pitch - cents / 100) / 12), Math.max(0.06, dur * 0.92), {
        lp: 3850 + 2100 * touch + 650 * (air - 0.5), offset: offset + tongue * 0.012,
        fade: (strong ? 0.007 : 0.012) + 0.009 * (1 - tongue),
        attackGain: (strong ? 1.04 : 0.9) + (tongue - 0.5) * 0.24,
        release: 0.055, ringOut: true,
      });
  }

  // Song hook: one lead note per call, snapped to the current chord on strong beats so it follows the changes.
  hook(t, v, n, dur, voice, oct = 0, strong = false, b = 1, up = false, expression = {}) {
    const c = this.ctx, p = this.state.params.stab, h = this.harm;
    v *= 1.3;
    n = hookSnap(n, h, p, strong, up);
    const k = this.state.key > 6 ? this.state.key - 12 : this.state.key;
    const wind = Object.hasOwn(WIND_HOOK, voice);
    if (wind) {
      const name = HOOK_BAND[voice], set = this.rec(name);
      if (set) return this.windHook(set, t, v, 60 + k + oct * 12 + n, dur, voice, strong, expression);
      loadBand(name);
      voice = 'reed';
    }
    if (voice === 'harpplk') {
      const harp = this.rec('harp');
      if (harp) return this.harpHook(harp, t, v, 60 + k + oct * 12 + n, dur);
      loadBand('harp');
      voice = 'softmallet';
    }
    if (voice === 'chop') {
      const vc = getChops();
      if (vc) return this.chopNote(vc, t, v, 60 + k + oct * 12 + n, dur, expression, null, this.hookBus || this.ch.stab.input);
      voice = 'vocal';
    }
    voice = { saw: 'analog', sq: 'pulse', flute: 'reed', bell: 'mallet', pluck: 'warm' }[voice] || voice;
    const warmth = expression.warmth ?? 0.5;
    // Genres on a recorded instrument let that player take the melody too; synth-pop leads stay synths.
    const twang = !wind && pocketOf(this.state.master)?.walk && this.rec('gtr');
    const band = twang ? 'gtr' : !wind && voice !== 'pulse' && STAB_BAND[Math.round(p.voice)], set = band && this.rec(band);
    if (set) {
      const kind = twang ? 'twang' : Math.round(p.voice) === 11 ? 'lead' : band, R = BAND_PLAY[kind], ring = R.hold ? dur * 1.05 : Math.max(R.min * 0.6, dur * 1.5);
      let dest = this.hookBus || this.ch.stab.input;
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
    const out = this.trimOut(`hook-${voice}`, hdb, this.hookBus || this.ch.stab.input, voice === 'softmallet' ? 4 : HOOK_LOW_DB);
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

  // Round finger-style bass: triangle + sine, short pluck through a gentle lowpass.
  bass(t, st, sd, holdNext) {
    const c = this.ctx, p = this.state.params.acid;
    const note = this.bassMidi(st), f = midiHz(note), subF = midiHz(this.bassMidi(st, 36, 38));
    // A chromatic approach note leads into the next bar and gets out of the way when the chord lands.
    const len = st.ap ? sd * 0.9 : holdNext ? sd * 2 : sd * (0.9 + p.decay * 2);
    if (Math.round(this.state.master.kit || 0) === 1) {
      const kit = this.rec('kit');
      if (kit) return this.sampledBass(kit, t, note, len, st.a);
      loadLiveKit();
    }
    const tri = c.createOscillator(); tri.type = 'triangle'; tri.frequency.value = f;
    const sub = c.createOscillator(); sub.frequency.value = subF;
    const lp = this.filter('lowpass', 180 + p.cutoff * 0.6 + (st.a ? 500 : 0), 0.7);
    lp.frequency.setTargetAtTime(160 + p.cutoff * 0.3, t + 0.01, 0.08);
    const grit = this.ctx.createWaveShaper(); grit.curve = driveCurve(0.18 + p.drive * 0.5);
    const pick = this.noiseSrc(t, 0.02), pbp = this.filter('bandpass', 1100 + f * 4, 1.2), pg = this.gain(0);
    this.adEnv(pg.gain, t, st.a ? 0.16 : 0.1, 0.0008, 0.012);
    pick.connect(pbp).connect(pg).connect(this.ch.acid.input);
    const amp = this.gain(0), vel = (st.a ? 1 : 0.82) * (1 - p.drive * 0.2) * (this.noteVel ?? 1);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.006);
    amp.gain.setTargetAtTime(vel * 0.55, t + 0.02, 0.12);
    amp.gain.setTargetAtTime(0, t + len, 0.03);
    const subLevel = this.gain(0.72);
    tri.connect(lp); lp.connect(grit).connect(amp);
    sub.connect(subLevel).connect(amp);
    amp.connect(this.ch.acid.input);
    const oscs = [tri, sub];
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
  eight08(t, st, sd, holdNext, sliding) {
    const c = this.ctx, p = this.state.params.acid;
    const f = midiHz(this.bassMidi(st, 36, 38));
    const len = holdNext ? sd * 2 : 0.15 + p.decay * 1.6, end = t + len + 0.4;
    const decay = Math.max(0.05, len * 0.45), prev = this.mono;
    if (sliding && prev?.eight08 && prev.end > t) {
      // Keep oscillator phase and the envelope's current level through the slide.
      prev.eight08.forEach((x, i) => {
        x.frequency.setTargetAtTime(f * (i + 1), t, 0.0225);
        x.stop(end);
      });
      prev.amp.gain.cancelScheduledValues(t);
      prev.amp.gain.setTargetAtTime(0, t, decay);
      prev.amp.gain.setTargetAtTime(0, end - 0.09, 0.009);
      Object.assign(prev, { f, end });
      return;
    }
    this.monoNote(t, f, false);
    const knock = sliding ? 1 : 1.9;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f * knock, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const sh = c.createWaveShaper(); sh.curve = driveCurve(0.1 + p.drive * 0.85);
    const lp = this.filter('lowpass', Math.max(80, p.cutoff * 2), 0.7);
    const amp = this.gain(0), vel = (st.a ? 1 : 0.85) * (1 + p.accent * (st.a ? 0.2 : 0)) * 0.9 * (this.noteVel ?? 1);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.004);
    amp.gain.setTargetAtTime(0, t + 0.02, decay);
    // The longest decays can still be audible when the oscillators stop.
    amp.gain.setTargetAtTime(0, end - 0.09, 0.009);
    // A quiet octave harmonic lets the 808 line read on small speakers without lifting the sub.
    const h2 = c.createOscillator(); h2.type = 'triangle';
    h2.frequency.setValueAtTime(f * knock * 2, t);
    h2.frequency.exponentialRampToValueAtTime(f * 2, t + 0.03);
    const h2g = this.gain(0.2);
    o.connect(sh).connect(lp).connect(amp).connect(this.ch.acid.input);
    h2.connect(h2g).connect(lp);
    const eight08 = [o, h2];
    for (const x of eight08) { this.startSource(x, t); x.stop(end); }
    this.mono = { amp, f, end, eight08 };
  }

  // Reese: two detuned saws beating against each other plus a sine sub. SAW/SQR sets the detune spread,
  // ENV MOD sweeps the filter, RESO adds bite.
  reese(t, st, sd, holdNext, sliding) {
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
      o.frequency.value = f; o.connect(amp).connect(this.ch.acid.input); o.start();
      s = this.subVoice = { o, amp };
    }
    s.o.frequency.cancelScheduledValues(t); s.o.frequency.setTargetAtTime(f, t, sliding ? 0.03 : 0.001);
    s.amp.gain.cancelScheduledValues(t);
    s.amp.gain.setTargetAtTime(vel, t, 0.004);
    s.amp.gain.setTargetAtTime(0, t + len, 0.04);
  }

  acid(t, st, sliding, holdNext, sd) {
    const a = this.acidNodes, p = this.state.params.acid;
    const vo = Math.round(p.voice);
    if (vo > 0) { a.vca.gain.setTargetAtTime(0, t, 0.005); return this[['', 'bass', 'eight08', 'reese', 'logdrum', 'ebass'][vo]](t, st, sd, holdNext, sliding); }
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

  acidRelease(t) { this.acidNodes.vca.gain.setTargetAtTime(0, t, 0.008); this.subVoice?.amp.gain.setTargetAtTime(0, t, 0.01); if (this.mono) { this.mono.amp.gain.setTargetAtTime(0, t, 0.01); this.mono = null; } }

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
    for (const id of TRACK_IDS) {
      const p = this.ch[id].level.gain, level = this.state.params[id].level;
      if (!this.hardLevels) p.setValueAtTime(level * (prev[id] ?? 1), t);
      p.linearRampToValueAtTime(level * (target[id] ?? 1), t + dur);
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

  // One-bar noise sweep into a drop, then a sub boom and crash on its downbeat
  sweep(t, dur, amt) {
    if (this.hardTechno) return this.tonalSweep(t, dur, amt);
    const s = this.noiseSrc(t, dur + 0.05), bp = this.filter('bandpass', 500, 2), g = this.gain(0);
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(8000, t + dur);
    g.gain.setValueAtTime(EPS, t); g.gain.exponentialRampToValueAtTime(0.32 * amt, t + dur * 0.97); g.gain.linearRampToValueAtTime(0, t + dur);
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
    const g = this.secGain.gain, v = 10 ** (db / 20);
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
    const h = this.handoff;
    this.handoff = null;
    this.at = Math.max(this.ctx.currentTime, t1);
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
    processedStem(v.buf, v.fx, this.ctx);
    singingEnvelope(v.buf);
  }

  // Keep a continuous stem across bars; discarding the queue on a clock jump stops it.
  // On wake, gridTime can precede t: advance the source offset instead of moving the stem.
  vocal(t, pos, step = 0, gridTime) {
    const v = pos >= 0 ? this.vocalOf?.(this.state) : null, cur = this.vocalNow;
    const phase = v ? (pos * 16 + step) * this.stepDur - v.ms / 1000 : 0;
    const origin = (gridTime ?? t) - phase;
    if (cur && v && cur.buf === v.buf && cur.next === pos && cur.sd === this.stepDur && cur.ms === v.ms && Math.abs(origin - cur.origin) <= 0.03) {
      cur.next = pos + 1;
      this.vocalBus.gain.setTargetAtTime(v.gain, t, 0.02);
      return;
    }
    this.vocalStop(t);
    if (!v) return;
    if (phase >= v.buf.duration) return;
    this.vocalSends(v.fx);
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = processedStem(v.buf, v.fx, this.ctx);
    if (gridTime != null) t = Math.max(t, this.ctx.currentTime + 0.005);
    const off = gridTime == null ? phase : t - origin;
    if (off >= v.buf.duration) return;
    if (off > 0.001) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.012); }
    src.connect(g).connect(this.vocalBus);
    this.vocalBus.gain.setValueAtTime(v.gain, t);
    if (off < 0) this.startSource(src, t - off); else this.startSource(src, t, off);
    this.vocalNow = { src, g, buf: v.buf, next: pos + 1, sd: this.stepDur, ms: v.ms, origin };
    if (v.duck < 1) this.duckUnder(v.buf, this.bandDuck.gain, v.duck, t, t - off);
    if (v.lift < 1) this.duckUnder(v.buf, this.singTrim.gain, v.lift, t, t - off);
    // hookCarve: the exported hook stem's copy of the CHORDS channel (js/stems.js).
    for (const carve of [this.ch.stab?.carve, this.hookCarve]) {
      if (!carve || !v.fx?.carve) continue;
      carve.frequency.setValueAtTime(v.fx.carve.hz, t);
      this.duckUnder(v.buf, carve.gain, -v.fx.carve.db, t, t - off, 0);
    }
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
    const cur = this.vocalNow;
    if (!cur) return;
    this.vocalNow = null;
    const carves = [this.ch.stab?.carve?.gain, this.hookCarve?.gain].filter(Boolean);
    for (const p of [this.bandDuck.gain, this.singTrim.gain, ...carves]) {
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t);
      // A held curve's rounded endpoint can extend just past t.
      p.setTargetAtTime(carves.includes(p) ? 0 : 1, t + 1 / this.ctx.sampleRate, 0.08);
    }
    cur.g.gain.cancelScheduledValues(t);
    cur.g.gain.setTargetAtTime(0, t, 0.008);
    try { cur.src.stop(t + 0.06); } catch { /* not started */ }
  }

  panic() {
    const now = this.ctx.currentTime;
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
const STYLE_SECTION_DB = { pop: { verse: -0.9 }, country: { verse: -0.8 } };

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

  // Song form: C and G are drops, E and F breakdowns, D and H one-bar fills/switches
  advanceBar(abs, t, offset = 0) {
    if (abs % 16 !== 0) return;
    const chain = this.s.chainOn ? parseChain(this.s.chain) : [];
    const arr = this.s.master.arr || 0;
    this.dropNow = !!this.dropNext; this.dropNext = false;
    this.songBars = chain.length; this.chainArr = chain;
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
        if (arr >= 0.75 && brk(this.cur) && !brk(prev)) {
          let k = 0; while (k < n && brk(chain[(p + k) % n])) k++;
          this.e.breakSweep(t, k * 16 * this.e.stepDur, SMOOTH.has(this.s.artist?.style));
        }
      }
      if (!arr || !brk(this.cur)) this.e.breakOpen(t, SMOOTH.has(this.s.artist?.style));
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
    if (db === this.secDb && !ramp) return;
    this.secDb = db;
    this.e.sectionGain(t, db, ramp);
  }

  tick(abs, t, roomGridTime, editable = false) {
    abs -= this.origin || 0;
    const s = this.s, e = this.e;
    this.advanceBar(abs, t);
    if (this.finished && this.songBars) return this.cur;
    const n = this.songBars || 0, pos = n ? (this.chainPos - 1) % n : -1, lf = this.liftFrom;
    if (abs % 16 === 0) e.vocal(t, pos, 0, roomGridTime);
    const pat = patternAt(s.patterns[this.cur], pos);
    const bar = Math.floor(abs / 16), vary = s.master.vary || 0;
    e.harm = pat.prog?.length ? pat.prog[bar % pat.prog.length] : null;
    e.step = abs;
    e.stabPat = pat.steps.stab; e.stabLen = pat.len.stab || 16;
    e.wide = pat.sec === 'chorus';
    const sd = e.stepDur;
    const tt = t + (abs % 2 ? s.swing * sd * 0.5 : 0);
    const kl = this.keyLift = s.ending && pat.lift && lf > 0 && (pos >= lf || (pos === lf - 1 && abs % 16 >= 12)) ? pat.lift : 0;
    if (s.ending && n >= 16 && pos === n - 1 && !pat.score) return this.ending(pat, abs % 16, tt, sd, kl);
    // Turnaround: the last beat of a section anticipates the next section's first chord.
    const nx = n && pos + 1 < n && this.chainArr[pos + 1] !== this.cur ? patternAt(s.patterns[this.chainArr[pos + 1]], pos + 1) : null;
    if (nx && abs % 16 >= 12 && pat.prog?.length && nx.prog?.length) e.harm = nx.prog[(bar + 1) % nx.prog.length];
    if (kl && e.harm) e.harm = { r: e.harm.r + kl, c: e.harm.c };
    const pk = pocketOf(s.master);
    if ((s.master.dust || 0) > 0.01) e.dust(t, sd, abs);
    const arr = s.master.arr || 0, i16 = abs % 16;
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
    this.smooth = SMOOTH.has(s.artist?.style);
    // The chords make room under the bass while it plays and fill the low mids back in when it drops out.
    const held = HELD_CHORDS.has(STAB_VOICES[s.params.stab.voice]);
    const sc = !this.smooth ? 0 : !s.mutes.acid && pat.steps.acid.some((st) => st?.on) ? (held ? -6 : -12) : held ? -2 : 0.5;
    if (sc !== (e.smoothOn || 0)) {
      e.smoothChords(sc, t);
      // A lifted breakdown opens on a chord so its first bar does not fall into a gap.
      const soloed = Object.values(s.solos || {}).some(Boolean);
      if (sc > 0 && i16 === 0 && !s.mutes.stab && (!soloed || s.solos.stab)) e.trigger('stab', t, 0.45);
    }
    if (this.dropNext && this.smooth) { if (i16 === 0) e.dropDip(t, 16 * sd); } else if (this.dropNext && !hard) {
      if (i16 === 0) e.sweep(t, 16 * sd, arr);
      if (i16 >= 8 && !s.mutes.snare) {
        const rv = (0.25 + (0.6 * (i16 - 8)) / 7) * arr;
        e.trigger('snare', tt, rv);
        if (i16 >= 12) e.trigger('snare', tt + sd / 2, rv * 0.85);
      }
    }
    if (this.dropNow && i16 === 0 && !this.smooth) e.impact(t, arr);
    if (pat.score) this.scoreStep(pat.score, abs, t, sd);
    else this.e.stepScale = 1;
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
    const hitContext = editable ? { cur: this.cur, runLen: this.runLen, smooth: this.smooth, build: this.build } : null;
    for (const id of TRACK_IDS) {
      const on = !s.mutes[id] && (!anySolo || s.solos[id]);
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
        const nextH = vary && i === len - 1 && pat.prog?.length > 1 && this.walked !== bar ? pat.prog[(bar + 1) % pat.prog.length] : null;
        if (nextH && nextH.r !== e.harm?.r && hash(bar, 91) < vary) {
          const cur = e.harm; e.harm = nextH;
          e.acid(tt + (s.master.humanize || 0) * 0.016, { on: true, n: hash(bar, 92) < 0.5 ? -1 : 1, a: false, s: false, ap: true }, false, false, sd);
          e.harm = cur; this.acidPrevSlide = false;
        } else {
          const feel = s.master.humanize || 0;
          const bassLean = feel * (i % 4 ? 0.032 : 0.009);
          this.acidStep(pat, i, len, tt + bassLean + pocketLate(pk, 'acid', i16), sd);
        }
        continue;
      }
      if (this.roll === id && id !== 'stab') {
        const r = this.rollCount = (this.rollCount || 0) + 1;
        const base = 0.45 + Math.min(0.5, r * 0.02);
        e.trigger(id, tt, base);
        e.trigger(id, tt + sd / 2, base * 0.8);
        continue;
      }
      if (!hard && this.dropNext && id === 'kick' && i16 >= (this.smooth ? 15 : arr >= 0.75 ? 12 : 14)) continue;
      if (this.dropNext && id === 'snare' && arr > 0 && i16 >= 8 && !this.smooth) continue;
      if (editable && EDITABLE_HITS.has(id)) {
        const step = e.step, scale = e.stepScale, harm = e.harm;
        e.planHit(t, id, hitContext.cur, () => {
          if (this.s !== s || s.mutes[id] || (TRACK_IDS.some(k => s.solos[k]) && !s.solos[id])) return null;
          const current = patternAt(s.patterns[hitContext.cur], pos);
          if (!current) return null;
          const hit = this.gridHit.call(hitContext, id, current, grid);
          return hit && { ...hit, key: JSON.stringify([hit.method, ...hit.args]), step, scale, harm };
        });
        continue;
      }
      if (!on) { if (id === 'stab' && e.gripHeld?.length) e.quietGrip(tt); continue; }
      // Accompaniment listens to the lead. Do not stack a chord stab on top of
      // the hook's important notes; the gap makes the motif read as intentional.
      if (id === 'stab' && hookStep) continue;
      const hit = this.gridHit(id, pat, grid);
      if (hit) e[hit.method](...hit.args);
    }
    // A band adds players by section (BAND_LAYER): strings under the changes, a piano doubling the strum.
    if (band && i16 % 8 === 0 && pat.sec && !pat.score && !s.mutes.stab && (!anySolo || s.solos.stab)) e.bandLayer(tt, pat.sec, i16, s.artist?.style);
    const hm = pat.hm || 0, scale = SCALES[s.scale]?.notes || SCALES.minor.notes;
    const hk = sung ? null : pat.hook && !pat.hook.h && this.songBars ? (pat.sec === 'pre' ? this.climb(pat.hook, bar % 4, scale) : this.motif(pat.hook, motifPlan(bar, this.songBars, this.cur, pat.hook.s.filter(Boolean).length), scale)) : pat.hook;
    const leadOn = !s.mutes.stab && (!anySolo || s.solos.stab), busy = sung ? this.songBars && leadOn && sung.busy[i16] : this.songBars && hk && hm && leadOn && hookBusy(hk, abs % 32, hm);
    const sp = pat.steps.stab;
    // Licks fill the lead's rests instead of talking over it.
    if (vary && leadOn && !busy && !(this.songBars && ((hk && hm) || sung?.any) && i16 === 15) && bar % 2 === 1 && !sp[abs % (pat.len.stab || 16)] && hash(abs, 77) < vary * 0.28) {
      const k = Math.floor(hash(abs, 78) * 6) + (bar % 4 === 3 ? 2 : 0);
      e.lick(tt + (s.master.humanize || 0) * 0.02, 0.35 + hash(abs, 79) * 0.3, k);
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
        // Alternate repetitions inside the motif and between passes; no counter to reset on a seek.
        const expression = Object.hasOwn(WIND_HOOK, hk.v)
          ? { ...x, take: (Math.floor(abs / 32) + hk.s.slice(0, hi).filter((note) => note?.[0] === st[0]).length) % 2 } : x;
        e.hook(ht, Math.min(1, st[2] * phraseVel), st[0] + lift, st[1] * sd, hk.v, hk.o, strong, b, !hk.h && resolve, expression);
        // At the peak a second player doubles the answer's held notes a third below.
        if (this.cur === 6 && answer && hm > 1 && st[1] >= 3 && !hk.h && this.songBars) e.hook(ht + 0.004, Math.min(1, st[2] * phraseVel) * 0.55, stepDeg(st[0], -2, scale) + lift, st[1] * sd, hk.v, hk.o, strong, b, false, { ...expression, harm: 1 });
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
    if (id === 'vox') return { method: 'vox', args: [ht, vel, i], time: ht };
    if (band && id === 'snare' && (this.cur === 3 ? i16 >= 12 : i16 >= fillAt))
      return { method: 'tom', args: [ht, vel, i16 < 14], time: ht };
    const underHarp = id === 'stab' && n && pat.hook?.v === 'harpplk' && (sung ? sung.any : pat.hm);
    return { method: 'trigger', args: underHarp ? [id, ht, vel, true] : [id, ht, vel], time: ht };
  }

  // With arrangement dynamics on (arr > 0), styles without humanized variation (vary 0, the techno family) develop their long runs by arrangement instead:
  // the intro brings in hats then percussion, the outro takes them away again, the first drop holds its ride back for
  // a phrase, the peak's second phrase opens up off-16th hats, every 8 bars ends on a snare/clap roll over a dropped
  // kick (two beats at 16-bar ends), and every fourth bar turns around on the percussion.
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
    const notesIn = (k) => {
      const cb = ((k % B) + B) % B, out = [], q = part(k), nq = cb === B - 1 && part(k + 1);
      if (q) {
        const xs = (pp(k).hook.m[q] || []).filter((x) => x[0] >= cb * 16 && x[0] < cb * 16 + 16), sh = this.register(at(k), bar + k - P, pp(k).hook, q, cb);
        for (const x of xs) out.push({ at: x[0] - cb * 16, x, q, sh });
      }
      if (nq) {
        const xs = (pp(k + 1).hook.m[nq] || []).filter((x) => x[0] < 0), sh = this.register(at(k + 1), bar + k + 1 - P, pp(k + 1).hook, nq, 0);
        for (const x of xs) out.push({ at: 16 + x[0], x, q: nq, pickup: 1, sh });
      }
      return out;
    };
    const notes = notesIn(P), busy = Array(16).fill(false);
    for (const { at: a, x } of notesIn(P - 1)) for (let j = 0; j < a + x[1] - 16 && j < 16; j++) busy[j] = true;
    for (const { at: a, x } of notes) for (let j = a; j < Math.min(16, a + x[1]); j++) busy[j] = true;
    for (const { at: a } of notes) if (a > 0) busy[a - 1] = true;
    if (notesIn(P + 1).some((o) => o.at === 0)) busy[15] = true;
    return (this.sungAt = { bar, P, cur: this.cur, s: this.s, notes, busy, hook: pp(P).hook, part: part(P), any: notes.length > 0 || busy.some(Boolean) });
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
      e.hook(ht, v, semi + lift, dur * sd, hk.v, hk.o, strong, b, false, x);
      if (this.cur === 6 && o.q === 'n' && ph % 2 === 1 && dur >= 6 && this.songBars) e.hook(ht + 0.004, v * 0.55, stepDeg(semi, -2, scale) + lift, dur * sd, hk.v, hk.o, strong, b, false, { ...x, harm: 1 });
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
    this.e.stepScale = sc.tempo[pos];
    sd *= sc.tempo[pos];
    const hum = this.s.master.humanize ?? 0.4;
    // off: the performer's roll / melody lead, in seconds.
    for (const [at, m, d, v, part, off = 0] of sc.at[pos]) {
      const lean = (hash(at * 3 + m, 33) - 0.5) * (0.006 + hum * 0.014);
      this.e.orch(part, Math.max(t - 0.03, t + (at - Math.floor(at)) * sd + lean + off), m + k, d * sd, v);
    }
  }

  acidStep(pat, i, len, t, sd) {
    const steps = pat.steps.acid;
    const st = steps[i];
    if (!st.on) { this.acidPrevSlide = false; return; }
    const next = steps[(i + 1) % len];
    let gap = 1;
    while (gap < len && !steps[(i + gap) % len].on) gap++;
    this.e.acidGap = gap;
    const vel = this.e.noteVel;
    this.e.noteVel = (vel ?? 1) * (st.v ?? 1);
    this.e.acid(t, st, this.acidPrevSlide, st.s && next.on, sd);
    this.e.noteVel = vel;
    this.e.acidGap = 0;
    this.acidPrevSlide = !!st.s;
  }
}
