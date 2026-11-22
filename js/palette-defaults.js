import { rng } from './dsp.js';

export const PALETTE_INSTRUMENTS = {
  deephouse: [[1, 1, 0, 1.5, 0.25], [3, 1, 0, 0.9, 0.35], [1, 5, 0, 0.65, 0.75], [2, 1, 0, 1.4, 0.2]],
  euphoric: [[7, 1, 0, 1.6, 0.25], [10, 1, 0, 1.8, 0.2], [2, 1, 0, 2.1, 0.15], [4, 1, 0, 0.65, 0.7]],
  dnb: [[10, 3, 0, 1.6, 0.25], [2, 3, 1, 1.8, 0.2], [1, 3, 1, 1.2, 0.45], [5, 3, 1, 0.55, 0.75]],
};

export const PALETTE_DEFAULTS = {
  deephouse: { detune: 8, drive: 0.1 },
  euphoric: { detune: 18, drive: 0.15 },
  dnb: { drive: 0.25 },
};

export function instrumentFor(choices, seed) {
  const r = rng(Math.imul((seed | 0) ^ 0x6d2b79f5, 0x85ebca6b));
  return choices[Math.floor(r() * choices.length)];
}
