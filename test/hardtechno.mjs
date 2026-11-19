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
for (const seed of [11, 42, 1234, 777]) {
  const song = freshSong('hardtechno', seed);
  song.artist = { style: 'hardtechno', seed };
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(song))).patterns.map((p) => p.at), song.patterns.map((p) => p.at));
}
for (const style of ['hardtechno', 'minimal', 'drill', null]) {
  const song = structuredClone(state);
  if (style) song.artist.style = style;
  else delete song.artist;
  song.patterns[0].steps.perc = [0.82, 0.88, 0.94, 2, NaN, -1, 3, Infinity];
  const expected = style === 'hardtechno' ? [0.82, 0.88, 0.94, 2, 0, 0, 2, 0] : [1, 1, 1, 2, 0, 1, 1, 1];
  assert.deepEqual(sanitize(song).patterns[0].steps.perc.slice(0, 8), expected);
}
assert(MASTER_TONE.hardtechno[2] > 0 && MASTER_TONE.hardtechno[3] < 0);
const plans = [11, 42, 1234, 777].map((seed) => songPlan('hardtechno', seed).chain);
assert.equal(new Set(plans).size, plans.length);
for (const chain of plans) {
  assert.equal(chain.length, 128);
  assert.equal(chain.match(/E+/g).length, 2);
  assert(chain.match(/F+/g).every((build) => build.length >= 4));
}
assert.equal(songPlan('hardtechno', 42).chain, plans[1]);
assert.equal(new Set(plans.map((chain) => chain.match(/^A+/)[0].length)).size, 4);
assert.notEqual(plans[0].match(/A+$/)[0].length, plans[1].match(/A+$/)[0].length);
const middle = plans.slice(0, 2).map((chain) => [...chain.matchAll(/([EFG])\1*/g)].map((run) => ({ scene: run[1], at: run.index, bars: run[0].length })));
for (const scene of ['E', 'F', 'G']) assert.equal(new Set(plans.map((chain) => [...chain.matchAll(new RegExp(scene + '+', 'g'))][1].index)).size, 4);
for (const scene of ['E', 'F', 'G']) {
  const [a, b] = middle.map((runs) => runs.filter((run) => run.scene === scene)[1]);
  assert.notEqual(a.at, b.at, `second ${scene} starts differ`);
  if (scene !== 'G') assert.notEqual(a.bars, b.bars, `second ${scene} lengths differ`);
}
const identities = [11, 42, 1234, 777].map((seed) => generate('hardtechno', seed));
assert.equal(new Set(identities.map((g) => g.params.kick.tune)).size, 4);
assert.equal(new Set(identities.map((g) => g.params.perc.tune)).size, 4);
assert.notDeepEqual(identities[0].pattern.steps.acid, identities[1].pattern.steps.acid);
for (let seed = 1; seed <= 64; seed++) {
  const chain = songPlan('hardtechno', seed).chain;
  assert.equal(chain.length, 128);
  assert(chain.match(/E+/g).every((breakdown) => breakdown.length >= 8));
  assert(chain.match(/G+/g).every((drop) => drop.length >= 16));
}
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
const fallback = instrument('hardtechno').e, frequency = fallback.arrLP.frequency;
frequency.cancelAndHoldAtTime = undefined;
frequency.value = 12345;
frequency.setValueAtTime(800, 99);
assert.doesNotThrow(() => fallback.breakSweep(0.4, 1.6));
assert(!frequency.events.some((ev) => ev.t === 99));
assert(frequency.events.some((ev) => ev.k === 'e' && ev.t === 0.4 && ev.v === 12345));
assert(frequency.events.some((ev) => ev.k === 'e' && ev.v === 10000));
assert.doesNotThrow(() => fallback.breakOpen(2));
assert(frequency.events.some((ev) => ev.k === 'e' && ev.t === 2 && ev.v === 18000));
assert(frequency.events.some((ev) => ev.k === 'e' && ev.v === 21000));
assert.equal(fallback.arrClosed, false);
for (const open of [3.5, 5]) {
  const e = instrument('hardtechno').e, f = e.arrLP.frequency;
  f.cancelAndHoldAtTime = undefined;
  e.breakSweep(1, 4);
  e.breakOpen(open);
  const held = 10000 * 1.8 ** ((open - 2) / 3), dur = 16 * e.stepDur;
  for (const [t, expected] of [[2, 10000], [2.75, 10000 * 1.8 ** 0.25], [open, held], [open + dur / 2, Math.sqrt(held * 21000)], [open + dur, 21000]]) {
    assert(Math.abs(f.at(t) - expected) < 0.01, `cutoff at ${t} should be ${expected}`);
  }
  for (let now = 10; now <= 100; now += 10) {
    e.ctx.currentTime = now;
    e.breakSweep(now + 1, 4);
    e.breakOpen(now + 5);
    assert(e.hardFilterRamp.length <= 5);
  }
}
const empty = instrument('minimal');
delete empty.e.state.artist;
assert.equal(empty.e.hardTechno, false);
const smooth = instrument('hardtechno').e;
for (const method of ['trigger', 'acid', 'hook', 'vocal', 'tonalSweep']) smooth[method] = () => {};
const sequence = new Sequencer(smooth, smooth.state);
let clock = 0.05;
for (let abs = 0; abs < 80 * 16; abs++) { sequence.tick(abs, clock); clock += smooth.stepDur; }
assert.equal(smooth.secGain.gain.events.filter((ev) => ev.k === 's').length, 1);
assert.equal(smooth.ch.kick.level.gain.events.filter((ev) => ev.k === 's').length, 1);
assert(smooth.ch.ch.level.gain.events.some((ev) => ev.k === 's' && ev.v === smooth.state.params.ch.level * 0.75));
assert(smooth.ch.oh.level.gain.events.some((ev) => ev.k === 's' && ev.v === smooth.state.params.oh.level * 0.8));
assert(smooth.secGain.gain.events.some((ev) => ev.k === 'l' && Math.abs(ev.v - 10 ** (-3.25 / 20)) < 1e-9));
assert(smooth.tonePres.gain.events.some((ev) => ev.v === -2.5));
assert(smooth.tonePres.gain.events.some((ev) => ev.k === 'l' && ev.v === MASTER_TONE.hardtechno[2]));
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
for (const chainOn of [false, true]) {
  const { e } = instrument('hardtechno'), s = e.state;
  s.chainOn = chainOn;
  s.chain = '';
  s.current = 5;
  let hits = 0;
  e.trigger = (id, t, v) => { assert(Number.isFinite(v)); hits++; };
  new Sequencer(e, s).tick(0, 0.1);
  assert(hits > 0);
}
console.log('hardtechno: 64 ensembles, dark saw hooks, gated filters/envelopes, breakdown ramps, muted rolls, standalone loops, optional hold API, fractional reloads and empty artist passed');
