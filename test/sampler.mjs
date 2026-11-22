import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AudioBuffer, OfflineAudioContext, installGlobals } from './offline-audio.mjs';
import { getSample, prepareSample, synthVoxChannels, voxSeed, useSynthVox, setFromArrayBuffer } from '../js/sampler.js';
import { defaultState, freshSong, clone, sanitize } from '../js/state.js';
import { normalizeSet } from '../api/_lib/rooms.js';
import { normalizeTrack } from '../api/_lib/crate.js';
import { songOf } from '../js/player.js';
import { dailyDrop, dropSong } from '../js/daily.js';
import { Engine } from '../js/engine.js';

installGlobals();
const hash = (d) => createHash('sha256').update(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)).digest('hex');
const pcm = (s) => hash(getSample(s).buffer.getChannelData(0));
const song = (seed) => ({ ...freshSong('jerseyclub', seed), artist: { style: 'jerseyclub', seed } });

const random = Math.random;
try {
  Math.random = () => { throw Error('Built-in VOX must not use ambient randomness'); };
  assert.equal(hash(synthVoxChannels(48000, 42)[0]), hash(synthVoxChannels(48000, 42)[0]));
  assert.notEqual(hash(synthVoxChannels(48000, 42)[0]), hash(synthVoxChannels(48000, 43)[0]));
  const s = song(42), a = getSample(s);
  assert.equal(getSample(clone(s)), a, 'same seed reuses the lazy sample');
  assert.equal(getSample(), a, 'UI reads do not reset the song seed');
  const b = getSample(song(43));
  assert.notEqual(b, a);
  assert.notEqual(hash(b.buffer.getChannelData(0)), hash(a.buffer.getChannelData(0)));
  assert.equal(pcm(s), hash(a.buffer.getChannelData(0)), 'returning to a song recreates its exact PCM');
  assert.deepEqual(getSample(s).slices, a.slices);
  const queued = prepareSample(song(43));
  assert.equal(getSample(), a, 'warming a future song does not change the playing source');
  assert.equal(getSample(song(43)), queued, 'a planned handoff reuses its prepared sample');
  assert.equal(getSample(s), a, 'returning to a cached seed reuses its exact buffer and slices');
  const fallback = prepareSample(null);
  for (let seed = 1000; seed < 1016; seed++) prepareSample(song(seed));
  assert.equal(getSample(), a, 'warming many songs preserves the current source');
  assert.equal(prepareSample(null), fallback, 'the saved-replay fallback stays warm');
  const recreated = prepareSample(song(43));
  assert.notEqual(recreated, queued, 'unused seed entries are evicted from the bounded cache');
  assert.equal(hash(recreated.buffer.getChannelData(0)), hash(queued.buffer.getChannelData(0)));
  for (const state of [undefined, null, {}, { artist: {} }, { artist: { seed: NaN } }, { artist: { seed: Infinity } }]) {
    assert.equal(voxSeed(state), 0, 'legacy/invalid state uses the stable fallback');
  }
  assert.equal(pcm(defaultState()), pcm(sanitize(defaultState())));
  assert.equal(voxSeed({ artist: { seed: 0 } }), 0, 'zero is a valid seed');
  const ctx = new OfflineAudioContext(1, 48000, 48000), engine = new Engine(ctx, s, { realtime: false });
  engine.vox(0.05, 0.5, 0);
  assert.equal(getSample().seed, 42);
  engine.state = song(43);
  engine.vox(0.2, 0.5, 1);
  assert.equal(getSample().seed, 43, 'existing playback engine follows song handoffs');
  engine.state.artist.seed = 44;
  engine.vox(0.4, 0.5, 2);
  assert.equal(getSample().seed, 44, 'in-place seed changes invalidate the sample');
  engine.replay808Style = 'jerseyclub';
  engine.vox(0.6, 0.5, 3);
  const replayHash = pcm(null);
  engine.state = song(999);
  engine.vox(0.8, 0.5, 4);
  assert.equal(hash(getSample().buffer.getChannelData(0)), replayHash, 'metadata-free saved room replays ignore each listener\'s private project seed');
  assert.equal(getSample().seed, 0);
  const replaySample = getSample();
  for (const seed of [42, 43, 999]) {
    getSample(song(seed));
    engine.state = song(seed);
    engine.vox(0.9, 0.5, 5);
    assert.equal(getSample(), replaySample, 'private UI reads and saved replay notes reuse cached assets instead of regenerating');
  }
} finally { Math.random = random; }

for (const seed of [0, 42, 43]) {
  const host = song(seed);
  const wire = JSON.parse(JSON.stringify(normalizeSet({ state: clone(host), style: 'jerseyclub', startsAt: 1000 }, 0)));
  const listener = sanitize(clone(wire.state));
  const release = JSON.parse(JSON.stringify(normalizeTrack({ state: { ...clone(host), fresh: 0 }, style: 'jerseyclub', title: 'Test' })));
  const published = songOf(release.state);
  const engine = new Engine(new OfflineAudioContext(1, 48000, 48000), host, { realtime: false });
  const expected = pcm(host);
  for (const s of [host, listener, published]) {
    engine.state = s;
    engine.vox(0.05, 0.5, 0);
    assert.equal(getSample().seed, seed, 'the playback/render dispatch uses the transmitted seed');
    assert.equal(hash(getSample().buffer.getChannelData(0)), expected);
    assert.equal(voxSeed(s), seed, 'host, listener and published player share artist.seed, not client/track id');
    assert.equal(pcm(s), pcm(host));
    assert.deepEqual(getSample(s).slices, getSample(host).slices);
  }
}
const drop = dailyDrop('2026-11-20'), first = dropSong(drop), second = songOf(JSON.parse(JSON.stringify(dropSong(drop))));
assert.equal(voxSeed(first), drop.seed);
assert.equal(pcm(first), pcm(second), 'Daily Drop local and public playback share the daily seed');

const offline = globalThis.OfflineAudioContext;
try {
  globalThis.OfflineAudioContext = class {
    async decodeAudioData() {
      const b = new AudioBuffer({ numberOfChannels: 1, length: 4800, sampleRate: 48000 });
      b.getChannelData(0).fill(0.25);
      return b;
    }
  };
  for (const source of ['file', 'mic']) {
    const custom = await setFromArrayBuffer(new ArrayBuffer(0), 'My sample', source), before = hash(custom.buffer.getChannelData(0));
    assert.equal(getSample(song(42)), custom);
    assert.equal(getSample(song(43)), custom, `${source} buffers are not replaced on song changes`);
    assert.equal(prepareSample(song(999)), custom, 'preparation leaves user audio untouched');
    assert.equal(getSample(), custom);
    assert.equal(hash(custom.buffer.getChannelData(0)), before);
    assert.equal(getSample().source, source);
  }
} finally { globalThis.OfflineAudioContext = offline; }
useSynthVox();
assert.equal(getSample().seed, 43, 'switching back from user audio uses the current song');
assert.equal(pcm(song(43)), hash(synthVoxChannels(48000, 43)[0]));
console.log('sampler: seeded PCM/slices, cache/handoffs, stable fallback, host/listener/release/Daily Drop parity and untouched file/mic samples passed');
