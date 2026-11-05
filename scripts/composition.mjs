// Composition scorecard: plays every genre's full song through the real Sequencer with a note-logging
// engine and measures how the music develops: melody, harmony, voice leading, arrangement contrast.
// node scripts/composition.mjs [--assert] [--update] [--json out.json] [--style id]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLES, generate, arrangement, songChain, defaultState, applyOverrides } from '../js/state.js';
import { Sequencer, guitarGrip } from '../js/engine.js';
import { stabNotes, hookSnap } from '../js/harmony.js';

export const SEEDS = [101, 211, 307, 401, 503, 601, 701, 809];
const BASELINE = resolve(dirname(fileURLToPath(import.meta.url)), '../test/composition-baseline.json');
const DRUMS = new Set(['kick', 'snare', 'clap', 'ch', 'oh', 'ride', 'perc']);

// The same song main.js builds on GENERATE.
export function buildSong(style, seed) {
  const s = defaultState(), g = generate(style, seed);
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  applyOverrides(s, g, true);
  s.chainOn = true; s.chain = songChain(style, seed); s.current = 0;
  return s;
}

// Every musical event of one pass through the song, with the harmony it was played over.
export function playSong(s) {
  const log = [];
  const e = new Proxy({ stepDur: 0.125, harm: null }, {
    get(o, k) { return k in o ? o[k] : (...a) => { log.push({ k, a, harm: o.harm, step: o.step }); }; },
    set(o, k, v) { o[k] = v; return true; },
  });
  const seq = new Sequencer(e, s);
  const bars = seq.s.chain.length;
  for (let abs = 0; abs < bars * 16; abs++) seq.tick(abs, abs * 0.125);
  return { log, bars };
}

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2 : 0; };
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); const u = new Set([...A, ...B]).size; return u ? [...A].filter((x) => B.has(x)).length / u : 1; };
// Average distance each voice travels to the nearest note of the next chord (common tones cost 0).
const move = (a, b) => (a.reduce((c, m) => c + Math.min(...b.map((q) => Math.abs(q - m))), 0) / a.length
  + b.reduce((c, m) => c + Math.min(...a.map((q) => Math.abs(q - m))), 0) / b.length) / 2;

export function scoreSong(s) {
  const { log, bars } = playSong(s);
  const p = s.params.stab, guitar = Math.round(p.voice) === 8;
  const perBar = Array.from({ length: bars }, () => ({ hook: [], drums: [], events: 0 }));
  const voicings = [], harms = new Set();
  let grip = null;
  for (const L of log) {
    const bar = Math.floor(L.step / 16), B = perBar[bar];
    if (!B) continue;
    if (L.harm) harms.add(`${L.harm.r}:${L.harm.c}`);
    if (L.k === 'hook') {
      const [, , n, , , , strong, , up] = L.a;
      B.hook.push(`${L.step % 16}:${hookSnap(n, L.harm, p, strong, up)}`); B.events++;
    } else if (L.k === 'trigger' && L.a[0] === 'stab') {
      const { root, notes } = stabNotes(s, L.harm);
      const v = guitar && notes.length > 1 ? (grip = guitarGrip(root, notes.map((m) => m - root), grip)) : notes;
      if (!voicings.length || voicings[voicings.length - 1].join() !== v.join()) voicings.push(v);
      B.events++;
    } else if (L.k === 'trigger' && DRUMS.has(L.a[0])) {
      B.drums.push(`${L.a[0]}${L.step % 16}:${Math.round(L.a[2] * 4)}`); B.events++;
    } else if (L.k === 'acid' || L.k === 'lick' || L.k === 'vox') B.events++;
  }
  // Two-bar melody windows that contain hook notes, and how many still carry the motif's rhythm.
  const wins = [];
  for (let b = 0; b + 1 < bars; b += 2) if (perBar[b].hook.length || perBar[b + 1].hook.length) wins.push([...perBar[b].hook, ...perBar[b + 1].hook.map((x) => `+${x}`)]);
  const motif = wins.length ? wins.reduce((best, w) => (w.length > best.length ? w : best), wins[0]) : [];
  const onsets = (w) => w.map((x) => x.split(':')[0]);
  const recall = wins.length ? wins.filter((w) => jaccard(onsets(w), onsets(motif)) >= 0.4).length / wins.length : 1;
  const moves = voicings.slice(1).map((v, i) => move(voicings[i], v));
  const density = perBar.map((b) => b.events), mean = density.reduce((a, b) => a + b, 0) / bars;
  const sd = Math.sqrt(density.reduce((a, b) => a + (b - mean) ** 2, 0) / bars);
  return {
    bars,
    melodyWindows: new Set(wins.map((w) => w.join())).size,
    motifRecall: +recall.toFixed(3),
    chords: harms.size || 1,
    voiceMove: +(moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : 0).toFixed(2),
    contrast: +(mean ? sd / mean : 0).toFixed(3),
    drumBars: new Set(perBar.map((b) => b.drums.join())).size,
  };
}

const HIGHER = ['bars', 'melodyWindows', 'motifRecall', 'chords', 'contrast', 'drumBars'], LOWER = ['voiceMove'];
// Allowed slack before a change counts as a regression.
const TOL = { bars: 0, melodyWindows: 0.5, motifRecall: 0.05, chords: 0, contrast: 0.03, drumBars: 0.5, voiceMove: 0.15 };

export function runComposition(styles) {
  const out = {};
  for (const style of styles) {
    const rows = SEEDS.map((seed) => scoreSong(buildSong(style, seed)));
    out[style] = Object.fromEntries(Object.keys(rows[0]).map((k) => [k, +median(rows.map((r) => r[k])).toFixed(3)]));
  }
  return out;
}

export const loopStyles = () => Object.keys(STYLES).filter((id) => STYLES[id].family !== 'CLASSICAL' && id !== 'repertoire');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--style');
  const styles = at >= 0 ? [args[at + 1]] : loopStyles();
  const report = runComposition(styles);
  if (!args.includes('--quiet')) console.table(report);
  const jsonAt = args.indexOf('--json');
  if (jsonAt >= 0) { const f = resolve(args[jsonAt + 1]); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(report, null, 2) + '\n'); }
  if (args.includes('--update')) {
    writeFileSync(BASELINE, JSON.stringify(report, null, 2) + '\n');
    console.log(`wrote ${BASELINE}`);
  } else if (args.includes('--assert')) {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const fails = [];
    for (const [style, m] of Object.entries(report)) {
      const b = base[style];
      assert(b, `${style} has no composition baseline (run node scripts/composition.mjs --update)`);
      for (const k of HIGHER) if (m[k] < b[k] - TOL[k]) fails.push(`${style} ${k} ${m[k]} < baseline ${b[k]}`);
      for (const k of LOWER) if (m[k] > b[k] + TOL[k]) fails.push(`${style} ${k} ${m[k]} > baseline ${b[k]}`);
    }
    assert.equal(fails.length, 0, `composition regressed:\n  ${fails.join('\n  ')}`);
    console.log(`composition scorecard passed: ${Object.keys(report).length} genres x ${SEEDS.length} seeds`);
  }
}
