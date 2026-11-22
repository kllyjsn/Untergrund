import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { installGlobals, OfflineAudioContext } from './offline-audio.mjs';
import { defaultState, generate, sanitize, arrangement, applyOverrides } from '../js/state.js';
import { rootsTags, rootsFor, cleanRoots, uprightNotes, fiddlePitch, fiddleRole, fiddleAnswerRoll } from '../js/roots.js';
import { Engine, Sequencer } from '../js/engine.js';
import { Recorder, songMidi } from '../js/midi.js';
import { stemList } from '../js/stems.js';
import { setVoice, clearVoice } from '../js/voice.js';
import { liveSets, withTakes, loadSets, assertRootsReady, bandKit, STAB_BAND } from '../js/livekit.js';

const failure = execFileSync(process.execPath, [new URL('./roots-failure.mjs', import.meta.url).pathname], { encoding: 'utf8' });
assert.match(failure, /S9 offline missing recordings rejected/);
assert.equal(STAB_BAND[7], 'piano');
assert.equal(cleanRoots({ style: 'pop', chord: 'upright' }), null);
assert.equal(rootsTags('folk', 42, 7, {}), null);
assert.equal(rootsTags('lofihiphop', 42, 1, {}), null);
assert.equal(rootsTags('country', 42, 7, { v: 'chop' }), null);
assert.equal(fiddleRole({ hook: 'twang', answer: 'fiddle' }, {}), false);
assert.equal(fiddleRole({ hook: 'twang', answer: 'fiddle' }, { role: 'fiddle-answer' }), true);
assert.deepEqual(uprightNotes(0, 1, [], 60, { decay: 1 }), []);
assert.deepEqual(uprightNotes(0, 1, [0], NaN, { decay: 1 }), []);
assert.deepEqual(uprightNotes(0, 0, [0], 60, { decay: 1 }), []);
assert.ok(fiddlePitch(40) >= 55 && fiddlePitch(96) <= 79);
const choices = Array.from({ length: 1000 }, (_, seed) => rootsTags('country', seed, 7, { v: 'warm' }));
assert.ok(choices.filter((r) => r.hook === 'fiddle').length > 440 && choices.filter((r) => r.hook === 'fiddle').length < 560);
const answerRate = Array.from({ length: 1000 }, (_, i) => fiddleAnswerRoll({ answer: 'fiddle', seed: 42 }, i * 4 + 3)).filter(Boolean).length;
assert.ok(answerRate > 200 && answerRate < 300);
for (const style of ['country', 'boombap', 'lofihiphop']) {
  const g = generate(style, 42), again = generate(style, 42);
  assert.deepEqual(g.pattern.roots, again.pattern.roots);
  const s = defaultState(); applyOverrides(s, g); s.patterns = arrangement(g.pattern, 42);
  assert.deepEqual(sanitize(s).patterns.map((p) => p.roots), s.patterns.map((p) => p.roots));
}
const assets = JSON.parse(readFileSync(new URL('../scripts/roots-samples.json', import.meta.url)));
assert.equal(assets.length, 90);
assert.equal(assets.filter((r) => r.file.startsWith('fiddle')).length, 54);
for (const r of assets) { assert.ok(Math.abs(r.cents_after) < 5, r.file); assert.ok(r.source.includes('440300901dfe9275fd84e0b7763af1f8443ae62e')); }

installGlobals();
const s = defaultState(); s.artist = { style: 'trap', seed: 42 };
s.patterns[0].roots = { style: 'country', seed: 42, hook: 'fiddle', answer: 'fiddle' };
assert.equal(rootsFor(s).style, 'country', 'saved playing style overrides listener genre');
s.patterns[0].jazz = { style: 'bossa' };
assert.equal(rootsFor(s), null, 'an active jazz pattern overrides a stale roots tag');
delete s.patterns[0].jazz;
const duet = defaultState();
duet.artist = { style: 'trap' }; duet.params.stab.voice = 7;
duet.patterns[0].roots = { style: 'boombap', chord: 'upright' };
duet.patterns[0].hook = { v: 'reed' };
const duetSets = withTakes(liveSets(duet));
for (const name of ['upright', 'uprightsoft', 'uprighthard', 'tsax', 'tsaxb']) assert.ok(duetSets.includes(name), name);
assert.ok(!duetSets.includes('asax'), 'saved Boom Bap loads its tenor, not the listener genre alto');
delete duet.patterns[0].hook;
assert.ok(!liveSets(duet).includes('tsax'), 'no hook needs no sax');
delete duet.patterns[0].roots;
assert.ok(!liveSets(duet).includes('upright'), 'no explicit role needs no upright');
const names = withTakes([...liveSets(s), 'upright', 'gtr', 'tsax']);
assert.throws(() => assertRootsReady(names), /Required recorded S9 samples unavailable/);
await loadSets(names);
assertRootsReady(names);
for (const name of names.filter((n) => n.startsWith('fiddle') || n.startsWith('upright'))) assert.ok(bandKit(name)?.length, name);
for (const r of assets) {
  const [prefix, note] = r.file.replace('.flac', '').split('_');
  const buffer = bandKit(prefix).find(([m]) => m === Number(note))[1];
  assert.equal(buffer.length, Math.round(r.seconds * 44100), r.file + ' decoded fully');
}
const e = new Engine(new OfflineAudioContext(1, 48000, 48000), s, { realtime: false });
e.playingPattern = s.patterns[0];
const buffers = [], treatments = [];
e.playBuf = (buf, ...args) => { buffers.push(buf); treatments.push(args.at(-1)); return {}; };
e.hook(.05, .7, 0, .5, 'warm');
assert.ok(buffers.length, 'recorded fiddle reaches the sample player');
assert.equal(treatments.at(-1).lpStages, undefined, 'upright filtering does not leak into fiddle');
assert.equal(treatments.at(-1).lpQ, undefined);
assert.ok(bandKit('fiddle').some(([, b]) => b === buffers.at(-1)));
e.hook(.6, .7, 0, .15, 'warm');
const first = buffers.at(-1);
e.hook(.6, .7, 0, .15, 'warm');
assert.notEqual(buffers.at(-1), first, 'spiccato alternates the real recorded takes');
{
  const roots = e.playingPattern.roots, chopNote = e.chopNote;
  const voice = { buffer: e.ctx.createBuffer(1, 4800, 48000), chops: [{ midi: 60, start: 0, end: .1 }] };
  let chops = 0;
  e.chopNote = (take) => { assert.equal(take, voice); chops++; };
  try {
    for (const hook of ['fiddle', 'twang']) {
      e.playingPattern.roots = { style: 'country', hook, answer: 'fiddle' };
      clearVoice();
      let before = buffers.length;
      e.hook(.8, .7, 0, .5, 'chop');
      assert.ok(buffers.length > before, `${hook} remains the fallback without a recording`);
      setVoice(voice, 'MY VOICE', false);
      before = buffers.length;
      e.hook(.9, .7, 0, .5, 'chop');
      assert.equal(buffers.length, before, `MY VOICE bypasses the saved ${hook} role`);
      const midi = new Recorder(s); midi.playingPattern = e.playingPattern;
      midi.hook(.9, .7, 0, .5, 'chop');
      assert.equal(midi.notes.fiddle, undefined);
      assert.equal(midi.notes.hook.length, 1);
      assert.equal(midi.hookVoice, 'chop', 'MIDI keeps the selected recording role');
    }
    assert.equal(chops, 2);
  } finally { clearVoice(); e.chopNote = chopNote; e.playingPattern.roots = roots; }
}
e.playingPattern.roots = { style: 'boombap', chord: 'upright' };
s.params.stab.voice = 7;
for (const [v, name] of [[.2, 'uprightsoft'], [.65, 'upright'], [1.1, 'uprighthard']]) {
  e.piano(1, v, [0], 60, s.params.stab, e.ch.stab.input);
  assert.ok(bandKit(name).some(([, b]) => b === buffers.at(-1)), name);
  assert.equal(treatments.at(-1).lpStages, 2, 'upright upper partials use the dusty low-pass');
  assert.equal(treatments.at(-1).lpQ, -6.0206, 'upright filtering does not boost the cutoff');
  assert.ok(treatments.at(-1).lp > 0 && treatments.at(-1).lp < 3500);
}
const rec = new Recorder(s); rec.playingPattern = e.playingPattern;
const actual = [];
e.recordedNote = (_set, t, _level, m, dur, _out, _tone, kind) => actual.push({ t, m, dur, kind });
e.stab(2, .7); rec.trigger('stab', 2, .7);
assert.deepEqual(actual.map(({ t, m, dur }) => ({ t, m, dur })), rec.notes.stab.map(({ t, m, dur }) => ({ t, m, dur })), 'upright MIDI matches recorded onsets, pitches and durations');
actual.length = 0; rec.notes.stab = [];
e.lick(2.5, .4, 2); rec.lick(2.5, .4, 2);
assert.deepEqual(actual.map(({ t, m, dur }) => ({ t, m, dur })), rec.notes.stab.map(({ t, m, dur }) => ({ t, m, dur })), 'upright fill MIDI matches playback');
actual.length = 0;
const windHook = e.windHook, saxCalls = [];
e.windHook = function (set, t, v, m, dur, voice, ...args) {
  saxCalls.push({ set, m, voice }); return windHook.call(this, set, t, v, m, dur, voice, ...args);
};
e.hook(2.75, .7, 0, .5, 'reed'); rec.hook(2.75, .7, 0, .5, 'reed');
assert.equal(saxCalls.at(-1).voice, 'tenorsax', 'upright role leaves the sax hook recorded');
assert.equal(saxCalls.at(-1).set, bandKit('tsax'), 'co-playing sax uses its loaded recordings');
assert.equal(rec.hookVoice, 'tenorsax', 'MIDI retains the sax program alongside upright');
assert.equal(saxCalls.at(-1).m, rec.notes.hook.at(-1).m, 'co-playing sax MIDI matches playback pitch');
e.windHook = windHook;
e.playingPattern.roots = { style: 'country', hook: 'fiddle', answer: 'fiddle' };
rec.playingPattern = e.playingPattern; actual.length = 0;
e.hook(3, .7, -20, .5, 'warm'); rec.hook(3, .7, -20, .5, 'warm');
assert.deepEqual(actual.map(({ t, m, dur }) => ({ t, m, dur })), rec.notes.fiddle.map(({ t, m, dur }) => ({ t, m, dur })), 'fiddle MIDI matches playback register and gate');
e.playingPattern.roots.hook = 'twang'; actual.length = 0; rec.notes.fiddle = [];
e.hook(4, .4, 7, .2, 'warm', 0, false, 1, false, { role: 'fiddle-answer' });
rec.hook(4, .4, 7, .2, 'warm', 0, false, 1, false, { role: 'fiddle-answer' });
assert.deepEqual(actual.map(({ t, m, dur }) => ({ t, m, dur })), rec.notes.fiddle.map(({ t, m, dur }) => ({ t, m, dur })), 'answer dispatch precedes twang for playback and MIDI');
const answerState = defaultState();
answerState.chainOn = false; answerState.current = 0; answerState.params.stab.voice = 7;
const pattern = answerState.patterns[0];
pattern.hook = { v: 'warm', o: 0, s: Array(32).fill(0), x: {} }; pattern.hm = 2;
let seed = 0; while (!fiddleAnswerRoll({ answer: 'fiddle', seed }, 3)) seed++;
pattern.roots = { style: 'country', seed, hook: 'twang', answer: 'fiddle' };
const ending = () => { const r = new Recorder(answerState); new Sequencer(r, answerState).tick(60, .05); return r.notes; };
assert.equal(ending().fiddle.length, 1, 'eligible empty phrase ending gets its deterministic answer');
assert.deepEqual(ending(), ending());
pattern.hm = 0;
assert.equal(ending().fiddle?.length || 0, 0, 'no melody also disables fiddle answers');
delete pattern.hm;
assert.equal(ending().fiddle?.length || 0, 0, 'missing melody presence gets no fiddle answer');
pattern.hm = 2;
assert.equal(ending().fiddle.length, 1, 'restoring melody restores the same deterministic answer');
pattern.hook.s[28] = [0, 3, .7];
assert.equal(ending().fiddle?.length || 0, 0, 'occupied phrase ending gets no answer');
pattern.hook.s[28] = 0; answerState.mutes.stab = true;
assert.equal(ending().fiddle?.length || 0, 0, 'muted lead gets no answer');
answerState.mutes.stab = false; pattern.roots.hook = 'fiddle'; pattern.hook.s[0] = [0, 2, .7];
assert.ok(songMidi(answerState).tracks.some((t) => t.id === 'fiddle'));
assert.ok(stemList(answerState).includes('hook'), 'fiddle MIDI track routes to the actual hook audio stem');
console.log('S9 assets loaded; dynamics, round robin, roles, replay, MIDI and offline failure tests passed');
