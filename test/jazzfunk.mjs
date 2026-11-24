import assert from 'node:assert/strict';
import './jazz-rhodes.mjs';
import { readFileSync } from 'node:fs';
import { freshSong, sanitize } from '../js/state.js';
import { Engine, Sequencer, feelTempo, parseChain } from '../js/engine.js';
import { Recorder } from '../js/midi.js';
import { jazzHarmony, jazzNotes, jazzVoicing, jazzMelody } from '../js/jazz.js';
import { funkBass, funkGroove, funkNotes, FUNK_PROGS } from '../js/jazzfunk.js';
import { CHORDS, TRACK_IDS } from '../js/params.js';
import { parse } from '../js/describe.js';
import { styleFor } from '../js/song-plan.js';
import { liveSets } from '../js/livekit.js';
import { TRUMPET_BANKS } from '../js/jazz-winds.js';
import { stageScene } from '../js/club-stage.js';
import { runComposition, compositionRegressions } from '../scripts/composition.mjs';
import { songState } from '../js/song-spec.js';
import { swingLate } from '../js/groove.js';

const pc = (n) => (n % 12 + 12) % 12;
{
  const s = freshSong('jazzfunk', 42), chain = parseChain(s.chain);
  s.ending = true;
  for (const feel of ['dark', 'longing', 'dreamy', 'heartbroken', null, 'invalid']) {
    s.feel = feel;
    for (const pos of [0, chain.length - 3, chain.length - 2, chain.length - 1]) {
      for (const step of [0, 8, 15]) assert.equal(feelTempo(s, chain, pos, step), 1, `${feel}: Jazz-Funk keeps its strict pocket through the ending`);
    }
    assert.equal(feelTempo(s, [], 0, 0), 1);
    const levels = [], seq = new Sequencer(new Recorder(s), s);
    seq.level = (t, db) => levels.push(db);
    seq.cur = 2;
    seq.sectionLevel(0, 16, 0);
    assert.deepEqual(levels, [-1.8], `${feel}: Jazz-Funk retains its written verse level`);
  }
}
{
  const probe = (velocity, notes = [0], params = {}, style = 'jazzfunk') => {
    const oscillators = [], gains = [], filters = [];
    const param = () => ({ value: 0, events: [], setValueAtTime(v, t) { assert(Number.isFinite(v)); this.events.push(['set', v, t]); }, linearRampToValueAtTime(v, t) { assert(Number.isFinite(v)); this.events.push(['ramp', v, t]); }, setTargetAtTime(v, t, tau) { assert(Number.isFinite(v)); this.events.push(['target', v, t, tau]); } });
    const node = () => ({ connect(n) { return n; }, frequency: param(), gain: param(), pan: param(), stop() {} });
    const state = freshSong(style, 42);
    const e = { state, playingPattern: state.patterns[6], rhodesKeys: () => false, ctx: {
      createOscillator() { const n = node(); oscillators.push(n); return n; }, createStereoPanner: node,
    }, gain(v) { const n = node(); n.gain.value = v; gains.push(n); return n; }, filter(type, f) { const n = node(); n.type = type; n.frequency.value = f; filters.push(n); return n; }, startSource() {}, rec() { throw Error('Rhodes must not consult recorded banks'); }, playBuf() { throw Error('Rhodes must not schedule a sample'); } };
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
const record = (s, bars = 8, setup = () => {}) => {
  const e = new Recorder(s), seq = new Sequencer(e, s);
  setup(e);
  for (let i = 0; i < bars * 16; i++) seq.tick(i, 0.05 + i * e.stepDur);
  return e.notes;
};
for (const chord of ['Isus2', 'Isus4']) {
  const { state } = songState({ style: 'jazzfunk', bpm: 100, key: 'C', scale: 'major', sections: [{ role: 'drop', bars: 16, chords: [chord] }] }, 0);
  const notes = record(state, 16);
  assert(notes.hook.length, `${chord}: valid suspended spec retains its head`);
  assert(notes.hook.every((n) => Number.isFinite(n.m) && n.m >= 69 && n.m <= 80), `${chord}: playable fallback register`);
  assert.deepEqual(notes, record(state, 16), `${chord}: deterministic fallback`);
  for (const p of state.patterns) p.hook = null;
  assert(!record(state, 16).hook, `${chord}: missing hook stays silent`);
}
for (const seed of [1, 2, 3, 11, 42, 77, 1234, 12345, 0x12345678]) {
  const s = freshSong('jazzfunk', seed), p = s.patterns[6];
  const saved = sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(saved.patterns, s.patterns); assert.equal(saved.scale, s.scale);
  assert(s.bpm >= 96 && s.bpm <= 110);
  assert(['dorian', 'major'].includes(s.scale));
  assert.equal(s.master.swing8, 0.5); assert.equal(s.swing, 0.15);
  assert.equal(s.master.duck, 0); assert.equal(s.master.kit, 1);
  assert.equal(s.params.stab.voice, 1); assert.equal(s.params.acid.voice, 5);
  assert(s.params.stab.env <= 0.15 && s.params.stab.cutoff <= 1800);
  for (const set of ['kit', 'ebass', 'horn', 'gtr', 'gtrmute', 'kitx', ...TRUMPET_BANKS]) assert(liveSets(s).includes(set), set);
  assert(!liveSets(s).includes('tpt'), 'recorded trumpet banks do not preload an unused legacy fallback');
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
    assert(bass.some(([, dur, , v]) => dur < 0.3 && v >= 0.26 && v < 0.3), 'ghost bass stays short but audible');
    assert(bass.some(([, , m]) => m === bass[0][2] + 12));
    for (const [step, dur, m] of bass) {
      assert(dur > 0 && m >= 26 && m <= 51);
      if (step % 8 === 0) assert(tones.some((n) => pc(s.key + h.r + n) === pc(m)));
    }
    for (const [step, dur, n] of jazzNotes('jazzfunk', seed, bar, h, true)) {
      assert(step >= 0 && step < 16 && dur > 0 && dur <= 32, 'lead onsets stay in the bar while ties may cross it');
      if (step % 4 === 0) assert(tones.some((v) => pc(h.r + v) === pc(n)));
    }
    const voicing = jazzVoicing(h, s.key, 'jazzfunk');
    assert(voicing.length >= 3 && voicing.length <= 4);
    assert(voicing.every((n) => n >= 60 && n <= 79));
    if (h.c === 16) assert(voicing.some((n) => pc(n - s.key - h.r) === 5), 'minor eleventh in Rhodes voicing');
  }
  const notes = record(s), sd = 60 / s.bpm / 4;
  assert(notes.hook.every((n) => n.m >= 69 && n.m <= 80), 'projected trumpet register across keys');
  assert(!notes.ride && !notes.clap && !notes.vox && notes.guitar.length);
  for (let bar = 0; bar < 2; bar++) {
    const events = (id) => (notes[id] || []).filter((n) => Math.floor(Math.round((n.t - 0.05) / sd) / 16) === bar);
    const at = (id) => events(id).map((n) => (Math.round((n.t - 0.05) / sd) % 16 + 16) % 16);
    const groove = funkGroove(seed, bar);
    assert.deepEqual(at('kick'), groove.kick); assert.deepEqual(at('snare'), groove.snare);
    assert.deepEqual(at('ch'), groove.ch); assert.deepEqual(at('oh'), groove.oh);
    assert(at('kick').every((i) => at('acid').includes(i)), 'every kick locks to a bass pluck');
    assert(events('snare').some((n) => n.v >= 0.25 && n.v < 0.3) && events('snare').some((n) => n.v === 0.76));
    assert(at('guitar').every((i) => !at('stab').includes(i)), 'guitar leaves the keys room');
  }
  const muted = structuredClone(s); muted.mutes = Object.fromEntries(TRACK_IDS.map((id) => [id, true]));
  assert.deepEqual(record(muted), {});
  const solo = structuredClone(s); solo.solos = { acid: true };
  assert.deepEqual(Object.keys(record(solo)), ['acid']);
  solo.solos = { perc: true };
  assert.deepEqual(Object.keys(record(solo)), ['guitar']);
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
assert.deepEqual(jazzNotes('jazzfunk', 42, 15, { r: 0, c: 16 }), [], 'cadence leaves a breath for the band');
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
  const late = (n) => (n.t - 0.05 - step(n) * sd - swingLate(s, step(n), sd)) * 1000;
  assert(notes.kick.every((n) => Math.abs(late(n)) <= 1.00001));
  assert(notes.snare.filter((n) => [4, 12].includes(step(n) % 16)).every((n) => Math.abs(late(n)) <= 1.00001));
  assert(notes.snare.filter((n) => ![4, 12].includes(step(n) % 16)).every((n) => late(n) >= 5.99999 && late(n) <= 10.00001));
  assert(notes.ch.filter((n) => step(n) % 2).every((n) => late(n) >= 0.99999 && late(n) <= 9.00001));
  assert(notes.guitar.every((n) => late(n) >= 1.99999 && late(n) <= 8.00001));
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
    const part = id === 'perc' ? 'guitar' : id;
    row.fill(id === 'acid' ? { on: false, n: 0, a: false, s: false } : 0);
    assert(!record(edited)[part]?.length, `${id}: clearing the row silences the part`);
    row[1] = id === 'acid' ? { on: true, n: 3, a: false, s: false } : 1;
    assert(record(edited)[part]?.length, `${id}: an added hit is played`);
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
  assert(record(s).guitar.length, 'guitar is independent of the lead hook');
}
{
  const hats = (decay, loaded = true, mode = 1) => {
    const s = freshSong('jazzfunk', 42), calls = [], buf = { duration: 0.3 };
    s.params.oh.decay = decay; s.master.kit = mode;
    record(s, 8, (e) => {
      e.ch = { oh: { input: {} } };
      e.rec = (name) => name === 'kit' && loaded ? { hh_half: buf, hh_half_2: buf } : null;
      e.liveFx = Engine.prototype.liveFx;
      e.playBuf = (...args) => calls.push(args);
    });
    return calls;
  };
  const natural = hats(0.32), short = hats(0.001);
  assert(natural.length && natural.length === short.length);
  assert(short.every((a, i) => a[5] === Math.min(0.03, natural[i][5])), 'recorded hats honor DECAY without delaying the next-downbeat choke');
  assert(short.some((a, i) => a[5] < natural[i][5]), 'DECAY audibly shortens recorded hats');
  assert.deepEqual(hats(0.001, false), [], 'unloaded kit uses the synth path');
  assert.deepEqual(hats(0.001, true, 0), [], 'synth kit never schedules recorded hats');
}
const phrases = (notes, sd) => {
  const spans = [];
  for (const n of [...notes].sort((a, b) => a.t - b.t)) {
    const last = spans.at(-1);
    if (!last || n.t - last[1] >= 2 * sd - 1e-8) spans.push([n.t, n.t + n.dur]);
    else last[1] = Math.max(last[1], n.t + n.dur);
  }
  return spans.map(([a, b]) => (b - a) / (16 * sd));
};
for (const seed of [0, 42, 77, 12345, 1e9]) {
  const s = freshSong('jazzfunk', seed), sd = 60 / s.bpm / 4;
  s.chain = 'G'.repeat(16) + 'C'.repeat(48) + 'H'.repeat(16); s.ending = true;
  const notes = record(s, 80);
  const step = (n) => Math.round((n.t - 0.05) / sd);
  const within = (id, from, to) => (notes[id] || []).filter((n) => step(n) >= from * 16 && step(n) < to * 16);
  assert(!within('hook', 0, 4).length, 'four-bar rhythm intro is trumpet tacet');
  assert(within('stab', 0, 2).length && within('stab', 0, 2).every((n) => n.v === 0.35), 'quiet intro comping maintains the band level');
  for (const id of ['kick', 'acid', 'guitar']) assert(within(id, 0, 2).length, `${id}: rhythm section opens the song`);
  assert(within('hook', 4, 6).length, 'head phrase A enters at bar four');
  assert(within('stab', 32, 36).every((n) => n.v === 0.35) && within('stab', 36, 38).some((n) => n.v === 0.48), 'keys lay back for the second chorus, then return');
  assert(!within('hook', 62, 64).length && within('ch', 62, 64).length && within('guitar', 62, 64).length, 'quiet hats and guitar keep time under the band hits');
  for (const [bar, figure] of [[62, [0, 6, 10]], [63, [0, 3, 6, 12, 15]]]) {
    for (const id of ['kick', 'snare', 'stab', 'acid']) {
      assert.deepEqual([...new Set(within(id, bar, bar + 1).map((n) => step(n) % 16))], figure, `${id}: band break figure`);
    }
  }
  const peak = within('hook', 60, 61);
  assert.equal(peak.length, 1); assert(peak[0].m >= 76 && peak[0].m <= 80 && peak[0].dur >= 16 * sd, 'last solo chorus peaks within the recorded trumpet range on a held chord tone');
  const early = within('hook', 16, 30), late = within('hook', 48, 60);
  assert(late.length / 12 > early.length / 14 * 2, 'solo density builds by section-relative chorus');
  for (const [name, from, to] of [['head', 4, 16], ['solos', 16, 64], ['head-out', 64, 80]]) {
    const lead = within('hook', from, to), lengths = phrases(lead, sd);
    assert(lengths.reduce((a, b) => a + b, 0) / lengths.length >= 1.5, `${name}: phrases average at least 1.5 bars`);
    assert(lead.some((n) => step(n) % 16 >= 14 && n.dur > (16 - step(n) % 16) * sd), `${name}: anticipation sustains over the barline`);
    assert(lead.some((n) => n.dur >= 16 * sd), `${name}: held cadence or peak`);
  }
  assert(notes.hook.every((n) => n.m >= 69 && n.m <= 80));
  for (const id of ['kick', 'stab', 'acid', 'oh']) assert.deepEqual([...new Set(within(id, 79, 80).map((n) => step(n) % 16))], [0], `${id}: final unison downbeat`);
  for (const id of ['hook', 'ch', 'snare', 'guitar']) assert(!within(id, 79, 80).length, `${id}: no extra attacks after the final hit`);
  const lastBass = within('acid', 79, 80)[0];
  assert.equal(pc(lastBass.m - s.key), pc(s.patterns[7].prog[0].r), 'ending resolves to the opening tonic chord');
  assert.deepEqual(record(s, 80), notes, 'full lead and arrangement are deterministic');
  const short = structuredClone(s); short.chain = 'G'.repeat(10) + 'C'.repeat(32) + 'H'.repeat(16);
  const moved = record(short, 58), movedKeys = moved.stab.filter((n) => n.t >= 0.05 + 26 * 16 * sd && n.t < 0.05 + 30 * 16 * sd);
  assert(movedKeys.length && movedKeys.every((n) => n.v === 0.35), 'second-chorus lay-back follows the section, not absolute song bars');
  const fill = moved.snare.filter((n) => Math.round((n.t - 0.05) / sd) >= 9 * 16 && Math.round((n.t - 0.05) / sd) < 10 * 16).map((n) => Math.round((n.t - 0.05) / sd) % 16);
  assert([10, 13, 14, 15].every((i) => fill.includes(i)), 'off-cycle section boundary gets a transition fill');
  const raw = (headOut) => Array.from({ length: 16 }, (_, bar) => funkNotes(seed, bar, jazzHarmony(s.patterns[6], bar), false, { headOut }));
  assert.notDeepEqual(raw(false), raw(true), 'head-out ornaments and cadence vary the head');
  const line = funkNotes(seed, 32, { r: 0, c: 16 }, true, { sectionBars: 64 });
  assert(line.some(([at, , n], i) => at % 4 === 3 && line[i + 1]?.[0] === at + 1 && pc(line[i + 1][2] - n) === 1), 'later solo lines resolve chromatic approaches into chord tones');
  assert.deepEqual(funkNotes(seed, 0, { r: 0, c: 16 }, true, { sectionBars: 0 }), [], 'empty solo section is silent');
  for (const slot of [2, 6]) {
    const preview = structuredClone(s); preview.chainOn = false; preview.current = slot;
    const lead = record(preview, 4).hook;
    assert(lead?.length && phrases(lead, sd).some((n) => n >= 1.5), 'unchained pattern previews keep complete lead phrases');
  }
}
{
  const rhythms = [42, 77, 12345, 0, 1, 314159, 271828, 1e9].map((seed) => JSON.stringify(Array.from({ length: 12 }, (_, bar) => funkNotes(seed, bar, { r: 0, c: 16 }).map(([at, dur]) => [at, dur]))));
  assert(new Set(rhythms).size >= 7, 'seeded heads have distinct rhythm plans, not just transposed pitches');
  assert.notEqual(rhythms[0], rhythms[1], '42 and 77 no longer share a rhythm plan');
}
for (const seed of [42, 77, 12345, 0, 1, 314159, 271828, 1e9]) {
  const s = freshSong('jazzfunk', seed), sd = 60 / s.bpm / 4, notes = record(s, s.chain.length);
  const headOut = s.chain.indexOf('H'), high = (from, to) => Math.max(...notes.hook.filter((n) => n.t >= 0.05 + from * 16 * sd && n.t < 0.05 + to * 16 * sd).map((n) => n.m));
  assert(high(headOut + 8, headOut + 12) > Math.max(high(4, 16), high(headOut, headOut + 8)), `${seed}: head-out B saves the highest register for late in the form`);
  for (const [slot, from, to] of [[6, 4, 16], [7, s.chain.indexOf('H'), s.chain.length - 1]]) {
    const lead = notes.hook.filter((n) => n.t >= 0.05 + from * 16 * sd && n.t < 0.05 + to * 16 * sd);
    const groups = [];
    for (const n of lead) {
      let g = groups.at(-1);
      if (!g || n.t - g.end >= 2 * sd - 1e-8) groups.push(g = { end: n.t, pitches: [] });
      g.end = Math.max(g.end, n.t + n.dur); g.pitches.push(n.m);
    }
    for (const { pitches } of groups) {
      const intervals = pitches.slice(1).map((n, i) => Math.abs(n - pitches[i])).sort((a, b) => a - b);
      if (!intervals.length) continue;
      assert(intervals.at(-1) <= 9, `${seed}/${slot}: no octave-fold jumps inside a head phrase`);
      assert(intervals[Math.floor(intervals.length / 2)] <= 3, `${seed}/${slot}: head intervals are mostly steps and thirds`);
      assert(intervals.filter((n) => n > 5).length <= 1, `${seed}/${slot}: at most one larger leap per phrase`);
      assert(intervals.filter((n) => n === 0).length / intervals.length <= 0.25, `${seed}/${slot}: repeated notes do not flatten the phrase`);
      assert(pitches.every((n, i) => i < 2 || n !== pitches[i - 1] || n !== pitches[i - 2]), `${seed}/${slot}: no repeated-note triples`);
      assert(Math.max(...pitches) - Math.min(...pitches) >= 7, `${seed}/${slot}: each head phrase spans at least a fifth`);
      assert(intervals.at(-1) >= 5, `${seed}/${slot}: each head phrase has a purposeful fourth-to-sixth leap`);
      assert(pitches.some((n, i) => i > 0 && n - pitches[i - 1] >= 5 && n - pitches[i - 1] <= 9 && n - pitches[i + 1] >= 1 && n - pitches[i + 1] <= 3 && pitches[i + 1] - pitches[i + 2] >= 1 && pitches[i + 1] - pitches[i + 2] <= 3), `${seed}/${slot}: the leap resolves through two descending steps`);
      const median = (intervals[(intervals.length - 1) >> 1] + intervals[intervals.length >> 1]) / 2;
      assert(median >= 2 && median <= 3, `${seed}/${slot}: the median head interval is two to three semitones`);
    }
  }
  const a = funkNotes(seed, 0, { r: 0, c: 16 }), variant = funkNotes(seed, 4, { r: 0, c: 16 });
  assert.deepEqual(a.slice(0, 4).map((n) => n.slice(0, 3)), variant.slice(0, 4).map((n) => n.slice(0, 3)), 'A-prime restates the opening rhythm and contour before varying its ending');
}
{
  const heads = [42, 77, 12345, 0, 1, 314159, 271828, 1e9].map((seed) => [0, 1].flatMap((bar) => funkNotes(seed, bar, { r: 0, c: 16 }).map(([at, , n]) => [at + bar * 16, n])));
  assert(new Set(heads.map((ns) => JSON.stringify(ns.map(([at]) => at)))).size >= 6, 'at least six distinct opening head onset plans');
  assert(new Set(heads.map((ns) => JSON.stringify(ns.slice(1).map(([, n], i) => n - ns[i][1])))).size >= 6, 'head contours differ by more than transposition');
}
assert.deepEqual(compositionRegressions(runComposition(['jazzfunk']), JSON.parse(readFileSync(new URL('./composition-baseline.json', import.meta.url)))), [], 'Jazz-Funk development meets the unchanged composition scorecard');
console.log('jazzfunk: rootless harmony, seeded interlock, guitar/row edits, pocket/stereo, long motifs, leap/recovery heads, repeat/run/range limits, section-shaped solos, intro/breaks/final hit, mutes, persistence and seeded rhythm/contour diversity passed');
