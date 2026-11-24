import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pairSides, validateBlindKey, assignSides, verifyHalf } from '../scripts/blind-sides.mjs';
import { encodeBlindPair, auditBlindPair } from '../scripts/blind-pack.mjs';

for (const coin of [0, 1]) {
  let calls = 0;
  const sides = pairSides((max) => { assert.equal(max, 2); calls++; return coin; });
  assert.equal(calls, 1);
  assert(sides[0] !== sides[1] && sides.includes('original') && sides.includes('revised'));
}
assert(pairSides(() => 0)[0] !== pairSides(() => 1)[0]);
for (const value of [-1, 2, NaN, .5, undefined]) assert.throws(() => pairSides(() => value), /invalid draw/);
const makePair = (id, coin) => { const [first, second] = pairSides(() => coin); return { pair: id, first, second }; };
assert(validateBlindKey({ pairs: [makePair('01', 0), makePair('02', 1), makePair('03', 0)] }));
for (const coin of [0, 1]) {
  assert.throws(() => validateBlindKey({ pairs: [makePair('01', coin), makePair('02', coin)] }), /one-sided key/);
}
for (const key of [null, undefined, {}, { pairs: [] }, { pairs: {} }]) assert.throws(() => validateBlindKey(key), /empty or invalid key/);
for (const pairs of [[null], [{}], [makePair('', 0)], [makePair('01', 0), makePair('01', 1)],
  [{ pair: '01', first: 'unknown', second: 'original' }], [{ pair: '01', first: 'original', second: 'original' }]]) {
  assert.throws(() => validateBlindKey({ pairs }), /invalid pair/);
}
assert.throws(() => validateBlindKey({ pairs: [makePair('01', 0)] }), /one-sided key/);
const pairs = Array.from({ length: 10000 }, (_, i) => { const [first, second] = pairSides(); return { pair: String(i), first, second }; });
assert(validateBlindKey({ pairs }));
const fraction = pairs.filter((pair) => pair.first === 'revised').length / pairs.length;
assert(fraction > .45 && fraction < .55, 'Blind key distribution smoke FAIL');
const specs = [{ pair: '01', kind: 'comparison' }, { pair: '02', kind: 'comparison' }, { pair: '03', kind: 'null' }];
let calls = 0;
assignSides(specs, () => { const n = calls++; return n < specs.length ? 0 : n % 2; });
assert.equal(calls, specs.length * 2);
let nullFlipCalls = 0;
assignSides(specs, () => { const n = nullFlipCalls++; return n < specs.length ? +(n === 2) : n % 2; });
assert.equal(nullFlipCalls, specs.length * 2);
assert.throws(() => validateBlindKey({ pairs: [makePair('01', 0), makePair('02', 0), { ...makePair('03', 1), kind: 'null' }] }), /one-sided comparison/);
assert.throws(() => assignSides(specs, () => 0), /redraw limit/);
assert.throws(() => assignSides(specs, () => 2), /invalid draw/);
for (const invalid of [[], [null], null, [specs[0], specs[2]]]) assert.throws(() => assignSides(invalid), /FAIL/);
const candidates = { original: Buffer.from('original PCM'), revised: Buffer.from('revised PCM') };
for (const version of ['original', 'revised']) assert(verifyHalf(candidates[version], candidates, version).matches.includes(version));
assert.throws(() => verifyHalf(candidates.original, candidates, 'revised'), /source identity mismatch/);
assert.throws(() => verifyHalf(Buffer.from('corrupt'), candidates, 'original'), /source identity mismatch/);
assert.throws(() => verifyHalf(Buffer.alloc(0), candidates, 'original'), /invalid decoded audio/);
assert.equal(verifyHalf(Buffer.from('null'), { original: Buffer.from('null'), revised: Buffer.from('null') }, 'original').matches.length, 2);
const temp = mkdtempSync(join(tmpdir(), 'blind-source-audit-'));
try {
  const matched = { original: join(temp, 'original.wav'), revised: join(temp, 'revised.wav') };
  for (const [version, hz] of [['original', 440], ['revised', 880]]) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=0.2:sample_rate=48000`, '-ac', '2', '-c:a', 'pcm_f32le', matched[version]]);
  }
  const file = join(temp, 'pair.mp3'), pair = makePair('01', 0);
  encodeBlindPair(matched[pair.first], matched[pair.second], file);
  assert(auditBlindPair(pair, file, matched, temp).sha256);
  assert.throws(() => auditBlindPair({ ...pair, first: pair.second, second: pair.first }, file, matched, temp), /source identity mismatch/);
  encodeBlindPair(matched[pair.second], matched[pair.first], file);
  assert.throws(() => auditBlindPair(pair, file, matched, temp), /source identity mismatch/);
  const identical = { original: matched.original, revised: matched.original };
  encodeBlindPair(identical.original, identical.revised, file);
  assert(auditBlindPair(pair, file, identical, temp).sha256);
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log('blind-sides: crypto, redraw, key validation and decoded-PCM identity PASS');
