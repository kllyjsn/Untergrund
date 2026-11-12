import { Engine, Sequencer, parseChain, scoreKinds } from './engine.js';
import { compose } from './classical.js';
import { loadPiece } from './repertoire.js';
import { clone } from './state.js';
import { encodeWav } from './dsp.js';
import { loadBand, liveSets, loadSets } from './livekit.js';

// startBar renders a window from inside the song chain (e.g. the peak), with the arrangement state it would have there.
// Hooks (used by js/stems.js): onContext(ctx) before the engine is built, onEngine(engine) before the song is
// scheduled, onScheduled(ctx) just before rendering; channels sets the output channel count.
export async function renderBars(state, bars, { sampleRate = 48000, tail, startBar = 0, channels = 2, onContext, onEngine, onScheduled } = {}) {
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
  // A score's last bar is its final chord: render room for it to ring out, then end the file once it has died away.
  const trim = tail == null && sc && !sc.waiting && !onContext && !onEngine;
  const len = Math.ceil((start + span * sd + (tail ?? (sc ? SCORE_TAIL : 4))) * sampleRate);
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
  const buf = await ctx.startRendering();
  return trim ? trimTail(buf) : buf;
}

const SCORE_TAIL = 10;

// Cuts the silence after a ring-out: ends half a second after the last sample within 60 dB of the peak, with a short fade.
export function trimTail(buf, { floorDb = -60, pad = 0.5, fade = 0.05 } = {}) {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  let peak = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  const floor = peak * 10 ** (floorDb / 20);
  let last = 0;
  for (const d of chans) for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > floor) { last = i; break; }
  const sr = buf.sampleRate, length = Math.min(buf.length, last + Math.round(pad * sr));
  if (length >= buf.length) return buf;
  const out = new AudioBuffer({ length, numberOfChannels: chans.length, sampleRate: sr }), n = Math.min(length, Math.round(fade * sr));
  chans.forEach((d, c) => {
    const o = d.slice(0, length);
    for (let i = 0; i < n; i++) o[length - 1 - i] *= i / n;
    out.copyToChannel(o, c);
  });
  return out;
}

export function bufferToWav(buf) {
  const chans = [];
  for (let i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i));
  return encodeWav(chans, buf.sampleRate);
}
