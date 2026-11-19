import assert from 'node:assert/strict';
import { freshSong, generate, sanitize } from '../js/state.js';
import { OfflineAudioContext, installGlobals } from './offline-audio.mjs';
import { Engine, MASTER_TONE } from '../js/engine.js';

installGlobals();
for (let seed = 1; seed <= 64; seed++) {
  const g = generate('hardtechno', seed);
  assert([0, 2].includes(g.params.stab.voice));
  assert.equal(g.params.acid.voice, 3);
  assert.equal(g.pattern.hook.v, 'analog');
  assert(g.pattern.hook.s.filter(Boolean).length >= 6);
  assert(g.params.stab.cutoff < 1300);
  assert(g.params.acid.reso < 4);
}
const state = freshSong('hardtechno', 42);
state.artist = { ...state.artist, style: 'hardtechno' };
assert.equal(sanitize(state).artist.style, 'hardtechno');
assert(MASTER_TONE.hardtechno[2] < 0 && MASTER_TONE.hardtechno[3] < 0);

function instrument(style) {
  const s = freshSong(style, 42);
  s.artist = { ...s.artist, style };
  const ctx = new OfflineAudioContext(2, 48000, 48000);
  const nodes = [];
  for (const method of ['createGain', 'createBiquadFilter', 'createWaveShaper']) {
    const original = ctx[method].bind(ctx);
    ctx[method] = () => { const node = original(); nodes.push({ method, node }); return node; };
  }
  const e = new Engine(ctx, s, { realtime: false });
  nodes.length = 0;
  return { e, nodes };
}
for (const style of ['hardtechno', 'minimal']) {
  const { e, nodes } = instrument(style), hard = style === 'hardtechno';
  assert.equal(e.hardTechno, hard);
  e.kick(0.1, 0.8);
  assert.equal(nodes.some(({ node }) => node.oversample === '4x'), hard);
  assert.equal(nodes.some(({ node }) => node.type === 'lowpass' && node.frequency.value === 4800), hard);
  nodes.length = 0;
  e.reese(0.2, { on: true, n: 0, a: false }, 0.1, false, false);
  assert.equal(nodes.some(({ node }) => node.type === 'lowpass' && node.frequency.value === 2400), hard);
  nodes.length = 0;
  e.clap(0.3, 0.8);
  const bursts = nodes.filter(({ node }) => node.gain?.events.some((ev) => ev.v > 2));
  assert(bursts.length);
  assert.equal(bursts.some(({ node }) => node.gain.events.some((ev) => ev.k === 's' && ev.v > 2)), !hard);
  e.breakSweep(0.4, 1.6);
  assert.equal(e.arrLP.frequency.events.some((ev) => ev.k === 'e' && ev.v === 1000), hard);
  e.breakOpen(2);
  e.riserStop();
  e.impact(2.1, 1);
  assert.equal(nodes.some(({ node }) => node.type === 'lowpass' && node.frequency.value === 7500), hard);
}
const empty = instrument('minimal');
delete empty.e.state.artist;
assert.equal(empty.e.hardTechno, false);
console.log('hardtechno: 64 ensembles, dark saw hooks, gated filters/envelopes, breakdown ramps and empty artist passed');
