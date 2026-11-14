// Songwriting: lyric stress and rhyme (js/prosody.js), rule-written lyrics (js/lyric-writer.js) and melodies set to
// them (fitLyrics): stressed syllables on beats, the title on the chorus downbeat and peak, the hook returning exactly.
import assert from 'node:assert/strict';
import { lineStress, rhymes } from '../js/prosody.js';
import { writeLyrics, rhymePairs } from '../js/lyric-writer.js';
import { rulePlan, planLyrics } from '../js/song-plan.js';
import { cleanLyrics } from '../js/lyrics.js';
import { fitLyrics, sanitize } from '../js/state.js';
import { buildSong, songwriting, lyricSong, LYRIC_PROMPTS } from '../scripts/composition.mjs';

assert.equal(lineStress('I will not look back at the door').join(''), '00111001');
assert.equal(lineStress('Boxes on the kitchen floor').join(''), '1010101');
assert.equal(lineStress('tonight').join(''), '01');
for (const [a, b] of [['door', 'floor'], ['rain', 'again'], ['night', 'light'], ['home', 'alone'], ['fire', 'higher']]) assert(rhymes(a, b), `${a}/${b}`);
for (const [a, b] of [['door', 'light'], ['rain', 'home']]) assert(!rhymes(a, b), `${a}/${b}`);
console.log('prosody passed');

// The rule writer: deterministic, a story verse, the title twice in every chorus, rhymed couplets.
{
  let pairs = 0, rhymed = 0;
  for (const prompt of LYRIC_PROMPTS) for (const seed of [1, 2, 3]) {
    const a = writeLyrics({ prompt, style: 'pop', seed });
    assert.deepEqual(a, writeLyrics({ prompt, style: 'pop', seed }), 'same prompt and seed, same lyrics');
    const ch = a.sections.filter((s) => s.sec === 'chorus');
    assert(ch.length >= 3 && ch.every((s) => s.lines[0] === a.hook && s.lines[2] === a.hook && a.hook.includes(a.title)), `${prompt}: title in the chorus`);
    assert(a.sections.filter((s) => s.sec === 'verse').every((s) => s.lines.length === 4), 'four-line verses');
    for (const [x, y] of rhymePairs(a.sections)) { pairs++; if (rhymes(x.split(' ').at(-1), y.split(' ').at(-1))) rhymed++; }
  }
  assert(rhymed / pairs >= 0.9, `line ends rhyme (${rhymed}/${pairs})`);
}
console.log('lyric writer passed');

// Rule plans: a sung genre without pasted words gets written lyrics; club genres and pasted lyrics are unchanged.
{
  const p = rulePlan('sad indie song about leaving LA, female vocal, 90 bpm', '', { style: 'deephouse' });
  assert.equal(p.style, 'folk'); assert.equal(p.title, 'Leaving LA');
  assert(p.lyrics.some((s) => s.sec === 'chorus' && s.lines[0].t.includes('Leaving LA')));
  assert.equal(rulePlan('dark techno for a warehouse at 4am', '', { style: 'techno' }).lyrics.length, 0);
  assert.equal(rulePlan('dreamy ambient piece about the ocean').lyrics.length, 0);
  const lyr = cleanLyrics(planLyrics(p, 'x'));
  assert(lyr.sections.length >= 5);
}
console.log('rule plan lyrics passed');

// Text setting: fixed seeds give the same melody; the song genres put the title on the chorus downbeat and peak.
for (const style of ['pop', 'rnb', 'folk']) {
  const a = lyricSong(style, 101), b = lyricSong(style, 101), m = a.patterns.find((p) => p.hook?.m).hook.m;
  assert.deepEqual(m, b.patterns.find((p) => p.hook?.m).hook.m, `${style} is deterministic`);
  const sw = songwriting(m, a.lyrics.sections);
  assert(sw.stressBeat >= 0.9 && sw.titleDownbeat === 1 && sw.titlePeak === 1 && sw.hookRecall === 1, `${style} ${JSON.stringify(sw)}`);
  assert(sw.vocalRange <= 17, `${style} range ${sw.vocalRange}`);
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(a))).patterns.find((p) => p.hook?.m).hook.m, m, `${style} melody survives sanitize`);
}
// Genres that don't write songs keep their hook.
{
  const s = buildSong('peak', 101);
  s.lyrics = { v: 1, sections: [{ sec: 'chorus', lines: ['a line to sing'] }] };
  assert.equal(fitLyrics(s, 'peak'), s);
}
console.log('songwriting passed');
