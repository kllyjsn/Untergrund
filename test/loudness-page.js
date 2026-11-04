// Loaded inside headless Chrome by scripts/loudness.mjs and test/loudness.mjs: builds a generated song the way
// NEW SET does, renders it with the real offline engine and meters the master output.
import { defaultState, generate, applyOverrides, arrangement, songChain } from '/js/state.js';
import { renderBars } from '/js/render.js';
import { songBars } from '/js/midi.js';
import { loudness, truePeak } from '/js/loudness.js';

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
export async function measure(style, seed, { bars = 0, startBar = 0 } = {}) {
  const s = song(style, seed), total = songBars(s), n = bars ? Math.min(bars, total) : total;
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
    style, seed, bars: n, secs: buf.length / buf.sampleRate,
    lufs: L.integrated, tp: 20 * Math.log10(truePeak(ch)),
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
