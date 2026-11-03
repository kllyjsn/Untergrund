// Hook lead voices and synth-vs-recorded level matching.
// A preset shapes one synth lead: a unison stack through a filter whose envelope opens with velocity,
// glide on close legato notes, and vibrato that only develops on held notes. The genre's groove pocket
// picks the flavour, so presets need no extra saved state.

export const dbGain = (db) => Math.pow(10, db / 20);

// Synth chord voices (SAW KEYS PAD ORGAN BRASS PLUCK BELLS) measured against the recorded players
// (PIANO GUITAR HORNS STRINGS) at their sounding level; these trims put them within ~2 dB.
export const STAB_TRIM_DB = [12, 14, 5, 8, 10, 11, 11];
// Where each voice's make-up starts: above the 200–500 Hz mud band, except KEYS, whose body
// (and so its level next to a real piano) sits lower.
export const STAB_SHELF_HZ = [800, 470, 800, 800, 800, 800, 800];
// Same for the synth hook voices against recorded players taking the hook.
// Hook make-up lands above ~800 Hz, where a lead speaks; its fundamental (C4 register, inside the
// 200–500 Hz mud band) only gets HOOK_LOW_DB of it.
export const HOOK_LOW_DB = 2;
export const HOOK_TRIM_DB = {
  analog: 16,
  pulse: 15,
  warm: 13,
  vocal: 17,
  reed: 11,
  mallet: 16
};

const STACK = { atk: 0.008, sus: 0.5, hold: 0.2, rel: 0.1, q: 1, body: null, sub: 0, glide: 0, vib: [5.2, 10], tame: 3, air: 1.4, bite: 5, thin: 5 };
const PRESETS = {
  // Techno stab-lead: two squares, plucky filter snap, no glide.
  pulse: { ...STACK, stack: true, wave: 'square', uni: 2, spread: 7, mix: 0.42, body: ['triangle', 0.55, 1], cut: 520, env: 2600, q: 2.4, dec: 0.09, atk: 0.006, sus: 0.18, hold: 0.08, rel: 0.08, vib: [5.4, 6], level: 0.3 },
  // Trance/anthem lead: three-saw unison over a triangle body, opens with velocity, sings on long notes.
  analog: { ...STACK, stack: true, wave: 'sawtooth', uni: 3, spread: 13, mix: 0.5, body: ['triangle', 0.5, 1], sub: 0.18, cut: 900, env: 3400, q: 0.9, dec: 0.22, atk: 0.012, sus: 0.6, hold: 0.25, rel: 0.14, glide: 0.035, vib: [5.2, 14], tame: 6, bite: 3, level: 0.3 },
  warm: { ...STACK, stack: true, wave: 'triangle', uni: 2, spread: 5, mix: 0.6, body: ['sine', 0.2, 2], cut: 700, env: 2400, q: 1.4, dec: 0.11, atk: 0.006, sus: 0.05, hold: 0.25, rel: 0.1, vib: [5, 8], level: 0.34 },
  // A sung line carries on its first formant: lift the 1.4 kHz bite more.
  vocal: { ...STACK, glide: 0.04, vib: [5, 14], cut: 1300, env: 1600, dec: 0.18, thin: 5, bite: 7 },
  reed: { ...STACK, glide: 0.05, vib: [0, 0], cut: 1300, env: 1800, dec: 0.2 },
  mallet: { ...STACK, vib: [0, 0] },
};
const POCKET_PRESETS = {
  // Hyperpop: wide bright saws, quick glides, fast deep vibrato.
  'pulse:TRAP': { wave: 'sawtooth', uni: 3, spread: 16, mix: 0.5, body: ['square', 0.25, 1], sub: 0.15, cut: 1400, env: 3400, q: 1.2, dec: 0.16, sus: 0.55, hold: 0.2, rel: 0.09, glide: 0.05, vib: [5.8, 18], tame: 11, bite: 0, level: 0.28 },
  // Liquid drum & bass: darker two-saw lead, slow filter, long glides and a lazy vibrato.
  'analog:BREAKS': { uni: 2, spread: 7, mix: 0.32, body: ['triangle', 0.75, 1], sub: 0.2, cut: 850, env: 1900, q: 1.3, dec: 0.4, atk: 0.02, sus: 0.7, hold: 0.4, rel: 0.2, glide: 0.07, vib: [4.8, 16], tame: 5, level: 0.24 },
};

export function leadPreset(voice, pocketName) {
  const base = PRESETS[voice] || PRESETS.warm;
  const over = POCKET_PRESETS[`${voice}:${pocketName}`];
  return over ? { ...base, ...over } : base;
}
