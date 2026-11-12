// Loaded inside headless Chrome by scripts/audio-benchmark.mjs: builds a song the way NEW SET does, renders it with
// the real offline engine and measures the master output and the pre-master stems (js/audio-quality.js).
import { defaultState, generate, applyOverrides, arrangement, songChain, clone, STYLES } from '/js/state.js';
import { Engine, Sequencer, parseChain, scoreKinds } from '/js/engine.js';
import { compose } from '/js/classical.js';
import { loadPiece } from '/js/repertoire.js';
import { loadBand, liveSets, loadSets } from '/js/livekit.js';
import { capture } from '/js/midi.js';
import { router, stemList } from '/js/stems.js';
import { encodeWav } from '/js/dsp.js';
import { targetFor } from '/js/loudness.js';
import { analyzeMix, analyzeStems } from '/js/audio-quality.js';

const START = 0.05, LETTERS = 'ABCDEFGH';

// js/main.js planSet(): a generated song with its ending, at its own tempo, with the style's make-up gain.
export function song(style, seed) {
  const s = defaultState();
  s.scale = style === 'euphoric' ? 'major' : 'minor';
  const g = generate(style, seed, s.scale);
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  s.key = g.key;
  applyOverrides(s, g, true);
  s.chainOn = true; s.chain = songChain(style, seed); s.ending = true;
  if (g.pattern.score) s.bpm = g.bpm;
  s.artist = { name: 'UNTERGRUND', title: 'benchmark', style, seed, created: '' };
  return s;
}

// A REPERTOIRE score is fetched on demand; until it arrives the recorder sees js/repertoire.js's one silent bar.
async function ready(s) {
  const piece = s.patterns.find((p) => p.score)?.score?.piece;
  if (piece) await loadPiece(piece);
  return s;
}

// The song's timeline from the note recorder: bar start times, sections (runs of one chain letter), every
// part's onsets, and the bars with the most notes (the densest window, where masking and the low end matter).
export function plan(s, windowBars = 2) {
  const c = capture(s), per = c.barLen, end = c.at[c.at.length - 1] + c.dur[c.dur.length - 1];
  const barTimes = [...Array.from({ length: c.bars }, (_, b) => c.at[b * per]), end];
  const chain = s.chain.length > 1 ? s.chain : '', sections = [];
  for (let b = 0; b < chain.length; b++) if (!sections.length || sections.at(-1).label !== chain[b]) sections.push({ label: chain[b], from: b, to: b + 1 }); else sections.at(-1).to = b + 1;
  const onsets = Object.values(c.notes).flat().map((n) => n.t), perBar = new Array(c.bars).fill(0);
  for (const t of onsets) { let b = 0; while (b + 1 < c.bars && barTimes[b + 1] <= t) b++; perBar[b]++; }
  let best = 0, bestN = -1;
  for (let b = 0; b + windowBars < c.bars; b++) { const n = perBar.slice(b, b + windowBars).reduce((a, v) => a + v, 0); if (n > bestN) { bestN = n; best = b; } }
  const finalHit = Math.max(...onsets);
  let finalBar = 0; while (finalBar + 1 < c.bars && barTimes[finalBar + 1] <= finalHit) finalBar++;
  return { c, per, bars: c.bars, barTimes, sections, finalHit, finalBar, peakBar: best };
}

// renderBars (js/render.js) with the steps scheduled a couple of bars ahead of the render through suspend(),
// the way live playback schedules them: an offline graph holding every future hit of a 3-minute song at once
// renders ~7x slower. fromBar starts inside the song with the arrangement state it has there.
export async function render(s, fromBar, toBar, { sampleRate = 48000, tail = 8, channels = 2, onContext, onEngine } = {}) {
  const snap = clone(s);
  await loadSets(liveSets(snap));
  const score = snap.patterns.find((p) => p.score)?.score;
  if (score?.piece) await loadPiece(score.piece);
  if (score) await Promise.all(scoreKinds(score).map((k) => loadBand(k)));
  const sc = score ? compose(score) : null, per = sc?.barLen || 16, sd = 60 / snap.bpm / 4, tempo = sc?.tempo;
  const from = fromBar * per, to = toBar * per;
  let span = 0; for (let i = from; i < to; i++) span += tempo ? tempo[i % tempo.length] : 1;
  const len = Math.ceil((START + span * sd + tail) * sampleRate), ctx = new OfflineAudioContext(channels, len, sampleRate);
  onContext?.(ctx);
  const engine = new Engine(ctx, snap, { realtime: false });
  onEngine?.(engine);
  const seq = new Sequencer(engine, snap), chain = snap.chainOn ? parseChain(snap.chain) : [];
  if (fromBar && chain.length > 1) { seq.chainPos = fromBar; seq.cur = chain[(fromBar - 1) % chain.length]; }
  let abs = from, t = START;
  const q = 128 / sampleRate, ahead = () => {
    const stop = Math.min(to, abs + 2 * per);
    for (; abs < stop; abs++) { seq.tick(abs, t); t += engine.stepDur; }
    if (abs >= to) return;
    const at = Math.floor((t - 0.5) / q) * q;
    if (at > ctx.currentTime + q) ctx.suspend(at).then(() => { ahead(); ctx.resume(); }); else ahead();
  };
  ahead();
  return ctx.startRendering();
}

// Master output plus taps on the limiter's input and output (channels 2-5).
const tapLimiter = (e) => {
  const ctx = e.ctx, m = ctx.createChannelMerger(6), d = ctx.destination;
  d.channelCount = 6; d.channelCountMode = 'explicit'; d.channelInterpretation = 'discrete';
  e.out.disconnect();
  [e.out, e.limIn, e.limiter].forEach((node, k) => { const sp = ctx.createChannelSplitter(2); node.connect(sp); sp.connect(m, 0, 2 * k); sp.connect(m, 1, 2 * k + 1); });
  m.connect(d);
};
async function master(s, fromBar, toBar, tail, taps = true) {
  const buf = await render(s, fromBar, toBar, taps ? { channels: 6, tail, onEngine: tapLimiter } : { tail });
  return { buf, ch: Array.from({ length: buf.numberOfChannels }, (_, k) => buf.getChannelData(k)) };
}

// Pre-master stems of a window (js/stems.js routing), with each part's onsets inside it.
async function stems(s, p, fromBar, toBar) {
  const ids = stemList(s, p.bars), r = router(ids), t0 = p.barTimes[fromBar], t1 = p.barTimes[toBar];
  let buf;
  try { buf = await render({ ...clone(s), solos: {} }, fromBar, toBar, { channels: ids.length * 2, tail: 1, onContext: r.onContext, onEngine: r.onEngine }); } finally { r.restore(); }
  const at = (t) => START + t - t0, inWin = (n) => n.t >= t0 && n.t < t1;
  const list = ids.map((id, k) => ({ id, left: buf.getChannelData(2 * k), right: buf.getChannelData(2 * k + 1), notes: id === 'fx' ? null : (p.c.notes[id] || []).filter(inWin).length }));
  return analyzeStems(list, buf.sampleRate, { kicks: (p.c.notes.kick || []).filter(inWin).map((n) => at(n.t)) });
}

// tier 'deep': the whole song (+ 8 s tail) and an 8-bar stem window. tier 'fast': the 2 densest bars (master + stems)
// and the ending: from the bar before the final hit to the song's end (+ 6 s tail).
export async function measure(style, seed, { tier = 'fast' } = {}) {
  const t0 = performance.now(), s = await ready(song(style, seed)), W = tier === 'deep' ? 8 : 2, p = plan(s, W), target = targetFor(style);
  const win = [p.peakBar, Math.min(p.bars, p.peakBar + W)], out = { style, seed, tier, bpm: s.bpm, bars: p.bars, secs: +p.barTimes.at(-1).toFixed(2), chain: s.chain.length > 1 ? s.chain : null, windows: { stems: win } };
  if (tier === 'deep') {
    const { buf, ch } = await master(s, 0, p.bars, 8);
    out.mix = analyzeMix(ch[0], ch[1], buf.sampleRate, { barTimes: p.barTimes.map((t) => t + START), sections: p.sections, finalHit: p.finalHit + START, songEnd: p.barTimes.at(-1) + START, target, lim: ch.slice(2) });
  } else {
    let t = performance.now();
    const a = await master(s, win[0], win[1], 1);
    out.mix = analyzeMix(a.ch[0], a.ch[1], a.buf.sampleRate, { target, lim: a.ch.slice(2) });
    const e0 = Math.max(0, Math.min(p.bars - 2, p.finalBar - 1)), b = await master(s, e0, p.bars, 6, false), o = START - p.barTimes[e0];
    const endMix = analyzeMix(b.ch[0], b.ch[1], b.buf.sampleRate, { finalHit: p.finalHit + o, songEnd: p.barTimes.at(-1) + o, target, refLufs: out.mix.loudness.integrated });
    out.mix.ending = endMix.ending;
    out.mix.peak.truePeakDb = Math.max(out.mix.peak.truePeakDb, endMix.peak.truePeakDb);
    out.mix.peak.clipRuns += endMix.peak.clipRuns;
    out.windows.ending = [e0, p.bars];
    out.ms = { windows: Math.round(performance.now() - t) };
  }
  out.windows.peak = tier === 'deep' ? [0, p.bars] : win;
  const ts = performance.now();
  out.stems = await stems(s, p, win[0], win[1]);
  (out.ms ||= {}).stems = Math.round(performance.now() - ts);
  out.renderMs = Math.round(performance.now() - t0);
  return out;
}

// A listening excerpt (master only) as base64 WAV: kind 'peak' = densest bars, 'ending' = last bars and the ring-out.
export async function excerpt(style, seed, { kind = 'peak', bars = 8 } = {}) {
  const s = await ready(song(style, seed)), p = plan(s, bars);
  const [a, b, tail] = kind === 'ending' ? [Math.max(0, Math.min(p.bars - 2, p.finalBar - 2)), p.bars, 8] : [p.peakBar, Math.min(p.bars, p.peakBar + bars), 0.5];
  const buf = await render(s, a, b, { tail });
  const bytes = new Uint8Array(await encodeWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate).arrayBuffer());
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { bars: [a, b], secs: buf.length / buf.sampleRate, wav: btoa(bin) };
}

export const styleInfo = () => Object.fromEntries(Object.entries(STYLES).map(([id, v]) => [id, { name: v.name, family: v.family }]));
