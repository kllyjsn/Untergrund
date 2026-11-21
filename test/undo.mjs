import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHistory, gesture, LIMIT } from '../js/undo.js';

{
  const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const snapshot = source.slice(source.indexOf('function snapshot('), source.indexOf('// Any edit makes'));
  const restore = source.slice(source.indexOf('function restore('), source.indexOf('const peekSnap'));
  const state = { chain: 'CCCC', chainEntries: [{ p: 2, sec: 0, id: 0 }, { p: 2, sec: 0, id: 1 }, { p: 2, sec: 1, id: 2 }, { p: 2, sec: 1, id: 3 }] };
  const noop = () => {};
  const api = runInNewContext(`${snapshot}\n${restore}\n({ snapshot, restore })`, { state, knobGesture: { reset: noop }, touched: noop, engine: null, build: noop, persist: noop, toast: noop });
  const before = api.snapshot(), h = createHistory();
  h.push(before);
  state.chain = 'CCCCC'; state.chainEntries.splice(1, 0, { p: 2, sec: 0, id: 4 });
  const resized = api.snapshot();
  api.restore(h.undo(resized), 'Undone');
  assert.equal(api.snapshot(), before, 'undo restores chain and section tags together');
  api.restore(h.redo(api.snapshot()), 'Redone');
  assert.equal(api.snapshot(), resized, 'redo restores the edited tags');
  delete state.chainEntries;
  const plain = api.snapshot();
  state.chainEntries = [{ p: 2, sec: 4 }];
  api.restore({ snap: plain }, 'Undone');
  assert(!('chainEntries' in state), 'restoring an untagged arrangement clears stale tags');
  state.chain = ''; state.chainEntries = [];
  const empty = api.snapshot();
  delete state.chainEntries;
  api.restore({ snap: empty }, 'Undone');
  assert.equal(JSON.stringify(state.chainEntries), '[]', 'empty tagged arrangements survive undo');
}

// Undo, then redo, walks back and forward through the same states with their labels.
{
  const h = createHistory();
  let state = 'A';
  const edit = (next, label) => { h.push(state, label); state = next; };
  edit('B', 'GENERATE pattern A');
  edit('C', 'MUTATE');
  assert.equal(h.depth, 2);
  let e = h.undo(state); state = e.snap;
  assert.deepEqual([state, e.label], ['B', 'MUTATE']);
  e = h.undo(state); state = e.snap;
  assert.deepEqual([state, e.label], ['A', 'GENERATE pattern A']);
  assert.equal(h.undo(state), null, 'nothing left to undo');
  assert(h.canRedo && !h.canUndo);
  e = h.redo(state); state = e.snap;
  assert.deepEqual([state, e.label], ['B', 'GENERATE pattern A']);
  e = h.redo(state); state = e.snap;
  assert.deepEqual([state, e.label], ['C', 'MUTATE']);
  assert.equal(h.redo(state), null, 'nothing left to redo');
  e = h.undo(state); state = e.snap;
  assert.equal(state, 'B', 'undo after redo');
}

// A new edit clears redo.
{
  const h = createHistory();
  h.push('A', 'one');
  h.undo('B');
  assert(h.canRedo);
  h.push('A', 'two');
  assert(!h.canRedo, 'redo cleared by a new edit');
  assert.equal(h.peek().label, 'two');
}

// Both stacks stay bounded; the oldest entries go first.
{
  const h = createHistory();
  for (let i = 0; i < LIMIT + 25; i++) h.push(i, `e${i}`);
  assert.equal(h.depth, LIMIT);
  let cur = 'now', n = 0, e, last;
  while ((e = h.undo(cur))) { last = e; cur = e.snap; n++; }
  assert.equal(n, LIMIT);
  assert.equal(last.snap, 25, 'oldest kept entry');
  let r = 0; while (h.redo(cur)) r++;
  assert.equal(r, LIMIT);
  const small = createHistory(3);
  for (let i = 0; i < 10; i++) small.push(i);
  assert.equal(small.depth, 3);
}

// amend rewrites the latest entry only.
{
  const h = createHistory();
  h.push('{"a":1}', 'NEW SET');
  h.amend((s) => JSON.stringify({ ...JSON.parse(s), ui: { style: 'acid' } }));
  assert.deepEqual(JSON.parse(h.undo('x').snap), { a: 1, ui: { style: 'acid' } });
  createHistory().amend(() => { throw new Error('not called on an empty history'); });
}

// One knob drag = one step; wheel/arrow bursts coalesce until idle; another knob starts a new step.
{
  let t = 0;
  const g = gesture(700, () => t);
  assert.equal(g.begin('kick.decay', true), true, 'drag starts a step');
  for (let px = 0; px < 120; px++) { t += 16; assert.equal(g.begin('kick.decay', true), false, 'no step per pixel'); }
  t += 5000; assert.equal(g.begin('kick.decay', true), false, 'a held drag never times out');
  g.end();
  t += 100; assert.equal(g.begin('kick.decay', true), true, 'a second drag right after release is its own step');
  g.end();
  t += 100; assert.equal(g.begin('kick.decay'), true, 'wheel after a drag is its own step');
  t += 100; assert.equal(g.begin('kick.decay'), false, 'wheel burst coalesces');
  t += 800; assert.equal(g.begin('kick.decay'), true, 'after a pause: new step');
  t += 100; assert.equal(g.begin('kick.decay'), false);
  t += 100; assert.equal(g.begin('kick.tune'), true, 'another knob: new step');
  g.reset(); assert.equal(g.begin('kick.tune'), true, 'reset (after undo) starts fresh');
}

console.log('undo ok');
