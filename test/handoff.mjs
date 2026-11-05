import assert from 'node:assert/strict';
import { handoffStep, reanchor, MIN_LEAD, PHRASE_WAIT } from '../js/handoff.js';

const sd = (bpm) => 60 / bpm / 4;

// Mid-bar at 132 BPM: the next bar is a phrase end too far away? Bar 1 starts at step 16.
{
  const r = handoffStep({ abs: 5, lead: 0.1, stepSec: sd(132) });
  assert.equal(r.step % 16, 0, 'switch on a downbeat');
  assert.equal(r.step, 16, 'next bar (the bar-4 phrase end is > 2 s away)');
  assert.ok(r.at >= MIN_LEAD);
  assert.equal(r.from, 5, 'transition starts right away when the bar is short');
}
// Too close to the next bar: skip to the one after.
{
  const r = handoffStep({ abs: 15, lead: 0.05, stepSec: sd(132) });
  assert.equal(r.step, 32);
  assert.equal(r.from, 16, 'a one-bar transition');
  assert.ok(Math.abs(r.at - (0.05 + 17 * sd(132))) < 1e-9);
}
// A phrase end within reach wins over the plain next bar (fast tempo).
{
  const r = handoffStep({ abs: 16 * 2 + 11, lead: 0.1, stepSec: sd(174) });
  assert.equal(r.step, 64, 'bar 4 phrase end is < 2 s away at 174');
  assert.ok(r.at <= PHRASE_WAIT);
}
// ...but not when it is far.
{
  const r = handoffStep({ abs: 16 * 1 + 2, lead: 0.1, stepSec: sd(132) });
  assert.equal(r.step, 32);
}
// Phrases count from where the playing song started, not from the transport's step 0.
{
  const r = handoffStep({ abs: 16 * 5 + 10, lead: 0.1, stepSec: sd(174), origin: 16 * 3 });
  assert.equal(r.step, 16 * 7, 'phrase relative to origin 48 → 112');
}
// Exactly on a downbeat that has not been scheduled yet but is too close: next bar.
{
  const r = handoffStep({ abs: 32, lead: 0.1, stepSec: sd(120) });
  assert.equal(r.step, 48);
}
// Slow tempo: never waits more than MIN_LEAD + one bar.
for (const bpm of [70, 90, 120, 140, 174]) for (let abs = 0; abs < 64; abs++) {
  const r = handoffStep({ abs, lead: 0.12, stepSec: sd(bpm) });
  assert.equal(r.step % 16, 0);
  assert.ok(r.at >= MIN_LEAD - 1e-9, `${bpm} ${abs}`);
  assert.ok(r.at <= Math.max(PHRASE_WAIT, MIN_LEAD + 16 * sd(bpm)) + 1e-9, `${bpm} ${abs} waits ${r.at}`);
  assert.ok(r.step - r.from <= 16 && r.from >= abs);
}
// Tempo snap on the switch step keeps that step's time and moves the rest onto the new grid.
{
  const o = 1000, step = 64, a = 132, b = 90;
  const o2 = reanchor(o, step, a, b);
  assert.ok(Math.abs((o + step * 15000 / a) - (o2 + step * 15000 / b)) < 1e-9, 'switch step keeps its time');
  assert.ok(Math.abs((o2 + (step + 1) * 15000 / b) - (o + step * 15000 / a) - 15000 / b) < 1e-9, 'next step is one new 16th later');
  assert.equal(reanchor(o, step, a, a), o);
}
console.log('handoff ok');
