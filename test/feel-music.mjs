// A song's feeling (js/feel.js) drives its tempo, progression, mode and melody shape inside the genre's idiom;
// a song without one is written exactly as before.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { STYLES, MAJOR_STYLES, generate, songFeel, freshSong, songScale } from '../js/state.js';
import { FEELS } from '../js/feel.js';
import { CHORDS } from '../js/params.js';
import { FORMS } from '../js/classical.js';
import { songState } from '../js/song-spec.js';

const scaleOf = (style) => (MAJOR_STYLES.has(style) ? 'major' : 'minor');
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const seeds = Array.from({ length: 24 }, (_, i) => i + 1);
const minor = (h) => { const iv = CHORDS[h.c].iv; return iv.includes(3) && !iv.includes(4); };

// Without an assigned feeling, generation matches the main branch used for this change.
const h = createHash('sha256');
for (const style of Object.keys(STYLES)) for (const seed of [1, 7, 42, 1234, 99991]) h.update(style + JSON.stringify(generate(style, seed, scaleOf(style))));
assert.equal(h.digest('hex'), '37fe4a359fbffbee3d8e0eb0a19e0e0bb449337621d195ee07436192f04e6b15', 'no-feel generate() changed');
// Scores and the repertoire never take a feeling.
for (const style of [...Object.keys(FORMS), 'repertoire'].filter((s) => STYLES[s])) {
  assert.equal(songFeel(style, 3), null, style);
  assert.deepEqual(generate(style, 3, 'minor', { feel: 'joyful' }), generate(style, 3, 'minor'), style);
}

const songs = (style, feel) => seeds.map((seed) => generate(style, seed, scaleOf(style), { feel }));
const tempoPos = (style, feel) => { const [lo, hi] = STYLES[style].bpm; return mean(songs(style, feel).map((g) => (g.bpm - lo) / (hi - lo))); };
const melody = (g) => { const m = g.pattern.hook?.m || {}; return ['n', 'v', 'b'].flatMap((q) => m[q] || []); };
const register = (style, feel) => mean(songs(style, feel).flatMap((g) => melody(g).map((x) => x[2])));
const leap = (style, feel) => mean(songs(style, feel).flatMap((g) => {
  const m = g.pattern.hook?.m || {}, out = [];
  for (const q of ['n', 'v', 'b']) for (let i = 1; i < (m[q] || []).length; i++) if (m[q][i][4] === m[q][i - 1][4]) out.push(Math.abs(m[q][i][2] - m[q][i - 1][2]));
  return out;
}));

// Tempo: inside the style's range, near the feeling's spot in it.
for (const style of ['pop', 'rock', 'trap', 'hypnotic', 'deephouse', 'rnb']) {
  for (const feel of Object.keys(FEELS)) {
    const [lo, hi] = STYLES[style].bpm;
    for (const g of songs(style, feel)) assert.ok(g.bpm >= lo && g.bpm <= hi, `${style}/${feel} bpm ${g.bpm}`);
    assert.ok(Math.abs(tempoPos(style, feel) - FEELS[feel].tempo) < 0.12, `${style}/${feel} tempo ${tempoPos(style, feel)}`);
  }
  assert.ok(tempoPos(style, 'heartbroken') < tempoPos(style, 'joyful') - 0.3, style);
}

// Harmony: heartbreak opens on the minor chord and borrows the minor iv into the chorus; joy opens on the tonic.
const minorStart = (style, feel) => mean(songs(style, feel).map((g) => +minor(g.pattern.prog[0])));
assert.ok(minorStart('pop', 'heartbroken') > minorStart('pop', 'joyful') + 0.5, 'pop minor opening');
// Every deep house chorus opens on the minor-ninth tonic, so longing shows in more minor chords through it.
const minorShare = (style, feel) => mean(songs(style, feel).map((g) => mean(g.pattern.prog.map((h) => +minor(h)))));
assert.ok(minorShare('deephouse', 'longing') > minorShare('deephouse', 'joyful') + 0.1, 'deep house minor chords');
for (const style of ['pop', 'country', 'folk']) {
  const iv = (feel) => mean(songs(style, feel).map((g) => +g.pattern.sections.pre.some((x) => x.r === 5 && minor(x))));
  assert.equal(iv('heartbroken'), 1, `${style} heartbroken minor iv`);
  assert.equal(iv('joyful'), 0, `${style} joyful keeps IV`);
}
// Chords stay inside the genre's own pools.
for (const style of ['pop', 'rnb', 'trap', 'deephouse']) {
  const pool = new Set(songs(style, null).flatMap((g) => [g.pattern.prog, g.pattern.alt].map((p) => JSON.stringify(p))));
  for (const feel of Object.keys(FEELS)) for (const g of songs(style, feel)) assert.ok(pool.has(JSON.stringify(g.pattern.prog)), `${style}/${feel} out of idiom`);
}

// Mode: dark pedal techno goes phrygian (bII over the pedal, no natural 2nd in the tonic chord); major genres stay major.
for (const g of songs('hypnotic', 'dark')) {
  assert.equal(g.scale, 'phrygian');
  assert.ok(g.pattern.pedal.some((x) => x.r === 1), 'phrygian pedal shifts to bII');
  assert.ok(![2, 4].includes(Math.round(g.params.stab.chord)), 'tonic chord avoids the natural 2nd');
}
for (const style of MAJOR_STYLES) for (const feel of Object.keys(FEELS)) assert.equal(generate(style, 5, 'major', { feel }).scale, undefined, style);
assert.equal(generate('hypnotic', 5, 'minor', { feel: 'tense' }).scale, undefined);

// Melody: heartbreak and tenderness sing low, joy and euphoria high; excited feelings leap further.
for (const style of ['pop', 'rock', 'deephouse']) {
  assert.ok(register(style, 'heartbroken') < register(style, 'joyful') - 1.5, `${style} register`);
  assert.ok(register(style, 'tender') < register(style, 'euphoric') - 1.5, `${style} register`);
  assert.ok(leap(style, 'joyful') > leap(style, 'heartbroken'), `${style} leaps`);
}
// A dark pedal song's automatic phrygian does not carry into the next song.
{
  let seed = 1; while (songFeel('hypnotic', seed) !== 'dark') seed++;
  let next = 1; while (songFeel('acid', next) === 'dark') next++;
  const dark = freshSong('hypnotic', seed);
  assert.equal(dark.scale, 'phrygian');
  assert.equal(songScale(dark), 'minor');
  assert.equal(freshSong('acid', next, { base: dark }).scale, 'minor');
  assert.equal(songScale({ feel: 'tense', scale: 'phrygian' }), 'phrygian');
}
console.log('feel music: ok', { pop: Object.fromEntries(['heartbroken', 'longing', 'tender', 'joyful', 'euphoric'].map((f) => [f, { tempo: +tempoPos('pop', f).toFixed(2), register: +register('pop', f).toFixed(2), leap: +leap('pop', f).toFixed(2) }])) });

// A feeling the listener asked for (a chip on Create) is the one the music plays, not just the label.
{
  let seed = 1; while (songFeel('pop', seed) === 'euphoric') seed++;
  const asked = freshSong('pop', seed, { feel: 'euphoric' });
  assert.equal(asked.feel, 'euphoric');
  assert.equal(songFeel('pop', seed, 'euphoric'), 'euphoric');
  assert.equal(songFeel('nocturne', seed, 'euphoric'), null);
  assert.equal(asked.bpm, generate('pop', seed, 'major', { feel: 'euphoric' }).bpm);
  assert.notEqual(JSON.stringify(asked.patterns), JSON.stringify(freshSong('pop', seed).patterns));
}

for (const style of ['swing', 'modal', 'jazzfunk']) {
  const varied = Array.from({ length: 32 }, (_, i) => {
    const seed = Math.imul(i + 1, 0x9e3779b1);
    const bright = generate(style, seed, 'minor', { feel: 'joyful' }).pattern;
    const sad = generate(style, seed, 'minor', { feel: 'heartbroken' }).pattern;
    return JSON.stringify(bright.prog) !== JSON.stringify(sad.prog) && JSON.stringify(bright.hook.m.n) !== JSON.stringify(sad.hook.m.n);
  });
  assert(varied.some(Boolean), `${style} changes both harmony and melody without relying on tempo`);
}
for (const seed of [11, 42, 77]) {
  const bossa = (feel) => freshSong('bossa', seed, { feel });
  const { bpm, chain, patterns } = bossa('joyful');
  const sad = bossa('heartbroken');
  assert.equal(sad.bpm, bpm);
  assert.equal(sad.chain, chain);
  assert.deepEqual(sad.patterns, patterns, 'mood leaves the authored Bossa section charts and motifs intact');
}
{
  const spec = { style: 'pop', bpm: 110, scale: 'major', sections: [{ role: 'verse', bars: 16 }, { role: 'drop', bars: 16 }] };
  const state = (feel, authored = {}) => songState({ ...spec, ...authored, feel }, 1).state;
  const happy = state('joyful'), sad = state('heartbroken');
  assert.equal(happy.bpm, sad.bpm);
  assert.equal(happy.scale, sad.scale);
  assert.notDeepEqual(happy.patterns[2].prog, sad.patterns[2].prog);
  assert.notDeepEqual(happy.patterns[2].hook.m, sad.patterns[2].hook.m);
  const written = { hook: { contour: [0, 2, 4, 2, 0] }, sections: spec.sections.map(s => ({ ...s, chords: ['I', 'V', 'vi', 'IV'] })) };
  assert.deepEqual(state('joyful', written).patterns, state('heartbroken', written).patterns, 'feel leaves authored backing and melody intact');
}
{
  const sections = [{ role: 'verse', bars: 16 }];
  for (const i of seeds) for (const feel of ['joyful', 'heartbroken']) {
    const seed = Math.imul(i, 0x9e3779b1) >>> 0;
    for (const scale of ['major', 'minor']) {
      const { state } = songState({ style: 'swing', key: 0, scale, feel, sections }, seed);
      assert.equal(state.scale, scale);
      assert.equal(state.patterns[2].prog[0].c === 20, scale === 'minor', 'swing backing follows the requested mode');
    }
    for (const scale of ['dorian', 'mixolydian']) {
      const funk = generate('jazzfunk', seed, scale, { feel, keepScale: true });
      assert.equal(funk.scale, scale);
      assert.equal(funk.pattern.prog[0].c === 16, scale === 'dorian', 'Jazz-Funk backing follows the requested mode');
    }
    const modal = generate('modal', seed, 'phrygian', { feel, keepScale: true });
    assert.deepEqual(modal.pattern.prog, generate('modal', seed).pattern.prog, 'the feel does not switch progressions outside a supported mode');
  }
}
