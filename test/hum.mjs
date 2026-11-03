import assert from 'node:assert/strict';
import { pitchTrack, segmentNotes, snapToScale, detectKey, quantize, hookFromNotes, analyzeHum, sliceChops, pickChop, tuneChops, noteLabel, tuningOffset, fillBars, fitProg, livePitch, prepareHum, hookFor } from '../js/hum.js';
import { CHORDS } from '../js/params.js';

const SR = 48000;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
// A hummed note: fundamental + 2 weaker harmonics, light vibrato, breath noise, soft attack/release.
// `parts` = [[t0, t1, midiStart, midiEnd?]]; a midiEnd glides linearly across the part.
function hum(parts, total, { noise = 0.01, seed = 7, sr = SR } = {}) {
  const SR = sr, out = new Float32Array(Math.ceil(total * SR));
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  for (let i = 0; i < out.length; i++) out[i] = rand() * noise;
  let ph = 0;
  for (const [t0, t1, m0, m1 = m0] of parts) {
    const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR);
    for (let i = i0; i < i1; i++) {
      const u = (i - i0) / (i1 - i0), t = i / SR;
      const f = hz(m0 + (m1 - m0) * u) * 2 ** ((0.15 * Math.sin(2 * Math.PI * 5.5 * t)) / 12);
      ph += f / SR;
      const env = Math.min(1, (i - i0) / (0.02 * SR), (i1 - i) / (0.03 * SR));
      out[i] += 0.5 * env * (Math.sin(2 * Math.PI * ph) + 0.4 * Math.sin(4 * Math.PI * ph) + 0.15 * Math.sin(6 * Math.PI * ph));
    }
  }
  return out;
}
const C4 = 60, E4 = 64, G4 = 67;
const hookNotes = (hook) => hook.s.map((x, i) => (x ? [i, x[0], x[1]] : null)).filter(Boolean);

// Pitch tracking: a steady A3 reads as MIDI 57 (and an off-tune note within 40 cents).
{
  const { frames } = pitchTrack(hum([[0.05, 0.6, 57]], 0.7), SR);
  const voiced = frames.filter((f) => f.midi !== null).map((f) => f.midi);
  assert(voiced.length > 40, 'mostly voiced');
  const avg = voiced.reduce((a, b) => a + b, 0) / voiced.length;
  assert(Math.abs(avg - 57) < 0.2, `A3 tracked at ${avg}`);
  const sharp = segmentNotes(pitchTrack(hum([[0.05, 0.5, 60.4]], 0.6), SR));
  assert.equal(sharp.length, 1);
  assert(Math.abs(sharp[0].midi - 60.4) < 0.2, '40 cents sharp is measured, not rounded');
  assert.equal(snapToScale(sharp[0].midi, 0, [0, 2, 4, 5, 7, 9, 11]), 60, 'and snaps back to C');
  // Low male hum (G2) and high whistle-ish (C6) both track.
  for (const m of [43, 84]) {
    const n = segmentNotes(pitchTrack(hum([[0.05, 0.5, m]], 0.6), SR));
    assert.equal(n.length, 1, `one note at ${m}`);
    assert(Math.abs(n[0].midi - m) < 0.3, `${m} tracked at ${n[0].midi}`);
  }
  // 44.1 kHz input too.
  const n44 = segmentNotes(pitchTrack(hum([[0.05, 0.5, 62]], 0.6, { sr: 44100 }), 44100));
  assert.equal(n44.length, 1);
  assert(Math.abs(n44[0].midi - 62) < 0.2, `44.1 kHz D4 at ${n44[0].midi}`);
}

// The headline case: C-E-G hummed at 120 BPM (a 16th = 125 ms) lands as C-E-G on steps 0, 4, 8.
{
  const data = hum([[0.3, 0.7, C4], [0.8, 1.2, E4], [1.3, 1.75, G4]], 2.2);
  const r = analyzeHum(data, SR, { bpm: 120, key: 0, scale: 'major', scaleNotes: [0, 2, 4, 5, 7, 9, 11] });
  assert.equal(r.raw.length, 3, `three notes, got ${r.raw.map((n) => noteLabel(n.midi))}`);
  assert.deepEqual(r.raw.map((n) => noteLabel(n.midi)), ['C4', 'E4', 'G4']);
  assert.deepEqual(r.notes.map((n) => n.step), [0, 4, 8], 'on the 16th grid from the first note');
  assert.deepEqual(r.notes.map((n) => n.len), [3, 3, 4]);
  assert.deepEqual(hookNotes(r.hook).map(([i, n]) => [i, n]), [[0, 0], [4, 4], [8, 7], [16, 0], [20, 4], [24, 7]], 'C E G above the key root, answered in bar 2');
  assert.equal(r.answered, true);
  assert.equal(r.hook.h, 1, 'marked as sung');
  // Key detection agrees: C major.
  assert.deepEqual([r.detected.key, r.detected.scale], [0, 'major']);
}

// Legato with glides (no gaps): C glides to E glides to G, notes still on steps 0, 4, 8.
{
  const data = hum([[0.2, 0.66, C4], [0.66, 0.72, C4, E4], [0.72, 1.16, E4], [1.16, 1.22, E4, G4], [1.22, 1.7, G4]], 2);
  const r = analyzeHum(data, SR, { bpm: 120, key: 0, scale: 'major', scaleNotes: [0, 2, 4, 5, 7, 9, 11] });
  assert.deepEqual(r.raw.map((n) => noteLabel(n.midi)), ['C4', 'E4', 'G4'], 'glides are not notes');
  assert.deepEqual(r.notes.map((n) => n.step), [0, 4, 8]);
}

// Repeated same pitch separated by short breaths stays as separate notes.
{
  const data = hum([[0.1, 0.32, 62], [0.37, 0.6, 62], [0.65, 0.9, 65]], 1.1);
  const n = segmentNotes(pitchTrack(data, SR));
  assert.deepEqual(n.map((x) => noteLabel(x.midi)), ['D4', 'D4', 'F4']);
}

// Snap to the song's key: C# and F# hummed in C minor move to neighbours that are in the scale.
{
  const minor = [0, 2, 3, 5, 7, 8, 10];
  assert.equal(snapToScale(61.1, 0, minor), 62);
  assert.equal(snapToScale(60.9, 0, minor), 60);
  assert.equal(snapToScale(66, 0, minor), 65, 'ties go down');
  assert.equal(snapToScale(64, 0, minor), 63, 'E becomes Eb in C minor');
  assert.equal(snapToScale(64, 9, minor), 64, 'E is the fifth of A minor');
  // In A minor, a hummed E4 is 7 semitones above A3 (the hook root for key A is MIDI 57).
  const h = hookFromNotes([{ step: 0, len: 2, midi: 64, rms: 1 }], { key: 9, scale: minor });
  assert.equal(h.s[0][0], 7);
}

// Key detection: A-C-E-A is A minor; G-B-D-G is G major.
{
  const mk = (ms) => ms.map((m, i) => ({ start: i * 0.4, end: i * 0.4 + 0.35, midi: m }));
  assert.deepEqual((({ key, scale }) => [key, scale])(detectKey(mk([57, 60, 64, 69, 64, 60, 57]))), [9, 'minor']);
  assert.deepEqual((({ key, scale }) => [key, scale])(detectKey(mk([55, 59, 62, 67, 62, 59, 55]))), [7, 'major']);
}

// Quantize: collisions move to the next step, lengths never overlap, long hums read at double time.
{
  const notes = [{ start: 0, end: 0.1, midi: 60 }, { start: 0.05, end: 0.2, midi: 62 }, { start: 0.5, end: 2, midi: 64 }];
  const q = quantize(notes, { bpm: 120 });
  assert.deepEqual(q.notes.map((n) => [n.step, n.len]), [[0, 1], [1, 1], [4, 12]]);
  const long = Array.from({ length: 8 }, (_, i) => ({ start: i * 1, end: i * 1 + 0.5, midi: 60 + i }));
  const ql = quantize(long, { bpm: 120 });
  assert.equal(ql.scale, 0.5, 'an 8-second hum is read at double time');
  assert.deepEqual(ql.notes.map((n) => n.step), [0, 4, 8, 12, 16, 20, 24, 28]);
  assert(ql.notes.every((n) => n.step + n.len <= 32));
  const qf = quantize(long, { bpm: 160 });
  assert.equal(qf.notes.length, 8, 'a fast song keeps the end of an 8-second hum');
  assert(qf.notes.every((n) => n.step + n.len <= 32));
}

// Register: a low hum is raised by octaves into the lead's range; the melody shape is kept.
{
  const h = hookFromNotes([{ step: 0, len: 2, midi: 36 }, { step: 4, len: 2, midi: 43 }], { key: 0, scale: [0, 2, 4, 5, 7, 9, 11] });
  assert.deepEqual(hookNotes(h).map((x) => x[1]), [0, 7]);
}

// Silence and noise give no notes (so the UI can ask to try again), not garbage.
{
  const quiet = new Float32Array(SR);
  assert.deepEqual(analyzeHum(quiet, SR, { bpm: 120 }).notes, []);
  let s = 3;
  const noise = Float32Array.from({ length: SR }, () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 0.6);
  assert(analyzeHum(noise, SR, { bpm: 120 }).notes.length <= 1, 'white noise is not a melody');
}

// Voice chops: four sung syllables become four chops, each with its pitch.
{
  const data = hum([[0.1, 0.4, 57], [0.6, 0.9, 60], [1.1, 1.45, 64], [1.6, 2.0, 62]], 2.2);
  const chops = sliceChops(data, SR);
  assert.equal(chops.length, 4);
  assert.deepEqual(chops.map((c) => Math.round(c.midi)), [57, 60, 64, 62]);
  chops.forEach((c, i) => assert(Math.abs(c.start - [0.1, 0.6, 1.1, 1.6][i]) < 0.04, `chop ${i} starts at its onset (${c.start})`));
  // Tuning: in C minor, the E chop's home note is Eb.
  assert.deepEqual(tuneChops(chops, 0, [0, 2, 3, 5, 7, 8, 10]).map((c) => c.note), [56, 60, 63, 62]);
  // Playing note G4 picks a nearby chop and retunes it exactly.
  const p = pickChop(chops, 67);
  assert.equal(Math.round(chops[p.index].midi + 12 * Math.log2(p.rate)), 67);
  assert.equal(pickChop(chops, 64).index, 2, 'the E chop sings E');
}

// One long breath with three pitches splits into three chops; eight syllables keep the best six.
{
  const legato = sliceChops(hum([[0.1, 0.6, 60], [0.6, 1.1, 63], [1.1, 1.6, 67]], 1.8), SR);
  assert.equal(legato.length, 3);
  assert.deepEqual(legato.map((c) => Math.round(c.midi)), [60, 63, 67]);
  const many = sliceChops(hum(Array.from({ length: 8 }, (_, i) => [0.1 + i * 0.4, 0.4 + i * 0.4, 60 + i]), 3.4), SR);
  assert.equal(many.length, 6);
  assert(many.every((c, i) => !i || c.start > many[i - 1].start), 'kept chops stay in time order');
  // A single short word still gives at least three playable pieces.
  const one = sliceChops(hum([[0.1, 1.0, 62]], 1.2), SR);
  assert(one.length >= 3 && one.length <= 6, `one word -> ${one.length} chops`);
}

console.log('hum: ok');

// Off-pitch singer: C-E-G hummed 40 cents flat with per-note wobble still reads C-E-G, also in A minor.
{
  const data = hum([[0.3, 0.7, C4 - 0.4], [0.8, 1.2, E4 - 0.28], [1.3, 1.75, G4 - 0.52]], 2.2);
  const prep = prepareHum(data, SR);
  assert(Math.abs(prep.tuning + 0.4) < 0.1, `tuning ${prep.tuning}`);
  assert.deepEqual(prep.raw.map((n) => noteLabel(n.midi)), ['C4', 'E4', 'G4']);
  const am = hookFor(prep, { bpm: 120, key: 9, scaleNotes: [0, 2, 3, 5, 7, 8, 10] });
  assert.deepEqual(am.notes.map((n) => n.step), [0, 4, 8]);
  assert.deepEqual(hookNotes(am.hook).slice(0, 3).map(([, n]) => ((n + 9) % 12 + 12) % 12), [0, 4, 7], 'C E G pitch classes in A minor');
  assert(Math.abs(tuningOffset([{ start: 0, end: 1, midi: 60.45 }, { start: 1, end: 2, midi: 63.55 }]) - 0.5) < 0.06, 'wraps across the semitone');
}

// Call and response only for one-bar motifs.
{
  const long = [{ step: 0, len: 4, midi: 60 }, { step: 12, len: 8, midi: 64 }];
  assert.equal(fillBars(long).length, 2, 'a 2-bar phrase is left alone');
  const short = fillBars([{ step: 0, len: 2, midi: 60, rms: 1 }, { step: 4, len: 4, midi: 62, rms: 1 }]);
  assert.deepEqual(short.map((n) => n.step), [0, 4, 16, 20]);
  assert(short[2].rms < 1, 'the answer is softer');
}

// Progression fit: C-E-G over C major chords fits; over chords without those tones it does not.
{
  const hook = { s: Array.from({ length: 32 }, () => 0) };
  hook.s[0] = [0, 4, 1]; hook.s[4] = [4, 4, 1]; hook.s[8] = [7, 4, 1];
  const fits = [{ r: 0, c: 7 }, { r: 0, c: 7 }], clashes = [{ r: 1, c: 6 }, { r: 6, c: 6 }];
  assert.equal(fitProg(hook, fits, CHORDS), 1);
  assert(fitProg(hook, clashes, CHORDS) < 0.2);
  assert.equal(fitProg(null, fits, CHORDS), 0);
}

// Live pitch on one analyser-sized frame.
{
  const buf = hum([[0, 0.05, 64]], 0.043).subarray(0, 2048);
  const m = livePitch(buf, SR);
  assert(m !== null && Math.abs(m - 64) < 0.3, `live E4 at ${m}`);
  assert.equal(livePitch(new Float32Array(2048).map(() => (Math.random() * 2 - 1) * 0.05), SR), null, 'noise is not a note');
}
console.log('hum refine: ok');
