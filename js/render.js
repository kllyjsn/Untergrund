import { Engine, Sequencer } from './engine.js';
import { clone } from './state.js';
import { encodeWav } from './dsp.js';

export async function renderBars(state, bars, { sampleRate = 48000, tail = 4 } = {}) {
  const snap = clone(state);
  const sd = 60 / snap.bpm / 4;
  const steps = bars * 16;
  const start = 0.05;
  const len = Math.ceil((start + steps * sd + tail) * sampleRate);
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  const engine = new Engine(ctx, snap, { realtime: false });
  const seq = new Sequencer(engine, snap);
  for (let abs = 0; abs < steps; abs++) seq.tick(abs, start + abs * sd);
  return ctx.startRendering();
}

export function bufferToWav(buf) {
  const chans = [];
  for (let i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i));
  return encodeWav(chans, buf.sampleRate);
}
