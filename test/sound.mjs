// Offline sound check: renders real songs through the engine in Node (test/offline-audio.mjs, dry mix)
// and measures where the energy sits per genre — club sub weight, kick/bass sidechain, low-mid mud,
// 2–5 kHz lead harshness — plus synth-vs-recorded voice levels and lead CPU cost.
import assert from 'node:assert/strict';
import { OfflineAudioContext, installGlobals } from './offline-audio.mjs';
installGlobals();
const { defaultState, generate, applyOverrides, arrangement, freshSong, INSTRUMENTS } = await import('../js/state.js');
const { Engine, Sequencer } = await import('../js/engine.js');
const { Recorder, capture } = await import('../js/midi.js');
const { loadBand, loadSets, liveSets, STAB_BAND, SOFT_LAYER, SAX_HOOK, saxRoot } = await import('../js/livekit.js');
const { spectralBands, kWeight, lufs } = await import('../js/lab-metrics.js');
const { lowEnd } = await import('../js/lowend.js');
const { getSample } = await import('../js/sampler.js');
const { createTimelineRecorder, stateAt } = await import('../js/set-timeline.js');
const { setVoice, clearVoice } = await import('../js/voice.js');
await import('./sampler.mjs');

// 48 kHz like a real device: at 32 kHz bright resonant filters sit near Nyquist, where the shim blows up.
const SR = 48000, P = Engine.prototype, orig = {};
for (const k of ['stab', 'lick', 'hook', 'kick']) orig[k] = Object.getOwnPropertyDescriptor(P, k).value;

async function render(style, seed, { stem = 'full', bars = 4, voice = null, mute = null } = {}) {
  const s = defaultState(), g = generate(style, seed);
  applyOverrides(s, g); s.patterns = arrangement(g.pattern, seed); s.current = 6;
  if (style === 'bailefunk') s.artist = { style, seed };
  if (voice != null) s.params.stab.voice = voice;
  const band = STAB_BAND[Math.round(s.params.stab.voice)];
  if (band) { await loadBand(band); if (SOFT_LAYER[band]) await loadBand(SOFT_LAYER[band]); }
  const kicks = [];
  P.stab = stem === 'hook' ? () => {} : orig.stab;
  P.lick = stem === 'hook' ? () => {} : orig.lick;
  P.hook = stem === 'chord' ? () => {} : orig.hook;
  P.kick = function (t, v) { kicks.push(t); return orig.kick.call(this, t, v); };
  const solo = { hook: 'stab', chord: 'stab', full: null }[stem] ?? stem;
  if (solo) s.solos[solo] = true;
  if (mute) s.mutes[mute] = true;
  const len = Math.ceil((0.05 + (bars * 16 * 60) / s.bpm / 4 + 0.5) * SR);
  const ctx = new OfflineAudioContext(1, len, SR), e = new Engine(ctx, s, { realtime: false }), q = new Sequencer(e, s);
  if (style === 'bailefunk') {
    e.funkCalls = new Set();
    for (const method of ['funkDrum', 'funkVox', 'funkStab']) {
      const original = e[method];
      e[method] = function (...args) { this.funkCalls.add(method === 'funkDrum' ? args[0] : method); return original.apply(this, args); };
    }
  }
  for (let i = 0, t = 0.05; i < bars * 16; i++) { q.tick(i, t); t += e.stepDur; }
  const data = (await ctx.startRendering(e.mix)).getChannelData(0);
  Object.assign(P, orig);
  return { data, kicks, engine: e, gen: g, ...spectralBands([data], SR) };
}
// Level of a part's loudest quarter of 50 ms windows: fair to short plucks and held pads alike.
function hitDb(d) {
  const w = SR / 20, e = [];
  for (let i = 0; i + w <= d.length; i += w) { let x = 0; for (let j = i; j < i + w; j++) x += d[j] * d[j]; e.push(x / w); }
  const top = e.sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(e.filter((x) => x > 1e-5).length / 4)));
  return 10 * Math.log10(top.reduce((a, b) => a + b, 0) / top.length + 1e-20);
}
const rmsDb = (d, a, b) => { let e = 0; for (let i = a; i < b; i++) e += d[i] * d[i]; return 10 * Math.log10(e / Math.max(1, b - a) + 1e-20); };

for (const style of ['dnb', 'euphoric', 'deephouse']) {
  const s = freshSong(style, 42), ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
  s.artist = { style, seed: 42 };
  let synth = 0, recorded = 0;
  e.paletteHook = () => synth++;
  const voice = { buffer: ctx.createBuffer(1, SR / 2, SR), chops: [{ midi: 60, start: 0, end: 0.2 }] };
  e.hookBus = ctx.createGain();
  e.chopNote = (vc, t, v, midi, dur, expression, index, out) => {
    assert.equal(vc, voice); assert.equal(out, e.hookBus); recorded++;
  };
  try {
    clearVoice();
    e.hook(0.05, 0.4, 0, 0.2, 'chop');
    assert.equal(synth, 1, `${style} falls back to its palette without a recording`);
    setVoice(voice, 'MY VOICE', false);
    e.hook(0.05, 0.4, 0, 0.2, 'chop');
    assert.equal(recorded, 1, `${style} MY VOICE takes precedence over its palette`);
    assert.equal(synth, 1, `${style} does not double its recorded hook with a synth`);
    e.hook(0.1, 0.4, 0, 0.2, 'analog');
    assert.equal(synth, 2, `${style} analog still uses the palette with a recording loaded`);
  } finally { clearVoice(); }
}

for (const style of ['dnb', 'euphoric', 'deephouse']) {
  const sample = async (control = null, value = null, bass = false) => {
    const s = freshSong(style, 42); s.artist = { style, seed: 42 }; s.params.stab.voice = 1;
    if (control) s.params[bass ? 'acid' : 'stab'][control] = value;
    const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
    e.ch[bass ? 'acid' : 'stab'].input.connect(ctx.destination);
    if (bass) e.acidVoice(0.05, { n: 0, a: false }, false, false, e.stepDur);
    else e.stab(0.05, 0.7);
    return (await ctx.startRendering(ctx.destination)).getChannelData(0);
  };
  const chord = await sample();
  for (const [control, value] of [['env', 0.95], ['detune', 37]]) {
    const changed = await sample(control, value);
    assert(changed.every(Number.isFinite), `${style} ${control} stays finite`);
    assert(changed.some((x, i) => Math.abs(x - chord[i]) > 1e-5), `${style} KEYS ${control} changes audible PCM`);
  }
  if (style !== 'dnb') {
    const bass = await sample(null, null, true);
    for (const value of [0, 0.8]) {
      const changed = await sample('drive', value, true);
      assert(changed.every(Number.isFinite), `${style} DRIVE stays finite`);
      assert(changed.some((x, i) => Math.abs(x - bass[i]) > 1e-5), `${style} DRIVE ${value} changes audible PCM`);
    }
  }
  for (const seed of [11, 20, 42, 73, 211, 997, 1234, 2026]) {
    const s = freshSong(style, seed); s.artist = { style, seed };
    const e = new Engine(new OfflineAudioContext(1, 256, SR), s, { realtime: false }), ref = e.paletteReference();
    for (const key of ['env', 'detune', 'tine']) assert.equal(ref.stab[key], s.params.stab[key], `${style}/${seed} neutral ${key}`);
    assert.equal(ref.acid.drive, s.params.acid.drive, `${style}/${seed} neutral DRIVE`);
  }
}

{
  const { paletteFor, paletteColor } = await import('../js/engine.js');
  const s = freshSong('deephouse', 20); s.artist = { style: 'deephouse', seed: 20 };
  const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
  const color = paletteFor(s).bass, step = { n: 0, a: false }, len = e.stepDur * 1.7 * color.length;
  const buffer = (level) => {
    const b = ctx.createBuffer(1, SR / 2, SR), x = b.getChannelData(0);
    for (let i = 0; i < x.length; i++) x[i] = level * Math.sin(i * 2 * Math.PI * 65 / SR);
    return b;
  };
  let bank = [];
  e.rec = () => bank;
  assert.equal(e.pocketReferenceGain(step, len, color, 1), 1, 'missing legacy bass keeps its synth fallback');
  bank = [[e.bassMidi(step), buffer(0.04)]];
  const quiet = e.pocketReferenceGain(step, len, color, 1);
  assert(quiet > 0 && quiet < 1, 'a quiet recorded bass caps the replacement');
  assert.equal(e.pocketReferenceGain(step, len, color, 1), quiet, 'reference analysis is cached');
  bank = [[e.bassMidi(step), buffer(0.8)]];
  assert(e.pocketReferenceGain(step, len, color, 1) > quiet, 'the ceiling follows the actual recording energy');
  bank = [[e.bassMidi(step), buffer(0)]];
  assert.equal(e.pocketReferenceGain(step, len, color, 1), 0, 'silent legacy notes cannot become loud bass');
  bank = [[e.bassMidi(step), null]];
  assert.equal(e.pocketReferenceGain(step, len, color, 1), 1, 'unavailable reference buffers keep the fallback');
  for (const style of ['euphoric', 'dnb']) {
    assert.equal(e.pocketReferenceGain(step, len, paletteFor({ artist: { style } }).bass, 1), 1, `${style} has no Deep House ceiling`);
  }
  for (const [voice, method] of [[1, 'keys'], [2, 'pad'], [3, 'organ']]) {
    s.params.stab.voice = voice;
    let calls = 0;
    e[method] = () => calls++;
    e.paletteChord(0.05, 0.5, [], 48, s.params.stab, e.ch.stab.input, paletteColor(s));
    assert.equal(calls, 0, 'an empty chord creates no presence lane');
    e.stab(0.05, 0.5);
    assert.equal(calls, 1, `Deep House ${method} has its own upper-band attack`);
  }
  assert.equal(paletteFor(s).hook.presence, false, 'the restrained Deep House lead does not inherit the chord attack');
}

for (const listener of ['dnb', 'euphoric', 'deephouse']) {
  for (const recorded of ['trap', 'bailefunk']) {
    const s = freshSong(recorded, 42); s.artist = { style: listener };
    const e = new Engine(new OfflineAudioContext(1, 256, SR), s, { realtime: false });
    e.replay808Style = recorded;
    e.paletteChord = e.paletteHook = e.paletteBass = () => assert.fail(`${recorded} replay cannot inherit ${listener}'s palette`);
    e.stab(0.05, 0.7); e.hook(0.05, 0.4, 0, 0.2, 'analog'); e.acidVoice(0.05, { n: 0 }, false, false, e.stepDur);
  }
}

{
  const { paletteFor, paletteHookPitch } = await import('../js/engine.js');
  const s = freshSong('dnb', 42); s.artist = { style: 'dnb', seed: 42 };
  const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false }), rec = new Recorder(s);
  const start = e.startSource, played = [];
  e.startSource = function (source, ...args) {
    if (source.frequency) played.push(Math.round(69 + 12 * Math.log2(source.frequency.value / 440)));
    return start.call(this, source, ...args);
  };
  for (const n of [-24, 0, 20, 48]) for (const [strong, up] of [[false, false], [true, false], [false, true]]) {
    played.length = 0;
    e.hook(0.05, 0.4, n, 0.2, 'analog', 0, strong, 1, up);
    rec.hook(0.05, 0.4, n, 0.2, 'analog', 0, strong, 1, up);
    assert.deepEqual(rec.notes.hook.splice(0).map(n => n.m), [...new Set(played)], 'airy hook MIDI follows its lifted oscillators');
  }
  assert.equal(paletteHookPitch(s, 60, 'analog'), 72);
  assert.equal(paletteHookPitch(s, 96, 'analog'), 84, 'high notes fold below the presence band');
  assert.equal(paletteHookPitch(s, 60, 'analog', 'trap'), 60, 'a foreign playback style does not lift the hook');
  try {
    clearVoice();
    assert.equal(paletteHookPitch(s, 60, 'chop'), 72, 'missing MY VOICE uses the lifted palette fallback');
    setVoice({ buffer: e.ctx.createBuffer(1, SR / 2, SR), chops: [{ midi: 60, start: 0, end: 0.2 }] }, 'MY VOICE', false);
    assert.equal(paletteHookPitch(s, 60, 'chop'), 60, 'recorded MY VOICE does not inherit the synth register');
  } finally { clearVoice(); }
  for (const style of ['euphoric', 'unknown']) {
    assert.equal(paletteHookPitch({ artist: { style } }, 60, 'analog'), 60, `${style} keeps its register`);
  }
  assert(paletteFor(s).hook.width > 0 && paletteFor(s).hook.breath > 0, 'the airy hook has stereo spread and high-frequency breath');
  const bank = paletteFor(s), dense = capture(s).notes.stab.length;
  try {
    bank.bed = false;
    assert(dense > capture(s).notes.stab.length * 2, 'the liquid bed can play beneath its independent hook');
  } finally { bank.bed = true; }
  for (const style of ['euphoric', 'deephouse']) assert(!paletteFor({ artist: { style } }).bed, `${style} retains its chord/hook spacing`);
}
{
  const { paletteFor } = await import('../js/engine.js');
  const s = freshSong('dnb', 42); s.artist = { style: 'dnb', seed: 42 };
  const c = new OfflineAudioContext(1, SR, SR), e = new Engine(c, s, { realtime: false }), links = new Map(), oscillators = [], cuts = [], equalizers = [];
  const trace = node => { const connect = node.connect; node.connect = function (dest, ...args) { links.set(node, dest); return connect.call(this, dest, ...args); }; return node; };
  const oscillator = c.createOscillator, gain = e.gain, filter = e.filter;
  c.createOscillator = function () { const o = trace(oscillator.call(this)); oscillators.push(o); return o; };
  e.gain = function (...args) { return trace(gain.apply(this, args)); };
  e.filter = function (...args) {
    const node = trace(filter.apply(this, args));
    if (args[0] === 'peaking') {
      equalizers.push(node);
      const ramp = node.gain.linearRampToValueAtTime;
      node.gain.linearRampToValueAtTime = function (value, time) { cuts.push(value); return ramp.call(this, value, time); };
    }
    return node;
  };
  for (const velocity of [0.25, 1]) {
    e.noteVel = velocity;
    e.paletteBass(0.05, { n: 0, a: false }, e.stepDur, false, false, paletteFor(s).bass);
    const sub = oscillators.filter(o => o.type === 'sine' && o.frequency.value > 10).at(-1), level = links.get(sub);
    assert.equal(level.gain.value, 0.9, 'the clean sub retains its reference level');
    assert.equal(links.get(level), links.get(equalizers.at(-1)), 'the mono sine bypasses the body EQ');
  }
  assert(cuts[0] < 0 && cuts[1] < cuts[0] * 10, 'the mid-band dip responds to actual note level');
}
{
  const { paletteFor, paletteHookPitch, paletteColor } = await import('../js/engine.js');
  const s = freshSong('deephouse', 20); s.artist = { style: 'deephouse', seed: 20 };
  const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false, trackQueuedNotes: true }), rec = new Recorder(s), played = [];
  const start = e.startSource;
  e.startSource = function (source, ...args) {
    if (source.frequency) played.push(Math.round(69 + 12 * Math.log2(source.frequency.value / 440)));
    return start.call(this, source, ...args);
  };
  for (const n of [-24, 0, 24, 48]) {
    played.length = 0;
    e.hook(0.05, 0.4, n, 0.5, 'analog');
    rec.hook(0.05, 0.4, n, 0.5, 'analog');
    assert.deepEqual(rec.notes.hook.splice(0).map(n => n.m), [...new Set(played)], 'Deep House MIDI follows its independent upper register');
    assert(played.every(n => n >= 79 && n <= 91));
  }
  assert.equal(paletteHookPitch(s, 60, 'analog'), 84);
  try {
    setVoice({ buffer: e.ctx.createBuffer(1, SR / 2, SR), chops: [{ midi: 60, start: 0, end: 0.2 }] }, 'MY VOICE', false);
    assert.equal(paletteHookPitch(s, 60, 'chop'), 60, 'recorded Deep House hooks keep their recording register');
  } finally { clearVoice(); }
  for (const voice of [1, 3]) {
    s.params.stab.voice = voice;
    assert.deepEqual(paletteColor(s).eq[0], [320, 0.8, -5], 'Rhodes and organ share the extra 3dB low-mid trim');
  }
  assert(paletteFor(s).bass.balance, 'the adaptive bass cap remains enabled');
  assert.deepEqual(paletteFor(s).bass.lowBand, { cutoff: 120, trim: -6, duck: 6 });
  assert.equal(e.pocketBassOut(), e.ch.acid.input, 'other pocket basses keep their existing route');
  const lowOut = e.pocketBassOut(paletteFor(s).bass.lowBand), ducks = [];
  assert.notEqual(lowOut, e.ch.acid.input);
  assert.equal(e.pocketBassOut(paletteFor(s).bass.lowBand), lowOut, 'notes share one low-band sidechain');
  const target = e.pocketLow.duck.gain.setTargetAtTime;
  e.pocketLow.duck.gain.setTargetAtTime = function (...args) { ducks.push(args); return target.apply(this, args); };
  e.duckAt(0.1, 1);
  assert(ducks.some(([gain, t]) => t === 0.1 && gain === -6), 'a kick ducks only the low band by 6dB');
  e.discardQueuedNotes(0.2);
  assert(ducks.some(([gain, t]) => gain === 0 && t === 0.2), 'discarding notes releases the low-band sidechain');
}
{
  const { paletteFor } = await import('../js/engine.js');
  const s = freshSong('dnb', 20); s.artist = { style: 'dnb', seed: 20 };
  const e = new Engine(new OfflineAudioContext(1, SR * 2, SR), s, { realtime: false }), targets = [], peaks = [];
  const gain = e.gain;
  e.gain = function (...args) {
    const g = gain.apply(this, args), target = g.gain.setTargetAtTime, ramp = g.gain.linearRampToValueAtTime;
    g.gain.setTargetAtTime = function (...args) { targets.push(args); return target.apply(this, args); };
    g.gain.linearRampToValueAtTime = function (...args) { peaks.push(args); return ramp.apply(this, args); };
    return g;
  };
  e.paletteChord(0.05, 0.4, [], 72, s.params.stab, e.ch.stab.input, paletteFor(s).hook);
  assert.equal(targets.length, 0, 'empty voicings do not schedule breath');
  e.hook(0.05, 0.4, 0, 1, 'analog');
  assert(targets.some(([value, time, decay]) => value === 0 && Math.abs(time - 0.068) < 1e-8 && decay === 0.06), 'breath fades after its attack rather than sustaining with the note');
  assert(peaks.some(([value]) => value === 0.18), 'the initial airy attack is retained');
  assert.deepEqual(paletteFor(s).hook.eq, [[1130, 0.7, 3]]);
  for (const color of Object.values(paletteFor(s).chords)) assert.deepEqual(color.eq, [[1130, 0.7, 3]], 'every liquid chord variant has the same body boost');
  const waves = [], create = e.ctx.createPeriodicWave;
  e.ctx.createPeriodicWave = function (re, im, ...args) { waves.push(im); return create.call(this, re, im, ...args); };
  for (const color of Object.values(paletteFor(s).chords)) {
    assert(color.width >= 0.7 && color.spread >= 14, 'every liquid chord variant restores its stereo spread');
    assert.equal(color.sideCutoff, 150, 'liquid chord width is confined above the low band');
    e.paletteWave(220, color);
    assert(waves.at(-1).some((x, i) => x !== 0 && i * 220 > 2000), 'liquid chord harmonics extend above 2kHz');
  }
  const before = waves.length;
  e.paletteWave(220, paletteFor(s).hook);
  assert.equal(waves.length, before + 1, 'hook and chord harmonic ceilings have separate caches');
  assert(waves.at(-1).some((x, i) => x !== 0 && i * 220 > 2000), 'the liquid hook retains upper body harmonics rather than only attack noise');
  const upperSources = [], startUpper = e.startSource;
  e.startSource = function (o, ...args) { upperSources.push(o.frequency.value); return startUpper.call(this, o, ...args); };
  e.keys = () => assert.fail('the liquid upper renderer never enters shared keys');
  e.paletteUpperFM(0.1, 0.4, [], 60, s.params.stab, e.ch.stab.input, 0.4);
  assert.deepEqual(upperSources, [], 'empty upper voicings create no oscillators');
  e.paletteUpperFM(0.1, 0.4, [0], 60, s.params.stab, e.ch.stab.input, 0.4);
  const upperRoot = 440 * 2 ** ((60 - 69) / 12);
  assert.deepEqual(upperSources, [upperRoot, upperRoot, upperRoot * 14], 'the dedicated upper voice has its own FM carrier, body and strike');
  e.startSource = startUpper;
  let upper = 0;
  e.paletteUpperFM = () => upper++;
  const chord = paletteFor(s).chords.default, out = e.ch.stab.input;
  e.paletteChord(0.1, 0.4, [], 60, s.params.stab, out, chord);
  assert.equal(upper, 0, 'empty chords do not schedule an upper layer');
  e.paletteChord(0.1, 0.4, [0, 3, 7], 60, s.params.stab, out, chord);
  assert.equal(upper, 1, 'the liquid chord bed has its own upper layer');
  e.hook(0.2, 0.4, 0, 0.5, 'analog');
  assert.equal(upper, 1, 'the upper layer does not leak into the hook');
  const airGains = [], airFilter = e.filter, airGain = e.gain;
  let captureAir = false;
  e.filter = function (...args) {
    const node = airFilter.apply(this, args);
    if (args[0] === 'lowpass' && args[1] === 6000) {
      assert.equal(args[2], 20 * Math.log10(Math.SQRT1_2), 'the broad upper band is non-resonant');
      captureAir = true;
    }
    return node;
  };
  e.gain = function (...args) {
    const node = airGain.apply(this, args);
    if (captureAir) { airGains.push(node.gain); captureAir = false; }
    return node;
  };
  for (const cutoff of [600, 1800, 10000]) e.paletteChord(0.3, 0.4, [0, 3, 7], 60, { ...s.params.stab, cutoff }, out, { ...chord, cutoff: 3200 });
  assert.equal(airGains[0].value, chord.airBand, 'dark chords get bounded broad-band fill');
  assert(airGains[1].value > airGains[2].value, 'brighter filter settings reduce compensation without seed lookups');
  assert.equal(airGains[2].value, 0, 'already bright chords need no lift');
  const airCount = airGains.length;
  e.paletteChord(0.3, 0.4, [], 60, s.params.stab, out, chord);
  e.paletteChord(0.3, 0.4, [0, 3, 7], 60, s.params.stab, out, { ...chord, airBand: undefined });
  assert.equal(airGains.length, airCount, 'empty chords and unconfigured palettes never receive the upper band');
  e.hook(0.3, 0.4, 0, 0.5, 'analog');
  assert.equal(airGains.length, airCount + 1, 'the liquid hook has its own enveloped upper body');
  e.filter = airFilter; e.gain = airGain;
  assert.equal(e.paletteUpperOut(out), e.paletteUpperOut(out), 'chords reuse their stereo upper-layer path');
  const widthDest = e.gain(1);
  assert.equal(e.paletteWidthOut(widthDest), widthDest, 'unconfigured palettes retain their existing width route');
  const sideFilters = [], filter = e.filter;
  e.filter = function (...args) { sideFilters.push(args); return filter.apply(this, args); };
  const widthOut = e.paletteWidthOut(widthDest, 150);
  e.filter = filter;
  assert.deepEqual(sideFilters, [
    ['highpass', 150, 20 * Math.log10(Math.SQRT1_2)],
    ['highpass', 150, 20 * Math.log10(Math.SQRT1_2)],
  ], 'side highpasses use Web Audio Q in dB, without a resonant boost above the crossover');
  assert.notEqual(widthOut, widthDest);
  assert.equal(e.paletteWidthOut(widthDest, 150), widthOut, 'liquid chords share their side-only highpass path');
  assert.equal(e.paletteFxCutoff, 150, 'liquid chord reverb and echo returns share the low-side cutoff');
  s.artist.style = 'euphoric'; e.applyPaletteWidth();
  assert.equal(e.paletteFxCutoff, 0, 'switching away from liquid restores unfiltered FX return routes');
  s.artist.style = 'dnb'; e.applyPaletteWidth();
  assert.equal(e.paletteFxCutoff, 150, 'switching back restores low-side protection');
}
for (const recorded of ['dnb', 'euphoric', 'deephouse']) {
  const s = freshSong(recorded, 42); s.artist = { style: 'trap' };
  const e = new Engine(new OfflineAudioContext(1, 256, SR), s, { realtime: false }), calls = [];
  e.replay808Style = recorded;
  for (const name of ['paletteChord', 'paletteHook', 'paletteBass']) e[name] = () => calls.push(name);
  e.stab(0.05, 0.7); e.hook(0.05, 0.4, 0, 0.2, 'analog'); e.acidVoice(0.05, { n: 0 }, false, false, e.stepDur);
  assert.deepEqual(calls, ['paletteChord', 'paletteHook', 'paletteBass'], `${recorded} replay retains its palette with a Trap listener`);
}

for (const style of ['euphoric', 'deephouse']) {
  const { paletteFor, paletteColor, paletteHookPitch, soundingPitch } = await import('../js/engine.js');
  const voices = new Set();
  for (const seed of [11, 20, 42, 73, 211, 997, 1234, 2026]) {
    const s = freshSong(style, seed); s.artist = { style, seed };
    const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false }), rec = new Recorder(s);
    voices.add(s.params.stab.voice);
    let played, frequency, bass = 0;
    const chord = e.paletteChord, hook = e.paletteHook, pocket = e.pocketBass;
    e.paletteChord = function (t, v, iv, root, p, out, color) { played = iv.map(n => color.piano ? soundingPitch('piano', root + n) : root + n); return chord.call(this, t, v, iv, root, p, out, color); };
    e.paletteHook = function (t, v, f, ...a) { frequency = f; return hook.call(this, t, v, f, ...a); };
    e.pocketBass = function (...a) { bass++; return pocket.apply(this, a); };
    e.stab(0.05, 0.7); rec.trigger('stab', 0.05, 0.7);
    assert.deepEqual(rec.notes.stab.map(n => n.m), played, `${style} MIDI follows its voiced chords`);
    e.recordedNote = () => assert.fail(`${style} hook cannot inherit a recorded chord player`);
    for (const [strong, up] of [[false, false], [true, false], [false, true]]) {
      e.hook(0.1, 0.4, 1, 0.2, 'analog', 0, strong, 1, up);
      rec.hook(0.1, 0.4, 1, 0.2, 'analog', 0, strong, 1, up);
      assert(Math.abs(paletteHookPitch(s, 69 + 12 * Math.log2(frequency / 440), 'analog') - rec.notes.hook.at(-1).m) < 1e-8, `${style} hook snap and register match MIDI`);
    }
    e.acidVoice(0.05, { n: 0, a: false }, false, false, e.stepDur);
    assert.equal(bass, 1, `${style} has its own pocket bass`);
    const d = (await ctx.startRendering(e.mix)).getChannelData(0);
    assert(d.every(Number.isFinite) && hitDb(d) > -60, `${style} renders finite audible PCM`);
  }
  assert.equal(voices.size, new Set(INSTRUMENTS[style].map(p => p[0])).size, `${style} covers every chord voice`);
  for (const voice of [-1, 99, NaN]) {
    const s = freshSong(style, 42); s.artist = { style }; s.params.stab.voice = voice;
    assert.equal(paletteColor(s), paletteFor(s).chords.default, `${style} unknown-palette fallback`);
    const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
    e.stab(0.05, 0.7);
    const d = (await ctx.startRendering(e.mix)).getChannelData(0);
    assert(d.every(Number.isFinite) && hitDb(d) > -60, `${style} fallback renders safely and audibly`);
  }
  const s = freshSong(style, 42); s.artist = { style };
  const ctx = new OfflineAudioContext(1, 256, SR), e = new Engine(ctx, s, { realtime: false });
  e.paletteChord(0, 1, [], 48, s.params.stab, e.ch.stab.input, paletteColor(s));
  assert((await ctx.startRendering(e.mix)).getChannelData(0).every(v => v === 0), `${style} empty voicing is silent`);
}

{
  const { paletteFor, paletteColor } = await import('../js/engine.js');
  assert.equal(paletteFor({ artist: { style: 'toString' } }), undefined, 'unknown styles cannot inherit a palette');
  const voices = new Set();
  for (const seed of [11, 20, 42, 73, 211, 997, 1234, 2026]) {
    const s = freshSong('dnb', seed); s.artist = { style: 'dnb', seed };
    const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false }), rec = new Recorder(s), hits = {};
    for (const name of ['paletteChord', 'paletteHook', 'paletteBass']) {
      const f = e[name]; e[name] = function (...a) { hits[name] = (hits[name] || 0) + 1; return f.apply(this, a); };
    }
    for (const name of ['recordedNote', 'keys', 'pad', 'strings', 'reese']) e[name] = () => assert.fail(`liquid never enters ${name}`);
    voices.add(s.params.stab.voice);
    let played;
    const chord = e.paletteChord;
    e.paletteChord = function (t, v, iv, root, ...a) { played = iv.map(n => root + n); return chord.call(this, t, v, iv, root, ...a); };
    e.stab(0.05, 0.7); rec.trigger('stab', 0.05, 0.7);
    assert.deepEqual(rec.notes.stab.map(n => n.m), played, 'liquid MIDI keeps the actual chord voicing');
    e.hook(0.1, 0.4, 0, 0.2, 'analog');
    e.acidVoice(0.05, { n: 0, a: false }, false, false, e.stepDur);
    assert.deepEqual(hits, { paletteChord: 2, paletteHook: 1, paletteBass: 1 });
    assert.equal(paletteFor(s).name, 'liquid');
    const d = (await ctx.startRendering(e.mix)).getChannelData(0);
    assert(d.every(Number.isFinite) && hitDb(d) > -60, 'liquid renders finite audible PCM');
    const fallback = paletteFor(s).chords.default;
    s.params.stab.voice = 99;
    assert.equal(paletteColor(s), fallback, 'unknown liquid palettes have a safe default');
  }
  assert.equal(voices.size, 4, 'all four liquid ensembles are covered');
  const s = freshSong('dnb', 42); s.artist = { style: 'dnb' };
  const ctx = new OfflineAudioContext(1, 256, SR), e = new Engine(ctx, s, { realtime: false });
  const makeWave = ctx.createPeriodicWave.bind(ctx);
  let fundamental;
  ctx.createPeriodicWave = (re, im) => { fundamental = im[1]; return makeWave(re, im); };
  e.paletteWave(2400, paletteFor(s).hook);
  assert.equal(fundamental, 1, 'high-register palette notes retain their fundamental');
  e.paletteChord(0, 1, [], 48, s.params.stab, e.ch.stab.input, paletteColor(s));
  assert((await ctx.startRendering(e.mix)).getChannelData(0).every(v => v === 0), 'empty liquid voicing is silent');
  for (const voice of [-1, 99, NaN]) {
    const s = freshSong('dnb', 42); s.artist = { style: 'dnb' }; s.params.stab.voice = voice;
    const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
    e.stab(0.05, 0.7);
    const d = (await ctx.startRendering(e.mix)).getChannelData(0);
    assert(d.every(Number.isFinite) && hitDb(d) > -60, 'unknown liquid palettes render safely and audibly');
  }
  for (const style of ['trap', 'jerseyclub', 'minimal', 'hardtechno', 'ambient', 'ukg']) {
    const s = freshSong(style, 42); s.artist = { style };
    assert.equal(paletteFor(s), undefined, `${style} has no liquid palette`);
    const e = new Engine(new OfflineAudioContext(1, 256, SR), s, { realtime: false });
    e.paletteChord = e.paletteHook = e.paletteBass = () => assert.fail(`${style} entered liquid dispatch`);
    e.stab(0.05, 0.7); e.hook(0.05, 0.4, 0, 0.2, 'analog'); e.acidVoice(0.05, { n: 0 }, false, false, e.stepDur);
  }
}

{
  const old = [[0, 2, 0, 0.35, 0.55], [3, 1, 0, 0.5, 0.25], [5, 2, 0, 0.45, 0.7], [9, 1, 0, 0.4, 0.55]];
  INSTRUMENTS.dub.forEach((tuple, i) => assert.notDeepEqual(tuple, old[i], `dub ensemble ${i} changes`));
  const voices = new Set();
  for (const seed of [11, 42, 1234, 20]) {
    const s = freshSong('dub', seed), ctx = new OfflineAudioContext(1, SR, SR);
    s.artist = { style: 'dub', seed };
    const e = new Engine(ctx, s, { realtime: false });
    const hits = {};
    for (const name of ['dubChord', 'dubPad', 'dubSub', 'pad', 'organ', 'pluck', 'horns', 'bass', 'eight08']) {
      const f = e[name];
      e[name] = function (...a) { hits[name] = (hits[name] || 0) + 1; return f.apply(this, a); };
    }
    voices.add(s.params.stab.voice);
    assert.equal(s.params.perc.level, 0.45, 'Dub restores the normal clave mixer level');
    assert([1, 2].includes(s.params.stab.chord), 'dub uses minor sevenths or ninths');
    e.stab(0.05, 0.7);
    e.hook(0.15, 0.4, 0, 0.2, 'reed');
    e.acidVoice(0.05, { n: 0, a: false }, false, false, e.stepDur);
    assert.deepEqual(hits, { dubPad: 1, dubChord: 2, dubSub: 1 }, 'all ensembles and hooks use dedicated Dub voices, never a shared bass or 808');
    assert.equal(e.dubEcho.delay.delayTime.at(0.2), e.stepDur * 3, 'dotted eighth echo follows tempo');
    assert.equal(e.dubEcho.lp.frequency.value, 1450, 'every feedback pass loses highs');
    for (const root of [36, 48, 60, 72]) {
      const level = e.dubPadLevel([0, 3, 7, 10], root, 0);
      assert(Number.isFinite(level) && level >= 0.035 && level <= 0.3, 'pad register compensation is bounded');
    }
    assert.equal(e.ch.stab.dly.gain.value, 0, 'Dub bypasses the bright shared delay');
    s.master.dlyLevel = 0.2; e.applyMaster('dlyLevel', true);
    assert.equal(e.dubEcho.wet.gain.value, 0.2, 'the master delay control also sets the Dub return');
    assert(e.dubEcho.tape.curve.every((v) => Math.abs(v) < 1), 'tape saturation is bounded');
    s.master.dlyFb = 2; e.dubEchoOut(0.3);
    assert.equal(e.dubEcho.fb.gain.at(0.31), 0.58, 'excess feedback cannot self-oscillate');
    s.master.dlyFb = -1; e.dubEchoOut(0.4);
    assert.equal(e.dubEcho.fb.gain.at(0.41), 0, 'negative feedback is clamped');
    const d = (await ctx.startRendering(e.mix)).getChannelData(0);
    assert(d.every(Number.isFinite) && hitDb(d) > -60, 'Dub voices render finite audible PCM');
  }
  assert.equal(voices.size, INSTRUMENTS.dub.length, 'every ensemble is exercised');
  const empty = freshSong('dub', 42), ctx = new OfflineAudioContext(1, 256, SR);
  empty.artist = { style: 'dub', seed: 42 };
  const e = new Engine(ctx, empty, { realtime: false });
  e.dubPad(0, 1, [], 48);
  assert.equal(e.dubPadAt, undefined, 'an empty voicing schedules no pad');
  assert((await ctx.startRendering(e.mix)).getChannelData(0).every((v) => v === 0), 'an unscheduled pad bed is silent');
  for (const style of ['trap', 'minimal', 'hardtechno', 'deephouse', 'drill', 'bailefunk']) {
    const s = freshSong(style, 42); s.artist = { style, seed: 42 };
    const e = new Engine(new OfflineAudioContext(1, 256, SR), s, { realtime: false });
    const unexpected = () => assert.fail(`${style} must never enter Dub dispatch`);
    e.dubChord = e.dubSub = e.dubPad = unexpected;
    assert.equal(e.dubPadBus, undefined, `${style} allocates no Dub pad bus`);
    e.stab(0.05, 0.7); e.hook(0.05, 0.4, 0, 0.2, 'reed'); e.acidVoice(0.05, { n: 0 }, false, false, e.stepDur);
  }
}

{
  const s = freshSong('dub', 42), e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
  s.artist = { style: 'dub', seed: 42 };
  for (const voice of [0, 2, 3, 5]) {
    s.params.stab.voice = voice;
    e.dubSection(0, false);
    assert.equal(e.dubRegister([0, 3, 7, 10], 48), 48, 'other sections retain the original chord register');
    e.dubSection(0, true);
    assert.equal(e.dubRegister([0, 3, 7, 10], 48), voice === 3 ? 48 : voice === 5 ? 72 : 60, 'breakdown voicings lift above the low-mid wash');
    assert.equal(e.dubRegister([0], 48), voice === 2 || voice === 3 ? 48 : voice === 5 ? 72 : 60, 'the rounder pad and organ hooks retain their register');
    assert.equal(e.dubRegister([0], 76), 76, 'already high hooks are not shifted out of the oscillator range');
    assert.equal(e.dubRegister([], 48), 48, 'empty voicings need no register correction');
  }
  s.params.stab.voice = 99;
  assert.equal(e.dubRegister([0], 48), 48, 'unknown palettes keep their original register');
  s.params.stab.voice = 0;
  e.dubSection(0, false); e.dubEchoOut(0);
  e.dubSection(0.1, true);
  assert.equal(e.dubEcho.mid.gain.at(0.6), -4, 'breakdowns clear the echo return without changing feedback');
  assert.equal(e.dubEcho.fb.gain.at(0.6), s.master.dlyFb, 'the echo feedback remains unchanged');
  e.dubSection(0.7, false);
  assert.equal(e.dubEcho.mid.gain.at(0.7), 0, 'the echo EQ restores at the boundary, not after a release');
  assert.equal(e.dubEcho.mid.gain.at(1.2), 0, 'the echo contour returns to neutral after the breakdown');
  s.params.stab.voice = 3; e.dubSection(1.3, true);
  assert.equal(e.dubBreakCut, 0, 'the already balanced organ breakdown is left untouched');
  s.params.stab.voice = 5; e.dubSection(1.4, true);
  assert(Math.abs(e.mix.gain.at(2) - 10 ** (2.2 / 20)) < 1e-9, 'the muted keys recover breakdown level before the limiter');
  e.dubSection(2.1, false);
  assert.equal(e.mix.gain.at(2.1), 1, 'breakdown gain restores exactly at the boundary');
  s.params.stab.voice = 0; e.dubSection(2.2, true); e.dubPad(2.2, 0.5, [0], 48);
  const hp = e.dubPadFilters.at(-1).hp;
  assert.equal(hp.frequency.at(2.2), 650);
  e.dubSection(2.3, false);
  assert.equal(hp.frequency.at(2.3), 420, 'already ringing pads restore their highpass at the boundary');
  s.chainOn = true; s.chain = 'A'.repeat(48) + 'E'.repeat(8) + 'F'.repeat(8); s.ending = false;
  const q = new Sequencer(e, s);
  q.startAt(0, 0.05); q.tick(0, 0.05);
  assert.equal(e.dubBreakdown, false, 'the opening is unchanged');
  q.chainPos = 48; q.tick(48 * 16, 3.05);
  assert.equal(e.dubBreakdown, true, 'the arrangement selects the breakdown palette');
  q.chainPos = 56; q.tick(56 * 16, 5.05);
  assert.equal(e.dubBreakdown, false, 'the next section restores the original palette');
  s.params.stab.voice = 5; q.chainPos = 48; q.tick(48 * 16, 7.05);
  s.artist = { style: 'trap' }; q.chainPos = 56; q.tick(56 * 16, 9.05);
  assert.equal(e.dubBreakdown, false, 'switching genres clears the Dub treatment');
  assert.equal(e.mix.gain.at(9.05), 1, 'a reused engine cannot carry Dub gain into another genre');
}

{
  for (const voice of [0, 2, 3, 5, 99]) for (const key of [0, 11]) {
    const s = freshSong('dub', 42);
    s.artist = { style: 'dub', seed: 42 }; s.params.stab.voice = voice; s.key = key;
    const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false }), rec = new Recorder(s);
    const start = e.startSource, played = [];
    e.dubPad = () => {};
    e.startSource = function (source, ...args) {
      if (source.frequency) played.push(Math.round(69 + 12 * Math.log2(source.frequency.value / 440)));
      return start.call(this, source, ...args);
    };
    for (const active of [false, true, false]) {
      e.dubSection(0.1, active); rec.dubSection(0.1, active);
      e.harm = rec.harm = { r: active ? 5 : 0, c: Math.round(s.params.stab.chord) };
      played.length = 0;
      e.stab(0.1, 0.7); rec.trigger('stab', 0.1, 0.7);
      assert.deepEqual(rec.notes.stab.splice(0).map((n) => n.m), [...new Set(played)], `Dub/${voice}/${key}/${active} MIDI chord matches oscillator pitches`);
      for (const n of [-24, 0, 20, 48]) for (const [strong, up] of [[false, false], [true, false], [false, true]]) {
        played.length = 0;
        e.hook(0.1, 0.7, n, 0.2, 'analog', 0, strong, 1, up);
        rec.hook(0.1, 0.7, n, 0.2, 'analog', 0, strong, 1, up);
        assert.deepEqual(rec.notes.hook.splice(0).map((n) => n.m), [...new Set(played)], `Dub/${voice}/${key}/${active}/${n}/${strong}/${up} MIDI hook matches oscillator pitches`);
      }
    }
  }
  const s = freshSong('dub', 42); s.artist = { style: 'dub', seed: 42 }; s.chainOn = true; s.chain = 'A'.repeat(48) + 'E'.repeat(8) + 'F'.repeat(8); s.ending = false;
  const rec = new Recorder(s), q = new Sequencer(rec, s);
  q.startAt(0, 0.05); q.tick(0, 0.05);
  assert.equal(rec.dubBreakdown, false, 'MIDI leaves the opening unchanged');
  q.chainPos = 48; q.tick(48 * 16, 0.05);
  assert.equal(rec.dubBreakdown, true, 'MIDI tracks the breakdown register');
  q.chainPos = 56; q.tick(56 * 16, 2.05);
  assert.equal(rec.dubBreakdown, false, 'MIDI restores the original register after the breakdown');
}

{
  const padSend = async (rev = 0.24, edit) => {
    const s = freshSong('dub', 42), ctx = new OfflineAudioContext(1, SR * 3, SR);
    s.artist = { style: 'dub', seed: 42 };
    Object.assign(s.params.stab, { level: 0.6, rev });
    const e = new Engine(ctx, s, { realtime: false });
    e.dubPad(0, 0.7, [0, 3, 7, 10], 48);
    if (edit) { e.at = 2; e.setParam('stab', ...edit); }
    return (await ctx.startRendering(e.revIn)).getChannelData(0);
  };
  const normal = await padSend();
  assert(rmsDb(normal, SR, SR * 1.8) > -90, 'the default pad reverb send is audible');
  assert((await padSend(0)).every(v => v === 0), 'zero chord reverb means no pad enters reverb');
  for (const id of ['rev', 'level']) {
    const muted = await padSend(0.24, [id, 0]);
    assert.equal(rmsDb(muted, SR, SR * 1.8), rmsDb(normal, SR, SR * 1.8), `future ${id} edits leave the earlier pad send intact`);
    assert(rmsDb(muted, SR * 2.25, SR * 2.75) < -120, `live chord ${id} zero silences the already-playing pad send`);
  }
  const half = await padSend(0.24, ['level', 0.3]);
  assert(Math.abs(rmsDb(half, SR * 2.25, SR * 2.75) - rmsDb(normal, SR * 2.25, SR * 2.75) + 6.0206) < 0.001, 'live chord level scales the sustained pad reverb send');
}

// The dry renderer retains short, in-line modulation delays, including fractional samples across blocks.
{
  const ctx = new OfflineAudioContext(1, 256, SR), delay = ctx.createDelay(0.002);
  const source = ctx.createBufferSource();
  source.buffer = ctx.createBuffer(1, 256, SR);
  source.buffer.getChannelData(0)[126] = 1;
  delay.delayTime.value = 2.5 / SR;
  source.connect(delay).connect(ctx.destination);
  source.start();
  const y = (await ctx.startRendering()).getChannelData(0);
  [0, 0.5, 0.5, 0].forEach((sample, i) => assert(Math.abs(y[127 + i] - sample) < 1e-6));
}

// A long 808 left alone at a break must go quiet before the oscillators are stopped.
{
  const s = defaultState(), t = 0.05;
  s.params.acid.decay = 1;
  const ctx = new OfflineAudioContext(1, 3 * SR, SR), e = new Engine(ctx, s, { realtime: false });
  e.ch.acid.input = ctx.destination;
  e.eight08(t, { n: 0, a: true }, 0.1, false, false);
  const d = (await ctx.startRendering()).getChannelData(0), end = e.mono.end;
  const db = (a, b) => rmsDb(d, Math.round((end - a) * SR), Math.round((end - b) * SR));
  assert(db(0.3, 0.12) > -35, 'the sustained tail stays audible before the final fade');
  assert(db(0.01, 0) < -85, 'the 808 is quiet by its oscillator cutoff');
}

// Glide a held 808 down a fifth without resetting phase or re-attacking its envelope.
{
  const s = defaultState(), t = 0.05, sd = 0.12, slide = t + sd;
  s.params.acid.decay = 0.75;
  const ctx = new OfflineAudioContext(1, 3 * SR, SR), e = new Engine(ctx, s, { realtime: false });
  e.ch.acid.input = ctx.destination;
  e.eight08(t, { n: 0, a: false }, sd, true, false);
  const held = e.mono, from = held.f, firstEnd = held.end;
  e.eight08(slide, { n: 5, a: true }, sd, false, true);
  assert.equal(e.mono, held, 'a slide uses the already playing voice, even with a destination accent');
  assert(held.end > firstEnd, 'the slide extends the oscillator stop to the new release');
  const d = (await ctx.startRendering()).getChannelData(0);
  const crossings = [];
  for (let i = Math.round((slide - 0.06) * SR); i < Math.round((slide + 0.24) * SR); i++) {
    if (d[i - 1] < 0 && d[i] >= 0) crossings.push(i / SR);
  }
  const hz = (a, b) => {
    const times = crossings.filter((x) => x >= slide + a && x < slide + b);
    return (times.length - 1) / (times.at(-1) - times[0]);
  };
  assert(Math.abs(hz(-0.06, 0) / from - 1) < 0.04, 'pitch is settled before the slide');
  assert(Math.abs(hz(0.12, 0.24) / held.f - 1) < 0.04, 'the pitch reaches the slide destination');
  const db = (a, b) => rmsDb(d, Math.round((slide + a) * SR), Math.round((slide + b) * SR));
  assert(Math.abs(db(0, 0.035) - db(-0.035, 0)) < 4, 'no level jump or dip at the slide');
  assert(db(firstEnd - slide + 0.02, firstEnd - slide + 0.06) > -55, 'the bass continues past the pickup cutoff');
  assert(db(held.end - slide - 0.01, held.end - slide) < -85, 'the extended tail fades before stopping');
}

process.on('exit', () => console.table(rows));

// 1. Club low end: the bass carries real sub next to the kick, the kick ducks it, and the low mids stay clear.
const CLUB = { peak: 503, deephouse: 211, dnb: 211, trap: 211, amapiano: 211, reggaeton: 211 };
// 200–500 Hz share of the full mix on main before this pass (same shim, seeds, bars): the louder
// leads and chords must not buy their level with low-mid mud.
const MUD_MAIN = { peak: 0.061, deephouse: 0.032, dnb: 0.042, trap: 0.059, amapiano: 0.232, reggaeton: 0.042 };
const rows = [];
// TRACK_IDS only: hook/chord are routed to stab by render(), never used as solo IDs.
{
  const full = await render('bailefunk', 211);
  assert.deepEqual([...full.engine.funkCalls].sort(), ['kick', 'clap', 'perc', 'funkVox', 'funkStab'].sort(), 'generated renders enter every funk branch');
  for (const stem of ['kick', 'clap', 'perc', 'vox', 'acid', 'hook']) {
    const solo = await render('bailefunk', 211, { stem });
    const muted = await render('bailefunk', 211, { mute: ['hook', 'chord'].includes(stem) ? 'stab' : stem });
    assert(hitDb(solo.data) > -65, `bailefunk ${stem} reaches its stem`);
    assert(full.data.some((x, i) => Math.abs(x - muted.data[i]) > 1e-5), `bailefunk ${stem} reaches the mix`);
    assert(solo.data.every(Number.isFinite), `bailefunk ${stem} is finite`);
  }
  assert.equal(INSTRUMENTS.bailefunk.length, 4);
  assert(INSTRUMENTS.bailefunk.every(([voice, bass]) => voice === 4 && bass === 2));
  assert.equal(full.engine.bassColor().name, 'funk808');
  {
    const s = freshSong('bailefunk', 211); s.artist = { style: 'bailefunk', seed: 211 };
    const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false }), ducks = [];
    e.scheduleDuck = d => ducks.push(d);
    e.kick(0.05, 0.8);
    assert.equal(ducks.length, 1, 'the funk kick schedules its bass duck');
    assert.deepEqual(ducks[0].parts, [[e.ch.acid.sc.gain, 1 - 10 ** (-1.5 / 20), 0.02, 0.002, 0.07]], 'only bass dips 1.5 dB for 70 ms');
    e.kick(0.2, 0);
    assert.equal(ducks.length, 1, 'an empty kick does not duck');
  }
  const handAt = async (history) => {
    const s = freshSong('bailefunk', 211), ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
    s.artist = { style: 'bailefunk', seed: 211 };
    const out = e.ch.perc.input;
    e.ch.perc.input = e.gain(0);
    for (let i = 0; i < history; i++) { e.step = i; e.perc(0.01, 0.7); }
    e.ch.perc.input = out; e.step = 22; e.perc(0.1, 0.7);
    return (await ctx.startRendering(e.mix)).getChannelData(0);
  };
  assert.deepEqual(await handAt(0), await handAt(3), 'same musical hand hit is independent of playback history');
  for (const [recorded, listener] of [['bailefunk', 'drill'], ['drill', 'bailefunk']]) {
    const source = freshSong(recorded, 211);
    source.artist = { style: recorded, seed: 211 };
    const rec = createTimelineRecorder({ state: source, style: recorded, startsAt: 0 });
    const saved = stateAt(rec.finish(1000), 0);
    const s = { ...defaultState(), ...saved.state, artist: { style: listener, seed: 99 } };
    const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
    e.replay808Style = saved.style;
    const calls = [];
    for (const method of ['funkDrum', 'funkVox', 'funkStab']) {
      const original = e[method];
      e[method] = function (...args) { calls.push(method === 'funkDrum' ? args[0] : method); return original.apply(this, args); };
    }
    e.kick(0.05, 0.7); e.clap(0.05, 0.7); e.perc(0.05, 0.7);
    e.vox(0.05, 0.7, 2); e.stab(0.05, 0.7); e.lick(0.05, 0.7, 0);
    e.hook(0.05, 0.7, 0, 0.2, 'reed', 0, true);
    assert.deepEqual(calls, recorded === 'bailefunk' ? ['kick', 'clap', 'perc', 'funkVox', 'funkStab', 'funkStab', 'funkStab'] : [], `${recorded} replay ignores ${listener} listener palette`);
    assert.equal(e.bassColor()?.name === 'funk808', recorded === 'bailefunk');
    assert.equal(getSample().seed, 0, 'saved timelines do not borrow the listener vocal seed');
  }
  for (const solo of [false, true]) {
    const s = defaultState(); applyOverrides(s, generate('bailefunk', 211));
    s.artist = { style: 'bailefunk', seed: 211 };
    if (solo) s.solos.stab = true;
    const ctx = new OfflineAudioContext(1, 2 * SR, SR), e = new Engine(ctx, s, { realtime: false });
    e.stab(0.05, 0.8);
    e.hook(0.05, 0.8, 0, 1, 'reed', 0, true);
    const d = (await ctx.startRendering(e.mix)).getChannelData(0);
    assert(hitDb(d) > -65, 'Volt chord and last-downbeat hook reach stem and mix');
    assert(d.every(x => Number.isFinite(x) && Math.abs(x) < 0.95), 'last downbeat retains headroom');
    const dryCtx = new OfflineAudioContext(1, 2 * SR, SR), dry = new Engine(dryCtx, s, { realtime: false });
    dry.funkStab(0.05, 1, [0], 60, 1, dryCtx.destination);
    const tail = (await dryCtx.startRendering()).getChannelData(0);
    assert(rmsDb(tail, SR, 2 * SR) < -85, 'dry Volt hit releases without a ringing tail');
  }
  {
    const offsets = [], tones = [];
    const s = freshSong('bailefunk', 211); s.artist = { style: 'bailefunk', seed: 211 };
    const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
    e.startSource = (src, t, offset) => { if (src.buffer) offsets.push(offset); };
    const filter = e.filter;
    e.filter = function (type, hz, q) { if (type === 'lowpass') tones.push(hz); return filter.call(this, type, hz, q); };
    s.params.vox.slice = 0; s.params.vox.tone = 1500; e.vox(0.05, 0.7, 2);
    const first = offsets[0]; offsets.length = 0;
    s.params.vox.slice = 1; s.params.vox.tone = 4500; e.vox(0.2, 0.7, 2);
    assert.notEqual(offsets[0], first, 'Slice offsets the funk phrase');
    assert.deepEqual(tones, [1500, 4500], 'Tone controls the funk lowpass');
    const clapTail = async decay => {
      const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
      s.params.clap.decay = decay; e.ch.clap.input = ctx.destination; e.clap(0.05, 0.7);
      return (await ctx.startRendering()).getChannelData(0);
    };
    assert(hitDb(await clapTail(0.5)) > hitDb(await clapTail(0.1)) + 1, 'Decay lengthens the funk clap');
  }
  for (const invalid of [0, -1, NaN]) {
    const s = defaultState(), ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
    for (const id of ['kick', 'clap', 'perc']) e.funkDrum(id, 0.05, invalid);
    e.funkStab(0.05, invalid, [0], 60, 0.2, ctx.destination);
    e.funkStab(0.05, 1, [], 60, 0.2, ctx.destination);
    e.funkVox(0.05, invalid, 0);
    const d = (await ctx.startRendering()).getChannelData(0);
    assert(d.every(x => x === 0), 'empty and invalid funk hits stay silent');
  }
  console.log('bailefunk: drums, bass, MC and Volt voices reach stems and mix; downbeat headroom and release pass; empty/invalid hits silent');
}
for (const [style, seed] of Object.entries(CLUB)) {
  const full = await render(style, seed), noBass = await render(style, seed, { mute: 'acid' });
  const bass = await render(style, seed, { stem: 'acid' }), kick = await render(style, seed, { stem: 'kick' });
  assert(bass.subDb > -21, `${style}: bass sub ${bass.subDb} dB is too light`);
  assert(bass.subDb > kick.subDb - 8, `${style}: bass sub ${bass.subDb} dB sits too far under the kick (${kick.subDb} dB)`);
  assert(full.mudShare <= MUD_MAIN[style] * 1.25, `${style}: ${full.mudShare.toFixed(3)} of the mix is 200–500 Hz mud (main ${MUD_MAIN[style]})`);
  // The bass as heard in the mix (full minus a render with the bass muted) against the soloed bass,
  // where no kick plays: the difference right after each kick is how far the kick ducks it.
  const d = full.data.map((x, i) => x - noBass.data[i]);
  let sum = 0, n = 0;
  for (const t of full.kicks) {
    const a = Math.round((t + 0.003) * SR), z = Math.round((t + 0.012) * SR), solo = rmsDb(bass.data, a, z);
    if (solo > -50) { sum += solo - rmsDb(d, a, z); n++; }
  }
  const dip = n ? sum / n : 0;
  assert(dip >= 3, `${style}: kick only ducks the bass ${dip.toFixed(1)} dB`);
  const loud = lufs([full.data], SR);
  assert(loud > -16 && loud < -4, `${style}: mix loudness ${loud.toFixed(1)} LUFS`);
  rows.push([style, bass.subDb, kick.subDb, full.mudShare, +dip.toFixed(1), +loud.toFixed(1)]);
}

// 2. Hook leads: present but not harsh, and level with the recorded players.
const LEADS = { trance: 211, hyperpop: 211, dnb: 211, peak: 503, deephouse: 211, trap: 211, amapiano: 211 };
// Hook loudness on main before this pass (LUFS, same shim and seeds); the lead must come forward.
const HOOK_MAIN = { trance: -35.4, hyperpop: -31.3, dnb: -32.9, peak: -28.6, deephouse: -32.5, trap: -26.2, amapiano: -28.5 };
for (const [style, seed] of Object.entries(LEADS)) {
  const h = await render(style, seed, { stem: 'hook' }), lvl = lufs([h.data], SR), v = h.gen.pattern.hook.v;
  assert(h.harshShare <= 0.08, `${style} ${v} hook: ${h.harshShare} of its energy is 2–5 kHz`);
  assert(lvl >= HOOK_MAIN[style] + 1 && lvl < -13, `${style} ${v} hook at ${lvl.toFixed(1)} LUFS (main ${HOOK_MAIN[style]})`);
  rows.push([`${style} hook ${v}`, +lvl.toFixed(1), h.harshShare]);
}

// 3. Synth chord voices sit within 4 dB (K-weighted, as ears weigh it) of the recorded players on the same part.
for (const [style, seed] of [['deephouse', 211], ['trance', 211]]) {
  const level = async (voice) => hitDb(kWeight((await render(style, seed, { stem: 'chord', bars: 2, voice })).data, SR));
  const rec = []; for (const vo of [7, 8, 9, 10]) rec.push(await level(vo));
  const target = rec.reduce((a, b) => a + b, 0) / rec.length;
  const syn = []; for (let vo = 0; vo < 7; vo++) syn.push(await level(vo));
  rows.push([`${style} chords`, +target.toFixed(1), ...syn.map((x) => +x.toFixed(1))]);
  // PLUCK's loudness follows the borrowed CUTOFF by design, so it gets a wider window; KEYS trades
  // half a dB of level for keeping deep house's low mids within 25% of main.
  syn.forEach((lvl, vo) => assert(Math.abs(lvl - target) <= ({ 1: 5, 5: 6 }[vo] ?? 4), `${style}: synth voice ${vo} at ${lvl.toFixed(1)} dB vs recorded ${target.toFixed(1)} dB`));
}

// 4. CPU: a lead note stays a handful of oscillators.
{
  const s = defaultState(); applyOverrides(s, generate('trance', 211));
  const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
  for (const voice of ['analog', 'pulse', 'warm', 'vocal', 'reed', 'mallet']) {
    let n = 0; const make = ctx.createOscillator; ctx.createOscillator = function () { n++; return make.call(this); };
    e.hook(0.1, 0.9, 7, 1.2, voice, 0, false, 1, false, { feel: 0.6, warmth: 0.5 });
    ctx.createOscillator = make;
    assert(n <= 6, `${voice} lead uses ${n} oscillators per note`);
  }
}

// 5. NEO-SOUL's live band is balanced as recorded: no make-up gains, no club sub or sidechain.
{
  const s = defaultState(); applyOverrides(s, generate('neosoul', 9, 'dorian'));
  const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
  assert(e.soulBand() && lowEnd(s.master) === null, 'NEO-SOUL must keep its live-band balance');
  e.stab(0.1, 0.8); e.hook(0.2, 0.8, 4, 0.5, 'reed');
  assert(!Object.keys(e.trims || {}).length, 'NEO-SOUL voices must not get club make-up gain');
}

{
  for (const [style, seed] of [['afrobeats', 1168184795], ['reggaeton', 131219516], ['hyperpop', 273450247], ['hyperpop', 20], ['hyperpop', 3], ['ukg', 1800668011], ['breaks', 3], ['breaks', 4293831530]]) {
    const s = defaultState(); applyOverrides(s, generate(style, seed));
    s.artist = { style, seed };
    const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false }), dst = e.ch.stab.input;
    const tone = e.chordTone(s.params.stab.voice, dst);
    assert.notEqual(tone, dst, `${style} uses its chord voice's tone circuit`);
    assert.equal(e.chordTone(s.params.stab.voice, dst), tone, 'notes share the tone circuit');
    assert.equal(e.chordTone(-1, dst), dst, 'unknown voices keep their destination');
    s.artist.style = 'trap';
    assert.equal(e.chordTone(s.params.stab.voice, dst), dst, 'unmodified genres keep their voice');
    delete s.artist;
    assert.equal(e.chordTone(s.params.stab.voice, dst), dst, 'legacy states keep their voice');
  }
  for (const style of ['breaks', 'neosoul']) {
    const s = defaultState(); applyOverrides(s, generate(style, 3));
    s.artist = { style, seed: 3 };
    const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
    let samples = 0;
    e.rec = () => ({}); e.sampledBass = () => samples++;
    e.bass(0.1, { n: 0, a: true }, 0.1, false);
    assert.equal(samples, style === 'breaks' ? 0 : 1, `${style} keeps its intended bass player under recorded drums`);
  }
  for (const style of ['breaks', 'neosoul', undefined]) {
    const s = defaultState(); s.master.kit = 1;
    if (style) s.artist = { style };
    const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
    assert.equal(e.soulBand(), style !== 'breaks', 'only Breaks keeps club processing with the recorded kit');
    let kicks = 0, samples = 0;
    e.rec = () => ({});
    e.kick = () => kicks++;
    e.sampledHit = () => { samples++; return true; };
    e.trigger('kick', 0.1, 0.8);
    assert.equal(kicks, style === 'breaks' ? 1 : 0);
    assert.equal(samples, style === 'breaks' ? 0 : 1);
    e.trigger('snare', 0.2, 0.8);
    assert.equal(samples, style === 'breaks' ? 1 : 2, 'the snare stays recorded');
  }
  for (const [style, voice, player] of [['breaks', 1, 'keys'], ['reggaeton', 3, 'organ'], ['neosoul', 1, 'keys']]) {
    const s = defaultState(); s.params.stab.voice = voice; s.artist = { style };
    const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
    let out;
    e[player] = (...args) => { out = args.at(-1); };
    e.lick(0.1, 0.6, 0);
    assert.equal(out === e.ch.stab.input, style === 'neosoul', `${style} fills use their intended tone path`);
  }
  for (const [style, voice, reed] of [['breaks', 1, true], ['reggaeton', 3, true], ['breaks', 8, false], ['trap', 1, false], ['afrobeats', 1, false], [undefined, 1, false]]) {
    const s = defaultState(); s.params.stab.voice = voice;
    s.key = 11;
    if (style) s.artist = { style };
    const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
    let player, pitch;
    for (const name of ['keys', 'organ']) e[name] = (...args) => { player = name; pitch = args[3]; };
    e.rec = () => null;
    e.hook(0.1, 0.4, 0, 0.2, 'vocal');
    assert.equal(player, reed ? voice === 1 ? 'keys' : 'organ' : undefined, `${style}/${voice} keeps its intended hook player`);
    for (const hook of ['vocal', 'reed', 'analog']) for (const n of [-36, -12, -11, 0, 20, 21, 48]) {
      const rec = new Recorder(s);
      rec.hook(0.1, 0.4, n, 0.2, hook);
      const note = rec.notes.hook[0].m;
      if (reed && hook !== 'analog') {
        e.hook(0.1, 0.4, n, 0.2, hook);
        assert.equal(note, pitch, `${style}/${voice}/${hook}/${n} MIDI matches played pitch`);
        assert(note >= 48 && note <= 79);
      } else if (hook === 'reed' && SAX_HOOK[style]) assert.equal(note, saxRoot(SAX_HOOK[style], 59) + n, `${style}/${voice}/reed MIDI is in the sax register`);
      else assert.equal(note, 59 + n, `${style}/${voice}/${hook} MIDI register is unchanged`);
    }
  }
}

for (const [style, name] of [['reggaeton', 'dembow'], ['afrobeats', 'finger'], ['jerseyclub', 'bounce']]) {
  const seen = new Set();
  for (let seed = 1; seed <= 100 && seen.size < INSTRUMENTS[style].length; seed++) {
    const s = freshSong(style, seed), chord = s.params.stab.voice;
    s.artist = { style, seed };
    if (seen.has(chord)) continue;
    seen.add(chord);
    assert([1, 2].includes(Math.round(s.params.acid.voice)));
    assert.equal(s.master.kit, 0);
    const ctx = new OfflineAudioContext(2, SR * 0.6, SR), e = new Engine(ctx, s, { realtime: false });
    let calls = 0;
    const color = e.bassColor;
    e.bassColor = function () { calls++; const p = color.call(this); assert.equal(p.name, name); return p; };
    e.acid(0.05, { on: true, n: 0, a: true }, false, false, 0.12);
    e.acid(0.18, { on: true, n: 2, a: false }, true, false, 0.12);
    e.acidRelease(0.4);
    assert.equal(calls, 2, `${style}/${chord} dispatches its own bass on attacks and slides`);
    const buf = await ctx.startRendering(), pcm = buf.getChannelData(0);
    assert(pcm.every(Number.isFinite), `${style}/${chord} finite bass PCM`);
    assert(pcm.some(x => Math.abs(x) > 0.001), `${style}/${chord} audible bass`);
  }
  assert.equal(seen.size, INSTRUMENTS[style].length, `${style} covers every ensemble`);
}
for (const style of ['trap', 'drill', 'minimal', 'hardtechno', 'industrial', 'peak', 'acid', 'hypnotic', 'electro', undefined]) {
  const s = defaultState();
  if (style) s.artist = { style };
  const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
  assert.equal(e.bassColor(), undefined, `${style} retains its stock bass`);
}
const bassIdentities = [];
for (const style of ['trap', 'reggaeton', 'afrobeats', 'jerseyclub', undefined]) {
  const s = defaultState();
  s.key = 0;
  if (style) s.artist = { style };
  Object.assign(s.params.acid, { voice: 2, cutoff: 400, decay: 0.4, drive: 0.2 });
  const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
  e.ch.acid.input = ctx.destination;
  e.eight08(0.05, { on: true, n: 0, a: true }, 0.12, false, false);
  const pcm = (await ctx.startRendering()).getChannelData(0);
  if (!style) assert.deepEqual(pcm, bassIdentities[0], 'missing artist keeps the unmodified Trap 808');
  else {
    for (const other of bassIdentities) assert.notDeepEqual(pcm, other, `${style} has a distinct matched-note bass`);
    bassIdentities.push(pcm);
  }
}
for (const style of ['jerseyclub', 'trap', 'reggaeton', 'afrobeats', 'drill', 'minimal', 'hardtechno']) {
  const s = freshSong(style, 42);
  s.artist = { style, seed: 42 };
  const e = new Engine(new OfflineAudioContext(2, SR, SR), s, { realtime: false }), L = lowEnd(s.master);
  let duck;
  e.scheduleDuck = d => { duck = d; };
  e.duckAt(0.05, 1);
  const pump = duck.parts.find(p => p[0] === e.duck.gain), bass = duck.parts.find(p => p[0] === e.ch.acid.sc.gain);
  assert.equal(pump[1], s.master.duck * 0.9, `${style} preserves the shared pump`);
  if (L) {
    assert.equal(bass[1], L.dip * (style === 'jerseyclub' ? 0.65 : 1), `${style} bass duck depth`);
    assert.equal(bass[2], L.rel * (style === 'jerseyclub' ? 0.6 : 1), `${style} bass recovery`);
  } else assert.equal(bass, undefined, `${style} retains no extra bass sidechain`);
}
console.log('Jersey bass: faster, shallower bass-only duck; shared pump and other genre ducks unchanged');
for (const style of ['neosoul', 'boombap']) {
  const seen = new Set();
  for (const seed of [11, 42, 1234, 20]) {
    const s = freshSong(style, seed);
    s.artist = { style, seed };
    await loadSets(liveSets(s));
    seen.add(s.params.stab.voice);
    assert.equal(s.params.acid.voice, style === 'neosoul' ? 5 : 1);
    const ctx = new OfflineAudioContext(2, SR, SR), e = new Engine(ctx, s, { realtime: false }), calls = {}, played = [];
    e.ch.acid.input = ctx.destination;
    for (const name of ['ebass', 'sampledBass']) {
      const f = e[name];
      e[name] = function (...a) { calls[name] = (calls[name] || 0) + 1; return f.apply(this, a); };
    }
    const play = e.playBuf;
    e.playBuf = function (...a) { if (a[3] === this.ch.acid.input) played.push({ len: a[5], fx: a[6] }); return play.apply(this, a); };
    for (const [t, n] of [[0.05, 0], [0.4, 2]]) {
      e.acidGap = 4;
      e.acid(t, { on: true, n, a: true, s: false }, false, false, 0.15);
    }
    assert.equal(calls[style === 'neosoul' ? 'ebass' : 'sampledBass'], 2, `${style}/${s.params.stab.voice} recorded bass dispatch`);
    assert.equal(played.length, 2);
    if (style === 'neosoul') {
      assert.equal(calls.sampledBass, undefined, 'electric bass does not fall back to the shared upright');
      assert(played.every(p => p.len >= 0.575 && p.fx.lp === 1100 && p.fx.lpTo === 180 && p.fx.lpStages === 2 && p.fx.fade === 0.006), 'legato thumb-rounded electric bass');
      for (const p of played) assert.deepEqual(p.fx.peaks, [[750, 0.7, 15]], 'broad string definition without opening the upper low-pass');
    } else assert(played.every(p => p.len <= 0.24 && p.fx.lp === 900 && p.fx.release === 0.025), 'short damped upright chops');
    const pcm = (await ctx.startRendering()).getChannelData(0);
    assert(pcm.every(Number.isFinite) && pcm.some(v => Math.abs(v) > 0.001), `${style} finite audible PCM`);
  }
  assert.equal(seen.size, INSTRUMENTS[style].length, `${style} covers every ensemble`);
}
console.log('soul bass: every Neo Soul tuple dispatches legato recorded electric; every Boom Bap tuple dispatches damped upright chops');
for (const style of ['reggaeton', 'afrobeats', 'jerseyclub', 'trap', 'drill', 'minimal', 'hardtechno', 'rnb', undefined]) {
  const s = defaultState();
  if (style) s.artist = { style };
  const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false }), played = [];
  e.playBuf = (...a) => played.push({ len: a[5], fx: a[6] });
  e.sampledBass(e.rec('kit'), 0.05, 36, 0.5, false);
  assert.equal(played[0].len, 0.5, `${style} keeps the upright's original note length`);
  assert.equal(played[0].fx.lp, undefined, `${style} bypasses the upright chop`);
  e.ebass(0.05, { on: true, n: 0, a: false }, 0.15, false);
  assert.equal(played[1].fx.lpTo, undefined, `${style} bypasses the Neo Soul damping sweep`);
  assert.equal(played[1].fx.release, 0.05, `${style} preserves the electric bass release`);
}
{
  const s = freshSong('neosoul', 42), e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
  e.rec = () => null;
  let fallback = 0;
  e.bass = () => { fallback++; };
  e.ebass(0.05, { on: true, n: 0, a: false }, 0.15, false);
  assert.equal(fallback, 1, 'unavailable electric recording retains the audible synth fallback');
}
console.log('bass colors: all ensembles, attack/slide playback, finite PCM, matched-note identities and protected/missing-style bypass passed');
for (const [voice, chord, set] of [['tpt', 1, 'tpt'], ['airflute', 1, 'fl'], ['vocal', 7, 'piano']]) {
  await loadBand(set);
  const s = defaultState(); s.key = 0; s.params.stab.voice = chord;
  const ctx = new OfflineAudioContext(1, Math.ceil(SR * 1.2), SR), e = new Engine(ctx, s, { realtime: false });
  const calls = [], play = e.playBuf;
  e.playBuf = function (...args) { calls.push(args); return play.apply(this, args); };
  e.hook(0.05, 0.65, 7, 0.55, voice);
  assert(calls.length > 0, `${voice} uses recorded lead playback`);
  const rendered = await ctx.startRendering(), pcm = rendered.getChannelData(0);
  let peak = 0;
  for (const sample of pcm) { assert(Number.isFinite(sample)); peak = Math.max(peak, Math.abs(sample)); }
  assert(peak > 0.001 && peak < 1, `${voice} lead is audible and level-safe (${peak})`);
  if (voice === 'tpt') {
    assert(calls[0][6].fade >= 0.025 && calls[0][6].ringOut);
    assert.equal(calls[0][6].vib, 6);
    const missing = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
    missing.rec = () => null;
    let fallback = 0;
    missing.leadTone = () => { fallback++; return missing.ch.stab.input; };
    missing.hook(0.05, 0.65, 7, 0.3, 'tpt');
    assert.equal(fallback, 1, 'missing trumpet falls back to the synth reed');
  }
}
console.log('recorded jazz leads: trumpet, airflute and piano finite/audible/level-safe; trumpet envelope and missing-sample fallback passed');
{
  for (const [style, replay, smooth, natural] of [
    ['minimal', null, -12, true], ['minimal', null, 0.5, true],
    ['minimal', null, 0, false], ['trap', 'minimal', -12, true],
    ['hypnotic', null, -12, false], ['minimal', 'hypnotic', -12, false],
  ]) {
    const s = freshSong(style, 42); s.artist = { style };
    const c = new OfflineAudioContext(1, SR, SR), e = new Engine(c, s, { realtime: false });
    if (replay) e.replay808Style = replay;
    e.smoothChords(smooth, 0.05);
    assert(Math.abs(20 * Math.log10(e.bandOut.gain.at(2) / 0.45) - (natural ? 3.5 : 0)) < 0.001, 'only smooth effective Minimal raises its band-room send');
    const oscillators = [], pans = [], links = new Map(); let hammers = 0;
    const oscillator = c.createOscillator, panner = c.createStereoPanner, noise = e.noiseSrc;
    c.createOscillator = function () {
      const o = oscillator.call(this), connect = o.connect;
      o.connect = function (dst) { links.set(o, dst); return connect.call(this, dst); };
      oscillators.push(o); return o;
    };
    c.createStereoPanner = function () { const p = panner.call(this); pans.push(p); return p; };
    e.noiseSrc = function (...args) { hammers++; return noise.apply(this, args); };
    e.recorded = e.recordedNote = () => assert.fail('natural Minimal keys cannot use recorded piano');
    e.keys(0.05, 0.7, [0, 3, 7], 48, s.params.stab, e.mix);
    assert.equal(oscillators.length, natural ? 13 : 10, 'only Minimal adds an inharmonic bar per note');
    assert.equal(hammers, natural ? 3 : 0, 'only Minimal has a filtered felt attack');
    assert.equal(pans.length, natural ? 4 : 1, 'Minimal notes have independent pan positions');
    if (natural) {
      const f = 440 * 2 ** ((48 - 69) / 12), car = oscillators[1], bar = oscillators[4];
      assert.equal(car.frequency.value, f, 'natural keys preserve their MIDI register');
      assert(Math.abs(car.detune.value - ((s.params.stab.detune || 0) * -0.15)) < 0.81, 'per-note tuning remains subtle');
      assert(bar.frequency.value / f >= 2.01 && bar.frequency.value / f <= 2.016, 'bar is slightly inharmonic');
      assert(links.get(bar).gain.events.find(v => v.k === 'g').tc < links.get(car).gain.events.find(v => v.k === 'g').tc, 'bar decays before the body');
      assert(links.get(car).gain.events.some(v => v.k === 'g' && v.tc === 0.06), 'body has a key-release tail');
      assert(new Set(pans.slice(1).map(p => p.pan.value)).size === 3, 'each note occupies its own stereo seat');
    }
    e.smoothChords(0, 2.1);
    assert(Math.abs(e.bandOut.gain.at(4) - 0.45) < 1e-6, 'leaving SMOOTH restores the shared room level');
  }
  const s = freshSong('minimal', 42); s.artist = { style: 'minimal' };
  const c = new OfflineAudioContext(1, SR, SR), e = new Engine(c, s, { realtime: false }); e.smoothChords(-12);
  e.startSource = () => assert.fail('empty, silent and invalid keys must not schedule sources');
  for (const [v, iv, root] of [[0.5, [], 48], [0, [0], 48], [NaN, [0], 48], [0.5, [NaN], 48], [0.5, [0], Infinity]]) e.keys(0.05, v, iv, root, s.params.stab, e.mix);
}
{
  for (const [style, playbackStyle, voice, smooth, wet] of [
    ['minimal', null, 7, -12, true], ['minimal', null, 7, 0.5, true],
    ['minimal', null, 7, 0, false], ['minimal', null, 1, -12, false],
    ['minimal', null, 2, -6, false], ['trap', 'minimal', 7, -12, true],
    ['hypnotic', null, 7, -12, false], [undefined, null, 7, -12, false],
  ]) {
    const s = freshSong(style || 'hypnotic', 11);
    s.artist = { style }; s.params.stab.voice = voice;
    const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
    if (playbackStyle) e.replay808Style = playbackStyle;
    e.smoothChords(smooth);
    let destination, calls = 0;
    const trim = e.trimOut;
    e.trimOut = function (key, db, out, ...args) {
      if (key === `stab${voice}`) destination = out;
      return trim.call(this, key, db, out, ...args);
    };
    e.keys = e.pad = e.piano = () => calls++;
    e.stab(0.05, 0.5);
    assert.equal(calls, 1, 'room routing preserves one chord renderer per trigger');
    assert.equal(destination, wet ? e.ch.stab.band : e.ch.stab.input, `${style}/${playbackStyle}/${voice}/${smooth} restores only the smooth Minimal piano room`);
    assert(e.ch.stab.band.inputs.length === 0, 'room routing does not add duplicate chord sources');
    assert(e.ch.stab.input.inputs.includes(e.ch.stab.band), 'band input preserves the existing dry chord strip');
    assert(e.bandIn.inputs.includes(e.ch.stab.band), 'band input retains the shared room send');
  }
}
{
  for (const seed of [11, 20, 42, 73, 211, 997, 1234, 2026]) {
    const s = freshSong('minimal', seed); s.artist = { style: 'minimal', seed };
    const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false }), q = new Sequencer(e, s);
    q.startAt(0, 0.05); q.tick(0, 0.05);
    assert(e.smoothOn, 'generated Minimal enables the runtime SMOOTH voice treatment');
    assert.equal(e.smooth, undefined, 'Engine voices cannot use the sequencer-only flag');
    let hooks = 0, basses = 0, keys = 0;
    e.minimalHook = () => hooks++;
    e.minimalBass = () => basses++;
    e.bass = e.recordedNote = () => assert.fail('Minimal must not inherit shared bass or recorded hook/chord piano');
    e.rec = () => ({ notes: [60], rate: 48000 });
    for (const voice of ['warm', 'chop', 'reed', 'harp']) e.hook(0.1, 0.5, 0, 0.2, voice);
    assert.equal(hooks, 4, 'every unrecorded hook selection uses the dedicated Minimal renderer');
    e.acidVoice(0.1, { n: 0 }, false, false, e.stepDur);
    assert.equal(basses, 1, 'the sequenced bass dispatch bypasses bass()');
    e.keys = () => keys++;
    for (const voice of [1, 7]) { s.params.stab.voice = voice; e.stab(0.1, 0.5); }
    assert.equal(keys, 2, 'felt keys and nominal piano both reach the control-responsive synthesized keys');
    const clip = ctx.createBuffer(1, SR, SR); clip.getChannelData(0).fill(0.1);
    setVoice({ buffer: clip, chops: [{ midi: 60, start: 0, end: 0.2 }] }, 'MY VOICE', false);
    try {
      let recorded = 0;
      e.chopNote = () => recorded++;
      e.hook(0.1, 0.5, 0, 0.2, 'chop');
      assert.equal(recorded, 1, 'MY VOICE takes precedence over the Minimal synth');
      assert.equal(hooks, 4, 'a recorded chop never also schedules a synth hook');
    } finally { clearVoice(); }
  }
  const voice = async (kind, edit = {}, frequency = 330) => {
    const s = freshSong('minimal', 42); s.artist = { style: 'minimal', seed: 42 };
    Object.assign(s.params.stab, { env: 0.3, tine: 0.15, detune: 0, cutoff: 1800, reso: 0.4, decay: 0.5 }, kind === 'bass' ? {} : edit);
    if (kind === 'bass') Object.assign(s.params.acid, edit);
    const ctx = new OfflineAudioContext(1, SR * 2, SR), e = new Engine(ctx, s, { realtime: false });
    e.smoothChords(-9);
    if (kind === 'hook') e.minimalHook(0.05, 0.7, frequency, 0.5, e.mix);
    else if (kind === 'bass') e.minimalBass(0.05, { n: 0, a: true }, 0.15, false);
    else e.keys(0.05, 0.7, [0, 3, 7], 48, s.params.stab, e.mix);
    return (await ctx.startRendering(e.mix)).getChannelData(0);
  };
  for (const [kind, controls] of [['hook', ['env', 'detune', 'tine']], ['keys', ['env', 'detune', 'tine', 'reso', 'decay']], ['bass', ['drive', 'envmod', 'decay', 'accent', 'edge', 'cutoff']]]) {
    const normal = await voice(kind);
    assert(normal.every(Number.isFinite) && hitDb(normal) > -65, `Minimal ${kind} renders finite audible PCM`);
    for (const control of controls) {
      const low = await voice(kind, { [control]: control === 'cutoff' ? 200 : control === 'reso' ? 1 : 0 });
      const high = await voice(kind, { [control]: control === 'cutoff' ? 4000 : ['detune', 'reso'].includes(control) ? 20 : 1 });
      let delta = 0;
      for (let i = 0; i < low.length; i++) delta += (low[i] - high[i]) ** 2;
      assert(delta / low.length > 1e-9, `Minimal ${kind} ${control} reaches the audio, not just generated state`);
    }
  }
  for (const instrument of [1, 7]) for (const frequency of [130, 330, 1047]) {
    const pcm = await voice('hook', { voice: instrument }, frequency), start = Math.floor(SR * 0.05);
    const early = rmsDb(pcm, start, start + Math.floor(SR * 0.006));
    const body = rmsDb(pcm, start + Math.floor(SR * 0.012), start + Math.floor(SR * 0.032));
    assert(early < body - 6, 'Minimal hook grows into its body rather than striking the master with an onset spike');
  }
  {
    const s = freshSong('minimal', 11), e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
    const stages = [], comp = e.comp;
    e.comp = function (...args) { const node = comp.apply(this, args); stages.push(node); return node; };
    e.minimalHook(0.05, 0.7, 220, 0.2, e.mix);
    e.minimalHook(0.25, 0.7, 440, 0.2, e.mix);
    assert.equal(stages.length, 1, 'Minimal hook notes share peak control before their common bus');
    assert.equal(stages[0].threshold.value, 0);
    assert.equal(stages[0].ratio.value, 4);
    assert(stages[0].attack.value <= 0.002, 'hook peak control catches the onset');
  }
  const compensated = (voice, f) => {
    const s = freshSong('minimal', 42); s.params.stab.voice = voice;
    const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false }), levels = [], adEnv = e.adEnv;
    e.smoothChords(-9);
    e.adEnv = function (param, t, peak, ...args) { levels.push(peak); return adEnv.call(this, param, t, peak, ...args); };
    e.minimalHook(0.05, 0.5, f, 0.2, e.mix);
    return levels[0];
  };
  assert(compensated(1, 880) > compensated(1, 220), 'Minimal synth hook gain compensates the brighter reference register');
  assert(compensated(7, 220) > compensated(7, 880), 'Minimal felt hook gain follows the recorded reference body without using its samples');
  assert(compensated(1, 16000) <= 6 && compensated(7, 20) <= 6, 'Minimal hook make-up is bounded');
  {
    const s = freshSong('minimal', 42); s.artist = { style: 'minimal', seed: 42 };
    const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
    assert(Math.abs(20 * Math.log10(e.out.gain.value / 0.78) - 0.32) < 1e-5, 'Minimal has its own post-limiter loudness trim');
    const shelves = [], filter = e.filter;
    e.filter = function (...args) { const node = filter.apply(this, args); if (args[0] === 'lowshelf') shelves.push(node); return node; };
    e.minimalBass(0.05, { n: 0, a: true }, 0.15, false);
    assert.equal(shelves.length, 1, 'Minimal bass trims only its clean low-band branch');
    assert.equal(shelves[0].frequency.value, 60);
    assert.equal(shelves[0].gain.value, -1, 'the sub correction is a 1dB low shelf, not a wideband gain');
  }
  const s = freshSong('minimal', 42), ctx = new OfflineAudioContext(1, 256, SR), e = new Engine(ctx, s, { realtime: false });
  e.smoothChords(-9);
  e.keys(0, 0.7, [], 48, s.params.stab, e.mix);
  e.minimalHook(0, 0, 330, 0.2, e.mix);
  e.minimalHook(0, 0.7, NaN, 0.2, e.mix);
  e.minimalBass(0, null, 0.1, false);
  assert((await ctx.startRendering(e.mix)).getChannelData(0).every(v => v === 0), 'empty voicings and invalid or silent Minimal notes are silent');
  for (const style of ['minimal', 'phonk', 'trap', 'unknown']) {
    const s = freshSong('minimal', 42); s.artist = { style, seed: 42 };
    const e = new Engine(new OfflineAudioContext(1, 256, SR), s, { realtime: false }), filters = [], filter = e.filter;
    e.filter = function (...args) { filters.push(args); return filter.apply(this, args); };
    if (style === 'minimal') e.smoothChords(-9);
    e.hat(0, 0.7, false);
    assert.equal(filters.some(([type, hz, q]) => type === 'lowpass' && hz === 7000 && q === -3.0103), style === 'minimal', 'only SMOOTH hats band-limit the metallic transient');
    if (style !== 'minimal') {
      let shared = 0;
      e.minimalHook = e.minimalBass = () => assert.fail('non-Minimal and unknown palettes retain their fallback');
      e.bass = () => shared++;
      s.params.acid.voice = 1;
      e.acidVoice(0.05, { n: 0 }, false, false, e.stepDur);
      e.hook(0.05, 0.5, 0, 0.2, 'warm');
      assert.equal(shared, 1);
    }
  }
}

{
  const s = freshSong('minimal', 42); s.artist = { style: 'minimal', seed: 42 };
  const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false }), calls = [];
  e.smoothChords(-12);
  for (const method of ['minimalBass', 'eight08', 'reese', 'ebass', 'pulseBass']) e[method] = () => calls.push(method);
  for (const [voice, method] of [[1, 'minimalBass'], [2, 'eight08'], [3, 'reese'], [5, 'ebass'], [7, 'pulseBass'], [1, 'minimalBass']]) {
    s.params.acid.voice = voice;
    e.acidVoice(0.05, { n: 0 }, false, false, e.stepDur);
    assert.equal(calls.at(-1), method, `Minimal bass selection ${voice} reaches ${method}`);
  }
  assert.equal(calls.length, 6, 'each explicit bass selection schedules only its chosen instrument');
}
for (const start of [0, 17]) {
  const s = freshSong('minimal', 42); s.artist = { style: 'minimal', seed: 42 };
  s.patterns[1] = freshSong('bossa', 12).patterns[0]; s.current = 1;
  s.chainOn = true; s.chain = 'A'; s.ending = false;
  const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
  const expected = 0.78 * 10 ** (0.32 / 20);
  assert(Math.abs(e.out.gain.at(0) - expected) > 0.1, 'construction uses the selected Bossa slot before transport chooses Minimal');
  const q = new Sequencer(e, s); q.startAt(start, 0.05); s.current = q.cur;
  q.tick(start, 0.05);
  assert(e.minimal, 'the first playing pattern is Minimal');
  assert(Math.abs(e.out.gain.at(0.05) - expected) < 1e-6, 'first tick applies the playing style trim, including mid-bar starts');
}
for (const seed of [42, 43]) {
  const s = freshSong('minimal', 42); s.artist = { style: 'hardtechno', seed };
  s.chainOn = true; s.chain = 'F'; s.ending = false;
  const before = structuredClone(s), rec = new Recorder(s); rec.replay808Style = 'minimal';
  const seq = new Sequencer(rec, s);
  for (let i = 0, t = 0; i < 16; i++) { seq.tick(i, t); t += rec.stepDur; }
  const drum = seed % 2 ? 'clap' : 'snare';
  assert(rec.notes[drum]?.length >= 16, 'the project genre schedules audible breakdown rolls during a Minimal replay');
  assert.deepEqual(capture(s, 1, { playbackStyle: 'minimal' }).notes, rec.notes, 'MIDI keeps project-genre drum dispatch and replay-genre instrumentation');
  assert.deepEqual(s, before, 'MIDI dispatch does not mutate the listener project');
  s.mutes[drum] = true;
  assert.equal(capture(s, 1, { playbackStyle: 'minimal' }).notes[drum], undefined, 'muted breakdown rolls remain absent');
}
for (const listener of ['trap', 'dnb', undefined]) {
  const song = freshSong('minimal', 12); song.artist = { style: 'minimal', seed: 12 };
  const expected = capture(song).notes, saved = structuredClone(song);
  saved.artist.style = listener;
  const before = structuredClone(saved), c = capture(saved, 16, { playbackStyle: 'minimal' });
  assert.deepEqual(c.notes, expected, 'saved Minimal MIDI uses its playback genre for lifted chords and every voicing');
  assert.deepEqual(saved, before, 'MIDI genre selection does not rewrite the listener project');
  assert.equal(c.state.artist.style, 'minimal', 'the isolated export snapshot belongs to the song');
  assert.deepEqual(capture(saved, 16, { playbackStyle: null }).notes, capture(saved).notes, 'missing replay metadata retains the existing fallback');
  saved.master.arr = 0; saved.chainOn = false;
  for (const id of Object.keys(saved.params)) saved.mutes[id] = true;
  assert.deepEqual(capture(saved, 1, { playbackStyle: 'minimal' }).notes, {}, 'muted saved Minimal MIDI remains empty');
}
for (const listener of ['trap', 'dnb', undefined]) {
  const s = freshSong('minimal', 42); s.artist = { style: listener, seed: 4 };
  const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false }), calls = [];
  e.replay808Style = 'minimal'; e.replaySeed = 42;
  e.applyMaster('drive', 0, true);
  assert.equal(e.sat.curve.length, 2, 'saved Minimal keeps its own undriven saturator, not the listener genre');
  const q = new Sequencer(e, s); q.startAt(0, 0.05); q.tick(0, 0.05);
  assert(e.smoothOn, 'saved Minimal enables SMOOTH with any listener genre or missing artist style');
  e.recordedNote = e.bass = () => assert.fail('saved Minimal cannot inherit recorded hook/chords or shared bass');
  for (const method of ['minimalHook', 'minimalBass', 'keys']) e[method] = () => calls.push(method);
  e.hook(0.1, 0.5, 0, 0.2, 'warm');
  e.acidVoice(0.1, { n: 0 }, false, false, e.stepDur);
  s.params.stab.voice = 7; e.stab(0.1, 0.5);
  assert.deepEqual(calls, ['minimalHook', 'minimalBass', 'keys'], 'saved Minimal retains all three instruments');
}
{
  const s = freshSong('trap', 42); s.artist = { style: 'minimal' };
  const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
  e.replay808Style = 'trap'; e.applyMaster('drive', 0, true);
  assert(e.sat.curve.length > 2, 'a Minimal listener does not replace a saved Trap saturator');
  const q = new Sequencer(e, s); q.startAt(0, 0.05); q.tick(0, 0.05);
  assert(!e.smoothOn, 'a Minimal listener does not enable SMOOTH on another genre');
}
{
  const s = freshSong('minimal', 12); s.artist = { style: 'minimal', seed: 12 };
  assert.equal(s.params.stab.voice, 7, 'seed 12 selects Minimal felt piano');
  const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false }), rec = new Recorder(s);
  let played;
  e.keys = (t, v, iv, root) => { played = iv.map(n => root + n); };
  for (const db of [-12, 0.5]) {
    e.smoothChords(db); rec.smoothChords(db); rec.notes = {};
    e.stab(0.05, 0.7); rec.trigger('stab', 0.05, 0.7);
    assert.deepEqual(rec.notes.stab.map(n => n.m), played, 'Minimal MIDI follows synthesized felt-key pitches, not recorded-piano octave folding');
    if (db > 0) assert(played.includes(80), 'the lifted seed-12 felt-key chord retains MIDI 80');
  }
}
{
  const s = freshSong('minimal', 12); s.artist = { style: 'trap' };
  const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false }), rec = new Recorder(s), calls = [];
  e.replay808Style = rec.replay808Style = 'minimal';
  e.minimalHook = () => calls.push('hook'); e.minimalBass = () => calls.push('bass');
  let played; e.keys = (t, v, iv, root) => { played = iv.map(n => root + n); };
  e.hook(0.05, 0.5, 0, 0.2, 'warm'); e.acidVoice(0.05, { n: 0 }, false, false, e.stepDur);
  e.stab(0.05, 0.7); rec.trigger('stab', 0.05, 0.7);
  assert.deepEqual(calls, ['hook', 'bass'], 'saved Minimal dispatch does not wait for a SMOOTH sequencer update');
  assert.deepEqual(rec.notes.stab.map(n => n.m), played, 'saved Minimal piano MIDI matches playback before a SMOOTH update');
}
{
  const s = freshSong('bossa', 42); s.artist = { style: 'minimal' };
  const e = new Engine(new OfflineAudioContext(1, SR * 3, SR), s, { realtime: false });
  e.replay808Style = 'bossa'; e.smoothChords(-12);
  e.minimalHook = e.minimalBass = () => assert.fail('Bossa cannot play a stale Minimal palette');
  const q = new Sequencer(e, s); q.startAt(0, 0.05);
  for (let i = 0; i < 16; i++) q.tick(i, 0.05 + i * e.stepDur);
  assert.equal(e.smoothOn, 0, 'Jazz dispatch clears the previous Minimal mix treatment');
  assert.equal(q.smooth, false, 'Jazz dispatch clears the previous sequencer SMOOTH state');
  e.hook(0.1, 0.5, 0, 0.2, 'warm');
  e.state.params.acid.voice = 1; e.acidVoice(0.1, { n: 0 }, false, false, e.stepDur);
}
{
  const s = freshSong('minimal', 42), bossa = freshSong('bossa', 42);
  await loadBand('fl');
  s.artist = { style: 'minimal' }; s.patterns[6] = bossa.patterns[6];
  s.current = 0; s.chain = 'G'; s.chainOn = true; s.ending = false;
  const e = new Engine(new OfflineAudioContext(1, SR * 3, SR), s, { realtime: false }), rec = new Recorder(s), calls = [];
  e.smoothChords(-12);
  e.minimalHook = e.minimalBass = () => assert.fail('pasted Bossa cannot inherit the project Minimal synths');
  e.bass = () => calls.push('bass'); e.windHook = () => calls.push('flute');
  const q = new Sequencer(e, s); q.startAt(0, 0.05);
  for (let i = 0; i < 16; i++) q.tick(i, 0.05 + i * e.stepDur);
  assert.equal(s.current, 0, 'the playing Bossa slot is not the selected Minimal slot');
  assert.equal(e.minimal, false, 'the active pattern overrides the owning project genre');
  assert.equal(e.smoothOn, 0);
  e.hook(2, 0.5, 0, 0.2, 'airflute');
  assert(calls.includes('flute') && calls.includes('bass'), 'pasted Bossa reaches the flute and selected non-Minimal bass');
  rec.playingPattern = e.playingPattern;
  assert.equal(rec.minimal, false, 'MIDI uses the same playing-pattern precedence');
  const own = structuredClone(s); own.artist.style = 'bossa';
  const native = new Engine(new OfflineAudioContext(1, SR, SR), own, { realtime: false });
  native.playingPattern = e.playingPattern;
  native.applyOutputTrim(true); e.applyOutputTrim(true);
  assert.equal(e.out.gain.value, native.out.gain.value, 'Bossa does not inherit Minimal output calibration');
  e.playingPattern = rec.playingPattern = s.patterns[0]; s.current = 6;
  assert(e.minimal && rec.minimal, 'a playing Minimal pattern does not inherit the selected Bossa slot');
  e.playingPattern = rec.playingPattern = { jazz: { style: 'unknown' } };
  assert(e.minimal && rec.minimal, 'unknown pattern metadata retains the song-style fallback');
}
{
  const s = freshSong('minimal', 42); s.artist = { style: 'minimal' }; s.key = 0;
  s.params.acid.voice = 2; s.params.acid.tune = 0;
  const e = new Engine(new OfflineAudioContext(1, SR * 2, SR), s, { realtime: false }), rec = new Recorder(s);
  const pitches = [], bassMidi = e.bassMidi.bind(e);
  e.bassMidi = (...a) => { const m = bassMidi(...a); pitches.push(m); return m; };
  assert.deepEqual(rec.notes, {}, 'an empty 808 MIDI recorder has no notes');
  for (const n of [2, 3, 4, 5, 6, 7, 8]) {
    const t = n * 0.05, st = { n };
    e.eight08(t, st, 0.1, false, false); rec.acid(t, st, false, false, 0.1);
  }
  assert.deepEqual(rec.notes.acid.map(n => n.m), pitches, 'Minimal 808 MIDI matches playback across both register boundaries');
  assert.deepEqual(pitches.slice(1, 6), [27, 28, 29, 30, 31], '808 folds MIDI39–43 down one octave');
  s.params.acid.voice = 1; rec.acid(1, { n: 4 }, false, false, 0.1);
  assert.equal(rec.notes.acid.at(-1).m, 40, 'default Minimal bass retains its wider body register');
}
for (const [from, to, method] of [[2, 1, 'minimalBass'], [1, 2, 'eight08']]) {
  const s = freshSong('minimal', 42); s.artist = { style: 'minimal' }; s.params.acid.decay = 1;
  const ctx = new OfflineAudioContext(1, SR * 0.3, SR), e = new Engine(ctx, s, { realtime: false });
  s.params.acid.voice = from; e.acidVoice(0.02, { n: 0 }, false, true, 0.1);
  const nodes = from === 2 ? [e.mono.amp] : [...e.minimalMono.amps, e.minimalMono.touch], events = [];
  for (const node of nodes) {
    const p = node.gain, cancel = p.cancelScheduledValues.bind(p), target = p.setTargetAtTime.bind(p), calls = [];
    p.cancelScheduledValues = (...a) => { calls.push(['cancel', ...a]); return cancel(...a); };
    p.setTargetAtTime = (...a) => { calls.push(['target', ...a]); return target(...a); };
    events.push(calls);
  }
  e[method] = () => {}; s.params.acid.voice = to;
  e.acidVoice(0.03, { n: 0 }, false, true, 0.1);
  for (const calls of events) {
    assert.deepEqual(calls[0], ['cancel', 0.03], 'a bass switch cancels the outgoing future envelope before it can reopen');
    assert.deepEqual(calls[1].slice(0, 3), ['target', 0, 0.03], 'a bass switch chokes every outgoing body, hit and click');
  }
  const pcm = (await ctx.startRendering(e.ch.acid.input)).getChannelData(0);
  assert(rmsDb(pcm, Math.floor(SR * 0.02), Math.floor(SR * 0.03)) > -60, 'the outgoing voice really sounded');
  assert(hitDb(pcm.slice(Math.floor(SR * 0.13), Math.floor(SR * 0.25))) < -80, `${from} to ${to} leaves no ringing voice under the next note`);
}
console.log('sound ok');
