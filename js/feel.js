// What a song is meant to make the listener feel, and the cues that carry it.
// One table drives every layer that expresses emotion (harmony, tempo, melody, dynamics, voice, words),
// so a song's cues agree instead of each layer guessing on its own. Cue directions follow
// Juslin & Laukka 2003 (research/program.md): sad = slow, soft, low, legato, small range;
// joy = fast, bright, high, detached; tension = dissonance, loud, rising, unresolved.
//
// valence/arousal/tension are -1..1 / -1..1 / 0..1. `chords` names a song-spec MOOD_CHORDS entry,
// `theme` a lyric-writer theme. `tempo` is where in the style's own BPM range the song sits (0..1).
// mel: register shift (semitones), velocity range, legato and leap appetite (0..1).
// dyn.contrast scales section level differences; end.rit is how much the ending slows (0..1).
// expr multiplies the genre's singer expression; peak lists the climax devices that suit the feeling.
export const FEELS = {
  heartbroken: {
    label: 'Heartbroken', words: /\b(?:sad|heartbr\w*|heartache|lonely|rainy|blue|tragic|cry\w*|tears|broken)\b/,
    valence: -0.8, arousal: -0.5, tension: 0.3, mode: 'minor', chords: 'sad', theme: 'heartbreak', tempo: 0.2,
    mel: { reg: -2, vel: [0.58, 0.96], legato: 0.85, leap: 0.3 }, dyn: { contrast: 1.4 }, end: { rit: 0.7 },
    expr: { vib: 1.2, breath: 1.3, scoop: 1.2 }, peak: ['suspension', 'dropout', 'entry'],
  },
  longing: {
    label: 'Longing', words: /\b(?:melanchol\w*|bittersweet|wistful|longing|yearn\w*|miss(?:ing)?\s+you|ache)\b/,
    valence: -0.4, arousal: -0.2, tension: 0.45, mode: 'minor', chords: 'sad', theme: 'leaving', tempo: 0.35,
    mel: { reg: 0, vel: [0.6, 0.97], legato: 0.75, leap: 0.55 }, dyn: { contrast: 1.3 }, end: { rit: 0.5 },
    expr: { vib: 1.1, breath: 1.2, scoop: 1.1 }, peak: ['suspension', 'entry', 'lift'],
  },
  euphoric: {
    label: 'Euphoric', words: /\b(?:euphori\w*|uplifting|anthem\w*|soaring|triumphant|festival|hands\s+up|ecsta\w*)\b/,
    valence: 0.85, arousal: 0.85, tension: 0.4, mode: 'major', chords: 'lift', theme: 'summer', tempo: 0.7,
    mel: { reg: 2, vel: [0.7, 1], legato: 0.5, leap: 0.7 }, dyn: { contrast: 1.5 }, end: { rit: 0.1 },
    expr: { vib: 1, breath: 0.9, scoop: 0.9 }, peak: ['lift', 'dropout', 'entry'],
  },
  dark: {
    label: 'Dark', words: /\b(?:dark|sinister|menacing|evil|haunted|ominous|warehouse|industrial|gritty|spooky|eerie)\b/,
    valence: -0.6, arousal: 0.4, tension: 0.8, mode: 'phrygian', chords: 'dark', theme: 'night', tempo: 0.55,
    mel: { reg: -3, vel: [0.66, 0.98], legato: 0.4, leap: 0.25 }, dyn: { contrast: 1.2 }, end: { rit: 0.2 },
    expr: { vib: 0.7, breath: 1, scoop: 0.8 }, peak: ['dropout', 'entry'],
  },
  dreamy: {
    label: 'Dreamy', words: /\b(?:dream\w*|floating|hazy|ethereal|nostalgi\w*|sunset|sunrise|dawn|ocean|beach)\b/,
    valence: 0.3, arousal: -0.5, tension: 0.2, mode: 'minor', chords: 'dream', theme: 'love', tempo: 0.3,
    mel: { reg: 1, vel: [0.6, 0.92], legato: 0.9, leap: 0.45 }, dyn: { contrast: 1 }, end: { rit: 0.6 },
    expr: { vib: 0.9, breath: 1.2, scoop: 1 }, peak: ['entry', 'suspension'],
  },
  joyful: {
    label: 'Joyful', words: /\b(?:happy|joy\w*|sunny|summer|party|bright|fun|playful|celebrat\w*|cheerful|hopeful|optimistic)\b/,
    valence: 0.8, arousal: 0.5, tension: 0.15, mode: 'major', chords: 'happy', theme: 'summer', tempo: 0.65,
    mel: { reg: 1, vel: [0.68, 0.98], legato: 0.35, leap: 0.6 }, dyn: { contrast: 1.15 }, end: { rit: 0.15 },
    expr: { vib: 0.9, breath: 0.9, scoop: 0.9 }, peak: ['lift', 'entry'],
  },
  tense: {
    label: 'Tense', words: /\b(?:tense|tension|anxious|urgent|chase|driving|relentless|nervous|restless)\b/,
    valence: -0.3, arousal: 0.8, tension: 0.9, mode: 'minor', chords: 'tense', theme: 'night', tempo: 0.8,
    mel: { reg: 0, vel: [0.7, 1], legato: 0.25, leap: 0.3 }, dyn: { contrast: 1.3 }, end: { rit: 0 },
    expr: { vib: 0.6, breath: 0.8, scoop: 0.7 }, peak: ['dropout', 'entry'],
  },
  tender: {
    label: 'Tender', words: /\b(?:tender|gentle|warm|intimate|romantic|soft|lullaby|in\s+love)\b/,
    valence: 0.5, arousal: -0.6, tension: 0.15, mode: 'major', chords: 'dream', theme: 'love', tempo: 0.25,
    mel: { reg: -1, vel: [0.55, 0.9], legato: 0.9, leap: 0.4 }, dyn: { contrast: 1.1 }, end: { rit: 0.8 },
    expr: { vib: 1, breath: 1.3, scoop: 1.1 }, peak: ['suspension', 'entry'],
  },
};
export const FEEL_IDS = Object.keys(FEELS);
export const isFeel = (id) => Object.hasOwn(FEELS, id);

// The first feeling named in `text` (table order breaks ties), or null.
export function feelOf(text = '') {
  const t = String(text || '').toLowerCase();
  for (const id of FEEL_IDS) if (FEELS[id].words.test(t)) return id;
  return null;
}

// Feelings each genre family can carry, most idiomatic first (weights). A seed draws from these,
// so a genre stops having one emotional colour without leaving its world.
const BY_FAMILY = {
  TECHNO: { dark: 4, tense: 3, dreamy: 1, euphoric: 1 },
  HOUSE: { euphoric: 3, longing: 3, joyful: 2, dreamy: 2, tender: 1 },
  'JAZZ & HIP-HOP': { longing: 3, tender: 2, dreamy: 2, heartbroken: 1, dark: 1 },
  'BREAKS & BASS': { tense: 3, euphoric: 2, dark: 2, longing: 1 },
  'TRANCE & AMBIENT': { euphoric: 3, dreamy: 3, longing: 2, tender: 1 },
  'AFRO & LATIN': { joyful: 4, tender: 2, longing: 1, euphoric: 1 },
  'TRAP & POP': { dark: 3, tense: 2, heartbroken: 2, euphoric: 1 },
  'POP & R&B': { heartbroken: 3, joyful: 3, longing: 2, tender: 2, euphoric: 1 },
  'ROCK & ROOTS': { longing: 3, joyful: 2, heartbroken: 2, tender: 2, tense: 1 },
  CLASSICAL: { longing: 2, tender: 2, heartbroken: 1, dreamy: 1, euphoric: 1 },
};
const BY_STYLE = {
  ambient: { dreamy: 4, tender: 2, longing: 1 },
  hyperpop: { euphoric: 3, heartbroken: 2, joyful: 2 },
  euphoric: { euphoric: 4, longing: 2 },
  industrial: { dark: 4, tense: 2 },
  hardtechno: { tense: 3, dark: 3 },
};
export function feelsFor(style, family) {
  return BY_STYLE[style] || BY_FAMILY[family] || { longing: 1, joyful: 1, dark: 1 };
}

// Deterministic per seed, on its own stream so it never shifts any other seeded choice.
export function pickFeel(style, family, seed = 0) {
  const w = Object.entries(feelsFor(style, family));
  let h = Math.imul((seed | 0) ^ 0x3b9aca07, 0x2c9277b5) ^ 0x6a09e667;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  let x = ((h >>> 0) / 4294967296) * w.reduce((a, [, n]) => a + n, 0);
  for (const [id, n] of w) if ((x -= n) < 0) return id;
  return w[0][0];
}
