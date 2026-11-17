// The feeling model: every feeling is complete, GENERATE and song prompts carry one, and it survives a reload.
import assert from 'node:assert/strict';
import { FEELS, FEEL_IDS, feelOf, pickFeel, feelsFor, isFeel } from '../js/feel.js';
import { STYLES, freshSong, sanitize, applySongPlan, defaultState } from '../js/state.js';
import { localSpec, songState } from '../js/song-spec.js';
import { themeOf } from '../js/lyric-writer.js';

for (const id of FEEL_IDS) {
  const f = FEELS[id];
  assert.ok(f.label && f.words instanceof RegExp && f.chords && f.theme && f.mode, id);
  for (const k of ['valence', 'arousal']) assert.ok(f[k] >= -1 && f[k] <= 1, `${id}.${k}`);
  assert.ok(f.tension >= 0 && f.tension <= 1 && f.tempo >= 0 && f.tempo <= 1, id);
  assert.ok(f.mel.vel[0] < f.mel.vel[1] && f.mel.vel[1] <= 1, `${id} velocity range`);
  assert.ok(f.peak.length, `${id} peak devices`);
}
// Cue directions agree with the feeling (Juslin & Laukka): sad is slower, softer and lower than joy.
assert.ok(FEELS.heartbroken.tempo < FEELS.joyful.tempo && FEELS.heartbroken.mel.reg < FEELS.joyful.mel.reg);
assert.ok(FEELS.heartbroken.mel.vel[0] < FEELS.joyful.mel.vel[0] && FEELS.heartbroken.mel.legato > FEELS.joyful.mel.legato);
assert.ok(FEELS.tense.tension > FEELS.tender.tension && FEELS.tender.end.rit > FEELS.tense.end.rit);

assert.equal(feelOf('a melancholic deep house track for a sunrise drive'), 'longing');
assert.equal(feelOf('heartbroken ballad'), 'heartbroken');
assert.equal(feelOf('euphoric festival anthem'), 'euphoric');
assert.equal(feelOf('just a beat'), null);
assert.equal(themeOf('', ['heartbroken']), 'heartbreak');

const families = new Set(Object.values(STYLES).map((s) => s.family));
for (const [id, s] of Object.entries(STYLES)) {
  for (const f of Object.keys(feelsFor(id, s.family))) assert.ok(isFeel(f), `${id}: ${f}`);
  assert.equal(pickFeel(id, s.family, 42), pickFeel(id, s.family, 42), `${id} deterministic`);
}
assert.ok(families.size > 5);
// A genre draws more than one feeling across seeds.
const seen = new Set(Array.from({ length: 64 }, (_, i) => pickFeel('pop', STYLES.pop.family, i)));
assert.ok(seen.size >= 3, `pop feelings ${[...seen]}`);

const s = freshSong('deephouse', 7);
assert.ok(isFeel(s.feel));
assert.equal(sanitize(JSON.parse(JSON.stringify(s))).feel, s.feel);
assert.equal(sanitize({ ...JSON.parse(JSON.stringify(s)), feel: 'bogus' }).feel, undefined);

// Every GENERATE path writes its song through applySongPlan, so a new song never keeps the last one's feeling.
const prev = { ...defaultState(), feel: 'tense' };
applySongPlan(prev, 'pop', 11);
assert.equal(prev.feel, pickFeel('pop', STYLES.pop.family, 11));
const score = { ...defaultState(), feel: 'tense' };
applySongPlan(score, 'nocturne', 11);
assert.equal(score.feel, undefined);

const spec = localSpec('a heartbroken pop song about leaving', { style: 'pop', seed: 3 });
assert.equal(spec.feel, 'heartbroken');
assert.equal(songState(spec, 3).state.feel, 'heartbroken');
console.log('feel: ok');
