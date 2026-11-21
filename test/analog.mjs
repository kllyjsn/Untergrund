import assert from 'node:assert/strict';
import { OfflineAudioContext, installGlobals } from './offline-audio.mjs';
installGlobals();
const { freshSong, INSTRUMENTS, STYLES } = await import('../js/state.js');
const { instrumentFor } = await import('../js/palette-defaults.js');
const { Engine } = await import('../js/engine.js');
const { analogSet, liveSets, loadBand, bandKit } = await import('../js/livekit.js');

const mapping = {
  hypnotic: { 2: 'juno' }, ambient: { 2: 'juno' }, peak: { 2: 'jpad', 4: 'jxbr' },
  hardtechno: { 2: 'jpad' }, trance: { 2: 'jxstr', 4: 'jbr' }, industrial: { 4: 'jxbr' },
  electro: { 4: 'jxbr' }, electrohiphop: { 4: 'jxbr' },
};
function instrument(style, seed = 42) {
  const state = freshSong(style, seed), ctx = new OfflineAudioContext(2, 48000, 48000), nodes = [];
  state.artist = { style, seed };
  const e = new Engine(ctx, state, { realtime: false });
  for (const method of ['createBufferSource', 'createOscillator', 'createGain']) {
    const make = ctx[method].bind(ctx);
    ctx[method] = (...args) => { const node = make(...args); nodes.push(node); return node; };
  }
  return { e, ctx, nodes };
}
for (const style of Object.keys(STYLES)) for (const voice of [0, 2, 4, 10]) {
  const expected = mapping[style]?.[voice] || null, s = freshSong(style, 42);
  s.artist = { style, seed: 42 };
  s.params.stab.voice = voice;
  assert.equal(analogSet(style, voice), expected);
  const sets = liveSets(s);
  for (const name of ['juno', 'jpad', 'jxstr', 'jxbr', 'jbr', 'dpad'])
    assert.equal(sets.includes(name), name === expected || style === 'dub' && name === 'dpad', `${style}/${voice}: ${name} preload`);
}
for (const [style, voices] of Object.entries(mapping)) for (const voice of Object.keys(voices).map(Number)) {
  const { e, nodes } = instrument(style), args = [0.1, 0.8, [0, 3, 7], 60, e.state.params.stab, e.ch.stab.input];
  const method = voice === 2 ? 'pad' : 'brass';
  e.rec = () => null;
  e[method](...args);
  assert(nodes.some(n => n.frequency && n.detune), `${style}: missing buffers use synth`);
  nodes.length = 0;
  e.rec = () => [];
  e[method](...args);
  assert(nodes.some(n => n.frequency && n.detune), `${style}: empty buffers use synth`);
  nodes.length = 0;
  const set = await loadBand(voices[voice]);
  assert(set?.length);
  e.rec = () => set;
  e[method](...args);
  const sources = nodes.filter(n => n.buffer);
  assert.equal(sources.length, 3, `${style}: one recording per chord tone`);
  assert(sources.every(n => n.loop && n.loopStart > 0 && n.loopEnd < n.buffer.duration - 0.08));
  assert(!nodes.some(n => n.frequency && n.detune), `${style}: loaded recordings replace oscillators`);
  sources.forEach((source, k) => {
    const m = 60 + args[2][k], nearest = set.reduce((a, b) => Math.abs(a[0] - m) <= Math.abs(b[0] - m) ? a : b);
    assert(Math.abs(source.playbackRate.value - 2 ** ((m - nearest[0]) / 12)) < 1e-9, 'measured nearest center, including BAND_TUNE');
    assert.equal(source.buffer.numberOfChannels, nearest[1].numberOfChannels);
    assert.notEqual(source.buffer, nearest[1], 'loop preparation does not modify original decoded audio');
    const a = Math.round(source.loopStart * source.buffer.sampleRate), b = Math.round(source.loopEnd * source.buffer.sampleRate);
    for (let ch = 0; ch < source.buffer.numberOfChannels; ch++) {
      const loop = source.buffer.getChannelData(ch), raw = nearest[1].getChannelData(ch);
      assert.equal(loop[b - 1], raw[a - 1], 'crossfade ends on the sample preceding the loop start');
      assert.equal(loop[a], raw[a], 'loop start is unchanged');
    }
    assert(source.t1 > 0.1 + (voice === 2 ? args[4].decay * 2 : args[4].decay * 0.8), 'release is scheduled');
    if (style === 'hardtechno') {
      assert.equal(source.detune.at(0.1), 240);
      assert(source.detune.at(0.11) - source.detune.at(0.15) > 150, 'Hard Techno attack settles');
    }
  });
  nodes.length = 0;
  e[method](0.1, 0.8, [], 60, args[4], args[5]);
  assert.equal(nodes.length, 0, 'empty chord is silent');
}
{
  const { e, nodes } = instrument('dub');
  const set = await loadBand('dpad'); e.rec = () => set;
  e.dubPad(0.1, 0.8, [0, 3, 7], 48);
  let sources = nodes.filter(n => n.buffer);
  assert.equal(sources.length, 6, 'Dub retains its two stereo seats');
  assert(sources.every(n => n.loop && n.t1 > e.stepDur * 24 + 5));
  e.dubPad(0.1 + e.stepDur * 47, 0.8, [0, 3, 7], 48);
  assert.equal(nodes.filter(n => n.buffer).length, 6, 'Dub does not retrigger before 48 steps');
  e.dubPad(0.1 + e.stepDur * 48 + 1e-6, 0.8, [0, 3, 7], 48);
  assert.equal(nodes.filter(n => n.buffer).length, 12);
  const fallback = instrument('dub'); fallback.e.rec = () => null;
  fallback.e.dubPad(0.1, 0.8, [0, 3, 7], 48);
  assert.equal(fallback.nodes.filter(n => n.frequency && n.detune).length, 6, 'Dub missing-buffer synth fallback');
}
for (const [style, voices] of Object.entries(mapping)) for (const tuple of INSTRUMENTS[style]) if (voices[tuple[0]]) {
  let seed = 1; while (instrumentFor(INSTRUMENTS[style], seed) !== tuple) seed++;
  assert.equal(freshSong(style, seed).params.stab.voice, tuple[0]);
}
assert(bandKit('jxbr').every(([center]) => Math.abs(center - Math.round(center)) > 0), 'Brassy measured tuning is loaded');
assert.equal(bandKit('jxbr')[0][0], 48 - 23.6 / 100);
console.log('analog: style/tuple preloads, synth fallbacks, measured pitch, stereo crossfaded loops, release, Hard Techno attack and Dub cadence passed');
