import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../js/hum-ui.js', import.meta.url), 'utf8');
const state = { current: 0, patterns: [{ hook: { v: 'warm' } }, { hook: { v: 'airflute' } }, {}] };
let opened = 0;
const panel = runInNewContext(source.slice(source.indexOf('export function melodyPanel'), source.indexOf('\nexport const humButton')).replace('export function', 'function') + '\nmelodyPanel', {
  h: (tag, attrs, ...children) => ({ tag, attrs, children: children.flat().filter(Boolean) }),
  getChops: () => null, openVoice: () => opened++, openHum() {},
});
const api = { state: () => state, edit: (fn) => fn(state) };
const nodes = (node) => typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
const button = (label) => nodes(panel(api)).find((n) => n.tag === 'button' && n.children.includes(label));
assert(button('HARMON'), 'the appended Harmon voice must be selectable in Melody sound');
button('HARMON').attrs.onclick();
assert.deepEqual(state.patterns.slice(0, 2).map((p) => p.hook.v), ['harmon', 'harmon']);
assert.equal(button('HARMON').attrs['aria-checked'], 'true');
assert.equal(button('SYNTH').attrs['aria-checked'], 'false');
button('MY VOICE').attrs.onclick();
assert.equal(opened, 1, 'missing voice chops open the recorder without discarding the selected instrument');
assert.equal(state.patterns[0].hook.v, 'harmon');
button('SYNTH').attrs.onclick();
assert.equal(state.patterns[0].hook.v, 'warm');
state.patterns[0].hook = null;
assert.equal(button('HARMON'), undefined, 'an empty melody has no active sound selector');
console.log('melody sound: Harmon selection, state propagation, accessibility and missing-chop/empty handling passed');
