import { Engine, Sequencer, scoreKinds } from './engine.js';
import { compose } from './classical.js';
import { clone } from './state.js';
import { encodeWav } from './dsp.js';
import { loadLiveKit, loadBand, STAB_BAND } from './livekit.js';

export async function renderBars(state, bars, { sampleRate = 48000, tail = 4 } = {}) {
  const snap = clone(state);
  if (Math.round(snap.master.kit || 0) === 1) await loadLiveKit();
  const band = STAB_BAND[Math.round(snap.params.stab?.voice || 0)];
  if (band) await Promise.all([loadBand(band), band === 'piano' && loadBand('pianosoft')]);
  const score = snap.patterns.find((p) => p.score)?.score;
  if (score) await Promise.all(scoreKinds(score).map((k) => loadBand(k)));
  const sd = 60 / snap.bpm / 4;
  const steps = bars * 16;
  const start = 0.05;
  // A score's rubato stretches the timeline; size the render to the music, not the metronome.
  const tempo = score ? compose(score).tempo : null;
  let span = 0;
  for (let i = 0; i < steps; i++) span += tempo ? tempo[i % tempo.length] : 1;
  const len = Math.ceil((start + span * sd + tail) * sampleRate);
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  const engine = new Engine(ctx, snap, { realtime: false });
  const seq = new Sequencer(engine, snap);
  for (let abs = 0, t = start; abs < steps; abs++) { seq.tick(abs, t); t += engine.stepDur; }
  return ctx.startRendering();
}

export function bufferToWav(buf) {
  const chans = [];
  for (let i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i));
  return encodeWav(chans, buf.sampleRate);
}
