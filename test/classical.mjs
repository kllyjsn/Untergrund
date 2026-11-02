import assert from 'node:assert/strict';
import { compose, FORMS, PART_SECTION, SECTIONS } from '../js/classical.js';
import { generate, arrangement, songChain, sanitize, defaultState, STYLES } from '../js/state.js';
import { BAND } from '../js/livekit.js';
import { ORCH_KINDS, scoreKinds } from '../js/engine.js';

const mod = (n, m) => ((n % m) + m) % m;

// CLASSICAL is its own family; every form is a whole score, deterministic per seed.
for (const form of Object.keys(FORMS)) {
  assert.equal(STYLES[form]?.family, 'CLASSICAL', form);
  for (const mode of ['M', 'm']) {
    const a = compose({ form, seed: 5, mode }), b = compose({ form, seed: 5, mode }), c = compose({ form, seed: 6, mode });
    assert.equal(a, b, `${form} is cached and deterministic`);
    assert.notDeepEqual(a.notes.map((n) => n[1]), c.notes.map((n) => n[1]), `${form} changes with the seed`);
    assert(a.bars >= 32, `${form} is a movement, not a loop`);
    assert.equal(a.at.length, a.bars * 16);
    assert.equal(a.tempo.length, a.bars * 16);
    assert(a.tempo.every((t) => t > 0.85 && t < 1.9), `${form} rubato stays musical`);
    assert(a.tempo.at(-1) > 1.3, `${form} slows into the final chord`);
    for (const [at, m, d, v, part] of a.notes) {
      assert(Number.isFinite(at) && at >= 0 && at < a.bars * 16, `${form} note position`);
      assert(Number.isInteger(m) && m >= 21 && m <= 108, `${form} ${part} note ${m} on the piano range`);
      assert(d > 0 && v > 0 && v <= 1, `${form} duration/velocity`);
      assert(PART_SECTION[part], `${form} unknown part ${part}`);
    }
    // The last sounding chord is the tonic: a perfect cadence.
    const end = Math.max(...a.notes.map((n) => n[0])), last = a.notes.filter((n) => n[0] >= end - 1);
    const lowest = Math.min(...last.map((n) => n[1]));
    assert.equal(mod(lowest, 12), 0, `${form} ${mode} ends with the tonic in the bass`);
  }
}

{
  const s = compose({ form: 'symphony', seed: 9, mode: 'M' });
  const names = s.sections.map((x) => x.name);
  for (const n of ['THEME A', 'THEME B', 'DEVELOPMENT', 'RECAPITULATION', 'CODA']) assert(names.includes(n), `sonata form has ${n}`);
  const used = new Set(s.notes.map((n) => PART_SECTION[n[4]]));
  for (const sec of ['strings', 'winds', 'brass', 'timpani']) assert(used.has(sec), `symphony uses ${sec}`);
  const noc = compose({ form: 'nocturne', seed: 9, mode: 'm' });
  assert.deepEqual([...new Set(noc.notes.map((n) => n[4]))], ['pno'], 'nocturne is solo piano');
  assert.deepEqual(scoreKinds({ form: 'nocturne', seed: 9, mode: 'm' }).sort(), ['piano', 'pianoext', 'pianoextsoft', 'pianosoft'], 'nocturne loads only the piano');
  const con = compose({ form: 'concerto', seed: 9, mode: 'M' });
  assert(con.notes.some((n) => n[4] === 'pno') && con.notes.some((n) => n[4] === 'vln1'), 'concerto has a soloist and an orchestra');
}
console.log('classical forms, cadences and orchestration passed');

{
  for (const k of ORCH_KINDS) assert(BAND[k], `orchestra recording ${k} is in the band kit`);
  const g = generate('symphony', 77, 'minor');
  assert.deepEqual(Object.keys(g.pattern.score), ['form', 'seed', 'mode']);
  assert.equal(g.master.arr, 0, 'no club drops in a symphony');
  assert(Object.values(g.pattern.steps).every((row) => row.every((x) => !x || x.on === false)), 'drum machine rests');
  assert.equal(generate('symphony', 77, 'major').pattern.score.mode, 'M', 'MAJOR scale writes in a major key');
  assert.equal(songChain('symphony', 77), 'A');
  assert(arrangement(g.pattern, 77).every((p) => p.score?.form === 'symphony'));
  const st = defaultState();
  st.patterns = arrangement(g.pattern, 77);
  st.orch.brass = 0.4; st.orchMute.timpani = true;
  const back = sanitize(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(back.patterns[0].score, g.pattern.score, 'score survives save/load');
  assert.equal(back.orch.brass, 0.4); assert.equal(back.orchMute.timpani, true);
  const bad = sanitize({ ...st, orch: { strings: 9 }, patterns: [{ score: { form: 'polka', seed: 1 } }] });
  assert.equal(bad.orch.strings, 1.5); assert.equal(bad.patterns[0].score, undefined);
  assert.deepEqual(Object.keys(defaultState().orch), SECTIONS);
}
console.log('classical state, persistence and orchestra kit passed');
