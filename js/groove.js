// Pockets: how a player from each scene sits on the grid. A pocket is a velocity contour
// (which 16ths a drummer leans on and which they barely touch) plus small, consistent
// timing offsets per instrument in milliseconds. Consistent offsets read as feel; the
// random HUMANIZE jitter on top only keeps repeats from being identical.
const bar = (beat, lift = [1, 0.97, 1, 1.03]) => Array.from({ length: 16 }, (_, i) => +(beat[i % 4] * lift[i >> 2]).toFixed(3));

export const POCKETS = [
  null, // GRID: the raw step grid, as older projects were written
  { // MACHINE: techno drum machines, tight but not flat
    name: 'MACHINE', hum: 0.14, jitter: 1.2,
    hat: bar([0.92, 0.72, 1, 0.78]), kick: [1, 0.95, 0.98, 0.95], back: [1, 0.97], bass: [1, 0.86, 0.94, 0.88],
    at: { clap: 1.5, snare: 1.5, ch: [0, 1, 0, 2], ride: [0, 1, 0, 2] },
  },
  { // HOUSE: the offbeat open hat sings, the "e" is a whisper, the "a" lazes behind; clap sits back
    name: 'HOUSE', hum: 0.42, jitter: 2.6, ghost: 0.3,
    hat: bar([0.5, 0.34, 1, 0.6]), kick: [1, 0.94, 0.97, 0.95], back: [1, 0.95], bass: [1, 0.76, 0.93, 0.84],
    at: { clap: 7, snare: 5, ch: [0, 4, -2, 8], oh: [0, 0, -2, 0], ride: [0, 5, 0, 7], perc: [0, 6, 2, 9], acid: [-1, 5, 3, 6], stab: 5 },
  },
  { // GARAGE: shuffled 2-step, the "a" 16th kicks forward into the next beat
    name: 'GARAGE', hum: 0.45, jitter: 3, ghost: 0.18,
    hat: bar([0.48, 0.42, 0.74, 1]), kick: [1, 0.9, 0.96, 0.9], back: [1, 0.94], bass: [1, 0.8, 0.9, 0.88],
    at: { clap: 9, snare: 8, ch: [0, 5, 0, 9], perc: [0, 6, 0, 10], acid: [0, 6, 3, 8], stab: 6 },
  },
  { // SOUL: Dilla/Glasper; the kit already drags its snare, so this mostly shapes dynamics
    name: 'SOUL', hum: 0.8, jitter: 3.5,
    hat: bar([1, 0.42, 0.78, 0.5], [1, 0.95, 0.98, 1.02]), kick: [1, 0.9, 0.95, 0.9], back: [1, 0.96], bass: [1, 0.82, 0.9, 0.86],
    at: { ch: [0, 3, 2, 5], ride: [0, 3, 2, 5] },
  },
  { // BREAKS: a chopped break; snare a hair late, hats swung by hand
    name: 'BREAKS', hum: 0.3, jitter: 2.4, ghost: 0.12,
    hat: bar([0.95, 0.5, 0.8, 0.6]), kick: [1, 0.92, 0.96, 0.92], back: [1, 0.95], bass: [1, 0.84, 0.92, 0.86],
    at: { snare: 4, clap: 3, ch: [0, 3, 0, 5], ride: [0, 3, 0, 5] },
  },
  { // AFRO: 3-3-2 accents; shakers push ahead of the beat, the clap breathes
    name: 'AFRO', hum: 0.38, jitter: 2.8,
    hat: [0.95, 0.45, 0.6, 0.9, 0.5, 0.55, 0.92, 0.45, 0.85, 0.45, 0.6, 0.92, 0.5, 0.55, 0.95, 0.5],
    kick: [1, 0.93, 0.97, 0.93], back: [1, 0.95], bass: [1, 0.82, 0.9, 0.9],
    at: { perc: [-3, 0, -2, 2], ch: [0, 3, -2, 5], clap: 4, snare: 3, acid: [0, 3, 2, 4], stab: 3 },
  },
  { // TRAP: programmed hats on purpose, but rolled with a finger, not stamped
    name: 'TRAP', hum: 0.2, jitter: 1.5,
    hat: bar([1, 0.55, 0.8, 0.62]), kick: [1, 0.96, 0.98, 0.96], back: [1, 0.97], bass: [1, 0.9, 0.95, 0.9],
    at: { snare: 3, clap: 3 },
  },
  // The band pockets: a drummer and a bass player in a room. `band` adds crashes into sections and tom fills.
  { // POP: tight and bright, eighth hats leaning on the downbeats, the backbeat a hair late
    name: 'POP', hum: 0.32, jitter: 2.2, ghost: 0.12, band: true,
    hat: bar([1, 0.5, 0.82, 0.55]), kick: [1, 0.92, 0.96, 0.92], back: [1, 0.97], bass: [1, 0.82, 0.92, 0.86],
    at: { snare: 4, clap: 4, ch: [0, 2, 0, 4], stab: 2, acid: [0, 2, 1, 3] },
  },
  { // R&B: laid back; snare and hats drag behind the bass, sixteenths whisper
    name: 'R&B', hum: 0.6, jitter: 3.2, ghost: 0.28, band: true,
    hat: bar([1, 0.4, 0.75, 0.5]), kick: [1, 0.9, 0.95, 0.9], back: [1, 0.95], bass: [1, 0.8, 0.9, 0.85],
    at: { snare: 9, clap: 9, ch: [0, 5, 3, 8], ride: [0, 5, 3, 8], stab: 6, acid: [0, 4, 3, 6] },
  },
  { // ROCK: driving eighths, everything on top of the beat except a fat, slightly late snare
    name: 'ROCK', hum: 0.26, jitter: 2.8, ghost: 0.08, band: true,
    hat: bar([1, 0.6, 0.9, 0.62]), kick: [1, 0.95, 0.98, 0.95], back: [1, 0.98], bass: [1, 0.9, 0.95, 0.9],
    at: { snare: 3, ch: [0, 1, 0, 2], ride: [0, 1, 0, 2], acid: [0, 1, 0, 2] },
  },
  { // FOLK: a player, not a drummer; loose and breathing, the strum pushes, the brush lags
    name: 'FOLK', hum: 0.7, jitter: 4, ghost: 0.15, band: true,
    hat: bar([0.9, 0.4, 0.7, 0.5], [1, 0.95, 0.98, 0.95]), kick: [1, 0.88, 0.94, 0.88], back: [1, 0.94], bass: [1, 0.78, 0.9, 0.82],
    at: { snare: 6, ch: [0, 4, 2, 6], stab: [-2, 3, 0, 4] },
  },
  { // COUNTRY: train beat; boom-chick with the bass right on the beat and the snare on 2 and 4 snapping
    name: 'COUNTRY', hum: 0.4, jitter: 2.6, ghost: 0.2, band: true, walk: true,
    hat: bar([1, 0.45, 0.85, 0.5]), kick: [1, 0.9, 0.96, 0.9], back: [1, 0.97], bass: [1, 0.85, 0.95, 0.85],
    at: { snare: 2, ch: [0, 3, 1, 4], stab: [0, 3, 1, 4] },
  },
];
export const POCKET_NAMES = ['GRID', ...POCKETS.slice(1).map((p) => p.name)];
const P = Object.fromEntries(POCKET_NAMES.map((n, i) => [n, i]));

export const STYLE_POCKET = {
  hypnotic: P.MACHINE, industrial: P.MACHINE, acid: P.MACHINE, dub: P.MACHINE, peak: P.MACHINE, hardtechno: P.MACHINE, electro: P.MACHINE, trance: P.MACHINE, ambient: P.MACHINE,
  deephouse: P.HOUSE, minimal: P.HOUSE, euphoric: P.HOUSE,
  ukg: P.GARAGE, jerseyclub: P.GARAGE,
  neosoul: P.SOUL, boombap: P.SOUL,
  breaks: P.BREAKS, dnb: P.BREAKS,
  amapiano: P.AFRO, afrobeats: P.AFRO, reggaeton: P.AFRO, bailefunk: P.AFRO,
  trap: P.TRAP, drill: P.TRAP, hyperpop: P.TRAP,
  pop: P.POP, rnb: P['R&B'], rock: P.ROCK, folk: P.FOLK, country: P.COUNTRY,
};

export const pocketOf = (master) => POCKETS[Math.round(master?.pocket || 0)] || null;

// Timing offset in seconds for one hit of `id` on 16th `i16`.
export function pocketLate(pk, id, i16) {
  const a = pk?.at?.[id];
  if (a == null) return 0;
  return (Array.isArray(a) ? a[i16 % 4] : a) / 1000;
}

// Velocity shape for one hit. Cymbals and shakers follow the contour; kicks and backbeats barely move.
export function pocketVel(pk, id, i16) {
  if (!pk) return 1;
  if (id === 'ch' || id === 'oh' || id === 'ride' || id === 'perc') return pk.hat[i16 % 16];
  if (id === 'kick') return pk.kick[i16 >> 2];
  if (id === 'snare' || id === 'clap') return i16 === 4 || i16 === 12 ? pk.back[i16 === 4 ? 0 : 1] : 0.9;
  if (id === 'acid') return pk.bass[i16 % 4];
  return 1;
}
