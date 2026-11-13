// "Describe it": phrase -> edit table, state deltas, LLM validation, and that every edit changes what the engine plays.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parse, applyEdits, describe, validateEdits, interpret, genreOf, suggest, CHIPS, chipsFor, needsMix, mixAdjust, TYPICAL, heard } from '../js/describe.js';
import { patternAt, changedBars } from '../js/scope.js';
import { defaultState, generate, sanitize, clone, applyOverrides, arrangement, songChain, STYLES } from '../js/state.js';

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
const same = (a, b) => a === b || (Array.isArray(a) && JSON.stringify(a) === JSON.stringify(b));
const has = (edits, want) => want.every((w) => edits.some((e) => Object.entries(w).every(([k, v]) => same(e[k], v))));

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
  // Part of the song: a section, one pass of it, or a bar range; the rest of the song is left alone.
  ['make the chorus hit harder', [{ id: 'section', sec: 'drop', op: 'energy', amt: 1 }], [{ id: 'punch' }, { id: 'drops' }]],
  ['make the drop hit harder', [{ id: 'section', sec: 'drop', op: 'energy', amt: 1 }], [{ id: 'punch' }]],
  ['strip the hats out of the breakdown', [{ id: 'section', sec: 'breakdown', op: 'mute', tracks: ['ch'] }], [{ op: 'add' }]],
  ['take the kick out of the intro', [{ id: 'section', sec: 'intro', op: 'mute', tracks: ['kick'] }], [{ op: 'add' }]],
  ['pull the bass out of the build', [{ id: 'section', sec: 'build', op: 'mute', tracks: ['acid'] }]],
  ['more tension in the build', [{ id: 'section', sec: 'build', op: 'tension', amt: 1 }], [{ op: 'energy' }]],
  ['the build needs more tension', [{ id: 'section', sec: 'build', op: 'tension', amt: 1 }]],
  ['less tension in the build', [{ id: 'section', sec: 'build', op: 'tension', amt: -1 }]],
  ['more suspense before the drop', [{ id: 'section', sec: 'drop', op: 'tension', amt: 1 }]],
  ['bass up an octave in the second drop', [{ id: 'section', sec: 'drop', op: 'octave', tracks: ['acid'], amt: 1, nth: 2 }], [{ id: 'level' }, { id: 'drops' }]],
  ['bass down an octave in the breakdown', [{ id: 'section', sec: 'breakdown', op: 'octave', tracks: ['acid'], amt: -1 }]],
  ['in the last chorus, melody an octave higher', [{ id: 'section', sec: 'drop', op: 'octave', tracks: ['stab'], amt: 1, nth: -1 }]],
  ['bass two octaves down in bars 9-16', [{ id: 'section', sec: 'bars', op: 'octave', tracks: ['acid'], amt: -2, bars: [9, 16] }]],
  ['no hats in bars 9-16', [{ id: 'section', sec: 'bars', op: 'mute', tracks: ['ch'], bars: [9, 16] }], [{ id: 'mute' }]],
  ['bars 9 to 16 no hats', [{ id: 'section', sec: 'bars', op: 'mute', tracks: ['ch'], bars: [9, 16] }]],
  ['mute the kick in bar 17', [{ id: 'section', sec: 'bars', op: 'mute', tracks: ['kick'], bars: [17, 17] }], [{ id: 'mute' }]],
  ['make bar 17 hit harder', [{ id: 'section', sec: 'bars', op: 'energy', amt: 1, bars: [17, 17] }]],
  ['busier hats in bars 33–40', [{ id: 'section', sec: 'bars', op: 'density', tracks: ['ch'], amt: 1, bars: [33, 40] }]],
  ['in measures 5 through 8, add claps', [{ id: 'section', sec: 'bars', op: 'add', tracks: ['clap'], bars: [5, 8] }]],
  ['the last 8 bars, no kick', [{ id: 'section', sec: 'bars', op: 'mute', tracks: ['kick'], bars: [-8, -1] }]],
  ['strip the drums in the last 8 bars', [{ id: 'section', sec: 'bars', op: 'mute', bars: [-8, -1] }]],
  ['quieter last four bars', [{ id: 'section', sec: 'bars', op: 'energy', amt: -1, bars: [-4, -1] }]],
  ['more tension in the last 4 bars', [{ id: 'section', sec: 'bars', op: 'tension', amt: 1, bars: [-4, -1] }]],
  ['no melody in the first 16 bars', [{ id: 'section', sec: 'bars', op: 'hook', value: 0, bars: [1, 16] }]],
  ['sparser hats in the first eight bars', [{ id: 'section', sec: 'bars', op: 'density', tracks: ['ch'], amt: -1, bars: [1, 8] }]],
  ['make the last bar hit harder', [{ id: 'section', sec: 'bars', op: 'energy', amt: 1, bars: [-1, -1] }]],
  ['make the second drop bigger', [{ id: 'section', sec: 'drop', op: 'energy', amt: 1, nth: 2 }]],
  ['make drop 2 bigger', [{ id: 'section', sec: 'drop', op: 'energy', amt: 1, nth: 2 }]],
  ['no hats in the first drop', [{ id: 'section', sec: 'drop', op: 'mute', tracks: ['ch'], nth: 1 }]],
  ['the final breakdown should be stripped', [{ id: 'section', sec: 'breakdown', op: 'strip', nth: -1 }]],
  ['skip the second breakdown', [{ id: 'section', sec: 'breakdown', op: 'skip', nth: 2 }]],
  ['add melody to the second chorus', [{ id: 'section', sec: 'drop', op: 'hook', value: 1, nth: 2 }]],
  ['in the second verse, busier hats', [{ id: 'section', sec: 'verse', op: 'density', tracks: ['ch'], amt: 1, nth: 2 }]],
];
const lacks = (edits, bad) => !bad.some((w) => edits.some((e) => Object.entries(w).every(([k, v]) => same(e[k], v))));
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

// Scoped edits: a per-bar note log (every Engine call the Sequencer makes, bar by bar) must change only in the
// bars the edit names, and the receipt's bars must be exactly those.
function noteLog(state) {
  const rnd = Math.random; let x = 12345; Math.random = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  try {
    const { ctx } = fakeCtx();
    const engine = new Engine(ctx, JSON.parse(JSON.stringify(state)), { realtime: false });
    const seq = new Sequencer(engine, engine.state || state);
    const n = parseChain(state.chain).length, out = Array.from({ length: n }, () => []);
    let depth = 0, bar = 0, t0 = 0;
    const r = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : Array.isArray(v) ? `[${v.map(r)}]` : v && typeof v === 'object' ? (Object.keys(v).length <= 8 ? `{${Object.entries(v).map(([k, x]) => `${k}:${typeof x === 'object' ? '-' : r(x)}`)}}` : 'obj') : String(v));
    for (let o = Object.getPrototypeOf(engine); o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (const k of Object.getOwnPropertyNames(o)) {
        if (k === 'constructor' || typeof engine[k] !== 'function' || Object.hasOwn(engine, k)) continue;
        const f = engine[k];
        engine[k] = function (...a) {
          if (depth === 0) out[bar]?.push(`${k}(${a.map((v) => (typeof v === 'number' && v > t0 - 1 && v < t0 + 30 ? `t${r(v - t0)}` : r(v))).join(',')})`);
          depth++; try { return f.apply(this, a); } finally { depth--; }
        };
      }
    }
    for (let abs = 0, tt = 0.05; abs < n * 16; abs++) { bar = Math.floor(abs / 16); if (abs % 16 === 0) t0 = tt; seq.tick(abs, tt); tt += engine.stepDur; }
    return out.map((l) => l.join('\n'));
  } finally { Math.random = rnd; }
}
const runsOf = (chain, letters) => [...chain.matchAll(new RegExp(`[${letters}]+`, 'g'))].map((m) => [...m[0]].map((_, k) => m.index + k));
const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
for (const style of ['deephouse', 'hypnotic']) {
  const base = songFor(style), n = base.chain.length, log0 = noteLog(base);
  const drops = runsOf(base.chain, 'GH').filter((r) => r.some((q) => base.chain[q] === 'G'));
  const SCOPED = [
    ['no hats in bars 9-16', span(8, 15)],
    ['mute the kick in bar 17', [16]],
    ['make bar 17 hit harder', [16]],
    ['the last 8 bars, no kick', span(n - 8, n - 1)],
    ['strip the drums in the last 8 bars', span(n - 8, n - 1)],
    ['bass up an octave in the second drop', drops[1]],
    ['bass down an octave in the first drop', drops[0]],
    ['make the second drop bigger', drops[1]],
    ['make the chorus hit harder', drops.flat()],
    ['no hats in the last drop', drops[drops.length - 1]],
    ['strip the hats out of the breakdown', runsOf(base.chain, 'EF').flat()],
    ['more tension in the build', runsOf(base.chain, 'B')[0]],
    ['more tension in the last 4 bars', span(n - 4, n - 1)],
    ['sparser hats in bars 33-40', span(32, 39)],
    ['no kick and snare in the intro', runsOf(base.chain, 'A')[0]],
  ];
  for (const [text, want] of SCOPED) t(`${style}: "${text}" changes only its bars`, () => {
    const r = describe(text, base, { style, seed: 3 });
    assert.ok(r.did.length, `nothing done: ${r.skipped.join(', ')}`);
    assert.equal(r.state.chain, base.chain);
    const log1 = noteLog(r.state), moved = log1.map((l, i) => (l !== log0[i] ? i : -1)).filter((i) => i >= 0);
    const target = new Set(want);
    assert.ok(moved.length, `"${text}" is not audible`);
    // A bar's last beat leads into the next bar (fills, turnarounds), so a change may reach one bar before the target.
    assert.deepEqual(moved.filter((i) => !target.has(i) && !target.has(i + 1)), [], `changed outside the target: ${moved.join(',')}`);
    assert.ok(r.bars.every((q) => target.has(q)), `receipt bars ${r.bars} outside ${want}`);
    assert.ok(r.did.some((d) => / in | bars? |drop|chorus|breakdown|build|intro/.test(d)), r.did.join(', '));
  });
  t(`${style}: scoped edits survive save/load and undo`, () => {
    const r = describe('bass up an octave in the second drop', base, { style, seed: 3 });
    const back = sanitize(JSON.parse(JSON.stringify(r.state)));
    assert.ok(noteLog(back).every((l, i) => l === noteLog(r.state)[i]), 'save/load changed the edit');
    assert.ok(noteLog(sanitize(JSON.parse(JSON.stringify(base)))).every((l, i) => l === log0[i]), 'undo snapshot differs');
  });
  t(`${style}: a longer intro keeps the edit on the second drop`, () => {
    const a = describe('bass up an octave in the second drop', base, { style, seed: 3 }).state;
    const b = describe('longer intro', a, { style, seed: 3 }).state, plain = describe('longer intro', base, { style, seed: 3 }).state, d = b.chain.length - a.chain.length;
    assert.ok(d > 0); assert.equal(b.chain, plain.chain);
    const lb = noteLog(b), lp = noteLog(plain), moved = lb.map((l, i) => (l !== lp[i] ? i : -1)).filter((i) => i >= 0);
    const want = new Set(drops[1].map((q) => q + d));
    assert.ok(moved.length && moved.every((q) => want.has(q) || want.has(q + 1)), `moved ${moved} want ${[...want]}`);
  });
}
{
  const base = songFor('deephouse');
  t('bar range past the end of the song is skipped', () => { const r = describe('no hats in bars 200-210', base, { style: 'deephouse' }); assert.equal(r.did.length, 0); });
  t('a third drop that is not there is skipped', () => { const r = describe('bass up an octave in the fifth drop', base, { style: 'deephouse' }); assert.equal(r.did.length, 0); });
  t('bar edits need song mode', () => { const r = describe('no hats in bars 9-16', { ...base, chainOn: false }, { style: 'deephouse' }); assert.equal(r.did.length, 0); });
  t('"no hats in bars 9-16" reads back where', () => assert.ok(describe('no hats in bars 9-16', base, { style: 'deephouse' }).did.includes('no hats in bars 9–16')));
  t('"bass up an octave in the second drop" reads back where', () => assert.ok(describe('bass up an octave in the second drop', base, { style: 'deephouse' }).did.includes('bass up an octave in the second drop')));
  t('whole-song edits report no bars', () => assert.equal(describe('darker', base, { style: 'deephouse' }).bars, undefined));
  t('changedBars is empty for identical songs', () => assert.deepEqual(changedBars(base, clone(base)), []));
}

// Follow-ups act on the previous change.
{
  const base = songFor('hypnotic');
  const first = parse('darker and more reverb on the chords and mute the hats', { style: 'hypnotic' }).edits;
  const fu = (text) => parse(text, { style: 'hypnotic', last: first });
  const amtOf = (r, id, target) => r.edits.find((e) => e.id === id && (e.target || null) === (target || null))?.amt;
  t('follow "more" repeats the last nudges', () => { const r = fu('more'); assert.equal(r.follow, 'again'); assert.equal(amtOf(r, 'tone'), -1); assert.equal(amtOf(r, 'space', 'stab'), 1); });
  t('follow "way more" doubles', () => assert.equal(amtOf(fu('way more'), 'tone'), -2));
  t('follow "a bit more" halves', () => assert.equal(amtOf(fu('a bit more'), 'tone'), -0.5));
  for (const text of ['too much', "that's too much", 'back off', 'a bit less', 'tone it down']) t(`follow "${text}" eases off`, () => { const r = fu(text); assert.equal(r.follow, 'less'); assert.equal(amtOf(r, 'tone'), 0.5); assert.equal(amtOf(r, 'space', 'stab'), -0.5); });
  for (const text of ['no the other way', 'opposite', 'wrong way']) t(`follow "${text}" reverses`, () => { const r = fu(text); assert.equal(r.follow, 'invert'); assert.equal(amtOf(r, 'tone'), 2); assert.ok(has(r.edits, [{ id: 'mute', target: 'ch', value: false }])); });
  t('follow "undo the reverb but keep the rest"', () => { const r = fu('undo the reverb but keep the rest'); assert.deepEqual(r.edits.map((e) => e.id), ['space']); assert.equal(amtOf(r, 'space', 'stab'), -1); });
  t('follow "keep the reverb but undo the rest"', () => { const r = fu('keep the reverb but undo the rest'); assert.ok(!r.edits.some((e) => e.id === 'space')); assert.equal(amtOf(r, 'tone'), 1); assert.ok(has(r.edits, [{ id: 'mute', target: 'ch', value: false }])); });
  t('follow "undo the hats" unmutes only hats', () => assert.deepEqual(fu('undo the hats').edits.map(({ src, ...e }) => e), [{ id: 'mute', target: 'ch', value: false }]));
  t('follow "the other way" after "the other way" keeps going the corrected way', () => { const inv = fu('opposite'); const r = parse('more', { style: 'hypnotic', last: inv.next }); assert.equal(amtOf(r, 'tone'), 1); });
  t('follow undo reaches over the whole run', () => {
    const net = [{ id: 'tone', amt: -1.5 }, { id: 'space', target: 'stab', amt: 1.5 }];
    const r = parse('undo the reverb but keep the rest', { style: 'hypnotic', last: [{ id: 'space', target: 'stab', amt: 0.5 }], net });
    assert.deepEqual(r.edits.map(({ src, ...e }) => e), [{ id: 'space', target: 'stab', amt: -1.5 }]);
  });
  t('new instructions still parse normally with a previous change', () => assert.equal(fu('more swing').follow, undefined));
  t('"more" with nothing before it does nothing', () => assert.equal(parse('more', { style: 'hypnotic' }).edits.length, 0));
  t('"undo the reverb" with nothing before it never adds reverb', () => assert.ok(!parse('undo the reverb', { style: 'hypnotic' }).edits.some((e) => e.id === 'space')));
  t('follow "more" then "too much" lands between', () => {
    const a = applyEdits(base, first, { style: 'hypnotic' }).state;
    const b = applyEdits(a, fu('more').edits, { style: 'hypnotic' }).state;
    const c = applyEdits(b, parse('too much', { style: 'hypnotic', last: fu('more').next }).edits, { style: 'hypnotic' }).state;
    const tone = (s) => JSON.stringify(s.master?.tone ?? s.master?.cutoff ?? s.master);
    assert.notEqual(tone(a), tone(b)); assert.notEqual(tone(b), tone(c));
  });
}

// Section edits change one part of the arrangement (scenes 0 intro, 1 build, 2 verse, 4-5 breakdown, 6-7 drop).
{
  const base = songFor('deephouse');
  const run = (text) => describe(text, base, { style: 'deephouse', seed: 3, regenerate: (g) => songFor(g) });
  // What scene i plays the first time the chain reaches it.
  const on = (s, i, id) => patternAt(s.patterns[i], s.chain.indexOf('ABCDEFGH'[i])).steps[id].filter((v) => (typeof v === 'object' ? v.on : v)).length;
  const sec = (text) => parse(text, { style: 'deephouse' }).edits.filter((e) => e.id === 'section');
  const SECS = [
    ['no hats in the intro', { sec: 'intro', op: 'mute' }],
    ['in the breakdown, no hats', { sec: 'breakdown', op: 'mute' }],
    ['longer intro', { sec: 'intro', op: 'length', amt: 1 }],
    ['the breakdown is too long', { sec: 'breakdown', op: 'length', amt: -1 }],
    ['skip the intro', { sec: 'intro', op: 'skip' }],
    ['no intro', { sec: 'intro', op: 'skip' }],
    ['make the drop bigger', { sec: 'drop', op: 'energy', amt: 1 }],
    ['the drop should hit harder', { sec: 'drop', op: 'energy', amt: 1 }],
    ['quieter intro', { sec: 'intro', op: 'energy', amt: -1 }],
    ['strip the breakdown', { sec: 'breakdown', op: 'strip' }],
    ['add bass to the intro', { sec: 'intro', op: 'add' }],
    ['melody in the breakdown', { sec: 'breakdown', op: 'hook', value: 1 }],
    ['busier hats in the drop', { sec: 'drop', op: 'density', amt: 1 }],
    ['make it longer', { sec: 'drop', op: 'length', amt: 1 }],
  ];
  for (const [text, want] of SECS) t(`section "${text}"`, () => assert.ok(has(sec(text), [want]), JSON.stringify(sec(text))));
  for (const text of ['drop the kick', 'bigger drops', 'more groove', 'add a breakdown', 'build up', 'add chorus']) t(`"${text}" is not a section edit`, () => assert.equal(sec(text).length, 0));
  t('"no kick and snare in the intro" keeps the kick in the drop', () => {
    const r = run('no kick and snare in the intro');
    assert.equal(on(r.state, 0, 'kick'), 0); assert.ok(on(r.state, 6, 'kick') > 0); assert.ok(!r.state.mutes.kick);
  });
  t('"add bass to the intro" only touches the intro', () => {
    assert.equal(on(base, 0, 'acid'), 0);
    const r = run('add bass to the intro');
    assert.ok(on(r.state, 0, 'acid') > 0); assert.deepEqual(r.state.patterns.slice(1), base.patterns.slice(1));
    // The outro plays scene A too and keeps its bars.
    const intro = base.chain.match(/^A+/)[0].length;
    assert.deepEqual(r.bars, [...Array(intro).keys()]);
  });
  t('"longer intro" adds bars at the start only', () => {
    const r = run('longer intro');
    assert.ok(r.state.chain.length > base.chain.length); assert.ok(r.state.chain.startsWith(base.chain.match(/^A+/)[0] + 'A'));
    assert.equal(r.state.chain.replace(/^A+/, ''), base.chain.replace(/^A+/, ''));
  });
  t('"skip the intro" starts on the build', () => assert.equal(run('skip the intro').state.chain, base.chain.replace(/^A+/, '')));
  t('"get to the drop faster" shortens intro and build', () => { const r = run('get to the drop faster'); assert.ok(r.state.chain.length < base.chain.length); assert.ok(r.state.chain.indexOf('G') < base.chain.indexOf('G')); });
  t('"strip the breakdown" removes drums there only', () => {
    const r = run('strip the breakdown');
    for (const d of ['kick', 'clap', 'snare', 'ch', 'oh', 'ride', 'perc']) assert.equal(on(r.state, 4, d) + on(r.state, 5, d), 0);
    assert.deepEqual(r.state.patterns[6], base.patterns[6]);
  });
  t('"make the drop bigger" fills the drop', () => { const r = run('make the drop bigger'); assert.ok(hits(r.state) > hits(base)); assert.deepEqual(r.state.patterns.slice(0, 6), base.patterns.slice(0, 6)); });
  t('section edits skip without song mode', () => { const r = describe('longer intro', { ...base, chainOn: false }, { style: 'deephouse' }); assert.equal(r.did.length, 0); });
  t('validate scoped section edits', () => {
    const v = validateEdits([
      { id: 'section', sec: 'bars', bars: [9, 16], op: 'mute', tracks: ['ch'] }, { id: 'section', sec: 'bars', bars: [-8, -1], op: 'tension', amt: 9 },
      { id: 'section', sec: 'drop', nth: 2, op: 'octave', tracks: ['acid', 'kick'], amt: 1.4 }, { id: 'section', sec: 'drop', nth: -1, op: 'skip' },
      { id: 'section', sec: 'bars', bars: [16, 9], op: 'mute', tracks: ['ch'] }, { id: 'section', sec: 'bars', bars: [0, 4], op: 'strip' }, { id: 'section', sec: 'bars', bars: [-4, 4], op: 'strip' },
      { id: 'section', sec: 'bars', bars: [1, 999], op: 'strip' }, { id: 'section', sec: 'bars', op: 'strip' }, { id: 'section', sec: 'bars', bars: [1, 8], op: 'skip' },
      { id: 'section', sec: 'drop', nth: 12, op: 'strip' }, { id: 'section', sec: 'drop', nth: 'x', op: 'strip' }, { id: 'section', sec: 'drop', op: 'octave', tracks: ['kick'], amt: 1 },
      { id: 'section', sec: 'drop', op: 'octave', tracks: ['acid'], amt: 0 }, { id: 'section', sec: 'drop', op: 'evil' },
    ]);
    assert.deepEqual(v.map(({ src, ...e }) => e), [
      { id: 'section', sec: 'bars', op: 'mute', bars: [9, 16], tracks: ['ch'] }, { id: 'section', sec: 'bars', op: 'tension', bars: [-8, -1], amt: 3 },
      { id: 'section', sec: 'drop', op: 'octave', nth: 2, tracks: ['acid'], amt: 1 }, { id: 'section', sec: 'drop', op: 'skip', nth: -1 },
    ]);
  });
  t('validate section edits', () => {
    const v = validateEdits([{ id: 'section', sec: 'drop', op: 'energy', amt: 9 }, { id: 'section', sec: 'nowhere', op: 'skip' }, { id: 'section', sec: 'intro', op: 'mute', tracks: ['kick', 'evil'] }, { id: 'section', sec: 'intro', op: 'mute', tracks: [] }]);
    assert.deepEqual(v.map(({ src, ...e }) => e), [{ id: 'section', sec: 'drop', op: 'energy', amt: 3 }, { id: 'section', sec: 'intro', op: 'mute', tracks: ['kick'] }]);
  });
}

// Mix-aware: a measurement re-sizes level and muddy/harsh fixes.
{
  const base = songFor('deephouse');
  const m = (tracks, bands = { subShare: 0.3, lowShare: 0.2, mudShare: 0.165, harshShare: 0.0095 }) => ({ tracks, bands });
  const fix = (text, meas) => { const p = parse(text, { style: 'deephouse' }); return { p, ...mixAdjust(p.edits, meas, base) }; };
  const lvl = (edits, id) => edits.find((e) => e.id === 'level' && e.target === id);
  t('needsMix only for level and muddy/harsh', () => {
    for (const x of ['the bass is too loud', 'louder kick', 'turn the hats up', "it's muddy", 'too harsh']) assert.ok(needsMix(parse(x, { style: 'deephouse' }).edits), x);
    for (const x of ['darker', 'faster', 'no vocals', 'longer intro']) assert.ok(!needsMix(parse(x, { style: 'deephouse' }).edits), x);
  });
  t('a bass far over its usual level comes down to it', () => {
    const e = lvl(fix('the bass is too loud', m({ acid: TYPICAL.acid + 7 })).edits, 'acid');
    assert.ok(e.db <= -7.5 && e.db >= -8.5, String(e.db));
  });
  t('a bass already under its usual level moves a small step', () => assert.equal(lvl(fix('the bass is too loud', m({ acid: TYPICAL.acid - 5 })).edits, 'acid').db, -1.5));
  t('quiet hats come up to their usual level', () => assert.ok(lvl(fix('louder hats', m({ ch: TYPICAL.ch - 8 })).edits, 'ch').db >= 8.5));
  t('level fixes are bounded', () => { const e = lvl(fix('the kick is too loud', m({ kick: 40 })).edits, 'kick'); assert.ok(e.db >= -12); });
  t('mix-aware dB shows in the receipt and lands on the knob', () => {
    const r = fix('the bass is too loud', m({ acid: TYPICAL.acid + 7 }));
    const a = applyEdits(base, r.edits, { seed: 1, style: 'deephouse' });
    assert.match(a.did.join(), /quieter bass \(−\d/);
    assert.ok(Math.abs(20 * Math.log10(a.state.params.acid.level / base.params.acid.level) - lvl(r.edits, 'acid').db) < 0.1);
  });
  t('muddier mixes get a bigger muddy fix', () => {
    const tone = (x) => fix("it's muddy", m({}, { subShare: 0.3, lowShare: 0.2, mudShare: x, harshShare: 0.0095 })).edits.find((e) => e.id === 'tone').amt;
    assert.ok(tone(0.33) > tone(0.165) && tone(0.165) > tone(0.04));
    assert.match(fix("it's muddy", m({}, { subShare: 0.3, lowShare: 0.2, mudShare: 0.33, harshShare: 0.01 })).notes.join(), /low-mids measured heavy/);
  });
  t('unmeasured tracks keep the plain step', () => { const p = parse('louder vocals', { style: 'deephouse' }); assert.deepEqual(mixAdjust(p.edits, m({}), base).edits, p.edits); });
}

// Voice input: speech-engine spellings and filler, best alternative wins.
t('"base" means bass', () => { for (const x of ['more base', 'the base is too loud', 'baseline louder']) assert.equal(parse(x).edits[0]?.target, 'acid', x); });
t('heard() fixes misheard words and filler', () => {
  assert.equal(heard(['more reverb on the courts']), 'more reverb on the chords');
  assert.equal(heard(['Okay, make it 140 beats per minute.']), 'make it 140 bpm');
  assert.equal(heard(['um make it darker please']), 'make it darker');
});
t('heard() prefers an alternative the parser understands', () => assert.equal(heard(['mike it docker', 'make it darker']), 'make it darker'));
t('heard() keeps the top transcript when none parse', () => assert.equal(heard(['purple monkey', 'purple monkeys']), 'purple monkey'));

// AI fallback (/api/describe): only validated edits come back, misses are logged when allowed.
{
  const { handleDescribe, coerce, aiEnv } = await import('../api/_lib/describe-ai.js');
  const { memoryKv, summarize } = await import('../api/_lib/events.js');
  const reply = (content) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  const call = (text, content, { body, ...extra } = {}) => handleDescribe({ method: 'POST', body: { text, style: 'deephouse', ...body }, provider: 'openrouter', key: 'k', fetchImpl: reply(content), ...extra });
  const tests = [];
  tests.push(call('driving through tokyo at night', JSON.stringify({ edits: [{ id: 'tone', amt: 9 }, { id: 'evil', amt: 1 }, { id: 'lock', target: 'kick', value: true }, { id: 'space', amt: 1 }] })).then((r) => t('AI edits are validated and bounded', () => {
    assert.equal(r.status, 200); assert.deepEqual(r.json.edits.map(({ src, ...e }) => e), [{ id: 'tone', amt: 3 }, { id: 'space', amt: 1 }]);
  })));
  t('coerce reads {"tone": -1} shorthand', () => assert.deepEqual(validateEdits(coerce([{ tone: -1 }, { scale: 'dorian' }, { hook: 1 }])).map(({ src, ...e }) => e), [{ id: 'tone', amt: -1 }, { id: 'scale', value: 'dorian' }, { id: 'hook', value: 1 }]));
  tests.push(call('x', 'not json').then((r) => t('bad model output is a 502 with no edits', () => { assert.equal(r.status, 502); assert.deepEqual(r.json.edits, []); })));
  tests.push(handleDescribe({ method: 'POST', body: { text: 'hello' } }).then((r) => t('no key: 501, nothing called', () => assert.equal(r.status, 501))));
  t('aiEnv prefers OpenRouter', () => { assert.equal(aiEnv({ OPENROUTER_API_KEY: 'a', GEMINI_API_KEY: 'b' }).provider, 'openrouter'); assert.equal(aiEnv({ GEMINI_API_KEY: 'b' }).provider, 'gemini'); assert.equal(aiEnv({}).key, ''); });
  const kv = memoryKv();
  tests.push((async () => {
    await call('like a rainy sunday', JSON.stringify({ edits: [{ id: 'dust', amt: 1 }] }), { kv, body: { log: true } });
    await call('secret phrase', JSON.stringify({ edits: [] }), { kv, body: { log: false } });
    const s = await summarize(kv, { days: 7 });
    t('misses are logged only when allowed and show in the summary', () => { assert.equal(s.misses.length, 1); assert.equal(s.misses[0].text, 'like a rainy sunday'); assert.equal(s.misses[0].ai, 'dust'); });
    let last;
    for (let i = 0; i < 31; i++) last = await call('again', '{"edits":[]}', { kv, client: 'flood' });
    t('rate limited per client', () => assert.equal(last.status, 429));
  })());
  await Promise.all(tests);
}

await done;
if (fails) { console.error(`describe: ${fails} failing`); process.exit(1); }
console.log('describe: ok');
