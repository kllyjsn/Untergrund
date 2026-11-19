// Live-kit preloading: which recordings a song needs, and the per-song lock that keeps a part on one sound.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { liveSets, setsReady, loadSets, loadBand, BAND, STAB_BAND, LIVE_FILES, LIVE_KIT } from '../js/livekit.js';
import { Engine, Sequencer } from '../js/engine.js';
import { KIT_BACKBEAT } from '../js/params.js';
import { defaultState, generate, STYLES } from '../js/state.js';
import { createPlayer } from '../js/player.js';
import { OfflineAudioContext as FakeContext, AudioBuffer } from './offline-audio.mjs';

const st = (kit, voice) => ({ master: { kit }, params: { stab: { voice } } });
assert.deepEqual(liveSets(st(0, 1)), []);
assert.deepEqual(liveSets(st(1, 1)), ['kit']);
assert.deepEqual(liveSets(st(2, 8)), ['kit', 'gtr', 'gtrsoft']);
assert.deepEqual(liveSets(st(KIT_BACKBEAT, 1)), ['snare']);
assert.deepEqual(liveSets(st(1, 7)), ['kit', 'piano', 'pianosoft']);
assert.deepEqual(liveSets(st(0, 10)), ['str']);
assert.deepEqual(liveSets(st(1.2, 9.4)), ['kit', 'horn']);
assert.deepEqual(liveSets({}), []);

// Every generated song: live-kit genres always need the kit, and the chord instrument matches its stab voice.
for (const id of Object.keys(STYLES)) {
  if (STYLES[id].family === 'CLASSICAL') continue;
  for (let seed = 1; seed <= 12; seed++) {
    const g = generate(id, seed), sets = liveSets(g), band = STAB_BAND[Math.round(g.params.stab.voice)];
    if (['neosoul', 'boombap'].includes(id)) assert.ok(sets.includes('kit'), `${id}/${seed} needs the live kit`);
    assert.equal(sets.includes('snare'), id === 'drill', `${id}/${seed} snare-only sample set`);
    assert.equal(sets.includes('harp'), g.pattern.hook?.v === 'harpplk', `${id}/${seed} recorded harp hook`);
    assert.equal(sets.includes('ob'), g.pattern.hook?.v === 'oboe', `${id}/${seed} recorded oboe hook`);
    assert.equal(sets.includes('fl'), g.pattern.hook?.v === 'airflute', `${id}/${seed} recorded flute hook`);
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
const feeds = (source, dest) => source === dest || dest.inputs.some((input) => feeds(source, input));
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
    trimOut: (key, db, dest) => { if (key === 'hook-reed') throw fallback; return dest; },
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
    ctx, filter: Engine.prototype.filter,
    ch: { stab: { input: ctx.createGain() } }, soulBand: () => false,
    trimOut: (key, db, dest) => { if (key === 'hook-softmallet') throw fallback; return dest; },
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
    stab: Engine.prototype.stab, harpBacking: Engine.prototype.harpBacking, filter: Engine.prototype.filter,
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
