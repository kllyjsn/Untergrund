// Live-kit preloading: which recordings a song needs, and the per-song lock that keeps a part on one sound.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { liveSet, liveSets, setsReady, loadSets, loadBand, BAND, STAB_BAND, LIVE_FILES, LIVE_KIT } from '../js/livekit.js';
import { Engine, Sequencer } from '../js/engine.js';
import { KIT_BACKBEAT, HAND_KIT, MARIMBA_STAB } from '../js/params.js';
import { defaultState, freshSong, generate, STYLES } from '../js/state.js';
import { createPlayer } from '../js/player.js';
import { OfflineAudioContext as FakeContext, AudioBuffer } from './offline-audio.mjs';

const st = (kit, voice) => ({ master: { kit }, params: { stab: { voice } } });
for (const hook of ['fiddle', 'twang']) {
  const song = { ...freshSong('country', 42), artist: { style: 'country' } };
  for (const p of song.patterns) { p.hook.v = 'harmon'; p.roots.hook = hook; }
  const sets = liveSets(song);
  assert(sets.includes(hook === 'fiddle' ? 'fiddle' : 'gtr'), 'the overriding lead remains preloaded');
  assert(!sets.some((n) => n.startsWith('jhm') || n === 'tpt'), 'ignored Harmon and its legacy fallback do not preload');
  song.artist.style = 'pop';
  assert(!liveSets(song).some((n) => n.startsWith('jhm')), 'saved roots also override a different project style');
  song.patterns.forEach((p) => { p.roots = null; });
  assert(liveSets(song).includes('jhm1'), 'without forced roots the saved Harmon still loads');
}
for (const style of ['boombap', 'lofihiphop']) {
  const song = { ...freshSong(style, 42), artist: { style } };
  for (const p of song.patterns) { p.hook.v = 'harmon'; p.roots = { style, chord: 'upright' }; }
  assert(liveSets(song).includes('jhm1'), 'an upright chord does not override the Harmon hook');
}
{
  const bossa = freshSong('bossa', 11);
  bossa.params.stab.voice = 18;
  for (const p of bossa.patterns) if (p.hook) p.hook.v = 'airflute';
  const banks = liveSets(bossa);
  assert(!banks.some((n) => n.startsWith('jep')), 'nylon Bossa must not wait on an unused electric piano');
  assert(banks.includes('jfl') && !banks.includes('jflb'), 'Bossa flute preloads its sustain performance, not unused expressive takes');
  assert(!banks.includes('fl') && !banks.includes('flb'), 'a fully loaded recorded Bossa flute does not require legacy fallback banks');
}
const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
const playSource = main.slice(main.indexOf('function play(opts = {})'), main.indexOf('\nfunction endTuning'));
for (const opts of [{ startsAt: 12345 }, { stepWall: 12345 }, { delay: .1 }]) {
  const calls = [];
  const play = runInNewContext(`${playSource}\nplay`, {
    playing: false, needsTuning: () => ({ load() { calls.push('load'); return new Promise(() => {}); } }),
    start: (got) => { assert.equal(got, opts); calls.push('start'); },
  });
  play(opts);
  assert.deepEqual(calls, ['load', 'start'], 'clock-synced playback loads in the background without waiting or changing the origin');
}
assert.deepEqual(liveSets(st(0, 1)), []);
assert.deepEqual(liveSets(st(1, 1)), ['kit']);
assert.deepEqual(liveSets(st(2, 8)), ['kit', 'gtr', 'gtrsoft']);
assert.deepEqual(liveSets(st(KIT_BACKBEAT, 1)), ['snare']);
assert.deepEqual(liveSets(st(1, 7)), ['kit', 'piano', 'pianosoft']);
assert.deepEqual(liveSets(st(0, 10)), ['str']);
assert.deepEqual(liveSets(st(1.2, 9.4)), ['kit', 'horn']);
assert.deepEqual(liveSets({}), []);
assert.deepEqual(liveSets({ artist: { style: 'pop' }, pattern: { hook: { v: 'reed' } } }), ['asax', 'asaxb'], 'pop reed is the recorded alto');
assert.deepEqual(liveSets({ artist: { style: 'boombap' }, pattern: { hook: { v: 'reed' } } }), ['tsax', 'tsaxb'], 'boom bap reed is the recorded tenor');
assert.deepEqual(liveSets({ artist: { style: 'country' }, pattern: { hook: { v: 'reed' } } }), [], 'other reed styles stay synthesized');

// Every generated song: live-kit genres always need the kit, and the chord instrument matches its stab voice.
for (const id of Object.keys(STYLES)) {
  if (STYLES[id].family === 'CLASSICAL') continue;
  for (let seed = 1; seed <= 12; seed++) {
    const g = generate(id, seed), sets = liveSets(g), band = STAB_BAND[Math.round(g.params.stab.voice)];
    if (['neosoul', 'boombap', 'breaks'].includes(id)) assert.ok(sets.includes('kit'), `${id}/${seed} needs the live kit`);
    assert.equal(sets.includes('snare'), ['drill', 'dnb'].includes(id), `${id}/${seed} snare-only sample set`);
    assert.equal(sets.includes('harp'), g.pattern.hook?.v === 'harpplk', `${id}/${seed} recorded harp hook`);
    assert.equal(sets.includes('ob'), g.pattern.hook?.v === 'oboe', `${id}/${seed} recorded oboe hook`);
    assert.equal(sets.includes('fl'), g.pattern.hook?.v === 'airflute' && !g.pattern.jazz, `${id}/${seed} legacy flute hook`);
    assert.equal(sets.includes(band), !!band, `${id}/${seed} stab band`);
    assert.equal(sets.includes('pianosoft'), band === 'piano', `${id}/${seed} soft piano layer`);
    // Country's Telecaster lead loads the guitar whatever plays the chords.
    assert.equal(sets.includes('gtrsoft'), band === 'gtr' || id === 'country', `${id}/${seed} soft guitar layer`);
  }
}

// Load the guitar for real (from disk, with a stub decoder) to exercise the lock.
const files = new Set();
const { promise: oboeAltReady, resolve: releaseOboeAlt } = Promise.withResolvers();
globalThis.fetch = async (url) => {
  const u = new URL(url);
  u.search = '';
  const file = u.pathname.split('/').pop();
  files.add(file);
  if (file.startsWith('obb_')) await oboeAltReady;
  const b = await readFile(u);
  return { ok: true, arrayBuffer: async () => b.buffer };
};
globalThis.OfflineAudioContext = class { decodeAudioData(b) { return Promise.resolve({ length: b.byteLength }); } };

const rec = (lock, name) => Engine.prototype.rec.call({ recLock: lock }, name);
{
  const local = { recLock: new Map() };
  for (const name of ['jhm1', 'jhm3']) assert.equal(Engine.prototype.rec.call(local, name), null);
  await loadSets(['jhm1', 'jhm3']);
  for (const name of ['jhm1', 'jhm3']) assert.ok(Engine.prototype.rec.call(local, name), 'a selected Harmon bank retries its cold miss after decoding during local playback');
}
{
  const local = { recLock: new Map() }, room = { recLock: new Map(), roomRecordings: true };
  assert.equal(Engine.prototype.rec.call(local, 'timproll'), null);
  assert.equal(Engine.prototype.rec.call(room, 'timproll'), null);
  await loadBand('timproll');
  assert.equal(Engine.prototype.rec.call(local, 'timproll'), null, 'ordinary playback retains its initial fallback');
  assert.ok(Engine.prototype.rec.call(room, 'timproll'), 'a live listener adopts the decoded bank without restarting the clock');
}
const feeds = (source, dest) => source === dest || dest.inputs.some((input) => feeds(source, input));
{
  const hands = {
    amapiano: ['shaker', 'conga'],
    afrobeats: ['conga', 'shaker', 'cowbell'],
    reggaeton: ['conga', 'timbale'],
    bailefunk: ['timbale', 'cuica'],
  };
  for (const [style, names] of Object.entries(hands)) {
    const g = generate(style, 1);
    assert.equal(g.params.perc.voice, HAND_KIT[style]);
    assert.deepEqual(liveSets(g).filter((n) => Object.values(hands).flat().includes(n)), names);
  }
  const amapiano = generate('amapiano', 1);
  assert.equal(amapiano.params.acid.voice, 4, 'keep the log drum');
  assert.equal(amapiano.pattern.hook.v, 'marimba');
  assert(liveSets(amapiano).includes('marimba'));
  const afro = Array.from({ length: 24 }, (_, i) => generate('afrobeats', i + 1)).find((g) => g.params.stab.voice === MARIMBA_STAB);
  assert(afro && liveSets(afro).includes('marimba'));

  const hits = [], fallbacks = [];
  const e = {
    state: amapiano, ch: { perc: { input: {} } }, playingPattern: amapiano.pattern, step: 0, recLock: new Map(),
    rec: Engine.prototype.rec, perc: Engine.prototype.perc, recordedHands: Engine.prototype.recordedHands,
    shaker: () => fallbacks.push('shaker'), playBuf: (...args) => hits.push(args),
  };
  e.perc(1, 0.7);
  await loadSets(Object.values(hands).flat().concat('marimba'));
  e.perc(2, 0.7);
  assert.deepEqual(fallbacks, ['shaker', 'shaker'], 'late decode does not replace the synth mid-song');
  assert.equal(hits.length, 0);

  for (const [style, names] of Object.entries(hands)) {
    e.state = generate(style, 1); e.playingPattern = e.state.pattern; e.recLock = new Map();
    const row = e.state.pattern.steps.perc;
    hits.length = 0;
    for (let i = 0; i < row.length; i++) if (row[i]) { e.step = i; e.perc(i + 1, 0.8); }
    assert.equal(hits.length, row.filter(Boolean).length, `${style} plays one recording per written hit`);
    for (const n of names) assert(hits.some(([buf]) => liveSet(n).includes(buf)), `${style} plays recorded ${n}`);
    const last = hits.at(-1);
    e.perc(100, 0.8);
    assert.equal(hits.at(-1)[0], last[0], 'the same grid position retains its take after a seek');
    assert.deepEqual(hits.at(-1).slice(2), last.slice(2), 'take and articulation do not depend on the playback clock');
  }
  const ctx = new FakeContext(1, 48000, 48000);
  const take = new AudioBuffer(1, 9600, 48000);
  const engine = { ctx, step: 3, rec: () => [take, take], gain: Engine.prototype.gain,
    startSource: Engine.prototype.startSource, filter: Engine.prototype.filter };
  const envelope = (decay) => {
    let env;
    engine.playBuf = (...args) => { env = Engine.prototype.playBuf.call(engine, ...args).g.gain; };
    Engine.prototype.recordedHands.call(engine, HAND_KIT.bailefunk, 0.1, 1, { tune: 220, decay }, ctx.destination);
    return env;
  };
  assert(envelope(0.18).at(0.23) > envelope(0.04).at(0.23) * 3, 'decay opens the body of a short cuíca recording');
  files.clear();
}
{
  const ctx = new FakeContext(2, 4096, 48000), state = defaultState(), out = ctx.createGain(), hits = [];
  state.key = 0;
  state.artist = { style: 'amapiano' };
  await loadSets(['marimba']);
  const e = {
    state, ctx, ch: { stab: { band: out } }, rec: Engine.prototype.rec,
    recordedNote: Engine.prototype.recordedNote, bodyFor: Engine.prototype.bodyFor,
    filter: Engine.prototype.filter, playBuf: (...args) => hits.push(args),
  };
  Engine.prototype.hook.call(e, 0.1, 0.7, 3, 0.3, 'marimba');
  const [take, , , eq, rate] = hits[0], f4 = liveSet('marimba').find(([m]) => m === 65);
  assert.equal(take, f4[1]);
  assert.equal(rate, 2 ** (-2 / 12), 'the EQ does not change the pitch or take');
  assert.equal(eq.type, 'peaking');
  assert.ok(eq.frequency.value > 2800 && eq.frequency.value < 3100 && eq.gain.value < -10);
  assert.ok(feeds(eq, out), 'the marimba hook notch feeds the band bus');
}
{
  const ctx = new FakeContext(2, 4096, 48000), state = defaultState(), out = ctx.createGain();
  const hits = [], fallback = new Error('synth fallback');
  state.key = 0;
  state.params.stab.voice = 16;
  state.patterns[5].hook = { v: 'oboe' };
  state.patterns[6].hook = { v: 'airflute' };
  const e = {
    state, ctx, ch: { stab: { input: out } }, rec: Engine.prototype.rec, recLock: new Map(),
    windDuck: ctx.createGain(),
    windHook: Engine.prototype.windHook, bodyFor: Engine.prototype.bodyFor, filter: Engine.prototype.filter,
    soulBand: () => false,
    trimOut: (key, db, dest) => { if (key.startsWith('hook-reed:')) throw fallback; return dest; },
    playBuf: (...args) => hits.push(args),
  };
  e.windDuck.connect(out);
  const hit = (voice, at = 1, take = 0) => Engine.prototype.hook.call(e, at, 0.6, 12, 0.3, voice, 0, false, 1, false, { take });
  assert.deepEqual(liveSets(state), ['cello', 'ob', 'obb', 'fl', 'flb'], 'preload both takes with the wind hooks');
  assert.throws(() => hit('oboe'), (err) => err === fallback);
  await loadBand('ob');
  assert.throws(() => hit('oboe'), (err) => err === fallback, 'a late decode keeps the same synth for this song');
  assert.equal(hits.length, 0, 'a missing wind does not switch to the recorded chords');
  e.recLock = new Map();
  hit('oboe', 1, 1);
  releaseOboeAlt();
  await loadSets(liveSets(state));
  hit('oboe', 1, 1);
  assert.equal(hits[0][0], hits[1][0], 'a late alternate does not change the recorded color mid-song');
  hits.length = 0;
  e.recLock = new Map();
  hit('oboe'); hit('airflute');
  assert.equal(hits.length, 2);
  for (const [i, [, t, , dest, rate, gate, fx]] of hits.entries()) {
    assert.equal(t, 1);
    assert.equal(gate, 0.3 * 0.92);
    assert.ok(feeds(dest, out), 'wind EQ feeds the hook bus');
    assert.ok(Math.abs(12 * Math.log2(rate) - [2.03, 0.05][i]) < 0.001, 'choose and tune the nearest recorded pitch');
    assert.ok(fx.ringOut, 'fade before the sample runs out');
  }
  state.patterns[7].hook = { v: 'tpt' };
  assert(liveSets(state).includes('tpt'), 'trumpet hooks preload their recording independently of chords');
  await loadSets(['tpt']);
  e.recLock = new Map();
  const trumpetAt = hits.length;
  hit('tpt');
  const trumpet = hits[trumpetAt];
  assert.equal(trumpet[5], 0.3 * 0.92);
  assert(trumpet[2] < 0.5, 'trumpet gain is conservative');
  assert(trumpet[6].fade >= 0.025, 'breath attack fades in');
  assert.equal(trumpet[6].vib, 6, 'held trumpet gets light delayed vibrato');
  assert(trumpet[6].ringOut, 'natural sample endings fade safely');
  for (const [voice, semitones] of [['oboe', 2.02], ['airflute', -0.02]]) {
    const i = hits.length;
    e.step = 32; hit(voice);
    e.step = 64; hit(voice, 1, 1);
    hit(voice, 5, 1);
    const [first, repeat, resumed] = hits.slice(i);
    assert.notEqual(first[0], repeat[0], 'repeated notes can use a different recording');
    assert.ok(Math.abs(12 * Math.log2(repeat[4]) - semitones) < 0.001, 'the alternate is tuned to the same pitch');
    assert.equal(first[5], repeat[5], 'variation does not change the written gate');
    assert.equal(first[1], repeat[1], 'variation does not move the scheduled note');
    assert.notEqual(first[6].offset, repeat[6].offset, 'the repeated note uses a different attack');
    assert.notEqual(first[6].lp, repeat[6].lp, 'the repeated note has different breath tone');
    assert.equal(repeat[0], resumed[0], 'the same score position keeps its take after a seek');
    assert.deepEqual(repeat.slice(2), resumed.slice(2), 'the attack is independent of the playback clock');
  }
  const preview = ctx.createGain();
  e.hookBus = preview;
  hit('oboe');
  const dest = hits.at(-1)[3];
  assert.ok(feeds(dest, preview) && !feeds(dest, e.windDuck), 'the preview bus can silence already scheduled winds');
  files.clear();
}
{
  const state = defaultState(), fallback = new Error('synth fallback'), hits = [];
  const ctx = new FakeContext(2, 4096, 48000);
  state.key = 0;
  state.params.stab.voice = 6;
  state.patterns.at(-1).hook = { v: 'harpplk' };
  assert.deepEqual(liveSets(state), ['harp'], 'load a hook from any part of a saved song');
  const e = {
    state, recLock: new Map(), rec: Engine.prototype.rec, harpHook: Engine.prototype.harpHook,
    ctx, filter: Engine.prototype.filter, chordTone: Engine.prototype.chordTone,
    ch: { stab: { input: ctx.createGain() } }, soulBand: () => false,
    trimOut: (key, db, dest) => { if (key.startsWith('hook-softmallet:')) throw fallback; return dest; },
    playBuf: (...args) => hits.push(args), bells: () => {},
  };
  const hit = (voice = 'harpplk', note = 12, velocity = 0.5) => Engine.prototype.hook.call(e, 1, velocity, note, 0.3, voice);
  const lateHarp = e.recLock;
  Engine.prototype.stab.call(e, 0.5, 0.8, true);
  assert.equal(lateHarp.has('harp'), false, 'a backing chord does not choose the hook timbre');
  e.recLock = new Map();
  assert.throws(hit, (err) => err === fallback);
  await loadSets(liveSets(state));
  assert.deepEqual([...files].sort(), BAND.harp.map((n) => `harp_${n}.flac`).sort());
  assert.throws(hit, (err) => err === fallback, 'a late download does not change the hook during playback');
  assert.throws(() => hit('softmallet'), (err) => err === fallback, 'saved mallets do not switch to the harp');
  e.recLock = lateHarp;
  hit();
  assert.equal(hits.length, 1);
  const [, t, , dest, rate, dur, fx] = hits[0];
  assert.equal(t, 1);
  assert.ok(feeds(dest, e.ch.stab.input), 'the harp EQ feeds the chord strip');
  hit('harpplk', 30);
  assert.equal(hits[1][3], dest, 'successive notes reuse the same EQ');
  assert.ok(hits[1][2] < hits[0][2], 'the highest transposed notes get less make-up gain');
  assert.ok(hits[1][6].attackGain < 1 && fx.attackGain == null, 'trim the upper attack without dulling the lower plucks');
  hit('harpplk', 12, 0.8);
  hit('harpplk', 12, 1);
  assert.equal(hits[2][2], hits[3][2], 'very hard plucks do not overload the harp stem');
  assert.ok(Math.abs(12 * Math.log2(rate) - 0.11) < 0.001, 'choose the nearest recorded pitch, not the file label');
  assert.equal(dur, 0.3 * 0.92);
  assert.equal(fx.offset, 0.002, 'trim just the lead-in before the pluck');
  files.clear();
}
{
  const state = defaultState(), ctx = new FakeContext(2, 4096, 48000), out = ctx.createGain(), hits = [];
  state.params.stab.voice = 6;
  const e = {
    state, ctx, rec: Engine.prototype.rec, recLock: new Map([['harp', false]]),
    stab: Engine.prototype.stab, harpBacking: Engine.prototype.harpBacking, filter: Engine.prototype.filter, chordTone: Engine.prototype.chordTone,
    ch: { stab: { input: out } }, trimOut: (key, db, dest) => dest,
    soulBand: () => false, bells: (...args) => hits.push(args),
  };
  const hit = (underHarp) => Engine.prototype.trigger.call(e, 'stab', 1, 0.8, underHarp);
  hit(true);
  e.recLock = new Map();
  hit(false);
  hit(true);
  hit(true);
  for (const [, , , , p, dest] of hits.slice(0, 2)) {
    assert.equal(p, state.params.stab, 'fallback and unaccompanied bells keep their original ring');
    assert.equal(dest, out);
  }
  const [, , pitches, root, p, dest] = hits[2];
  assert.deepEqual([pitches, root], hits[1].slice(2, 4), 'the backing uses the same chord voicing');
  assert.ok(p.decay < state.params.stab.decay, 'the recorded harp gets a shorter bell tail');
  assert.equal(dest, hits[3][5], 'backing chords reuse the presence cut');
  assert.ok(feeds(dest, out), 'the shared bell EQ feeds the chord strip');
}
{
  const { pattern } = generate('drill', 8);
  const i = pattern.steps.stab.findIndex(Boolean);
  const hit = (pat) => Sequencer.prototype.gridHit.call({ s: { artist: { style: 'minimal' } } }, 'stab', pat,
    { abs: i, tt: 1, bar: 0, i16: i, rp: -1, n: 16, hum: 0 });
  assert.equal(hit(pattern).args[3], true, 'replayed harp arrangements do not depend on listener artist metadata');
  assert.equal(hit({ ...pattern, hook: { ...pattern.hook, v: 'softmallet' } }).args.length, 3, 'saved synth hooks keep their bell backing');
}
{
  const state = st(KIT_BACKBEAT, 1), seen = [];
  const part = {
    state, recLock: new Map(), rec: Engine.prototype.rec, sampledHit: Engine.prototype.sampledHit,
    liveHit: (samples, take, id, t, v, rate, _dur, touch) => { assert.ok(samples[take]); seen.push([id, take, t, v, rate, touch]); },
    snare: () => seen.push('synth snare'), kick: () => seen.push('synth kick'), hat: () => seen.push('synth hat'),
  };
  const hit = (id, t = 1) => Engine.prototype.trigger.call(part, id, t, 0.9);
  assert.equal(setsReady(liveSets(state)), false);
  hit('snare');
  await loadSets(liveSets(state));
  assert.deepEqual([...files].sort(), LIVE_KIT.snare.map((n) => `${n}.flac`).sort(), 'preload only the snare takes');
  assert.equal(setsReady(liveSets(state)), true);
  hit('snare');
  assert.deepEqual(seen.splice(0), ['synth snare', 'synth snare'], 'a cold song keeps its fallback');
  part.recLock = new Map();
  hit('kick'); hit('ch'); hit('oh');
  assert.deepEqual(seen.splice(0), ['synth kick', 'synth hat', 'synth hat']);
  for (let i = 0; i < 16; i++) { part.step = i * 16 + 8; hit('snare', i + 2); }
  assert.ok(seen.every(([id, , t, v], i) => id === 'snare' && t === i + 2 && v > 1), 'recorded backbeat keeps timing and lift');
  const takes = seen.map(([, take]) => take);
  assert.equal(new Set(takes).size, 4, 'hard strokes use four recordings');
  assert.ok(takes.every((take, i) => take !== takes[i - 1]), 'consecutive strokes in the same layer stay distinct');
  const rates = seen.map(([, , , , rate]) => rate);
  assert.ok(rates.every((rate) => Math.abs(rate - 1) <= 0.013));
  assert.ok(new Set(rates).size > new Set(takes).size, 'pitch varies even when a take repeats');
  const touches = seen.map(([, , , , , touch]) => touch);
  assert.ok(Math.min(...touches) < -0.32 && Math.max(...touches) > 0.32,
    'identical written accents still have lighter and heavier strikes');
  assert.ok(touches.slice(1).every((touch, i) => Math.abs(touch - touches[i]) <= 0.74),
    'intermediate bars bridge the strongest and softest strokes');
  const levels = seen.map(([, , , level]) => level);
  assert.ok(20 * Math.log10(Math.max(...levels) / Math.min(...levels)) > 0.5,
    'the strike changes playback level as well as tone');
  assert.ok(Math.max(...levels) < 0.85 * 2.5 * 0.9 ** 1.4,
    'shaped accents never boost the unshaped attack');
  seen.length = 0;
  for (let t = 20; t < 28; t++) {
    hit('kick', t);
    hit('snare', t + 0.012);
  }
  const paired = seen.filter(([id]) => id === 'snare');
  assert.equal(paired.length, 8);
  assert.deepEqual([...new Set(paired.map(([, take]) => take))].sort(), ['snare_v33', 'snare_v34']);
  assert.ok(paired.every(([, , , , rate]) => Math.abs(rate - 1) <= 0.006), 'kick overlaps keep the original attack');
  assert.ok(paired.every(([, , , level, , touch]) => touch === undefined && level === 0.85 * 2.5 * 0.9 ** 1.4),
    'kick overlaps keep the original snare level and EQ');

  const soft = (kit) => {
    const strikes = [];
    const e = { state: st(kit, 1), liveHit: (_samples, take, _id, _t, _v, rate, _dur, touch) => {
      if (take === 'snare_v5' || take === 'snare_v6') assert.equal(touch, undefined, 'ghosts stay under the backbeat');
      strikes.push([take, rate]);
    } };
    for (const v of [0.67, 0.38, 0.7, 0.38]) Engine.prototype.sampledHit.call(e, {}, 'snare', 1, v);
    return strikes;
  };
  assert.deepEqual(soft(KIT_BACKBEAT), soft(1), 'softer strokes keep the regular kit takes and detune range');

  const shape = (kit, decay, touch) => Engine.prototype.liveFx.call({
    state: { master: { kit }, params: { snare: { tune: 211, snappy: 0.64, decay } } },
  }, 'snare', { duration: 0.8 }, touch);
  const backbeat = shape(KIT_BACKBEAT, 0.15), live = shape(1, 0.15);
  assert.ok(backbeat.dur + backbeat.fx.release * 4.6 < 0.3, 'default backbeat damps by 40 dB in 300 ms');
  assert.ok(backbeat.fx.peaks.some(([hz, , dB]) => hz === 630 && dB < 0));
  assert.ok(shape(KIT_BACKBEAT, 0.3).dur > backbeat.dur, 'the decay knob still opens the snare up');
  assert.ok(live.dur > backbeat.dur && !live.fx.release, 'the full live kit retains its longer tail');
  const light = shape(KIT_BACKBEAT, 0.15, -0.65), hard = shape(KIT_BACKBEAT, 0.15, 0.65);
  assert.equal(light.dur, hard.dur, 'strike variation leaves the damped tail intact');
  assert.ok(light.fx.peaks.at(-1)[2] < -2 && hard.fx.peaks.at(-1)[2] > 2,
    'lighter strokes are darker and harder strokes add crack');
  assert.deepEqual(shape(1, 0.15, 0.65), live, 'the full recorded kit is untouched');
  assert.equal(backbeat.fx.strokeBody, undefined, 'unshaped hits have no body envelope');
  const ctx = new FakeContext(2, 48000, 48000);
  const player = { ctx, gain: Engine.prototype.gain, startSource: Engine.prototype.startSource };
  const sample = new AudioBuffer(1, 12000, 48000);
  const envelope = ({ dur, fx }) => Engine.prototype.playBuf.call(
    player, sample, 1, 0.7, ctx.destination, 1, dur, { strokeBody: fx.strokeBody },
  ).g.gain;
  const quiet = envelope(light), full = envelope(hard), clipped = envelope(shape(KIT_BACKBEAT, 0.08, 0.65));
  assert.equal(full.at(1.04), quiet.at(1.04), 'the body envelope starts after the attack');
  assert.ok(full.at(1.072) > 0.7 && quiet.at(1.072) < 0.7, 'the body follows the strength of the strike');
  assert.equal(full.at(1.12), quiet.at(1.12), 'both strokes return to the same damping level');
  assert.equal(clipped.at(1.072), 0.7, 'short user-selected decays skip the body envelope');
}
const song = new Map();
assert.equal(setsReady(['gtr']), false);
assert.equal(rec(song, 'gtr'), null, 'not loaded yet: the stand-in plays');
await loadSets(['gtr']);
assert.equal(setsReady(['gtr']), true);
assert.equal(rec(song, 'gtr'), null, 'arrived mid-song: the part keeps its stand-in');
assert.ok(rec(new Map(), 'gtr'), 'the next song plays the recording');
assert.ok(rec(null, 'gtr'), 'outside a song (renders, auditions) the recording plays');
const later = new Map();
assert.ok(rec(later, 'gtr'));
assert.ok(rec(later, 'gtr'), 'a recording used from the first note stays');
assert.equal(rec(later, 'kit'), null);
await loadSets(['kit']);
assert.equal(rec(later, 'kit'), null, 'each set is locked on its own');
assert.ok(files.has('gtr_40.flac') && files.has(`${LIVE_FILES[0]}.flac`));
assert.deepEqual(await loadSets([]), []);
{
  const ctx = new FakeContext(2, 4096, 48000), state = defaultState(), hits = [];
  const stab = { input: ctx.createGain(), band: ctx.createGain() }, gtr = [[63, {}]];
  const e = {
    state, ctx, ch: { stab }, playbackStyle: 'reggaeton', rec: (name) => name === 'gtr' ? gtr : null,
    recordedNote: Engine.prototype.recordedNote, recorded: Engine.prototype.recorded,
    pedalFor: () => null, bodyFor: Engine.prototype.bodyFor, filter: Engine.prototype.filter,
    playBuf: (...args) => { hits.push(args); }, pluck: (...args) => hits.push(args),
  };
  const chord = () => {
    e.lastGrip = null; e.stroke = null;
    Engine.prototype.guitar.call(e, 1, 0.7, [0, 3, 7], 56, state.params.stab, stab.input);
  };
  chord();
  const voiced = hits.splice(0), cut = voiced[0][3];
  assert.ok(voiced.length > 1 && voiced.every((hit) => hit[3] === cut), 'all chord strings share one EQ');
  assert.equal(cut.type, 'peaking');
  assert.ok(cut.frequency.value >= 2945 && cut.frequency.value <= 2980 && cut.gain.value < 0);
  assert.ok(feeds(cut, stab.band), 'the EQ feeds the recorded-instrument bus instead of the synth strip');
  e.playbackStyle = 'afrobeats';
  chord();
  const control = hits.splice(0);
  assert.ok(control.every((hit) => hit[3] === stab.band), 'guitar chords outside Reggaeton keep the original routing');
  const withoutRoute = ([buf, t, v, , rate, dur, fx]) => [buf, t, v, rate, dur, fx];
  assert.deepEqual(voiced.map(withoutRoute), control.map(withoutRoute), 'the cut preserves the recorded voicing, timing and gains');
  e.playbackStyle = 'reggaeton';
  e.rec = () => null;
  chord();
  assert.equal(hits[0][5], stab.input, 'the synth fallback stays unfiltered');
}
console.log('live-kit preload + per-song lock passed');

{
  globalThis.AudioBuffer = AudioBuffer;
  globalThis.window = { AudioContext: class extends FakeContext { constructor() { super(2, 4096, 48000); } } };
  const fetchFile = globalThis.fetch;
  let allowGuitar, allowJazz, finishWaiting;
  const guitarReady = new Promise((r) => { allowGuitar = r; });
  const jazzReady = new Promise((r) => { allowJazz = r; });
  globalThis.fetch = async (url) => {
    if (String(url).includes('/agtr')) await guitarReady;
    if (String(url).includes('/jazz')) await jazzReady;
    return fetchFile(url);
  };
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => {
    if (ms !== 8000) return realTimeout(fn, ms, ...args);
    finishWaiting = fn;
    return 0;
  };
  const tick = Sequencer.prototype.tick, scheduled = [];
  let engine, starts = 0;
  Sequencer.prototype.tick = function () {
    engine = this.e;
    const names = engine.state.params.stab.voice === 12 ? ['agtr', 'agtrb'] : ['jazz', 'jazzb'];
    scheduled.push(names.map((name) => !!engine.rec(name)));
  };
  const player = createPlayer({ onStart: () => starts++ });
  const release = { ...defaultState(), fresh: 0 };
  release.params.stab.voice = 12;
  try {
    assert.equal(setsReady(['agtr']), false);
    player.play(release);
    assert.equal(player.playing, true, 'stop is available even while instruments are loading');
    assert.equal(player.loading, true);
    assert.deepEqual(scheduled, [], 'the first downbeat waits for the recordings rather than using a synth');
    player.stop();
    assert.equal(player.loading, false);
    player.play(release);
    allowGuitar();
    await loadSets(['agtr', 'agtrb']);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(scheduled, [[true, true]], 'only the latest play starts, with both guitar takes on the first step');
    assert.equal(player.loading, false);
    assert.equal(starts, 1);

    release.params.stab.voice = 13;
    player.play(release);
    assert.equal(player.loading, true);
    finishWaiting();
    assert.deepEqual(scheduled, [[true, true], [false, false]], 'slow downloads do not block playback forever');
    const fallbackEngine = engine;
    allowJazz();
    await loadSets(['jazz', 'jazzb']);
    await new Promise((r) => setImmediate(r));
    assert.equal(fallbackEngine.rec('jazz'), null, 'a late recording does not change the sound mid-song');
    assert.equal(starts, 2, 'late downloads do not restart playback');
    player.play(release);
    assert.deepEqual(scheduled.at(-1), [true, true], 'the next play uses the cached recordings');
  } finally {
    player.stop();
    allowGuitar();
    allowJazz();
    globalThis.setTimeout = realTimeout;
    Sequencer.prototype.tick = tick;
    globalThis.fetch = fetchFile;
  }
}
console.log('public player instrument readiness and fallback passed');
