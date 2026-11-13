// Loaded inside headless Chrome by scripts/loudness.mjs and test/loudness.mjs: builds a generated song the way
// GENERATE does, renders it with the real offline engine and meters the master output.
import { defaultState, generate, applyOverrides, arrangement, songChain, STYLES } from '/js/state.js';
import { renderBars } from '/js/render.js';
import { songBars } from '/js/midi.js';
import { loadPiece, PIECE } from '/js/repertoire.js';
import { loudness, truePeak } from '/js/loudness.js';
import { kHops, loudnessRange } from '/js/audio-quality.js';
import { localSpec, songState } from '/js/song-spec.js';

export function song(style, seed) {
  const s = defaultState();
  s.scale = style === 'euphoric' ? 'major' : 'minor';
  const g = generate(style, seed, s.scale);
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  s.key = g.key;
  applyOverrides(s, g);
  s.chainOn = true;
  s.chain = songChain(style, seed);
  if (g.pattern.score) s.bpm = g.bpm;
  s.artist = { name: 'UNTERGRUND', title: 'meter', style, seed, created: '' };
  return s;
}

// bars: render only that many bars (default the whole song) starting at startBar of the chain.
// Taps the limiter's input and output next to the master output to measure its gain reduction.
// A REPERTOIRE song playing one chosen masterwork, as when it is picked from the concert hall.
export function pieceSong(piece, seed = 11) {
  const s = song('repertoire', seed);
  for (const q of s.patterns) if (q.score) q.score = { piece };
  s.bpm = PIECE[piece].bpm; s.key = 0;
  return s;
}

// The same style and seed written by the song builder (Describe: "<style> song"), as ctx.song does.
export function builderSong(style, seed) {
  return songState(localSpec(`${STYLES[style].name.toLowerCase()} song`, { style }), seed, defaultState()).state;
}

export async function measure(style, seed, { bars = 0, startBar = 0, piece: only = '', builder = false } = {}) {
  const s = only ? pieceSong(only, seed) : builder ? builderSong(style, seed) : song(style, seed), piece = s.patterns.find((p) => p.score)?.score?.piece;
  // A REPERTOIRE score is fetched on demand; until it arrives songBars() sees its one silent waiting bar.
  if (piece) await loadPiece(piece);
  const total = songBars(s), n = bars ? Math.min(bars, total) : total;
  const buf = await renderBars(s, n, {
    startBar, channels: 6,
    onEngine: (e) => {
      const ctx = e.ctx, m = ctx.createChannelMerger(6), d = ctx.destination;
      d.channelCount = 6; d.channelCountMode = 'explicit'; d.channelInterpretation = 'discrete';
      e.out.disconnect();
      [e.out, e.limIn, e.limiter].forEach((node, k) => { const sp = ctx.createChannelSplitter(2); node.connect(sp); sp.connect(m, 0, 2 * k); sp.connect(m, 1, 2 * k + 1); });
      m.connect(d);
    },
  });
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  const L = loudness(ch, buf.sampleRate);
  // Limiter gain reduction in 10 ms windows while the music plays (dB, <= 0).
  const [iL, iR, oL, oR] = [2, 3, 4, 5].map((k) => buf.getChannelData(k)), w = Math.round(buf.sampleRate / 100), gr = [];
  // DynamicsCompressorNode delays its output by a fixed 6 ms look-ahead; line the input up with it.
  const d = Math.round(buf.sampleRate * 0.006);
  for (let i = d; i + w <= iL.length; i += w) {
    let a = 0, b = 0;
    for (let j = i; j < i + w; j++) { a += iL[j - d] * iL[j - d] + iR[j - d] * iR[j - d]; b += oL[j] * oL[j] + oR[j] * oR[j]; }
    const blk = L.blocks[Math.min(L.blocks.length - 1, Math.floor(i / (buf.sampleRate / 10)))];
    if (a > 1e-7 * w && blk > L.relativeGate) gr.push(10 * Math.log10(b / a));
  }
  // The node adds its own fixed make-up gain, so out/in is that gain minus the reduction: take the
  // uncompressed level (the loudest 0.5% of out/in) as 0 dB.
  const top = [...gr].sort((x, y) => y - x)[Math.floor(gr.length * 0.005)] ?? 0;
  for (let k = 0; k < gr.length; k++) gr[k] = Math.min(0, gr[k] - top);
  const sorted = [...gr].sort((x, y) => x - y), jumps = gr.slice(1).map((v, i) => Math.abs(v - gr[i])).sort((x, y) => x - y);
  return {
    style, seed, piece: piece || '', bars: n, secs: buf.length / buf.sampleRate, chain: s.chain,
    lufs: L.integrated, lra: loudnessRange(kHops(ch, buf.sampleRate)), tp: 20 * Math.log10(truePeak(ch)),
    grMean: gr.reduce((a, v) => a + v, 0) / (gr.length || 1), grDeep: sorted[Math.floor(sorted.length * 0.01)] || 0,
    grJump: jumps[Math.floor(jumps.length * 0.99)] || 0,
  };
}

// The fast check (test/loudness.mjs): two bars of the song's peak section at 24 kHz. Compared against the same
// window recorded next to the full-song table in test/loudness-baseline.json, it predicts the full-song loudness.
export const WINDOW = { seed: 42, bars: 2, sampleRate: 24000 };
export async function windowLoudness(style) {
  const s = song(style, WINDOW.seed), g = s.chain.indexOf('G');
  const buf = await renderBars(s, WINDOW.bars, { sampleRate: WINDOW.sampleRate, tail: 0.5, startBar: Math.max(0, g) });
  return loudness([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate).integrated;
}

// The same fast check for each masterwork: two bars from the middle of the score.
export async function pieceWindow(piece) {
  const s = pieceSong(piece);
  await loadPiece(piece);
  const total = songBars(s), buf = await renderBars(s, WINDOW.bars, { sampleRate: WINDOW.sampleRate, tail: 0.5, startBar: Math.floor(total / 2) });
  return loudness([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate).integrated;
}

// The end of a classical export (test/classical-ending.mjs): the last bars through the real export path (renderBars'
// default tail, trimmed), as 100 ms RMS windows (dBFS) counted back from the end of the file.
export async function exportEnding(style, seed, piece = '') {
  const s = piece ? pieceSong(piece, seed) : song(style, seed);
  const id = s.patterns.find((p) => p.score)?.score?.piece;
  if (id) await loadPiece(id);
  const total = songBars(s), bars = Math.min(total, 3), buf = await renderBars(s, bars, { startBar: total - bars });
  const ch = [buf.getChannelData(0), buf.getChannelData(1)], w = Math.round(buf.sampleRate / 10), env = [];
  for (let end = buf.length; end - w >= 0 && env.length < 40; end -= w) {
    let e = 0;
    for (const d of ch) for (let i = end - w; i < end; i++) e += d[i] * d[i];
    env.unshift(10 * Math.log10(e / (2 * w) + 1e-24));
  }
  return { style, seed, piece: id || '', secs: buf.length / buf.sampleRate, env };
}

// Chorus minus verse short-term loudness (dB): median 3 s loudness over windows wholly inside a verse (C) and
// wholly inside a chorus (G) of the full song, mastered, at 24 kHz.
export async function sectionLift(style, seed) {
  // Render from the bar before the first verse to the end of the chorus that follows it (the whole song if there is none).
  const s = song(style, seed), chain = s.chain, c0 = chain.indexOf('C'), g0 = chain.indexOf('G', c0 + 1);
  let g1 = g0; while (g0 > 0 && chain[g1] === 'G') g1++;
  const from = c0 >= 0 && g0 > 0 ? Math.max(0, c0 - 1) : 0, to = from ? g1 : songBars(s);
  const buf = await renderBars(s, to - from, { sampleRate: 24000, tail: 0.5, startBar: from });
  const E = loudness([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate).blocks.map((x) => 10 ** ((x + 0.691) / 10));
  const bar = 240 / s.bpm, sec = { C: [], G: [] }, med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  for (let j = 0; j + 27 <= E.length; j++) {
    const b0 = from + Math.floor((j * 0.1 - 0.05) / bar), b1 = from + Math.floor((j * 0.1 + 2.95) / bar);
    if (b0 < from || b1 >= to || !sec[chain[b0]] || [...chain.slice(b0, b1 + 1)].some((x) => x !== chain[b0])) continue;
    sec[chain[b0]].push(-0.691 + 10 * Math.log10(E.slice(j, j + 27).reduce((a, b) => a + b, 0) / 27));
  }
  return med(sec.G) - med(sec.C);
}

// The song builder's peak section against GENERATE's for the same style and seed (test/loudness.mjs): the two
// share make-up gain and patterns, so a builder change that runs hotter or quieter shows up here.
export async function builderWindow(style, seed = WINDOW.seed, bars = 4) {
  const one = async (s) => {
    const buf = await renderBars(s, bars, { sampleRate: WINDOW.sampleRate, tail: 0.5, startBar: Math.max(0, s.chain.indexOf('G')) });
    const ch = [buf.getChannelData(0), buf.getChannelData(1)];
    return { lufs: loudness(ch, buf.sampleRate).integrated, tp: 20 * Math.log10(truePeak(ch)) };
  };
  return { style, seed, gen: await one(song(style, seed)), builder: await one(builderSong(style, seed)) };
}
