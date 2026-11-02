import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { study, render } from '../scripts/study-corpus.mjs';
import { MODELS, CORPUS } from '../js/composer-models.js';
import { compose, COMPOSERS } from '../js/classical.js';
import { sanitize, defaultState, generate } from '../js/state.js';

// The study is deterministic and the committed models are what it writes.
const text = render(study());
assert.equal(text, render(study()), 'the study is deterministic');
assert.equal(text, readFileSync(new URL('../js/composer-models.js', import.meta.url), 'utf8'), 'js/composer-models.js is up to date (run node scripts/study-corpus.mjs)');
assert(text.length < 30 * 1024, 'the models stay small');

const ids = new Set(readdirSync(new URL('../data/repertoire/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
assert.equal(CORPUS.scores, ids.size, 'every score is studied');
assert.deepEqual(COMPOSERS, Object.keys(MODELS));
for (const [name, m] of Object.entries(MODELS)) {
  assert(m.pieces.length && m.pieces.every((id) => ids.has(id)), `${name} lists only real repertoire ids`);
  for (const [from, row] of Object.entries(m.harmony.transitions)) {
    const sum = Object.values(row).reduce((a, b) => a + b, 0);
    assert(Math.abs(sum - 1) < 0.01, `${name} ${from} row sums to 1 (${sum})`);
  }
  for (const kind of ['perfect', 'half']) assert(Object.keys(m.harmony.cadences[kind] || {}).length, `${name} has ${kind} cadences`);
}
for (const c of ['Mozart', 'Beethoven', 'Schubert', 'Chopin']) assert(MODELS[c], `${c} has a model`);
for (const thin of Object.keys(CORPUS.thin)) assert(!MODELS[thin], `${thin} is too thin for its own model`);
assert(MODELS['Classical era'].pieces.some((id) => id.startsWith('haydn')), 'Haydn merges into the classical-era model');

// What the scores say: Chopin's accompaniments are more arpeggiated and his melodies more chromatic and leapier than Mozart's.
const [Mo, Ch] = [MODELS.Mozart, MODELS.Chopin];
assert(Ch.texture.arpeggio > Mo.texture.arpeggio * 1.4, 'Chopin arpeggiates more');
assert(Mo.texture.block > Ch.texture.block, 'Mozart writes more block chords / pulse');
assert(Ch.melody.chromatic > Mo.melody.chromatic, 'Chopin is more chromatic');
assert(Ch.melody.stepShare < Mo.melody.stepShare, 'Chopin leaps more');

// Without a composer the classical composer is unchanged (hash of main before the models existed, after #50).
const h = createHash('sha256');
for (const form of ['symphony', 'concerto', 'nocturne']) for (const mode of ['M', 'm']) for (const seed of [1, 7, 42, 1234]) {
  const s = compose({ form, seed, mode });
  h.update(JSON.stringify([s.bars, s.sections, s.notes, s.tempo]));
}
assert.equal(h.digest('hex'), '0c3027c25a284ee1c2cea532feee17aca2bf90eb509bdad6b996dcb103631b2c', 'no composer = byte-identical output');
assert.equal(compose({ form: 'symphony', seed: 3, mode: 'M', composer: 'Nobody' }), compose({ form: 'symphony', seed: 3, mode: 'M' }), 'an unknown composer falls back to UNTERGRUND');

// With a composer it is deterministic, valid, and audibly different from the others.
const PCS = (mode) => (mode === 'M' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10, 11]);
const stats = (composer) => {
  const t = { harp: 0, notes: 0, chrom: 0, mel: 0, sig: [] };
  for (const form of ['symphony', 'concerto', 'nocturne']) for (const mode of ['M', 'm']) for (const seed of [1, 2, 3, 4]) {
    const s = compose({ form, seed, mode, composer });
    assert.equal(JSON.stringify(s.notes), JSON.stringify(compose({ form, seed, mode, composer }).notes));
    assert(s.notes.every((n) => Number.isFinite(n[0]) && n[0] >= 0 && n[0] < s.bars * 16 && Number.isInteger(n[1]) && n[2] > 0 && n[3] > 0), `${composer} ${form} notes are valid`);
    t.notes += s.notes.length; t.harp += s.notes.filter((n) => n[4] === 'harp').length;
    for (const n of s.notes) if (n[4] === 'vln1' && n[1] >= 67) { t.mel++; if (!PCS(mode).includes(n[1] % 12)) t.chrom++; }
    t.sig.push(s.notes.map((n) => n[1]).join());
  }
  return t;
};
const all = Object.fromEntries([undefined, ...COMPOSERS].map((c) => [c ?? 'none', stats(c)]));
for (const c of COMPOSERS) assert(all[c].sig.every((x, i) => x !== all.none.sig[i]), `${c} rewrites every piece`);
for (const c of COMPOSERS) for (const o of COMPOSERS) if (c < o) assert(all[c].sig.some((x, i) => x !== all[o].sig[i]), `${c} and ${o} differ`);
assert(all.Chopin.harp / all.Chopin.notes > 1.5 * (all.Mozart.harp / all.Mozart.notes), 'a Chopin symphony gets more harp arpeggios than a Mozart one');

// The choice is part of the score spec and survives a reload; generating keeps only known composers.
const st = defaultState();
st.patterns[0].score = { form: 'symphony', seed: 9, mode: 'm', composer: 'Chopin' };
st.patterns[1].score = { form: 'symphony', seed: 9, mode: 'm', composer: 'Nobody' };
const back = sanitize(JSON.parse(JSON.stringify(st)));
assert.deepEqual(back.patterns[0].score, { form: 'symphony', seed: 9, mode: 'm', composer: 'Chopin' });
assert.deepEqual(back.patterns[1].score, { form: 'symphony', seed: 9, mode: 'm' });
assert.equal(generate('symphony', 4, 'minor').pattern.score.composer, undefined);

console.log(`composer models ok: ${COMPOSERS.length} models from ${CORPUS.scores} public-domain scores`);
