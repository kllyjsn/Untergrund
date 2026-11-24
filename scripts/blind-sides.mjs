import { createHash, randomInt } from 'node:crypto';

export function pairSides(draw = randomInt) {
  const coin = draw(2);
  if (coin !== 0 && coin !== 1) throw new Error('Blind key side coin FAIL: invalid draw');
  return coin ? ['revised', 'original'] : ['original', 'revised'];
}

export function validateBlindKey(key) {
  if (!key || !Array.isArray(key.pairs) || !key.pairs.length) {
    throw new Error('Blind key side-balance FAIL: empty or invalid key');
  }
  const ids = new Set(), placements = new Set(), comparisons = new Set();
  for (const pair of key.pairs) {
    if (!pair || typeof pair.pair !== 'string' || !pair.pair || ids.has(pair.pair)
      || !['original', 'revised'].includes(pair.first)
      || !['original', 'revised'].includes(pair.second) || pair.first === pair.second) {
      throw new Error('Blind key side-balance FAIL: invalid pair');
    }
    ids.add(pair.pair);
    placements.add(pair.first);
    if (pair.kind !== 'null') comparisons.add(pair.first);
  }
  if (placements.size !== 2) throw new Error('Blind key side-balance FAIL: one-sided key');
  if (comparisons.size !== 2) throw new Error('Blind key side-balance FAIL: one-sided comparison pairs');
  return true;
}

export function assignSides(pairs, draw) {
  if (!Array.isArray(pairs) || pairs.some((pair) => !pair || typeof pair !== 'object')) {
    throw new Error('Blind key assignment FAIL: invalid pairs');
  }
  if (pairs.filter((pair) => pair.kind !== 'null').length < 2) {
    throw new Error('Blind key assignment FAIL: at least two comparison pairs required');
  }
  for (let attempt = 0; attempt < 128; attempt++) {
    const assigned = pairs.map((pair) => { const [first, second] = pairSides(draw); return { ...pair, first, second }; });
    try { validateBlindKey({ pairs: assigned }); return assigned; }
    catch (error) { if (!error.message.startsWith('Blind key side-balance FAIL: one-sided')) throw error; }
  }
  throw new Error('Blind key assignment FAIL: redraw limit reached');
}

export function verifyHalf(actual, candidates, claimed) {
  const hash = (pcm) => createHash('sha256').update(pcm).digest('hex');
  if (!Buffer.isBuffer(actual) || !actual.length || !['original', 'revised'].includes(claimed)
    || !candidates || !['original', 'revised'].every((version) => Buffer.isBuffer(candidates[version]) && candidates[version].length)) {
    throw new Error('Blind key PCM audit FAIL: invalid decoded audio');
  }
  const sha256 = hash(actual), matches = Object.keys(candidates).filter((version) => hash(candidates[version]) === sha256);
  if (!matches.includes(claimed)) throw new Error('Blind key PCM audit FAIL: source identity mismatch');
  return { sha256, matches };
}
