import assert from 'node:assert/strict';
import { STYLES, songChain, sanitize, defaultState, applySongPlan } from '../js/state.js';
import { encodeSong, decodeSong } from '../js/share-code.js';
import {
  toSections, toChain, toChainEntries, totalBars, starts, locate, sectionNames, cleanLabels, move, resize, duplicate, remove,
  setPattern, append, dropIndex, loopSkip, MAX_BARS,
} from '../js/timeline.js';
import { cleanChainEntries, editChainEntries, setChain } from '../js/chain.js';

{
  const entries = [{ p: 6, sec: 0 }, { p: 6, sec: 0 }, { p: 6, sec: 1 }, { p: 6, sec: 1 }];
  const sections = toSections('GGGG', entries);
  assert.deepEqual(sections, [{ p: 6, bars: 2, sec: 0 }, { p: 6, bars: 2, sec: 1 }], 'same-slot sections stay distinct');
  assert.deepEqual(toChainEntries(sections), entries);
  const resized = resize(sections, 0, 3);
  assert.deepEqual(toChainEntries(resized).map(e => e.sec), [0, 0, 0, 1, 1]);
  const moved = move(sections, 0, 1);
  assert.deepEqual(toChainEntries(moved).map(e => e.sec), [1, 1, 0, 0]);
  assert.deepEqual(toChainEntries(setPattern(sections, 0, 2)).map(e => e.sec), [0, 0, 1, 1]);
  assert.deepEqual(toChainEntries(duplicate(sections, 0)).map(e => e.sec), [0, 0, 0, 0, 1, 1]);
  const st = { chain: 'GGGG', chainEntries: entries, patterns: [] };
  setChain(st, toChain(moved), toChainEntries(moved));
  assert.deepEqual(st.chainEntries.map(e => e.sec), [1, 1, 0, 0], 'an identical-letter chain can still move section identities');
  assert.deepEqual(editChainEntries('GGGG', 'GGGGG', entries, 2).map(e => e.sec), [0, 0, 0, 1, 1], 'text edits use the caret within identical runs');
  assert.deepEqual(editChainEntries('GGGG', 'GGG', entries, 1).map(e => e.sec), [0, 1, 1]);
  assert.deepEqual(cleanChainEntries('', []), []);
  assert.deepEqual(editChainEntries('GGGG', '', entries), []);
  assert.deepEqual(toChainEntries([]), []);
  assert.equal(cleanChainEntries('G', null), null);
  assert.equal(cleanChainEntries('G', []), null);
  assert.equal(cleanChainEntries('G', [{ p: 2, sec: 0 }]), null);
  assert.equal(cleanChainEntries('Z', [{ p: 25, sec: 0 }]), null);
  assert.equal(editChainEntries('G', null, [{ p: 6, sec: 0 }]), null);
  assert.equal(editChainEntries('G', 'Z', [{ p: 6, sec: 0 }]), null);
  const plain = { chain: 'A', patterns: [] };
  setChain(plain, 'AA');
  assert.equal('chainEntries' in plain, false, 'editing a legacy chain does not manufacture section tags');
  setChain(st, '', []);
  assert.deepEqual(st.chainEntries, []);
  for (const sec of [-1, 128, NaN, Infinity, '1', null]) assert.deepEqual(cleanChainEntries('G', [{ p: 6, sec }]), [{ p: 6 }]);
  assert.equal('chainEntries' in sanitize(defaultState()), false, 'untagged legacy/generated projects stay untagged');
  const project = defaultState();
  Object.assign(project, { chain: 'GGGG', chainEntries: entries });
  assert.deepEqual(sanitize(project).chainEntries, entries);
  assert.equal('chainEntries' in sanitize({ ...project, chain: 'A' }), false, 'stale entry metadata is not applied to a different chain');
  const shared = await decodeSong(await encodeSong({ title: 'Sections', artist: 'A', style: 'hypnotic', state: project }));
  assert.deepEqual(shared.state.chainEntries, entries, 'share links retain section identity');
  applySongPlan(project, 'hypnotic', 42);
  assert.equal('chainEntries' in project, false, 'a newly generated arrangement does not inherit old section tags');
}

// Chain ⇄ sections is lossless for every generated song form.
{
  const seen = new Set();
  for (const style of Object.keys(STYLES)) for (let k = 0; k < 40; k++) seen.add(songChain(style, (k * 2654435761) | 0));
  assert(seen.size > 5, 'several song forms');
  for (const chain of seen) {
    const s = toSections(chain);
    assert.equal(toChain(s), chain, `round trip ${chain}`);
    assert.equal(totalBars(s), chain.length);
    for (let k = 1; k < s.length; k++) assert.notEqual(s[k].p, s[k - 1].p, 'runs are merged');
  }
  assert.deepEqual(toSections('aab-c?c'), [{ p: 0, bars: 2 }, { p: 1, bars: 1 }, { p: 2, bars: 2 }], 'same cleaning as sanitize()');
  assert.deepEqual(toSections(''), []);
  assert.equal(toChain(toSections('A'.repeat(300))).length, MAX_BARS, 'capped like sanitize()');
}

// Positions and the playhead.
{
  const s = toSections('AABBCCCD');
  assert.deepEqual(starts(s), [0, 2, 4, 7]);
  assert.deepEqual(locate(s, 0), { index: 0, offset: 0 });
  assert.deepEqual(locate(s, 5), { index: 2, offset: 1 });
  assert.deepEqual(locate(s, 7), { index: 3, offset: 0 });
  assert.deepEqual(locate(s, 8 + 3), { index: 1, offset: 1 }, 'the song loops');
  assert.equal(locate([], 3).index, -1);
}

// Names follow arrangement() roles, a quiet ending is the outro, renames win per pattern.
{
  const s = toSections('AABBCCCDEEFDGGGHBBAA');
  assert.deepEqual(sectionNames(s), ['INTRO', 'BUILD', 'DROP', 'FILL', 'BREAK', 'BREAK', 'FILL', 'DROP', 'FILL', 'OUTRO', 'OUTRO']);
  assert.deepEqual(sectionNames(toSections('AABBAA')), ['INTRO', 'BUILD', 'INTRO'], 'no outro before the song opens up');
  assert.deepEqual(sectionNames(toSections('AACCCC'), 'groove'), ['INTRO', 'VERSE']);
  assert.deepEqual(sectionNames(toSections('AACCAA'), 'club', { C: 'PEAK TIME' }), ['INTRO', 'PEAK TIME', 'OUTRO']);
  assert.deepEqual(cleanLabels({ A: '  my\nintro  ', Z: 'x', B: '', C: 'a very long section name' }), { A: 'MY INTRO', C: 'A VERY LONG SECT' });
  assert.equal(cleanLabels({ B: '   ' }), null);
  assert.equal(cleanLabels('nope'), null);
}

// Edits.
{
  const s = toSections('AABBCCCD');
  assert.equal(toChain(move(s, 2, 0)), 'CCCAABBD', 'drag to front');
  assert.equal(toChain(move(s, 0, 9)), 'BBCCCDAA', 'drag past the end');
  assert.equal(toChain(resize(s, 1, 4)), 'AABBBBCCCD', 'lengthen');
  assert.equal(toChain(resize(s, 2, 0)), 'AABBCD', 'at least one bar');
  assert.equal(toChain(duplicate(s, 1)), 'AABBBBCCCD');
  assert.equal(duplicate(s, 1).length, 5, 'a duplicate is its own block until reload');
  assert.equal(toChain(remove(s, 2)), 'AABBD');
  assert.equal(remove(toSections('AAAA'), 0).length, 1, 'never empty');
  assert.equal(toChain(setPattern(s, 3, 7)), 'AABBCCCH');
  assert.equal(toChain(setPattern(s, 3, 9)), 'AABBCCCD', 'only A–H');
  assert.equal(toChain(append(s, 6)), 'AABBCCCDGGGG');
  assert.deepEqual(s, toSections('AABBCCCD'), 'edits never mutate');
  const full = toSections('A'.repeat(120) + 'BBBBBBBB');
  assert.equal(totalBars(resize(full, 1, 50)), MAX_BARS, 'lengthen stops at the cap');
  assert.equal(totalBars(duplicate(full, 1)), MAX_BARS);
  assert.equal(totalBars(append(full, 2)), MAX_BARS);
  // dropIndex: centre of the dragged block, in bars.
  assert.equal(dropIndex(s, 2, 0.5), 0);
  assert.equal(dropIndex(s, 2, 1.5), 1);
  assert.equal(dropIndex(s, 0, 3), 1);
  assert.equal(dropIndex(s, 0, 6), 3);
  assert.equal(dropIndex(s, 0, 99), 3);
}

// Section loop skips forward to the loop start whenever the next bar leaves it.
{
  const s = toSections('AABBCCCD'); // C = bars 4..6
  const loop = { first: 2, last: 2 };
  assert.equal(loopSkip(s, loop, 4), 0);
  assert.equal(loopSkip(s, loop, 6), 0);
  assert.equal(loopSkip(s, loop, 7), 5, 'D → next C');
  assert.equal(loopSkip(s, loop, 0), 4, 'from the top');
  assert.equal(loopSkip(s, loop, 8 + 7), 5, 'later passes');
  assert.equal(loopSkip(s, { first: 3, last: 3 }, 8), 7, 'a loop on the last block');
  assert.equal(loopSkip(s, { first: 1, last: 2 }, 7), 3, 'a span of sections');
  assert.equal(loopSkip(s, null, 7), 0);
  assert.equal(loopSkip(s, { first: 9, last: 9 }, 7), 0, 'stale loop is ignored');
}

// Projects and share links keep the chain and the renames; junk is dropped; old saves are untouched.
{
  const st = defaultState();
  st.chain = toChain(move(toSections(st.chain), 0, 3));
  st.chainOn = true;
  st.labels = { A: 'Warm up', G: 'peak', X: 'nope', B: 42 };
  const back = sanitize(JSON.parse(JSON.stringify(st)));
  assert.equal(back.chain, st.chain);
  assert.deepEqual(back.labels, { A: 'WARM UP', B: '42', G: 'PEAK' });
  const old = defaultState();
  assert.equal('labels' in sanitize(JSON.parse(JSON.stringify(old))), false, 'no labels field unless renamed');
  const code = await encodeSong({ title: 'T', artist: 'A', style: 'hypnotic', state: back });
  const got = await decodeSong(code);
  assert.equal(got.state.chain, st.chain, 'share link keeps the arrangement');
  assert.deepEqual(got.state.labels, back.labels, 'share link keeps section names');
}

console.log('timeline ok');
