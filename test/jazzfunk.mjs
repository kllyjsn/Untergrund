import assert from 'node:assert/strict';
import { freshSong, sanitize } from '../js/state.js';
import { Engine, Sequencer } from '../js/engine.js';
import { Recorder } from '../js/midi.js';
import { jazzHarmony, jazzNotes, jazzVoicing, jazzMelody } from '../js/jazz.js';
import { funkBass, FUNK_KICK, FUNK_SNARE } from '../js/jazzfunk.js';
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
    const e = { state, playingPattern: state.patterns[6], rhodesKeys: () => false, ctx: {
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
const record = (s) => {
  const e = new Recorder(s), seq = new Sequencer(e, s);
  for (let i = 0; i < 32; i++) seq.tick(i, 0.05 + i * e.stepDur);
  return e.notes;
};
for (const seed of [1, 2, 3, 11, 42, 77, 1234, 12345, 0x12345678]) {
  const s = freshSong('jazzfunk', seed), p = s.patterns[6];
  const saved = sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(saved.patterns, s.patterns); assert.equal(saved.scale, s.scale);
  assert(s.bpm >= 96 && s.bpm <= 110);
  assert(['dorian', 'mixolydian'].includes(s.scale));
  assert.equal(s.master.swing8, 0); assert(s.swing >= 0.1 && s.swing <= 0.2);
  assert.equal(s.master.duck, 0); assert.equal(s.master.kit, 1);
  assert.equal(s.params.stab.voice, 1); assert.equal(s.params.acid.voice, 5);
  assert(s.params.stab.env <= 0.15 && s.params.stab.cutoff <= 1800);
  for (const set of ['kit', 'ebass', 'tpt', 'horn']) assert(liveSets(s).includes(set), set);
  assert.equal(stageScene('jazzfunk', s).kind, 'band');
  assert(s.chain.match(/^G+C+H+$/));
  assert(new Set(p.prog.map((h) => `${h.r}/${h.c}`)).size > 1, 'bridge leaves the vamp');
  for (let bar = 0; bar < 32; bar++) {
    const h = jazzHarmony(p, bar), bass = funkBass(s.key, h, bar), tones = CHORDS[h.c].iv;
    assert.equal(pc(bass[0][2] - s.key), pc(h.r));
    assert(bass.some(([, dur, , v]) => dur < 0.6 && v <= 0.5));
    assert(bass.some(([, , m]) => m === bass[0][2] + 12));
    for (const [step, dur, m] of bass) {
      assert(dur > 0 && m >= 28 && m <= 51);
      if (step % 8 === 0) assert(tones.some((n) => pc(s.key + h.r + n) === pc(m)));
    }
    for (const [step, dur, n] of jazzNotes('jazzfunk', seed, bar, h, true)) {
      assert(dur > 0 && step + dur <= 16);
      if (step % 4 === 0) assert(tones.some((v) => pc(h.r + v) === pc(n)));
    }
    const voicing = jazzVoicing(h, s.key, 'jazzfunk');
    assert(voicing.every((n) => n >= 48 && n <= 76));
    if (h.c === 16) assert(voicing.some((n) => pc(n - s.key - h.r) === 5), 'minor eleventh in Rhodes voicing');
  }
  const notes = record(s), sd = 60 / s.bpm / 4;
  assert(notes.hook.every((n) => n.m >= 69 && n.m <= 80), 'projected trumpet register across keys');
  assert(!notes.ride && !notes.clap && !notes.perc && !notes.vox);
  for (let bar = 0; bar < 2; bar++) {
    const events = (id) => notes[id].filter((n) => n.t >= 0.05 + bar * 16 * sd - 0.001 && n.t < 0.05 + (bar + 1) * 16 * sd - 0.001);
    const at = (id) => events(id).map((n) => Math.round((n.t - 0.05) / sd) % 16);
    assert.deepEqual(at('kick'), FUNK_KICK[bar]); assert.deepEqual(at('snare'), FUNK_SNARE);
    assert.deepEqual(at('ch'), Array.from({ length: 16 }, (_, i) => i).filter((i) => i !== 6 && i !== 14));
    assert.deepEqual(at('oh'), [6, 14]);
    assert(events('snare').some((n) => n.v === 0.18) && events('snare').some((n) => n.v === 0.72));
  }
  const muted = structuredClone(s); muted.mutes = Object.fromEntries(TRACK_IDS.map((id) => [id, true]));
  assert.deepEqual(record(muted), {});
  const solo = structuredClone(s); solo.solos = { acid: true };
  assert.deepEqual(Object.keys(record(solo)), ['acid']);
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
console.log('jazzfunk: aliases, warm FM palette, electric bass octaves/dead notes, ghost backbeat, hats, bridge vamp, strong-beat harmony, head/solos/head, mutes, solos and save/load passed');
