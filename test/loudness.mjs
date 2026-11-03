// Loudness: BS.1770 meter against known signals, then (in headless Chrome) a fast check that every genre's
// full song still lands on its target. Full table: node scripts/loudness.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kWeighting, loudness, truePeak, dbtp, samplePeakDb, targetFor, MAKEUP_DB, LOUDNESS_TARGET } from '../js/loudness.js';
import { STYLES } from '../js/state.js';
import { withChrome } from './chrome.mjs';

const close = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const fs = 48000;
// Faded in/out so the edges don't ring (an abrupt start has real inter-sample overshoot).
const sine = (f, db, secs = 10, ph = 0, rate = fs) => Float32Array.from({ length: Math.round(secs * rate) }, (_, i, n = Math.round(secs * rate)) =>
  10 ** (db / 20) * Math.sin((2 * Math.PI * f * i) / rate + ph) * Math.min(1, i / 2400, (n - 1 - i) / 2400));
const cat = (...xs) => { const o = new Float32Array(xs.reduce((a, x) => a + x.length, 0)); let k = 0; for (const x of xs) { o.set(x, k); k += x.length; } return o; };

// K-weighting at 48 kHz matches the coefficient tables in BS.1770-4.
const [shelf, hp] = kWeighting(48000);
[1.53512485958697, -2.69169618940638, 1.19839281085285].forEach((v, i) => close(shelf.b[i], v, 1e-9, `shelf b${i}`));
[-1.69065929318241, 0.73248077421585].forEach((v, i) => close(shelf.a[i], v, 1e-9, `shelf a${i + 1}`));
[-1.99004745483398, 0.99007225036621].forEach((v, i) => close(hp.a[i], v, 1e-9, `hp a${i + 1}`));

// A 1 kHz sine at -20 dBFS peak: mean square -23.01 dB, K-weighting adds +0.69 dB at 1 kHz, the -0.691 offset
// takes it back, so one channel reads -23.0 LUFS and the same tone in both channels -20.0 LUFS.
const s20 = sine(1000, -20, 4);
close(loudness([s20], fs).integrated, -23.0, 0.05, '1 kHz -20 dBFS mono');
close(loudness([s20, s20], fs).integrated, -20.0, 0.05, '1 kHz -20 dBFS stereo');
// EBU Tech 3341 case 1/2: stereo 1 kHz at -23 / -33 dBFS reads -23 / -33 LUFS, at any sample rate.
const s23 = sine(1000, -23, 6);
close(loudness([s23, s23], fs).integrated, -23.0, 0.1, 'EBU 3341 #1');
close(loudness([sine(1000, -33, 6), sine(1000, -33, 6)], fs).integrated, -33.0, 0.1, 'EBU 3341 #2');
const s44 = sine(1000, -23, 6, 0, 44100);
close(loudness([s44, s44], 44100).integrated, -23.0, 0.1, '44.1 kHz');
// EBU Tech 3341 case 3: -36 / -23 / -36 dBFS for 10/60/10 s: the relative gate drops the quiet parts.
const g3 = cat(sine(1000, -36, 10), sine(1000, -23, 60), sine(1000, -36, 10));
close(loudness([g3, g3], fs).integrated, -23.0, 0.1, 'EBU 3341 #3 relative gate');
// EBU Tech 3341 case 4: -72 / -36 / -23 / -36 / -72 dBFS for 10/10/60/10/10 s: the -70 LUFS absolute gate drops the -72 parts.
const g4 = cat(sine(1000, -72, 10), sine(1000, -36, 10), sine(1000, -23, 60), sine(1000, -36, 10), sine(1000, -72, 10));
close(loudness([g4, g4], fs).integrated, -23.0, 0.1, 'EBU 3341 #4 absolute gate');
// EBU Tech 3341 case 5: -26 / -20 / -26 dBFS for 20/20.1/20 s reads -23 LUFS.
const g5 = cat(sine(1000, -26, 20), sine(1000, -20, 20.1), sine(1000, -26, 20));
close(loudness([g5, g5], fs).integrated, -23.0, 0.1, 'EBU 3341 #5');
assert.equal(loudness([new Float32Array(fs * 5)], fs).integrated, -Infinity, 'digital silence');

// True peak: a sine at fs/4 sampled at 45° shows every sample at -3 dB below its real peak.
const q = sine(12000, -6, 2, Math.PI / 4);
close(samplePeakDb([q]), -9.01, 0.02, 'fs/4 sample peak');
close(dbtp([q]), -6.0, 0.1, 'fs/4 true peak');
for (const f of [997, 5000, 15000]) close(dbtp([sine(f, -6, 2, 0.3)]), -6.0, 0.1, `${f} Hz true peak`);
assert(truePeak([q, sine(997, -1, 2)]) >= 10 ** (-1 / 20) - 1e-6, 'true peak takes the loudest channel');
console.log('loudness meter: BS.1770 / EBU 3341 cases pass');

// Every style has a target and a sane make-up gain.
for (const id of Object.keys(STYLES)) {
  assert([LOUDNESS_TARGET.club, LOUDNESS_TARGET.quiet, LOUDNESS_TARGET.classical].includes(targetFor(id)), `${id} target`);
  assert(Math.abs(MAKEUP_DB[id] ?? 0) <= 18, `${id} make-up gain`);
}

// The committed full-song table (scripts/loudness.mjs --write) is on target, and the engine still renders the
// same peak-section windows it was measured with: predicted = full-song LUFS + (window now - window then).
const base = JSON.parse(readFileSync(new URL('./loudness-baseline.json', import.meta.url), 'utf8'));
for (const id of Object.keys(STYLES)) {
  const b = base.styles[id];
  assert(b, `${id} is in test/loudness-baseline.json (run node scripts/loudness.mjs --write)`);
  close(b.lufs, targetFor(id), 1, `${id} full-song loudness in the baseline`);
  assert(b.tp <= LOUDNESS_TARGET.ceiling + 0.05, `${id} true peak ${b.tp} dBTP`);
}
const t0 = Date.now();
const now = await withChrome(async (runs) => {
  const ids = Object.keys(STYLES), out = {};
  let next = 0;
  await Promise.all(runs.map(async (run) => {
    await run(`import('/test/loudness-page.js').then((m) => { window.__m = m; })`);
    while (next < ids.length) { const id = ids[next++]; out[id] = await run(`window.__m.windowLoudness(${JSON.stringify(id)})`); }
  }));
  return out;
}, { pages: 4 });
if (!now) console.log('loudness: no Chrome found, genre check skipped');
else {
  const bad = [];
  for (const [id, w] of Object.entries(now)) {
    const b = base.styles[id], pred = b.lufs + (w - b.window), t = targetFor(id);
    if (Math.abs(pred - t) > 1.5) bad.push(`${id}: ~${pred.toFixed(1)} LUFS (target ${t}, window ${w.toFixed(2)} vs ${b.window.toFixed(2)})`);
  }
  assert(!bad.length, `genres drifted more than 1.5 LU from their loudness target:\n  ${bad.join('\n  ')}\nre-measure with node scripts/loudness.mjs --write`);
  console.log(`loudness: ${Object.keys(now).length} genres within ±1.5 LU of target (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
