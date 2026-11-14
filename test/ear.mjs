import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STYLES } from '../js/state.js';
import { TAG_IDS, featureAgreement, mergeJudgments, nextStyle, songFor, summarize, validJudgment, windowOf } from '../js/ear-data.js';

const pick = (id, at, over = {}) => ({ id, at, build: 'dev', style: 'pop', pick: 'a', tags: [], a: { seed: 1, startBar: 4, bars: 8 }, b: { seed: 2, startBar: 4, bars: 8 }, ...over });
assert(validJudgment(pick('x', '2026-11-14T00:00:00Z')));
assert(!validJudgment(pick('x', '2026-11-14T00:00:00Z', { pick: 'c' })), 'unknown pick');
assert(!validJudgment(pick('x', '2026-11-14T00:00:00Z', { tags: ['free text'] })), 'tags are a closed set');
assert(!validJudgment(pick('x', 'never')), 'needs a time');
assert(!validJudgment(pick('x', '2026-11-14T00:00:00Z', { a: { seed: 1.5, startBar: 0, bars: 8 } })), 'seed must re-render');

// Exports from two days overlap: one row per id, the later edit wins, oldest first.
const merged = mergeJudgments([pick('b', '2026-11-14T02:00:00Z'), pick('a', '2026-11-14T01:00:00Z')], [pick('b', '2026-11-14T02:00:00Z', { pick: 'same' }), { junk: 1 }]);
assert.deepEqual(merged.map((j) => j.id), ['a', 'b']);
assert.equal(merged[1].pick, 'same');
assert.deepEqual(summarize(merged).picks, { a: 1, b: 0, same: 1 });

// Labels spread over genres: the next pair goes to the least-rated style.
assert.equal(nextStyle(['pop', 'folk', 'country'], [pick('1', '2026-11-14T00:00:00Z'), pick('2', '2026-11-14T00:00:00Z', { style: 'folk' })]), 'country');

// A feature that always sides with the winner reads as signal; a feature that ignores the pick reads as a coin flip.
const rated = Array.from({ length: 20 }, (_, i) => pick(String(i), '2026-11-14T00:00:00Z', {
  pick: i % 2 ? 'a' : 'b',
  metrics: { a: { warmth: i % 2 ? 2 : 1, noise: i % 4 < 2 ? 1 : 2 }, b: { warmth: i % 2 ? 1 : 2, noise: i % 4 < 2 ? 2 : 1 } },
}));
const agreement = Object.fromEntries(featureAgreement(rated).map((f) => [f.feature, f]));
assert.equal(agreement.warmth.agreement, 1);
assert.equal(agreement.warmth.direction, 'higher');
assert.equal(agreement.noise.strength, 0);
assert.equal(featureAgreement(rated.slice(0, 3)).length, 0, 'too few picks to claim anything');

// Every pick re-renders exactly: the same style + seed is the same song, and the window fits inside it.
for (const style of Object.keys(STYLES).filter((s) => s !== 'repertoire')) {
  const s = songFor(style, 1234);
  assert.deepEqual(JSON.stringify(songFor(style, 1234)), JSON.stringify(s), `${style} is deterministic`);
  const w = windowOf(s, 8), bars = s.chain.replace(/[^A-Z]/g, '').length;
  assert(w.startBar >= 0 && (bars < 8 || w.startBar + w.bars <= bars), `${style} window inside the song`);
}

const critiques = JSON.parse(readFileSync(new URL('../research/taste/critiques.json', import.meta.url), 'utf8')).critiques;
assert(critiques.length >= 10);
for (const c of critiques) {
  assert(c.tags.every((t) => TAG_IDS.includes(t)), `critique tags in vocabulary: ${c.note}`);
  assert(!/https?:|[A-Za-z0-9_-]{32,}/.test(c.note), 'no links or tokens in the corpus');
}

const page = readFileSync(new URL('../ear.html', import.meta.url), 'utf8'), script = readFileSync(new URL('../js/ear.js', import.meta.url), 'utf8');
for (const [, id] of script.matchAll(/\$\('([\w-]+)'\)/g)) assert(page.includes(`id="${id}"`), `ear.html has #${id}`);
assert(readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8').includes("'ear.html'"), 'ear.html ships');
console.log('ear ok');

// Player hearts/downs: the latest reaction per device and song wins, a reason only rides on a down, and taking a
// reaction back removes it from the log on the next pull.
{
  const { reactionsOf, mergeReactions, summarizeReactions, deviceHash } = await import('../js/ear-data.js');
  const sig = (t, kind, over = {}) => ({ t, at: new Date(t).toISOString(), kind, lid: 'phone1', fp: 'abc123', style: 'folk', seed: 7, ms: t, ...over });
  const log = [sig(1, 'start'), sig(2, 'down'), sig(3, 'why', { why: 'sounds_bad' }), sig(4, 'love', { fp: 'def456', style: 'rock' }), sig(5, 'love', { lid: 'other', fp: 'zzz999' })];
  const me = new Set([deviceHash('phone1')]);
  const rows = reactionsOf(log, { devices: me });
  assert.deepEqual(rows.map((r) => [r.fp, r.reaction, r.why, r.style, r.seed]), [['abc123', 'down', 'sounds_bad', 'folk', 7], ['def456', 'love', null, 'rock', 7]]);
  assert(!JSON.stringify(rows).includes('phone1'), 'raw device id never written');
  assert.deepEqual(summarizeReactions(rows).why.sounds_bad, 1);
  assert.equal(reactionsOf(log).length, 3, 'every device without a filter');
  const flipped = reactionsOf([...log, sig(6, 'undown'), sig(7, 'love')], { devices: me });
  assert.deepEqual(flipped.find((r) => r.fp === 'abc123').reaction, 'love');
  assert.equal(flipped.find((r) => r.fp === 'abc123').why, null, 'a heart clears the down reason');
  const sameMs = reactionsOf([sig(9, 'down'), sig(9, 'unlove'), sig(8, 'love')], { devices: me });
  assert.equal(sameMs[0]?.reaction, 'down', 'newest-first log: a same-ms switch keeps the new reaction');
  const undone = reactionsOf([...log, sig(6, 'unlove', { fp: 'def456' })], { devices: me, cleared: true });
  assert.deepEqual(mergeReactions(rows, undone).map((r) => r.fp), ['abc123'], 'taken-back heart drops out');
}
console.log('ear reactions ok');
