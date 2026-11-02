import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { REPERTOIRE, PIECE, registerPiece, pieceScore } from '../js/repertoire.js';
import { perform } from '../js/perform.js';
import { compose, PART_SECTION } from '../js/classical.js';
import { scoreKinds } from '../js/engine.js';
import { generate, arrangement, songChain, sanitize, defaultState, STYLES } from '../js/state.js';

const dir = new URL('../data/repertoire/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
const license = readFileSync(new URL('LICENSE.md', dir), 'utf8');

// Only scores whose source states Public Domain or CC0 are bundled, each one listed with its source.
assert.deepEqual(files.sort(), REPERTOIRE.map((p) => p.id).sort(), 'catalogue matches data/repertoire');
assert(REPERTOIRE.length >= 16, 'a real repertoire');
for (const p of REPERTOIRE) {
  assert(['Public Domain', 'CC0-1.0'].includes(p.license), `${p.id} license ${p.license}`);
  assert(license.includes(`| ${p.id} |`), `${p.id} in LICENSE.md`);
}
assert.equal(compose({ piece: 'chopin-prelude-4' }).waiting, true, 'an unloaded piece holds a silent bar');
assert.equal(pieceScore('chopin-prelude-4'), null);

for (const id of files) {
  const raw = JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8'));
  assert.equal(raw.license, PIECE[id].license);
  assert(/^https:\/\/github\.com\/(MutopiaProject|OpenScore)\//.test(raw.source.file), `${id} pinned source`);
  assert(raw.bpm >= 60 && raw.bpm <= 200 && Number.isInteger(raw.barLen) && raw.barLen > 0, `${id} tempo/metre in the transport's range`);
  const sc = registerPiece(raw);
  assert.equal(compose({ piece: id }), sc, `${id} plays through compose()`);
  assert.deepEqual(perform(raw).notes, sc.notes, `${id} performance is deterministic`);
  assert.equal(sc.at.length, sc.bars * sc.barLen);
  assert.equal(sc.tempo.length, sc.at.length);
  assert(sc.tempo.every((t) => t > 0.08 && t < 4), `${id} tempo multipliers stay musical`);
  assert(sc.tempo.at(-1) > sc.tempo.at(-2 * sc.barLen - 1) * 1.1, `${id} slows into the last chord`);
  assert.equal(sc.at.flat().length, sc.notes.length, `${id} every note is scheduled once`);
  for (const [at, m, d, v, part, off] of sc.notes) {
    assert(Number.isFinite(at) && at >= 0 && at < sc.bars * sc.barLen, `${id} position ${at}`);
    assert(Number.isInteger(m) && m >= 21 && m <= 108, `${id} pitch ${m}`);
    assert(d > 0 && v >= 0.08 && v <= 1 && Math.abs(off) < 0.12, `${id} dur/vel/offset`);
    assert(PART_SECTION[part], `${id} part ${part}`);
  }
  assert.equal(sc.sections[0].at, 0);
  assert(sc.sections.every((x) => x.len > 0 && x.at < sc.bars), `${id} sections`);
  const parts = new Set(sc.notes.map((n) => n[4]));
  if (PIECE[id].ensemble === 'piano') {
    assert.deepEqual([...parts], ['pno'], `${id} is solo piano`);
    assert.deepEqual(scoreKinds({ piece: id }).sort(), ['piano', 'pianoext', 'pianoextsoft', 'pianosoft'], `${id} loads only the piano`);
    // The performer sings the top line over the accompaniment and pedals with the harmony.
    const rh = raw.notes.filter((n) => n[5] === 0).length, lh = raw.notes.length - rh;
    assert(rh > 0 && lh > 0, `${id} has both hands`);
  } else {
    assert(['vln1', 'vln2', 'vla', 'vc'].every((p) => parts.has(p)), `${id} is a string quartet or orchestra`);
    assert(!scoreKinds({ piece: id }).includes('fh'), `${id} loads no brass`);
  }
}

// Performance: melody over accompaniment, pedal, rolled wide chords.
{
  const raw = JSON.parse(readFileSync(new URL('chopin-prelude-4.json', dir), 'utf8'));
  const p = perform(raw), byKey = new Map(p.notes.map((n) => [`${n[0]}:${n[1]}`, n]));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const rh = raw.notes.filter((n) => n[5] === 0).map((n) => byKey.get(`${n[0]}:${n[1]}`)[3]);
  const lh = raw.notes.filter((n) => n[5] === 1).map((n) => byKey.get(`${n[0]}:${n[1]}`)[3]);
  assert(mean(rh) > mean(lh) + 0.1, `the melody sings over the chords (${mean(rh).toFixed(2)} vs ${mean(lh).toFixed(2)})`);
  const longer = raw.notes.filter((n) => byKey.get(`${n[0]}:${n[1]}`)[2] > n[2] + 0.5).length;
  assert(longer > raw.notes.length * 0.2, 'the pedal lets notes ring into the harmony');
  const strict = perform({ ...raw, rubato: 0 }).tempo.slice(0, -2 * raw.barLen);
  assert(strict.every((t) => Math.abs(t - strict[0]) < 1e-9), 'rubato 0 keeps the written tempo');
  assert(Math.max(...perform(raw).tempo) - Math.min(...perform(raw).tempo) > 0.05, 'a Largo breathes');
}
{
  const raw = JSON.parse(readFileSync(new URL('chopin-etude-10-12.json', dir), 'utf8'));
  assert(perform(raw).notes.some((n) => n[5] > 0.01), 'wide chords are rolled from the bottom');
}

// REPERTOIRE is a CLASSICAL style: it picks a masterwork, plays it in its own key and tempo, and survives a reload.
assert.equal(STYLES.repertoire.family, 'CLASSICAL');
const picked = new Set();
for (let seed = 1; seed < 60; seed++) {
  const g = generate('repertoire', seed);
  const piece = PIECE[g.pattern.score.piece];
  assert(piece, 'a real piece');
  picked.add(piece.id);
  assert.equal(g.key, 0);
  assert.equal(g.bpm, piece.bpm);
  assert.equal(g.master.arr, 0, 'no club drops in a masterwork');
}
assert(picked.size > 10, 'GENERATE travels the whole repertoire');
assert.equal(songChain('repertoire', 3), 'A');
const g = generate('repertoire', 4);
const st = { ...defaultState(), patterns: arrangement(g.pattern, 4) };
assert(st.patterns.every((p) => p.score.piece === g.pattern.score.piece));
assert.deepEqual(sanitize(st).patterns[0].score, { piece: g.pattern.score.piece }, 'a saved piece reloads');
st.patterns[0].score = { piece: 'not-a-piece' };
assert.equal(sanitize(st).patterns[0].score, undefined, 'unknown pieces are dropped');
console.log(`repertoire ok: ${REPERTOIRE.length} public-domain/CC0 masterworks`);
