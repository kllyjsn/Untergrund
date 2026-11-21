import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { windBanks } from '../js/jazz-winds.js';
import { Engine, paletteFor } from '../js/engine.js';
import { jazzStyle } from '../js/jazz.js';
import { freshSong } from '../js/state.js';
import { patternAt } from '../js/scope.js';

const source = readFileSync(new URL('../js/hum-ui.js', import.meta.url), 'utf8');
const state = { current: 0, patterns: [{ hook: { v: 'warm' } }, { hook: { v: 'airflute' } }, {}] };
let opened = 0;
const loads = [];
let rejectLoad = false;
let chops = null;
const panel = runInNewContext((source.match(/^const melodyHooks = .+;$/m)?.[0] || '') + '\n' + source.slice(source.indexOf('export function melodyPanel'), source.indexOf('\nexport const humButton')).replace('export function', 'function') + '\nmelodyPanel', {
  h: (tag, attrs, ...children) => ({ tag, attrs, children: children.flat().filter(Boolean) }),
  getChops: () => chops, openVoice: () => opened++, openHum() {},
  windBanks, loadSets: (banks) => { loads.push(banks); return rejectLoad ? Promise.reject(new Error('offline')) : Promise.resolve(); },
  paletteFor, jazzStyle,
});
const api = { state: () => state, edit: (fn) => fn(state) };
const nodes = (node) => typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
const button = (label) => nodes(panel(api)).find((n) => n.tag === 'button' && n.children.includes(label));
assert(button('HARMON'), 'the appended Harmon voice must be selectable in Melody sound');
button('HARMON').attrs.onclick();
assert.deepEqual(loads[0], ['jhm1', 'jhm3'], 'selecting Harmon starts both recorded layers without waiting for playback to restart');
assert.deepEqual(state.patterns.slice(0, 2).map((p) => p.hook.v), ['harmon', 'harmon']);
assert.equal(button('HARMON').attrs['aria-checked'], 'true');
assert.equal(button('SYNTH').attrs['aria-checked'], 'false');
button('MY VOICE').attrs.onclick();
assert.equal(opened, 1, 'missing voice chops open the recorder without discarding the selected instrument');
assert.equal(state.patterns[0].hook.v, 'harmon');
button('SYNTH').attrs.onclick();
assert.equal(state.patterns[0].hook.v, 'warm');
assert.equal(loads.length, 1, 'other sound choices do not load Harmon');
rejectLoad = true;
button('HARMON').attrs.onclick();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(state.patterns[0].hook.v, 'harmon', 'a failed background load keeps the selected voice and fallback');
state.patterns[0].hook = null;
assert.equal(button('HARMON'), undefined, 'an empty melody has no active sound selector');
for (const style of ['bailefunk', 'minimal', 'dub', 'deephouse', 'euphoric', 'dnb']) {
  Object.assign(state, freshSong(style, 42), { current: 6, artist: { style } });
  const calls = [], e = { state, ctx: {}, harm: { r: 0, c: 0 }, hookBus: {}, playbackStyle: style, minimal: style === 'minimal' };
  for (const method of ['funkStab', 'minimalHook', 'dubChord', 'paletteHook']) e[method] = () => calls.push(method);
  const expected = style === 'bailefunk' ? 'funkStab' : style === 'minimal' ? 'minimalHook' : style === 'dub' ? 'dubChord' : 'paletteHook';
  for (const voice of ['tpt', 'airflute', 'harmon']) {
    calls.length = 0;
    Engine.prototype.hook.call(e, 0, .5, 0, .2, voice);
    assert.deepEqual(calls, [expected], style + ' already overrides recorded trumpet/flute/Harmon');
  }
  assert.equal(button('HARMON'), undefined, style + ' must not offer an ignored Harmon option');
  state.patterns[6].hook.v = 'harmon';
  assert.equal(button('SYNTH').attrs['aria-checked'], 'true', 'saved unsupported Harmon still displays the effective synth choice');
}
for (const style of ['swing', 'modal', 'bossa', 'jazzfunk', 'pop', 'trap']) {
  Object.assign(state, freshSong(style, 42), { current: 6, artist: { style } });
  assert(button('HARMON'), style + ' honors recorded winds');
}
Object.assign(state, freshSong('pop', 42), { current: 6, artist: { style: 'pop' } });
const p = state.patterns[6];
p.hook.v = 'warm';
p.at = [{ b: [0, 0], hook: { ...structuredClone(p.hook), v: 'airflute' } }, { b: [1, 1], hm: 0 }];
const notes = JSON.stringify(p.at[0].hook.s);
for (const [label, voice] of [['HARMON', 'harmon'], ['SYNTH', 'warm'], ['MY VOICE', 'chop']]) {
  if (voice === 'chop') chops = {};
  button(label).attrs.onclick();
  assert.equal(p.hook.v, voice);
  assert.equal(patternAt(p, 0).hook.v, voice, 'pop42 instrumental take must match Studio after selecting ' + label);
  assert.equal(JSON.stringify(p.at[0].hook.s), notes, 'sound selection preserves the instrumental riff');
  assert.equal(p.at[1].hook, undefined, 'sound selection does not invent a hook in an empty take');
}
console.log('melody sound: Harmon selection, state propagation, accessibility and missing-chop/empty handling passed');
