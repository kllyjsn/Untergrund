import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { timeline, createSession, clockOf, keyRange, bestOctave, recordBest, HANDS } from '../js/practice.js';

// 60 BPM, 16 steps a bar: one step = 0.25 s, one bar = 4 s.
const raw = {
  bpm: 60, barLen: 16, bars: 3, sections: [{ at: 0, name: 'A' }, { at: 2, name: 'B' }],
  notes: [
    [0, 48, 8, 0.6, 'pno', 1], [0, 60, 4, 0.6, 'pno', 0], [0, 64, 4, 0.6, 'pno', 0], [0, 67, 4, 0.6, 'pno', 0], // C chord + bass
    [4, 62, 4, 0.6, 'pno', 0],
    [8, 43, 8, 0.6, 'pno', 1],
    [12, 64, 4, 0.6, 'pno', 0],
    [16, 65, 4, 0.6, 'pno', 0], [16, 41, 8, 0.6, 'pno', 1],
    [32, 72, 16, 0.6, 'pno', 0],
  ],
};
const close = (a, b, msg) => assert(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

// Timeline: chords grouped, seconds from the written tempo, hand filtering.
{
  const tl = timeline(raw, { hands: HANDS.both });
  assert.equal(tl.events.length, 6);
  assert.deepEqual(tl.events[0].want, [48, 60, 64, 67], 'a chord is one event');
  close(tl.events[1].t, 1, 'step 4 at 1 s');
  close(tl.events[0].notes[0].d, 2, 'duration in seconds');
  close(tl.end, 12, 'three bars');
  const right = timeline(raw, { hands: HANDS.right });
  assert.deepEqual(right.events[0].want, [60, 64, 67], 'right hand only');
  assert.deepEqual(right.events[2].want, [], 'a left-hand-only event has nothing to play');
  const left = timeline(raw, { hands: HANDS.left });
  assert.deepEqual(left.notes.filter((n) => n.target).map((n) => n.m), [48, 43, 41]);
  const b = timeline(raw, { from: 1, to: 2 });
  assert.deepEqual(b.events.map((e) => e.bar), [1], 'bar range');
  close(b.start, 4, 'range start'); close(b.end, 8, 'range end');
  const slow = clockOf({ ...raw, tempo: [[16, 2]] });
  close(slow(16), 4, 'before the change'); close(slow(20), 6, 'written ritenuto doubles each step');
  assert.deepEqual(keyRange(raw), [41, 72]);
  assert.deepEqual(keyRange({ notes: [[0, 61, 1, 1, 'pno', 0], [0, 70, 1, 1, 'pno', 0]] }), [60, 71], 'black ends widen to white keys');
  assert.equal(bestOctave(right), 5, 'computer keys reach the right hand');
}

// Wait mode: the clock stops at a chord until every note of it is played, in any order.
{
  const s = createSession(timeline(raw, { hands: HANDS.right }), { mode: 'wait', speed: 1, lead: 1 });
  close(s.pos, -1, 'lead-in');
  s.advance(5);
  close(s.pos, 0, 'held at the first chord');
  assert.equal(s.waiting().i, 0);
  assert.equal(s.press(67).ok, true);
  assert.equal(s.press(61).ok, false, 'wrong note');
  assert.equal(s.press(60).ok, true);
  s.advance(1);
  close(s.pos, 0, 'still waiting for the third note');
  const done = s.press(64);
  assert.equal(done.complete, true);
  assert.deepEqual(done.autos.map((a) => a.m), [48], 'the other hand plays with the chord');
  const a = s.advance(10);
  close(s.pos, 1, 'advances to the next note and waits');
  assert.deepEqual(a.autos, []);
  s.press(62);
  const b = s.advance(10);
  close(s.pos, 3, 'left-hand-only bar goes by on its own');
  assert.deepEqual(b.autos.map((x) => x.m), [43]);
  for (const m of [64, 65, 72]) { s.press(m); s.advance(10); }
  assert.equal(s.done, true, 'ends after the last bar');
  const sum = s.summary();
  assert.deepEqual([sum.hits, sum.wrong, sum.missed, sum.accuracy], [7, 1, 0, 88]);
  assert.deepEqual(sum.worst, [{ bar: 0, errors: 1 }]);
  assert.equal(sum.timing, null, 'wait mode does not score timing');
}

// Wait mode, both hands, speed scaling: at 50% the clock reaches a note twice as late.
{
  const s = createSession(timeline(raw), { mode: 'wait', speed: 0.5, lead: 2 });
  close(s.pos, -1, 'lead-in is in real seconds');
  s.advance(1);
  close(s.pos, -0.5, 'half speed');
  s.advance(1);
  for (const m of [48, 60, 64]) s.press(m);
  assert.equal(s.waiting()?.i, 0, 'a bass note is part of the chord with both hands');
  assert.equal(s.press(67).complete, true);
  s.advance(1);
  close(s.pos, 0.5, 'half speed after the chord');
}

// Play along: hits within the window, timing error in real ms, misses, wrong notes, chords.
{
  const s = createSession(timeline(raw, { hands: HANDS.right }), { mode: 'play', speed: 1, lead: 0, window: 0.2 });
  s.advance(0.05);
  for (const m of [64, 67, 60]) assert.equal(s.press(m).ok, true, 'chord notes in any order');
  assert.equal(s.press(60).ok, false, 'a note played twice is wrong the second time');
  s.advance(0.85); // 0.9 s: 100 ms early for the D at 1 s
  const early = s.press(62);
  assert.deepEqual([early.ok, early.err], [true, -100]);
  s.advance(2.2); // 3.1 s: E at 3 s is 100 ms late
  assert.equal(s.press(64).err, 100);
  const m = s.advance(1.5); // 4.6 s: the F at 4 s went by
  assert.deepEqual(m.missed.map((n) => n.m), [65]);
  assert.equal(s.press(65).ok, false, 'too late counts as wrong');
  s.advance(3.4); // 8.0 s
  assert.equal(s.press(72).err, 0);
  s.advance(5);
  assert.equal(s.done, true);
  const sum = s.summary();
  assert.deepEqual([sum.hits, sum.missed, sum.wrong, sum.total], [6, 1, 2, 7]);
  assert.equal(sum.accuracy, 67);
  assert.equal(sum.timing, Math.round((50 + 50 + 50 + 100 + 100 + 0) / 6), 'mean absolute timing error');
  assert.equal(sum.worst[0].bar, 1, 'bar 2 had the miss and the late wrong note');
}

// Speed scaling in play along: the window and the error are real time.
{
  const s = createSession(timeline(raw, { hands: HANDS.right }), { mode: 'play', speed: 0.5, lead: 0, window: 0.2 });
  s.advance(0.3); // 0.15 score s, 300 ms real: outside the window
  assert.equal(s.press(60).ok, false);
  const t = createSession(timeline(raw, { hands: HANDS.right }), { mode: 'play', speed: 0.5, lead: 0, window: 0.2 });
  t.advance(0.1);
  assert.equal(t.press(60).err, 100, '100 ms real at half speed');
  t.advance(1.9); // score 1.0: the D
  assert.equal(t.press(62).err, 0);
  assert.equal(createSession(timeline(raw), { speed: 0.1 }).speed, 0.25, 'speed floor 25%');
}

// Loop a bar range: it starts again from the top of the range and keeps counting.
{
  const s = createSession(timeline(raw, { hands: HANDS.right, from: 1, to: 2 }), { mode: 'wait', loop: true, lead: 0 });
  s.advance(1); s.press(65);
  const r = s.advance(10);
  assert.equal(r.looped, true);
  assert.equal(s.pass, 2);
  close(s.pos, 3, 'one second of lead-in before the loop');
  s.advance(10); s.press(65);
  assert.equal(s.summary().hits, 2);
}

// Best accuracy is kept per piece, only for real attempts.
{
  const sum = { accuracy: 80, judged: 20, wrong: 0, mode: 'wait', speed: 0.5 };
  let { store, best } = recordBest({}, 'x', sum);
  assert.equal(best, true);
  assert.equal(recordBest(store, 'x', { ...sum, accuracy: 70 }).best, false);
  assert.equal(recordBest(store, 'x', { ...sum, accuracy: 90 }).store.x.accuracy, 90);
  assert.equal(recordBest({}, 'x', { ...sum, judged: 3 }).best, false, 'three notes are not an attempt');
}

// Real scores: every piano piece builds a playable timeline in each hand.
for (const id of ['chopin-prelude-4', 'bach-prelude-c']) {
  const piece = JSON.parse(readFileSync(new URL(`../data/repertoire/${id}.json`, import.meta.url), 'utf8'));
  for (const hands of Object.values(HANDS)) {
    const tl = timeline(piece, { hands });
    assert(tl.events.length > 20 && tl.events.every((e, i) => i === 0 || e.t >= tl.events[i - 1].t), `${id} ordered`);
    const s = createSession(tl, { mode: 'wait', lead: 0 });
    for (let i = 0; i < 4000 && !s.done; i++) { for (const m of s.waiting()?.want || []) s.press(m); s.advance(0.5); }
    assert.equal(s.done, true, `${id} can be played through`);
    assert.equal(s.summary().accuracy, 100);
  }
}
console.log('practice ok');

// Wait mode: onsets a few ms apart (4 against 3) count in either order.
{
  const poly = { bpm: 60, barLen: 16, bars: 1, notes: [[0, 60, 1, 0.6, 'pno', 0], [0.2, 48, 1, 0.6, 'pno', 1], [8, 62, 1, 0.6, 'pno', 0]] };
  const tl = timeline(poly, { hands: HANDS.both });
  assert.equal(tl.events.length, 3, 'separate onsets 50 ms apart');
  const s = createSession(tl, { mode: 'wait', lead: 0 });
  s.advance(0.01);
  assert.equal(s.press(48).ok, true, 'the later note of the pair first');
  assert.equal(s.press(48).ok, null, 'a repeat is ignored');
  assert.equal(s.press(60).ok, true);
  assert.equal(s.press(62).ok, true, 'the next note can be played early in Wait');
  assert.equal(s.wrong.length, 0);
  s.advance(5);
  assert.equal(s.done, true);
}
