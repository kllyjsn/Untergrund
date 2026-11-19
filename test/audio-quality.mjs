// js/audio-quality.js on synthetic signals with known answers (the measurements scripts/audio-benchmark.mjs gates on).
import assert from 'node:assert/strict';
import { analyzeMix, analyzeStems, ending, stereo, spectrum, loudnessRange, kHops, shaper, crest, limiter } from '../js/audio-quality.js';
import { analyzePerceptual, PERCEPTUAL_METRICS } from '../js/perceptual-audio.js';
import { clipCurve, satCurve } from '../js/dsp.js';
import { baselineOf, compare, report } from '../scripts/audio-benchmark.mjs';
import { withChrome } from './chrome.mjs';

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

const drill = await withChrome((run) => run("import('/test/audio-quality-page.js').then(m => m.measure('drill', 1234))"));
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
