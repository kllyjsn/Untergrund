// Pure pitch decisions shared by the engine and the composition scorecard (scripts/composition.mjs).
import { CHORDS } from './params.js';

const pc = (x) => ((x % 12) + 12) % 12;

// The bar's chord root as the smallest move from the key centre (-6..+5 semitones).
export const harmRoot = (h) => (h ? pc(h.r + 6) - 6 : 0);

export const chordIv = (h, p) => CHORDS[h ? h.c : Math.round(p.chord)].iv;

// MIDI notes of a chord stab over the bar's harmony.
export function stabNotes(state, h) {
  const p = state.params.stab;
  const root = 48 + state.key + Math.round(p.octave) * 12 + harmRoot(h);
  return { root, notes: chordIv(h, p).map((n) => root + n) };
}

// A lead note on a strong beat snaps to the nearest chord tone; a resolving note (up) steps up onto one.
export function hookSnap(n, h, p, strong, up) {
  if (!strong && !up) return n;
  const root = h ? h.r : 0, tones = chordIv(h, p).map((x) => pc(root + x)), m = pc(n);
  const d = up ? [1, 2, 3, 4, 5].find((x) => tones.includes(pc(m + x))) : [0, -1, 1, -2, 2].find((x) => tones.includes(pc(m + x)));
  return n + (d ?? 0);
}
