export const HIPHOP = {
  lofihiphop: {
    name: 'LO-FI HIP-HOP', bpm: [74, 82], tag: 'tape keys · soft break', color: '#d5a98c',
    ensembles: [[1, 1, 0, 1.55, 0.12], [1, 1, 1, 1.35, 0.12], [7, 1, 0, 1.3, 0.16], [7, 1, 1, 1.4, 0.14]],
    chords: [[[0, 2], [3, 9], [5, 2], [8, 9]], [[0, 2], [8, 9], [10, 10], [5, 2]], [[0, 2], [5, 2], [3, 9], [10, 10]]],
    kicks: [[0, 7, 10], [0, 6, 11], [0, 3, 10, 15]], snare: [4, 12], hats: [0, 2, 6, 8, 11, 14], stabs: [[0, 11], [1, 8], [0, 6]],
    bass: [[0, 0], [7, 0], [10, 4]], hook: 'tapekeys', octave: 0,
    riffs: [[[2, 2, 3], [7, 4, 2]], [[3, 4, 2], [8, 2, 3]], [[4, 4, 3], [10, 1, 2]]],
    mix: {
      kick: { tune: 50, decay: 0.24, drive: 0.12, click: 0.04, punch: 0.36, rumble: 0, level: 0.8 },
      snare: { tune: 184, decay: 0.12, snappy: 0.28, level: 0.7, rev: 0.12 },
      ch: { tone: 2200, decay: 0.044, level: 0.4, rev: 0.04 },
      acid: { tune: -12, cutoff: 225, reso: 0.5, envmod: 0.08, decay: 0.68, drive: 0.16, accent: 0.1, level: 0.74, rev: 0, dly: 0 },
      stab: { chord: 2, cutoff: 980, reso: 0.45, detune: 8, tine: 0.18, level: 0.66, rev: 0.22, dly: 0.04 },
    },
    master: { kit: 1, room: 0.22, warmth: 0.69, drive: 0.11, dust: 0.34, duck: 0.31, vary: 0.34, revLevel: 0.25, arr: 0, humanize: 0.52 },
    swing: 0.53,
  },
  gfunk: {
    name: 'G-FUNK', bpm: [92, 96], tag: 'gliding whistle · synth bass', color: '#ffa567',
    ensembles: [[10, 1, 0, 0.7, 0.2], [1, 1, 0, 0.3, 0.2], [10, 7, 0, 0.7, 0.2], [2, 7, 0, 0.4, 0.16], [3, 1, 0, 0.85, 0.15]],
    chords: [[[0, 1], [0, 1], [5, 1], [5, 1]], [[0, 1], [10, 10], [5, 1], [0, 1]], [[0, 1], [3, 7], [5, 1], [10, 10]]],
    kicks: [[0, 6, 8, 11], [0, 3, 8, 10], [0, 7, 10, 14]], clap: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14, 15], open: [10, 14],
    stabs: [[0, 8], [0, 10], [0, 6, 8]],
    bass: [[0, 0], [3, 4], [6, 0], [8, 0], [11, 7], [14, 4]], hook: 'funkwhistle', octave: 1,
    strEq: [[500, 0.7, 5], [2200, 1.2, -3], [3300, 0.8, -6]],
    riffs: [[[0, 4, 4], [4, 5, 2], [6, 4, 6]], [[2, 2, 4], [6, 4, 4], [10, 3, 4]], [[0, 2, 4], [4, 3, 4], [8, 4, 5]]],
    mix: {
      kick: { tune: 55, decay: 0.2, drive: 0.25, click: 0.14, punch: 0.64, rumble: 0, level: 0.86 },
      clap: { tone: 1590, decay: 0.135, spread: 0.55, level: 0.73, rev: 0.15 },
      ch: { tone: 4400, decay: 0.052, level: 0.47, rev: 0.06 },
      oh: { tone: 4200, decay: 0.13, level: 0.25, rev: 0.06 },
      acid: { tune: -12, cutoff: 485, reso: 1.3, envmod: 0.36, decay: 0.2, drive: 0.25, accent: 0.3, level: 0.66, rev: 0, dly: 0 },
      stab: { chord: 1, cutoff: 1100, reso: 0.7, detune: 7, level: 0.46, rev: 0.05, dly: 0 },
    },
    master: { kit: 2, room: 0.14, warmth: 0.3, drive: 0.15, duck: 0.4, vary: 0.42, revLevel: 0.29, arr: 0, humanize: 0.25 },
    swing: 0.38,
  },
  phonk: {
    name: 'PHONK', bpm: [134, 144], tag: 'tuned cowbell · driven 808', color: '#dc74a6',
    ensembles: [[2, 2, 0, 1, 0.16], [2, 2, 1, 0.8, 0.16], [7, 2, 0, 0.55, 0.2], [10, 2, 0, 0.72, 0.18]],
    chords: [[[0, 0], [0, 0], [8, 7], [7, 6]], [[0, 0], [3, 7], [8, 7], [7, 6]], [[0, 0], [0, 0], [5, 0], [7, 6]]],
    kicks: [[0, 3, 7, 10, 14], [0, 5, 7, 10, 11, 14], [0, 3, 6, 9, 11, 14]], snare: [4, 12], clap: [12],
    hats: [2, 6, 10, 11, 14, 15], open: [6], stabs: [[0], [0, 8], [0, 11]], perc: [7, 15], percVoice: 4,
    bass: [[0, 0], [3, 0], [7, 0], [10, 4], [14, 0]], hook: 'phonkbell', octave: 1,
    riffs: [[[0, 0, 2], [3, 0, 2], [6, 2, 2], [8, 1, 2], [11, 0, 2], [14, 4, 1]],
      [[0, 4, 2], [2, 2, 2], [5, 0, 2], [8, 0, 2], [11, 2, 2], [14, 1, 1]],
      [[0, 0, 2], [3, 2, 2], [6, 4, 2], [9, 2, 2], [11, 1, 2], [14, 0, 1]]],
    mix: {
      kick: { tune: 62, decay: 0.18, drive: 0.52, click: 0.16, punch: 0.74, rumble: 0, level: 0.64 },
      clap: { tone: 1280, decay: 0.10, level: 0.35, rev: 0.15 },
      snare: { tune: 196, snappy: 0.48, decay: 0.12, level: 0.71, rev: 0.14 },
      ch: { tone: 4250, decay: 0.046, level: 0.50, rev: 0.05, pan: -0.5 },
      oh: { tone: 3800, decay: 0.17, level: 0.28, rev: 0.09, pan: 0.5 },
      perc: { level: 0.22, rev: 0.05, dly: 0, pan: 0.5 },
      acid: { tune: 0, cutoff: 625, reso: 0.75, envmod: 0.24, decay: 0.47, drive: 0.72, accent: 0.35, level: 0.68, rev: 0, dly: 0 },
      stab: { chord: 0, cutoff: 1000, reso: 0.6, detune: 5, level: 0.55, rev: 0.25, dly: 0.08 },
    },
    master: { warmth: 0.27, drive: 0.27, dust: 0.12, duck: 0.36, vary: 0.3, revLevel: 0.24, arr: 0, humanize: 0.12 },
    swing: 0.03,
  },
  electrohiphop: {
    name: 'ELECTRO HIP-HOP', bpm: [105, 113], tag: 'body-rock 808 · vocoder funk', color: '#76c8da',
    ensembles: [[4, 7, 0, 0.24, 0.48], [3, 7, 0, 0.27, 0.37], [4, 6, 0, 0.25, 0.48], [0, 6, 0, 0.23, 0.32]],
    chords: [[[0, 6], [0, 6], [10, 6], [5, 6]], [[0, 6], [3, 6], [5, 6], [10, 6]], [[0, 6], [0, 6], [5, 6], [10, 6]]],
    kicks: [[0, 3, 8, 10, 13], [0, 3, 6, 8, 11, 14], [0, 2, 7, 8, 10, 13]], clap: [4, 12], snare: [12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14], open: [2, 10], stabs: [[3, 7, 11, 14], [2, 5, 9, 14], [0, 6, 11, 15]],
    perc: [3, 7, 13], percVoice: 4,
    bass: [[0, 0], [3, 0], [6, 4], [8, 0], [10, 7], [13, 4]], hook: 'robotformant', octave: 0,
    riffs: [[[0, 0, 2], [3, 2, 2], [7, 4, 2], [10, 2, 2]], [[0, 4, 2], [2, 4, 2], [6, 0, 2], [10, 2, 2]],
      [[0, 0, 2], [3, 0, 2], [6, 2, 2], [10, 4, 2]]],
    mix: {
      kick: { tune: 51, decay: 0.36, drive: 0.25, click: 0.18, punch: 0.48, rumble: 0, level: 0.82 },
      clap: { tone: 1850, decay: 0.16, spread: 0.43, level: 0.75, rev: 0.19 },
      snare: { tune: 220, snappy: 0.55, decay: 0.1, level: 0.36, rev: 0.12 },
      ch: { tone: 5600, decay: 0.05, level: 0.45, rev: 0.08 },
      oh: { tone: 4900, decay: 0.22, level: 0.35, rev: 0.1 },
      perc: { level: 0.27, rev: 0.1, dly: 0.06 },
      acid: { tune: -12, cutoff: 610, reso: 0.9, envmod: 0.43, decay: 0.19, drive: 0.32, accent: 0.24, level: 0.72, rev: 0, dly: 0 },
      stab: { chord: 6, cutoff: 1760, reso: 0.7, detune: 4, level: 0.58, rev: 0.18, dly: 0.11 },
    },
    master: { warmth: 0.22, drive: 0.19, duck: 0.28, vary: 0.34, revLevel: 0.28, arr: 0, humanize: 0.14 },
    swing: 0.04,
  },
};

export const HIPHOP_STYLES = Object.keys(HIPHOP);
const choose = (r, rows) => rows[Math.floor(r() * rows.length)];

export function hiphopGroove(profile, r, scale, steps, params, master) {
  const row = (hits, accents = []) => Array.from({ length: 16 }, (_, i) => accents.includes(i) ? 2 : hits.includes(i) ? 1 : 0);
  steps.kick = row(choose(r, profile.kicks), [0]);
  steps.snare = row([], profile.snare);
  steps.clap = row([], profile.clap);
  const closed = profile.hats.filter((i) => !profile.open?.includes(i));
  steps.ch = row(closed, closed.filter((i) => i % 8 === 6));
  steps.oh = row(profile.open ?? []);
  steps.stab = row(choose(r, profile.stabs));
  steps.perc = row(profile.perc ?? []);
  const bass = new Map(profile.bass);
  steps.acid = steps.acid.map((off, i) => bass.has(i) ? {
    on: true, n: bass.get(i) === 4 ? scale.includes(3) ? 3 : 4 : bass.get(i), a: i === 0 || i === 8, s: false,
  } : off);
  for (const [id, settings] of Object.entries(profile.mix)) Object.assign(params[id], settings);
  Object.assign(master, profile.master);
}

export function hiphopMotif(profile, r, scale) {
  const degrees = scale.filter((n) => n >= 0 && n < 12);
  const pitch = (d) => degrees[d % degrees.length] + 12 * Math.floor(d / degrees.length);
  const riff = choose(r, profile.riffs);
  const s = Array(32).fill(0);
  const answer = choose(r, [0, 2, 4]);
  for (const [j, [i, degree, len]] of riff.entries()) {
    const v = (j === 0 ? 0.86 : j % 2 ? 0.67 : 0.77) + r() * 0.09;
    s[i] = [pitch(degree), len, v];
    s[16 + i] = [pitch(j === riff.length - 1 ? answer : degree), len, v * 0.94];
  }
  return { v: profile.hook, o: profile.octave, s, x: { space: 0.42, risk: 0.18, feel: 0.5, warmth: profile.master.warmth } };
}
