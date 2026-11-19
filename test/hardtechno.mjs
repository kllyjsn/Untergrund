import assert from 'node:assert/strict';
import { freshSong, generate, sanitize, songPlan } from '../js/state.js';
import { OfflineAudioContext, installGlobals } from './offline-audio.mjs';
import { Engine, Sequencer, MASTER_TONE } from '../js/engine.js';

installGlobals();
for (let seed = 1; seed <= 64; seed++) {
  const g = generate('hardtechno', seed);
  assert([0, 2].includes(g.params.stab.voice));
  assert.equal(g.params.acid.voice, 3);
  assert.equal(g.pattern.hook.v, 'analog');
  assert.equal(g.pattern.hook.up, 0);
  assert.equal(g.pattern.hook.x.risk, 0.1);
  assert.equal(g.pattern.hook.s.filter(Boolean).length, 2);
  assert(g.pattern.hook.s.filter(Boolean).every((st) => st[1] >= 12));
  assert(g.params.stab.cutoff < 1300);
  assert(g.params.acid.reso < 4);
}
const state = freshSong('hardtechno', 42);
state.artist = { ...state.artist, style: 'hardtechno' };
assert.equal(sanitize(state).artist.style, 'hardtechno');
assert(state.patterns[6].at?.some((take) => take.steps.perc));
assert(MASTER_TONE.hardtechno[2] > 0 && MASTER_TONE.hardtechno[3] < 0);
const plans = [11, 42, 1234, 777].map((seed) => songPlan('hardtechno', seed).chain);
assert.equal(new Set(plans).size, plans.length);
for (const chain of plans) {
  assert.equal(chain.length, 128);
  assert.equal(chain.match(/E+/g).length, 2);
  assert(chain.match(/F+/g).every((build) => build.length >= 4));
}
assert.equal(songPlan('hardtechno', 42).chain, plans[1]);
assert(freshSong('hardtechno').patterns.every((p) => !p.at || p.at.every((take) => Object.values(take.steps || {}).flat().every(Number.isFinite))));

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
  assert.equal(e.glue.ratio.value, hard ? 1.3 : 2.5);
  assert.equal(e.limiter.threshold.value, hard ? -3 : -6);
  assert.equal(e.limTrim.gain.value, hard ? 0.5 : 0.7);
  if (hard) assert.equal(e.out.gain.value, 0.98);
  assert.equal(e.tonePres.type, hard ? 'peaking' : 'highshelf');
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
  assert.equal(e.arrLP.frequency.events.some((ev) => ev.k === 'e' && ev.v === 10000), hard);
  e.breakOpen(2);
  assert.equal(e.arrLP.frequency.events.some((ev) => ev.k === 'e' && ev.v === 21000), hard);
  e.riserStop();
  e.impact(2.1, 1);
  assert.equal(nodes.some(({ node }) => node.type === 'lowpass' && node.frequency.events.some((ev) => ev.v === 180)), hard);
  e.hardSection(4, 5, 0, 8, 5);
  assert.equal(e.ch.kick.level.gain.events.some((ev) => ev.k === 'l' && ev.t === 4 + 16 * e.stepDur), hard);
}
const empty = instrument('minimal');
delete empty.e.state.artist;
assert.equal(empty.e.hardTechno, false);
for (const [seed, drum] of [[11, 'clap'], [42, 'snare']]) {
  const { e } = instrument('hardtechno'), s = e.state, hits = [];
  s.artist.seed = seed;
  s.chain = 'FFFFGGGG';
  e.trigger = (id) => hits.push(id);
  s.mutes[drum] = true;
  new Sequencer(e, s).tick(0, 0.1);
  assert(!hits.includes(drum));
  s.mutes[drum] = false;
  new Sequencer(e, s).tick(0, 0.1);
  assert(hits.includes(drum));
}
assert.doesNotThrow(() => new Sequencer({}, state).interplay());
console.log('hardtechno: 64 ensembles, dark saw hooks, gated filters/envelopes, breakdown ramps, muted rolls and empty artist passed');
