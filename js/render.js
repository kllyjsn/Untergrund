import { Engine, Sequencer, parseChain } from './engine.js';
import { clone } from './state.js';
import { encodeWav } from './dsp.js';
import { loadLiveKit, loadBand, STAB_BAND } from './livekit.js';

// startBar renders a window from inside the song chain (e.g. the peak), with the arrangement state it would have there.
export async function renderBars(state, bars, { sampleRate = 48000, tail = 4, startBar = 0 } = {}) {
  const snap = clone(state);
  if (Math.round(snap.master.kit || 0) === 1) await loadLiveKit();
  const band = STAB_BAND[Math.round(snap.params.stab?.voice || 0)];
  if (band) await Promise.all([loadBand(band), band === 'piano' && loadBand('pianosoft')]);
  const sd = 60 / snap.bpm / 4;
  const steps = bars * 16;
  const start = 0.05;
  const len = Math.ceil((start + steps * sd + tail) * sampleRate);
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  const engine = new Engine(ctx, snap, { realtime: false });
  const seq = new Sequencer(engine, snap);
  const chain = snap.chainOn ? parseChain(snap.chain) : [];
  if (startBar && chain.length) { seq.chainPos = startBar; seq.cur = chain[(startBar - 1) % chain.length]; }
  const first = chain.length ? startBar * 16 : 0;
  for (let abs = 0; abs < steps; abs++) seq.tick(first + abs, start + abs * sd);
  return ctx.startRendering();
}

export function bufferToWav(buf) {
  const chans = [];
  for (let i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i));
  return encodeWav(chans, buf.sampleRate);
}
