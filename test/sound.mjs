// Offline sound check: renders real songs through the engine in Node (test/offline-audio.mjs, dry mix)
// and measures where the energy sits per genre — club sub weight, kick/bass sidechain, low-mid mud,
// 2–5 kHz lead harshness — plus synth-vs-recorded voice levels and lead CPU cost.
import assert from 'node:assert/strict';
import { OfflineAudioContext, installGlobals } from './offline-audio.mjs';
installGlobals();
const { defaultState, generate, applyOverrides, arrangement, freshSong, INSTRUMENTS } = await import('../js/state.js');
const { Engine, Sequencer } = await import('../js/engine.js');
const { Recorder } = await import('../js/midi.js');
const { loadBand, loadSets, liveSets, STAB_BAND, SOFT_LAYER } = await import('../js/livekit.js');
const { spectralBands, kWeight, lufs } = await import('../js/lab-metrics.js');
const { lowEnd } = await import('../js/lowend.js');
await import('./sampler.mjs');

// 48 kHz like a real device: at 32 kHz bright resonant filters sit near Nyquist, where the shim blows up.
const SR = 48000, P = Engine.prototype, orig = {};
for (const k of ['stab', 'lick', 'hook', 'kick']) orig[k] = Object.getOwnPropertyDescriptor(P, k).value;

async function render(style, seed, { stem = 'full', bars = 4, voice = null, mute = null } = {}) {
  const s = defaultState(), g = generate(style, seed);
  applyOverrides(s, g); s.patterns = arrangement(g.pattern, seed); s.current = 6;
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

for (const style of ['euphoric']) {
  const { paletteFor, paletteColor, soundingPitch } = await import('../js/engine.js');
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
      assert(Math.abs(69 + 12 * Math.log2(frequency / 440) - rec.notes.hook.at(-1).m) < 1e-8, `${style} hook snap matches MIDI`);
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
      } else assert.equal(note, 59 + n, `${style}/${voice}/${hook} MIDI register is unchanged`);
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
console.log('sound ok');
