// The UNTERGRUND vs Suno kit (scripts/suno-benchmark.mjs): prompts map onto our genres, the manifest pairs every render
// with a local suno/<id>.mp3 slot, the scorecard unblinds A/B correctly, and /research shows "no results yet" without one.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { STYLES } from '../js/state.js';
import { validateBenchmark } from '../js/lab-metrics.js';
import { loadPrompts, resolveStyle, buildManifest, scorecard, songwriting, sunoFile, DIMENSIONS, OURS, THEIRS } from '../scripts/suno-benchmark.mjs';
import { renderSite } from '../scripts/research.mjs';

const prompts = loadPrompts(), ids = prompts.prompts.map((p) => p.id);
assert(Number.isInteger(prompts.seed), 'one fixed seed');
assert(prompts.prompts.length >= 18 && prompts.prompts.length <= 24, 'about 20 prompts');
assert.equal(new Set(ids).size, ids.length, 'prompt ids are unique');
for (const p of prompts.prompts) {
  assert.match(p.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${p.id}: file-name-safe id`);
  assert(p.genre && p.name && p.styles?.length && p.describe, `${p.id}: genre, name, styles, describe`);
  assert(p.suno?.title && p.suno.style && typeof p.suno.instrumental === 'boolean', `${p.id}: a Suno title, style prompt and instrumental flag`);
}
const resolved = prompts.prompts.filter((p) => resolveStyle(p));
assert(resolved.length >= 16, `most prompts map onto a current genre (${resolved.length})`);
assert(new Set(resolved.map((p) => STYLES[resolveStyle(p)].family)).size >= 6, 'prompts span the genre families');
assert.equal(resolveStyle({ styles: ['nope', 'DEEP HOUSE'] }), 'deephouse', 'matches by display name too');
const byId = Object.fromEntries(prompts.prompts.map((p) => [p.id, resolveStyle(p)]));
assert.deepEqual([byId['synth-pop'], byId.rnb, byId['indie-rock'], byId.country], ['pop', 'rnb', 'rock', 'country'], 'song-genre prompts render as the song genres');
assert.equal(resolveStyle({ styles: ['country'] }, { techno: { name: 'TECHNO' } }), null, 'no silent substitute for a missing genre');

// Manifest: our render (a) vs the Suno slot (b), nothing on our side that would unblind it in the lab.
const fake = Object.fromEntries(resolved.map((p) => [p.id, { style: resolveStyle(p), seed: prompts.seed, songwriting: { chords: 4 } }]));
const manifest = validateBenchmark(buildManifest(prompts, fake, { commit: 'abc1234' }));
assert.equal(manifest.pairs.length, resolved.length);
assert.deepEqual(manifest.pending.map((p) => p.id), prompts.prompts.filter((p) => !resolveStyle(p)).map((p) => p.id));
assert.deepEqual(manifest.versus, { ours: OURS, theirs: THEIRS });
for (const pair of manifest.pairs) {
  assert.deepEqual(pair.b, { id: THEIRS, file: sunoFile(pair.id) });
  assert.equal(pair.b.file, `suno/${pair.id}.mp3`);
  assert.equal(pair.a.id, OURS); assert(pair.a.file.endsWith('.mp3'));
  assert(!('bpm' in pair) && !('renderMs' in pair.a), 'no grid/render-speed metric only our side would show');
  assert(!JSON.stringify(pair).includes('http'), 'nothing is fetched');
}
assert.equal(buildManifest(prompts, { [resolved[0].id]: fake[resolved[0].id] }).pairs.length, 1, '--only renders a subset');

// Scorecard: identities are flipped per pair; wins, ties, picks and genres unblind correctly.
const res = (pairId, oursSide, ours, theirs, replay, release) => {
  const other = oursSide === 'left' ? 'right' : 'left';
  return { pairId, identity: { [oursSide]: OURS, [other]: THEIRS }, ratings: { [oursSide]: ours, [other]: theirs }, replay: replay === 'ours' ? oursSide : replay === 'theirs' ? other : 'neither', release: release === 'ours' ? oursSide : release === 'theirs' ? other : 'neither', metrics: { left: { lufs: -9, flags: [] }, right: { lufs: -12, flags: [] } } };
};
const all = (v) => Object.fromEntries(DIMENSIONS.map((d) => [d, v]));
const [p1, p2] = manifest.pairs;
const card = scorecard([
  { results: [res(p1.id, 'left', all(4), all(2), 'ours', 'ours'), res(p2.id, 'right', all(3), all(3), 'neither', 'theirs')] },
  { results: [res(p1.id, 'right', { ...all(2), originality: 5 }, all(4), 'theirs', 'neither'), { pairId: 'x', identity: { left: 'a', right: 'b' } }] },
], manifest);
assert.equal(card.listeners, 2); assert.equal(card.overall.ratings, 3, 'pairs without both sides are skipped');
assert.equal(card.overall.dimensions.musicality.winRate, 0.5, 'win + tie + loss');
assert.deepEqual([card.overall.dimensions.originality.wins, card.overall.dimensions.originality.ties], [2, 1]);
assert.equal(card.overall.dimensions.musicality.ours, 3); assert.equal(card.overall.dimensions.musicality.theirs, 3);
assert.deepEqual(card.overall.replay, { ours: 1, theirs: 1, neither: 1, oursRate: 0.333 });
assert.deepEqual(card.overall.release, { ours: 1, theirs: 1, neither: 1, oursRate: 0.333 });
assert.equal(card.genres[p1.genre].ratings + (p1.genre === p2.genre ? 0 : card.genres[p2.genre].ratings), 3);
const c1 = card.pairs.find((p) => p.id === p1.id);
assert.equal(c1.ratings, 2); assert.equal(c1.songwriting.chords, 4, 'songwriting metrics ride along');
assert.equal(c1.audio.ours.lufs, -10.5, 'audio metrics follow our side through the flip');

// Reference-free songwriting metrics from the composition scorecard (no audio needed).
const sw = songwriting('deephouse', prompts.seed, null);
for (const k of ['chords', 'motifRecall', 'melodyWindows', 'contrast']) assert(Number.isFinite(sw[k]), `songwriting ${k}`);

// /research: a placeholder until research/suno/results.json exists, then the scorecard.
const root = mkdtempSync(join(tmpdir(), 'suno-')), page = () => renderSite(root).get('/research/index.html').body;
assert.match(page(), /UNTERGRUND vs Suno[\s\S]*No results yet/);
mkdirSync(join(root, 'research/suno'), { recursive: true });
writeFileSync(join(root, 'research/suno/results.json'), JSON.stringify(card));
const html = page();
assert(!/No results yet|NaN|undefined/.test(html), 'results render cleanly');
assert(html.includes('50%') && html.includes(p1.genre) && html.includes('Chords'), 'win rates, genres and songwriting metrics');

// Licensing: the local Suno folder is ignored by git and never deployed or served.
const ignored = (f) => { try { execFileSync('git', ['check-ignore', '-q', f]); return true; } catch { return false; } };
assert(ignored('suno-lab/suno/acid-techno.mp3') && ignored('suno/acid-techno.mp3'), '.gitignore covers the Suno folder');
assert(!ignored('research/suno/prompts.json') && !ignored('research/suno/results.json'), 'prompts and results stay tracked');
assert(readFileSync('.vercelignore', 'utf8').split('\n').includes('suno-lab'), 'never deployed');
assert(/node_modules\|suno-lab/.test(readFileSync('server.mjs', 'utf8')), 'never served');
console.log(`suno benchmark passed: ${prompts.prompts.length} prompts, ${resolved.length} renderable, ${manifest.pending.length} pending`);
