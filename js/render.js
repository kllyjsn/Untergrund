import { Engine, Sequencer, parseChain, scoreKinds } from './engine.js';
import { compose } from './classical.js';
import { loadPiece } from './repertoire.js';
import { clone } from './state.js';
import { encodeWav } from './dsp.js';
import { loadBand, liveSets, loadSets, withTakes } from './livekit.js';
import { vocalStem } from './sing.js';

// startBar renders a window from inside the song chain (e.g. the peak), with the arrangement state it would have there.
// Hooks (used by js/stems.js): onContext(ctx) before the engine is built, onEngine(engine) before the song is
// scheduled, onScheduled(ctx) just before rendering; channels sets the output channel count.
export async function renderBars(state, bars, { sampleRate = 48000, tail, startBar = 0, channels = 2, onContext, onEngine, onScheduled } = {}) {
  const snap = clone(state);
  await loadSets(withTakes(liveSets(snap)));
  const score = snap.patterns.find((p) => p.score)?.score;
  if (score?.piece) await loadPiece(score.piece);
  if (score) await Promise.all(scoreKinds(score).map((k) => loadBand(k)));
  const sd = 60 / snap.bpm / 4;
  const sc = score ? compose(score) : null;
  const steps = bars * (sc?.barLen || 16);
  const start = 0.05;
  // A score's rubato stretches the timeline; size the render to the music, not the metronome.
  const tempo = sc ? sc.tempo : null;
  const chain = snap.chainOn ? parseChain(snap.chain) : [];
  const first = sc ? startBar * (sc.barLen || 16) : chain.length ? startBar * 16 : 0;
  let span = 0;
  for (let i = 0; i < steps; i++) span += tempo ? tempo[(first + i) % tempo.length] : 1;
  // A score's last bar is its final chord: render room for it to ring out, then end the file once it has died away.
  const trim = tail == null && sc && !sc.waiting && !onContext && !onEngine;
  const len = Math.ceil((start + span * sd + (tail ?? (sc ? SCORE_TAIL : 4))) * sampleRate);
  const ctx = new OfflineAudioContext(channels, len, sampleRate);
  onContext?.(ctx);
  const engine = new Engine(ctx, snap, { realtime: false, vocal: vocalStem });
  onEngine?.(engine);
  const cursor = (e) => {
    const seq = new Sequencer(e, snap);
    if (startBar && chain.length && !sc) { seq.chainPos = startBar; seq.cur = chain[(startBar - 1) % chain.length]; }
    return seq;
  };
  const seq = cursor(engine);
  let abs = 0;
  let end = start;
  const schedule = (to) => {
    for (; abs < to; abs++) { seq.tick(first + abs, end); end += engine.stepDur; }
    if (abs >= steps) engine.vocalStop(end);
  };
  // Keep externally routed graphs and the original score/vocal scheduling path intact.
  if (engine.hardTechno && steps > 2 * BATCH_STEPS && !sc && !snap.sing?.on &&
      !onContext && !onEngine && !onScheduled && typeof ctx.suspend === 'function') {
    // A breakdown ramp can reach backwards to the previous automation event. Write the
    // filter timeline at time zero, before rendering any audio; only hits are queued in batches.
    if (chain.length && snap.master.arr) {
      const filters = cursor({ stepDur: sd, breakSweep: engine.breakSweep.bind(engine), breakOpen: engine.breakOpen.bind(engine) });
      for (let i = 0, t = start; i < steps; i++, t += sd) filters.advanceBar(first + i, t);
      seq.breakFilterPlanned = true;
    }
    const [, buf] = await Promise.all([scheduleInBatches(ctx, steps, schedule, () => end), ctx.startRendering()]);
    return buf;
  }
  schedule(steps);
  onScheduled?.(ctx);
  const buf = await ctx.startRendering();
  return trim ? trimTail(buf) : buf;
}

const BATCH_STEPS = 32;

// Leave half a second for any notes played ahead of their nominal grid time.
async function scheduleInBatches(ctx, steps, schedule, nextTime) {
  const quantum = 128, rate = ctx.sampleRate;
  let suspended = false;
  try {
    for (let to = BATCH_STEPS; ; to += BATCH_STEPS) {
      schedule(Math.min(steps, to));
      if (to >= steps) break;
      const frame = Math.floor((nextTime() - 0.5) * rate / quantum) * quantum;
      if (frame <= ctx.currentTime * rate + quantum) continue;
      const ready = ctx.suspend(frame / rate);
      if (suspended) await Promise.all([ready, ctx.resume()]);
      else await ready;
      suspended = true;
    }
  } finally {
    if (suspended && ctx.state === 'suspended') await ctx.resume();
  }
}

const SCORE_TAIL = 10;

// Cuts the silence after a ring-out: once the 50 ms envelope has fallen below -60 dBFS (or 50 dB under the peak,
// whichever is lower) for good, the file ends `pad` seconds later with a raised-cosine fade over the last `fade`.
export function trimTail(buf, { floorDb = -60, underPeakDb = 50, pad = 0.6, fade = 0.4 } = {}) {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)), sr = buf.sampleRate;
  const w = Math.round(sr * 0.05), n = Math.floor(buf.length / w), env = new Float64Array(n);
  let peak = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  for (let k = 0; k < n; k++) {
    let e = 0;
    for (const d of chans) for (let i = k * w; i < (k + 1) * w; i++) e += d[i] * d[i];
    env[k] = 10 * Math.log10(e / (w * chans.length) + 1e-24);
  }
  const floor = Math.min(floorDb, 20 * Math.log10(peak + 1e-12) - underPeakDb);
  let k = n;
  while (k > 0 && env[k - 1] < floor) k--;
  const length = Math.min(buf.length, k * w + Math.round(pad * sr));
  if (length >= buf.length) return buf;
  const out = new AudioBuffer({ length, numberOfChannels: chans.length, sampleRate: sr }), m = Math.min(length, Math.round(fade * sr));
  chans.forEach((d, c) => {
    const o = d.slice(0, length);
    for (let i = 0; i < m; i++) o[length - m + i] *= 0.5 + 0.5 * Math.cos((Math.PI * i) / m);
    out.copyToChannel(o, c);
  });
  return out;
}

export function bufferToWav(buf) {
  const chans = [];
  for (let i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i));
  return encodeWav(chans, buf.sampleRate);
}
