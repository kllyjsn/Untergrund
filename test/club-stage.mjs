import assert from 'node:assert/strict';
import { crowdSlots, sectionMood, stepMs, gridOrigin, gridError, reactionBurst, BEAT_ANIMATIONS, stageScene, ensembleLayout, DJ_SCENE, INSTRUMENT_NAMES } from '../js/club-stage.js';
import { generate, STYLES } from '../js/state.js';
import { REPERTOIRE } from '../js/repertoire-index.js';

// Sections drive the room: drops/hooks light it up, breakdowns dim it, builds get restless.
assert.equal(sectionMood('DROP'), 'drop');
assert.equal(sectionMood('HOOK'), 'drop');
assert.equal(sectionMood('BUILD'), 'build');
assert.equal(sectionMood('FILL'), 'build');
assert.equal(sectionMood('BREAKDOWN'), 'break');
assert.equal(sectionMood('BRIDGE'), 'break');
assert.equal(sectionMood('INTRO'), 'break');
assert.equal(sectionMood('VERSE'), 'groove');
assert.equal(sectionMood(''), 'groove');
assert.equal(sectionMood(undefined), 'groove');

// Beat grid: a set that started 10 s ago (wall clock) maps onto the document timeline 10 s back.
assert.equal(gridOrigin(90_000, 100_000, 5_000), -5_000);
assert.equal(stepMs(120), 125);
assert.equal(stepMs(1000), 15000 / 240);
const bar = stepMs(120) * 16;
assert.equal(gridError(1_030, 1_000, bar), 30, 'late by 30 ms');
assert.equal(gridError(970, 1_000, bar), -30, 'early by 30 ms');
assert.equal(gridError(1_000 + bar * 7 + 12, 1_000, bar), 12, 'folds whole bars away');
assert.equal(gridError(1_000 + bar - 5, 1_000, bar), -5, 'just before the next bar is early, not a bar late');
// Every animation the grid pins must exist in the stylesheet.
const css = (await import('node:fs')).readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
for (const name of BEAT_ANIMATIONS) assert.match(css, new RegExp(`@keyframes ${name}\\b`), `${name} keyframes`);

// Bursts need several reactions from more than one person inside the window.
const t = 10_000;
assert.equal(reactionBurst([{ id: 'a', at: t }, { id: 'a', at: t }, { id: 'a', at: t }], t), false, 'one person spamming is not a moment');
assert.equal(reactionBurst([{ id: 'a', at: t - 100 }, { id: 'b', at: t - 50 }], t), false, 'two is not a burst');
assert.equal(reactionBurst([{ id: 'a', at: t - 900 }, { id: 'b', at: t - 400 }, { id: 'a', at: t }], t), true);
assert.equal(reactionBurst([{ id: 'a', at: t - 5000 }, { id: 'b', at: t - 400 }, { id: 'a', at: t }], t), false, 'stale reactions fall out');

// Crowd slots: front row first, centre out, all inside the floor.
const slots = crowdSlots();
assert.equal(slots.length, 18);
assert.ok(slots.every((s) => s.x > 5 && s.x < 95));
assert.ok(slots.every((s, i) => i === 0 || slots[i - 1].row <= s.row));

// The set follows the music: club records get a DJ, songs a band, scores an orchestra or a recital.
const sceneFor = (style, seed = 3) => { const g = generate(style, seed); return stageScene(style, { patterns: [g.pattern], params: g.params }); };
assert.equal(sceneFor('hypnotic'), DJ_SCENE);
assert.equal(stageScene('nonsense'), DJ_SCENE);
const country = sceneFor('country');
assert.equal(country.kind, 'band');
assert.equal(country.set, 'barn');
assert.equal(country.lead, 'agtr');
assert.ok(country.players.includes('drums') && country.players.includes('bass'));
assert.equal(sceneFor('rock').lead, 'egtr');
assert.equal(sceneFor('pop').lead, 'mic');
const symphony = sceneFor('symphony');
assert.deepEqual([symphony.kind, symphony.lead, symphony.crowd], ['orchestra', 'baton', 'seated']);
assert.ok(['violin', 'cello', 'timpani', 'harp'].every((p) => symphony.players.includes(p)));
const concerto = sceneFor('concerto');
assert.deepEqual([concerto.kind, concerto.lead], ['orchestra', 'grand']);
assert.ok(concerto.players.includes('baton'));
assert.deepEqual([sceneFor('nocturne').kind, sceneFor('nocturne').lead, sceneFor('nocturne').players.length], ['recital', 'grand', 0]);
const piece = (id) => stageScene('repertoire', { patterns: [{ score: { piece: id } }] });
const strings = REPERTOIRE.find((p) => p.ensemble === 'strings'), solo = REPERTOIRE.find((p) => p.ensemble === 'piano');
assert.equal(piece(strings.id).kind, 'chamber');
assert.equal(piece(solo.id).kind, 'recital');
// Every scene only asks for instruments the stage can draw, and keeps everyone on the riser.
for (const style of Object.keys(STYLES)) {
  const sc = sceneFor(style);
  if (sc === DJ_SCENE) continue;
  for (const inst of [sc.lead, ...sc.players]) assert.ok(INSTRUMENT_NAMES.includes(inst), `${style}: ${inst}`);
  const { lead, players } = ensembleLayout(sc);
  assert.equal(players.length, sc.players.length);
  for (const p of [lead, ...players]) assert.ok(p.x >= 5 && p.x <= 95 && p.s > 0, `${style} position ${JSON.stringify(p)}`);
  const spots = new Set(players.map((p) => `${p.x.toFixed(0)}:${p.y}`));
  assert.equal(spots.size, players.length, `${style}: players never stand in the same spot`);
}
console.log('club stage ok');
