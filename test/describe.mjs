// "Describe it": phrase -> edit table, state deltas, LLM validation, and that every edit changes what the engine plays.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parse, applyEdits, describe, validateEdits, interpret, genreOf, suggest, CHIPS, chipsFor } from '../js/describe.js';
import { defaultState, generate, applyOverrides, arrangement, songChain, STYLES } from '../js/state.js';

let fails = 0;
const t = (name, fn) => { try { fn(); } catch (e) { fails++; console.error('FAIL', name, '\n ', e.message); } };

function songFor(style, seed = 7) {
  const s = defaultState();
  const g = generate(style, seed);
  applyOverrides(s, g);
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  if (g.key != null) s.key = g.key;
  if (g.scale) s.scale = g.scale;
  s.chainOn = true;
  s.chain = songChain(style, seed);
  return s;
}
const has = (edits, want) => want.every((w) => edits.some((e) => Object.entries(w).every(([k, v]) => e[k] === v)));

// 1. Phrase table: text -> edits it must contain.
const PHRASES = [
  ['darker', [{ id: 'tone', amt: -1 }]],
  ['a bit darker', [{ id: 'tone', amt: -0.5 }]],
  ['way darker', [{ id: 'tone', amt: -2 }]],
  ['brighter', [{ id: 'tone', amt: 1 }]],
  ['less busy', [{ id: 'density', amt: -1 }]],
  ['too busy', [{ id: 'density', amt: -1 }]],
  ['busier', [{ id: 'density', amt: 1 }]],
  ['bigger drop', [{ id: 'drops', amt: 1 }]],
  ['slower', [{ id: 'tempo', amt: -1 }]],
  ['faster', [{ id: 'tempo', amt: 1 }]],
  ['120 bpm', [{ id: 'bpm', value: 120 }]],
  ['more swing', [{ id: 'swing', amt: 1 }]],
  ['not enough swing', [{ id: 'swing', amt: 1 }]],
  ['add strings', [{ id: 'voice', value: 10 }]],
  ['make it sad', [{ id: 'scale', value: 'minor' }, { id: 'tempo' }]],
  ['make it happy', [{ id: 'scale', value: 'major' }]],
  ['like a 3am warehouse', [{ id: 'tone', amt: -1 }, { id: 'grit' }, { id: 'space' }]],
  ['more Glasper', [{ id: 'genre', value: 'neosoul' }, { id: 'voice', value: 1 }, { id: 'harmony' }]],
  ['darker and slower', [{ id: 'tone', amt: -1 }, { id: 'tempo', amt: -1 }]],
  ['way more reverb', [{ id: 'space', amt: 2 }]],
  ['grittier', [{ id: 'grit', amt: 1 }]],
  ['drop the kick', [{ id: 'mute', target: 'kick', value: true }]],
  ['no hats', [{ id: 'mute', target: 'ch', value: true }]],
  ['louder hats', [{ id: 'level', target: 'ch', amt: 1 }]],
  ['heavier bass', [{ id: 'level', target: 'acid', amt: 1 }]],
  ['in D minor', [{ id: 'key', value: 2 }, { id: 'scale', value: 'minor' }]],
  ['dorian', [{ id: 'scale', value: 'dorian' }]],
  ['up a key', [{ id: 'keyStep', amt: 1 }]],
  ['make it house', [{ id: 'genre', value: 'deephouse' }]],
  ['drum and bass', [{ id: 'genre', value: 'dnb' }]],
  ['more variation', [{ id: 'variation', amt: 1 }]],
  ['richer chords', [{ id: 'harmony', amt: 1 }]],
  ['darkr', [{ id: 'tone', amt: -1 }]],
];
for (const [text, want] of PHRASES) t(`parse "${text}"`, () => {
  const { edits, unknown } = parse(text, { style: 'hypnotic' });
  assert.deepEqual(unknown, [], `unknown: ${unknown}`);
  assert.ok(has(edits, want), `${JSON.stringify(edits)} lacks ${JSON.stringify(want)}`);
});
t('"richer chords" does not also turn the chords up', () => assert.ok(!parse('richer chords').edits.some((e) => e.id === 'level')));
t('unknown phrases get suggestions', () => {
  const r = describe('blorp fizz', songFor('hypnotic'), { style: 'hypnotic' });
  assert.deepEqual(r.did, []);
  assert.ok(r.suggestions.length >= 4 && r.suggestions.every((s) => parse(s).edits.length), r.suggestions.join('/'));
  assert.ok(suggest('blorp').length >= 4);
});
t('chips all parse', () => { for (const s of Object.keys(STYLES)) for (const c of chipsFor(s)) assert.ok(parse(c, { style: s }).edits.length, c); assert.ok(CHIPS.length >= 6); });

// Everyday phrasing: complaints, track-scoped words, dislikes, only/except. Each pair is [phrase, must have, must not have].
const EVERYDAY = [
  ['the bass is too loud', [{ id: 'level', target: 'acid', amt: -1 }], [{ id: 'volume' }, { id: 'level', target: 'acid', amt: 1 }]],
  ['turn the bass down', [{ id: 'level', target: 'acid', amt: -1 }]],
  ["i don't like the bass", [{ id: 'level', target: 'acid', amt: -1.5 }]],
  ['i hate the vocals', [{ id: 'mute', target: 'vox', value: true }]],
  ['the vocals are quiet', [{ id: 'level', target: 'vox', amt: 1 }]],
  ['faster hats', [{ id: 'density', target: 'ch', amt: 1 }], [{ id: 'tempo' }]],
  ['make the kick louder', [{ id: 'level', target: 'kick', amt: 1 }], [{ id: 'volume' }]],
  ['more reverb on the chords', [{ id: 'space', target: 'stab', amt: 1 }], [{ id: 'level' }, { id: 'space', target: undefined }]],
  ['no reverb on the vocals', [{ id: 'space', target: 'vox', amt: -1 }], [{ id: 'mute' }]],
  ['darker without the hats', [{ id: 'tone', amt: -1 }, { id: 'mute', target: 'ch', value: true }]],
  ['make the chords richer', [{ id: 'harmony', amt: 1 }], [{ id: 'level' }]],
  ['mute the kick and snare', [{ id: 'mute', target: 'kick', value: true }, { id: 'mute', target: 'snare', value: true }]],
  ['quieter hats and claps', [{ id: 'level', target: 'ch', amt: -1 }, { id: 'level', target: 'clap', amt: -1 }]],
  ['mute everything except the kick', [{ id: 'mute', target: 'kick', value: false }, { id: 'mute', target: 'acid', value: true }]],
  ['only bass and drums', [{ id: 'mute', target: 'acid', value: false }, { id: 'mute', target: 'snare', value: false }, { id: 'mute', target: 'vox', value: true }]],
  ['add a sax solo', [{ id: 'voice', value: 9 }], [{ id: 'mute' }]],
  ['spacier', [{ id: 'space', amt: 1 }], [{ id: 'tempo' }]],
  ['it feels empty', [{ id: 'density', amt: 1 }], [{ id: 'density', amt: -1 }]],
  ["it's boring", [{ id: 'variation', amt: 1 }]],
  ['make it less boring', [{ id: 'variation', amt: 1 }]],
  ['too harsh', [{ id: 'tone', amt: -0.7 }, { id: 'grit', amt: -0.5 }]],
  ['the kick is weak', [{ id: 'level', target: 'kick', amt: 1 }, { id: 'punch', amt: 1 }]],
  ['make it 140', [{ id: 'bpm', value: 140 }]],
  ['half time', [{ id: 'bpmScale', value: 0.5 }]],
  ['new melody', [{ id: 'hook', value: 2 }], [{ id: 'variation' }]],
  ['no melody', [{ id: 'hook', value: 0 }]],
  ['change the key', [{ id: 'keyStep', amt: 2 }]],
  ['like daft punk', [{ id: 'genre', value: 'deephouse' }]],
];
const lacks = (edits, bad) => !bad.some((w) => edits.some((e) => Object.entries(w).every(([k, v]) => e[k] === v)));
for (const [text, want, bad = []] of EVERYDAY) t(`everyday "${text}"`, () => {
  const { edits } = parse(text, { style: 'hypnotic' });
  assert.ok(has(edits, want), `${JSON.stringify(edits)} lacks ${JSON.stringify(want)}`);
  assert.ok(lacks(edits, bad), `${JSON.stringify(edits)} has one of ${JSON.stringify(bad)}`);
});
t('everyday edits land on the song', () => {
  const s = songFor('hypnotic');
  const on = (text) => describe(text, s, { style: 'hypnotic', seed: 3 });
  assert.ok(on('the bass is too loud').state.params.acid.level < s.params.acid.level);
  assert.ok(on('more reverb on the chords').state.params.stab.rev > s.params.stab.rev);
  assert.equal(on('make it 140').state.bpm, 140);
  assert.equal(on('half time').state.bpm, Math.round(s.bpm / 2));
  const solo = on('only the kick').state;
  assert.ok(!solo.mutes.kick && solo.mutes.acid && solo.mutes.ch);
  assert.ok(on('no melody').state.patterns.filter((p) => p.hook).every((p) => !p.hm));
  const fresh = on('new melody');
  assert.ok(fresh.did.includes('new melody') || fresh.did.includes('added a melody'), fresh.did.join());
  const only = on('mute everything except the kick').did;
  assert.ok(only.includes('no drums except kick') && !only.some((l) => /back in/.test(l)), only.join());
});
t('remote edits with a track target stay bounded', () => {
  const v = validateEdits([{ id: 'space', target: 'stab', amt: 9 }, { id: 'space', target: 'nope', amt: 1 }, { id: 'hook', value: 7 }, { id: 'bpmScale', value: 3 }]);
  assert.deepEqual(v.map((e) => [e.id, e.target, e.amt ?? e.value]), [['space', 'stab', 3], ['hook', undefined, 2]]);
});

// 2. State deltas.
const delta = (style, text, check, prep) => t(`${style}: "${text}" delta`, () => {
  const s = songFor(style); prep?.(s);
  const snap = JSON.stringify(s);
  const r = describe(text, s, { style, seed: 3 });
  assert.equal(JSON.stringify(s), snap, 'input state mutated');
  assert.ok(r.did.length, `no receipt: ${r.skipped}`);
  check(s, r.state, r);
});
const hits = (s) => s.patterns.reduce((n, p) => n + Object.values(p.steps || {}).reduce((m, st) => m + st.filter((x) => (typeof x === 'object' ? x?.on : x)).length, 0), 0);
for (const style of ['hypnotic', 'deephouse', 'neosoul']) {
  delta(style, 'darker', (a, b) => assert.ok(b.master.warmth > a.master.warmth || b.params.stab.cutoff < a.params.stab.cutoff));
  delta(style, 'slower', (a, b) => assert.equal(b.bpm, a.bpm - 6));
  delta(style, '100 bpm', (a, b) => assert.equal(b.bpm, 100));
  delta(style, 'more swing', (a, b) => assert.ok(b.swing > a.swing));
  delta(style, 'less busy', (a, b) => assert.ok(hits(b) < hits(a), `${hits(b)} !< ${hits(a)}`));
  delta(style, 'busier', (a, b) => assert.ok(hits(b) > hits(a), `${hits(b)} !> ${hits(a)}`));
  delta(style, 'bigger drop', (a, b) => assert.ok(b.master.arr > a.master.arr || b.master.duck > a.master.duck));
  delta(style, 'add strings', (a, b) => assert.equal(b.params.stab.voice, 10));
  delta(style, 'way more reverb', (a, b) => assert.ok(b.master.revLevel > a.master.revLevel));
  delta(style, 'grittier', (a, b) => assert.ok(b.master.drive > a.master.drive));
  delta(style, 'no hats', (a, b) => assert.equal(b.mutes.ch, true));
  delta(style, 'in D minor', (a, b) => { assert.equal(b.key, 2); assert.equal(b.scale, 'minor'); });
  delta(style, 'make it happy', (a, b) => assert.equal(b.scale, 'major'));
  delta(style, 'make it sad', (a, b) => assert.equal(b.scale, 'minor'), (s) => { s.scale = 'major'; });
  delta(style, 'darker and slower', (a, b, r) => { assert.ok(b.bpm < a.bpm); assert.ok(r.did.length >= 2); });
  delta(style, 'like a 3am warehouse', (a, b) => assert.ok(b.master.revLevel > a.master.revLevel && b.master.drive > a.master.drive));
}
t('a bit < default < way more', () => {
  const s = songFor('hypnotic');
  const w = (txt) => describe(txt, s, { style: 'hypnotic' }).state.master.revLevel - s.master.revLevel;
  assert.ok(w('a bit more reverb') > 0 && w('a bit more reverb') < w('more reverb') && w('more reverb') < w('way more reverb'));
});
t('locked tracks are left alone', () => {
  const s = songFor('hypnotic'); s.locks = { stab: true, kick: true };
  const r = describe('add strings, less busy', s, { style: 'hypnotic', seed: 3 });
  assert.equal(r.state.params.stab.voice, s.params.stab.voice);
  assert.deepEqual(r.state.patterns.map((p) => p.steps.kick), s.patterns.map((p) => p.steps.kick));
});
t('"add bass" on a cleared bass track writes notes', () => {
  const s = songFor('hypnotic');
  for (const p of s.patterns) p.steps.acid = p.steps.acid.map(() => ({ on: false, n: 0, a: false, s: false }));
  const r = describe('add bass', s, { style: 'hypnotic' });
  assert.ok(r.state.patterns.some((p) => p.steps.acid.some((x) => x.on)), r.did.join(', '));
  assert.ok(r.did.includes('added bass'), r.did.join(', '));
});
t('major remap keeps hook notes in the new scale', () => {
  const s = songFor('neosoul');
  const r = applyEdits(s, [{ id: 'scale', value: 'major' }]);
  const pcs = [0, 2, 4, 5, 7, 9, 11];
  for (const p of r.state.patterns) for (const st of p.acid || []) if (st?.on) assert.ok(pcs.includes(((st.note % 12) + 12) % 12), `note ${st.note}`);
});
t('genre switch goes through regenerate', () => {
  const s = songFor('hypnotic');
  assert.equal(genreOf(parse('make it house').edits, 'hypnotic'), 'deephouse');
  assert.equal(genreOf(parse('make it house').edits, 'deephouse'), null);
  const r = describe('make it house and darker', s, { style: 'hypnotic', regenerate: (g) => songFor(g, 9) });
  assert.equal(r.genre, 'deephouse');
  assert.ok(r.did[0].includes('DEEP') || r.did[0].toLowerCase().includes('house'), r.did[0]);
});

// 3. Closed vocabulary for an optional, off-by-default LLM.
t('validateEdits drops anything outside the vocabulary', () => {
  const ok = validateEdits([{ id: 'tone', amt: -1 }, { id: 'rm -rf' }, { id: 'bpm', value: 9999 }, { id: 'mute', target: 'window', value: true }, { id: 'voice', value: 10 }, null, 'x']);
  assert.deepEqual(ok.map((e) => e.id), ['tone', 'bpm', 'voice']);
  assert.ok(ok[1].value <= 200);
});
let remoteCalls = 0;
const remote = async (text) => { remoteCalls++; return { edits: [{ id: 'space', amt: 1 }, { id: 'evil', amt: 5 }] }; };
const done = (async () => {
  const a = await interpret('darker');
  assert.ok(a.edits.length && !a.unknown.length);
  await interpret('darker', {}, { remote });
  assert.equal(remoteCalls, 0, 'remote called although local rules understood');
  const b = await interpret('make it feel like velvet', {}, { remote });
  assert.equal(remoteCalls, 1);
  assert.deepEqual(b.edits.map((e) => e.id), ['space']);
  const c = await interpret('blorp');
  assert.equal(c.edits.length, 0);
})().catch((e) => { fails++; console.error('FAIL interpret\n ', e.message); });

// 4. Audibility: drive the real Engine + Sequencer against a recording fake AudioContext and require the scheduled audio to change.
class FakeBuffer { constructor({ length, numberOfChannels = 1, sampleRate = 48000 }) { this.length = length; this.numberOfChannels = numberOfChannels; this.sampleRate = sampleRate; this.duration = length / sampleRate; this.ch = Array.from({ length: numberOfChannels }, () => new Float32Array(length)); } getChannelData(i) { return this.ch[i]; } copyToChannel(d, i) { this.ch[i].set(d); } }
globalThis.AudioBuffer = FakeBuffer;
function fakeCtx() {
  const log = [];
  let ids = 0;
  const fmt = (v) => typeof v === 'number' ? v.toFixed(4) : v?.__id ? '#' + v.__id : typeof v === 'string' ? v : v instanceof Float32Array ? 'curve' + v.length + ':' + Array.from(v.filter((_, i) => i % 97 === 0), (x) => x.toFixed(3)).join(',') : typeof v;
  const node = (kind) => {
    const id = kind + ++ids, store = { __id: id };
    const p = new Proxy(function () {}, {
      get(_, k) {
        if (k in store) return store[k];
        if (typeof k === 'symbol') return k === Symbol.toPrimitive ? () => 0 : undefined;
        if (k === 'value' || k === 'defaultValue') return 0;
        if (k === 'then') return undefined;
        if (k === 'connect') return (dst) => { log.push(`${id}>${fmt(dst)}`); return dst; };
        if (k === 'disconnect') return () => {};
        const child = node(id + '.' + k); store[k] = child; return child;
      },
      set(_, k, v) { store[k] = v; log.push(`${id}.${String(k)}=${fmt(v)}`); return true; },
      apply(_, __, args) { log.push(`${id}(${args.map(fmt).join(',')})`); return node(id + '()'); },
    });
    return p;
  };
  const ctx = new Proxy({ currentTime: 0, sampleRate: 48000, state: 'running', destination: node('dest'),
    createBuffer: (n, length, sampleRate) => new FakeBuffer({ length, numberOfChannels: n, sampleRate }) }, {
    get(o, k) { if (k in o) return o[k]; if (typeof k === 'string' && k.startsWith('create')) return (...a) => { const n = node(k.slice(6)); log.push(`new ${n.__id}(${a.map(fmt).join(',')})`); return n; }; return undefined; },
  });
  return { ctx, log };
}
const { Engine, Sequencer, parseChain } = await import('../js/engine.js');
// The whole song, so a change that only reaches the peak (e.g. a techno pedal shift) still counts as audible.
function fingerprint(state, bars = Math.max(32, state.chainOn ? parseChain(state.chain).length : 0)) {
  const rnd = Math.random; let x = 12345; Math.random = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  try {
    const { ctx, log } = fakeCtx();
    const engine = new Engine(ctx, JSON.parse(JSON.stringify(state)), { realtime: false });
    const seq = new Sequencer(engine, engine.state || state);
    const chain = state.chainOn ? parseChain(state.chain) : [];
    for (let abs = 0, tt = 0.05; abs < bars * 16; abs++) { seq.tick(abs, tt); tt += engine.stepDur; }
    return { hash: createHash('sha1').update(log.join('\n')).digest('hex'), n: log.length, chain: chain.length };
  } finally { Math.random = rnd; }
}
const AUDIBLE = ['darker', 'brighter', 'slower', 'faster', 'more swing', 'less busy', 'busier', 'bigger drop', 'add strings', 'make it sad', 'make it happy', 'like a 3am warehouse', 'darker and slower', 'more Glasper', 'way more reverb', 'grittier', 'no hats', 'in D minor', 'up a key', 'dorian', 'more variation', 'richer chords', 'louder hats', 'heavier bass', 'more reverb', 'drier', 'cleaner', 'less swing', 'add claps'];
for (const style of ['hypnotic', 'deephouse', 'neosoul', 'boombap']) {
  const base = songFor(style);
  const before = fingerprint(base);
  t(`${style}: fingerprint is deterministic`, () => assert.equal(fingerprint(base).hash, before.hash));
  for (const text of AUDIBLE) t(`${style}: "${text}" is audible`, () => {
    const r = describe(text, base, { style, seed: 3, regenerate: (g) => songFor(g) });
    if (!r.did.length) return; // nothing to do in this style (e.g. already minor); receipt says so
    const after = fingerprint(r.state);
    assert.notEqual(after.hash, before.hash, `did "${r.did.join(', ')}" but render unchanged`);
  });
}

await done;
if (fails) { console.error(`describe: ${fails} failing`); process.exit(1); }
console.log('describe: ok');
