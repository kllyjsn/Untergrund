// Loaded inside headless Chrome by scripts/audio-benchmark.mjs: builds a song the way NEW SET does, renders it with
// the real offline engine and measures the master output and the pre-master stems (js/audio-quality.js).
import { defaultState, generate, applyOverrides, arrangement, applySongPlan, songFeel, clone, STYLES, MAJOR_STYLES } from '/js/state.js';
import { Engine, Sequencer, parseChain, scoreKinds } from '/js/engine.js';
import { compose } from '/js/classical.js';
import { loadPiece } from '/js/repertoire.js';
import { loadBand, liveSets, loadSets, withTakes, assertRootsReady } from '/js/livekit.js';
import { capture } from '/js/midi.js';
import { router, stemList } from '/js/stems.js';
import { encodeWav } from '/js/dsp.js';
import { deterministicAudioSums } from '/js/audio-sums.js';
import { targetFor } from '/js/loudness.js';
import { analyzeMix, analyzeStems, targetBalance } from '/js/audio-quality.js';
import { analyzePerceptual } from '/js/perceptual-audio.js';

const START = 0.05, LETTERS = 'ABCDEFGH';
const NON_INSTRUMENTS = new Set(['kick', 'snare', 'clap', 'ch', 'oh', 'ride', 'perc', 'timp', 'fx', 'vox', 'sung']);

// js/main.js planSet(): a generated song with its ending, at its own tempo, with the style's make-up gain.
export function song(style, seed) {
  const s = defaultState();
  s.scale = style === 'euphoric' || MAJOR_STYLES.has(style) ? 'major' : 'minor';
  const g = generate(style, seed, s.scale, { feel: songFeel(style, seed) });
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  s.key = g.key;
  applyOverrides(s, g, true);
  s.chainOn = true; applySongPlan(s, style, seed); s.ending = true;
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
  const onsets = Object.values(c.notes).flat().map((n) => n.t), perBar = new Array(c.bars).fill(0), voices = new Array(c.bars).fill(0);
  const barOf = (t) => { let b = 0; while (b + 1 < c.bars && barTimes[b + 1] <= t) b++; return b; };
  for (const t of onsets) perBar[barOf(t)]++;
  for (const ns of Object.values(c.notes)) for (const b of new Set(ns.map((n) => barOf(n.t)))) voices[b]++;
  let best = 0, bestN = -1;
  for (let b = 0; b + windowBars < c.bars; b++) { const n = perBar.slice(b, b + windowBars).reduce((a, v) => a + v, 0); if (n > bestN) { bestN = n; best = b; } }
  const finalHit = Math.max(...onsets);
  let finalBar = 0; while (finalBar + 1 < c.bars && barTimes[finalBar + 1] <= finalHit) finalBar++;
  return { c, per, bars: c.bars, barTimes, sections, finalHit, finalBar, peakBar: best, barNotes: { notes: perBar, voices } };
}

// renderBars (js/render.js) with the steps scheduled a couple of bars ahead of the render through suspend(),
// the way live playback schedules them: an offline graph holding every future hit of a 3-minute song at once
// renders ~7x slower. fromBar starts inside the song with the arrangement state it has there.
export async function render(s, fromBar, toBar, { sampleRate = 48000, tail = 8, channels = 2, stableSums = false, onContext, onEngine } = {}) {
  const snap = clone(s);
  const sets = withTakes(liveSets(snap));
  await loadSets(sets);
  assertRootsReady(sets);
  const score = snap.patterns.find((p) => p.score)?.score;
  if (score?.piece) await loadPiece(score.piece);
  if (score) await Promise.all(scoreKinds(score).map((k) => loadBand(k)));
  const sc = score ? compose(score) : null, per = sc?.barLen || 16, sd = 60 / snap.bpm / 4, tempo = sc?.tempo;
  const from = fromBar * per, to = toBar * per;
  let span = 0; for (let i = from; i < to; i++) span += tempo ? tempo[i % tempo.length] : 1;
  const len = Math.ceil((START + span * sd + tail) * sampleRate), ctx = new OfflineAudioContext(channels, len, sampleRate);
  if (stableSums) deterministicAudioSums(ctx, { incremental: true });
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

// Master output plus taps on the limiter's input and output (channels 2-5) and the bus saturator's input (6-7). The
// clipper input is the limiter output times limTrim, shaped by the clip curve; the saturator shapes satIn's output.
const tapLimiter = (e) => {
  const ctx = e.ctx, m = ctx.createChannelMerger(8), d = ctx.destination;
  d.channelCount = 8; d.channelCountMode = 'explicit'; d.channelInterpretation = 'discrete';
  e.out.disconnect();
  [e.out, e.limIn, e.limiter, e.satIn].forEach((node, k) => { const sp = ctx.createChannelSplitter(2); node.connect(sp); sp.connect(m, 0, 2 * k); sp.connect(m, 1, 2 * k + 1); });
  m.connect(d);
};
// DynamicsCompressorNode applies a fixed make-up gain; measure it on a tone 40 dB under the threshold, where there
// is no reduction, so limiter gain reduction is absolute.
let makeup = null;
async function makeupDb(e) {
  if (makeup != null) return makeup;
  const fs = 48000, ctx = new OfflineAudioContext(1, fs / 2, fs), l = e.limiter, c = ctx.createDynamicsCompressor(), o = ctx.createOscillator(), g = ctx.createGain();
  for (const k of ['threshold', 'ratio', 'knee', 'attack', 'release']) c[k].value = l[k].value;
  g.gain.value = 10 ** ((l.threshold.value - 40) / 20) * Math.SQRT2; o.frequency.value = 997;
  o.connect(g).connect(c).connect(ctx.destination); o.start();
  const y = (await ctx.startRendering()).getChannelData(0), a = fs / 4;
  let sq = 0; for (let i = a; i < y.length; i++) sq += y[i] * y[i];
  return (makeup = 10 * Math.log10(sq / (y.length - a)) - (l.threshold.value - 40));
}
async function master(s, fromBar, toBar, { tail, taps = true, stableSums = true }) {
  let eng;
  const buf = await render(s, fromBar, toBar, taps ? { channels: 8, tail, stableSums, onEngine: (e) => { eng = e; tapLimiter(e); } } : { tail, stableSums });
  const out = { buf, ch: Array.from({ length: buf.numberOfChannels }, (_, k) => buf.getChannelData(k)) };
  if (taps) Object.assign(out, { clip: { gain: eng.limTrim.gain.value, curve: eng.clip.curve }, sat: { curve: eng.sat.curve, taps: out.ch.slice(6, 8) }, makeupDb: await makeupDb(eng) });
  return out;
}

// Pre-master stems of a window (js/stems.js routing), with each part's onsets inside it.
async function stems(s, p, fromBar, toBar) {
  const ids = stemList(s, p.bars), r = router(ids), t0 = p.barTimes[fromBar], t1 = p.barTimes[toBar], kicks = [];
  // Timing humanization can put a kick on the other side of a window boundary.
  const onEngine = (e) => {
    r.onEngine(e);
    const trigger = e.trigger;
    e.trigger = (id, t, ...args) => {
      if (id === 'kick') kicks.push(t);
      return trigger.call(e, id, t, ...args);
    };
  };
  let buf;
  try { buf = await render({ ...clone(s), solos: {} }, fromBar, toBar, { channels: ids.length * 2, tail: 1, stableSums: true, onContext: r.onContext, onEngine }); } finally { r.restore(); }
  const at = (t) => START + t - t0, inWin = (n) => n.t >= t0 && n.t < t1;
  const onsets = Object.fromEntries(ids.map((id) => [id, id === 'kick' ? kicks : (p.c.notes[id] || []).filter(inWin).map((n) => at(n.t))]));
  const list = ids.map((id, k) => ({ id, left: buf.getChannelData(2 * k), right: buf.getChannelData(2 * k + 1), notes: id === 'fx' ? null : onsets[id].length }));
  const result = analyzeStems(list, buf.sampleRate, { kicks: onsets.kick || [], onsets }), window = perceptualWindow(p, fromBar, toBar, buf.sampleRate);
  for (const [k, row] of result.stems.entries()) {
    const { id, left, right } = list[k];
    row.perceptual = window(left, right, !NON_INSTRUMENTS.has(id));
  }
  return result;
}

function perceptualWindow(p, from, to, fs) {
  const start = Math.round(START * fs), end = start + Math.round((p.barTimes[to] - p.barTimes[from]) * fs);
  const boundaries = p.sections.slice(1).filter(({ from: b }) => b > from && b < to).map(({ from: b }) => p.barTimes[b] - p.barTimes[from]);
  return (L, R, instrument = true) => analyzePerceptual(L.subarray(start, end), R.subarray(start, end), fs, { boundaries, instrument });
}

// tier 'deep': the whole song (+ 8 s tail) and an 8-bar stem window. tier 'fast': the 2 densest bars (master + stems)
// and the ending: from the bar before the final hit to the song's end (+ 6 s tail).
export async function measure(style, seed, { tier = 'fast' } = {}) {
  const t0 = performance.now(), s = await ready(song(style, seed)), W = tier === 'deep' ? 8 : 2, p = plan(s, W), target = targetFor(style);
  const win = [p.peakBar, Math.min(p.bars, p.peakBar + W)], out = { style, seed, tier, bpm: s.bpm, bars: p.bars, secs: +p.barTimes.at(-1).toFixed(2), chain: s.chain.length > 1 ? s.chain : null, windows: { stems: win } };
  if (tier === 'deep') {
    const m = await master(s, 0, p.bars, { tail: 8, stableSums: false }), { buf, ch } = m;
    out.mix = analyzeMix(ch[0], ch[1], buf.sampleRate, { barTimes: p.barTimes.map((t) => t + START), sections: p.sections, finalHit: p.finalHit + START, songEnd: p.barTimes.at(-1) + START, target, lim: ch.slice(2, 6), clip: m.clip, sat: m.sat, makeupDb: m.makeupDb, barNotes: p.barNotes });
    out.perceptual = perceptualWindow(p, 0, p.bars, buf.sampleRate)(ch[0], ch[1]);
  } else {
    let t = performance.now();
    const a = await master(s, win[0], win[1], { tail: 1 });
    out.mix = analyzeMix(a.ch[0], a.ch[1], a.buf.sampleRate, { target, lim: a.ch.slice(2, 6), clip: a.clip, sat: a.sat, makeupDb: a.makeupDb, crestTimes: p.barTimes.slice(win[0], win[1] + 1).map((t) => t - p.barTimes[win[0]] + START) });
    out.perceptual = perceptualWindow(p, win[0], win[1], a.buf.sampleRate)(a.ch[0], a.ch[1]);
    const e0 = Math.max(0, Math.min(p.bars - 2, p.finalBar - 1)), b = await master(s, e0, p.bars, { tail: 6, taps: false }), o = START - p.barTimes[e0];
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
  out.mix.balance = targetBalance(out.mix.spectrum.octaves, style);
  (out.ms ||= {}).stems = Math.round(performance.now() - ts);
  out.renderMs = Math.round(performance.now() - t0);
  return out;
}

// A listening excerpt (master only) as base64 WAV: kind 'peak' = densest bars, 'ending' = last bars and the ring-out.
export async function excerpt(style, seed, { kind = 'peak', bars = 8, solo = null, from = null } = {}) {
  const s = await ready(song(style, seed)), p = plan(s, bars);
  if (solo) s.solos = { [solo]: true };
  const [a, b, tail] = from != null ? [from, Math.min(p.bars, from + bars), 0.5] : kind === 'ending' ? [Math.max(0, Math.min(p.bars - 2, p.finalBar - 2)), p.bars, 8] : [p.peakBar, Math.min(p.bars, p.peakBar + bars), 0.5];
  const buf = await render(s, a, b, { tail, stableSums: true });
  const bytes = new Uint8Array(await encodeWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate).arrayBuffer());
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { bars: [a, b], secs: buf.length / buf.sampleRate, wav: btoa(bin) };
}

export const styleInfo = () => Object.fromEntries(Object.entries(STYLES).map(([id, v]) => [id, { name: v.name, family: v.family }]));
