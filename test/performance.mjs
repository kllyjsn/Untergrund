// Performance that breathes (js/engine.js): a song's feeling sets its velocity range, section contrast, the held
// breath before the final chorus, the ending's ritardando and a gentle tempo breath. A song without one plays strictly.
import assert from 'node:assert/strict';
import { FEELS } from '../js/feel.js';
import { Sequencer, feelTempo, parseChain } from '../js/engine.js';
import { buildSong } from '../scripts/composition.mjs';

function play(style, seed, feel, editable = false) {
  const s = buildSong(style, seed), log = [], scale = [], db = [];
  if (feel === null) delete s.feel; else if (feel) s.feel = feel;
  let abs = 0;
  const e = new Proxy({ stepDur: 0.125, harm: null, planHit(t, id, cur, plan) { const h = plan(); if (h) log.push({ k: 'trigger', a: [id], abs }); return h; } }, {
    get: (o, k) => (k in o ? o[k] : k === 'sectionGain' ? (t, d) => db.push(d) : (...a) => log.push({ k, a, abs })),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const seq = new Sequencer(e, s), chain = parseChain(s.chain);
  for (; abs < chain.length * 16 && !seq.finished; abs++) { seq.tick(abs, abs * 0.125, undefined, editable); scale.push(e.stepScale ?? 1); }
  return { s, log, scale, db, chain, seq };
}
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const hookVel = (r) => median(r.log.filter((x) => x.k === 'hook').map((x) => x.a[1]));

// No feeling: metronome time and the fixed section levels.
const plain = play('pop', 11, null);
assert.ok(plain.scale.every((x) => x === 1), 'no feeling keeps strict time');
assert.equal(feelTempo(plain.s, plain.chain, plain.chain.length - 1, 15), 1);
assert.ok(plain.db.includes(-1.8) && Math.max(...plain.db) === 0.45, `no feeling: fixed section levels ${[...new Set(plain.db)]}`);

// Section contrast follows dyn.contrast; the chorus never goes above its ceiling-safe lift.
const sad = play('pop', 11, 'heartbroken');
assert.ok(sad.db.some((d) => Math.abs(d - -1.8 * FEELS.heartbroken.dyn.contrast) < 1e-9), 'verse sits deeper under a heartbroken chorus');
assert.ok(Math.abs(Math.max(...sad.db) - 0.45) < 1e-9, "chorus lift unchanged");

// The ending slows by end.rit: tender broadens a lot, tense not at all; the tempo breath stays within a few percent.
const n = sad.chain.length, last3 = (r) => r.scale.slice(-48).reduce((a, b) => a + b, 0) / 48;
const tender = play('pop', 11, 'tender'), euphoric = play('pop', 11, 'euphoric'), tense = play('pop', 11, 'tense');
assert.ok(last3(tender) > last3(euphoric) + 0.1 && last3(euphoric) > 1, `ending ritardando ${last3(tender)} vs ${last3(euphoric)}`);
assert.ok(Math.abs(tender.scale.at(-1) - (1 + 0.5 * FEELS.tender.end.rit)) < 1e-9, 'final bar broadens by end.rit');
assert.ok(tense.scale.slice(-16).every((x) => x < 1.05), 'a tense ending keeps its tempo');
const body = sad.scale.slice(0, (n - 3) * 16);
assert.ok(Math.min(...body) > 0.98 && Math.max(...body) < 1.06 && new Set(body).size > 1, 'a gentle tempo breath');

// A held breath: the band is silent for the beat before the final chorus.
const lf = sad.seq.liftFrom ?? sad.chain.findLastIndex((p, i) => p === 6 && sad.chain[i - 1] !== 6);
const beat = (r) => r.log.filter((x) => x.abs >= lf * 16 - 4 && x.abs < lf * 16 && x.k === 'trigger');
assert.equal(beat(sad).length, 0, 'no drums or chords in the held breath');
assert.ok(beat(plain).length > 0, 'without a feeling the band plays through');
const club = play('pop', 11, 'heartbroken', true), clubPlain = play('pop', 11, null, true);
assert.equal(beat(club).length, 0, 'Club (editable) drums also hold the breath');
assert.ok(beat(clubPlain).length > 0, 'Club drums play through without a feeling');
assert.deepEqual(sad.log.filter((x) => x.k === 'breath').map((x) => x.abs - lf * 16), [-4, -1], 'ringing chords and bass are damped for the breath');
assert.ok(!plain.log.some((x) => x.k === 'breath'), 'no breath without a feeling');

// Velocity range: a tender song plays softer than a euphoric one from the same written melody.
assert.ok(hookVel(tender) < hookVel(euphoric) - 0.03, `tender ${hookVel(tender)} vs euphoric ${hookVel(euphoric)}`);
console.log('performance: ok');
