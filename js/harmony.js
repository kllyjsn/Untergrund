// Pure pitch decisions shared by the engine and the composition scorecard (scripts/composition.mjs).
import { CHORDS } from './params.js';

const pc = (x) => ((x % 12) + 12) % 12;

// The bar's chord root as the smallest move from the key centre (-6..+5 semitones).
export const harmRoot = (h) => (h ? pc(h.r + 6) - 6 : 0);

export const chordIv = (h, p) => CHORDS[h ? h.c : Math.round(p.chord)].iv;

// MIDI notes of a chord stab over the bar's harmony.
export function stabNotes(state, h) {
  const p = state.params.stab;
  const home = 48 + state.key + Math.round(p.octave) * 12, root = home + harmRoot(h);
  return { root, home, notes: chordIv(h, p).map((n) => root + n) };
}

// A lead note on a strong beat snaps to the nearest chord tone; a resolving note (up) steps up onto one.
export function hookSnap(n, h, p, strong, up) {
  if (!strong && !up) return n;
  const root = h ? h.r : 0, tones = chordIv(h, p).map((x) => pc(root + x)), m = pc(n);
  const d = up ? [1, 2, 3, 4, 5].find((x) => tones.includes(pc(m + x))) : [0, -1, 1, -2, 2].find((x) => tones.includes(pc(m + x)));
  return n + (d ?? 0);
}

// A keyboard player's voicing: the same chord tones, each moved to the octave that travels least from
// the previous chord (common tones hold), kept within a fifth of the home register so the hands don't drift.
export function voiceLead(notes, prev, home) {
  if (notes.length < 2) return notes;
  const lo = home - 5, hi = home + 26, base = notes[0];
  const opts = notes.map((m) => { const o = []; for (let x = m - 24; x <= m + 24; x += 12) if (x >= lo && x <= hi) o.push(x); return o.length ? o : [m]; });
  const center = notes.reduce((a, m) => a + m, 0) / notes.length - base + home;
  let best = notes, cost = Infinity;
  const rec = (k, acc) => {
    if (k === notes.length) {
      const v = [...acc].sort((x, y) => x - y);
      for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] < 2 || (v[i] < home + 7 && v[i] - v[i - 1] < 3)) return;
      if (v[v.length - 1] - v[0] > 17) return;
      const mv = !prev?.length ? 0 : v.reduce((c, m) => c + Math.min(...prev.map((q) => Math.abs(q - m))), 0) + prev.reduce((c, q) => c + Math.min(...v.map((m) => Math.abs(q - m))), 0);
      const c = mv + (prev?.length ? 0.5 * Math.abs(v[v.length - 1] - prev[prev.length - 1]) : 0) + Math.abs(v.reduce((a, m) => a + m, 0) / v.length - center);
      if (c < cost) { cost = c; best = v; }
      return;
    }
    for (const m of opts[k]) rec(k + 1, [...acc, m]);
  };
  rec(0, []);
  return best;
}
