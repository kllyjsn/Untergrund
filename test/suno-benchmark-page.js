// Loaded inside headless Chrome by scripts/suno-benchmark.mjs: renders one whole generated song (the NEW SET path of
// test/audio-quality-page.js) and measures it with the lab's reference-free metrics. The WAV stays in the page and is
// read back in chunks, so a 3-minute song never crosses CDP as one 40 MB string.
import { song, plan, render } from '/test/audio-quality-page.js';
import { loadPiece } from '/js/repertoire.js';
import { trimTail } from '/js/render.js';
import { encodeWav } from '/js/dsp.js';
import { GM_DRUMS } from '/js/midi.js';
import { analyzePcm, lufs } from '/js/lab-metrics.js';

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2 : 0; };
let wav = null;

// Note-level facts every genre has, scores included: how busy and how layered a bar is, and how much pitch material
// the song uses (distinct pitch classes, the melodic span of its highest part).
function notesFacts(p) {
  const melodic = Object.entries(p.c.notes).filter(([id, ns]) => !GM_DRUMS[id] && ns.some((n) => Number.isFinite(n.m) && n.m > 0));
  const pcs = new Set(melodic.flatMap(([, ns]) => ns.filter((n) => n.m > 0).map((n) => Math.round(n.m) % 12)));
  // The lead: the hook when the song has one, else the highest-sitting melodic part.
  const parts = melodic.map(([id, ns]) => [id, ns.filter((n) => n.m > 0).map((n) => n.m)]).sort((a, b) => median(b[1]) - median(a[1]));
  const top = parts.find(([id]) => id === 'hook') || parts[0];
  return {
    parts: Object.keys(p.c.notes).length,
    notesPerBar: +median(p.barNotes.notes).toFixed(1),
    partsPerBar: +median(p.barNotes.voices).toFixed(1),
    pitchClasses: pcs.size,
    leadRange: top ? Math.round(Math.max(...top[1]) - Math.min(...top[1])) : 0,
  };
}

export async function full(style, seed) {
  const t0 = performance.now(), s = song(style, seed), piece = s.patterns.find((x) => x.score)?.score?.piece;
  if (piece) await loadPiece(piece);
  const p = plan(s);
  const buf = trimTail(await render(s, 0, p.bars, { tail: 8 }));
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  const audio = { ...analyzePcm(ch, buf.sampleRate), lufs: +lufs(ch, buf.sampleRate).toFixed(2) };
  wav = new Uint8Array(await encodeWav(ch, buf.sampleRate).arrayBuffer());
  return { style, seed, bpm: s.bpm, key: s.key, scale: s.scale, bars: p.bars, secs: +(buf.length / buf.sampleRate).toFixed(2), chain: s.chain, sections: p.sections.map(({ label, from, to }) => ({ label, from, to })), notes: notesFacts(p), audio, renderMs: Math.round(performance.now() - t0), bytes: wav.length };
}

export function chunk(from, size) {
  const bytes = wav.subarray(from, from + size);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
