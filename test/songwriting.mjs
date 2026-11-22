// Songwriting: lyric stress and rhyme (js/prosody.js), rule-written lyrics (js/lyric-writer.js) and melodies set to
// them (fitLyrics): stressed syllables on beats, the title on the chorus downbeat and peak, the hook returning exactly.
import assert from 'node:assert/strict';
import { lineStress, rhymes } from '../js/prosody.js';
import { writeLyrics, rhymePairs, themeOf } from '../js/lyric-writer.js';
import { FEELS, FEEL_IDS } from '../js/feel.js';
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

// Words in the song's feeling: the theme is the feeling's (or a named topic that agrees with it), so a happy chorus
// never sings heartbreak and a sad one never sings sunshine. No feeling: the original six themes, chosen as before.
export const SAD = /\b(?:cry\w*|tears?|alone|lonely|hurt\w*|falling|yesterday|cold|empty|without|sorry|lost|broken|goodbye|miss\w*|gone)\b/i;
export const JOY = /\b(?:alive|sun\w*|free|danc\w*|golden|bright|smil\w*|summer|happy|flying|fire)\b/i;
{
  const prompts = ['a song', 'write me a pop song', ...LYRIC_PROMPTS, 'a happy song about the rain', 'a sad song about the summer'];
  const themes = new Set(), choruses = new Set();
  let pairs = 0, rhymed = 0;
  for (const feel of FEEL_IDS) for (const prompt of prompts) for (const seed of [1, 2, 3, 4]) {
    const a = writeLyrics({ prompt, style: 'pop', seed, feel }), F = FEELS[feel];
    assert.deepEqual(a, writeLyrics({ prompt, style: 'pop', seed, feel }), 'deterministic');
    const th = themeOf(prompt, [], feel), sung = [a.title, ...a.sections.filter((x) => x.sec === 'chorus' || x.sec === 'pre').flatMap((x) => x.lines)].join(' ');
    themes.add(th); choruses.add(a.sections.find((x) => x.sec === 'chorus').lines[1]);
    if (F.valence > 0.4) assert(!SAD.test(sung), `${feel} "${prompt}": no sad words in a happy chorus (${sung.match(SAD)})`);
    if (F.valence < -0.4) assert(!JOY.test(sung), `${feel} "${prompt}": no joy words in a sad chorus (${sung.match(JOY)})`);
    for (const [x, y] of rhymePairs(a.sections)) { pairs++; if (rhymes(x.split(' ').at(-1), y.split(' ').at(-1))) rhymed++; }
  }
  assert.equal(themeOf('a song', [], 'dark'), 'shadow');
  assert.equal(themeOf('a happy song about the rain', [], 'joyful'), 'summer', 'a topic that disagrees gives way to the feeling');
  assert.equal(themeOf('a song about going home', [], 'longing'), 'home', 'a topic that agrees is kept');
  assert.equal(themeOf('a dark dreamy song', []), 'love', 'no feeling: the new themes are never chosen');
  assert(themes.size === 9, `every theme is reachable (${[...themes]})`);
  assert(choruses.size >= 20, `chorus variety (${choruses.size})`);
  assert(rhymed / pairs >= 0.9, `line ends rhyme across feelings (${rhymed}/${pairs})`);
}
console.log('feeling lyrics passed');

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
  assert.equal(sw.verseFit, 1, `${style} verse phrases climb a 4th to a 6th, under the title`);
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(a))).patterns.find((p) => p.hook?.m).hook.m, m, `${style} melody survives sanitize`);
}
// Genres that don't write songs keep their hook.
{
  const s = buildSong('peak', 101);
  s.lyrics = { v: 1, sections: [{ sec: 'chorus', lines: ['a line to sing'] }] };
  assert.equal(fitLyrics(s, 'peak'), s);
}
console.log('songwriting passed');

// Edge lines: a one-word title holds from the chorus downbeat; a long pasted line keeps a note per syllable.
{
  const s = buildSong('pop', 5), long = 'and every single little thing that you ever said to me was true';
  s.lyrics = { v: 1, sections: [{ sec: 'chorus', lines: ['Stay', 'I need you here tonight', 'Stay', 'until the morning light'] }, { sec: 'verse', lines: [long] }] };
  const m = fitLyrics(s, 'pop').patterns.find((p) => p.hook?.m).hook.m;
  assert.equal(m.n.filter((x) => x[4] === 0).sort((a, b) => a[0] - b[0])[0][0], 0, 'one-syllable title on the downbeat');
  assert.equal(new Set(m.v.filter((x) => x[4] === 0 && x[0] < 30).map((x) => x[5])).size, lineStress(long).length, 'every syllable of a long line sung');
}
assert.equal(rulePlan('a country instrumental song').lyrics.length, 0, 'instrumental stays wordless');
console.log('edge lines passed');
