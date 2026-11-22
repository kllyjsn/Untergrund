import { SCALES } from './params.js';

export const VOWEL_BAND = { vox_ahh: [53], vox_eh: [53], vox_ooh: [53] };
export const VOWEL_TUNE = { vox_ahh: { 53: -0.010 }, vox_eh: { 53: -0.003 }, vox_ooh: { 53: 0.005 } };
export const VOWEL_STYLES = ['ukg', 'jerseyclub', 'bailefunk', 'deephouse', 'euphoric', 'dnb'];
export const VOWEL_HOOK_DB = { ukg: 8, jerseyclub: 12, bailefunk: 0, deephouse: 0, euphoric: 6, dnb: 6 };
const SHORT = new Set(['ukg', 'jerseyclub', 'bailefunk']);
const COLORS = { ukg: ['eh', 'ahh'], jerseyclub: ['ahh', 'eh'], bailefunk: ['eh', 'ahh'], deephouse: ['ooh', 'eh'], euphoric: ['ahh', 'ooh'], dnb: ['ooh', 'ahh'] };
const hash = (n, k) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const LOOPS = new WeakMap();

export function vowelLoop(buffer) {
  if (LOOPS.has(buffer)) return LOOPS.get(buffer);
  const x = buffer.getChannelData(0), crossing = (fraction) => {
    let i = Math.floor(x.length * fraction);
    while (i < x.length - 2 && !(x[i] <= 0 && x[i + 1] > 0)) i++;
    return i / buffer.sampleRate;
  };
  const loop = [crossing(0.3), crossing(0.8)];
  LOOPS.set(buffer, loop);
  return loop;
}

export const vowelStyle = (style) => VOWEL_STYLES.includes(style);
export const vowelSets = (style) => vowelStyle(style) ? Object.keys(VOWEL_BAND) : [];
export const vowelPitch = (midi, center = 53) => midi + 12 * Math.round((Math.round(center) - midi) / 12);
export const vowelDuration = (style, duration) => SHORT.has(style) ? Math.max(0.04, Math.min(0.14, duration)) : Math.max(0.4, Math.min(2.4, duration));
export const vowelName = (style, section = 0, slice = 0) => `vox_${COLORS[style]?.[((section + Math.round(slice)) % 2 + 2) % 2] || 'ahh'}`;

export function vowelVoxNote(state, style, step, stepDur, harmony = 0) {
  const p = state.params.vox, notes = SCALES[state.scale]?.notes || SCALES.minor.notes;
  const degree = hash(step, 3) < p.melody ? notes[Math.floor(hash(step, 4) * notes.length)] : 0;
  const jump = hash(step, 1) < p.scatter ? Math.floor(hash(step, 2) * (COLORS[style]?.length || 1)) : 0;
  return { midi: vowelPitch(60 + (state.key || 0) + harmony + Math.round(p.pitch) + degree),
    duration: vowelDuration(style, p.length * stepDur),
    name: vowelName(style, Math.floor(step / 64), p.slice + jump) };
}

export function playVowel(engine, t, velocity, midi, duration, name, out, tone = 5000, sustain = false) {
  const set = engine.rec(name);
  if (!set?.length) return false;
  let [center, buffer] = set[0];
  for (const entry of set) if (Math.abs(entry[0] - midi) < Math.abs(center - midi)) [center, buffer] = entry;
  const rate = 2 ** ((vowelPitch(midi, center) - center) / 12);
  const release = Math.min(0.04, duration * 0.25);
  const length = sustain ? duration : Math.max(0.025, Math.min(duration, (buffer.duration - 0.01) / rate - release * 5));
  const played = engine.playBuf(buffer, t, velocity * 0.55, out, rate, length, { lp: tone, fade: sustain ? 0.025 : 0.004, release: Math.min(release, length * 0.25), loop: sustain });
  if (sustain && played?.s) {
    played.s.loop = true;
    [played.s.loopStart, played.s.loopEnd] = vowelLoop(buffer);
  }
  return true;
}
