// js/audio-quality.js on synthetic signals with known answers (the measurements scripts/audio-benchmark.mjs gates on).
import assert from 'node:assert/strict';
import { analyzeMix, analyzeStems, ending, stereo, spectrum, loudnessRange, kHops } from '../js/audio-quality.js';

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

console.log('audio quality metrics: synthetic checks passed');
