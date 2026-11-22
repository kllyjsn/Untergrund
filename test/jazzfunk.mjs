import assert from 'node:assert/strict';
import { freshSong, sanitize } from '../js/state.js';
import { Engine, Sequencer } from '../js/engine.js';
import { Recorder } from '../js/midi.js';
import { jazzHarmony, jazzNotes, jazzVoicing, jazzMelody } from '../js/jazz.js';
import { funkBass, funkGroove, FUNK_PROGS } from '../js/jazzfunk.js';
import { CHORDS, TRACK_IDS } from '../js/params.js';
import { parse } from '../js/describe.js';
import { styleFor } from '../js/song-plan.js';
import { liveSets } from '../js/livekit.js';
import { stageScene } from '../js/club-stage.js';

const pc = (n) => (n % 12 + 12) % 12;
{
  const probe = (velocity, notes = [0], params = {}, style = 'jazzfunk') => {
    const oscillators = [], gains = [], filters = [];
    const param = () => ({ value: 0, events: [], setValueAtTime(v, t) { assert(Number.isFinite(v)); this.events.push(['set', v, t]); }, linearRampToValueAtTime(v, t) { assert(Number.isFinite(v)); this.events.push(['ramp', v, t]); }, setTargetAtTime(v, t, tau) { assert(Number.isFinite(v)); this.events.push(['target', v, t, tau]); } });
    const node = () => ({ connect(n) { return n; }, frequency: param(), gain: param(), pan: param(), stop() {} });
    const state = freshSong(style, 42);
    const e = { state, playingPattern: state.patterns[6], ctx: {
      createOscillator() { const n = node(); oscillators.push(n); return n; }, createStereoPanner: node,
    }, gain(v) { const n = node(); n.gain.value = v; gains.push(n); return n; }, filter(type, f) { const n = node(); n.type = type; n.frequency.value = f; filters.push(n); return n; }, startSource() {} };
    Engine.prototype.jazzKeys.call(e, 0, velocity, notes, 69, { decay: 0.5, cutoff: 2200, ...params }, node());
    return { oscillators, gains, filters };
  };
  const soft = probe(0.3), hard = probe(0.9);
  const bark = (p) => Math.max(...p.gains.flatMap(n => n.gain.events.filter(e => e[0] === 'set').map(e => e[1])));
  assert(bark(hard) > bark(soft), 'harder strikes excite more FM bark');
  assert(hard.oscillators.some(n => n.frequency.value === 440 * 1.0016), 'detuned tone bar beats against the tine');
  assert(hard.oscillators.some(n => n.frequency.value === 440 * 7.03), 'separate bell attack');
  const decays = hard.gains.flatMap(n => n.gain.events.filter(e => e[0] === 'target').map(e => e[3]));
  assert(decays.includes(0.028) && decays.includes(0.45), 'bell partial decays faster than the body');
  assert(hard.filters.some(n => n.type === 'peaking' && n.gain.value < 0), 'low-mid boxiness is attenuated');
  const graph = p => ({ frequencies: p.oscillators.map(n => n.frequency.value), envelopes: p.gains.map(n => n.gain.events) });
  assert.deepEqual(graph(probe(0.9, [0], { env: 0.12, detune: 0.6 })), graph(hard), 'generated Rhodes controls are neutral');
  assert.deepEqual(graph(probe(0.9, [0], { env: 0.45, detune: 12 }, 'modal')), graph(probe(0.9, [0], {}, 'modal')), 'standard KEYS defaults are neutral');
  const bright = probe(0.9, [0], { env: 1 }), mellow = probe(0.9, [0], { env: 0 });
  assert(bark(bright) > bark(mellow), 'ENV controls strike bark');
  const bodyDecay = p => p.gains.flatMap(n => n.gain.events).find(e => e[0] === 'target' && e[2] === 0.012)[3];
  assert(bodyDecay(bright) > bodyDecay(mellow), 'ENV changes body articulation');
  assert(probe(0.9, [0], { detune: 40 }).oscillators[3].frequency.value > probe(0.9, [0], { detune: 0 }).oscillators[3].frequency.value, 'DETUNE changes tone-bar beating');
  assert.deepEqual(graph(probe(0.9, [0], { env: NaN, detune: Infinity })), graph(hard), 'invalid controls fall back to neutral defaults');
  assert.equal(probe(1, []).oscillators.length, 0, 'empty voicing allocates nothing');
  probe(0);
  assert.throws(() => probe(NaN), 'invalid levels are not scheduled');
}
for (const text of ['jazz funk', 'jazz-funk', 'fusion', 'Headhunters', 'Herbie', 'Donald Byrd', 'Roy Ayers']) {
  assert.equal(styleFor(text), 'jazzfunk');
  assert(parse(text).edits.some((e) => e.id === 'genre' && e.value === 'jazzfunk'), text);
}
const record = (s, bars = 2, setup = () => {}) => {
  const e = new Recorder(s), seq = new Sequencer(e, s);
  setup(e);
  for (let i = 0; i < bars * 16; i++) seq.tick(i, 0.05 + i * e.stepDur);
  return e.notes;
};
for (const seed of [1, 2, 3, 11, 42, 77, 1234, 12345, 0x12345678]) {
  const s = freshSong('jazzfunk', seed), p = s.patterns[6];
  const saved = sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(saved.patterns, s.patterns); assert.equal(saved.scale, s.scale);
  assert(s.bpm >= 96 && s.bpm <= 110);
  assert(['dorian', 'major'].includes(s.scale));
  assert.equal(s.master.swing8, 0); assert.equal(s.swing, 0.06);
  assert.equal(s.master.duck, 0); assert.equal(s.master.kit, 1);
  assert.equal(s.params.stab.voice, 1); assert.equal(s.params.acid.voice, 5);
  assert(s.params.stab.env <= 0.15 && s.params.stab.cutoff <= 1800);
  for (const set of ['kit', 'ebass', 'tpt', 'horn', 'gtr', 'gtrmute']) assert(liveSets(s).includes(set), set);
  assert.equal(s.params.perc.pan, 0.45); assert(s.params.perc.level > 0);
  assert.equal(s.params.stab.pan, -0.15);
  for (const id of ['ch', 'oh']) assert.equal(s.params[id].pan, 0.25);
  for (const id of ['kick', 'snare', 'acid']) assert.equal(s.params[id].pan, 0);
  assert.equal(stageScene('jazzfunk', s).kind, 'band');
  assert(s.chain.match(/^G+C+H+$/));
  assert(new Set(p.prog.map((h) => `${h.r}/${h.c}`)).size > 1, 'bridge leaves the vamp');
  for (let bar = 0; bar < 32; bar++) {
    const h = jazzHarmony(p, bar), next = jazzHarmony(p, bar + 1), bass = funkBass(s.key, h, bar, seed, next), tones = CHORDS[h.c].iv;
    assert.equal(pc(bass[0][2] - s.key), pc(h.r));
    assert(bass.some(([, dur, , v]) => dur < 0.3 && v <= 0.15));
    assert(bass.some(([, , m]) => m === bass[0][2] + 12));
    for (const [step, dur, m] of bass) {
      assert(dur > 0 && m >= 26 && m <= 51);
      if (step % 8 === 0) assert(tones.some((n) => pc(s.key + h.r + n) === pc(m)));
    }
    for (const [step, dur, n] of jazzNotes('jazzfunk', seed, bar, h, true)) {
      assert(dur > 0 && step + dur <= 16);
      if (step % 4 === 0) assert(tones.some((v) => pc(h.r + v) === pc(n)));
    }
    const voicing = jazzVoicing(h, s.key, 'jazzfunk');
    assert(voicing.length >= 3 && voicing.length <= 4);
    assert(voicing.every((n) => n >= 60 && n <= 79));
    if (h.c === 16) assert(voicing.some((n) => pc(n - s.key - h.r) === 5), 'minor eleventh in Rhodes voicing');
  }
  const notes = record(s), sd = 60 / s.bpm / 4;
  assert(notes.hook.every((n) => n.m >= 69 && n.m <= 80), 'projected trumpet register across keys');
  assert(!notes.ride && !notes.clap && !notes.vox && notes.perc.length);
  for (let bar = 0; bar < 2; bar++) {
    const events = (id) => (notes[id] || []).filter((n) => Math.floor(Math.round((n.t - 0.05) / sd) / 16) === bar);
    const at = (id) => events(id).map((n) => (Math.round((n.t - 0.05) / sd) % 16 + 16) % 16);
    const groove = funkGroove(seed, bar);
    assert.deepEqual(at('kick'), groove.kick); assert.deepEqual(at('snare'), groove.snare);
    assert.deepEqual(at('ch'), groove.ch); assert.deepEqual(at('oh'), groove.oh);
    assert(at('kick').every((i) => at('acid').includes(i)), 'every kick locks to a bass pluck');
    assert(events('snare').some((n) => n.v <= 0.15) && events('snare').some((n) => n.v === 0.76));
    assert(at('perc').every((i) => !at('stab').includes(i)), 'guitar leaves the keys room');
  }
  const muted = structuredClone(s); muted.mutes = Object.fromEntries(TRACK_IDS.map((id) => [id, true]));
  assert.deepEqual(record(muted), {});
  const solo = structuredClone(s); solo.solos = { acid: true };
  assert.deepEqual(Object.keys(record(solo)), ['acid']);
  solo.solos = { perc: true };
  assert.deepEqual(Object.keys(record(solo)), ['perc']);
  assert.deepEqual(record(s, 16), record(s, 16), 'seeded full phrase is deterministic');
  let keys = 0, recorded = 0;
  Engine.prototype.stab.call({ state: s, step: 0, harm: jazzHarmony(p, 0), ch: { stab: { input: {}, band: {} } }, keys: () => keys++, recordedNote: () => recorded++ }, 0, 0.6);
  assert.equal(keys, 1); assert.equal(recorded, 0, 'main comping is FM keys, not a piano sample');
  const response = { state: s, step: 62, harm: jazzHarmony(p, 3), ch: { stab: { input: {}, band: {} } }, keys: () => keys++, recordedNote: () => recorded++, rec: () => [[60, {}]] };
  Engine.prototype.stab.call(response, 0, 0.6);
  assert.equal(recorded, 1, 'supporting horns answer the head breath');
  response.rec = () => null;
  Engine.prototype.stab.call(response, 0, 0.6);
  assert.equal(recorded, 1); assert.equal(keys, 3, 'missing horn samples retain Rhodes comping');
}
assert.deepEqual(jazzNotes('jazzfunk', 42, 3, { r: 0, c: 16 }), [], 'head leaves a bar for keys response');
assert(jazzMelody('jazzfunk', 42).n.length > 0, 'shared jazz melody helper resolves funk progressions');
const empty = freshSong('jazzfunk', 42); for (const p of empty.patterns) p.hook = null;
const rhythm = record(empty);
assert(!rhythm.hook && rhythm.acid.length && rhythm.kick.length && rhythm.stab.length, 'missing hook leaves rhythm section intact');
for (const prog of FUNK_PROGS) {
  assert.equal(prog.length, 8);
  assert(prog.filter(([, c]) => c === 15).length <= 1, 'altered dominant is only a two-bar turnaround');
  for (let key = 0; key < 12; key++) {
    const voices = prog.map(([r, c]) => jazzVoicing({ r, c }, key, 'jazzfunk'));
    voices.forEach((v, i) => {
      const [root, chord] = prog[i];
      assert(v.every((m) => pc(m - key - root) !== 0), 'comping leaves roots to the bassist');
      assert(v.every((m) => CHORDS[chord].iv.some((n) => pc(n) === pc(m - key - root))));
      assert(Math.abs(v.at(-1) - voices[(i + 1) % voices.length].at(-1)) <= 4, 'top voice moves at most a third including cycle seam');
    });
  }
}
{
  const s = freshSong('jazzfunk', 42), p = s.patterns[6], sd = 60 / s.bpm / 4;
  s.chain = 'G'.repeat(16); s.ending = false;
  const notes = record(s, 16);
  const step = (n) => Math.round((n.t - 0.05) / sd);
  const late = (n) => (n.t - 0.05 - step(n) * sd - (step(n) % 2 ? s.swing * sd * 0.5 : 0)) * 1000;
  assert(notes.kick.every((n) => Math.abs(late(n)) <= 1.00001));
  assert(notes.snare.filter((n) => [4, 12].includes(step(n) % 16)).every((n) => Math.abs(late(n)) <= 1.00001));
  assert(notes.snare.filter((n) => ![4, 12].includes(step(n) % 16)).every((n) => late(n) >= 5.99999 && late(n) <= 10.00001));
  assert(notes.ch.filter((n) => step(n) % 2).every((n) => late(n) >= 0.99999 && late(n) <= 9.00001));
  assert(notes.perc.every((n) => late(n) >= 1.99999 && late(n) <= 8.00001));
  for (const n of notes.kick) {
    const bass = notes.acid.find((b) => step(b) === step(n));
    assert(bass && (bass.t - n.t) >= 0.00399999 && (bass.t - n.t) <= 0.00600001);
  }
  const shapes = Array.from({ length: 16 }, (_, bar) => funkGroove(42, bar));
  assert(new Set(shapes.map((g) => JSON.stringify(g))).size > 12, 'bars develop rather than looping two fixed patterns');
  assert.notDeepEqual(shapes[3].snare, shapes[7].snare, 'large fills develop the four-bar pickup');
  assert.notDeepEqual(shapes[7], funkGroove(77, 7), 'fills differ by seed');
  const solo = funkGroove(42, 0, true);
  assert(solo.comp.length < shapes[0].comp.length, 'keys leave space for solos');
  for (const id of ['kick', 'snare', 'ch', 'oh', 'acid', 'stab', 'perc']) {
    const edited = structuredClone(s), row = edited.patterns[6].steps[id];
    row.fill(id === 'acid' ? { on: false, n: 0, a: false, s: false } : 0);
    assert(!record(edited)[id]?.length, `${id}: clearing the row silences the part`);
    row[1] = id === 'acid' ? { on: true, n: 3, a: false, s: false } : 1;
    assert(record(edited)[id]?.length, `${id}: an added hit is played`);
  }
  const calls = [], out = {}, kit = { hh_half: {}, hh_half_2: {} };
  record(s, 8, (e) => {
    e.ch = { perc: { input: out }, oh: { input: {} } };
    e.rec = (name) => name === 'kit' ? kit : [[69, { name }]];
    e.playBuf = (...args) => calls.push(['sample', ...args]);
    e.recordedNote = (...args) => calls.push(['chank', ...args]);
    e.liveFx = () => ({ rate: 1, fx: {} });
  });
  assert(calls.some(([type, buf, , , dest, , , fx]) => type === 'sample' && buf.name === 'gtrmute' && dest === out && fx.release === 0.02));
  assert(calls.some(([type, set, , , , , dest]) => type === 'chank' && set[0][1].name === 'gtr' && dest === out));
  for (const [type, buf, at, , dest, , dur, fx] of calls) if (type === 'sample' && dest !== out) {
    assert(fx.release === 0.005 && dur > 0, 'open hat is damped into the following downbeat');
    const close = 0.05 + (Math.floor(Math.round((at - 0.05) / sd) / 16) + 1) * 16 * sd;
    assert(Math.abs(at + dur + 0.025 - close) < 1e-8);
  }
  assert.doesNotThrow(() => record(s, 2, (e) => { e.rec = () => null; e.playBuf = e.recordedNote = () => assert.fail('unloaded guitar must skip, not synthesize'); }));
  p.hook = null;
  assert(record(s).perc.length, 'guitar is independent of the lead hook');
}
console.log('jazzfunk: moving rootless harmony, seeded interlock/fills, kick/bass lock, guitar recordings and row edits, pocket offsets, stereo seats, mutes/solos and save/load passed');
