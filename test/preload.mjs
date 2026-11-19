// Live-kit preloading: which recordings a song needs, and the per-song lock that keeps a part on one sound.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { liveSets, setsReady, loadSets, STAB_BAND, LIVE_FILES, LIVE_KIT } from '../js/livekit.js';
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
    assert.equal(sets.includes(band), !!band, `${id}/${seed} stab band`);
    assert.equal(sets.includes('pianosoft'), band === 'piano', `${id}/${seed} soft piano layer`);
    // Country's Telecaster lead loads the guitar whatever plays the chords.
    assert.equal(sets.includes('gtrsoft'), band === 'gtr' || id === 'country', `${id}/${seed} soft guitar layer`);
  }
}

// Load the guitar for real (from disk, with a stub decoder) to exercise the lock.
const files = new Set();
globalThis.fetch = async (url) => { const u = new URL(url); u.search = ''; files.add(u.pathname.split('/').pop()); const b = await readFile(u); return { ok: true, arrayBuffer: async () => b.buffer }; };
globalThis.OfflineAudioContext = class { decodeAudioData(b) { return Promise.resolve({ length: b.byteLength }); } };

const rec = (lock, name) => Engine.prototype.rec.call({ recLock: lock }, name);
{
  const state = st(KIT_BACKBEAT, 1), seen = [];
  const part = {
    state, recLock: new Map(), rec: Engine.prototype.rec, sampledHit: Engine.prototype.sampledHit,
    liveHit: (samples, take, id, t, v) => { assert.ok(samples[take]); seen.push([id, take, t, v]); },
    snare: () => seen.push('synth snare'), kick: () => seen.push('synth kick'), hat: () => seen.push('synth hat'),
  };
  const hit = (id) => Engine.prototype.trigger.call(part, id, 1, 0.9);
  assert.equal(setsReady(liveSets(state)), false);
  hit('snare');
  await loadSets(liveSets(state));
  assert.deepEqual([...files].sort(), LIVE_KIT.snare.map((n) => `${n}.flac`).sort(), 'preload only the snare takes');
  assert.equal(setsReady(liveSets(state)), true);
  hit('snare');
  assert.deepEqual(seen.splice(0), ['synth snare', 'synth snare'], 'a cold song keeps its fallback');
  part.recLock = new Map();
  hit('kick'); hit('ch'); hit('oh'); hit('snare'); hit('snare');
  assert.deepEqual(seen.slice(0, 3), ['synth kick', 'synth hat', 'synth hat']);
  assert.deepEqual(seen.slice(3).map(([id, take, t]) => [id, take, t]),
    [['snare', 'snare_v34', 1], ['snare', 'snare_v33', 1]], 'first hit uses a recording and repeats alternate takes');
  assert.ok(seen[3][3] > 1, 'sample is lifted to sit over the machine drums');
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
