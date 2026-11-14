// English word stress and rhyme by rule, for setting words to a melody (js/melody.js) and checking rhymes.
// No dictionary: function words are weak, one-syllable content words strong, longer words stress their first
// syllable unless a prefix or ending moves it (be-LIEVE, to-NIGHT, e-MO-tion).
import { lineSlots, syllabify } from './lyrics.js';

const WEAK = new Set(('a an the to of and or but nor in on at by for from with as is am are was were be been being it its '
  + "i i'm i'll i've i'd me my you you're you'll your we we're our us he him his she her they them their it's "
  + 'do does did can could will would shall should may might must has have had that than then so if when while '
  + 'there their this these those just up oh').split(' '));
// Pronouns and the like that carry the line when they end it ("I'll wait for you").
const END_STRONG = new Set(['me', 'you', 'us', 'him', 'her', 'them', 'it', 'up', 'oh', 'so', 'there', 'this', 'that', 'then', 'now']);
const SECOND = new Set(('again alone along above around about across alive awake ago apart ahead aside away among afraid '
  + 'believe become before behind below beneath beside between beyond because forget forgive forgot tonight today tomorrow '
  + 'until unless without within inside myself yourself hello goodbye return remain remember surrender together forever '
  + 'desire decide delight deny enough escape erase embrace ignore guitar machine okay hotel july la').split(' '));
const FIRST = new Set('after anywhere angel answer even every ever evening other only over open river even record rescue under '
  .split(' '));
const PREFIX = /^(?:a|be|de|re|for|to|un|en|em|ex|im|pre|con|com)$/;

// Stress per syllable of one word: 1 primary, 0 weak.
export function wordStress(word, last = false) {
  const syl = syllabify(word), w = String(word).toLowerCase().replace(/[^a-z']/g, '');
  if (syl.length <= 1) return syl.map(() => (WEAK.has(w) && !(last && END_STRONG.has(w)) ? 0 : 1));
  let k = 0;
  if (SECOND.has(w)) k = 1;
  else if (/(?:tion|sion|cian|tial|cial)s?$/.test(w)) k = syl.length - 2;
  else if (/(?:ity|ical|ically)$/.test(w) && syl.length > 2) k = syl.length - 3;
  else if (/ic$/.test(w) || /(?:ee|eer|oon|ique|ade)$/.test(w)) k = syl.length - (/ic$/.test(w) ? 2 : 1);
  else if (!FIRST.has(w) && PREFIX.test(syl[0].toLowerCase()) && !/(?:ing|ed|er|ly|y|est|ness|less|ful)$/.test(syl[1].toLowerCase())) k = 1;
  return syl.map((_, i) => (i === Math.max(0, Math.min(syl.length - 1, k)) ? 1 : 0));
}

// Stress per syllable slot of a line (lineSlots order).
export function lineStress(text) {
  const words = String(text ?? '').split(/[\s\u2014\u2013-]+/).filter(Boolean).filter((x) => syllabify(x).length);
  const out = [];
  words.forEach((x, i) => out.push(...wordStress(x, i === words.length - 1)));
  // Never three weak syllables in a row: the middle one takes the beat.
  for (let i = 0, run = 0; i < out.length; i++) { run = out[i] ? 0 : run + 1; if (run === 3) { out[i - 1] = 1; run = 1; } }
  return out.length === lineSlots(text).length ? out : lineSlots(text).map((_, i) => (i % 2 ? 0 : 1));
}

// A rhyme key: the sound of the last stressed vowel to the end of the word, from spelling.
const SOUND = {
  again: 'ein', soul: 'ol', control: 'ol', friend: 'end', life: 'aif', wife: 'aif', said: 'ed', been: 'in', gone: 'on', done: 'un', one: 'un', love: 'uv', above: 'uv', of: 'uv', come: 'um', some: 'um',
  heart: 'art', are: 'ar', through: 'u', you: 'u', do: 'u', to: 'u', two: 'u', who: 'u', true: 'u', blue: 'u', new: 'u', knew: 'u',
  now: 'au', how: 'au', down: 'aun', town: 'aun', know: 'o', show: 'o', go: 'o', slow: 'o', snow: 'o', glow: 'o', low: 'o', grow: 'o',
  though: 'o', own: 'on', alone: 'on', home: 'om', eyes: 'aiz', lies: 'aiz', skies: 'aiz', sky: 'ai', by: 'ai', why: 'ai', my: 'ai', fly: 'ai',
  cry: 'ai', try: 'ai', high: 'ai', goodbye: 'ai', eye: 'ai', die: 'ai', lie: 'ai', there: 'er', where: 'er', care: 'er', air: 'er',
  hair: 'er', wear: 'er', bear: 'er', their: 'er', were: 'ur', her: 'ur', word: 'urd', heard: 'urd', world: 'urld', fire: 'aier',
  wire: 'aier', higher: 'aier', desire: 'aier', door: 'or', more: 'or', floor: 'or', before: 'or', your: 'or', war: 'or', for: 'or', light: 'ait', la: 'ei', okay: 'ei',
  wait: 'eit', late: 'eit', eight: 'eit', straight: 'eit', great: 'eit', break: 'eik', head: 'ed', bread: 'ed', dead: 'ed', red: 'ed',
  give: 'iv', live: 'iv', touch: 'uch', much: 'uch', young: 'ung', tongue: 'ung', blood: 'ud', mind: 'aind', find: 'aind', kind: 'aind',
  behind: 'aind', wild: 'aild', child: 'aild', road: 'od', know_: 'o',
};
const norm = (t) => t.replace(/ck$/, 'k').replace(/([^aeiou])\1$/, '$1').replace(/s$/, '').replace(/m$/, 'n');
export function rhymeKey(word) {
  let w = String(word ?? '').toLowerCase().replace(/[^a-z']/g, '').replace(/'s$/, '').replace(/'/g, '');
  if (!w) return '';
  if (SOUND[w]) return norm(SOUND[w]);
  const tail = Object.keys(SOUND).find((k) => k.length >= 3 && w.length > k.length && w.endsWith(k) && !/^[aeiou]/.test(k));
  if (tail) return norm(SOUND[tail]);
  // Past tenses rhyme on the stem: seemed / dream.
  if (/[^aeiou]ed$/.test(w) && !/[td]ed$/.test(w) && /[aeiouy]/.test(w.slice(0, -3))) w = w.slice(0, -2);
  const syl = syllabify(w);
  let t = syl.length > 1 && /[^aeiou]y$/.test(w) ? 'ee' : w;
  if (t === w) {
    t = w.replace(/^.*?([aeiouy]+[^aeiouy]*(?:e|es|ed)?)$/, '$1');
    const rules = [[/^igh(t?)s?$/, 'ai$1'], [/^i([^aeiou]+)e(s|d)?$/, 'ai$1'], [/^ie([sd]?)$/, 'ai$1'], [/^air$|^are$/, 'er'], [/^ow([^aeiou]+)$/, 'au$1'], [/^y$/, 'ai'], [/^ai([^aeiou]*)$/, 'ei$1'],
      [/^a([^aeiou])e(s|d)?$/, 'ei$1'], [/^ay[s]?$/, 'ei'], [/^ey$/, 'ei'], [/^ea([^aeiou]*)$/, 'ee$1'], [/^ee([^aeiou]*)$/, 'ee$1'],
      [/^o([^aeiou])e(s|d)?$/, 'o$1'], [/^oa([^aeiou]*)$/, 'o$1'], [/^ow(s?)$/, 'o'], [/^oo([^aeiou]*)$/, 'u$1'], [/^u([^aeiou])e$/, 'u$1'],
      [/^ue$|^ew$/, 'u'], [/^ou([^aeiou]*)$/, 'au$1'], [/^e$/, 'ee'], [/^o$/, 'o']];
    for (const [re, to] of rules) if (re.test(t)) { t = t.replace(re, to); break; }
  }
  return norm(t);
}
const lastWord = (line) => String(line ?? '').toLowerCase().replace(/[^a-z' ]/g, ' ').trim().split(/\s+/).at(-1) || '';
// Two lines rhyme when their last words share the rhyme key (identical words don't count).
export function rhymes(a, b) {
  const x = lastWord(a), y = lastWord(b);
  if (!x || !y || x === y) return false;
  const p = rhymeKey(x), q = rhymeKey(y);
  return !!p && p === q;
}
