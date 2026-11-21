export const FUNK_HANDS = [
  [1, 0, 0, 2, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0, 2, 0],
  [0, 0, 2, 0, 1, 0, 1, 0, 0, 2, 0, 0, 1, 0, 0, 0],
  [0, 0, 2, 0, 1, 0, 1, 0, 0, 2, 0, 0, 1, 2, 1, 2],
];
export const FUNK_VOX = [
  [2, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
];
export const funkHandBar = bar => bar % 4 === 3 ? 2 : bar % 2;
export const funkHand = step => FUNK_HANDS[funkHandBar(Math.floor(step / 16))][step % 16];
