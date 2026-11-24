import { SCALES } from './params.js';

export const VOWEL_BAND = { vox_ahh: [53], vox_eh: [53], vox_ooh: [53] };
export const VOWEL_TUNE = { vox_ahh: { 53: -0.010 }, vox_eh: { 53: -0.003 }, vox_ooh: { 53: 0.005 } };
export const VOWEL_STYLES = ['ukg', 'jerseyclub', 'bailefunk', 'deephouse', 'euphoric', 'dnb'];
export const VOWEL_HOOK_DB = { ukg: 8.5, jerseyclub: 13.4, bailefunk: 0.5, deephouse: 11.2, euphoric: 9.5, dnb: 9.8 };
export const VOWEL_HOOK_EQ = { deephouse: [[350, 0.65, -8], [3000, 0.8, 2]] };
const SHORT = new Set(['ukg', 'jerseyclub', 'bailefunk']);
const COLORS = { ukg: ['eh', 'ahh'], jerseyclub: ['ahh', 'eh'], bailefunk: ['eh', 'ahh'], deephouse: ['ooh', 'eh'], euphoric: ['ahh', 'ooh'], dnb: ['ooh', 'ahh'] };
const hash = (n, k) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const LOOPS = new WeakMap();
const SUSTAINS = new WeakMap();

export function vowelSustain(buffer, ctx) {
  if (SUSTAINS.has(buffer)) return SUSTAINS.get(buffer);
  const [from, to] = vowelLoop(buffer).map((t) => Math.round(t * buffer.sampleRate));
  const period = buffer.sampleRate / (440 * 2 ** ((53 - 69) / 12));
  const n = Math.round(Math.max(1, Math.floor((to - from - 0.06 * buffer.sampleRate) / period)) * period);
  const fade = to - from - n, x = buffer.getChannelData(0);
  const loop = ctx.createBuffer(1, n, buffer.sampleRate), y = loop.getChannelData(0);
  y.set(x.subarray(from + fade, to));
  for (let i = 0; i < fade; i++) {
    const w = (1 - Math.cos(Math.PI * i / (fade - 1))) / 2;
    y[n - fade + i] = y[n - fade + i] * (1 - w) + x[from + i] * w;
  }
  const radius = Math.round(period / 2), power = new Float64Array(n);
  const target = Math.sqrt(y.reduce((sum, v) => sum + v * v, 0) / n);
  for (let pass = 0; pass < 2; pass++) {
    let sum = 0;
    for (let j = -radius; j <= radius; j++) sum += y[(j + n) % n] ** 2;
    for (let i = 0; i < n; i++) {
      power[i] = Math.sqrt(sum / (2 * radius + 1));
      sum += y[(i + radius + 1) % n] ** 2 - y[(i - radius + n) % n] ** 2;
    }
    for (let i = 0; i < n; i++) y[i] *= target / Math.max(1e-6, power[i]);
  }
  SUSTAINS.set(buffer, loop);
  return loop;
}

export function vowelLoop(buffer) {
  if (LOOPS.has(buffer)) return LOOPS.get(buffer);
  const x = buffer.getChannelData(0), crossing = (fraction) => {
    let i = Math.floor(x.length * fraction);
    while (i < x.length - 2 && !(x[i] <= 0 && x[i + 1] > 0)) i++;
    return (i < x.length - 2 ? i : Math.floor(x.length * fraction)) / buffer.sampleRate;
  };
  const loop = [crossing(0.3), crossing(0.8)];
  LOOPS.set(buffer, loop);
  return loop;
}

export const vowelStyle = (style) => VOWEL_STYLES.includes(style);
export const vowelSets = (style) => vowelStyle(style) ? Object.keys(VOWEL_BAND) : [];
export const vowelPitch = (midi, center = 53) => midi + 12 * Math.round((Math.round(center) - midi) / 12);
export const vowelDuration = (style, duration) => SHORT.has(style) ? Math.max(0.04, Math.min(0.14, duration)) : Math.max(0.4, Math.min(2.4, duration));
export const vowelHookDuration = (style, duration) => SHORT.has(style) ? vowelDuration(style, duration) : Math.max(0.04, duration);
export const vowelName = (style, section = 0, slice = 0) => `vox_${COLORS[style]?.[((section + Math.round(slice)) % 2 + 2) % 2] || 'ahh'}`;

export function vowelVoxNote(state, style, step, stepDur, harmony = 0) {
  const p = state.params.vox, notes = SCALES[state.scale]?.notes || SCALES.minor.notes;
  const degree = hash(step, 3) < p.melody ? notes[Math.floor(hash(step, 4) * notes.length)] : 0;
  const jump = hash(step, 1) < p.scatter ? Math.floor(hash(step, 2) * (COLORS[style]?.length || 1)) : 0;
  return { midi: vowelPitch(60 + (state.key || 0) + harmony + Math.round(p.pitch) + degree),
    duration: vowelDuration(style, p.length * stepDur),
    name: vowelName(style, Math.floor(step / 64), p.slice + jump) };
}

export function playVowel(engine, t, velocity, midi, duration, name, out, tone = 5000, sustain = false, peaks = []) {
  const set = engine.rec(name);
  if (!set?.length) return false;
  let [center, buffer] = set[0];
  for (const entry of set) if (Math.abs(entry[0] - midi) < Math.abs(center - midi)) [center, buffer] = entry;
  const rate = 2 ** ((vowelPitch(midi, center) - center) / 12);
  if (sustain) buffer = vowelSustain(buffer, engine.ctx);
  const release = Math.min(0.04, duration * 0.25);
  const length = sustain ? duration : Math.max(0.025, Math.min(duration, (buffer.duration - 0.01) / rate - release * 5));
  const played = engine.playBuf(buffer, t, velocity * 0.55, out, rate, length, { lp: tone, fade: sustain ? 0.025 : 0.004, release: Math.min(release, length * 0.25), loop: sustain, peaks });
  if (sustain && played?.s) {
    played.s.loop = true;
    played.s.loopStart = 0;
    played.s.loopEnd = buffer.duration;
  }
  return true;
}
