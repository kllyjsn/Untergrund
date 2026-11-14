import assert from 'node:assert/strict';
import { generate, defaultState, applyOverrides, sanitize, arrangement, songChain } from '../js/state.js';

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
  assert.equal(guitarHand('banjo', 'COUNTRY', true).play, 'roll', 'a banjo rolls');
  assert.deepEqual(guitarHand('gtr', 'R&B', false), { play: 'chop', double: false, fx: 'chorus' }, 'R&B guitar chops through a chorus pedal');
  assert(guitarHand('drive', 'ROCK', false).double && !guitarHand('gtr', 'POP', false).double && guitarHand('gtr', 'POP', true).double, 'rock and pop choruses double-track');
  assert.equal(guitarHand('gretsch', 'COUNTRY', false).fx, 'trem', 'twang guitar plays through amp tremolo');
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

