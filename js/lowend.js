// Club low end per groove pocket: how much clean sine sub to layer under each bass voice
// (303, BASS, 808, REESE, LOG — the 808 and reese carry their own), and how far and how long each
// kick ducks the bass so the two never stack into one muddy boom. Pockets without an entry
// (GRID, SOUL) keep their bass untouched.
import { pocketOf } from './groove.js';

const CLUB = {
  MACHINE: { sub: [0.8, 0, 0, 0, 0], dip: 0.5, rel: 0.05 },
  HOUSE: { sub: [0.7, 0, 0, 0, 0.6], dip: 0.45, rel: 0.07 },
  GARAGE: { sub: [0.4, 0, 0, 0, 0], dip: 0.45, rel: 0.05 },
  BREAKS: { sub: [0.4, 0, 0, 0, 0], dip: 0.4, rel: 0.045 },
  TRAP: { sub: [0.4, 0, 0, 0, 0], dip: 0.45, rel: 0.05 },
  AFRO: { sub: [0.4, 0, 0, 0, 0.7], dip: 0.5, rel: 0.06 },
};

export const lowEnd = (master) => CLUB[pocketOf(master)?.name] || null;
