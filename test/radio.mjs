import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextUp, radioOn, setRadio } from '../js/radio.js';
import { STYLES } from '../js/state.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const store = mem();
assert.equal(radioOn(store), true, 'radio is on by default');
setRadio(false, store); assert.equal(radioOn(store), false);
setRadio(true, store); assert.equal(radioOn(store), true);
assert.equal(radioOn(null), true);

const style = Object.keys(STYLES).find((id) => STYLES[id].family === 'TECHNO');
assert.deepEqual(nextUp({ style, styles: STYLES }), { kind: 'generate', style }, 'no queue: a new song in the same style');
const queue = { ids: ['a', 'b', 'c'], i: 0 };
assert.deepEqual(nextUp({ queue, style, styles: STYLES }), { kind: 'track', i: 1 }, 'a queue plays in order');
assert.deepEqual(nextUp({ queue, style, styles: STYLES, skip: (id) => id === 'b' }), { kind: 'track', i: 2 }, 'turned-down songs are skipped');
assert.deepEqual(nextUp({ queue: { ids: ['a'], i: 0 }, style, styles: STYLES }), { kind: 'generate', style }, 'radio carries on after the queue');
for (let k = 0; k < 20; k++) {
  const n = nextUp({ queue, style, styles: STYLES, why: 'not_my_style', rand: () => k / 20 });
  assert.equal(n.kind, 'generate', '"not my style" leaves the queue');
  assert.notEqual(n.style, style, '"not my style" changes the style');
  assert.equal(STYLES[n.style].family, STYLES[style].family, 'and stays in the family');
}
for (const why of ['boring', 'sounds_bad']) assert.deepEqual(nextUp({ style, styles: STYLES, why }), { kind: 'generate', style }, `${why}: same style, new song`);
// A feeling the listener asked for: "not my style" crosses genres but lands only where that feeling lives.
import { feelsFor } from '../js/feel.js';
const fams = new Set();
for (let k = 0; k < 40; k++) {
  const n = nextUp({ style: 'pop', styles: STYLES, why: 'not_my_style', feel: 'dark', rand: () => k / 40 });
  assert.notEqual(n.style, 'pop');
  assert.ok(feelsFor(n.style, STYLES[n.style].family).dark, `${n.style} carries dark`);
  fams.add(STYLES[n.style].family);
}
assert.ok(fams.size >= 3 && [...fams].some((f) => f !== STYLES.pop.family), `dark radio crosses families: ${[...fams]}`);
assert.deepEqual(nextUp({ style: 'pop', styles: STYLES, feel: 'dark' }), { kind: 'generate', style: 'pop' }, 'a song ending keeps the genre; the feeling rides along');

const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const radioNextSource = main.match(/(?:async )?function radioNext\([^)]*\) \{[\s\S]*?\n\}/)[0];
const attempted = [];
const runNext = new Function('nextUp', 'STYLES', 'openRecent', 'generateNow', `
  let queue = { items: [{ id: 'playing' }, { id: 'removed', cloud: true, fps: [] }, { id: 'next', fps: [] }], i: 0 };
  const style = 'pop', feelPick = null, listens = { isDowned: () => false };
  ${radioNextSource}
  return radioNext();
`);
await runNext(nextUp, STYLES, async (row) => { attempted.push(row.id); return row.id !== 'removed'; }, () => attempted.push('generate'));
assert.deepEqual(attempted, ['removed', 'next'], 'radio advances past a cloud track that no longer loads');
console.log('radio passed');
