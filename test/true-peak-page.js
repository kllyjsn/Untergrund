// Loaded inside headless Chrome by scripts/true-peak.mjs: renders a whole generated song the way NEW SET builds it
// (test/audio-quality-page.js song()), with the deep tier's look-ahead scheduling, and meters its 4x true peak.
import { song, plan, render } from '/test/audio-quality-page.js';
import { loadPiece } from '/js/repertoire.js';
import { truePeak } from '/js/loudness.js';

const START = 0.05, db = (x) => 20 * Math.log10(x || 1e-10);

export async function songPeak(style, seed, { tail = 8 } = {}) {
  const t0 = performance.now(), s = song(style, seed), piece = s.patterns.find((p) => p.score)?.score?.piece;
  if (piece) await loadPiece(piece);
  const p = plan(s), buf = await render(s, 0, p.bars, { tail }), fs = buf.sampleRate;
  const ch = [buf.getChannelData(0), buf.getChannelData(1)], tp = db(truePeak(ch));
  // Where it peaks: the loudest bar (the tail counts as the last bar).
  let bar = 0, barTp = -Infinity;
  for (let b = 0; b < p.bars; b++) {
    const i0 = Math.max(0, Math.floor((START + p.barTimes[b]) * fs) - 16), i1 = b + 1 < p.bars ? Math.ceil((START + p.barTimes[b + 1]) * fs) + 16 : buf.length;
    const v = db(truePeak(ch.map((x) => x.subarray(i0, i1))));
    if (v > barTp) { barTp = v; bar = b; }
  }
  return { style, seed, bars: p.bars, secs: +(buf.length / fs).toFixed(1), tp: +tp.toFixed(3), bar, at: +p.barTimes[bar].toFixed(1), section: s.chain[bar] || null, renderMs: Math.round(performance.now() - t0) };
}
