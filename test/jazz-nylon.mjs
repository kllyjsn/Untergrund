import assert from 'node:assert/strict';
import { Engine } from '../js/engine.js';
import { jazzNotches } from '../js/jazz.js';
import { freshSong } from '../js/state.js';

const probe = (style, center = 68.83, midi = 70) => {
  const s = freshSong(style, 11), calls = [];
  const e = { state: s, playingPattern: s.patterns[6], ch: { stab: { input: {} } }, rec: () => null, playBuf: (...args) => calls.push(args) };
  Engine.prototype.recordedNote.call(e, [[center, {}]], 1, 1, midi, .3, {}, 0, 'nylon');
  return calls[0];
};
const note = probe('bossa'), rate = 2 ** ((70 - 68.83) / 12);
assert.equal(note[4], rate);
assert.deepEqual(note[6].peaks, [[2183 * rate, 60, -30]]);
assert(Math.abs(note[6].peaks[0][0] - 2335.63) < .1);
assert.deepEqual(probe('trap')[6].peaks, [], 'non-jazz nylon retains its original processing');
assert.deepEqual(probe('swing')[6].peaks, [], 'the correction is Bossa-specific');
assert.deepEqual(probe('bossa', 63.803, 63)[6].peaks, [], 'other nylon recordings remain unchanged');
assert.equal(probe('trap')[6].lp, note[6].lp, 'upper-air low-pass settings are unchanged');
assert.deepEqual(jazzNotches('nylon', 69, NaN), []);
assert.deepEqual(jazzNotches('nylon', 69, 0), []);
console.log('nylon resonance: Bossa-only nylon_69 Q60 correction follows tuning/playback rate; other files and styles untouched');
