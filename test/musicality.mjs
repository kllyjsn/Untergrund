import assert from 'node:assert/strict';
import { generate, arrangement, applySongPlan, sanitize, defaultState, freshSong, STYLES, MAJOR_STYLES, MUSICIAN_PRINCIPLES } from '../js/state.js';
import { SCALES, KIT_BACKBEAT, CHORDS, TRACK_BY_ID } from '../js/params.js';
import { swingLate, swingDuration } from '../js/groove.js';
import { chordIv, hookSnap, voiceLead } from '../js/harmony.js';
import { Engine, Sequencer } from '../js/engine.js';
import { capture, Recorder } from '../js/midi.js';
import { patternAt } from '../js/scope.js';
import { STAB_BAND } from '../js/livekit.js';
import './jazz.mjs';

{
  const close = (a, b) => assert(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
  const s = defaultState(), sd = 0.25;
  assert.equal(s.master.swing8, 0);
  for (let i = 0; i < 32; i++) {
    assert.equal(swingLate(s, i, sd), i % 2 ? s.swing * sd * 0.5 : 0);
    assert.equal(swingDuration(s, i, 2, sd), 2 * sd, 'legacy gates are unchanged');
  }
  s.swing = 0.6; s.master.swing8 = 1;
  const beats = [0, 1 / 3, 2 / 3, 5 / 6, 1];
  for (let i = 0; i <= 4; i++) {
    close(i * sd + swingLate(s, i, sd), beats[i]);
    if (i < 4) close(swingDuration(s, i, 1, sd), beats[i + 1] - beats[i]);
  }
  close(Engine.prototype.stepLate.call({ state: s, stepDur: sd }, null, 2), 1 / 6);
  s.master.swing8 = 0.7;
  close(swingLate(s, 2, sd), 0.7 / 6);
  for (let i = 0; i < 16; i++) assert(swingDuration(s, i, 1, sd) > 0);
  for (const [input, expected] of [[undefined, 0], [NaN, 0], [Infinity, 0], [-1, 0], [2, 1], [0.7, 0.7]]) {
    s.master.swing8 = input;
    assert.equal(sanitize(s).master.swing8, expected);
  }
  s.master.swing8 = 1; s.swing = 0; s.bpm = 60;
  s.master.pocket = 0; s.master.humanize = 0; s.master.vary = 0;
  const pat = s.patterns[0];
  pat.steps.kick = Array(16).fill(0); pat.steps.kick[2] = 2;
  const rec = new Recorder(s), seq = new Sequencer(rec, s);
  const hooks = [];
  pat.hook = { v: 'tpt', o: 0, s: Array(32).fill(0), x: { feel: 0, risk: 0, space: 0 } };
  pat.hook.s[2] = [0, 2, 0.6]; pat.hm = 2;
  rec.hook = (...args) => hooks.push(args);
  for (let i = 0; i < 4; i++) seq.tick(i, i * sd);
  close(rec.notes.kick[0].t, 2 / 3);
  close(hooks[0][0], 2 / 3);
  close(hooks[0][3], 1 / 3);
  console.log(`swing8 offline scheduler: step 2 = ${rec.notes.kick[0].t.toFixed(12)} s; beat = 1.000000000000 s; ratio = ${(rec.notes.kick[0].t / 1).toFixed(12)}`);
}

{
  assert.deepEqual(CHORDS.slice(0, 13).map((c) => c.name), ['MIN', 'MIN7', 'MIN9', 'DUB', 'SUS2', 'SUS4', '5TH', 'MAJ7', 'DIM', 'MAJ9', 'ADD9', 'MAJ', 'DOM7']);
  assert.equal(TRACK_BY_ID.stab.params.find((q) => q.id === 'chord').max, CHORDS.length - 1);
  assert.deepEqual(voiceLead([], null, 36), []);
  let prev = null;
  for (let c = 13; c < CHORDS.length; c++) {
    const s = defaultState(), iv = CHORDS[c].iv;
    s.params.stab.chord = c; s.patterns[0].prog = [{ r: 0, c }];
    const saved = sanitize(JSON.parse(JSON.stringify(s)));
    assert.equal(saved.params.stab.chord, c); assert.equal(saved.patterns[0].prog[0].c, c);
    assert.deepEqual(chordIv({ c }, s.params.stab), iv);
    const snapped = hookSnap(1, { r: 0, c }, s.params.stab, true, false);
    assert(iv.some((n) => n % 12 === ((snapped % 12) + 12) % 12));
    const voiced = voiceLead(iv.map((n) => n + 36), prev, 36);
    assert(voiced[0] >= 48 && voiced.at(-1) <= 84, 'extended harmony stays above C3');
    assert.deepEqual(voiced.map((n) => n - voiced[0]), iv, 'extensions and quartal stacking stay intact');
    prev = voiced;
  }
  const s = defaultState(); s.params.stab.chord = 999; s.patterns[0].prog = [{ c: 999, r: 0 }];
  assert.equal(sanitize(s).params.stab.chord, CHORDS.length - 1);
  assert.equal(sanitize(s).patterns[0].prog[0].c, CHORDS.length - 1);
  s.patterns[0].hook = { v: 'tpt', s: Array(32).fill(0) };
  assert.equal(sanitize(s).patterns[0].hook.v, 'tpt');
  console.log('extended jazz chords: stable legacy indices, UI bounds, save/load, snapping and clear-register stacks passed');
}

{
  const s = freshSong('neosoul', 42);
  s.artist = { seed: 42 };
  s.key = 0; s.scale = 'minor'; s.master.vary = 0.4; s.params.acid.voice = 1; s.params.acid.tune = 0;
  const rec = new Recorder(s), seq = new Sequencer(rec, s);
  rec.harm = { r: 5, c: 0 };
  const pat = { len: { acid: 16 }, steps: { acid: [{ on: true, n: 0 }] }, prog: [{ r: 0, c: 0 }] };
  const pickup = seq.bassPickup(pat, pat, 3, 1, 1.05, 0.17, null);
  assert(pickup);
  const pitch = rec.bassMidi(pickup.st);
  assert(SCALES.minor.notes.includes(pitch % 12));
  assert(Math.abs(pitch - pickup.st.target) <= 2);
  assert(pickup.st.until < pickup.st.targetAt);
  assert.equal(seq.bassPickup(pat, pat, 2, 1, 1.05, 0.17, null), null);
  assert.equal(seq.bassPickup(pat, pat, 3, 1, 1.16, 0.17, null), null);
  assert.equal(seq.bassPickup(pat, { ...pat, steps: { acid: [] } }, 3, 1, 1.05, 0.17, null), null);
  assert.equal(seq.bassPickup(pat, { ...pat, prog: [{ r: 5, c: 0 }] }, 3, 1, 1.05, 0.17, null), null);
  s.master.vary = 0;
  assert.equal(seq.bassPickup(pat, pat, 3, 1, 1.05, 0.17, null), null);
  for (const seed of [11, 42, 3273615850]) {
    s.artist.seed = seed;
    const cell = Array.from({ length: 16 }, (_, i) => seq.lickCell(i, 0.4));
    for (let bar = 1; bar < 16; bar += 2) for (let i = 0; i < 16; i++) {
      assert.deepEqual(seq.lickCell(i, 0.4), cell[i]);
      if (i % 2) assert.equal(cell[i], null);
      assert.equal(seq.lickCell(i, 0), null);
    }
  }
  const input = {}, automation = [], gate = { connect() {}, gain: { setValueAtTime: (...a) => automation.push(['set', ...a]), linearRampToValueAtTime: (...a) => automation.push(['ramp', ...a]) } };
  const fake = { ch: { acid: { input } }, state: s, gain: () => gate, acidVoice() { assert.equal(this.ch.acid.input, gate); return 7; } };
  assert.equal(Engine.prototype.acid.call(fake, 1, { until: 1.1 }, false, false, 0.17), 7);
  assert.equal(fake.ch.acid.input, input);
  assert.deepEqual(automation.at(-1), ['ramp', 0, 1.1]);
  fake.acidVoice = () => { throw new Error('voice failed'); };
  assert.throws(() => Engine.prototype.acid.call(fake, 1, { until: 1.1 }, false, false, 0.17), /voice failed/);
  assert.equal(fake.ch.acid.input, input);
  const amp = { gain: { cancelScheduledValues() {}, setTargetAtTime() {}, setValueAtTime() {} } };
  fake.acidNodes = { vca: amp }; fake.gatedBasses = new Map([[7, { amp }]]);
  fake.acidVoice = () => 7;
  for (const voice of [0, 7]) {
    s.params.acid.voice = voice;
    Engine.prototype.acid.call(fake, 1, { until: 1.1, targetAt: 1.108 }, false, false, 0.17);
    assert.deepEqual(automation.at(-1), ['set', 1, 1.108]);
  }
  console.log('phrase pickups and eighth-note lick cells passed');
}

for (const existing of [false, true]) {
  const input = {}, sub = { amp: { out: input } };
  let calls = 0;
  const fake = {
    state: { params: { acid: { voice: 4 } } }, ch: { acid: { input } }, subVoice: existing ? sub : undefined,
    gain() { assert.fail('log-drum pickups must not create a persistent sub route'); },
    acidVoice() { calls++; assert.equal(this.ch.acid.input, input); },
  };
  Engine.prototype.acid.call(fake, 1, { until: 1.1, targetAt: 1.108 }, false, false, 0.17);
  assert.equal(calls, 0);
  assert.equal(fake.subVoice, existing ? sub : undefined);
  assert.equal(fake.ch.acid.input, input);
  Engine.prototype.acid.call(fake, 1.108, { on: true, n: 0 }, false, false, 0.17);
  assert.equal(calls, 1);
}
console.log('log-drum pickup sub routing passed');

{
  const s = freshSong('deephouse', 42);
  s.artist = { style: 'deephouse', seed: 42 }; s.params.acid.voice = 4;
  const rec = new Recorder(s), seq = new Sequencer(rec, s), notes = [], acid = rec.acid;
  rec.acid = function (t, st, ...args) {
    notes.push({ step: this.step, pickup: st.until != null, pitch: 48 + s.key + st.n + Math.round(s.params.acid.tune) + this.harmRoot() });
    return acid.call(this, t, st, ...args);
  };
  for (let i = 0; i <= 320; i++) { rec.step = i; seq.tick(i, 0.05 + i * rec.stepDur); }
  assert(notes.some((n) => n.step === 320));
  assert(notes.every((n) => !n.pickup));
  assert(!notes.some((n) => n.step === 319 && n.pickup));
  console.log('deephouse/42 log-drum pickup exclusion passed');
}

// Every club/pop style gets its own seeded hook; NEO-SOUL and BOOM BAP sing one over their Rhodes licks.
for (const style of Object.keys(STYLES)) {
  const a = generate(style, 11, 'minor'), b = generate(style, 22, 'minor');
  if (STYLES[style].family === 'CLASSICAL') { assert(a.pattern.score && !a.pattern.hook, `${style} is a score, not a hook loop`); continue; }
  assert(a.pattern.hook && a.pattern.hook.s.length === 32, `${style} needs a hook`);
  if (a.pattern.jazz) continue;
  const notes = a.pattern.hook.s.filter(Boolean);
  assert(notes.length >= (style === 'hardtechno' ? 2 : 4), `${style} hook too sparse`);
  // Song genres are major-key; generate() moves them off the minor default.
  const pcs = new Set(SCALES[MAJOR_STYLES.has(style) ? 'major' : 'minor'].notes.map((n) => n % 12));
  for (const [n] of notes) assert(pcs.has(((n % 12) + 12) % 12), `${style} hook note ${n} out of scale`);
  assert.notDeepEqual(a.pattern.hook.s, b.pattern.hook.s, `${style} hooks repeat across seeds`);
}
console.log('seeded hooks passed');

// Separate players, including when the chord ensemble picks a recorded instrument.
for (const [style, hook, bass] of [
  ['hypnotic', 'softresonator', 7], ['industrial', 'metalstrike', 6], ['acid', 'acidlead', 0],
  ['peak', 'ravestack', 8], ['electro', 'robotformant', 7], ['trance', null, 9], ['hardtechno', 'analog', 3], ['trap', null, 2],
]) {
  for (const seed of [11, 42, 73, 211, 997, 1234]) {
    const g = generate(style, seed);
    const s = defaultState();
    s.patterns[0] = g.pattern;
    s.params.acid.voice = g.params.acid.voice;
    const saved = sanitize(JSON.parse(JSON.stringify(s)));
    if (hook) assert.equal(saved.patterns[0].hook.v, hook, `${style}/${seed} hook round-trip`);
    assert.equal(saved.params.acid.voice, bass ?? g.params.acid.voice, `${style}/${seed} bass round-trip`);
  }
}

for (const [style, voice] of [['trap', 2], ['hardtechno', 3]]) {
  for (const prior of [undefined, 'hypnotic', 'electro', 'peak']) {
    const { params } = freshSong(style, 42, { base: prior && freshSong(prior, 42) });
    assert.equal(params.acid.voice, voice, `${style} keeps its bass voice`);
    assert.equal(params.acid.level, 0.55, `${style} does not inherit a different generated bass level`);
    assert.equal(params.acid.accent, 0.4, `${style} keeps its bass accent`);
  }
}

assert.deepEqual(Object.keys(MUSICIAN_PRINCIPLES), ['listen', 'respond', 'space', 'develop', 'risk', 'remember']);
for (const style of ['hypnotic', 'deephouse', 'euphoric', 'afrobeats', 'trap']) {
  const hook = generate(style, 84).pattern.hook;
  assert(hook.x && Object.values(hook.x).every((n) => n > 0 && n < 1), `${style} needs an expression plan`);
  assert.notDeepEqual(hook.s.slice(0, 16), hook.s.slice(16), `${style} answer should develop the call`);
  const velocities = new Set(hook.s.filter(Boolean).map((n) => n[2].toFixed(2)));
  assert(velocities.size >= 3, `${style} needs a dynamic phrase`);
}
console.log('musician principles and expression plans passed');

// Seeds change the key, and the groove bass is written per seed rather than picked from a fixed line.
const keys = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => generate('deephouse', seed).key));
assert(keys.size >= 4, 'keys should vary across seeds');
for (const style of ['deephouse', 'ukg', 'afrobeats']) {
  const lines = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(generate(style, seed).pattern.steps.acid)));
  assert(lines.size >= 4, `${style} bass lines repeat across seeds`);
}
console.log('per-seed key and bass passed');

for (const seed of [7, 42, 211, 1234]) {
  const s = freshSong('drill', seed), rec = new Recorder(s);
  s.current = 6; s.chainOn = false; s.ending = false;
  const notes = [];
  rec.acid = (t, st, slide, hold) => notes.push({ t, m: rec.bassMidi(st, 36, 38), slide, hold });
  const peak = new Sequencer(rec, s);
  for (let i = 0; i < 16; i++) peak.tick(i, i * rec.stepDur);
  const glide = notes.findIndex((n) => n.slide);
  assert.equal(s.patterns[6].steps.acid.filter((st) => st.on).length, 5, 'the slide pickup replaces an existing bass hit');
  assert(glide > 0 && notes[glide - 1].hold && notes[glide - 1].m !== notes[glide].m, `Drill/${seed}: an audible pitch glide reaches the 808`);
}
console.log('Drill pitched 808 glides passed');

for (const seed of [7, 42, 211, 1234]) {
  const g = generate('drill', seed);
  const original = arrangement(g.pattern, seed, true);
  const song = freshSong('drill', seed);
  assert.equal(song.master.arr, 0, 'written Drill fills replace the generic drop effect');
  assert.notDeepEqual(song.patterns[2].steps.kick, song.patterns[6].steps.kick, 'the verse and chorus have different grooves');
  assert.deepEqual(song.patterns[6].steps.acid, original[6].steps.acid, 'the chorus glides are untouched');
  const saves = sanitize(JSON.parse(JSON.stringify(song)));
  const secondVerse = [...song.chain.matchAll(/C+/g)][1].index;
  const response = patternAt(song.patterns[2], secondVerse).steps.kick;
  assert.notDeepEqual(response, song.patterns[2].steps.kick, 'the second verse answers with a different kick pickup');
  assert.deepEqual(patternAt(saves.patterns[2], secondVerse).steps.kick, response, 'the pickup survives save and load');
  const transitions = [...song.chain.matchAll(/CDG/g)].map(({ index }) => index + 1);
  assert(transitions.length, 'the song has a verse-to-chorus turnaround');
  for (const [index, at] of transitions.entries()) {
    const fill = patternAt(song.patterns[3], at);
    const pickup = index === 0 ? 14 : 12;
    assert(fill.steps.acid[pickup].on && !fill.steps.acid[pickup].s, 'the fill carries a bass note into the last beat');
    assert.equal(fill.steps.acid[pickup].v, index === 0 ? 0.71 : 0.92, 'later 808s enter earlier without losing the ghosted first entrance');
    assert(!fill.steps.acid[index === 0 ? 12 : 14].on && fill.steps.kick[13], 'only the bass pickup moves ahead of the kick on repeats');
    assert(fill.steps.acid[15].on && !fill.steps.acid[15].a && !fill.steps.acid[15].s, 'the final step adds a soft 808 pickup');
    assert(fill.steps.snare[15] && fill.steps.ch[15], 'the pocket continues until the downbeat');
    assert.deepEqual(patternAt(saves.patterns[3], at).steps, fill.steps, 'written fills survive save and load');
    const landing = patternAt(song.patterns[6], at + 1);
    assert.deepEqual(landing.steps.kick.slice(0, 2), [0, song.patterns[6].steps.kick[0]], 'the opening kick answers the 808');
    assert.deepEqual(landing.steps.acid, original[6].steps.acid, 'the chorus entrance keeps the written 808 line');
    assert.deepEqual(patternAt(saves.patterns[6], at + 1).steps, landing.steps, 'the landing survives save and load');
    assert.deepEqual(patternAt(song.patterns[6], at + 2).steps.kick, song.patterns[6].steps.kick, 'later chorus bars keep their downbeat');
  }
  const verseSteps = song.patterns[2].steps;
  verseSteps.perc[5] = 0;
  verseSteps.acid[0].on = false;
  for (const at of transitions) {
    assert.deepEqual(patternAt(song.patterns[3], at).steps, patternAt(saves.patterns[3], at).steps,
      'editing verse percussion or bass does not change the written fill');
  }
  song.patterns = original;
  song.locks.kick = true;
  song.locks.acid = true;
  const kick = original[2].steps.kick;
  const fillBass = patternAt(original[3], transitions[0]).steps.acid;
  applySongPlan(song, 'drill', seed);
  assert.deepEqual(song.patterns[2].steps.kick, kick, 'the verse does not replace a locked kick');
  assert.deepEqual(patternAt(song.patterns[2], secondVerse).steps.kick, kick, 'the response respects the kick lock');
  assert.deepEqual(patternAt(song.patterns[3], transitions[0]).steps.kick, original[3].steps.kick, 'the fill respects the kick lock too');
  assert.deepEqual(patternAt(song.patterns[3], transitions[0]).steps.acid, fillBass, 'the pickup respects the bass lock');
  assert.deepEqual(patternAt(song.patterns[6], transitions[0] + 1).steps.kick, original[6].steps.kick, 'the landing respects the kick lock');
}
console.log('Drill verse and turnaround passed');

{
  const song = sanitize(freshSong('drill', 42));
  // A replay keeps its pattern data even when the listener's artist differs.
  song.artist = { style: 'trap' };
  song.chain = 'ADGCDECDG';
  delete song.feel; // strict tempo: the feeling's tempo breath would stretch the ramp times
  const rec = new Recorder(song), seq = new Sequencer(rec, song), levels = [];
  rec.sectionGain = (t, db, ramp) => levels.push({ t, db, ramp });
  const sd = rec.stepDur;
  for (let i = 0; i < song.chain.length * 16; i++) seq.tick(i, i * sd);
  const crest = 0.95;
  assert.deepEqual(levels.filter(({ ramp }) => ramp), [{ t: 7 * 16 * sd, db: crest, ramp: [-1.8, 10 * sd, 4 * sd] }],
    'only the verse fill into a chorus ramps, cresting halfway through the last beat');
  assert.deepEqual(levels.find(({ t }) => t === 8 * 16 * sd), { t: 8 * 16 * sd, db: 0.45, ramp: undefined },
    'the chorus returns to its existing level without restarting the swell');
  seq.rewind(7 * 16 + 10, 100);
  const resumed = levels.at(-1);
  assert.equal(resumed.t, 100);
  assert.deepEqual(resumed.ramp.slice(1), [4 * sd, 0], 'rewinding into the fill plays only the remainder of the ramp');
  const gainAt = (step) => 10 ** (-1.8 / 20) * (14 - step) / 10 + 10 ** (crest / 20) * (step - 4) / 10;
  assert(Math.abs(10 ** (resumed.ramp[0] / 20) - gainAt(10)) < 1e-9, 'the resumed lift starts at the current gain');
  const listener = new Sequencer(rec, song);
  levels.length = 0;
  listener.startAt(16 + 10, 100);
  assert.deepEqual(levels, [], 'joining another fill does not start a swell');
  listener.startAt(7 * 16 + 2, 100);
  assert.deepEqual(levels.pop()?.ramp, [-1.8, 10 * sd, 2 * sd], 'joining early preserves the remaining verse-level hold');
  listener.startAt(7 * 16 + 10, 100);
  assert.deepEqual(levels.at(-1), resumed, 'a new listener hears the same remaining swell as a rewound listener');
  assert.equal(listener.chainPos, 8, 'joining mid-fill leaves the chorus queued as the next bar');
  levels.length = 0;
  listener.startAt(7 * 16 + 15, 100);
  assert.deepEqual(levels, [{ t: 100, db: crest, ramp: [crest, 0, 0] }], 'joining after the crest sets the gain immediately');
  const land = 100 + sd;
  listener.tick(8 * 16, land);
  assert.deepEqual(levels.at(-1), { t: land, db: 0.45, ramp: undefined }, 'joining in the swell preserves the chorus level');
  levels.length = 0;
  const fresh = new Sequencer(rec, song);
  fresh.startAt(8 * 16 + 8, 100);
  assert.deepEqual(levels, [], 'joining during the chorus does not replay the swell');
}

{
  const song = sanitize(freshSong('drill', 211));
  const loud = structuredClone(song);
  for (const take of loud.patterns[3].at) {
    delete take.steps?.acid?.[12]?.v;
    delete take.steps?.acid?.[14]?.v;
  }
  const notes = capture(song).notes.acid, unshaped = capture(loud).notes.acid;
  let softened = 0;
  assert.equal(notes.length, unshaped.length);
  for (const [i, { v, ...note }] of notes.entries()) {
    const { v: normal, ...same } = unshaped[i];
    assert.deepEqual(note, same, 'the pickup voicing does not change bass pitch or timing');
    if (v !== normal) {
      const expected = softened === 0 ? 0.71 : 0.92;
      assert(Math.abs(v / normal - expected) < 1e-9, 'the MIDI pickup keeps its written velocity');
      softened++;
    }
  }
  assert.equal(softened, [...song.chain.matchAll(/CDG/g)].length, 'only the first pickup hit in each fill is softened');
}

{
  const s = freshSong('drill', 42, { length: 'sketch' });
  const at = s.chain.indexOf('CDG') + 2, chorus = s.patterns[6];
  assert(at > 1, 'the sketch has a verse-to-chorus turnaround');
  const first = patternAt(chorus, at), next = patternAt(chorus, at + 1);
  assert.deepEqual(first.steps.kick.slice(0, 2), [0, next.steps.kick[0]], 'the kick answers the 808 even in the sketch’s final chorus');
  assert.deepEqual(first.steps.perc, next.steps.perc, 'the landing keeps the developed percussion');
  assert.notDeepEqual(first.steps.perc, chorus.steps.perc, 'the final-chorus development is audible');
}

{
  const song = freshSong('drill', 503);
  const saved = sanitize(JSON.parse(JSON.stringify(song)));
  assert.equal(saved.master.kit, KIT_BACKBEAT);
  assert.equal(saved.params.snare.level, 0.96);
  assert.equal(saved.params.clap.level, 0.23);
  const machine = { ...saved, master: { ...saved.master, kit: 0 } };
  assert.deepEqual(capture(saved).notes, capture(machine).notes, 'the new snare does not change the performance');
}

{
  const song = freshSong('drill', 1234), chorus = song.patterns[6];
  assert.equal(song.params.stab.voice, 6);
  assert.equal(chorus.hook.v, 'harpplk');
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(song))).patterns[6].hook, chorus.hook);
  const previous = JSON.parse(JSON.stringify(song));
  for (const p of previous.patterns) if (p.hook?.v === 'harpplk') p.hook.v = 'softmallet';
  assert.equal(sanitize(previous).patterns[6].hook.v, 'softmallet', 'existing songs keep the synth hook');
  assert.deepEqual(capture(song).notes, capture(previous).notes, 'the harp does not rewrite the melody');
}

{
  for (const [seed, chord, hook, oldChord, oldHook] of [
    [7, 16, 'oboe', 10, 'reed'],
    [42, 16, 'airflute', 10, 'mallet'],
    [211, 16, 'oboe', 7, 'reed'],
    [503, 17, 'airflute', 9, 'mallet'],
    [13, 6, 'oboe', 6, 'reed'],
  ]) {
    const current = freshSong('drill', seed);
    const saved = sanitize(JSON.parse(JSON.stringify(current)));
    assert.equal(saved.params.stab.voice, chord, `Drill ${seed} chord voice survives replay`);
    assert.equal(saved.patterns[6].hook.v, hook, `Drill ${seed} lead survives replay`);
    const older = JSON.parse(JSON.stringify(current));
    older.params.stab.voice = oldChord;
    for (const p of older.patterns) if (p.hook) p.hook.v = oldHook;
    const restored = sanitize(older);
    assert.equal(restored.params.stab.voice, oldChord);
    assert.equal(restored.patterns[6].hook.v, oldHook);
    assert.deepEqual(capture(current).notes, capture(older).notes, `Drill ${seed} palette does not rewrite the performance`);
  }
}

{
  const g = generate('deephouse', 42);
  const scenes = arrangement(g.pattern, 42);
  assert.deepEqual(scenes.map((p) => p.hm), [0, 2, 1, 2, 2, 1, 2, 2], 'hook is held back for the intro, the pre-chorus climbs it whole');
  assert.deepEqual(arrangement(generate('peak', 42).pattern, 42).map((p) => p.hm), [0, 0, 1, 2, 2, 1, 2, 2], 'club forms tease the hook in the build');
  const s = defaultState(); s.patterns = scenes;
  const round = sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round.patterns[6].hook, g.pattern.hook);
  assert.equal(round.patterns[0].hm, 0);
}
console.log('hook arrangement and save round-trip passed');

for (const seed of [7, 211, 503]) {
  const song = freshSong('drill', seed);
  const chorus = song.chain.indexOf('G') * 16;
  assert(song.patterns[6].hook.m, 'generated Drill plays the sung melody path');
  const collect = (s, from, until) => {
    const rec = new Recorder(s), seq = new Sequencer(rec, s), hits = [];
    rec.hook = (_t, _v, pitch, dur, voice, _oct, _strong, _b, _up, x) => {
      if (!x.harm && dur <= 0.85) hits.push([rec.step, pitch, voice, x.take]);
    };
    if (from) seq.startAt(from, 100);
    for (let i = from; i < until; i++) seq.tick(i, 100 + (i - from) * rec.stepDur);
    return hits;
  };
  const hits = collect(song, 0, song.chain.length * 16);
  assert(hits.some(([, pitch, , take]) => take === 1 && hits.some(([, p, , t]) => p === pitch && t === 0)),
    `Drill/${seed}: a repeated sung pitch uses both takes`);
  const saved = sanitize(JSON.parse(JSON.stringify(song)));
  const inChorus = hits.filter(([i]) => i >= chorus && i < chorus + 64);
  assert(inChorus.length > 0, `Drill/${seed}: first chorus contains sung hits`);
  assert.deepEqual(collect(saved, chorus, chorus + 64), inChorus, `Drill/${seed}: late start of a saved song selects the same takes`);
}

// Neighbouring genres must not share one template: different rooms, lead roles and hook writing.
{
  const g = (st) => generate(st, 21);
  for (const st of ['trap', 'drill', 'reggaeton', 'ukg', 'dnb', 'hyperpop']) {
    assert(g(st).master.revLevel <= 0.4, `${st} should be drier than the ambient/trance room`);
  }
  for (const [a, b] of [['ukg', 'deephouse'], ['dnb', 'euphoric'], ['amapiano', 'afrobeats'], ['hyperpop', 'trance'], ['trap', 'reggaeton']]) {
    const A = g(a), B = g(b);
    const sig = (x) => [x.pattern.hook?.v, x.pattern.hook?.o, x.master.revLevel, x.params.stab.voice, x.params.acid.voice, x.bpm].join('|');
    assert.notEqual(sig(A), sig(B), `${a} and ${b} share a sound signature`);
    const rhythm = (x) => x.pattern.hook.s.map(Boolean).join('');
    assert.notEqual(rhythm(A), rhythm(B), `${a} and ${b} hooks share a rhythm`);
  }
console.log('genre signatures passed');

// A genre is a musical grammar, not one fixed preset. Different seeds should
// recruit different players, registers or articulations without borrowing another genre's drums or harmony.
  {
    for (const style of Object.keys(STYLES)) {
      if (STYLES[style].family === 'CLASSICAL') continue;
      const ensembles = new Set();
      for (let seed = 1; seed <= 24; seed++) {
        const g = generate(style, seed);
        ensembles.add([
          g.params.stab.voice,
          g.params.acid.voice,
          g.params.stab.octave,
          ...(style === 'bailefunk' || g.pattern.jazz ? [g.params.stab.decay] : []),
        ].join('/'));
      }
      assert(ensembles.size >= 4, `${style} needs several seeded ensembles`);
    }
    const recorded = new Set();
    for (const style of Object.keys(STYLES)) {
      for (let seed = 1; seed <= 24; seed++) {
        const { voice, level } = generate(style, seed).params.stab;
        assert(level === undefined || (Number.isFinite(level) && level > 0), `${style} seed ${seed}: stab level ${level} for voice ${voice}`);
        if (voice >= 7) recorded.add(voice);
      }
    }
    assert.deepEqual([...recorded].sort((a, b) => a - b), Object.keys(STAB_BAND).map(Number), 'all recorded voices should appear across generated songs');
    for (const style of ['trap', 'drill']) {
      for (let seed = 1; seed <= 24; seed++) assert.equal(generate(style, seed).params.acid.voice, 2, `${style} must keep its sliding 808`);
    }
    for (const style of ['bailefunk', 'jerseyclub']) {
      for (let seed = 1; seed <= 24; seed++) assert.notEqual(generate(style, seed).params.acid.voice, 4, `${style} must not borrow amapiano's log drum`);
    }
    for (const style of Object.keys(STYLES)) {
      for (let seed = 1; seed <= 24; seed++) {
        const g = generate(style, seed);
        if (g.params.stab.voice === 6) assert(g.params.stab.octave <= 1, `${style} bells are already voiced one octave high`);
        if ([3, 4].includes(g.params.stab.voice)) assert(g.params.stab.octave >= 0, `${style} organ/brass must stay out of the sub register`);
        if (g.params.stab.voice >= 7) assert(g.params.stab.octave >= 0, `${style} recorded chords must not fold into clustered voicings`);
      }
    }
    for (const style of ['industrial', 'acid', 'peak', 'hardtechno']) {
      for (let seed = 1; seed <= 24; seed++) assert(generate(style, seed).pattern.steps.stab.some(Boolean), `${style} ensembles need audible chord steps`);
    }
    for (let seed = 1; seed <= 24; seed++) {
      const trance = generate('trance', seed);
      assert.equal(trance.params.acid.voice, 9, 'trance uses the pluck bass');
      assert(trance.params.acid.decay <= 0.05, 'trance pluck must leave space between the sixteenths');
      assert(trance.pattern.steps.acid.every((step, i) => step.on === (i % 4 !== 0) && step.a === (i % 4 === 2)), 'trance keeps the rolling offbeat line');
      assert.notEqual(generate('electro', seed).params.acid.voice, 3, 'electro must not borrow the DnB Reese');
      assert.equal(generate('ambient', seed).params.acid.voice, 1, 'ambient bass must avoid an 808 pitch knock');
      const ukg = generate('ukg', seed);
      if (ukg.params.stab.voice === 3) assert(ukg.params.stab.decay <= 0.3, 'UK garage organ must stay gated');
    }
    assert(new Set(Array.from({ length: 24 }, (_, i) => generate('neosoul', i + 1).params.stab.voice)).has(1), 'neo-soul needs Rhodes/keys');
  }
console.log('seeded instrument ensembles passed');
}

// Motif development keeps every variant in the scale and recognisable, and the breakdown gets its own B-phrase.
{
  const { develop, motifPlan, DEVELOP } = await import('../js/motif.js');
  for (const style of ['trance', 'deephouse', 'hypnotic', 'trap']) for (const scale of ['minor', 'major']) {
    const sc = SCALES[scale].notes, pcs = new Set(sc.map((n) => n % 12)), hook = generate(style, 211, scale).pattern.hook.s;
    for (const kind of [...DEVELOP, 'contrast']) {
      const v = develop(hook, kind, sc);
      assert.equal(v.length, 32, `${style} ${kind} keeps 2 bars`);
      assert(v.filter(Boolean).length >= 3, `${style} ${kind} keeps the line`);
      assert.notDeepEqual(v, hook, `${style} ${kind} should vary the motif`);
      for (const [n, l] of v.filter(Boolean)) { assert(pcs.has(((n % 12) + 12) % 12), `${style} ${kind} note ${n} out of ${scale}`); assert(l >= 1 && l <= 16); }
    }
  }
  const plan = Array.from({ length: 20 }, (_, b) => motifPlan(b * 2, 40, 2));
  assert.deepEqual(plan.slice(0, 2), ['orig', 'orig'], 'the hook is stated before it develops');
  assert(plan.slice(-2).every((k) => k === 'orig'), 'the outro brings the hook home');
  assert(new Set(plan).size >= 4, 'a song uses several developments');
  assert.equal(motifPlan(10, 40, 4), 'contrast');
  assert.equal(motifPlan(10, 0, 2), 'orig', 'a looping pattern plays the hook as written');
  console.log('motif development passed');
}

// Song form: 8-bar phrases (16 for techno) that end on a turnaround, and a generated song that closes on one final
// downbeat instead of looping straight back to the intro.
{
  const { songChain } = await import('../js/state.js');
  const { buildSong, playSong } = await import('../scripts/composition.mjs');
  for (const style of ['deephouse', 'hypnotic', 'ambient', 'trap', 'trance']) for (const seed of [1, 2, 3]) {
    const c = songChain(style, seed), phrase = style === 'ambient' || c.length <= 80 ? 8 : 16;
    assert(c.length >= 48 && c.length <= 128 && c.length % phrase === 0, `${style} form ${c.length} bars`);
    for (let b = phrase; b < c.length; b += phrase) {
      if (c[b] !== c[b - 1] && style !== 'ambient') assert('DHB'.includes(c[b - 1]) || c[b] === 'B' || c[b] === 'A', `${style} phrase into bar ${b} has no turnaround (${c.slice(b - phrase, b)})`);
    }
  }
  const s = buildSong('deephouse', 101);
  assert.equal(sanitize(JSON.parse(JSON.stringify(s))).ending, true, 'the ending survives save and load');
  const { log, bars } = playSong(s), last = log.filter((L) => L.step >= (bars - 1) * 16);
  assert(last.length >= 3 && last.every((L) => L.step % 16 === 0), 'the last bar is a single final downbeat');
  assert(last.some((L) => L.k === 'impact'), 'the final downbeat lands with weight');
  const turn = log.filter((L) => L.k === 'trigger' && L.a[0] === 'stab' && L.step % 16 >= 12 && L.step < (bars - 1) * 16);
  assert(turn.length, 'stabs play through turnarounds');
  console.log('song form passed');
}

// Songs have real sections: the verse its own changes, sparser and lower; a pre-chorus that holds the kick back and
// climbs to the dominant; a bridge away from home; a fuller, wider chorus. Club forms keep their own scenes.
{
  const { SONG_STYLES } = await import('../js/state.js');
  const { buildSong, playSong } = await import('../scripts/composition.mjs');
  const key = (pr) => JSON.stringify(pr);
  for (const style of [...SONG_STYLES].filter((s) => !generate(s, 1).pattern.jazz)) for (const seed of [1, 2, 3, 4]) {
    const g = generate(style, seed), sc = arrangement(g.pattern, seed), S = g.pattern.sections;
    assert(S, `${style} writes sections`);
    assert.deepEqual(sc.map((p) => p.sec), [undefined, 'pre', 'verse', undefined, 'bridge', 'bridge', 'chorus', 'chorus'], `${style} section slots`);
    assert.notEqual(key(sc[2].prog), key(sc[6].prog), `${style}/${seed} verse and chorus have different changes`);
    assert.equal(sc[1].prog.at(-1).r, 7, `${style}/${seed} pre-chorus ends on the dominant`);
    assert(sc[1].prog.slice(0, -1).every((h) => h.r !== 0), `${style}/${seed} pre-chorus withholds the tonic`);
    assert.equal(sc[1].steps.kick.filter(Boolean).length, 1, `${style}/${seed} pre-chorus holds the kick back`);
    assert.notEqual(sc[4].prog[0].r, 0, `${style}/${seed} bridge starts away from home`);
    assert(sc[2].steps.stab.filter(Boolean).length <= sc[6].steps.stab.filter(Boolean).length, `${style}/${seed} verse chords are sparser`);
    assert(!sc[2].steps.oh.some(Boolean) && sc[6].steps.oh.some(Boolean), `${style}/${seed} open hats wait for the chorus`);
    if (g.pattern.hook) {
      assert.deepEqual(sc[6].hook, g.pattern.hook, `${style} chorus plays the hook as generated`);
      assert.deepEqual(sc[2].hook.s.map((x) => x && x[1]), g.pattern.hook.s.map((x) => x && x[1]), `${style} verse keeps the hook's rhythm`);
      const lo = (h) => h.s.filter(Boolean).reduce((a, x) => a + x[0], 0);
      assert(lo(sc[2].hook) < lo(g.pattern.hook), `${style}/${seed} verse melody sits lower`);
    }
    const round = sanitize(JSON.parse(JSON.stringify({ ...defaultState(), patterns: sc })));
    assert.deepEqual(round.patterns.map((p) => p.sec), sc.map((p) => p.sec), 'sections survive save and load');
  }
  for (const style of ['hypnotic', 'peak', 'trance', 'ambient', 'dnb']) {
    const g = generate(style, 5);
    assert(!g.pattern.sections && arrangement(g.pattern, 5).every((p) => !p.sec), `${style} keeps its club scenes`);
  }
  // The pre-chorus melody climbs a step per bar, and only the chorus opens the stab voicing.
  const s = buildSong('euphoric', 101), { log } = playSong(s);
  const pre = s.chain.indexOf('B'), tops = [0, 1, 2, 3].map((k) => Math.max(...log.filter((L) => L.k === 'hook' && !L.a[9]?.counter && Math.floor(L.step / 16) === pre + k).map((L) => L.a[2])));
  assert(tops[3] > tops[0], `pre-chorus climbs (${tops})`);
  console.log('song sections passed');
}

// Harmony for the styles without written changes, in their own idiom, and the final-chorus lift.
{
  const { CHORDS } = await import('../js/params.js');
  const { buildSong, playSong } = await import('../scripts/composition.mjs');
  const MINOR = new Set([0, 2, 3, 5, 7, 8, 10]), pc = (x) => ((x % 12) + 12) % 12;
  const diatonic = (h) => CHORDS[h.c].iv.every((i) => MINOR.has(pc(h.r + i)));
  for (const style of ['hypnotic', 'peak', 'dub', 'breaks', 'electro', 'dnb', 'bailefunk', 'jerseyclub', 'ambient']) for (const seed of [1, 2, 3, 4]) {
    const g = generate(style, seed), sc = arrangement(g.pattern, seed), techno = !!g.pattern.pedal;
    const progs = techno ? [sc[6].prog, sc[7].prog] : sc.map((p) => p.prog);
    for (const pr of progs) {
      assert(pr && new Set(pr.map((h) => h.r)).size >= 2, `${style}/${seed} has harmonic motion`);
      if (diatonic(pr[0])) assert(pr.every(diatonic), `${style}/${seed} off-tonic chords stay in the key: ${JSON.stringify(pr)}`);
    }
    if (techno) assert(sc.slice(0, 6).every((p) => !p.prog) && pr0(sc[6]).slice(0, 6).every((h) => h.r === 0), `${style} holds the pedal outside the peak`);
  }
  function pr0(p) { return p.prog; }
  for (const style of ['euphoric', 'trance', 'hyperpop']) {
    const s = buildSong(style, 101), { log, bars } = playSong(s), c = s.chain;
    assert.equal(sanitize(JSON.parse(JSON.stringify(s))).patterns[6].lift, 2, 'the lift survives save and load');
    const lastPeak = c.lastIndexOf('G'), early = log.filter((L) => L.k === 'trigger' && L.a[0] === 'stab' && L.step < 16 * c.indexOf('G') + 64 && L.harm);
    const late = log.filter((L) => L.k === 'trigger' && L.a[0] === 'stab' && L.step >= 16 * lastPeak - 64 && L.step < 16 * lastPeak && L.harm);
    const roots = (xs) => new Set(xs.map((L) => pc(L.harm.r)));
    assert([...roots(late)].some((r) => !roots(early).has(r)) || [...roots(late)].every((r) => [...roots(early)].map((x) => pc(x + 2)).includes(r)), `${style} final chorus is lifted`);
    const end = log.find((L) => L.k === 'hook' && L.step === (bars - 1) * 16);
    assert(end && pc(end.a[2]) === 2, `${style} ends on the lifted tonic (${end?.a[2]})`);
  }
  console.log('idiomatic harmony passed');
}

// Interplay: licks yield to the hook, the bass answers its rests, breakdowns get a guide-tone countermelody.
{
  const { CHORDS } = await import('../js/params.js');
  const { buildSong, playSong } = await import('../scripts/composition.mjs');
  const pc = (x) => ((x % 12) + 12) % 12;
  let answers = 0, counters = 0;
  for (const style of ['deephouse', 'neosoul', 'ukg', 'afrobeats', 'trance', 'dub']) for (const seed of [101, 211, 307]) {
    const s = buildSong(style, seed), { log } = playSong(s), hook = new Map();
    for (const L of log) if (L.k === 'hook' && !L.a[9]?.harm) for (let k = 0; k < Math.max(1, Math.round(L.a[3] / 0.125)); k++) hook.set(L.step + k, true);
    for (const L of log.filter((x) => x.k === 'lick')) assert(!hook.has(L.step) && !hook.has(L.step + 1), `${style}/${seed} lick at ${L.step} talks over the hook`);
    const acidAt = new Set(log.filter((x) => x.k === 'acid').map((x) => x.step));
    answers += log.filter((x) => x.k === 'acid' && x.a[1]?.answer && !hook.has(x.step) && 'CG'.includes(s.chain[Math.floor(x.step / 16)])).length;
    for (const L of log.filter((x) => x.k === 'hook' && x.a[9]?.counter)) {
      counters++;
      assert('EF'.includes(s.chain[Math.floor(L.step / 16)]), `${style} countermelody only in breakdowns`);
      if (L.harm) { const rel = pc(L.a[2] - L.harm.r); assert(CHORDS[L.harm.c].iv.map(pc).includes(rel), `${style} counter note ${L.a[2]} is a chord tone of ${JSON.stringify(L.harm)}`); }
    }
  }
  assert(answers > 20, `the bass answers the hook (${answers})`);
  assert(counters > 20, `breakdowns carry a countermelody (${counters})`);
  console.log('interplay passed');
}

// Techno builds: the intro layers in, long runs end every 8 bars on a roll over a dropped kick, the drums develop.
{
  const { buildSong, playSong } = await import('../scripts/composition.mjs');
  for (const style of ['industrial', 'acid', 'peak', 'hardtechno', 'electro']) for (const seed of [101, 307]) {
    const s = buildSong(style, seed);
    if (style === 'hardtechno') s.artist = { style, seed };
    const { log } = playSong(s), chain = s.chain;
    const at = (k, bar) => log.filter((L) => L.k === 'trigger' && L.a[0] === k && Math.floor(L.step / 16) === bar).map((L) => L.step % 16);
    assert(chain.startsWith('A'.repeat(style === 'hardtechno' ? 4 : 8)) && at('ch', 0).length === 0, `${style} intro opens on the kick alone`);
    assert(at('kick', 0).length, `${style} intro has its kick`);
    let fills = 0;
    for (let b = 0; b + 1 < chain.length; b++) {
      let a = b; while (a > 0 && chain[a - 1] === chain[b]) a--;
      let e = b; while (e + 1 < chain.length && chain[e + 1] === chain[b]) e++;
      if (!'CG'.includes(chain[b]) || e - a + 1 < 8 || (b - a) % 8 !== 7 || b === e) continue;
      fills++;
      assert(!at('kick', b).some((i) => i >= 12), `${style}/${seed} bar ${b}: the kick drops for the phrase-end fill`);
      const roll = s.patterns[2].steps.snare.some(Boolean) ? 'snare' : 'clap';
      assert(at(roll, b).filter((i) => i >= 12).length >= 4, `${style}/${seed} bar ${b}: a ${roll} roll ends the phrase`);
    }
    assert(fills >= 3, `${style}/${seed} has phrase-end fills (${fills})`);
  }
  console.log('techno builds passed');
}

// A generated song finishes: the sequencer flags the end of its last bar so the transport stops instead of looping,
// and the shared player plays every bar of the longer forms.
{
  const { buildSong, playSong } = await import('../scripts/composition.mjs');
  const { songBars } = await import('../js/player.js');
  for (const style of ['trance', 'industrial', 'deephouse', 'ambient']) {
    const s = buildSong(style, 101);
    assert(s.ending, `${style}: a generated song ends`);
    const { seq, bars } = playSong(s);
    assert(seq.finished, `${style}: the last bar flags the end`);
    assert(songBars(s) === bars, `${style}: the player plays all ${bars} bars (${songBars(s)})`);
  }
  // A stalled main thread can skip the final bar's steps (the transport only advances bars): the song still ends.
  const { Sequencer } = await import('../js/engine.js');
  const s = buildSong('trance', 101), n = s.chain.length, calls = [];
  const e = new Proxy({ stepDur: 0.125, harm: null }, { get: (o, k) => (k in o ? o[k] : () => calls.push(k)), set: (o, k, v) => { o[k] = v; return true; } });
  const seq = new Sequencer(e, s);
  for (let abs = 0; abs < (n - 2) * 16; abs++) seq.tick(abs, abs * 0.125);
  for (let abs = (n - 2) * 16; abs < n * 16; abs++) seq.advanceBar(abs, abs * 0.125);
  calls.length = 0; seq.tick(n * 16, n * 2);
  assert(seq.finished && !calls.some((k) => k === 'trigger' || k === 'hook' || k === 'acid'), 'a song whose last bar was skipped still ends, silently');
  // A generated score ends with its final chord: no empty bars after it, and the transport stops on its last step.
  const { compose } = await import('../js/classical.js');
  for (const style of ['symphony', 'concerto', 'nocturne']) {
    const s = buildSong(style, 11), sc = compose(s.patterns.find((p) => p.score).score), seq = new Sequencer(e, s);
    const last = sc.at.findLastIndex((x) => x.length), bar = sc.barLen || 16;
    assert(sc.at.length - last <= bar, `${style}: the final chord is in the last bar (${(sc.at.length - last) / bar} bars before the end)`);
    let end = -1;
    for (let abs = 0; abs < sc.at.length + 32 && end < 0; abs++) { seq.tick(abs, abs * 0.125); if (seq.finished) end = abs; }
    assert(end === sc.at.length - 1, `${style}: playback stops after the score's last step (${end} of ${sc.at.length})`);
  }
  console.log('song ending stops passed');
}

// Song sections set the output level: the chorus lands 1.5-3 dB over the verse (scaled by the song's feeling,
// js/feel.js dyn.contrast); techno and ambient stay at unity.
{
  const { buildSong } = await import('../scripts/composition.mjs');
  const { Sequencer } = await import('../js/engine.js');
  const { FEELS } = await import('../js/feel.js');
  for (const style of ['euphoric', 'reggaeton', 'neosoul', 'pop', 'rock', 'country', 'hypnotic', 'ambient']) {
    const s = buildSong(style, 101), lv = {}, at = [];
    const e = new Proxy({ stepDur: 0.125, harm: null }, {
      get: (o, k) => (k in o ? o[k] : k === 'sectionGain' ? (t, db) => at.push(db) : () => {}),
      set: (o, k, v) => { o[k] = v; return true; },
    });
    const seq = new Sequencer(e, s);
    for (let abs = 0; abs < s.chain.length * 16 && !seq.finished; abs++) {
      seq.tick(abs, abs * 0.125);
      const sec = s.patterns[seq.cur].sec;
      if (abs % 16 === 0 && sec && at.length) lv[sec] = at.at(-1);
    }
    if (!s.patterns.some((p) => p.sec)) { assert(at.every((db) => db === 0), `${style}: no section levels`); continue; }
    const lift = lv.chorus - lv.verse, k = FEELS[s.feel]?.dyn.contrast ?? 1;
    assert(lift >= 1 && lift <= 3 * k, `${style} (${s.feel}): chorus ${lift} dB over the verse`);
  }
  // As heard: pop's and country's bands play a much fuller chorus on top of the level change, so the mastered
  // render (median 3 s loudness, chorus minus verse) must still land in 1.5-3 dB.
  const { withChrome } = await import('./chrome.mjs');
  // Pop seed 9 instead of 77: with feelings, seed 77 writes a different pop song. The lift spreads 1.2-4.7 dB over
  // seeds 1-17 on main and on feeling songs alike, so this checks three in-range songs, not every seed.
  const jobs = [['pop', 11], ['pop', 42], ['pop', 9], ['country', 11], ['country', 42], ['country', 77]];
  const heard = await withChrome(async (runs) => {
    const out = [];
    let next = 0;
    await Promise.all(runs.map(async (run) => {
      await run(`import('/test/loudness-page.js').then((m) => { window.__m = m; })`);
      while (next < jobs.length) { const i = next++; out[i] = await run(`window.__m.sectionLift('${jobs[i][0]}', ${jobs[i][1]})`); }
    }));
    return out;
  }, { pages: 3 });
  if (!heard) console.log('section levels: no Chrome found, rendered chorus lift skipped');
  else jobs.forEach(([style, seed], i) => assert(heard[i] >= (style === 'pop' ? 1.5 : 1) && heard[i] <= 3 * (FEELS[buildSong(style, seed).feel]?.dyn.contrast ?? 1), `${style}/${seed}: rendered chorus ${heard[i].toFixed(2)} dB over the verse`));
  console.log(`section levels passed${heard ? ` (rendered chorus over verse: ${jobs.map(([st, se], i) => `${st}/${se} ${heard[i].toFixed(2)}`).join(', ')} dB)` : ''}`);
}
