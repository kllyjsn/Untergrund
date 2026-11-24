// js/audio-quality.js on synthetic signals with known answers (the measurements scripts/audio-benchmark.mjs gates on).
import assert from 'node:assert/strict';
import { analyzeMix, analyzeStems, ending, stereo, spectrum, loudnessRange, kHops, shaper, crest, limiter } from '../js/audio-quality.js';
import { analyzePerceptual, PERCEPTUAL_METRICS } from '../js/perceptual-audio.js';
import { clipCurve, satCurve } from '../js/dsp.js';
import { baselineOf, compare, report } from '../scripts/audio-benchmark.mjs';
import { withChrome } from './chrome.mjs';
import { stringStopSections } from '../js/hiphop.js';
import './render-determinism.mjs';

for (const args of [[48000, 0, 4220], [48000, 4220, 1790], [8000, 1790, 4220], [NaN, 1790, 4220], [Infinity, 1790, 4220], [48000, 1790, 4220, 0], [48000, 1790, 4220, -16], [48000, 1790, 4220, NaN]]) {
  assert.throws(() => stringStopSections(...args), RangeError);
}
const stringsStop = await withChrome((run) => run(`(async () => {
  const { HIPHOP, stringStopSections } = await import('/js/hiphop.js');
  const { Engine } = await import('/js/engine.js');
  const { defaultState, STYLES } = await import('/js/state.js');
  const { withStableAudioSums } = await import('/test/stable-audio-sums.js');
  const edges = HIPHOP.gfunk.strStop;
  for (const fs of [22050, 44100, 48000, 96000, 192000]) {
    const ctx = new OfflineAudioContext(1, fs, fs), frequencies = Float32Array.from({ length: 7981 }, (_, i) => i + 20);
    const gain = new Float64Array(frequencies.length), phase = new Float32Array(frequencies.length), magnitude = new Float32Array(frequencies.length);
    const sections = stringStopSections(fs, ...edges);
    for (const [b, a] of sections) {
      ctx.createIIRFilter(b, a).getFrequencyResponse(frequencies, magnitude, phase);
      gain.forEach((v, i) => { gain[i] = v + 20 * Math.log10(magnitude[i]); });
    }
    for (let hz = 800; hz <= 1700; hz++) if (gain[hz - 20] < -1.5 || gain[hz - 20] > 0.001) throw Error('Strings body response at ' + fs);
    if ([...gain].some(v => !Number.isFinite(v) || v > 0.001 || v < -16.001)) throw Error('Strings stop-band boost, excessive depth or invalid response');
    if (Math.min(...gain.slice(1980, 3981)) > -15.9) throw Error('Strings stop band did not reach its depth cap');
    const old = new Float64Array(frequencies.length);
    for (const [frequency, Q, db] of [[2200, 1, -6], [3000, .6, -12]]) {
      const bell = ctx.createBiquadFilter(); bell.type = 'peaking'; bell.frequency.value = frequency; bell.Q.value = Q; bell.gain.value = db;
      bell.getFrequencyResponse(frequencies, magnitude, phase);
      old.forEach((v, i) => { old[i] = v + 20 * Math.log10(magnitude[i]); });
    }
    for (let hz = 5000; hz <= 8000; hz++) if (gain[hz - 20] < old[hz - 20] - .001) throw Error('Strings air response at ' + fs);
    const source = ctx.createBufferSource(); source.buffer = ctx.createBuffer(1, fs, fs); source.buffer.getChannelData(0)[0] = 1;
    let node = source;
    for (const [b, a] of sections) node = node.connect(ctx.createIIRFilter(b, a));
    node.connect(ctx.destination); source.start();
    if ([...(await ctx.startRendering()).getChannelData(0)].some(v => !Number.isFinite(v))) throw Error('Unstable strings impulse at ' + fs);
  }
  const ctx = new OfflineAudioContext(1, 1024, 48000), state = defaultState(), engine = new Engine(ctx, state, { realtime: false });
  let fx;
  engine.playBuf = (...args) => { fx = args[6]; };
  for (const style of Object.keys(STYLES)) for (const kind of ['str', 'piano', null]) {
    state.artist = { style };
    engine.recordedNote([[60, {}]], .05, .8, 60, .5, ctx.destination, 0, kind);
    if (Boolean(fx.stop) !== (style === 'gfunk' && kind === 'str')) throw Error('Strings stop-band scope: ' + style + '/' + kind);
  }
  async function pcm(stop, silent = false) {
    return withStableAudioSums(async () => {
      const ctx = new OfflineAudioContext(1, 8192, 48000), e = new Engine(ctx, defaultState(), { realtime: false }); e.out.disconnect();
      const buffer = ctx.createBuffer(1, 8192, 48000);
      if (!silent) buffer.getChannelData(0)[0] = .25;
      e.playBuf(buffer, 0, 1, ctx.destination, 1, 0, { stop });
      return [...(await ctx.startRendering()).getChannelData(0)];
    });
  }
  const plain = await pcm(), empty = await pcm(null), filtered = await pcm(edges), silent = await pcm(edges, true);
  if (plain.some((v, i) => v !== empty[i])) throw Error('Empty stop band changed PCM');
  if (!filtered.some((v, i) => Math.abs(v - plain[i]) > 1e-4)) throw Error('Strings stop band did not process PCM');
  if (silent.some(v => v !== 0)) throw Error('Strings stop band changed silence');
  return true;
})()`));
if (stringsStop) console.log('G-Funk strings stop band: 16 dB cap without boosts, body/air at 22.05–192 kHz, finite impulses, genre/instrument scope, empty and silent PCM passed');

const deepHouseBuild = await withChrome((run) => run(`(async () => {
  const { Engine, Sequencer } = await import('/js/engine.js');
  const { song } = await import('/test/audio-quality-page.js');
  const s = song('deephouse', 42);
  s.bpm = 120;
  const rate = 48000, bar = 2, buildBars = 4, from = s.chain.indexOf('BBBB');
  const ctx = new OfflineAudioContext(1, 10 * rate, rate);
  const engine = new Engine(ctx, s, { realtime: false });
  const seq = new Sequencer(engine, s);
  const source = ctx.createConstantSource();
  engine.out.disconnect();
  engine.secGain.disconnect();
  source.connect(engine.secGain).connect(ctx.destination);
  source.start();
  seq.startAt(from * 16, 0);
  for (let i = 0; i <= buildBars; i++) seq.advanceBar((from + i) * 16, i * bar);
  const samples = (await ctx.startRendering()).getChannelData(0);
  return Array.from({ length: buildBars }, (_, i) => {
    const at = i * bar;
    return samples[(at + 1.75) * rate] - samples[(at + 0.25) * rate];
  });
})()`));
if (deepHouseBuild) {
  assert(deepHouseBuild.every((rise) => rise > 0.02), `Deep House build gain rises within every bar: ${deepHouseBuild}`);
}

const chordsFill = await withChrome((run) => run(`(async () => {
  const { Engine } = await import('/js/engine.js');
  const { defaultState } = await import('/js/state.js');
  const rate = 48000, fillAt = 0.5, first = fillAt * rate;
  class Legacy extends Engine {
    wireOrganFill() {}
  }
  const routes = {
    fill: e => e.lick(fillAt, 0.6, 0),
    'organ chord': e => e.synthOrgan(fillAt, 0.6, [0, 4, 7], 50, e.state.params.stab, e.ch.stab.input),
    'mono sample through band EQ': (e, take) => e.playBuf(take, fillAt, 0.7, e.bodyFor(e.ch.stab.band, [390, 1, 2]), 1, 0.3),
    'mono piano with stereo tape keys': (e, take) => {
      e.playBuf(take, fillAt, 0.7, e.ch.stab.band, 1, 0.3);
      e.hook(fillAt - 0.1, 0.7, 3, 0.35, 'tapekeys');
    },
    'mono harp': (e, take) => e.harpHook([[84, take]], fillAt, 0.6, 72, 0.4),
  };
  async function render(EngineType, withStereoVoice, play) {
    const ctx = new OfflineAudioContext(2, rate, rate);
    const s = defaultState();
    s.artist = { style: 'deephouse', seed: 12 };
    s.key = 3;
    Object.assign(s.params.stab, { voice: 3, octave: 1, chord: 0, pan: 0 });
    const engine = new EngineType(ctx, s, { realtime: false });
    const { input, out, pan } = engine.ch.stab;
    engine.out.disconnect();
    (out || pan).connect(ctx.destination);
    engine.smoothChords(-2, 0.25);
    engine.at = 0.35;
    engine.setParam('stab', 'pan', 0.31);
    engine.setParam('stab', 'level', 0.7);
    if (withStereoVoice) {
      const voice = ctx.createBufferSource();
      voice.buffer = ctx.createBuffer(2, rate, rate);
      // The stereo note has gone silent by the fill, but its source is still connected.
      voice.buffer.getChannelData(0).fill(0.1, 0, rate / 8);
      voice.buffer.getChannelData(1).fill(-0.1, 0, rate / 8);
      voice.connect(input);
      voice.start();
    }
    const take = ctx.createBuffer(1, rate, rate), pcm = take.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.2 * Math.sin(i * 0.05);
    play(engine, take);
    return ctx.startRendering();
  }
  const rows = [];
  for (const [route, play] of Object.entries(routes)) {
    for (const ghost of [false, true]) {
      const before = await render(Legacy, route !== 'fill' && ghost, play);
      const after = await render(Engine, ghost, play);
      for (const channel of [0, 1]) {
        const a = before.getChannelData(channel), b = after.getChannelData(channel);
        let energy = 0, error = 0;
        for (let i = first; i < a.length; i++) {
          energy += a[i] ** 2;
          error += (a[i] - b[i]) ** 2;
        }
        rows.push({ route, ghost, channel, rms: Math.sqrt(energy / (a.length - first)), relativeResidual: Math.sqrt(error / energy) });
      }
    }
  }
  return rows;
})()`));
if (chordsFill) {
  for (const row of chordsFill) {
    assert(row.rms > 0.001, 'CHORDS voice is audible in each channel');
    assert(row.relativeResidual < 1e-5, `CHORDS voice no longer matches its legacy level: ${JSON.stringify(row)}`);
  }
  console.log('CHORDS organ fill preserves its solo level with or without a stereo predecessor; the shared path is unchanged');
}


const phonkWidth = await withChrome((run) => run(`(async () => {
  const { Engine } = await import('/js/engine.js');
  const { defaultState } = await import('/js/state.js');
  const ctx = new OfflineAudioContext(2, 2048, 48000);
  const engine = new Engine(ctx, defaultState(), { realtime: false });
  engine.out.disconnect();
  const source = ctx.createBufferSource();
  source.buffer = ctx.createBuffer(1, 2048, 48000);
  source.buffer.getChannelData(0)[0] = 0.25;
  source.connect(engine.phonkMusicIn(ctx.destination));
  source.start();
  const audio = await ctx.startRendering(), L = audio.getChannelData(0), R = audio.getChannelData(1);
  let foldError = 0, sidePeak = 0;
  for (let i = 0; i < L.length; i++) {
    foldError = Math.max(foldError, Math.abs((L[i] + R[i]) / 2 - (i === 0 ? 0.25 : 0)));
    sidePeak = Math.max(sidePeak, Math.abs((L[i] - R[i]) / 2));
  }
  return { foldError, sidePeak };
})()`));
if (phonkWidth) {
  assert(phonkWidth.sidePeak > 0.1 && phonkWidth.foldError < 1e-7, 'Phonk reflection adds width but cancels in mono');
  console.log('Phonk reflection adds stereo width without changing the dry mono fold-down');
}

// Include the approach to a breakdown and the return to the drop: a late
// cancel-and-hold/ramp changes the filter *before* the breakdown's downbeat.
const exportNull = await withChrome((run) => run(`(async () => {
  const { withStableAudioSums } = await import('/test/stable-audio-sums.js');
  const original = AudioNode.prototype.connect;
  try { await withStableAudioSums(() => { throw Error('expected'); }); }
  catch (e) { if (e.message !== 'expected') throw e; }
  if (AudioNode.prototype.connect !== original) throw Error('Failed to restore connect after error');
  for (const values of [[], [1e8, -1e8, 1]]) {
    const samples = [];
    for (let i = 0; i < 10; i++) samples.push(await withStableAudioSums(async () => {
      const ctx = new OfflineAudioContext(1, 128, 48000);
      for (const value of values) {
        const source = ctx.createConstantSource(); source.offset.value = value;
        source.connect(ctx.destination); source.connect(ctx.destination); source.start();
      }
      const removed = ctx.createConstantSource(); removed.offset.value = 123;
      removed.connect(ctx.destination); removed.disconnect(ctx.destination); removed.start();
      return (await ctx.startRendering()).getChannelData(0)[0];
    }));
    if (samples.some(v => v !== 0)) throw Error('Unstable binary sums or disconnect: ' + samples);
  }
  if (AudioNode.prototype.connect !== original) throw Error('Failed to restore connect after render');
  return withStableAudioSums(async () => {
  const { song } = await import('/test/audio-quality-page.js');
  const { renderBars } = await import('/js/render.js');
  const s = song('hardtechno', 42);
  s.chain = 'CCCEEFFGGGGGGGGG';
  const opts = { startBar: 1 };
  const full = await renderBars(s, 8, { ...opts, onScheduled() {} });
  const proto = OfflineAudioContext.prototype, suspend = proto.suspend;
  let suspends = 0, batched;
  proto.suspend = function (at) { suspends++; return suspend.call(this, at); };
  try { batched = await renderBars(s, 8, opts); }
  finally { proto.suspend = suspend; }
  if (full.length !== batched.length || full.numberOfChannels !== batched.numberOfChannels) throw Error('Render shape changed');
  let peak = 0, rms = 0;
  for (let c = 0; c < full.numberOfChannels; c++) {
    const a = full.getChannelData(c), b = batched.getChannelData(c);
    const window = full.sampleRate / 10;
    for (let i = 0; i < a.length; i += window) {
      const end = Math.min(a.length, i + window);
      let energy = 0;
      for (let k = i; k < end; k++) {
        const error = a[k] - b[k];
        peak = Math.max(peak, Math.abs(error));
        energy += error ** 2;
      }
      rms = Math.max(rms, Math.sqrt(energy / (end - i)));
    }
  }
  return { peak, rms, suspends };
  });
})()`));
if (exportNull) {
  assert(exportNull.suspends > 0, 'Hard Techno export scheduled hits in batches');
  // Bound the residual per 100 ms as well as at the worst sample, not just song RMS.
  assert(exportNull.peak < 0.001 && exportNull.rms < 0.0002, `Hard Techno export render null: ${JSON.stringify(exportNull)}`);
}

{
  const result = {
    style: 'minimal', seed: 42,
    mix: {
      peak: { truePeakDb: -2, clipRuns: 0, dcDb: -80 }, loudness: { integrated: -10 }, limiter: { strainShare: 0 },
      spectrum: { tilt: -4, mudBumpDb: 0, harshBumpDb: 0, shares: { sub: 0.3 } },
      stereo: { monoLossLu: 0, correlationP5: 1, lowSideDb: -40, correlation: 0.5 }, balance: { rmsDb: 4 },
    },
    stems: { missing: [], stems: ['ch', 'snare', 'stab'].map((id) => ({ id, notes: 4, relLu: -10, buriedShare: 0, hits: { spreadDb: 1, rangeDb: 2, attackDb: 3 } })) },
  };
  const run = () => report('fast', [42], [result], null, {});
  const rep = run();
  for (const id of ['genreBalance', 'drumSpread', 'hatSpread', 'bandSpread', 'snareAttack', 'meanCorrelation']) {
    assert.equal(rep.styles.minimal.metrics[id].level, 'INFO', id);
    assert.deepEqual(rep.global[id].levels, { INFO: 1, PASS: 0, WARN: 0, FAIL: 0 }, `${id} is not counted as a pass`);
  }
  assert.equal(rep.styles.minimal.metrics.windowLufs.level, 'PASS', 'drift-only checks remain gated');
  assert.equal(rep.styles.minimal.metrics.clipRuns.level, 'PASS', 'fail-only checks remain gated');
  assert.equal(rep.verdict, 'PASS');
  assert.deepEqual(rep.styles.minimal.reasons, []);
  assert.equal(rep.counts.PASS, 1, 'style verdict counts are unchanged');
  result.mix.balance = null;
  const missing = run();
  assert.equal(missing.styles.minimal.metrics.genreBalance, undefined);
  assert.equal(missing.global.genreBalance, undefined);
  assert.deepEqual(report('fast', [], [], null, {}).global, {});
  result.mix.peak.truePeakDb = -0.5;
  assert.equal(run().verdict, 'WARN');
  result.stems.kickBass = { collisionP90Db: -20 };
  const base = JSON.parse(baselineOf(run()));
  const kickBassLevel = (value) => {
    result.stems.kickBass.collisionP90Db = value;
    return report('fast', [42], [result], base, {}).styles.minimal.metrics.kickBass.level;
  };
  assert.equal(kickBassLevel(-200), 'PASS', 'offbeat bass does not collide with the kick');
  assert.equal(kickBassLevel(-8), 'FAIL', 'an increase in kick masking still fails drift');
  result.stems.kickBass.collisionP90Db = 20;
  for (const style of ['swing', 'modal', 'bossa']) {
    const metrics = report('fast', [42], [{ ...result, style }], null, {}).styles[style].metrics;
    assert.equal(metrics.kickBass, undefined);
    assert.equal(metrics.acousticKickBass.level, 'INFO', `${style} does not demand a kick louder than upright`);
    assert.equal(metrics.acousticKickBass.worst, 20, 'the measurement remains visible');
    const missingBass = { ...result, style, stems: { ...result.stems, missing: ['acid'] } };
    assert.equal(report('fast', [42], [missingBass], null, {}).styles[style].metrics.missingParts.level, 'FAIL', `${style} still gates missing bass`);
  }
  assert.equal(run().styles.minimal.metrics.kickBass.level, 'FAIL', 'electronic grooves retain the absolute guardrail');
  assert.equal(report('fast', [42], [{ ...result, style: 'jazzfunk' }], null, {}).styles.jazzfunk.metrics.kickBass.level, 'FAIL', 'jazz-funk retains the kick/bass guardrail');
  result.mix.peak.clipRuns = 1;
  assert.equal(run().verdict, 'FAIL');
  console.log('audio benchmark applicability passed: INFO counts, missing measurements and unchanged PASS/WARN/FAIL verdicts');
}

const fs = 48000, sec = (s) => Math.round(s * fs);
const tone = (f, s, a = 0.5, ph = 0) => Float32Array.from({ length: sec(s) }, (_, i) => a * Math.sin(2 * Math.PI * f * i / fs + ph));
let seed = 7;
const noise = (s, a = 0.3) => Float32Array.from({ length: sec(s) }, () => { seed = (seed * 16807) % 2147483647; return a * (seed / 1073741823.5 - 1); });
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

// Peaks and clipping
const sine = tone(997, 2, 0.5), clipped = sine.map((v) => Math.max(-0.3, Math.min(0.3, v)) / 0.3);
const m = analyzeMix(sine, sine, fs);
near(m.peak.truePeakDb, -6.02, 0.05, 'sine true peak');
assert.equal(m.peak.clipRuns, 0);
assert(analyzeMix(clipped, clipped, fs).peak.clipRuns > 100, 'hard-clipped square counts clipped runs');

// Stereo: identical channels fold to mono losslessly; inverted channels cancel; decorrelated noise loses ~3 dB
near(stereo(sine, sine, fs).monoLossLu, 0, 0.01, 'mono-identical');
assert(stereo(sine, sine.map((v) => -v), fs).correlationP5 < -0.99, 'inverted correlation');
assert.equal(stereo(sine, sine.map((v) => -v), fs).monoLossLu, -99, 'inverted cancels in mono');
near(stereo(noise(4), noise(4), fs).monoLossLu, -3, 0.3, 'decorrelated noise loses 3 dB in mono');
const wideBass = stereo(tone(50, 2), tone(50, 2, 0.5, Math.PI / 2), fs), monoBass = stereo(tone(50, 2), tone(50, 2), fs);
assert(wideBass.lowSideDb > -5 && monoBass.lowSideDb < -60, `side under 120 Hz: ${wideBass.lowSideDb} / ${monoBass.lowSideDb}`);

// Spectrum: tilt orders bright above dark; a 300 Hz bump reads as low-mid build-up, a 3 kHz one as harshness
const mix = (...xs) => xs[0].map((_, i) => xs.reduce((a, x) => a + x[i], 0));
const white = noise(4), brown = new Float32Array(white.length);
for (let i = 1, y = 0; i < white.length; i++) brown[i] = y = y * 0.999 + white[i] * 0.05;
const bright = spectrum(white, white, fs), dark = spectrum(brown, brown, fs);
assert(bright.tilt > 2 && dark.tilt < -2, `tilt: white noise ${bright.tilt} (~+3), brown noise ${dark.tilt} (~-3)`);
const base = mix(tone(100, 3, 0.4), tone(1000, 3, 0.15));
const muddy = spectrum(...[0, 1].map(() => mix(base, tone(300, 3, 0.6))), fs), harsh = spectrum(...[0, 1].map(() => mix(base, tone(3000, 3, 0.4))), fs), clean = spectrum(base, base, fs);
assert(muddy.mudBumpDb > 3 && clean.mudBumpDb < -10, `mud ${muddy.mudBumpDb} vs ${clean.mudBumpDb}`);
assert(harsh.harshBumpDb > 3 && clean.harshBumpDb < -10, `harsh ${harsh.harshBumpDb} vs ${clean.harshBumpDb}`);

// Loudness range: steady tone ~0 LU, alternating 10 dB sections ~10 LU
near(loudnessRange(kHops([tone(1000, 20)], fs)), 0, 0.2, 'LRA steady');
const steps = Float32Array.from({ length: sec(40) }, (_, i) => (Math.floor(i / sec(10)) % 2 ? 0.5 : 0.158) * Math.sin(2 * Math.PI * 1000 * i / fs));
near(loudnessRange(kHops([steps], fs)), 10, 1, 'LRA two levels');

// Endings: exponential decay vs hard cut vs a drone that never stops vs silence after the end
const decay = (rate) => Float32Array.from({ length: sec(8) }, (_, i) => 0.5 * Math.exp(-i / fs * rate) * Math.sin(2 * Math.PI * 220 * i / fs));
const nice = ending([decay(4), decay(4)], fs, 0, -10, 8);
near(nice.t40, 40 / (20 * Math.log10(Math.E) * 4), 0.15, 'decay time to -40 dB');
assert(nice.cliffDb < 3, `smooth decay cliff ${nice.cliffDb}`);
const cut = decay(0.5); cut.fill(0, sec(1));
assert(ending([cut, cut], fs, 0, -10).cliffDb > 60, 'hard cut is a cliff');
const slow = ending([decay(0.3), decay(0.3)], fs, 0, -10);
assert(!slow.t40Measured && slow.t40 > 12 && slow.t40 < 20, `slow decay extrapolated: ${slow.t40}`);
assert.equal(ending([tone(220, 8), tone(220, 8)], fs, 0, -10).t40, 999, 'drone never decays');
near(ending([decay(4), decay(4)], fs, 0, -10, 6).deadAirSec, 6 - nice.t40, 0.05, 'dead air after the ring-out');

// Silence inside the song: a 3 s dropout
const gap = tone(440, 10); gap.fill(0, sec(4), sec(7));
near(analyzeMix(gap, gap, fs, { finalHit: 9.5 }).silence.maxGapSec, 3, 0.4, 'dropout length');

// Stems: a silent part that has notes is missing; a quiet part under a loud one at the same pitch is masked
const loud = { id: 'stab', left: tone(500, 2, 0.5), right: tone(500, 2, 0.5), notes: 8 };
const hidden = { id: 'hook', left: tone(520, 2, 0.01), right: tone(520, 2, 0.01), notes: 8 };
const clear = { id: 'hook', left: tone(4000, 2, 0.05), right: tone(4000, 2, 0.05), notes: 8 };
const gone = { id: 'vox', left: new Float32Array(sec(2)), right: new Float32Array(sec(2)), notes: 4 };
const st = analyzeStems([loud, hidden, gone], fs);
assert.deepEqual(st.missing, ['vox']);
assert(st.stems.find((s) => s.id === 'hook').buriedShare > 0.9, 'masked hook');
assert(analyzeStems([loud, clear], fs).stems.find((s) => s.id === 'hook').buriedShare < 0.1, 'unmasked hook');

// Kick/bass: bass sitting on every kick collides; bass ducked out of the kick's 60 ms does not
const kicks = [0.25, 0.75, 1.25, 1.75], kick = new Float32Array(sec(2));
for (const t of kicks) for (let i = 0; i < sec(0.15); i++) kick[sec(t) + i] = 0.8 * Math.exp(-i / fs * 20) * Math.sin(2 * Math.PI * 55 * i / fs);
const bass = tone(45, 2, 0.6), ducked = bass.map((v, i) => (kicks.some((t) => i >= sec(t) && i < sec(t + 0.08)) ? 0 : v));
const kb = (b) => analyzeStems([{ id: 'kick', left: kick, right: kick, notes: 4 }, { id: 'acid', left: b, right: b, notes: 4 }], fs, { kicks }).kickBass.collisionP90Db;
assert(kb(bass) > -3 && kb(ducked) < kb(bass) - 8, `kick/bass collision ${kb(bass)} vs ducked ${kb(ducked)}`);

// Over-limiting: the master clipper curve leaves a signal under its knee alone, soft-clips a peak just over it and
// hard-clips one past full scale; the bus saturator compresses a hot peak; crest falls when peaks are flattened;
// limiter gain reduction is absolute once its make-up gain is known.
const clipC = clipCurve(), under = shaper([tone(997, 1, 0.8), tone(997, 1, 0.8)], fs, { curve: clipC });
near(under.shaveMaxDb, 0, 0.01, 'clipper under the knee'); assert.equal(under.hardShare, 0);
const soft = shaper([tone(997, 1, 0.95), tone(997, 1, 0.95)], fs, { curve: clipC });
assert(soft.share1Db === 0 && soft.shaveMaxDb > 0.05 && soft.hardShare === 0, `soft clip ${JSON.stringify(soft)}`);
const hard = shaper([tone(997, 1, 0.5), tone(997, 1, 0.5)], fs, { curve: clipC, gain: 3 });
assert(hard.hardShare > 0.95 && hard.share3Db > 0.95, `hard clip ${JSON.stringify(hard)}`);
near(hard.shaveMaxDb, 20 * Math.log10(1.5 / clipC[clipC.length - 1]), 0.05, 'hard clip depth');
const satHot = shaper([tone(997, 1, 0.2), tone(997, 1, 0.2)], fs, { curve: satCurve(0.8) }), satCold = shaper([tone(997, 1, 0.002), tone(997, 1, 0.002)], fs, { curve: satCurve(0.8) });
assert(satHot.shaveP99Db > 1 && satCold.shaveP99Db < 0.05, `saturator ${satHot.shaveP99Db} / ${satCold.shaveP99Db}`);
const beats = noise(2, 0.05); for (let k = 0; k < 8; k++) beats[sec(k * 0.25)] = 0.9;
const flat = beats.map((v) => Math.max(-0.1, Math.min(0.1, v))), bt = [0, 0.5, 1, 1.5, 2];
assert(crest(beats, beats, fs, bt).p10Db > crest(flat, flat, fs, bt).p10Db + 10, 'clipping lowers crest');
const lin = tone(997, 1, 0.5), half = lin.map((v) => v * 0.5 * 1.5);
near(limiter([lin, lin, half, half], fs, -Infinity, null, 20 * Math.log10(1.5)).grMean, -6.02, 0.05, 'absolute gain reduction');
near(limiter([lin, lin, half, half], fs).grMean, 0, 0.01, 'relative gain reduction without make-up');

const perceptual = (x, options) => analyzePerceptual(x, x, fs, options);
const dry = tone(250, 4, 0.25), brightTone = tone(3000, 4, 0.35);
const brightAttacks = dry.map((v, i) => v + (i % sec(0.4) < sec(0.045) ? brightTone[i] : 0));
const burstScores = perceptual(brightAttacks);
assert(burstScores.harshTransients > perceptual(mix(dry, brightTone)).harshTransients + 20, 'bright attacks outrank steady brightness');
assert(burstScores.lackOfSmoothness > perceptual(dry).lackOfSmoothness, 'repeated irregular energy changes raise the lack-of-smoothness proxy');
assert.deepEqual(perceptual(brightAttacks.map((v) => 0.1 * v)), burstScores, 'audible scores are gain-relative');
assert.deepEqual(analyzePerceptual(brightAttacks, brightAttacks.map((v) => -v), fs), burstScores, 'stereo energy is phase-safe');

const after = tone(850, 4, 0.55), abrupt = dry.map((v, i) => i < sec(2) ? v : after[i]);
const eased = dry.map((v, i) => {
  const blend = Math.max(0, Math.min(1, i / fs - 1.5));
  return (1 - blend) * v + blend * after[i];
});
const jump = perceptual(abrupt, { boundaries: [0, 2, 4] }), fade = perceptual(eased, { boundaries: [2] });
assert.equal(jump.sectionBoundaries, 1);
assert(jump.sectionJolt > fade.sectionJolt + 25, 'the supplied arrangement boundary distinguishes the abrupt cut from the fade');
assert.equal(perceptual(abrupt).sectionJolt, null, 'no arrangement boundary is not a clean score');

const harmonics = mix(...[1, 2, 3, 4, 5, 6].map((h) => tone(440 * h, 4, 0.1)));
assert(perceptual(brightTone).toyLikeTimbre > perceptual(harmonics).toyLikeTimbre + 30, 'narrow upper-mid resonance outranks a wider harmonic spectrum');
assert.equal(perceptual(brightTone, { instrument: false }).toyLikeTimbre, null);
for (const pcm of [tone(800, 0.04), tone(800, 2, 1e-6), new Float32Array(sec(2))]) {
  for (const id of Object.keys(PERCEPTUAL_METRICS)) assert.equal(perceptual(pcm)[id], null, id);
}

console.log('audio quality metrics: synthetic checks passed');

const drill = await withChrome(async (run) => {
  const paletteControls = await run(`(async () => {
    const { song } = await import('/test/audio-quality-page.js');
    const { Engine } = await import('/js/engine.js');
    const results = [];
    for (const style of ['dnb', 'euphoric', 'deephouse']) {
      async function render(control, value, bass = false) {
        const s = song(style, 42); s.params.stab.voice = 1;
        if (control) s.params[bass ? 'acid' : 'stab'][control] = value;
        const ctx = new OfflineAudioContext(1, 48000, 48000), e = new Engine(ctx, s, { realtime: false });
        e.out.disconnect();
        e.ch[bass ? 'acid' : 'stab'].input = ctx.destination;
        if (bass) e.acidVoice(0.02, { n: 0, a: false }, false, false, e.stepDur);
        else e.stab(0.02, 0.7);
        return (await ctx.startRendering()).getChannelData(0);
      }
      const chord = await render();
      const changes = [['env', 0.95, false], ['detune', 37, false], ['tine', 0, false]];
      if (style !== 'dnb') changes.push(['drive', 0, true], ['drive', 0.8, true]);
      for (const [control, value, bass] of changes) {
        const before = bass ? await render(null, null, true) : chord, after = await render(control, value, bass);
        let energy = 0, error = 0;
        for (let i = 0; i < before.length; i++) { energy += before[i] ** 2; error += (after[i] - before[i]) ** 2; }
        results.push({ style, control, value, relativeRms: Math.sqrt(error / energy), finite: after.every(Number.isFinite) });
      }
    }
    return results;
  })()`);
  for (const row of paletteControls) assert(row.finite && row.relativeRms > 0.01, `Palette control changes native PCM: ${JSON.stringify(row)}`);
  console.log('palette controls: KEYS ENV/DETUNE/TINE and pocket-bass DRIVE change native PCM');
  const wake = await run(`(async () => {
    const { defaultState } = await import('/js/state.js');
    const { Engine } = await import('/js/engine.js');
    async function render(style, rate, stale, recoveryDelay, deviceLead) {
      const ctx = new OfflineAudioContext(1, rate, rate), state = defaultState();
      state.artist = { style };
      Object.assign(state.master, { revLevel: 0, dlyLevel: 0, room: 0 });
      Object.assign(state.params.kick, { decay: 0.1, rumble: 0, rev: 0, dly: 0 });
      const e = new Engine(ctx, state, { realtime: false, trackQueuedNotes: true });
      const at = 128 * 70 / rate;
      if (stale) {
        e.kick(at - (deviceLead ? 0.032 : 0.0125), 0.9);
        e.kick(at + 0.22, 0.9);
      }
      const suspended = ctx.suspend(at);
      const rendered = ctx.startRendering();
      await suspended;
      const now = ctx.currentTime;
      e.discardQueuedNotes(now, now + recoveryDelay, now - deviceLead);
      e.kick(now + recoveryDelay, 0.9);
      await ctx.resume();
      const pcm = (await rendered).getChannelData(0);
      const rms = (from, to) => {
        let energy = 0;
        const start = Math.round((now + from) * rate), end = Math.round((now + to) * rate);
        for (let i = start; i < end; i++) energy += pcm[i] ** 2;
        return Math.sqrt(energy / (end - start));
      };
      return {stale: rms(deviceLead ? 0.002 : 0, recoveryDelay === 0.005 ? 0.024 : recoveryDelay),
        corrected: rms(recoveryDelay + 0.02, recoveryDelay + 0.06), queued: rms(0.32, 0.37)};
    }
    async function closeRamp() {
      const rate = 48000, ctx = new OfflineAudioContext(1, rate, rate);
      const e = new Engine(ctx, defaultState(), { realtime: false, trackQueuedNotes: true });
      const frame = 128 * 70, at = frame / rate;
      const probe = ctx.createConstantSource();
      probe.connect(e.wakeGain ?? e.out);
      probe.start();
      e.startSource(ctx.createOscillator(), at - 0.01);
      const suspended = ctx.suspend(at), rendered = ctx.startRendering();
      await suspended;
      e.discardQueuedNotes(ctx.currentTime, at + 0.185, ctx.currentTime);
      await ctx.resume();
      const pcm = (await rendered).getChannelData(0);
      const count = rate * 0.002;
      const close = pcm.subarray(frame - 1, frame + count + 2);
      return {before:close[0], first:close[1], middle:close[count / 2 + 1], end:close[count + 1],
        maxJump:close.slice(1).reduce((max, x, i) => Math.max(max, Math.abs(x - close[i])), 0)};
    }
    const results = [];
    for (const [style, rate] of [['minimal', 44100], ['hardtechno', 48000]]) for (const [delay, deviceLead] of [[0.005, 0], [0.185, 0], [0.185, 0.055]]) {
      const recovered = await render(style, rate, true, delay, deviceLead), clean = await render(style, rate, false, delay, deviceLead);
      results.push({label: style + ' +' + delay + 's with device lead ' + deviceLead + 's', recovered, clean});
    }
    return {results, close:await closeRamp()};
  })()`);
  for (const {label, recovered, clean} of wake.results) {
    near(recovered.stale, clean.stale, 0.005, `${label}: wake must not output the buffered stale kick`);
    near(recovered.queued, clean.queued, 1e-4, `${label}: wake must cancel the future stale kick`);
    assert(clean.corrected > 0.02, `${label}: the corrected kick is audible`);
    near(recovered.corrected / clean.corrected, 1, 0.05, `${label}: the corrected kick survives even at the earliest recovery deadline`);
  }
  const {before, first, middle, end, maxJump} = wake.close;
  assert(before > 0.5, 'The wake fade probe is audible before resync');
  near(first / before, 1, 0.015, 'The wake gate does not jump at resync');
  near(middle / before, 0.5, 0.015, 'The wake gate fades linearly to silence');
  near(end / before, 0, 0.015, 'The wake gate is closed after 2 ms');
  assert(maxJump / before < 0.015, 'No sample in the wake fade jumps beyond the ramp slope');
  console.log('Native Club wake gate: linear 2 ms close without a gain step');
  console.log('Native Club wake: buffered and queued stale kicks silent, corrected kick intact');
  const switches = await run(`(async () => {
    const { freshSong } = await import('/js/state.js');
    const { Engine, MASTER_TONE } = await import('/js/engine.js');
    const results = [];
    for (const [from, to, stop, handoff] of [['hardtechno', 'minimal', true], ['hardtechno', 'minimal', false], ['hardtechno', 'pop', true], ['hardtechno', null, true], ['minimal', 'minimal', false], ['hardtechno', 'minimal', false, true]]) {
      const ctx = new OfflineAudioContext(2, 96000, 48000), state = freshSong(from, 42);
      state.artist = { style: from, seed: 42 };
      const e = new Engine(ctx, state, { realtime: false });
      e.tonalSweep = () => {};
      if (from === 'hardtechno') e.hardSection(0.05, 5, 0, 4, 5);
      const paused = ctx.suspend(0.8), rendering = ctx.startRendering();
      await paused;
      if (stop) e.panic();
      e.state = freshSong(to || 'minimal', 42);
      if (to) e.state.artist = { style: to, seed: 42 }; else delete e.state.artist;
      if (handoff) e.handoffIn(1.2); else e.applyAll();
      await ctx.resume();
      await rendering;
      results.push({ from, to, stop, handoff: !!handoff, gain: e.tonePres.gain.value, expected: MASTER_TONE[to]?.[2] || 0 });
    }
    return results;
  })()`);
  for (const result of switches) near(result.gain, result.expected, 1e-5, `genre-switch presence ${JSON.stringify(result)}`);
  console.log('audio quality: native mid-bar genre switches clear Hard Techno presence ramps (6 cases)');
  const joinErrors = await run(`(async () => {
    const { song } = await import('/test/audio-quality-page.js');
    const { Engine, Sequencer } = await import('/js/engine.js');
    const s = song('drill', 7), bar = s.chain.indexOf('CDG') + 1, rate = 48000, sd = (48 * 128) / rate;
    async function gainCurve(step) {
      const ctx = new OfflineAudioContext(1, (19 - step) * sd * rate, rate);
      const secGain = ctx.createGain(), source = ctx.createConstantSource();
      source.connect(secGain).connect(ctx.destination);
      source.start();
      const seq = new Sequencer({ secGain, stepDur: sd, sectionGain: Engine.prototype.sectionGain, breakOpen() {} }, s);
      seq.startAt(bar * 16 + step, sd);
      if (step === 0) seq.advanceBar(bar * 16, sd);
      seq.advanceBar((bar + 1) * 16, (17 - step) * sd);
      return (await ctx.startRendering()).getChannelData(0);
    }
    const full = await gainCurve(0), errors = [];
    for (const step of [2, 10, 14, 15]) {
      const joined = await gainCurve(step);
      let max = 0;
      for (let i = sd * rate; i < joined.length; i++) max = Math.max(max, Math.abs(joined[i] - full[i + step * sd * rate]));
      errors.push(max);
    }
    return errors;
  })()`);
  for (const [i, error] of joinErrors.entries()) near(error, 0, 1e-5, `Drill fill join ${i} matches uninterrupted native gain`);
  const slides = await run(`(async () => {
    const { defaultState } = await import('/js/state.js');
    const { Engine } = await import('/js/engine.js');
    const fs = 48000, t = 0.2, sd = 0.1;
    async function dry(style, target, includeOctave, replayStyle, kickAt) {
      const ctx = new OfflineAudioContext(1, fs / 2, fs), state = defaultState();
      state.artist = { style };
      const e = new Engine(ctx, state, { realtime: false });
      e.replay808Style = replayStyle;
      if (e.hardTechno !== (style === 'hardtechno')) throw new Error('808 replay style must not switch the master processing');
      e.out.disconnect();
      e.ch.acid.input.connect(ctx.destination);
      e.eight08(t - sd, { n: 0, a: true }, sd, true, false);
      const prev = e.mono;
      if (!includeOctave) prev.octave.disconnect();
      e.eight08(t, { n: 5, a: true, ...target }, sd, false, true, kickAt);
      if (e.mono !== prev) throw new Error('808 slide must keep the same oscillators and envelope');
      return (await ctx.startRendering()).getChannelData(0);
    }
    const compare = (a, b, start, end) => {
      let sq = 0;
      for (let i = Math.round(start * fs); i < Math.round(end * fs); i++) sq += (a[i] - b[i]) ** 2;
      return Math.sqrt(sq / ((end - start) * fs));
    };
    const trap = await dry('trap', null, true), drill = await dry('drill', null, true);
    const trapSub = await dry('trap', null, false), drillSub = await dry('drill', null, false);
    const trapRepeat = await dry('trap', { n: 0 }, true), drillRepeat = await dry('drill', { n: 0 }, true);
    const drillReplay = await dry('trap', null, true, 'drill'), trapReplay = await dry('drill', null, true, 'trap');
    const afterKick = await dry('drill', null, true, undefined, t - 0.003);
    const replayAfterKick = await dry('trap', null, true, 'drill', t - 0.003);
    await dry('trap', null, true, 'hardtechno');
    return {
      before: compare(trap, drill, 0, t),
      slide: compare(trap, drill, t, t + sd),
      settled: compare(trap, drill, 0.39, 0.45),
      sub: compare(trapSub, drillSub, 0, 0.5),
      repeat: compare(trapRepeat, drillRepeat, 0, 0.5),
      drillReplay: compare(drill, drillReplay, 0, 0.5),
      trapReplay: compare(trap, trapReplay, 0, 0.5),
      kickReplay: compare(afterKick, replayAfterKick, 0, 0.5),
      kickSub: compare(drillSub, await dry('drill', null, false, undefined, t - 0.003), 0, 0.5),
      trapKick: compare(trap, await dry('trap', null, true, undefined, t - 0.003), 0, 0.5),
      distantKick: compare(drill, await dry('drill', null, true, undefined, t - 0.06), 0, 0.5),
      beforeKickFlick: compare(drill, afterKick, 0, t),
      kickFlick: compare(drill, afterKick, t + 0.042, t + sd),
    };
  })()`);
  assert(slides.slide > 0.008, `Drill accent must change the octave during a slide: ${JSON.stringify(slides)}`);
  for (const key of ['before', 'sub', 'repeat', 'drillReplay', 'trapReplay']) near(slides[key], 0, 1e-6, `Drill 808 ${key} stays unchanged`);
  for (const key of ['kickReplay', 'kickSub', 'trapKick', 'distantKick', 'beforeKickFlick']) near(slides[key], 0, 1e-6, `Drill 808 ${key} stays unchanged`);
  assert(slides.kickFlick > 0.008, `The kick should move the octave flick, not the 808 note: ${JSON.stringify(slides)}`);
  assert(slides.settled < slides.slide * 0.035, `Drill octave should converge to the original slide: ${JSON.stringify(slides)}`);
  const harpPeak = await run(`(async () => {
    const { song, render } = await import('/test/audio-quality-page.js');
    const { router } = await import('/js/stems.js');
    const r = router(['hook']);
    try {
      const audio = await render(song('drill', 3), 62, 66, { tail: 0.5, onContext: r.onContext, onEngine: r.onEngine });
      let peak = 0;
      for (let ch = 0; ch < 2; ch++) for (const x of audio.getChannelData(ch)) peak = Math.max(peak, Math.abs(x));
      return 20 * Math.log10(peak);
    } finally { r.restore(); }
  })()`);
  assert(harpPeak > -6 && harpPeak <= -1, `Drill's upper harp accents leave 1 dB of stem headroom (peak ${harpPeak.toFixed(2)} dBFS)`);
  return run("import('/test/audio-quality-page.js').then(m => m.measure('drill', 1234))");
});
if (drill) {
  const collision = drill.stems.kickBass;
  assert(collision && collision.collisionP90Db < 0, `kick/808 overlap uses rendered kicks: ${JSON.stringify(collision)}`);
  const kick = drill.stems.stems.find((s) => s.id === 'kick');
  assert(Number.isFinite(drill.perceptual.harshTransients) && Number.isFinite(kick.perceptual.lackOfSmoothness));
  assert.equal(kick.perceptual.toyLikeTimbre, null);

  const normal = report('fast', [1234], [drill], null, {});
  const changed = { ...drill, seed: 42, perceptual: { ...drill.perceptual, harshTransients: 100 } };
  const more = report('fast', [42, 1234], [drill, changed], null, {});
  assert.deepEqual(more.styles.drill.perceptual.mix.harshTransients, { n: 2, p50: 100, worst: 100, worstSeed: 42 });
  assert.equal(more.styles.drill.perceptual.parts.kick.toyLikeTimbre.n, 0);
  assert.equal(normal.styles.drill.seeds[1234].stems.find((s) => s.id === 'kick').perceptual.lackOfSmoothness, kick.perceptual.lackOfSmoothness);
  const extreme = report('fast', [1234], [{ ...changed, seed: 1234 }], null, {});
  assert(!normal.perceptual.gating && !('harshTransients' in normal.checks));
  assert.equal(extreme.verdict, normal.verdict);
  assert.deepEqual(extreme.reasons, normal.reasons);
  assert.equal(baselineOf(extreme), baselineOf(normal));
  assert(compare(normal, extreme).ok, 'advisory changes are not repeat-check failures');
  console.log('audio quality metrics: render and non-gating report checks passed');
} else {
  console.log('audio quality metrics: kick window test skipped (Chrome unavailable)');
}
