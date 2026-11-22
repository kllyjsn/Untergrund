import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generate, defaultState, applyOverrides, applySongPlan, sanitize, arrangement, songChain, INSTRUMENTS } from '../js/state.js';
import { patternAt } from '../js/scope.js';
import { FUNK_HANDS, FUNK_VOX, funkHandBar } from '../js/baile.js';
import { createTimelineRecorder, normalizeTimeline, stateAt } from '../js/set-timeline.js';
import './bossa.mjs';
import './jazzfunk.mjs';

for (const seed of [1, 3, 5, 42]) {
  const g = generate('bailefunk', seed), s = defaultState();
  s.patterns = arrangement(g.pattern, seed, true); applyOverrides(s, g);
  s.chainOn = true; s.chain = songChain('bailefunk', seed); s.artist = { style: 'bailefunk', seed };
  const rec = createTimelineRecorder({ state: s, style: 'bailefunk', startsAt: 0 });
  const replay = stateAt(normalizeTimeline(JSON.parse(JSON.stringify(rec.finish(1000)))), 0).state;
  const loaded = sanitize(JSON.parse(JSON.stringify(s)));
  for (let bar = 0; bar < s.chain.length; bar++) {
    const scene = 'ABCDEFGH'.indexOf(s.chain[bar]), p = patternAt(s.patterns[scene], bar);
    assert.deepEqual(p.steps.perc, FUNK_HANDS[funkHandBar(bar)], 'written hands answer over two bars and turn at phrase ends');
    if (s.patterns[scene].steps.vox.some(Boolean)) assert.deepEqual(p.steps.vox, FUNK_VOX[bar % 2]);
    for (const id of ['perc', 'vox']) {
      assert(p.steps[id].every(v => [0, 1, 2].includes(v)));
      assert.deepEqual(patternAt(loaded.patterns[scene], bar).steps[id], p.steps[id], 'save/load keeps the phrase');
      assert.deepEqual(patternAt(replay.patterns[scene], bar).steps[id], p.steps[id], 'timeline keeps the phrase without artist metadata');
    }
  }
}
console.log('Baile two-bar hands/MC response, phrase-only turnaround and save/replay parity passed');

for (const id of ['perc', 'vox']) {
  const seed = 1, g = generate('bailefunk', seed), s = defaultState();
  s.patterns = arrangement(g.pattern, seed, true); applyOverrides(s, g);
  const row = Array(16).fill(0); row[3] = 2;
  s.locks[id] = true;
  for (const p of s.patterns) { p.steps[id] = [...row]; p.len[id] = 8; }
  applySongPlan(s, 'bailefunk', seed);
  for (let bar = 0; bar < s.chain.length; bar++) {
    const p = patternAt(s.patterns['ABCDEFGH'.indexOf(s.chain[bar])], bar);
    assert.deepEqual(p.steps[id], row, `locked ${id} wins over generated Baile takes at bar ${bar}`);
    assert.equal(p.len[id], 8);
  }
}
console.log('Baile generated takes give way to locked hand/vocal rows and lengths');

assert.deepEqual(INSTRUMENTS.trap.slice(0, 4), [[10, 2, 1, 1.5, 0.2], [7, 2, 1, 0.75, 0.4], [6, 2, 0, 0.8, 0.7], [8, 2, 1, 0.5, 0.8]]);
for (const [seed, voice] of [[42, 7], [211, 6], [11, 6]]) assert.equal(generate('trap', seed).params.stab.voice, voice);
assert.equal(createHash('sha256').update(JSON.stringify(generate('trap', 42))).digest('hex'), 'a66b0b02736558266403de46416abeee99cda602c3dbdab89fa59f07a12d906b', 'Trap 42 keeps its entire rap generation, including hook RNG');
for (const [seed, voice] of [[8, 0], [1234, 2]]) {
  const g = generate('trap', seed);
  assert.equal(g.params.stab.voice, voice);
  assert.equal(g.params.acid.voice, 2);
  assert.equal(g.pattern.hook.v, 'ravestack');
  assert(g.params.stab.cutoff >= 2500 && g.params.stab.cutoff <= 4000);
  assert(g.params.stab.reso <= 0.7);
  assert(g.params.stab.detune >= 12 && g.params.stab.detune <= 20);
  assert(g.params.stab.rev > 0.2 && g.params.stab.dly <= 0.2);
  assert(g.master.duck >= 0.6);
}
for (let seed = 0; seed < 100; seed++) {
  const g = generate('trap', seed);
  if (![0, 2].includes(g.params.stab.voice)) {
    assert(['mallet', 'reed'].includes(g.pattern.hook.v));
    assert.equal(g.master.duck, 0.2);
  }
}
console.log('Trap festival ensembles and rap seed stability passed');

for (const [seed, hash] of [
  [11, '5ae33f32e51da84357a832272265d544ace05c49720aa9a26ff39d40275cb3d2'],
  [42, '771361b753feef593e0d04f7dff2eb671ce89775436b9e55276423f8087d8997'],
]) {
  const g = generate('euphoric', seed, 'major');
  assert.equal(createHash('sha256').update(JSON.stringify(g)).digest('hex'), hash, 'Euphoric keeps its arrangement, chorus lift and other mix settings');
}
for (const style of ['hypnotic', 'drill', 'minimal']) {
  const switched = defaultState(), fresh = defaultState();
  applyOverrides(switched, generate('euphoric', 11, 'major'), true);
  applyOverrides(switched, generate(style, 42, 'minor'), true);
  applyOverrides(fresh, generate(style, 42, 'minor'), true);
  assert.equal(switched.params.ch.level, fresh.params.ch.level, `${style} hats do not inherit Euphoric's trim`);
}
for (const [style, hash] of [
  ['hypnotic', 'c24a1973964e8d5cd7b3fac95059a4187b2b4220767f76e27c9164688682345e'],
  ['drill', 'a88981d0192e00790e0dfc83b1003926a2c2bd988012a89e4adb23c79483c049'],
  ['minimal', '243099fb6edde28e9f73d3f5a623f1b5d11194cf09e066bbea36127418a8476a'],
]) assert.equal(createHash('sha256').update(JSON.stringify(generate(style, 42, 'minor'))).digest('hex'), hash, `${style} mix is unchanged`);
console.log('Euphoric hat headroom and other genre stability passed');

for (const seed of [1, 7, 42, 1337]) {
  const g = generate('euphoric', seed, 'major');
  assert(g.bpm >= 126 && g.bpm <= 134);
  assert(g.pattern.steps.vox.some(Boolean), 'euphoric needs vocal chops');
  assert(g.swing > 0);
  const s = defaultState();
  s.patterns[0] = g.pattern;
  applyOverrides(s, g);
  assert.equal(s.swing, g.swing);
  const round = sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round.patterns[0].steps.vox, g.pattern.steps.vox);
}
assert.equal(sanitize({ patterns: [], scale: 'major' }).scale, 'major');
console.log('euphoric style and VOX track passed');
import { STYLES } from '../js/state.js';
const sigs = new Map();
for (const style of Object.keys(STYLES)) {
  for (const seed of [3, 99]) {
    const g = generate(style, seed, 'minor');
    const [lo, hi] = STYLES[style].bpm;
    assert(g.bpm >= lo && g.bpm <= hi, style);
    assert(STYLES[style].family && STYLES[style].tag, style);
  }
  const g = generate(style, 3, 'minor');
  const sig = JSON.stringify([g.pattern.steps.kick, g.pattern.steps.snare, g.pattern.steps.ch, g.bpm, g.swing ?? 0, g.pattern.score ?? null]);
  assert(!sigs.has(sig), `${style} sounds the same as ${sigs.get(sig)}`);
  sigs.set(sig, style);
}
console.log(`${sigs.size} distinct genres passed`);
for (const [style, hook, bass, snare, clap] of [
  ['lofihiphop', 'tapekeys', [1], [4, 12], []],
  ['gfunk', 'funkwhistle', [1, 7], [], [4, 12]],
  ['phonk', 'phonkbell', [2], [4, 12], [12]],
  ['electrohiphop', 'robotformant', [6, 7], [12], [4, 12]],
]) {
  for (const seed of [11, 42, 1234]) {
    const g = generate(style, seed), s = defaultState();
    assert.equal(g.pattern.hook.v, hook);
    assert(g.pattern.hook.s.slice(0, 16).some(Boolean) && g.pattern.hook.s.slice(16).some(Boolean));
    assert(bass.includes(g.params.acid.voice));
    if (style === 'phonk') {
      assert.deepEqual(['ch', 'oh', 'perc'].map((id) => g.params[id].pan), [-0.5, 0.5, 0.5]);
      assert.deepEqual(['kick', 'acid'].map((id) => g.params[id].pan ?? 0), [0, 0]);
    }
    const hits = (track) => g.pattern.steps[track].flatMap((v, i) => v ? [i] : []);
    assert.deepEqual(hits('snare'), snare);
    assert.deepEqual(hits('clap'), clap);
    assert(g.pattern.steps.ch.every((v, i) => !(v && g.pattern.steps.oh[i])), 'open hats replace closed hats');
    applyOverrides(s, g);
    s.patterns = arrangement(g.pattern, seed, false);
    s.artist = { style, seed };
    applySongPlan(s, style, seed);
    const loaded = sanitize(JSON.parse(JSON.stringify(s)));
    assert.equal(loaded.artist.style, style);
    assert(loaded.patterns.some((p) => p.hook?.v === hook), 'the instrument survives save and reload');
    assert(loaded.chain.includes('G'), 'arrangement includes a chorus');
  }
}
console.log('Hip-hop pockets, instrument voices and save/reload passed');
const soulGen = generate('neosoul', 5, 'dorian');
assert.equal(soulGen.pattern.prog.length, 4);
assert(soulGen.master.vary > 0.5);
const { sanitize: san, defaultState: ds } = await import('../js/state.js');
const st0 = ds(); st0.patterns[0] = soulGen.pattern;
assert.deepEqual(san(JSON.parse(JSON.stringify(st0))).patterns[0].prog, soulGen.pattern.prog);
console.log('neo-soul progression and variation passed');
assert.equal(generate('neosoul', 9, 'dorian').master.kit, 1);
assert.equal(generate('hypnotic', 9, 'minor').master.kit || 0, 0);
const { POCKET_NAMES, pocketVel, pocketOf } = await import('../js/groove.js');
const pocketName = (style) => POCKET_NAMES[generate(style, 9, 'minor').master.pocket || 0];
assert.equal(pocketName('deephouse'), 'HOUSE');
assert.equal(pocketName('ukg'), 'GARAGE');
assert.equal(pocketName('hypnotic'), 'MACHINE');
assert.equal(pocketName('neosoul'), 'SOUL');
assert.equal(pocketName('symphony'), 'GRID');
assert.equal(generate('deephouse', 9, 'minor').master.kit, 2, 'house sits machine drums under recorded cymbals');
const house = pocketOf({ pocket: POCKET_NAMES.indexOf('HOUSE') });
assert(pocketVel(house, 'ch', 2) > pocketVel(house, 'ch', 3) && pocketVel(house, 'ch', 3) > pocketVel(house, 'ch', 1), 'house hats lean on the offbeat and whisper the e');
const saved = sanitize(JSON.parse(JSON.stringify({ ...defaultState(), master: { ...defaultState().master, pocket: 2, kit: 2 } })));
assert.equal(saved.master.pocket, 2); assert.equal(saved.master.kit, 2);
console.log('live kit defaults passed');
console.log('genre pockets passed');
for (const [style, seed, voice, cutoff] of [['afrobeats', 1168184795, 1, 600], ['reggaeton', 131219516, 3, 600], ['hyperpop', 273450247, 0, 900], ['hyperpop', 20, 5, 350], ['hyperpop', 3, 11, 900], ['ukg', 1800668011, 5, 400], ['breaks', 3, 1, 600], ['breaks', 4293831530, 5, 900]]) {
  const { params } = generate(style, seed);
  assert.equal(params.stab.voice, voice);
  assert.equal(params.stab.octave, 0, `${style}/${voice} stays in the body register`);
  assert.equal(params.stab.cutoff, cutoff);
  assert.equal(params.stab.reso, 0.7);
}
console.log('electronic chord registers and brightness passed');
assert(generate('neosoul', 9, 'dorian').master.room > 0.3);
console.log('room defaults passed');
for (const style of ['neosoul', 'boombap', 'hypnotic', 'ambient', 'euphoric']) {
  for (const seed of [1, 7, 42]) {
    const c = songChain(style, seed);
    assert(/^[A-H]+$/.test(c) && c.length % 4 === 0 && c.length <= 128 && c.includes('E'), `${style} song form`);
  }
}
{
  const g = generate('neosoul', 42, 'dorian');
  const scenes = arrangement(g.pattern, 42);
  assert.notDeepEqual(scenes[4].prog, scenes[2].prog, 'bridge uses its own changes');
  assert.deepEqual(scenes[6].prog, g.pattern.prog);
  assert(scenes.every((p) => !('alt' in p)));
}
console.log('song sections passed');

{
  const fresh = defaultState(); applyOverrides(fresh, generate('hypnotic', 5));
  const after = defaultState(); applyOverrides(after, generate('neosoul', 9)); applyOverrides(after, generate('hypnotic', 5));
  assert.equal(after.master.kit, 0);
  assert.deepEqual(after.master, fresh.master);
  assert.equal(after.params.acid.voice, fresh.params.acid.voice);
  assert.equal(after.params.stab.voice, fresh.params.stab.voice);
  assert.equal(after.swing, fresh.swing);
}
console.log('live-kit settings do not leak into the next style passed');

{
  const pans = (s) => ['ch', 'oh', 'perc'].map((id) => s.params[id].pan);
  for (const style of ['hypnotic', 'trap']) {
    const fresh = defaultState(), after = defaultState(), next = generate(style, 42);
    applyOverrides(after, generate('phonk', 42));
    assert.deepEqual(pans(after), [-0.5, 0.5, 0.5]);
    applyOverrides(after, next);
    applyOverrides(fresh, next);
    assert.deepEqual(pans(after), pans(fresh), `Phonk → ${style} restores the new genre's panning`);
  }
}
console.log('Phonk hat and percussion panning does not leak into Hypnotic or Trap');

{
  const { FAMILIES } = { FAMILIES: [...new Set(Object.values(STYLES).map((x) => x.family))] };
  for (const fam of FAMILIES) {
    const sounds = new Set(Object.keys(STYLES).filter((k) => STYLES[k].family === fam).map((k) => { const g = generate(k, 3, 'minor'); return `${g.params.stab.voice}/${g.params.acid.voice}`; }));
    assert(sounds.size >= 2 || (fam === 'JAZZ & HIP-HOP' || fam === 'CLASSICAL') && sounds.size >= 1, `${fam} genres share one instrument palette`);
  }
  const all = new Set(Object.keys(STYLES).map((k) => generate(k, 3, 'minor').params.stab.voice));
  assert(all.size >= 6, 'genres use most stab instruments');
}
console.log('per-genre instrument palettes passed');
{
  const noPiano = ['deephouse', 'ukg', 'breaks', 'dnb', 'trance', 'ambient', 'afrobeats', 'reggaeton', 'hyperpop', 'industrial', 'peak', 'acid', 'hypnotic', 'electro', 'dub', 'jerseyclub', 'bailefunk'];
  assert.deepEqual(INSTRUMENTS.breaks.at(-1), [1, 1, 1, 0.7, 0.5]);
  assert.deepEqual(INSTRUMENTS.reggaeton.at(-1), [3, 2, 1, 0.55, 0.45]);
  for (const style of noPiano) assert(INSTRUMENTS[style].every(([voice]) => voice !== 7), `${style} has no recorded piano`);
  const palettes = Object.entries(INSTRUMENTS).map(([style, tuples]) => {
    assert(tuples.length > 0, `${style} has an ensemble`);
    return [style, new Set(tuples.map(([voice]) => voice))];
  });
  let worst = 0, total = 0, pairs = 0;
  for (let i = 0; i < palettes.length; i++) for (let j = i + 1; j < palettes.length; j++) {
    const [a, av] = palettes[i], [b, bv] = palettes[j];
    const overlap = [...av].filter((voice) => bv.has(voice)).length / new Set([...av, ...bv]).size;
    assert(overlap < 1, `${a}/${b} have identical chord-voice sets`);
    assert(overlap <= 0.75, `${a}/${b} chord-voice Jaccard overlap ${overlap} exceeds 0.75`);
    worst = Math.max(worst, overlap); total += overlap; pairs++;
  }
  for (const [style, kit] of [['breaks', 1], ['dnb', 3]]) for (const seed of [1, 7, 42, 1337]) {
    assert.equal(generate(style, seed).master.kit, kit, `${style} uses its recorded drum kit`);
  }
  console.log(`electronic palettes: no piano; ${pairs} unique pairs; max Jaccard ${worst.toFixed(5)} <= 0.75; mean ${(total / pairs).toFixed(5)}`);
}
{
  const percs = new Set(Object.keys(STYLES).map((k) => generate(k, 3, 'minor').params.perc.voice));
  assert(percs.size >= 4, 'genres use several percussion instruments');
  assert(generate('boombap', 3, 'minor').master.dust > 0 && generate('hardtechno', 3, 'minor').master.dust === 0, 'dust is per-genre');
}
console.log('per-genre percussion and dust passed');

{
  for (const id of ['amapiano', 'afrobeats', 'reggaeton', 'bailefunk', 'trap', 'drill', 'jerseyclub', 'hyperpop']) assert(STYLES[id], id);
  assert.equal(generate('amapiano', 3, 'minor').params.acid.voice, 4, 'amapiano plays the log drum');
  assert(generate('trap', 3, 'minor').pattern.steps.clap[8] && !generate('trap', 3, 'minor').pattern.steps.clap[4], 'trap is half-time');
  const fams = new Set(Object.values(STYLES).map((x) => x.family));
  assert(fams.has('AFRO & LATIN') && fams.has('TRAP & POP'));
}
console.log('global genres passed');

{
  const g = generate('peak', 3, 'minor');
  assert.equal(g.master.arr, 1); assert.equal(generate('neosoul', 3, 'minor').master.arr, 0); assert.equal(generate('deephouse', 3, 'minor').master.arr, 0.5);
  const h = arrangement(g.pattern, 3, true)[7].steps;
  assert(h.kick[0] && !h.kick[4] && !h.kick[8] && !h.kick[12], 'half-time kick');
  assert(h.clap[8] && !h.clap[4] && !h.clap[12], 'half-time backbeat on 3');
  assert.notDeepEqual(arrangement(g.pattern, 3, false)[7].steps.kick, h.kick);
}
console.log('arrangement dynamics passed');
{
  // Neo-soul stays a live band: no horn patch, no synth-choir chops, no vinyl crackle bed.
  for (let seed = 1; seed <= 40; seed++) {
    const g = generate('neosoul', seed, 'dorian');
    assert.notEqual(g.params.stab.voice, 9, `neosoul ${seed} horns`);
    assert(!g.pattern.steps.vox.some(Boolean), `neosoul ${seed} vox`);
    assert.equal(g.master.dust, 0, `neosoul ${seed} dust`);
    assert(!g.pattern.steps.ride.some(Boolean), `neosoul ${seed} ride`);
  }
  console.log('neo-soul live band passed');
}
{
  // Bass notes written in the key slide off half-step rubs against the bar's chord; approach notes stay chromatic.
  const { Engine, guitarGrip } = await import('../js/engine.js');
  const { CHORDS } = await import('../js/params.js');
  const fake = { state: { key: 0, params: { acid: { tune: 0 } } }, harm: { r: 0, c: 9 }, harmRoot: Engine.prototype.harmRoot };
  const midi = (n, ap) => Engine.prototype.bassMidi.call(fake, { n, ap });
  assert.equal(midi(3) % 12, 4, 'minor third under MAJ9 moves to the major third');
  assert.equal(midi(10) % 12, 11, 'flat seven under MAJ9 moves to the major seventh');
  assert.equal(midi(7) % 12, 7, 'chord tones stay');
  assert.equal(midi(-1, true) % 12, 11, 'approach notes stay chromatic');
  let prev = null;
  for (const [root, iv] of CHORDS.map((c, i) => [47 + i, c.iv])) {
    const g = guitarGrip(root, iv, prev);
    assert(g[0] >= 40 && g[0] <= 51 && g[1] - g[0] >= 7, 'guitar root on a low string with air above it');
    for (let k = 2; k < g.length; k++) assert(g[k] - g[k - 1] >= 3, `no cluster in ${g}`);
    if (!CHORDS.find((c) => c.iv === iv).name.match(/CLUS|ADD/)) for (const a of g) for (const b of g) assert(![1, 13].includes(b - a), `no half-step or flat-nine rub in ${g}`);
    assert(g[g.length - 1] - g[0] <= 26 && g[g.length - 1] <= 76, `grip within reach: ${g}`);
    prev = g;
  }
  console.log('bass/chord agreement and guitar grips passed');
  const { guitarHand } = await import('../js/engine.js');
  assert.equal(guitarHand('agtr', 'FOLK', false).play, 'pick', 'folk verses are fingerpicked');
  assert.equal(guitarHand('agtr', 'FOLK', true).play, 'strum', 'folk choruses are strummed');
  assert.ok(guitarHand('agtr', 'FOLK', true).double && !guitarHand('agtr', 'FOLK', false).double, 'folk choruses double-track the strummed acoustic, verses keep one picker');
  assert.equal(guitarHand('banjo', 'COUNTRY', true).play, 'roll', 'a banjo rolls');
  assert.deepEqual(guitarHand('gtr', 'R&B', false), { play: 'chop', double: false, fx: 'chorus' }, 'R&B guitar chops through a chorus pedal');
  assert(guitarHand('drive', 'ROCK', false).double && !guitarHand('gtr', 'POP', false).double && guitarHand('gtr', 'POP', true).double, 'rock and pop choruses double-track');
  assert.equal(guitarHand('gretsch', 'COUNTRY', false).fx, 'trem', 'twang guitar plays through amp tremolo');
  assert.equal(guitarHand('agtr', 'COUNTRY', false).play, 'boom', 'country acoustic plays boom-chick');
  {
    // Country lead bends land exactly on the note, start from a scale tone, and only on notes long enough to hear it land.
    const { teleBend, bendCurve, BEND_HOLD, BEND_RISE } = await import('../js/engine.js');
    const { SCALES } = await import('../js/params.js');
    for (const st of [1, 2]) {
      const c = bendCurve(st);
      assert.equal(c[0], -100 * st); assert.equal(c[c.length - 1], 0, 'a bend lands on the note');
      for (let i = 1; i < c.length; i++) assert(c[i] >= c[i - 1], 'a bend only rises');
    }
    assert(BEND_HOLD + BEND_RISE <= 0.16, 'a bend lands within 160 ms');
    for (const [name, sc] of Object.entries(SCALES)) for (let k = 0; k < 12; k++) for (let m = 52; m <= 74; m++) {
      const inKey = (x) => sc.notes.includes((((x - 60 - k) % 12) + 12) % 12);
      for (const r of [0, 0.2, 0.39, 0.5, 0.9]) for (const dur of [0.2, 0.45, 0.5, 1.2]) {
        const b = teleBend(m, dur, true, inKey, r);
        if (dur < 0.5 || r >= 0.4) assert.equal(b, 0, 'short or unlucky notes are not bent');
        if (b) assert(inKey(m - b), `${name} bend starts on a scale tone`);
      }
      assert.equal(teleBend(m, 1.2, false, inKey, 0), 0, 'weak beats are not bent');
    }
  }
  assert.equal(guitarHand('piano', 'POP', true).play, 'strum');
  console.log('guitar hands passed');
}

// Song genres: a recorded band in a major key (ROCK: power chords over minor/mixolydian roots), each with its own pocket and changes.
{
  const { STYLES, MAJOR_STYLES, generate: gen, defaultState: fresh, applyOverrides: apply, sanitize: clean } = await import('../js/state.js');
  const { pocketOf } = await import('../js/groove.js');
  const { liveSets } = await import('../js/livekit.js');
  const { CHORDS } = await import('../js/params.js');
  for (const style of ['pop', 'rnb', 'rock', 'folk', 'country']) {
    assert(STYLES[style], style);
    for (const seed of [1, 7, 42]) {
      const g = gen(style, seed, 'minor'), s = fresh();
      s.patterns[0] = g.pattern; apply(s, g, true);
      assert.equal(Math.round(s.master.kit), 1, `${style} plays the recorded kit`);
      assert(pocketOf(s.master)?.band, `${style} has a band pocket`);
      assert(s.params.stab.voice >= 7, `${style} chords come from a recorded player`);
      assert(g.pattern.prog?.length >= 4, `${style} has written changes`);
      assert(liveSets(s).includes('kitx'), `${style} loads crashes and toms`);
      const round = clean(JSON.parse(JSON.stringify(s)));
      assert.deepEqual(round.patterns[0].prog, g.pattern.prog, `${style} changes survive a share link`);
    }
    if (MAJOR_STYLES.has(style)) assert.equal(gen(style, 7, 'minor').pattern.prog.length >= 4, true);
  }
  const names = (style, seed) => gen(style, seed).pattern.prog.map((h) => CHORDS[h.c].name);
  const rock = [1, 2, 3, 4, 5, 6].map((seed) => gen('rock', seed).pattern.prog);
  assert(rock.every((p) => p.every((h) => CHORDS[h.c].name === '5TH')), 'rock plays power chords');
  assert(rock.some((p) => p.some((h) => h.r === 10)), 'rock uses the bVII');
  assert([1, 2, 3, 4, 5, 6, 7, 8].some((seed) => names('rnb', seed).some((n) => /MIN9|MAJ9|DOM7|MIN7|MAJ7/.test(n))), 'r&b uses extended chords');
  assert([1, 2, 3, 4, 5, 6, 7, 8].some((seed) => gen('country', seed).pattern.prog.map((h) => h.r).join() === '0,5,0,7'), 'country has I-IV-I-V');
  assert([1, 2, 3, 4, 5, 6, 7, 8].some((seed) => gen('pop', seed).pattern.prog.map((h) => h.r).join() === '0,7,9,5'), 'pop has I-V-vi-IV');
  console.log('song genres (pop, r&b, rock, folk, country) passed');
}
