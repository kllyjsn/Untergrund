// Composition scorecard: plays every genre's full song through the real Sequencer with a note-logging
// engine and measures how the music develops: melody, harmony, voice leading, arrangement contrast, and how
// distinct its sections are (verse vs chorus chords, register and energy, the pre-chorus lift, the bridge).
// node scripts/composition.mjs [--assert] [--update] [--json out.json] [--style id]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLES, generate, arrangement, songChain, defaultState, applyOverrides } from '../js/state.js';
import { Sequencer, guitarGrip } from '../js/engine.js';
import { stabNotes, hookSnap, voiceLead } from '../js/harmony.js';

export const SEEDS = [101, 211, 307, 401, 503, 601, 701, 809];
const BASELINE = resolve(dirname(fileURLToPath(import.meta.url)), '../test/composition-baseline.json');
const DRUMS = new Set(['kick', 'snare', 'clap', 'ch', 'oh', 'ride', 'perc']);
// The section each arrangement slot plays when a pattern does not name one (club forms: B build, G drop).
const ROLE = ['intro', 'pre', 'verse', 'fill', 'bridge', 'bridge', 'chorus', 'chorus'];

// The same song main.js builds on GENERATE.
export function buildSong(style, seed) {
  const s = defaultState(), g = generate(style, seed);
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
  const perBar = Array.from({ length: bars }, (_, b) => {
    const i = 'ABCDEFGH'.indexOf(s.chain[b]);
    return { hook: [], drums: [], events: 0, notes: [], chords: new Set(), kicks: 0, root: null, sec: s.patterns[i]?.sec || ROLE[i] };
  });
  const voicings = [], harms = new Set();
  let grip = null, last = null;
  for (const L of log) {
    const bar = Math.floor(L.step / 16), B = perBar[bar];
    if (!B) continue;
    if (L.harm) { harms.add(`${L.harm.r}:${L.harm.c}`); B.chords.add(`${L.harm.r}:${L.harm.c}`); B.root ??= L.harm.r; }
    if (L.k === 'hook' && L.a[9]?.counter) continue;
    if (L.k === 'hook') {
      const [, , n, , , , strong, , up] = L.a;
      const m = hookSnap(n, L.harm, p, strong, up);
      B.hook.push(`${L.step % 16}:${m}`); B.notes.push(m); B.events++;
    } else if (L.k === 'trigger' && L.a[0] === 'stab') {
      const { root, notes, home } = stabNotes(s, L.harm);
      const led = last = voiceLead(notes, last, home);
      const v = guitar && notes.length > 1 ? (grip = guitarGrip(root, notes.map((m) => m - root), grip)) : led;
      if (!voicings.length || voicings[voicings.length - 1].join() !== v.join()) voicings.push(v);
      B.events++;
    } else if (L.k === 'trigger' && DRUMS.has(L.a[0])) {
      B.drums.push(`${L.a[0]}${L.step % 16}:${Math.round(L.a[2] * 4)}`); B.events++;
      if (L.a[0] === 'kick') B.kicks++;
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
    ...sections(perBar),
    melodyWindows: new Set(wins.map((w) => w.join())).size,
    motifRecall: +recall.toFixed(3),
    chords: harms.size || 1,
    voiceMove: +(moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : 0).toFixed(2),
    contrast: +(mean ? sd / mean : 0).toFixed(3),
    drumBars: new Set(perBar.map((b) => b.drums.join())).size,
  };
}

// Section contrast, from the bars each section plays:
// verseChorus  share of chorus chords the verse does not play (0 = same changes, or a verse over a pedal),
// chorusLift   semitones the chorus melody sits above the verse (median note), chorusPeak the same for the top note,
// chorusEnergy chorus events per bar over the verse's (fuller drums, more stabs),
// preLift      per pre-chorus: 1/3 each for a melody that climbs, a kick held back from the chorus and a dominant at the end,
// bridgeAway   share of bridge chords heard in neither verse nor chorus.
function sections(perBar) {
  const of = (k) => perBar.filter((b) => b.sec === k), all = (bs, f) => bs.flatMap(f);
  const verse = of('verse'), chorus = of('chorus'), bridge = of('bridge');
  const chords = (bs) => new Set(all(bs, (b) => [...b.chords]));
  const V = chords(verse), C = chords(chorus), Bd = chords(bridge);
  const vn = all(verse, (b) => b.notes), cn = all(chorus, (b) => b.notes);
  const perBarOf = (bs, f) => (bs.length ? bs.reduce((a, b) => a + f(b), 0) / bs.length : 0);
  const pres = [];
  perBar.forEach((b, i) => { if (b.sec === 'pre' && perBar[i - 1]?.sec !== 'pre') pres.push([]); if (b.sec === 'pre') pres[pres.length - 1].push(b); });
  const ck = perBarOf(chorus, (b) => b.kicks);
  const top = (bs) => Math.max(-Infinity, ...all(bs, (b) => b.notes));
  const lift = pres.map((bs) => {
    const h = bs.length >> 1, climb = bs.length > 1 && top(bs.slice(h)) > top(bs.slice(0, h)) ? 1 : 0;
    return (climb + (perBarOf(bs, (b) => b.kicks) < ck ? 1 : 0) + (bs[bs.length - 1].root === 7 ? 1 : 0)) / 3;
  });
  const has = vn.length && cn.length;
  return {
    verseChorus: +(C.size && V.size ? [...C].filter((x) => !V.has(x)).length / C.size : 0).toFixed(3),
    chorusLift: has ? median(cn) - median(vn) : 0,
    chorusPeak: has ? Math.max(...cn) - Math.max(...vn) : 0,
    chorusEnergy: +(verse.length && chorus.length ? perBarOf(chorus, (b) => b.events) / Math.max(1, perBarOf(verse, (b) => b.events)) : 1).toFixed(3),
    preLift: +(lift.length ? lift.reduce((a, b) => a + b, 0) / lift.length : 0).toFixed(3),
    bridgeAway: +(Bd.size ? [...Bd].filter((x) => !V.has(x) && !C.has(x)).length / Bd.size : 0).toFixed(3),
  };
}

const HIGHER = ['bars', 'melodyWindows', 'motifRecall', 'chords', 'contrast', 'drumBars', 'verseChorus', 'chorusLift', 'chorusPeak', 'chorusEnergy', 'preLift', 'bridgeAway'], LOWER = ['voiceMove'];
// Allowed slack before a change counts as a regression.
const TOL = { bars: 0, melodyWindows: 0.5, motifRecall: 0.05, chords: 0, contrast: 0.03, drumBars: 0.5, voiceMove: 0.15,
  verseChorus: 0.05, chorusLift: 0.5, chorusPeak: 0.5, chorusEnergy: 0.05, preLift: 0.05, bridgeAway: 0.05 };

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
    }
    assert.equal(fails.length, 0, `composition regressed:\n  ${fails.join('\n  ')}`);
    console.log(`composition scorecard passed: ${Object.keys(report).length} genres x ${SEEDS.length} seeds`);
  }
}
