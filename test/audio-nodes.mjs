// Audio-thread load guard: drives the real Engine + Sequencer through every style's song against a counting fake
// AudioContext and fails if the AudioNodes created per bar (the per-hit churn that crackles on phones) rise well
// above test/audio-nodes-baseline.json. `node test/audio-nodes.mjs --update` rewrites the baseline after a deliberate change.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { STYLES, defaultState, generate, applyOverrides, arrangement, songChain } from '../js/state.js';
import { makeIR } from '../js/dsp.js';
import { TECHNO_HOOK_SPACE } from '../js/lead.js';
import { VOCAL_FX } from '../js/sing.js';
import { syncAudioClock, transportResync, slewTransport, roomTransportCorrection } from '../js/room-sync.js';
import { createRoomMediaSync, roomMediaLead, roomMediaTime } from '../js/room-media-sync.js';
import { applyPart, extractPart, normalizeLayer } from '../js/jam.js';
import { rubatoMap } from '../js/perform.js';

const BASELINE = new URL('./audio-nodes-baseline.json', import.meta.url);
const SLACK = 1.15, FLOOR = 12;

class FakeBuffer {
  constructor({ length, numberOfChannels = 1, sampleRate = 48000 }) { this.length = length; this.numberOfChannels = numberOfChannels; this.sampleRate = sampleRate; this.duration = length / sampleRate; this.ch = Array.from({ length: numberOfChannels }, () => new Float32Array(length)); }
  getChannelData(i) { return this.ch[i]; }
  copyToChannel(d, i) { this.ch[i].set(d); }
}
const param = () => new Proxy({ value: 0 }, { get: (o, k) => (k in o ? o[k] : typeof k === 'string' ? () => o : undefined) });
const node = (ctx, kind) => new Proxy({ kind, ctx, numberOfInputs: 1, connect: (dst) => dst, disconnect() {}, start() {}, stop() {}, addEventListener() {} }, {
  get(o, k) { if (k in o) return o[k]; if (typeof k !== 'string' || k === 'then') return undefined; return (o[k] = param()); },
  set(o, k, v) { o[k] = v; return true; },
});
const counts = { n: 0, by: {} };
let tag = 'setup';
function fakeCtx(sampleRate = 48000) {
  const ctx = { currentTime: 0, sampleRate, state: 'running', destination: null, listener: param(),
    createBuffer: (n, length, sr) => new FakeBuffer({ length, numberOfChannels: n, sampleRate: sr }),
    createPeriodicWave: () => ({}), decodeAudioData: async (ab) => new FakeBuffer({ length: Math.max(1, (ab.byteLength - 44) >> 1), sampleRate: 44100 }),
    resume: async () => {}, startRendering: async () => new FakeBuffer({ length: 1 }) };
  ctx.destination = node(ctx, 'Destination');
  return new Proxy(ctx, { get(o, k) {
    if (k in o) return o[k];
    if (typeof k === 'string' && k.startsWith('create')) return () => { counts.n++; counts.by[tag] = (counts.by[tag] || 0) + 1; return node(o, k.slice(6)); };
    return undefined;
  } });
}
globalThis.AudioBuffer = FakeBuffer;
globalThis.OfflineAudioContext = function (ch, len, sr) { return fakeCtx(sr); };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!u.startsWith('file:')) return realFetch(url);
  try { const b = await readFile(fileURLToPath(u)); return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), json: async () => JSON.parse(b.toString()), text: async () => b.toString() }; }
  catch { return { ok: false, status: 404 }; }
};

const { Engine, Sequencer, parseChain, scoreKinds, vocalReanchorStep, vocalCrossfade, vocalFadePowerRatio, vocalFadeBandPowerRatios } = await import('../js/engine.js');
{
  for (const [listener, recorded] of [['hypnotic', 'euphoric'], ['euphoric', 'hypnotic']]) {
    const s = defaultState(); s.artist = { style: listener };
    const e = new Engine(fakeCtx(), s, { realtime: false });
    e.replay808Style = recorded;
    e.applyAll();
    assert.equal(e.ch.ch.level.gain.value, s.params.ch.level * (recorded === 'euphoric' ? 10 ** (-1 / 20) : 1));
    const events = [];
    e.secPreGain.gain.setTargetAtTime = () => events.push('pre');
    e.secGain.gain.setTargetAtTime = () => events.push('post');
    e.sectionGain(1, 0.45);
    assert.deepEqual(events, [recorded === 'euphoric' ? 'pre' : 'post']);
    assert.equal(s.artist.style, listener, 'replay does not modify the listener project');
    e.replay808Style = undefined; e.applyAll();
    assert.equal(e.ch.ch.level.gain.value, s.params.ch.level * (listener === 'euphoric' ? 10 ** (-1 / 20) : 1));
  }
  const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
  const start = main.slice(main.indexOf('function start('), main.indexOf('  engine.prepareVocal();'));
  const setup = start.slice(start.lastIndexOf('  engine.replay808Style ='));
  for (const switchAt of [null, 2]) {
    const engine = { applyAll() { this.applied = this.replay808Style; } };
    runInNewContext(setup, { engine, replay808Style: 'euphoric', switchAt });
    assert.equal(engine.applied, switchAt === null ? 'euphoric' : undefined, 'replay start applies the recorded mix, while scheduled starts keep their handoff automation');
  }
  console.log('Club replay Euphoric mix follows recorded genre, not listener genre');
}
{
  for (const [from, to] of [['euphoric', 'hypnotic'], ['hypnotic', 'euphoric']]) {
    for (const scheduled of [false, true]) for (const replay of [false, true]) {
      const s = defaultState(); s.artist = { style: replay ? 'minimal' : from };
      const e = new Engine(fakeCtx(), s, { realtime: false });
      if (replay) { e.replay808Style = from; e.applyAll(); }
      const q = new Sequencer(e, s), events = [];
      for (const [stage, gain] of [['pre', e.secPreGain.gain], ['post', e.secGain.gain]])
        gain.setTargetAtTime = (value, t) => events.push({ stage, value, t });
      q.level(1, 0.45);
      if (replay) e.replay808Style = to; else s.artist.style = to;
      if (scheduled) e.handoffIn(2.375); else e.applyAll();
      events.length = 0;
      q.level(2.375, 0.45);
      assert.deepEqual(events, [{ stage: to === 'euphoric' ? 'pre' : 'post', value: 10 ** (0.45 / 20), t: 2.375 }],
        `${from} to ${to}, scheduled=${scheduled}, replay=${replay}: same chorus boost reaches the incoming stage`);
      q.level(3, 0.45);
      assert.equal(events.length, 1, 'unchanged stage and level do not reschedule');
    }
  }
  console.log('Identical chorus boosts survive both directions of immediate and scheduled Euphoric handoffs');
}
{
  const s = defaultState();
  applyOverrides(s, generate('euphoric', 11, 'major'), true);
  s.artist = { style: 'euphoric' };
  const e = new Engine(fakeCtx(), s, { realtime: false }), level = s.params.ch.level;
  assert.equal(e.ch.ch.level.gain.value, level * 10 ** (-1 / 20));
  assert.equal(s.params.ch.level, level, 'Euphoric headroom does not modify the saved mixer level');
  for (const style of ['hypnotic', 'drill', 'minimal', undefined]) {
    if (style) applyOverrides(s, generate(style, 42, 'minor'), true);
    s.artist = { style };
    e.applyAll();
    assert.equal(e.ch.ch.level.gain.value, s.params.ch.level, `${style} restores untrimmed hats on the same engine`);
  }
  console.log('Euphoric hat trim is engine-scoped and clears on genre switches');
}
{
  const s = defaultState();
  s.artist = { style: 'euphoric' };
  const e = new Engine(fakeCtx(), s, { realtime: false }), events = { pre: [], post: [] };
  for (const [name, gain] of [['pre', e.secPreGain.gain], ['post', e.secGain.gain]]) {
    for (const method of ['cancelScheduledValues', 'setValueAtTime', 'setTargetAtTime', 'linearRampToValueAtTime'])
      gain[method] = (...args) => events[name].push([method, ...args]);
  }
  e.sectionGain(1, 0.45);
  assert.deepEqual(events.pre, [['cancelScheduledValues', 1], ['setTargetAtTime', 10 ** (0.45 / 20), 1, 0.012]]);
  assert.deepEqual(events.post, []);
  events.pre.length = 0;
  e.sectionGain(2, 0.45, [-1, 2, 0.5]);
  assert.deepEqual(events.pre, [['cancelScheduledValues', 2], ['setValueAtTime', 10 ** (-1 / 20), 2],
    ['setValueAtTime', 10 ** (-1 / 20), 2.5], ['linearRampToValueAtTime', 10 ** (0.45 / 20), 4.5]]);
  for (const style of ['hypnotic', 'drill', 'minimal', 'hardtechno', undefined]) {
    e.secPreGain.gain.value = 0.5;
    s.artist = { style: 'euphoric' }; e.applyAll();
    s.artist = { style }; e.applyAll();
    assert.equal(e.secPreGain.gain.value, 1, `${style} clears Euphoric section gain`);
    events.pre.length = events.post.length = 0;
    e.sectionGain(5, 0);
    assert.deepEqual(events.pre, []);
    assert.deepEqual(events.post, [['cancelScheduledValues', 5], ['setTargetAtTime', 1, 5, 0.012]]);
  }
  s.artist = { style: 'euphoric' }; e.at = 8; e.applyAll();
  assert.deepEqual(events.post.slice(-2), [['cancelScheduledValues', 8], ['setTargetAtTime', 1, 8, 0.004]], 'handoff clears post-clipper sections at its downbeat');
  console.log('Euphoric sections lift before the clipper and clear on genre switches');
}
{
  const stacks = {};
  for (const style of ['trap', 'trance']) {
    const s = defaultState();
    s.artist = { style };
    Object.assign(s.params.stab, { voice: 0, detune: 16 });
    const ctx = fakeCtx(), e = new Engine(ctx, s, { realtime: false }), oscs = [];
    ctx.createOscillator = () => { const o = node(ctx, 'Oscillator'); oscs.push(o); return o; };
    e.stab(0.05, 0.8);
    stacks[style] = oscs.filter((o) => o.type === 'sawtooth');
  }
  assert.equal(stacks.trap.length, stacks.trance.length * 1.5, 'only Trap SAW gains a third oscillator per note');
  assert.deepEqual([...new Set(stacks.trap.map((o) => o.detune.value))], [-16, 0, 16]);
  assert.deepEqual([...new Set(stacks.trance.map((o) => o.detune.value))], [-16, 16]);
  console.log('Trap-only three-saw chord stack passed');
}
{
  for (const [style, voice, moving] of [['trap', 2, true], ['trance', 2, false], ['trap', 0, false], [undefined, 2, false]]) {
    const s = defaultState();
    if (style) s.artist = { style };
    Object.assign(s.params.stab, { voice, detune: 16 });
    const ctx = fakeCtx(), e = new Engine(ctx, s, { realtime: false }), oscs = [];
    ctx.createOscillator = () => { const o = node(ctx, 'Oscillator'); oscs.push(o); return o; };
    e.pad(0.05, 0.8, [0], 60, s.params.stab, ctx.destination);
    const motion = oscs.filter((o) => o.type !== 'sawtooth');
    assert.equal(motion.length, moving ? 3 : 0, `${style}/${voice} PAD motion is festival-only`);
    assert(motion.every((o) => o.frequency.value >= 0.37 && o.frequency.value <= 0.78));
    assert.equal(new Set(motion.map((o) => o.frequency.value)).size, motion.length, 'each unison voice drifts independently');
  }
  console.log('Trap PAD-only decorrelated unison motion passed');
}
{
  for (const [style, voice, trimmed] of [['trap', 0, true], ['trap', 2, false], ['trap', 7, false], ['trance', 0, false], [undefined, 0, false]]) {
    const s = defaultState();
    if (style) s.artist = { style };
    s.params.stab.voice = voice;
    const ctx = fakeCtx(), e = new Engine(ctx, s, { realtime: false });
    let output, outputImmediate;
    const setTo = e.setTo;
    e.setTo = function (p, v, ...rest) { if (p === this.out.gain) { output = v; outputImmediate = rest[0]; } return setTo.call(this, p, v, ...rest); };
    e.applyAll();
    assert.equal(output, 0.78 * 10 ** ((trimmed ? -0.8 : style === 'trap' && voice === 2 ? -0.3 : 0) / 20), `${style}/${voice} master trim is festival-only`);
    const filters = [], filter = e.filter;
    e.filter = function (type, hz, ...rest) { filters.push([type, hz]); return filter.call(this, type, hz, ...rest); };
    e.pad(0.05, 0.8, [0], 60, s.params.stab, ctx.destination);
    assert.deepEqual(filters.filter(([type]) => type === 'highpass'), style === 'trap' ? [['highpass', 180]] : []);
    for (const nextVoice of [2, 0, 7, 0]) {
      e.setParam('stab', 'voice', nextVoice);
      assert.equal(output, 0.78 * 10 ** ((style === 'trap' ? nextVoice === 0 ? -0.8 : nextVoice === 2 ? -0.3 : 0 : 0) / 20), `${style} voice edits refresh output trim`);
      assert.equal(outputImmediate, false, 'live edits retain parameter smoothing');
    }
    e.state.params.stab.voice = 2;
    e.applyParam('stab', 'voice', true);
    assert.equal(output, 0.78 * 10 ** ((style === 'trap' ? -0.3 : 0) / 20), 'direct voice edits refresh PAD headroom');
    assert.equal(outputImmediate, true, 'immediate voice edits retain their timing');
  }
  console.log('Trap festival-only output trim and PAD highpass passed');
}
{
  for (const [style, voice] of [['trap', 0], ['trap', 2], ['trap', 7], ['trance', 0], [undefined, 2]]) {
    const s = defaultState(), ctx = fakeCtx();
    if (style) s.artist = { style };
    s.params.stab.voice = voice;
    const e = new Engine(ctx, s, { realtime: false }), trims = [];
    e.rec = () => null;
    e.trimOut = (...args) => { trims.push(args); return ctx.destination; };
    e.hook(.05, .8, 0, .5, 'ravestack');
    const festival = style === 'trap' && voice === 2;
    assert.equal(trims[0][0], `hook-ravestack:${13 + (festival ? 3 : 0)}`, 'hook trim cache key follows its gain');
    assert.equal(trims[0][1], 13 + (festival ? 3 : 0));
    assert.equal(trims[0][3], 2 + (festival ? 3 : 0), 'PAD-only hook lift preserves the existing shelf shape');
  }
  console.log('Trap festival PAD-only flat hook lift passed');
}
{
  const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
  const source = main.slice(main.indexOf('function landJamPart(part,'), main.indexOf('\n// GENERATE while'));
  for (const drive of [0, .2]) {
    const state = defaultState(), ctx = fakeCtx(), noop = () => {};
    state.params.acid.drive = drive;
    const engine = new Engine(ctx, state, {realtime:false});
    const env = {state, engine, ctx, applyPart, playing:true, roomPlayback:true, mediaRoute:null,
      setTimeout:noop, requestAnimationFrame:noop, cancelAnimationFrame:noop, jamRedraw:0};
    const land = new Function('env', 'with(env){' + source + '; return landJamPart;}')(env);
    const edit = (value, at) => {
      const layer = normalizeLayer('bass', extractPart(state, 'bass'));
      layer.params.acid.drive = value;
      land('bass', layer, at);
      assert.equal(layer.params.acid.drive, value, 'scheduling cannot mutate the shared Jam layer');
    };
    const initial = counts.n;
    for (let i = 0; i < 24; i++) edit(drive, 1 + i);
    assert.equal(counts.n, initial, 'unchanged drive across 24 timed desktop bass edits creates no AudioNodes');
    edit(.8, 25);
    assert(counts.n > initial, 'a changed drive still schedules its native oversampled path');
    const changed = counts.n;
    for (let i = 0; i < 24; i++) edit(.8, 26 + i);
    assert.equal(counts.n, changed, 'repeated edits retain the one pending changed-drive path');
  }
  console.log('Room Jam drive nodes PASS: unchanged and zero drive keep native node counts flat across 24 edits before/after a real drive change.');
}
const { loadLiveKit, loadBand, BAND } = await import('../js/livekit.js');
const { loadPiece } = await import('../js/repertoire.js');
await loadLiveKit();
await Promise.all(Object.keys(BAND).map((k) => loadBand(k)));

// Attribute each node to the outermost Engine method that created it.
for (const k of Object.getOwnPropertyNames(Engine.prototype)) {
  const f = Object.getOwnPropertyDescriptor(Engine.prototype, k).value;
  if (k === 'constructor' || typeof f !== 'function') continue;
  Engine.prototype[k] = function (...a) { if (tag !== 'tick') return f.apply(this, a); tag = k === 'trigger' ? `${k}.${a[0]}` : k; try { return f.apply(this, a); } finally { tag = 'tick'; } };
}

function songFor(style, seed) {
  const s = defaultState(), g = generate(style, seed);
  applyOverrides(s, g);
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  if (g.key != null) s.key = g.key;
  if (g.scale) s.scale = g.scale;
  s.chainOn = true;
  s.chain = songChain(style, seed);
  return s;
}

export async function measure(style, seed = 7) {
  const state = songFor(style, seed);
  const score = state.patterns.find((p) => p.score)?.score;
  if (score?.piece) await loadPiece(score.piece);
  const rnd = Math.random; let x = 12345; Math.random = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  try {
    counts.n = 0; counts.by = {}; tag = 'setup';
    const engine = new Engine(fakeCtx(), JSON.parse(JSON.stringify(state)), { realtime: false });
    const seq = new Sequencer(engine, engine.state);
    const fixed = counts.n;
    const bars = Math.max(16, parseChain(state.chain).length || 0);
    const perBar = [];
    counts.by = {};
    for (let abs = 0, t = 0.05; abs < bars * 16; abs++) {
      const before = counts.n; tag = 'tick';
      seq.tick(abs, t); t += engine.stepDur;
      tag = 'setup';
      perBar[abs >> 4] = (perBar[abs >> 4] || 0) + counts.n - before;
    }
    const peak = Math.max(...perBar), avg = perBar.reduce((a, b) => a + b, 0) / bars;
    return { style, fixed, bars, peak, avg: Math.round(avg), by: Object.fromEntries(Object.entries(counts.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v / bars)])) };
  } finally { Math.random = rnd; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ctx = fakeCtx();
  const player = new Engine(ctx, defaultState(), { trackQueuedNotes: true });
  const events = [];
  const source = name => ({ start: (...args) => events.push([name, 'start', ...args]), stop: t => events.push([name, 'stop', t]) });
  player.startSource(source('ringing'), 1);
  player.startSource(source('queued'), 2, 0.4, 0.2);
  ctx.currentTime = 1.5;
  player.discardQueuedNotes(ctx.currentTime);
  player.discardQueuedNotes(ctx.currentTime);
  assert.deepEqual(events, [['ringing', 'start', 1], ['queued', 'start', 2, 0.4, 0.2], ['queued', 'stop', 1.5]]);

  {
    const ctx = fakeCtx(), engine = new Engine(ctx, defaultState());
    const delays = [], createDelay = ctx.createDelay, createOscillator = ctx.createOscillator;
    let oscillators = 0;
    ctx.createDelay = max => {
      const delay = createDelay();
      delays.push({ delay, max });
      return delay;
    };
    ctx.createOscillator = () => { oscillators++; return createOscillator(); };
    const peak = engine.technoHookOut('ravestack'), motion = engine.technoHookMotion;
    const h = counts.n;
    assert.equal(engine.technoHookOut('ravestack'), peak);
    assert.equal(counts.n, h, 'lead diffusion is reused per voice, not allocated per note');
    assert.notEqual(engine.technoHookOut('robotformant'), peak);
    assert.equal(engine.technoHookMotion, motion, 'lead diffusion shares one modulation source');
    engine.hookBus = ctx.createGain();
    for (const [voice, { diffusion }] of Object.entries(TECHNO_HOOK_SPACE)) {
      delays.length = 0;
      engine.technoHookOut(voice);
      const { delay, max } = delays[0], center = delay.delayTime.value;
      const excursion = oscillators * diffusion;
      assert(oscillators > 0 && center >= excursion && center + excursion <= max,
        `${voice} delay sweep must stay inside its bounds`);
    }
  }

  for (const [voice, wide] of [[8, true], [9, false]]) {
    const ctx = fakeCtx(), state = defaultState();
    Object.assign(state.params.acid, { voice, decay: wide ? 0.11 : 0.044 });
    const e = new Engine(ctx, state);
    const bank = e.buildHarmonicBass(wide), gain = bank.amp.gain, events = [];
    e.gatedBasses.set(voice, bank);
    const record = (kind) => (value, time) => events.push({ kind, value, time });
    gain.setTargetAtTime = record('target');
    gain.linearRampToValueAtTime = record('ramp');
    gain.cancelScheduledValues = time => {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].time >= time) events.splice(i, 1);
    };
    const step = { n: 0, a: false };
    e.acid(1, step, false, true, 0.1, 1.15);
    assert.deepEqual(events.at(-1), { kind: wide ? 'target' : 'ramp', value: 0, time: wide ? 1.15 : 1.044 });
    if (wide) {
      assert.equal(bank.detunes.length, 2);
      for (const [i, detune] of bank.detunes.entries()) {
        detune.setValueAtTime = (value) => assert(value * (i ? 1 : -1) >= 10, 'Reese saws detune in opposite directions');
      }
    }
    e.acid(1.15, step, true, false, 0.1);
    ctx.currentTime = 1.1;
    e.panic();
    assert.deepEqual(events.at(-1), { kind: 'target', value: 0, time: 1.1 }, 'Stop discards queued bass envelopes');
  }

  {
    const ctx = fakeCtx(), state = defaultState();
    state.params.acid.voice = 7;
    const e = new Engine(ctx, state);
    const pulse = e.buildPulseBass(), gain = pulse.amp.gain;
    e.gatedBasses.set(7, pulse);
    let automation = [];
    gain.setTargetAtTime = (value, time, tc) => automation.push({ value, time, tc });
    gain.cancelScheduledValues = time => { automation = automation.filter(event => event.time < time); };
    gain.setValueAtTime = () => assert.fail('a retrigger must not jump to zero');
    const st = { n: 0, a: false };
    e.acid(1, st, false, false, 0.12);
    e.acid(1.12, st, false, true, 0.12);
    assert.equal(automation.at(-1).value, 0, 'a slide at the end of a section still releases');
    assert(automation.at(-1).time < 1.36);
    e.acid(1.24, st, true, true, 0.12);
    ctx.currentTime = 1.18;
    e.panic();
    assert.deepEqual(automation.at(-1), { value: 0, time: 1.18, tc: 0.008 }, 'Stop discards queued pulse targets');

    state.chainOn = false;
    state.swing = 0.6;
    state.master.humanize = 0.4;
    const pat = state.patterns[state.current];
    pat.steps.acid[0] = { on: true, n: 0, a: false, s: true };
    pat.steps.acid[1] = { on: true, n: 7, a: false, s: false };
    const seq = new Sequencer(e, state), sd = e.stepDur;
    automation = [];
    seq.tick(0, 2);
    const release = automation.at(-1);
    assert.equal(release.value, 0, 'even a long slide has a fallback release');
    seq.tick(1, 2 + sd);
    const attack = automation.filter(({ value }) => value > 0).at(-2);
    assert(release.time >= attack.time, 'a held pulse must not release before the swung next note');
    assert(!automation.includes(release), 'the next pulse replaces the fallback release');
  }

  {
    for (const [style, replay, step] of [['bailefunk', null, 16], ['drill', 'bailefunk', 16], ['bailefunk', 'drill', 0]]) {
      const state = defaultState();
      state.artist = { style, seed: 1 };
      state.chainOn = false; state.solos.vox = true;
      state.master.arr = state.master.vary = 0;
      const pat = state.patterns[state.current];
      pat.steps.vox.fill(0); pat.steps.vox[0] = 1;
      const e = new Engine(fakeCtx(), state), seq = new Sequencer(e, state), hits = [];
      e.replay808Style = replay;
      e.vox = (...args) => hits.push(args);
      seq.tick(16, 1, 1, true);
      assert.equal(hits.length, 1, 'an editable room VOX hit dispatches');
      assert.equal(hits[0][2], step, 'the recorded palette chooses absolute or local vocal phase');
      seq.tick(17, 1 + e.stepDur, undefined, true);
      assert.equal(hits.length, 1, 'empty editable VOX steps stay silent');
      state.mutes.vox = true;
      assert.doesNotThrow(() => e.reviseHits('vox'), 'a queued VOX hit can be replanned after mute');
    }
    console.log('Editable room VOX dispatch: active/empty/replanned hits and both replay style directions passed.');
  }

  {
    for (const editable of [false, true]) for (const kickMuted of [false, true]) {
      const state = defaultState();
      state.artist = { style: 'drill' };
      state.chainOn = false;
      state.mutes.kick = kickMuted;
      state.params.acid.voice = 2;
      const pat = state.patterns[state.current];
      pat.steps.kick.fill(0); pat.steps.kick[1] = 1;
      pat.steps.acid[0] = { on: true, n: 0, a: false, s: true };
      pat.steps.acid[1] = { on: true, n: 5, a: false, s: false };
      const e = new Engine(fakeCtx(), state), seq = new Sequencer(e, state);
      const kicks = [], slides = [];
      e.trigger = (id, t) => { if (id === 'kick') kicks.push(t); };
      e.eight08 = (t, st, sd, hold, sliding, kickAt) => { if (sliding) slides.push(kickAt); };
      seq.tick(0, 1, undefined, editable);
      seq.tick(1, 1 + e.stepDur, undefined, editable);
      assert.deepEqual(slides, [kicks[0]], 'the slide uses the kick actually scheduled on its step');
      assert.equal(kicks.length, Number(!kickMuted));
    }
  }

  {
    const ctx = fakeCtx(), state = defaultState();
    state.master.arr = state.master.humanize = state.master.variation = 0;
    state.chainOn = false;
    const pat = state.patterns[state.current];
    for (const [id, steps] of Object.entries(pat.steps))
      if (id !== 'acid') steps.fill(0);
    state.mutes.acid = true;
    pat.steps.kick[0] = pat.steps.kick[1] = pat.steps.clap[1] = 1;
    const e = new Engine(ctx, state, { trackQueuedNotes: true });
    const seq = new Sequencer(e, state);
    const windGain = e.windDuck.gain, windDucks = [];
    windGain.cancelScheduledValues = t => windDucks.push(['cancel', t]);
    windGain.setTargetAtTime = (gain, t) => windDucks.push(['target', gain, t]);
    const started = [], stopped = [];
    e.trigger = (id, t) => {
      const hit = [id, t];
      e.startSource({ start: () => started.push(hit), stop: () => stopped.push(hit) }, t);
      if (id === 'kick') e.duckAt(t, 1);
    };
    seq.tick(0, 1, 1, true);
    seq.tick(1, 1.25, 1.25, true);
    seq.tick(2, 1.5, 1.5, true);
    const [ringing, kick, clap] = started;
    assert.deepEqual(started.map(([id]) => id), ['kick', 'kick', 'clap']);
    assert.ok(windDucks.some(([op, gain, t]) => op === 'target' && gain < 1 && t === kick[1]), 'the kick keys the wind bus');
    ctx.currentTime = 1.05;
    state.mutes.kick = true;
    e.reviseHits('kick');
    assert.deepEqual(stopped, [kick], 'mute leaves the ringing kick and unrelated queued clap');
    assert.deepEqual(e.ducks.map(d => d.t), [ringing[1]], 'muting the queued kick removes only its sidechain');
    assert.deepEqual(windDucks.at(-1), ['cancel', kick[1]], 'muting the kick cancels its scheduled wind duck');
    state.mutes.kick = false;
    e.reviseHits('kick');
    assert.deepEqual(started.slice(3), [kick], 'unmute restores the queued kick once at its original time');
    pat.steps.kick[1] = 0; pat.steps.kick[2] = 1;
    e.reviseHits('kick', state.current);
    assert.deepEqual(stopped, [kick, kick], 'step edit removes only the replacement kick');
    assert.equal(started.length, 5, 'a previously empty step can be filled');
    assert.equal(started[4][0], 'kick');
    assert.ok(Math.abs(started[4][1] - 1.5) < 0.05);
    e.discardQueuedNotes(ctx.currentTime);
    assert.deepEqual(windDucks.at(-1), ['target', 1, ctx.currentTime], 'discarding the queue restores the wind gain');
    assert.deepEqual(stopped.slice(2), [clap, started[4]], 'wake only stops still-queued notes once');
    e.reviseHits('kick');
    assert.equal(started.length, 5, 'edits cannot resurrect an old transport queue after wake');
  }

  {
    const ctx = fakeCtx(), s = defaultState();
    s.chainOn = true; s.chain = 'CCCCCCCCC'; s.master.arr = 1; s.master.vary = 0;
    s.solos = { snare: true, clap: true };
    const pat = s.patterns[2];
    pat.steps.snare.fill(0); pat.steps.clap.fill(0);
    pat.steps.snare[0] = 1;
    const e = new Engine(ctx, s, { trackQueuedNotes: true }), seq = new Sequencer(e, s);
    const started = [], stopped = [];
    e.trigger = (id, t) => e.startSource({ start: () => started.push(id), stop: () => stopped.push(id) }, t);
    for (let bar = 0; bar <= 7; bar++) seq.tick(bar * 16, 1 + bar * 2, undefined, true);
    ctx.currentTime = 15.9;
    started.length = 0;
    seq.tick(7 * 16 + 12, 16.5, undefined, true);
    assert.deepEqual(started, ['snare'], 'the next step has a generated snare fill');
    pat.steps.snare[0] = 0;
    e.reviseHits('snare', 2);
    assert.deepEqual(stopped, [], 'clearing a written step does not cancel a queued generated fill');
    seq.tick(7 * 16 + 13, 16.625, undefined, true);
    assert.deepEqual(started, ['snare', 'clap'], 'newly scheduled fill steps can switch to clap');
    pat.steps.snare[0] = 1;
    e.reviseHits('snare', 2);
    assert.deepEqual(started, ['snare', 'clap'], 'adding a written step does not double a queued generated fill');
  }

  {
    const s = defaultState();
    s.chainOn = true; s.chain = 'AC'; s.master.arr = 1;
    const e = new Engine(fakeCtx(), s, { realtime: false });
    const seq = new Sequencer(e, s);
    let impacts = 0, advances = 0;
    e.impact = () => impacts++;
    const advance = seq.advanceBar.bind(seq);
    seq.advanceBar = (...args) => { advances++; return advance(...args); };
    seq.origin = 64;
    seq.rewind(64, 1);
    assert.equal(advances, 0, 'boundary recovery leaves one-shot bar state for tick');
    seq.tick(64, 1);
    assert.equal(advances, 1);
    assert.equal(impacts, 0, 'the build downbeat is not a drop');
    assert.equal(seq.dropNext, true, 'the following peak still gets its build');
    seq.rewind(68, 2);
    assert.equal(advances, 2, 'mid-bar recovery restores its bar exactly once');
    assert.equal(seq.chainPos, 1);
    assert.equal(seq.cur, 0);
    seq.tick(68, 2);
    assert.equal(impacts, 0);
    seq.queued = 3;
    s.chainOn = false;
    seq.rewind(80, 3);
    assert.equal(seq.queued, 3, 'a queued pattern is not consumed before the recovered downbeat');
    seq.tick(80, 3);
    assert.equal(seq.queued, null);
    assert.equal(seq.cur, 3);
  }

  {
    const c = fakeCtx(), s = defaultState();
    s.bpm = 120;
    const buf = new FakeBuffer({ length: 48000 * 20, sampleRate: 48000 });
    const starts = [];
    c.createBufferSource = () => ({ connect: dst => dst, start: (...args) => starts.push(args), stop() {} });
    const e = new Engine(c, s, { trackQueuedNotes: true,
      vocal: () => ({ buf, gain: 1, duck: 1, lift: 1, ms: 250 }) });
    e.vocal(1, 0);
    c.currentTime = 1.5;
    e.discardQueuedNotes(1.5);
    assert.equal(e.vocalNow, null);
    e.vocal(1.6, 1, 5);
    assert.deepEqual(starts.at(-1), [1.6, 2.375], 'mid-bar recovery resumes at the trimmed stem offset');
    assert.equal(e.vocalNow.next, 2);
    const count = starts.length;
    e.vocal(2.975, 2);
    assert.equal(starts.length, count, 'the next boundary keeps the resumed source playing');
    c.currentTime = 3.5;
    e.vocal(3.49, 1, 4, 3.45);
    assert.ok(Math.abs(starts.at(-1)[0] - 3.505) < 1e-9);
    assert.ok(Math.abs(starts.at(-1)[1] - 2.305) < 1e-9, 'a late room stem starts at the current grid phase');
    e.vocal(4.97, 2, 0, 4.97);
    assert.equal(starts.length, count + 1, 'small room clock updates keep the existing source');
    e.vocal(7.05, 3, 0, 7.05);
    assert.equal(starts.length, count + 2, 'a corrected grid re-anchors the continuous stem');
    assert.ok(Math.abs(starts.at(-1)[1] - 5.75) < 1e-9);
    assert.ok(Math.abs(e.vocalNow.origin - 1.3) < 1e-9);
    c.currentTime = 7.1;
    e.discardQueuedNotes(c.currentTime);
    e.vocal(7.1, 3, 0, 7.05);
    assert.equal(starts.length, count + 3, 'a cleared clock jump starts a new stem on the corrected grid');
    assert.ok(Math.abs(starts.at(-1)[1] - 5.805) < 1e-9);
    e.vocal(3, 20, 5);
    assert.equal(e.vocalNow, null, 'an exhausted stem stays silent');
    e.vocalOf = () => null;
    e.vocal(4, 1, 5);
    assert.equal(e.vocalNow, null, 'songs without a stem do not start a source');
  }

  {
    const c = fakeCtx(), s = defaultState();
    s.bpm = 120;
    const buf = new FakeBuffer({ length: 48000 * 20, sampleRate: 48000 }), starts = [];
    c.createBufferSource = () => ({ connect: dst => dst, start: (...args) => starts.push(args), stop() {} });
    const e = new Engine(c, s, { vocal: () => ({ buf, gain: 1, duck: 1, lift: 1, ms: 250 }) });
    for (const room of [false, true]) {
      e.vocalStop();
      const play = (t, pos) => e.vocal(t, pos, 0, room ? t : undefined);
      play(1, 0);
      const first = e.vocalNow.src, count = starts.length;
      play(3.02, 1);
      assert.equal(e.vocalNow.src, first, 'sub-threshold jitter keeps the source');
      play(5.04, 2);
      assert.notEqual(e.vocalNow.src, first, 'cumulative grid drift is measured against the playing source');
      assert.equal(starts.length, count + 1);
      assert.ok(Math.abs(starts.at(-1)[1] - 3.75) < 1e-9);
      play(7.02, 3);
      assert.equal(starts.length, count + 1, 'small changes relative to the new origin remain continuous');
      play(8.96, 4);
      assert.equal(starts.length, count + 2, 'backward grid corrections also re-anchor');
      assert.ok(Math.abs(starts.at(-1)[1] - 7.75) < 1e-9);
    }
    e.vocalStop();
    e.vocal(1, 0, 0, 1);
    const before = e.vocalNow.src;
    e.vocal(3.02, 1, 0, 3.02, true);
    assert.equal(e.vocalNow.src, before, 'a converged sub-30ms room correction keeps the source');
    assert.ok(Math.abs(e.vocalNow.origin - 1.25) < 1e-9);
    const aligned = e.vocalNow.src;
    e.vocal(5.02, 2, 0, 5.02);
    assert.equal(e.vocalNow.src, aligned, 'the aligned stem stays continuous on the new grid');
    e.vocalStop();
    e.vocal(1, 0, 0, 1, true);
    const stable = e.vocalNow.src;
    e.vocal(3.002, 1, 0, 3.002, true);
    assert.equal(e.vocalNow.src, stable, 'room grid correction preserves sub-3ms jitter');
    e.vocal(5.008, 2, 0, 5.008, true);
    const corrected = e.vocalNow.src;
    assert.equal(corrected, stable, 'ordinary slews retain the original 30ms vocal tolerance');
    assert.ok(Math.abs(e.vocalNow.origin - 1.25) < 1e-9);
    e.vocal(5.008, 2, 0, 5.008, true);
    assert.equal(e.vocalNow.src, corrected, 'an explicit correction after a bar tick does not restart an aligned stem twice');
    e.vocal(7.006, 3, 0, 7.006, true);
    assert.equal(e.vocalNow.src, corrected, 'the corrected source stays continuous through small room jitter');
    const roomEngine = new Engine(fakeCtx(), defaultState(), {realtime:false}), calls = [];
    roomEngine.vocal = (...args) => calls.push(args);
    const roomSeq = new Sequencer(roomEngine, roomEngine.state);
    roomSeq.tick(0, 1, 1);
    roomSeq.tick(16, 3);
    assert.deepEqual(calls.map(args => args[4]), [false, false], 'bar ticks retain the original tolerance in rooms and solo');
    roomSeq.tick(32, 5, 5, false, true);
    assert.equal(calls.at(-1)[5], true, 'room bars hold their phase check during a slew');
    console.log('Room vocal slew PASS: room bars retain 30ms tolerance and hold phase rechecks during a slew; solo stays unchanged.');
    console.log('Vocal grid drift PASS: solo and room sources follow cumulative forward/backward corrections; small jitter stays continuous.');
  }

  {
    const c = fakeCtx(), s = defaultState(); s.bpm = 123;
    const buf = new FakeBuffer({length:48000 * 40, sampleRate:48000});
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    const nominal = e.vocalStepDur, tempo = rubatoMap(2048, 16, [], 1);
    let at = 1, starts = 0, source;
    for (let step = 0; step < 192; step++) {
      if (step % 16 === 0) {
        e.vocal(at, step / 16, 0, at, false, true);
        if (e.vocalNow.src !== source) starts++;
        source = e.vocalNow.src;
        assert.equal(e.vocalNow.sd, nominal, 'stem phase uses its nominal tempo, not the latest rubato duration');
        assert.equal(e.vocalNow.origin, 1, 'duration-only changes never replace or re-offset a settling stem');
      }
      e.stepScale = tempo[step];
      assert.equal(e.vocalStepDur, nominal);
      at += e.stepDur;
    }
    assert.equal(starts, 1, 'twelve real-rubato bars have no duration-only source restart');
    e.vocalStop(at);
    assert.equal(e.vocalNow, null, 'a genuine stop/discard still clears the stem');
    e.vocal(at, 12, 0, at);
    assert.notEqual(e.vocalNow.src, source, 'a discarded source is replaced');
    assert.ok(Math.abs(e.vocalNow.origin - (at - 192 * nominal)) < 1e-12, 'restarts use nominal source phase against the cumulative score grid');
    const resumed = e.vocalNow.src;
    s.bpm = 124;
    e.vocal(at + 16 * nominal, 13, 0, at + 16 * nominal, false, true);
    assert.notEqual(e.vocalNow.src, resumed, 'a real nominal-tempo change still restarts');
    e.vocalStop();
    e.vocalOf = () => null;
    e.vocal(at, 14, 0, at);
    assert.equal(e.vocalNow, null, 'an absent vocal never creates a source');
    console.log('Rubato vocal continuity PASS: real rubatoMap, 12 bars, zero duration-only restarts, nominal source phase, stop/tempo changes and absent vocal preserved.');
  }

  {
    for (const residual of [-0.029, 0.029]) {
      const c = fakeCtx(), s = defaultState(), rates = [], starts = [];
      s.bpm = 120;
      const buf = new FakeBuffer({ length: 48000 * 20, sampleRate: 48000 });
      c.createBufferSource = () => ({ connect: dst => dst, start: (...a) => starts.push(a), stop() {},
        playbackRate: {
          setValueAtTime: (rate, at) => rates.push({ rate, at, ramp: false }),
          linearRampToValueAtTime: (rate, at) => rates.push({ rate, at, ramp: true }),
        } });
      const e = new Engine(c, s, { vocal: () => ({ buf, gain: 1, duck: 1, lift: 1, ms: 0 }) });
      const sd = e.stepDur;
      let nextTime = 10 + residual, rate = 1;
      e.vocal(nextTime, 0, 0, nextTime);
      const source = e.vocalNow.src;
      for (let step = 1; step <= 64; step++) {
        nextTime += sd;
        const fix = transportResync(10 + step * sd, nextTime, nextTime - sd - .01, sd, false, -Infinity, rate);
        if (fix) {
          e.slewVocal(fix.nextTime - nextTime, nextTime - sd, sd, fix.rate, fix.endRate);
          rate = fix.endRate;
          nextTime = fix.nextTime;
        }
        if (step % 16 === 0) e.vocal(nextTime, step / 16, 0, nextTime);
        assert.equal(e.vocalNow.src, source, 'slewing across consecutive bars keeps the continuous stem');
        assert.ok(Math.abs(e.vocalNow.origin - (nextTime - step * sd)) < 1e-9);
      }
      let origin = 10 + residual, previousAt = origin, previousRate = 1;
      for (const event of rates) {
        assert.ok(Math.abs(event.rate - 1) <= .008 + 1e-12, 'vocal tempo adjustment stays within 0.8 percent');
        assert.ok(event.at >= previousAt, 'automation is appended in time order');
        assert.ok(Math.abs(event.rate - previousRate) <= sd * .016 + 1e-12, 'adjacent rates change smoothly');
        origin += (1 - (event.ramp ? (previousRate + event.rate) / 2 : previousRate)) * (event.at - previousAt);
        previousAt = event.at; previousRate = event.rate;
      }
      assert.equal(rates.filter(e => !e.ramp).length, 1, 'only the initial unity anchor is a set event');
      assert.equal(rates[0].rate, 1);
      assert.equal(rates.at(-1).rate, 1, 'the final ramp returns to unity');
      assert.ok(rates.slice(1, -1).every(e => e.rate !== 1), 'no unity reset in the middle of the slew');
      assert.ok(Math.abs(origin - e.vocalNow.origin) < 1e-9, 'integrated source playback follows the corrected grid');
      assert.equal(starts.length, 1);
      assert.ok(Math.abs(origin - 10) <= .002 + 1e-9);
      const count = rates.length;
      e.slewVocal(.001, e.vocalNow.at - .01, sd, 1, .998);
      c.currentTime = 30;
      e.slewVocal(.001, 29.9, sd, 1, .998);
      assert.equal(rates.length, count, 'do not change pre-start or already-rendered vocal intervals');
      e.vocalStop();
      e.slewVocal(.001, 31, sd, 1, .998);
      assert.equal(rates.length, count, 'silent songs need no vocal correction');
    }
    console.log('Vocal slew PASS: both signs, smooth appended ramps, no mid-slew unity reset, integrated phase follows grid, continuous bars, render/start guards and silence.');
  }

  {
    for (const sign of [-1, 1]) {
      const c = fakeCtx(), s = defaultState(), events = [];
      s.bpm = 120;
      const buf = new FakeBuffer({ length: 48000 * 20, sampleRate: 48000 });
      c.createBufferSource = () => ({ connect: dst => dst, start() {}, stop() {}, playbackRate: {
        setValueAtTime: (rate, at) => events.push({ rate, at }),
        linearRampToValueAtTime: (rate, at) => events.push({ rate, at }),
      } });
      const e = new Engine(c, s, { vocal: () => ({ buf, gain: 1, duck: 1, lift: 1, ms: 0 }) });
      e.vocal(1, 0, 0, 1);
      const sd = e.stepDur, rate1 = 1 + sign * .002, rate2 = 1 + sign * .004;
      e.slewVocal(2 * sd / (1 + rate1) - sd, 1, sd, 1, rate1);
      const end1 = events.at(-1).at, from2 = end1 - Number.EPSILON;
      assert.ok(from2 < end1, 'the next interval begins one ulp before the previous reset');
      e.slewVocal(2 * sd / (rate1 + rate2) - sd, from2, sd, rate1, rate2);
      const end2 = events.at(-1).at;
      assert.equal(events.length, 3, 'one anchor and two ramps; no intermediate reset');
      assert.ok(events[1].at < events[2].at, 'ulp-early starts cannot insert an out-of-order event');
      const midpoint = (end1 + end2) / 2;
      const effectiveRate = events[1].rate + (events[2].rate - events[1].rate) * (midpoint - end1) / (end2 - end1);
      assert.ok(Math.abs(effectiveRate - (rate1 + rate2) / 2) < 1e-12, 'the second interval continues the smooth ramp');
      let phase = 0;
      for (let i = 1; i < events.length; i++) {
        phase += (events[i - 1].rate + events[i].rate) / 2 * (events[i].at - events[i - 1].at);
      }
      assert.ok(Math.abs(phase - (end2 - e.vocalNow.origin)) < 1e-12, 'effective vocal phase matches both grid corrections');
    }
    console.log('Vocal slew ordering PASS: one-ulp early boundaries append increasing ramps, preserving the effective rate and integrated phase for both signs.');
  }

  {
    for (const residual of [-.028, .005, .014, .028]) {
      const c = fakeCtx(), s = defaultState(), events = [];
      s.bpm = 123;
      const buf = new FakeBuffer({length:48000 * 20, sampleRate:48000});
      c.createBufferSource = () => ({connect:dst => dst, start() {}, stop() {}, playbackRate: {
        setValueAtTime:(rate, at) => events.push({rate, at, ramp:false}),
        linearRampToValueAtTime:(rate, at) => events.push({rate, at, ramp:true}),
      }});
      const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
      const start = 10 + residual, sd = e.stepDur;
      e.vocal(start, 0, 0, start);
      const voice = e.vocalNow;
      const declined = transportResync(10 + sd / 2, start + sd / 2, 0, sd, false, -Infinity, 1, true);
      assert.equal(e.slewVocal(declined.nextTime - start - sd / 2, start - sd / 2, sd, 1, declined.endRate, declined.profile), false);
      assert.equal(voice.slewRate, undefined, 'a pre-start decline never advances the actual rate');
      assert.equal(voice.slewProfile, undefined, 'a pre-start decline never advances the profile');
      assert.equal(voice.origin, start);
      assert.equal(events.length, 0);
      let next = start + sd, target = 10 + sd, count = 0;
      while (Math.abs(target - next) > 1e-10 || (voice.slewRate ?? 1) !== 1) {
        const fix = transportResync(target, next, 0, sd, false, -Infinity, voice.slewRate ?? 1, true, voice.slewProfile);
        assert.equal(e.slewVocal(fix.nextTime - next, next - sd, sd, fix.rate, fix.endRate, fix.profile), true);
        if (count === 0) {
          assert.equal(events[0].rate, 1, 'the first accepted anchor equals the rate actually in effect');
          assert.ok(Math.abs(1200 * Math.log2(events[1].rate)) <= 1, 'the first accepted sixteenth eases away from unity');
          const saved = {rate:voice.slewRate, profile:voice.slewProfile, origin:voice.origin, end:voice.slewEnd, count:events.length};
          assert.equal(e.slewVocal(0, next - sd, sd, 1, 1), false, 'a stale caller cannot anchor a different rate');
          c.currentTime = next;
          assert.equal(e.slewVocal(0, next - sd, sd, voice.slewRate, 1), false, 'render-deadline calls decline');
          c.currentTime = 0;
          assert.equal(e.slewVocal(0, next - sd, sd, voice.slewRate, 1), false, 'already appended intervals decline');
          assert.deepEqual({rate:voice.slewRate, profile:voice.slewProfile, origin:voice.origin, end:voice.slewEnd, count:events.length}, saved);
        }
        next = fix.nextTime + sd; target += sd;
        assert.equal(e.vocalNow, voice, 'the source stays continuous');
        assert.ok(++count < 100);
      }
      let phase = 0, at = start, rate = 1;
      for (const event of events) {
        assert.ok(event.at >= at);
        phase += (event.at - at) * (event.ramp ? (rate + event.rate) / 2 : rate);
        at = event.at; rate = event.rate;
      }
      assert.equal(events.filter(e => !e.ramp).length, 1);
      assert.equal(events.at(-1).rate, 1);
      assert.equal(voice.slewProfile, null);
      assert.ok(Math.abs(at - phase - voice.origin) < 1e-9, 'the appended S-curve integrates to the tracked vocal phase');
      assert.ok(Math.abs(voice.origin - 10) < 1e-9, 'the vocal reaches exact alignment, not just the old floor');
      e.vocalStop();
      assert.equal(e.slewVocal(0, 20, sd, 1, 1), false, 'silent sources explicitly decline');
    }
    console.log('Vocal S-curve PASS: accepted/declined state is atomic, actual-rate anchors, <=1 cent onset, right-after-start -28ms, both signs and exact integrated phase.');
  }

  {
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 70, sampleRate:48000}), starts = [];
    buf.getChannelData(0).fill(0.1);
    for (let at = 3; at < 69; at += 4) buf.getChannelData(0).fill(0, 48000 * at, 48000 * (at + .6));
    c.createBufferSource = () => ({connect:dst => dst, start:(...args) => starts.push(args), stop(){}});
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    let shift = 0, target = 0, dirty = false;
    const counts = [];
    for (let step = 0; step < 320; step++) {
      if (step === 14) { target = 0.02; dirty = true; }
      if (step === 94) { counts.push(starts.length); target = 0.08; dirty = true; }
      if (step === 190) { counts.push(starts.length); target = 0.07; dirty = true; }
      shift += Math.max(-0.0015, Math.min(0.0015, target - shift));
      const time = 1 + step * 0.125 + shift, pos = Math.floor(step / 16);
      c.currentTime = time - 0.01;
      if (step % 16 === 0) e.vocal(time, pos, 0, time, false, dirty);
      if (dirty && Math.abs(target - shift) < 0.002) dirty = e.vocal(time, pos, step % 16, time, true) === false;
    }
    assert.deepEqual(counts, [1, 2]);
    assert.equal(starts.length, 2, '40s playback has no restart for ordinary slews and only one for the large correction');
    assert.ok(Math.abs(e.vocalNow.origin - 1.08) < 0.002);
    e.vocalStop();
    buf.getChannelData(0).fill(0.1);
    const sung = new FakeBuffer({length:48000 * 70, sampleRate:48000}); sung.getChannelData(0).fill(0.1);
    e.vocalOf = () => ({buf:sung, gain:1, duck:1, lift:1, ms:0});
    c.currentTime = 0; e.vocal(1, 0, 0, 1);
    const first = e.vocalNow.src;
    assert.equal(e.vocal(3.04, 1, 0, 3.04, true), false);
    assert.equal(e.vocalNow.src, first, 'a large correction cannot restart a phrase with no gap');
    for (let pos = 2; pos < 20; pos++) {
      c.currentTime = 1 + pos * 2;
      assert.equal(e.vocal(1.04 + pos * 2, pos, 0, 1.04 + pos * 2, true), false);
      assert.equal(e.vocalNow.src, first, 'a residual below60ms drifts for as long as no gap exists');
    }
    e.vocal(42, 0, 0, 42, false, true);
    assert.notEqual(e.vocalNow.src, first, 'holding a correction cannot suppress the next natural song cycle');
    console.log('Room vocal continuity PASS: 40s, three slews across bar lines, zero ordinary restarts and one large-gap reanchor; no-gap phrase remains continuous.');
  }

  for (const gapAt of [null, 3, 7]) {
    const gap = gapAt !== null, delta = gapAt === 7 ? .04 : .08;
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 12, sampleRate:48000}), starts = [];
    buf.getChannelData(0).fill(0.1);
    if (gap) buf.getChannelData(0).fill(0, 48000 * gapAt, 48000 * (gapAt + .5));
    c.createBufferSource = () => ({connect:dst => dst, start:(...args) => starts.push(args), stop(){}});
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    e.vocal(1, 0, 0, 1);
    const old = e.vocalNow.src;
    if (gapAt === 3) {
      const original = old.buffer;
      old.buffer = new FakeBuffer({length:48000 * 12, sampleRate:48000});
      old.buffer.getChannelData(0).fill(.1);
      assert.equal(e.vocal(3.08, 1, 0, 3.08, true), false, 'the audible old processed source must also be silent, not only the replacement');
      old.buffer = original;
    }
    if (gapAt === 7) {
      assert.equal(e.vocal(3 + delta, 1, 0, 3 + delta, true), false, 'a distant quiet gap is queued only when it enters the two-bar horizon');
      assert.equal(starts.length, 1);
    }
    const pos = gapAt === 7 ? 2 : 1, time = 1 + pos * 2 + delta;
    assert.equal(e.vocal(time, pos, 0, time, true), gap);
    assert.equal(e.vocalNow.src === old, !gap);
    assert.equal(starts.length, gap ? 2 : 1);
    assert.equal(e.vocalCorrection.gap, gap);
    if (gap) {
      assert.ok(Math.abs(starts[1][0] - (gapAt + 1.42)) < 1e-9, 'a future phrase gap is used even beyond one bar');
      assert.ok(Math.abs(starts[1][1] - (gapAt + .42 - delta)) < 1e-9, 'replacement starts in silent pre-roll before the next phrase, never mid-word');
    }
    e.vocal(time, pos, 0, time, true);
    assert.equal(starts.length, gap ? 2 : 1, 'no-gap corrections drift; aligned gap updates cannot restart twice');
  }
  console.log('Room large vocal correction PASS: silent pre-roll before a phrase onset; smaller no-gap corrections remain continuous while larger corrections wait for a bounded downbeat.');

  {
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 12, sampleRate:48000}), sources = [];
    buf.getChannelData(0).fill(0.1);
    buf.getChannelData(0).fill(0, 48000 * 3, 48000 * 3.5);
    c.createBufferSource = () => {
      const source = {connect:dst => dst, start(){}, stops:[], stop(t){this.stops.push(t);}};
      sources.push(source); return source;
    };
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    e.vocal(1, 0, 0, 1);
    c.currentTime = 3.08;
    e.vocal(3.08, 1, 0, 3.08, true, false, 2);
    assert.equal(sources.length, 2);
    assert.ok(sources[0].stops.at(-1) > 4, 'the old source is still audible before the chosen gap');
    c.currentTime = 3.2;
    e.panic();
    assert.ok(sources.every(source => Math.abs(source.stops.at(-1) - 3.26) < 1e-9), 'Stop cancels both the audible retiring source and its future replacement');
    assert.equal(e.vocalNow, null);
    c.currentTime = 3.4;
    e.panic();
    assert.equal(e.vocalRetiring.length, 0, 'expired sources are pruned and repeated Stop stays silent');
  }
  console.log('Pending vocal Stop PASS: audible old source and future quiet-gap replacement both stop immediately; expired voices are pruned.');

  for (const [origin, allowed] of [[.5, false], [.6, true]]) {
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 12, sampleRate:48000}), sources = [];
    buf.getChannelData(0).fill(.1);
    buf.getChannelData(0).fill(0, 48000 * 3, 48000 * 3.5);
    c.createBufferSource = () => {
      const source = {connect:dst => dst, starts:[], stops:[], start(...args){this.starts.push(args);}, stop(t){this.stops.push(t);}};
      sources.push(source); return source;
    };
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    e.vocal(1, 0, 0, 1);
    c.currentTime = 2.5;
    assert.equal(e.vocal(2.8, 1, 0, 2.8, true), true);
    const pending = e.vocalNow;
    assert.ok(Math.abs(sources[1].starts[0][0] - 4.22) < 1e-9);
    c.currentTime = 2.6;
    const t = origin + 2.25;
    assert.equal(e.vocal(t, 1, 2, t, true), allowed, 'a pending replacement is not the audible voice at an earlier handover');
    if (!allowed) {
      assert.equal(e.vocalNow, pending);
      assert.equal(sources.length, 2);
      assert.ok(Math.abs(sources[0].stops.at(-1) - 4.28) < 1e-9, 'the audible phrase must not fade at3.92 while it sings until4.0');
    } else {
      assert.equal(sources.length, 3);
      assert.ok(Math.abs(sources[2].starts[0][0] - 4.02) < 1e-9);
      assert.ok(Math.abs(sources[2].starts[0][1] - 3.42) < 1e-9, 'the replacement starts inside the actual gap');
      assert.ok(sources[0].stops.at(-1) > 4, 'the old phrase completes before its newly scheduled fade');
      assert.ok(sources[1].stops.at(-1) < sources[1].starts[0][0], 'the superseded pending voice is cancelled before it can sound');
      c.currentTime = 2.7;
      e.panic();
      assert.ok(sources.every(source => Math.abs(source.stops.at(-1) - 2.76) < 1e-9), 'Stop still cancels the audible voice and both future replacements');
    }
  }
  console.log('Pending vocal retime PASS: earlier handovers validate the audible retiring voice, reject sung regions, preserve silent replacements and cancel all pending sources.');

  {
    for (const [step, expected] of [[0,32], [17,48], [33,64], [97,128], [128,160]]) {
      assert.equal(vocalReanchorStep(step), expected);
      assert.equal(expected % 16, 0);
      assert.ok(expected > step && expected <= step + 32);
    }
    const incoming = vocalCrossfade(true), outgoing = vocalCrossfade(false);
    for (let i = 0; i < incoming.length; i++) assert.ok(Math.abs(incoming[i] ** 2 + outgoing[i] ** 2 - 1) < 1e-6);
    assert.equal(incoming[0], 0); assert.equal(incoming.at(-1), 1);
    assert.equal(outgoing[0], 1); assert.ok(outgoing.at(-1) < 1e-6);
    for (const during of [false, true]) {
      const c = fakeCtx(), s = defaultState(); s.bpm = 120;
      const sources = [], gains = [];
      c.createGain = () => {
        const g = node(c, 'Gain'), p = param();
        p.curves = []; p.holds = [];
        p.setValueCurveAtTime = (values, at, duration) => p.curves.push({values:Array.from(values), at, duration});
        p.cancelAndHoldAtTime = at => p.holds.push(at);
        g.gain = p; gains.push(g); return g;
      };
      c.createBufferSource = () => {
        const source = {connect:dst => dst, starts:[], stops:[], start(...args){this.starts.push(args);}, stop(at){this.stops.push(at);}};
        sources.push(source); return source;
      };
      const buf = new FakeBuffer({length:48000 * 20, sampleRate:48000}); buf.getChannelData(0).fill(.1);
      const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:.5, lift:.5, ms:0})});
      let sends = 0, ducks = 0;
      e.vocalSends = () => sends++;
      e.duckUnder = () => ducks++;
      e.vocal(1, 0, 0, 1);
      const before = {sends, ducks};
      const forceStep = 48;
      for (let index = 17; index <= forceStep; index++) {
        const time = 1.12 + index * .125;
        c.currentTime = time - .1;
        assert.equal(e.vocal(time, index >> 4, index % 16, time, true), index === forceStep);
        assert.equal(sources.length, index === forceStep ? 2 : 1, 'a forced source is not queued before its downbeat');
      }
      assert.deepEqual({sends, ducks}, before, 'a forced alignment cannot reset sends, ducking or carving');
      assert.equal(e.vocalCorrection.forced, true);
      assert.equal(e.vocalCorrection.forceStep, forceStep);
      assert.equal(e.vocalCorrection.crossfadeSeconds, .03);
      const fadeAt = 1.12 + forceStep * .125;
      assert.ok(Math.abs(sources[1].starts[0][0] - fadeAt) < 1e-9);
      assert.equal(sources[1].starts[0][1], forceStep * .125);
      const curves = gains.flatMap(g => g.gain.curves);
      assert.equal(curves.length, 2);
      assert.ok(curves.every(curve => Math.abs(curve.at - fadeAt) < 1e-9 && curve.duration === .03));
      assert.deepEqual(curves[0].values, Array.from(outgoing));
      assert.deepEqual(curves[1].values, Array.from(incoming));
      e.vocal(fadeAt + .125, forceStep >> 4, 1, fadeAt + .125, true);
      e.vocal(fadeAt + .25, forceStep >> 4, 2, fadeAt + .25, true);
      assert.equal(sources.length, 2, 'the same correction cannot force a second source');
      const gain = e.vocalNow.g.gain;
      c.currentTime = fadeAt + (during ? .015 : -.01);
      e.panic();
      assert.equal(e.vocalNow, null);
      assert.ok(sources.every(source => source.stops.at(-1) <= c.currentTime + .060001), 'Stop cancels both the audible and replacement voices before or during a forced fade');
      assert.deepEqual(gain.holds, [c.currentTime], 'an active fade curve is held before Stop automates its gain');
    }
  }
  {
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 12, sampleRate:48000}), sources = [];
    const audio = buf.getChannelData(0);
    audio.fill(.1);
    audio.fill(0, 48000 * 7, 48000 * 7.5);
    c.createBufferSource = () => {
      const source = {connect:dst => dst, starts:[], stops:[], start(...args){this.starts.push(args);}, stop(at){this.stops.push(at);}};
      sources.push(source); return source;
    };
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    e.variableScoreTempo = true;
    e.vocal(1, 0, 0, 1);
    const original = e.vocalNow;
    for (let index = 17; index < 56; index++) {
      e.stepScale = index % 16 ? 1.01 : 1;
      const time = 1.08 + index * .125;
      c.currentTime = time - .1;
      assert.equal(e.vocal(time, index >> 4, index % 16, time, true), false);
      assert.equal(e.vocalNow, original, 'waiting for a rubato gap never splices a sustained phrase');
      assert.equal(e.vocalNow.correction, undefined, 'even nominal steps in a variable-tempo score cannot arm a forced splice');
    }
    assert.equal(sources.length, 1);
    assert.deepEqual(sources[0].stops, []);
    const time = 1.08 + 56 * .125;
    c.currentTime = time - .1;
    assert.equal(e.vocal(time, 3, 8, time, true), true);
    assert.equal(sources.length, 2);
    assert.equal(e.vocalCorrection.forced, false);
    const [[at, offset]] = sources[1].starts;
    assert.ok(offset >= 7 && at - 1 + .06 <= 7.5, 'both voices are quiet at the first reachable gap');
  }
  for (const {duration, gapAt, beforeDownbeat} of [
    {duration:.105, gapAt:7.98, beforeDownbeat:false},
    {duration:.140, gapAt:8, beforeDownbeat:true},
  ]) {
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 12, sampleRate:48000}), data = buf.getChannelData(0);
    data.fill(.1); data.fill(0, Math.round(gapAt * 48000), 48000 * 8.5);
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:5})});
    e.variableScoreTempo = true;
    e.vocal(1, 0, 0, 1);
    const penultimate = 1.08 + 63 * .125;
    for (let index = 17; index <= 64; index++) {
      const time = index === 64 ? penultimate + duration : 1.08 + index * .125;
      c.currentTime = time - .2;
      assert.equal(e.vocal(time, index >> 4, index % 16, time, true), index === 64);
    }
    const {at, gap, forced} = e.vocalCorrection;
    assert.equal(gap, true);
    assert.equal(forced, false);
    const downbeat = penultimate + duration;
    if (beforeDownbeat) assert.ok(Math.abs(at - (penultimate + .130)) < 1e-9, 'slowed grid admits the gap before the actual downbeat');
    else assert.equal(at, downbeat, 'faster grid forbids queuing a gap past the actual downbeat');
  }
  for (const lookahead of [.11, .02]) {
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 10, sampleRate:48000}), starts = [];
    const audio = buf.getChannelData(0), boundary = 8.08;
    for (let i = 0; i < audio.length; i++) {
      const t = i / 48000;
      audio[i] = .1 * Math.sin(2 * Math.PI * (280 * Math.min(t, boundary) + 335 * Math.max(0, t - boundary)));
    }
    c.createBufferSource = () => ({connect:dst => dst, start:(...args) => starts.push(args), stop(){}});
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    e.variableScoreTempo = true;
    e.vocal(1, 0, 0, 1);
    const downbeat = 1.12 + 64 * .125;
    for (let index = 1; index <= 64; index++) {
      const time = 1 + (index < 49 ? 0 : .12) + index * .125;
      c.currentTime = time - lookahead;
      assert.equal(e.vocal(time, index >> 4, index % 16, time, true), index < 49 || index === 64);
    }
    const [[at, offset]] = starts.slice(1);
    if (lookahead > .02) {
      assert.ok(at < downbeat - .05 && at >= downbeat - .09 - 1e-9, 'a pitch clash moves the fade earlier within the available lookahead');
      assert.ok(at + .03 - 1 < boundary, 'the shifted crossfade completes before the outgoing note changes');
    } else assert.equal(at, downbeat, 'insufficient lookahead keeps the deadline fade');
    assert.ok(Math.abs(offset + downbeat - at - 8) < 1e-9, 'the incoming source is still aligned at the downbeat');
  }
  {
    const outgoing = new FakeBuffer({length:1440}), incoming = new FakeBuffer({length:1440});
    outgoing.getChannelData(0).fill(1);
    incoming.getChannelData(0).fill(1).fill(-1, 624, 816);
    assert.ok(vocalFadePowerRatio(outgoing, incoming, 0, 0, 1) < 0.5,
      'a 4 ms dip straddling the fixed 15 ms boundary is detected in a sliding 5 ms window');
    outgoing.getChannelData(0).fill(0).fill(0.31, 0, 240);
    incoming.getChannelData(0).fill(0).fill(0.17, 0, 240);
    assert.equal(vocalFadePowerRatio(outgoing, incoming, 0, 0, 1), 1,
      'silent windows after an in-phase fade do not register a dip');
  }
  {
    const outgoing = new FakeBuffer({length:2400}), incoming = new FakeBuffer({length:2400});
    const a = outgoing.getChannelData(0), b = incoming.getChannelData(0);
    for (let i = 0; i < a.length; i++) {
      const t = i / 48000, mid = .30 * Math.sin(2 * Math.PI * 1000 * t);
      const low = .015 * Math.sin(2 * Math.PI * 250 * t), high = .12 * Math.sin(2 * Math.PI * 4250 * t);
      a[i] = mid + low + high; b[i] = mid - low - high;
    }
    assert.equal(vocalFadePowerRatio(outgoing, incoming, .02, .02, 1), 1, 'an in-phase midrange can hide band cancellation');
    const bands = vocalFadeBandPowerRatios(outgoing, incoming, .02, .02, 1);
    assert.ok(bands.presence < .5, 'the presence band detects a dip hidden by broadband power');
    assert.equal(bands.low, 1, 'cancellation in a band below 1% of local power does not count');
    assert.equal(bands.mid, 1);
  }
  {
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 8});
    const audio = buf.getChannelData(0), delay = .102, deadline = 32;
    for (let i = 0; i < audio.length; i++) {
      const t = i / 48000;
      audio[i] = .30 * Math.sin(2 * Math.PI * 1000 * t) + .12 * Math.sin(2 * Math.PI * 4250 * t);
    }
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    e.variableScoreTempo = true;
    e.vocal(1, 0, 0, 1);
    for (let index = 17; index <= deadline; index++) {
      const time = 1 + delay + index * .125;
      c.currentTime = time - .020001;
      assert.equal(e.vocal(time, index >> 4, index % 16, time, true), index === deadline);
    }
    const {at, fallbackFadeGuard} = e.vocalCorrection;
    assert.equal(at, 1 + delay + deadline * .125, 'a failed band guard does not delay a mandatory fade');
    assert.ok(fallbackFadeGuard.dipDb.presence > 1.5);
    assert.ok(fallbackFadeGuard.dipDb.broadband < 1.5);
    assert.deepEqual(e.lastVocalFallbackFadeGuard, {at, step:deadline, ...fallbackFadeGuard});
  }
  for (const {lookahead, delay, bend, cancels} of [
    {lookahead:.39, delay:.04, bend:true},
    {lookahead:.08, delay:.04, bend:true},
    {lookahead:.39, delay:.04, bend:false},
    {lookahead:.39, delay:.035, bend:true, cancels:true},
  ]) {
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 10, sampleRate:48000}), starts = [];
    const audio = buf.getChannelData(0), transition = 7.85, glide = .35;
    for (let i = 0; i < audio.length; i++) {
      const t = i / 48000, progress = Math.min(glide, Math.max(0, t - transition));
      const cycles = 300 * t + (bend ? 34 * progress ** 2 / glide + 68 * Math.max(0, t - transition - glide) : 0);
      audio[i] = .1 * Math.sin(2 * Math.PI * cycles);
    }
    c.createBufferSource = () => ({connect:dst => dst, start:(...args) => starts.push(args), stop(){}});
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    e.variableScoreTempo = true;
    e.vocal(1, 0, 0, 1);
    const downbeat = 1 + delay + 64 * .125;
    for (let index = 1; index <= 64; index++) {
      const time = 1 + (index < 17 ? 0 : delay) + index * .125;
      c.currentTime = time - lookahead;
      assert.equal(e.vocal(time, index >> 4, index % 16, time, true), index < 17 || index === 64);
    }
    const [[at, offset]] = starts.slice(1);
    if (!bend) assert.equal(at, downbeat, 'a well-matched fade keeps its placement');
    else if (cancels) assert.ok(at + .03 >= 1 + transition, 'a closer pitch match is rejected if it cancels in phase');
    else if (lookahead === .39) {
      assert.ok(at < downbeat - .125, 'a better pitch match can be before the preceding step');
      assert.ok(at + .03 < 1 + transition, 'the fade uses the matching pitch before the bend');
    } else assert.ok(at >= c.currentTime + .02 - 1e-9, 'the search does not advance past available lookahead');
    assert.ok(Math.abs(offset + downbeat - at - 8) < 1e-9, 'the pitch-matched fade preserves grid phase');
  }
  {
    const s = defaultState(); s.bpm = 120; s.chain = 'AAB'; s.chainOn = true;
    s.patterns[0].score = {form:'nocturne', seed:7};
    const e = new Engine(fakeCtx(), s, {realtime:false});
    const seq = new Sequencer(e, s), count = 19;
    seq.origin = 32;
    for (let step = 0; step < 15; step++) seq.tick(seq.origin + step, 1);
    const first = seq.origin + 15;
    seq.tick(first, 1);
    const projected = seq.gridSpan(first, count);
    assert.equal(seq.gridSpan(first, count, bar => bar === 2 ? 1 : 0), 0, 'preview skips defer to the scheduled grid');
    let scheduled = e.stepDur;
    for (let offset = 1; offset < count; offset++) {
      seq.tick(first + offset, 1);
      scheduled += e.stepDur;
    }
    assert.equal(projected, scheduled, 'preview uses actual score durations across a change to constant tempo');
  }
  for (const {error, deadline, recovered} of [
    {error:.12, deadline:32},
    {error:.08, deadline:64},
    {error:.08, deadline:80, recovered:44},
  ]) {
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 12, sampleRate:48000});
    buf.getChannelData(0).fill(.1);
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    e.variableScoreTempo = true;
    e.vocal(1, 0, 0, 1);
    const original = e.vocalNow;
    for (let index = 17; index <= deadline; index++) {
      const time = 1 + (index === recovered ? 0 : error) + index * .125;
      c.currentTime = time - .1;
      assert.equal(e.vocal(time, index >> 4, index % 16, time, true), index === recovered || index === deadline);
      assert.equal(e.vocalNow === original, index < deadline);
      if (index === recovered) assert.equal(e.vocalNow.gapCorrection, null, 'settling within tolerance clears the wait deadline');
    }
    assert.equal(e.vocalCorrection.forced, true);
    assert.equal(e.vocalCorrection.forceStep, deadline);
    assert.equal(e.vocalCorrection.at, 1 + error + deadline * .125);
    assert.equal(e.vocalCorrection.crossfadeSeconds, .03);
  }
  for (const {delay = .096, hz = 250, gap = false, clash = false, unvoiced = false,
    lookahead = .3, firstStrong = 31, earlyStep = null, lastStep = 32, deadline = 64} of [
    {earlyStep:32},
    {firstStrong:27, earlyStep:28},
    {firstStrong:27, delay:.104, lastStep:31, deadline:32},
    {delay:.08},
    {gap:true},
    {clash:true, lookahead:.02},
    {unvoiced:true, lookahead:.021},
    {hz:24.5 / .096},
  ]) {
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 12, sampleRate:48000});
    const pcm = buf.getChannelData(0), change = 4.06;
    for (let i = 0; i < pcm.length; i++) {
      const time = i / 48000;
      const cycles = time * hz + (clash ? 100 * Math.max(0, time - change) : 0);
      const quiet = gap && time >= 4.3 && time < 4.8 || unvoiced && time >= 3.952 && time < 3.998;
      pcm[i] = quiet ? 0 : .1 * Math.sin(2 * Math.PI * cycles);
    }
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    e.variableScoreTempo = true;
    e.vocal(1, 0, 0, 1);
    const original = e.vocalNow;
    for (let index = 17; index <= (earlyStep ?? lastStep); index++) {
      const time = 1 + (index < firstStrong ? .08 : delay) + index * .125;
      c.currentTime = time - lookahead;
      assert.equal(e.vocal(time, index >> 4, index % 16, time, true), index === earlyStep,
        'only a large, gapless drift with a stable pitch and phase match can force early');
    }
    if (earlyStep !== null) {
      assert.notEqual(e.vocalNow, original);
      assert.equal(e.vocalCorrection.forced, true);
      assert.equal(e.vocalCorrection.forceStep, earlyStep);
      assert.equal(e.vocalNow.origin, 1 + delay);
    } else {
      assert.equal(e.vocalNow, original);
      assert.equal(e.vocalNow.gapCorrection.forceStep, deadline, 'rejecting an early fade keeps the original deadline');
    }
  }
  {
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 12, sampleRate:48000}), full = new FakeBuffer({length:48000 * 12, sampleRate:48000}), starts = [];
    buf.getChannelData(0).fill(.1); full.getChannelData(0).fill(.1);
    buf.getChannelData(0).fill(0, 48000 * 3, 48000 * 3.5);
    c.createBufferSource = () => ({connect:dst => dst, start:(...args) => starts.push(args), stop(){}});
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    e.vocal(1, 0, 0, 1);
    e.vocalNow.src.buffer = full;
    c.currentTime = 2.8;
    assert.equal(e.vocal(3.08, 1, 0, 3.08, true), false);
    assert.equal(e.vocalNow.correction.forceStep, 48);
    e.vocalNow.src.buffer = buf;
    c.currentTime = 2.9;
    assert.equal(e.vocal(3.205, 1, 1, 3.205, true), true);
    assert.equal(e.vocalCorrection.gap, true);
    assert.equal(e.vocalCorrection.forced, false);
    for (let index = 18; index <= 48; index++) {
      const time = 1.08 + index * .125;
      c.currentTime = time - .1;
      e.vocal(time, index >> 4, index % 16, time, true);
    }
    assert.equal(starts.length, 2, 'a qualifying silent gap cancels the pending forced alignment');
  }
  console.log('Room forced vocal alignment PASS: preferred downbeat within two bars, lazy30ms equal-power crossfade, no duck/send reset, once per correction, gap-first cancellation and Stop before/during the fade.');

  {
    const c = fakeCtx(), s = defaultState(); s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 20, sampleRate:48000}); buf.getChannelData(0).fill(.1);
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    e.vocal(1, 0, 0, 1);
    c.currentTime = 3.145;
    assert.equal(e.vocal(3.245, 1, 1, 3.245, true), false);
    assert.equal(e.vocalNow.correction.forceStep, 48);
    c.currentTime = 3.17;
    assert.equal(e.vocal(3.27, 1, 2, 3.27, true), true);
    assert.equal(e.vocalNow.correction, null, 'a residual that converges within tolerance cancels the pending force');
    c.currentTime = 5.145;
    assert.equal(e.vocal(5.245, 2, 1, 5.245, true), false);
    assert.equal(e.vocalNow.correction.forceFrom, 33);
    assert.equal(e.vocalNow.correction.forceStep, 64, 'a new correction gets a fresh two-bar window');
  }

  {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const source = main.slice(main.indexOf('function schedule(lead)'), main.indexOf('\n// Jam:'));
    for (const [name, sign, drift, initial = 0] of [
      ['stable40', 1, false], ['stable40', -1, false], ['drift5', 1, true], ['drift5', -1, true],
      ['voice40', 1, false, .04], ['voice40', -1, false, .04],
    ]) for (const bpm of drift ? [123, 240] : [40, 123, 240]) {
      const c = fakeCtx(), state = defaultState(), starts = [], rates = [], hits = [], relocations = [];
      state.bpm = bpm;
      const buf = new FakeBuffer({length:48000 * 80, sampleRate:48000});
      buf.getChannelData(0).fill(.1);
      c.createBufferSource = () => ({connect:dst => dst, start:(...args) => starts.push(args), stop(){},
        playbackRate:{
          setValueAtTime:(rate, at) => rates.push({rate, at, ramp:false}),
          linearRampToValueAtTime:(rate, at) => rates.push({rate, at, ramp:true}),
          cancelScheduledValues(){},
        }});
      const engine = new Engine(c, state, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
      const sd = engine.stepDur, noop = () => {};
      c.currentTime = 9.5;
      const initialOrigin = 10 + sign * initial;
      engine.vocal(initialOrigin, 0, 0, initialOrigin);
      engine.roomSlewRate = 1;
      const original = engine.vocalNow.src;
      let elapsed = 0;
      const offset = () => name === 'voice40' ? 0 : sign * (drift ? .005 * Math.min(50, Math.floor(Math.max(0, elapsed - 2) * 2 + 1e-8) / 2) : elapsed >= 2 ? .04 : 0);
      const s = {playing:true, songOver:false, roomPlayback:true, roomEditor:false, ROOM_LEAD:.42, BG_LEAD:1.5,
        mediaRoute:null, roomMediaSync:createRoomMediaSync(), roomMediaLead, roomMediaTime,
        document:{hidden:false}, ctx:c, Date:{now:() => (c.currentTime + 1000 + offset()) * 1000},
        performance:{now:() => c.currentTime * 1000}, state, engine, clockOffset:1000,
        roomAudioClock:{at:9.5, contextTime:9.5, pending:null}, roomDrainUntil:null, vocalGridDirty:false,
        transportOrigin:1010000, abs:0, nextTime:10, queuedRoomReplay:null, handoff:null, jamQueue:[], uiQueue:[],
        syncAudioClock, transportResync, slewTransport, roomTransportCorrection,
        seq:{origin:0, chainPos:1, songBars:256, advanceBar:noop, rewind:noop,
          tick:(step, time) => {
            hits.push({step, time}); s.seq.chainPos = Math.floor(step / 16) + 1;
            if (step % 16 === 0) engine.vocal(time, Math.floor(step / 16), 0, time, false, true);
            return {};
          }},
        timeline:{skip:() => 0}, artistTick:noop, landJamParts:noop,
        midiClockStart:() => relocations.push(s.abs), midiClockStep:noop};
      const schedule = runInNewContext(source+'\nschedule', s);
      let previousDrum = 0, previousVocal = 0;
      for (let tick = 0; tick <= 3500; tick++) {
        elapsed = tick / 50; c.currentTime = 9.5 + elapsed;
        schedule();
        const drum = 10 + s.abs * sd - s.nextTime, vocal = initialOrigin - engine.vocalNow.origin;
        assert.ok(sign * (drum - previousDrum) >= -1e-9, 'drum correction has no reversal or oscillation');
        assert.ok(sign * (vocal - previousVocal) >= -1e-9, 'vocal correction has no reversal or oscillation');
        assert.ok(sign * drum <= sign * offset() + 1e-9, 'drums never overshoot the true offset');
        assert.ok(sign * vocal <= sign * offset() + initial + 1e-9, 'vocal never overshoots the true offset');
        assert.equal(engine.vocalNow.src, original, 'small accepted corrections keep the sung source through every bar');
        previousDrum = drum; previousVocal = vocal;
      }
      const expected = name === 'voice40' ? 0 : sign * (drift ? .25 : .04), expectedVocal = expected + sign * initial;
      assert.ok(Math.abs(s.clockOffset - 1000 - expected) < 1e-9, 'the median mapping converges to the final true estimate');
      assert.ok(Math.abs(previousDrum - expected) < 1e-8, 'total drum correction equals the true offset once, not twice');
      assert.ok(Math.abs(previousVocal - expectedVocal) < 1e-8, 'total vocal correction equals its true offset once');
      assert.equal(engine.roomSlewRate, 1);
      assert.equal(relocations.length, 0, 'sub-step corrections never drain, adopt or skip a sixteenth');
      assert.ok(hits.every((h, i) => h.step === i && (!i || h.time > hits[i-1].time)));
      assert.ok(hits.every((h, i) => !i || Math.abs(h.time - hits[i-1].time - sd) <= .0015 + 1e-9),
        'drum intervals stay within the1.5ms/step slew bound');
      let nativeOrigin = initialOrigin, at = initialOrigin, rate = 1;
      for (const event of rates) {
        assert.ok(event.at >= at, 'native vocal automation remains ordered');
        nativeOrigin += (1 - (event.ramp ? (rate + event.rate) / 2 : rate)) * (event.at - at);
        at = event.at; rate = event.rate;
      }
      assert.ok(Math.abs(initialOrigin - nativeOrigin - expectedVocal) < 1e-8, 'independently integrated native playbackRate equals the true correction');
      assert.equal(starts.length, 1, 'zero mid-phrase restarts, gap realigns or forced operations for convergent small corrections');
      assert.equal(rate, 1);
      console.log(`Room integrated ${name} ${sign > 0 ? '+' : '-'} ${bpm}BPM PASS: drum=${(expected * 1000).toFixed(1)}ms vocal/native=${(expectedVocal * 1000).toFixed(1)}ms, no overshoot/oscillation/skip/restart, unity rate.`);
    }
  }

  {
    const c = fakeCtx(), s = defaultState(), events = [];
    s.bpm = 120;
    const buf = new FakeBuffer({length:48000 * 20, sampleRate:48000});
    c.createBufferSource = () => ({connect:dst => dst, start(){}, stop(){}, playbackRate:{
      setValueAtTime:(rate, at) => events.push({rate, at}),
      linearRampToValueAtTime:(rate, at) => events.push({rate, at}),
      cancelScheduledValues:at => events.push({cancel:at}),
    }});
    const e = new Engine(c, s, {vocal:() => ({buf, gain:1, duck:1, lift:1, ms:0})});
    e.vocal(1, 0, 0, 1);
    const duration = e.stepDur, delta = 2 * duration / 1.998 - duration;
    e.slewVocal(delta, 1, duration, 1, .998);
    const origin = e.vocalNow.origin, end = e.vocalNow.slewEnd;
    e.cancelVocalSlew();
    assert.equal(events.at(-1).rate, 1);
    assert.ok(events.at(-1).at > end, 'large-mode handoff preserves the already queued ramp');
    assert.ok(Math.abs(e.vocalNow.origin - origin - .002 / c.sampleRate) < 1e-9);
    const count = events.length;
    e.cancelVocalSlew();
    assert.equal(events.length, count, 'a drain cancels a vocal slew once, not once per poll');
    assert.equal(e.vocalNow.slewRate, 1);
    console.log('Room slew handoff PASS: large-mode drain retires the queued rate once at unity without counting its phase twice.');
  }

  {
    const curveStart = 2.153393336377362, wake = 15.461587301587302;
    const curveParam = () => ({
      value: 1, curve: { start: curveStart, duration: 76.06 }, targets: [],
      cancelAndHoldAtTime(t) {
        if (this.curve && t > this.curve.start && t < this.curve.start + this.curve.duration)
          this.curve.duration = t - this.curve.start;
      },
      setTargetAtTime(value, t, constant) {
        if (this.curve && t >= this.curve.start && t < this.curve.start + this.curve.duration)
          throw new DOMException('setTargetAtTime overlaps setValueCurveAtTime', 'NotSupportedError');
        this.targets.push([value, t, constant]);
      },
      setValueCurveAtTime(values, t, duration) { this.curve = { start: t, duration }; },
    });
    const rounded = curveParam();
    rounded.cancelAndHoldAtTime(wake);
    assert.ok(rounded.curve.start + rounded.curve.duration > wake);
    assert.throws(() => rounded.setTargetAtTime(1, wake, .08), { name: 'NotSupportedError' });
    for (const future of [false, true]) {
      const c = fakeCtx(), s = defaultState(), starts = [], stops = [];
      s.bpm = 123;
      const buf = new FakeBuffer({ length: 48000 * 24, sampleRate: 48000 });
      c.createBufferSource = () => {
        const src = { connect: dst => dst, start: (...args) => starts.push(args), stop: t => stops.push([src, t]) };
        return src;
      };
      const e = new Engine(c, s, { trackQueuedNotes: true,
        vocal: () => ({ buf, gain: 1, duck: .5, lift: .75, ms: 0 }) });
      e.vocal(2.124612848572484, 1);
      const old = e.vocalNow.src;
      const params = Array.from({ length: 4 }, curveParam);
      [e.bandDuck.gain, e.singTrim.gain] = params;
      e.ch.stab.carve = { gain: params[2] };
      e.hookCarve = { gain: params[3] };
      const queued = { start() {}, stop: t => stops.push(['queued', t]) };
      e.startSource(queued, wake + 1);
      c.currentTime = future ? wake - .1 : wake;
      assert.doesNotThrow(() => e.discardQueuedNotes(wake), 'a rounded held curve cannot abort queue discard');
      assert.equal(e.vocalNow, null);
      assert.deepEqual(stops, [[old, wake + .06], ['queued', wake]]);
      assert.equal(e.queuedNotes.length, 0);
      assert.equal(e.editableHits.length, 0);
      assert.equal(e.ducks.length, 0);
      for (const [i, p] of params.entries())
        assert.deepEqual(p.targets, [[i < 2 ? 1 : 0, wake + 1 / c.sampleRate, .08]]);
      assert.doesNotThrow(() => e.vocal(wake, 8, 4, wake), 'the replacement stem can automate the held parameters');
      assert.notEqual(e.vocalNow.src, old);
      assert.equal(starts.length, 2);
      e.vocalStop(wake + .1);
      const count = stops.length;
      e.vocalStop(wake + .1);
      assert.equal(stops.length, count, 'an empty vocal stop stays a no-op');
      e.vocalOf = () => null;
      e.vocal(wake + .2, 9);
      assert.equal(starts.length, 2, 'a missing stem stays silent after discard');
    }
    console.log('Vocal cancellation PASS: captured rounded-curve overlap throws; wake/future discard completes, stops sources, clears queues and restarts; empty/missing stems stay silent.');
  }

  {
    const c = fakeCtx(24000), s = defaultState();
    const buf = new FakeBuffer({ length: 48000, sampleRate: 24000 });
    buf.getChannelData(0).fill(.1);
    let stem = null, buffers = 0;
    const createBuffer = c.createBuffer;
    c.createBuffer = (...args) => { buffers++; return createBuffer(...args); };
    const e = new Engine(c, s, { vocal: () => stem });
    e.prepareVocal();
    assert.equal(e.vocalFx, undefined, 'no stem leaves the vocal FX unbuilt');
    stem = { buf, fx: VOCAL_FX.pop, gain: 1, duck: .5, lift: .8, ms: 0 };
    e.prepareVocal();
    const F = e.vocalFx, impulse = F.plate.buffer, preparedBuffers = buffers, preparedNodes = counts.n;
    const expected = makeIR(c, 1.6, { decay: 3.2, brightStart: .9, brightEnd: .35, predelay: .012, seed: 97 });
    assert.deepEqual(impulse.getChannelData(0), expected.getChannelData(0), 'preparation preserves the plate IR');
    assert.deepEqual(impulse.getChannelData(1), expected.getChannelData(1));
    buffers = preparedBuffers;
    const automation = [];
    for (const [name, p] of [['plate', F.plateSend.gain], ['delay', F.dly.delayTime], ['send', F.dlySend.gain], ['feedback', F.fb.gain]])
      p.setTargetAtTime = (...args) => automation.push([name, ...args]);
    const getChannelData = buf.getChannelData.bind(buf);
    buf.getChannelData = () => { throw new Error('Unprepared vocal buffer scan'); };
    e.prepareVocal();
    assert.equal(counts.n, preparedNodes, 'preparing again does not rebuild FX');
    assert.equal(buffers, preparedBuffers, 'IR and processed stem are cached');
    assert.deepEqual(automation, [], 'preparation does not automate audible send levels');
    e.vocal(1, 0);
    assert.equal(counts.n - preparedNodes, 2, 'first solo vocal creates only its source and fade gain');
    assert.equal(buffers, preparedBuffers, 'first vocal does not build an IR or process the stem');
    assert.equal(F.plate.buffer, impulse);
    assert.deepEqual(automation, [['plate', .14, 0, .02], ['delay', .5 * 60 / s.bpm, 0, .02], ['send', .1, 0, .02], ['feedback', .22, 0, .02]]);
    buf.getChannelData = getChannelData;
    const roomState = { ...s, room: true };
    e.vocalOf = state => state.room ? { ...stem, fx: VOCAL_FX.folk } : stem;
    e.prepareVocal(roomState);
    assert.equal(F.plate.buffer, impulse, 'preparing a queued genre does not change the playing reverb');
    assert.equal(automation.length, 4);
    e.vocalOf = () => null;
    e.prepareVocal();
    assert.equal(F.plate.buffer, impulse);
    e.vocalOf = () => { throw new Error('Stem lookup failed'); };
    assert.throws(() => e.prepareVocal(), /Stem lookup failed/);
    console.log('Vocal preparation PASS: first solo source has no FX/IR/stem/envelope build; identical IR and send automation; cached preparation; silent/queued stems.');
  }

  const rows = [];
  for (const style of Object.keys(STYLES)) rows.push(await measure(style));
  if (process.argv.includes('--verbose')) for (const r of rows) console.log(r.style.padEnd(11), 'peak', String(r.peak).padStart(4), 'avg', String(r.avg).padStart(4), JSON.stringify(r.by));
  if (process.argv.includes('--update')) {
    await writeFile(BASELINE, `{\n${rows.map((r) => ` ${JSON.stringify(r.style)}: ${JSON.stringify({ peak: r.peak, avg: r.avg })}`).join(',\n')}\n}\n`);
    console.log('audio-nodes: baseline updated');
  } else {
    const base = JSON.parse(await readFile(BASELINE, 'utf8'));
    let fails = 0;
    for (const r of rows) {
      const b = base[r.style];
      if (!b) { fails++; console.error(`FAIL ${r.style}: no baseline (run node test/audio-nodes.mjs --update)`); continue; }
      for (const k of ['peak', 'avg']) if (r[k] > b[k] * SLACK + FLOOR) { fails++; console.error(`FAIL ${r.style}: ${r[k]} nodes/bar (${k}) vs baseline ${b[k]}; top creators ${JSON.stringify(r.by)}`); }
    }
    if (fails) process.exit(1);
    console.log(`audio-nodes: ${rows.length} styles within ${Math.round((SLACK - 1) * 100)}% of the node-per-bar baseline`);
  }
}
