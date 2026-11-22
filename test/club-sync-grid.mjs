import { Sequencer } from '../js/engine.js';
import { Recorder } from '../js/midi.js';

export function gridKicks(song) {
  const recorder = new Recorder(song), seq = new Sequencer(recorder, song);
  for (let step = 0; step < song.chain.length * 16 && !seq.finished; step++) seq.tick(step, step * recorder.stepDur);
  return (recorder.notes.kick || []).map(n => n.t * 1000);
}
