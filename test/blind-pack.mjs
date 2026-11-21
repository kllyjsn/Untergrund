import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseSelection, detectStyles, hash, random, shuffle, main, seedOverrides, parseMergedPR, excerptWithFrom, checkBarWindow, selectStyles, edgeFadeFilter, baselineOverrides, planPairs, pcmDifference } from '../scripts/blind-pack.mjs';

assert.deepEqual(seedOverrides(), {});
assert.deepEqual(seedOverrides('afrobeats:0,hyperpop:4294967295'), { afrobeats: 0, hyperpop: 4294967295 });
for (const value of ['unknown:1', 'dnb:', 'dnb:1.5', 'dnb:-1', 'dnb:4294967296', 'dnb:NaN', 'dnb:1:2', 'dnb:1,dnb:2']) assert.throws(() => seedOverrides(value), /Invalid genre seed/);

const input = ['minimal', 'drill', 'hardtechno', 'trap'];
assert.deepEqual(baselineOverrides(), {});
assert.deepEqual(baselineOverrides('swing:abcdef0,deephouse:1234567'), { swing: 'abcdef0', deephouse: '1234567' });
for (const value of ['swing:', 'unknown:abcdef0', 'swing:main', 'swing:abcdef0,swing:1234567', 'swing:abcdef0:extra']) assert.throws(() => baselineOverrides(value), /Invalid baseline/);
assert.deepEqual(selectStyles(['trap'], [], 2, ['swing', 'modal', 'bossa']), { selected: ['swing', 'modal'], dropped: ['bossa'] });
assert.throws(() => selectStyles([], [], 1, []), /empty/);
const planned = planPairs(['swing', 'deephouse'], 42, { swing: 7 }, 'base', 'head', { swing: 'intro' }, true);
assert.deepEqual(planned, planPairs(['swing', 'deephouse'], 42, { swing: 7 }, 'base', 'head', { swing: 'intro' }, true));
assert.equal(planned.length, 3);
const control = planned.find((p) => p.kind === 'null');
assert.equal(control.nullCommit, 'head');
assert.deepEqual(control.commits, { original: 'head', revised: 'head' });
assert(!planned.some((p) => p.kind !== 'null' && p.style === control.style));
for (let seed = 0; seed < 100; seed++) {
  const pairs = planPairs(['swing', 'deephouse'], seed, {}, 'base', 'head', {}, true, ['swing', 'modal', 'deephouse', 'phonk']);
  assert(!pairs.some((p) => p.kind !== 'null' && p.style === pairs.find((p) => p.kind === 'null').style));
}
assert.equal(planPairs(['swing'], 42, { electrohiphop: 7 }, 'base', 'head', {}, true, ['electrohiphop']).find((p) => p.kind === 'null').renderSeed, 7);
assert.throws(() => planPairs(['swing'], 42, {}, 'base', 'head', {}, true, []), /outside/);
assert.throws(() => planPairs(['swing'], 42, {}, 'base', 'head', {}, true, ['swing']), /outside/);
assert.throws(() => planPairs(['swing'], 42, {}, 'base', 'head', {}, true, ['unknown']), /Unknown null genre/);
assert.equal(planned.find((p) => p.style === 'swing' && p.kind !== 'null').baselineCommit, 'intro');
assert.equal(planned.find((p) => p.style === 'deephouse' && p.kind !== 'null').baselineCommit, 'base');
assert.equal(planPairs(['swing'], 42, {}, 'base', 'head').length, 1);
assert.throws(() => planPairs([], 42, {}, 'base', 'head'), /empty/);
assert.equal(pcmDifference([1, 2], [1, 2]).different, false);
assert.equal(pcmDifference([1, 2], [2, 4]).different, false);
assert.equal(pcmDifference([1, 2], [1.0001, 2]).different, false);
assert.equal(pcmDifference([1, 2], [2, 1]).different, true);
assert.equal(pcmDifference([1], [1, 1]).different, true);
for (const [a, b] of [[[], [1]], [[0], [0]], [[NaN], [1]], [[1], [Infinity]]]) assert.throws(() => pcmDifference(a, b));
assert.throws(() => pcmDifference([1], [1], -1), /Invalid/);
assert.deepEqual(selectStyles(['acid', 'pop', 'minimal'], ['pop', 'hypnotic'], 6), { selected: [...input, 'pop', 'hypnotic'], dropped: ['acid'] });
assert.deepEqual(selectStyles([]), { selected: input, dropped: [] });
assert.deepEqual(selectStyles(['acid'], [], 4), { selected: input, dropped: ['acid'] });
for (const max of [0, 3, 4.5, NaN]) assert.throws(() => selectStyles([], [], max), /max-pairs/);
assert.throws(() => selectStyles(['unknown']), /Unknown genre/);
assert.equal(edgeFadeFilter(), 'afade=t=in:d=0.01,areverse,asetpts=N/SR/TB,afade=t=in:d=0.01,areverse,asetpts=N/SR/TB');
for (const duration of [0, -1, NaN, Infinity]) assert.throws(() => edgeFadeFilter(duration), /Fade duration/);
const fadeDir = mkdtempSync(join(tmpdir(), 'blind-pack-fade-'));
try {
  for (const frames of [4200, 4800]) {
    const wav = join(fadeDir, 'constant.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=0.5:s=48000:d=${frames / 48000}`, '-ac', '2', '-c:a', 'pcm_s16le', wav]);
    const decode = (filter) => execFileSync('ffmpeg', ['-v', 'error', '-i', wav, ...(filter ? ['-af', filter] : []), '-f', 'f32le', 'pipe:1']);
    const raw = decode(), faded = decode(edgeFadeFilter());
    assert.equal(faded.length, raw.length, 'fades preserve sample count');
    for (let n = 0; n < frames; n++) {
      const expected = Math.min(1, n / 480, (frames - 1 - n) / 480);
      for (let ch = 0; ch < 2; ch++) {
        const at = (n * 2 + ch) * 4;
        const gain = faded.readFloatLE(at) / raw.readFloatLE(at);
        assert.ok(Math.abs(gain - expected) < 0.004, `fade gain at frame ${n}/${frames}: ${gain} vs ${expected}`);
      }
    }
  }
} finally { rmSync(fadeDir, { recursive: true, force: true }); }
assert.deepEqual(checkBarWindow([63, 71]), [63, 71]);
assert.deepEqual(checkBarWindow([63, 71], [63, 71]), [63, 71]);
assert.throws(() => checkBarWindow([32, 40], [63, 71]), /window mismatch/);
assert.throws(() => checkBarWindow([]), /window mismatch/);
assert.throws(() => checkBarWindow([0, 7]), /window mismatch/);
const legacyExcerpt = "export async function excerpt(style, seed, { kind = 'peak', bars = 8 } = {}) { const [a, b, tail] = kind === 'ending' ? ending : peak; }";
const explicitExcerpt = excerptWithFrom(legacyExcerpt);
assert(explicitExcerpt.includes('from = null'));
assert(explicitExcerpt.includes('from + bars'));
assert.equal(excerptWithFrom(explicitExcerpt), explicitExcerpt);
assert.throws(() => excerptWithFrom(''), /Cannot add explicit/);
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
