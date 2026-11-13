// Composition scorecard: plays every genre's full song through the real Sequencer with a note-logging
// engine and measures how the music develops: melody, harmony, voice leading, arrangement contrast.
// node scripts/composition.mjs [--assert] [--update] [--json out.json] [--style id]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLES, MAJOR_STYLES, generate, arrangement, songChain, defaultState, applyOverrides } from '../js/state.js';
import { Sequencer, guitarGrip } from '../js/engine.js';
import { stabNotes, hookSnap, voiceLead } from '../js/harmony.js';

export const SEEDS = [101, 211, 307, 401, 503, 601, 701, 809];
const BASELINE = resolve(dirname(fileURLToPath(import.meta.url)), '../test/composition-baseline.json');
const DRUMS = new Set(['kick', 'snare', 'clap', 'ch', 'oh', 'ride', 'perc']);

// The same song main.js builds on GENERATE.
export function buildSong(style, seed) {
  const s = defaultState();
  if (MAJOR_STYLES.has(style)) s.scale = 'major';
  const g = generate(style, seed, s.scale);
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  applyOverrides(s, g, true);
  s.chainOn = true; s.chain = songChain(style, seed); s.ending = true; s.current = 0;
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
  return { log, bars, seq };
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
  let grip = null, last = null;
  const lead = [], stepDur = 0.125;
  for (const L of log) {
    const bar = Math.floor(L.step / 16), B = perBar[bar];
    if (!B) continue;
    if (L.harm) harms.add(`${L.harm.r}:${L.harm.c}`);
    if (L.k === 'hook' && L.a[9]?.counter) continue;
    if (L.k === 'hook') {
      const [, , n, d, , , strong, , up, x] = L.a, snapped = hookSnap(n, L.harm, p, strong, up);
      B.hook.push(`${L.step % 16}:${snapped}`); B.events++;
      if (!x?.harm) lead.push([L.step, Math.max(1, Math.round(d / stepDur)), snapped]);
    } else if (L.k === 'trigger' && L.a[0] === 'stab') {
      const { root, notes, home } = stabNotes(s, L.harm);
      const led = last = voiceLead(notes, last, home);
      const v = guitar && notes.length > 1 ? (grip = guitarGrip(root, notes.map((m) => m - root), grip)) : led;
      if (!voicings.length || voicings[voicings.length - 1].join() !== v.join()) voicings.push(v);
      B.events++;
    } else if (L.k === 'trigger' && DRUMS.has(L.a[0])) {
      B.drums.push(`${L.a[0]}${L.step % 16}:${Math.round(L.a[2] * 4)}`); B.events++;
    } else if (L.k === 'acid' || L.k === 'lick' || L.k === 'vox') B.events++;
  }
  // Two-bar melody windows that contain hook notes, and how many still carry the motif's rhythm.
  const wins = [];
  for (let b = 0; b + 1 < bars; b += 2) if (perBar[b].hook.length || perBar[b + 1].hook.length) wins.push([...perBar[b].hook, ...perBar[b + 1].hook.map((x) => `+${x}`)]);
  // The motif is the window heard most often; a variant still recalls it if its onset rhythm matches,
  // allowing an eighth-note displacement.
  const onsets = (w) => w.map((x) => { const [st] = x.split(':'); return st[0] === '+' ? 16 + +st.slice(1) : +st; });
  const count = new Map(); for (const w of wins) count.set(w.join(), (count.get(w.join()) || 0) + 1);
  const motif = wins.find((w) => count.get(w.join()) === Math.max(...count.values())) || [];
  const like = (w) => Math.max(...[-2, 0, 2].map((d) => jaccard(onsets(w).map((x) => x + d), onsets(motif))));
  const recall = wins.length ? wins.filter((w) => like(w) >= 0.4).length / wins.length : 1;
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
    ...melodyShape(lead),
  };
}

// The lead as a singer would phrase it: a rest of a beat or more is a breath that ends a phrase.
// phraseBars: mean phrase length; peakAt: where the phrase's highest note falls (0 start, 1 end);
// restsPerPhrase: rests of an 8th or more inside a phrase plus the breath after it; stepShare: moves of 1-2 semitones.
export function melodyShape(lead) {
  const phrases = [];
  let cur = null, end = -1e9;
  for (const [at, d, n] of lead.sort((a, b) => a[0] - b[0])) {
    if (!cur || at - end >= 4) phrases.push((cur = { notes: [], rests: 1 }));
    else if (at - end >= 2) cur.rests++;
    if (cur.notes.at(-1)?.[0] === at) continue;
    cur.notes.push([at, n]); end = Math.max(end, at + d); cur.end = end;
  }
  const full = phrases.filter((q) => q.notes.length >= 4);
  if (!full.length) return { phraseBars: 0, peakAt: 0, restsPerPhrase: 0, stepShare: 0 };
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  let steps = 0, moves = 0;
  for (const q of full) for (let j = 1; j < q.notes.length; j++) {
    const iv = Math.abs(q.notes[j][1] - q.notes[j - 1][1]);
    if (iv) { moves++; if (iv <= 2) steps++; }
  }
  return {
    phraseBars: +mean(full.map((q) => (q.end - q.notes[0][0]) / 16)).toFixed(2),
    peakAt: +mean(full.map((q) => {
      const top = Math.max(...q.notes.map((x) => x[1])), j = q.notes.findIndex((x) => x[1] === top);
      return (q.notes[j][0] - q.notes[0][0]) / Math.max(1, q.notes.at(-1)[0] - q.notes[0][0]);
    })).toFixed(2),
    restsPerPhrase: +mean(full.map((q) => q.rests)).toFixed(2),
    stepShare: +(moves ? steps / moves : 0).toFixed(2),
  };
}

const HIGHER = ['bars', 'melodyWindows', 'motifRecall', 'chords', 'contrast', 'drumBars', 'phraseBars', 'stepShare'], LOWER = ['voiceMove'], NEAR = ['peakAt', 'restsPerPhrase'];
// Allowed slack before a change counts as a regression.
const TOL = { bars: 0, melodyWindows: 0.5, motifRecall: 0.05, chords: 0, contrast: 0.03, drumBars: 0.5, voiceMove: 0.15, phraseBars: 0.25, stepShare: 0.05, peakAt: 0.1, restsPerPhrase: 0.5 };

export function runComposition(styles) {
  const out = {};
  for (const style of styles) {
    const rows = SEEDS.map((seed) => scoreSong(buildSong(style, seed)));
    out[style] = Object.fromEntries(Object.keys(rows[0]).map((k) => [k, +median(rows.map((r) => r[k])).toFixed(3)]));
  }
  return out;
}

// Prompt to song vs plain GENERATE: the same style and seeds, once as written by the prompt's spec.
export const PROMPTS = ['melancholic deep house for a sunrise drive, builds to a big euphoric drop', 'dark techno for a warehouse at 4am', 'happy afrobeats summer party',
  'dreamy ambient for floating in space', 'tense drum and bass chase scene', 'nostalgic synthwave night drive', 'lofi beat for a rainy study night', 'uplifting trance anthem for the sunrise set'];
async function promptReport() {
  const { localSpec, songState } = await import('../js/song-spec.js');
  const mean = (rows) => Object.fromEntries(Object.keys(rows[0]).map((k) => [k, +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(3)]));
  const all = { plain: [], prompt: [] }, table = {};
  for (const p of PROMPTS) {
    const plain = [], prompt = [];
    for (const seed of SEEDS) { const sp = localSpec(p, { seed }); plain.push(scoreSong(buildSong(sp.style, seed))); prompt.push(scoreSong(songState(sp, seed).state)); }
    all.plain.push(...plain); all.prompt.push(...prompt);
    table[`${p.slice(0, 28)} (plain)`] = mean(plain); table[`${p.slice(0, 28)} (prompt)`] = mean(prompt);
  }
  table['ALL (plain)'] = mean(all.plain); table['ALL (prompt)'] = mean(all.prompt);
  console.table(table);
}
export const loopStyles = () => Object.keys(STYLES).filter((id) => STYLES[id].family !== 'CLASSICAL' && id !== 'repertoire');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--style');
  if (args.includes('--prompts')) { await promptReport(); process.exit(0); }
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
      for (const k of NEAR) if (b[k] !== undefined && Math.abs(m[k] - b[k]) > TOL[k]) fails.push(`${style} ${k} ${m[k]} moved from baseline ${b[k]}`);
    }
    assert.equal(fails.length, 0, `composition regressed:\n  ${fails.join('\n  ')}`);
    console.log(`composition scorecard passed: ${Object.keys(report).length} genres x ${SEEDS.length} seeds`);
  }
}
