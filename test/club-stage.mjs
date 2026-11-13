import assert from 'node:assert/strict';
import { crowdSlots, sectionMood, stepMs, gridOrigin, gridError, reactionBurst, BEAT_ANIMATIONS } from '../js/club-stage.js';

// Sections drive the room: drops/hooks light it up, breakdowns dim it, builds get restless.
assert.equal(sectionMood('DROP'), 'drop');
assert.equal(sectionMood('HOOK'), 'drop');
assert.equal(sectionMood('BUILD'), 'build');
assert.equal(sectionMood('FILL'), 'build');
assert.equal(sectionMood('BREAKDOWN'), 'break');
assert.equal(sectionMood('BRIDGE'), 'break');
assert.equal(sectionMood('INTRO'), 'break');
assert.equal(sectionMood('VERSE'), 'groove');
assert.equal(sectionMood(''), 'groove');
assert.equal(sectionMood(undefined), 'groove');

// Beat grid: a set that started 10 s ago (wall clock) maps onto the document timeline 10 s back.
assert.equal(gridOrigin(90_000, 100_000, 5_000), -5_000);
assert.equal(stepMs(120), 125);
assert.equal(stepMs(1000), 15000 / 240);
const bar = stepMs(120) * 16;
assert.equal(gridError(1_030, 1_000, bar), 30, 'late by 30 ms');
assert.equal(gridError(970, 1_000, bar), -30, 'early by 30 ms');
assert.equal(gridError(1_000 + bar * 7 + 12, 1_000, bar), 12, 'folds whole bars away');
assert.equal(gridError(1_000 + bar - 5, 1_000, bar), -5, 'just before the next bar is early, not a bar late');
// Every animation the grid pins must exist in the stylesheet.
const css = (await import('node:fs')).readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
for (const name of BEAT_ANIMATIONS) assert.match(css, new RegExp(`@keyframes ${name}\\b`), `${name} keyframes`);

// Bursts need several reactions from more than one person inside the window.
const t = 10_000;
assert.equal(reactionBurst([{ id: 'a', at: t }, { id: 'a', at: t }, { id: 'a', at: t }], t), false, 'one person spamming is not a moment');
assert.equal(reactionBurst([{ id: 'a', at: t - 100 }, { id: 'b', at: t - 50 }], t), false, 'two is not a burst');
assert.equal(reactionBurst([{ id: 'a', at: t - 900 }, { id: 'b', at: t - 400 }, { id: 'a', at: t }], t), true);
assert.equal(reactionBurst([{ id: 'a', at: t - 5000 }, { id: 'b', at: t - 400 }, { id: 'a', at: t }], t), false, 'stale reactions fall out');

// Crowd slots: front row first, centre out, all inside the floor.
const slots = crowdSlots();
assert.equal(slots.length, 18);
assert.ok(slots.every((s) => s.x > 5 && s.x < 95));
assert.ok(slots.every((s, i) => i === 0 || slots[i - 1].row <= s.row));
console.log('club stage ok');
