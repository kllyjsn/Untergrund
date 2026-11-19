import assert from 'node:assert/strict';
import { baseSelection, detectStyles, hash, random, shuffle, main, parseMergedPR } from '../scripts/blind-pack.mjs';

const input = ['minimal', 'drill', 'hardtechno', 'trap'];
assert.deepEqual(parseMergedPR('Merge pull request #241 from owner/minimal\n\nNotch Minimal chord harmonics\n'), { number: 241, title: 'Notch Minimal chord harmonics' });
assert.deepEqual(parseMergedPR("Notch Minimal's chord harmonics (#241)\n\nSquash commit details"), { number: 241, title: "Notch Minimal's chord harmonics" });
assert.equal(parseMergedPR(''), null);
assert.equal(parseMergedPR('Mention #241 without a merge suffix'), null);
assert.equal(parseMergedPR('Maintenance\n\nMerge pull request #241'), null);
const previous = { commit: 'recorded-head', generatedAt: '2026-11-19T05:44:25.978Z' };
assert.deepEqual(baseSelection({}, previous), { ref: 'recorded-head', sinceTime: null });
assert.deepEqual(baseSelection({ base: 'explicit' }, previous), { ref: 'explicit', sinceTime: null });
assert.deepEqual(baseSelection({ since: '2026-11-18T00:00:00Z' }, previous), { ref: null, sinceTime: '2026-11-18T00:00:00Z' });
assert.deepEqual(baseSelection({}, null, Date.parse('2026-11-19T00:00:00Z')), { ref: null, sinceTime: '2026-11-18T00:00:00.000Z' });
assert.throws(() => baseSelection({}, {}), /lacks its head commit/);
assert.deepEqual(shuffle(input, random(42)), shuffle(input, random(42)));
assert.deepEqual(input, ['minimal', 'drill', 'hardtechno', 'trap']);
assert.deepEqual(shuffle([], random(42)), []);
assert.notEqual(hash('42:drill'), hash('42:trap'));
assert.deepEqual(detectStyles('Fix Hard Techno transients /devin/minimal-balance'), ['hardtechno', 'minimal']);
assert.deepEqual(detectStyles('Balance', "+ if (style === 'drill') gain = 1;\n- if ('trap' === style) gain = 2;"), ['trap', 'drill']);
assert.deepEqual(detectStyles('Housekeeping', " context style === 'drill'\n+const unrelated = 1;"), []);
assert.deepEqual(detectStyles(''), []);
for (const path of ['test/jukebox.mjs', 'docs/example.js', 'research/example.js', 'notes.md']) {
  assert.deepEqual(detectStyles('Maintenance', `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n+const fixture = { style: 'amapiano' };`), []);
}
assert.deepEqual(detectStyles('Maintenance', "diff --git a/test/x.js b/test/x.js\n--- a/test/x.js\n+++ b/test/x.js\n+const fixture = { style: 'acid' };\ndiff --git a/js/x.js b/js/x.js\n--- a/js/x.js\n+++ b/js/x.js\n+if (style === 'drill') play();"), ['drill']);
assert.deepEqual(detectStyles('Maintenance', "+const mode = 'acid';\n+const style = config.style;"), []);
await assert.rejects(main(['--seed', 'NaN']), /Seed must/);
await assert.rejects(main(['--unknown', 'x']), /Invalid option/);
console.log('blind-pack: pure tests passed');
