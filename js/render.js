import { Engine, Sequencer, parseChain, scoreKinds } from './engine.js';
import { compose } from './classical.js';
import { loadPiece } from './repertoire.js';
import { clone } from './state.js';
import { encodeWav } from './dsp.js';
import { loadBand, liveSets, loadSets } from './livekit.js';

// startBar renders a window from inside the song chain (e.g. the peak), with the arrangement state it would have there.
// Hooks (used by js/stems.js): onContext(ctx) before the engine is built, onEngine(engine) before the song is
// scheduled, onScheduled(ctx) just before rendering; channels sets the output channel count.
export async function renderBars(state, bars, { sampleRate = 48000, tail = 4, startBar = 0, channels = 2, onContext, onEngine, onScheduled } = {}) {
  const snap = clone(state);
  await loadSets(liveSets(snap));
  const score = snap.patterns.find((p) => p.score)?.score;
  if (score?.piece) await loadPiece(score.piece);
  if (score) await Promise.all(scoreKinds(score).map((k) => loadBand(k)));
  const sd = 60 / snap.bpm / 4;
  const sc = score ? compose(score) : null;
  const steps = bars * (sc?.barLen || 16);
  const start = 0.05;
  // A score's rubato stretches the timeline; size the render to the music, not the metronome.
  const tempo = sc ? sc.tempo : null;
  let span = 0;
  for (let i = 0; i < steps; i++) span += tempo ? tempo[i % tempo.length] : 1;
  const len = Math.ceil((start + span * sd + tail) * sampleRate);
  const ctx = new OfflineAudioContext(channels, len, sampleRate);
  onContext?.(ctx);
  const engine = new Engine(ctx, snap, { realtime: false });
  onEngine?.(engine);
  const seq = new Sequencer(engine, snap);
  const chain = snap.chainOn ? parseChain(snap.chain) : [];
  if (startBar && chain.length) { seq.chainPos = startBar; seq.cur = chain[(startBar - 1) % chain.length]; }
  const first = chain.length ? startBar * 16 : 0;
  for (let abs = 0, t = start; abs < steps; abs++) { seq.tick(first + abs, t); t += engine.stepDur; }
  onScheduled?.(ctx);
  return ctx.startRendering();
}

export function bufferToWav(buf) {
  const chans = [];
  for (let i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i));
  return encodeWav(chans, buf.sampleRate);
}
