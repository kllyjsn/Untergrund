// Prompt-to-song plans and lyrics: plan schema, the rule fallback, the /api/song-plan endpoint, lyric splitting,
// syllable slots, playback sync, and that lyrics survive sanitize, save and share links.
import assert from 'node:assert/strict';
import { validatePlan, promptGenre, rulePlan, planEdits, planLyrics, isSongPrompt, styleFor, lyricLines, PLAN_SYSTEM } from '../js/song-plan.js';
import { splitLyrics, cleanLyrics, syllableCount, lineSlots, lyricTimeline, lyricLabels, lyricsText, LIMITS } from '../js/lyrics.js';
import { applyEdits } from '../js/describe.js';
import { defaultState, sanitize, generate, applyOverrides, arrangement, songChain, STYLES } from '../js/state.js';
import { encodeSong, decodeSong } from '../js/share-code.js';
import { handlePlan } from '../api/_lib/song-plan-ai.js';

let fails = 0;
const t = (name, fn) => { try { fn(); } catch (e) { fails++; console.error('FAIL', name, '\n ', e.message); } };
const at = async (name, fn) => { try { await fn(); } catch (e) { fails++; console.error('FAIL', name, '\n ', e.message); } };

function songFor(style, seed = 7) {
  const s = defaultState();
  const g = generate(style, seed);
  applyOverrides(s, g);
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  if (g.key != null) s.key = g.key;
  if (g.scale) s.scale = g.scale;
  s.chainOn = true;
  s.chain = songChain(style, seed);
  return s;
}

const LYRICS = `[Verse 1]
Packed the car before the sun came up
Left the keys beneath the welcome mat

[Chorus]
Goodbye LA, goodbye to you
I'm driving east with nothing new

[Verse 2]
Palm trees fading in the rear view glass
Every mile a little less of us

[Chorus]
Goodbye LA, goodbye to you
I'm driving east with nothing new`;

// 1. Syllables: the count every line carries and the slots a melody will sing them on.
const WORDS = { the: 1, sun: 1, leaving: 2, table: 2, little: 2, lonely: 2, highway: 2, piano: 3, every: 3, beautiful: 3, fire: 1,
  goodbye: 2, something: 2, someday: 2, maybe: 2, rearview: 2, careless: 2, hopeful: 2, lonely: 2, lifetime: 2, sunlight: 2, moonlight: 2, heartbreak: 2, sunset: 2, driving: 2, tomorrow: 3, heaven: 2, ocean: 2, remember: 3, california: 5, nothing: 2, mile: 1, home: 1, stay: 1, love: 1, baby: 2 };
t('syllables: common words', () => {
  const wrong = Object.entries(WORDS).filter(([w, n]) => syllableCount(w) !== n).map(([w, n]) => `${w}=${syllableCount(w)} (want ${n})`);
  assert.ok(wrong.length <= 2, wrong.join(', '));
});
t('syllables: slots carry the word index and word ends', () => {
  const s = lineSlots('Goodbye LA, goodbye');
  assert.equal(s.length, syllableCount('Goodbye LA, goodbye'));
  assert.deepEqual(s.map((x) => x.w), [...new Set(s.map((x) => x.w))].flatMap((w) => s.filter((x) => x.w === w).map(() => w)));
  assert.equal(s.filter((x) => x.end).length, 3);
  assert.ok(s.every((x) => typeof x.s === 'string' && x.s.length));
  assert.equal(syllableCount(''), 0);
  assert.equal(syllableCount('!!! ...'), 0);
});

// 2. Splitting pasted lyrics.
t('split: headers win', () => {
  const s = splitLyrics(LYRICS);
  assert.deepEqual(s.map((x) => x.sec), ['verse', 'chorus', 'verse', 'chorus']);
  assert.equal(s[0].lines[0].t, 'Packed the car before the sun came up');
  assert.ok(s.every((x) => x.lines.every((l) => l.n === syllableCount(l.t) && l.n > 0)));
});
t('split: repeated stanza is the chorus, no headers needed', () => {
  const bare = LYRICS.replace(/^\[.*\]\n/gm, '');
  assert.deepEqual(splitLyrics(bare).map((x) => x.sec), ['verse', 'chorus', 'verse', 'chorus']);
});
t('split: header variants, repeat marks, one stanza', () => {
  const s = splitLyrics('Pre-Chorus:\nhold on\n\n(Bridge)\nwe fall (x2)\n\nOutro\nfade away');
  assert.deepEqual(s.map((x) => x.sec), ['pre', 'bridge', 'outro']);
  assert.equal(s[1].lines[0].t, 'we fall');
  assert.deepEqual(splitLyrics('just one line').map((x) => x.sec), ['verse']);
  assert.deepEqual(splitLyrics(''), []);
  assert.deepEqual(splitLyrics(null), []);
});
t('split: bounded', () => {
  const huge = Array.from({ length: 300 }, (_, i) => `line number ${i} ${'la '.repeat(i % 50)}`).join('\n');
  const s = splitLyrics(huge);
  const lines = s.flatMap((x) => x.lines);
  assert.ok(s.length <= LIMITS.sections && lines.length <= LIMITS.total);
  assert.ok(lines.every((l) => l.t.length <= LIMITS.line));
});
t('split: text round-trips through the editable form', () => {
  const lyrics = cleanLyrics({ sections: splitLyrics(LYRICS) });
  assert.deepEqual(splitLyrics(lyricsText(lyrics)), lyrics.sections);
  assert.deepEqual(lyricLabels(lyrics), ['VERSE 1', 'CHORUS', 'VERSE 2', 'CHORUS']);
});

// 3. Plan schema: whatever comes back is bounded, typed and mapped to our styles.
const GOOD = { title: 'Goodbye LA', about: 'leaving LA', style: 'neosoul', key: 'F#', mode: 'minor', bpm: 90, mood: ['sad', 'warm'], vocal: 'female', instruments: ['piano', 'guitar'],
  form: [{ sec: 'intro', bars: 4, energy: 0.3 }, { sec: 'verse', bars: 8, energy: 0.4 }, { sec: 'chorus', bars: 8, energy: 0.9 }, { sec: 'outro', bars: 4, energy: 0.2 }],
  lyrics: [{ sec: 'verse', lines: ['Packed the car', 'Left the keys'] }, { sec: 'chorus', lines: ['Goodbye LA'] }] };
t('plan: a good answer passes intact', () => {
  const p = validatePlan(GOOD);
  assert.equal(p.style, 'neosoul'); assert.equal(p.key, 6); assert.equal(p.mode, 'minor'); assert.equal(p.bpm, 90);
  assert.equal(p.vocal, 'female'); assert.deepEqual(p.mood, ['sad', 'warm']); assert.deepEqual(p.instruments, ['piano', 'guitar']);
  assert.deepEqual(p.form.map((f) => f.sec), ['intro', 'verse', 'chorus', 'outro']);
  assert.deepEqual(p.lyrics.map((s) => [s.sec, s.lines.map((l) => l.t)]), [['verse', ['Packed the car', 'Left the keys']], ['chorus', ['Goodbye LA']]]);
  assert.equal(p.lyrics[0].lines[0].n, syllableCount('Packed the car'));
});
t('plan: junk is rejected or clamped', () => {
  for (const bad of [null, 1, 'x', [], {}, { style: 'xyzzy' }]) assert.equal(validatePlan(bad), null, JSON.stringify(bad));
  const p = validatePlan({ style: 'TRAP', key: 'H', mode: 'lydian-ish', bpm: 999, mood: 'dark', vocal: 'robot', form: [{ sec: 'solo' }, 'chorus', { sec: 'verse', bars: 99, energy: 7 }],
    lyrics: [{ sec: 'verse', lines: [{ t: 'ok', n: 99 }, 5, '<script>x</script>'.repeat(20)] }, { sec: 'evil', lines: ['nope'] }], instruments: Array(20).fill('x'.repeat(80)) });
  assert.equal(p.style, 'trap'); assert.equal(p.key, null); assert.equal(p.mode, null); assert.equal(p.bpm, 200); assert.equal(p.vocal, null);
  assert.deepEqual(p.form.map((f) => [f.sec, f.bars, f.energy]), [['chorus', 8, 0.85], ['verse', 32, 1]]);
  assert.equal(p.lyrics.length, 1);
  assert.equal(p.lyrics[0].lines[0].n, 1);
  assert.ok(p.lyrics[0].lines.every((l) => l.t.length <= LIMITS.line));
  assert.ok(p.instruments.length <= 6 && p.instruments.every((x) => x.length <= 24));
  assert.ok(STYLES[validatePlan({ genre: 'indie folk' }).style]);
  assert.equal(validatePlan({ style: 'x' }, { fallbackStyle: 'ambient' }).style, 'ambient');
});
t('plan: every unsupported genre lands on a real style', () => {
  for (const g of ['indie', 'pop', 'rock', 'r&b', 'folk', 'country', 'rap', 'jazz', 'edm', 'lofi', 'singer-songwriter']) assert.ok(STYLES[styleFor(g)], g);
  assert.ok(!PLAN_SYSTEM.includes('repertoire'));
});
t('plan: pasted lines are grouped by range, never rewritten', () => {
  const lines = lyricLines(LYRICS);
  const p = validatePlan({ style: 'neosoul', lyrics: [{ sec: 'verse', from: 1, to: 2, lines: ['REWRITTEN'] }, { sec: 'chorus', from: 3, to: 4 }, { sec: 'verse', from: 5, to: 6 }, { sec: 'chorus', from: 7, to: 8 }] }, { lines });
  assert.deepEqual(p.lyrics.map((s) => s.sec), ['verse', 'chorus', 'verse', 'chorus']);
  assert.deepEqual(p.lyrics.flatMap((s) => s.lines.map((l) => l.t)), lines);
  const gaps = validatePlan({ style: 'neosoul', lyrics: [{ sec: 'chorus', from: 3, to: 4 }] }, { lines });
  assert.deepEqual(gaps.lyrics.flatMap((s) => s.lines.map((l) => l.t)), lines, 'unclaimed lines are kept');
});

// 4. Rule fallback (no endpoint): the Suno-style prompt still becomes a full plan.
t('fallback: the example prompt', () => {
  const p = rulePlan('sad indie song about leaving LA, female vocal, 90 bpm', '', { style: 'deephouse' });
  assert.equal(p.style, 'neosoul'); assert.equal(p.bpm, 90); assert.equal(p.vocal, 'female'); assert.equal(p.mode, 'minor');
  assert.equal(p.about, 'leaving LA');
  assert.ok(!p.mood.join(' ').match(/bpm|female|about/i), p.mood.join(' '));
  assert.ok(p.form.length >= 4 && p.form.some((f) => f.sec === 'chorus'));
});
t('fallback: key, style, tempo words', () => {
  const d = rulePlan('a love song in D major, slow');
  assert.equal(d.key, 2); assert.equal(d.mode, 'major');
  assert.equal(rulePlan('dark trap song about money, male rap, 145 bpm').style, 'trap');
  assert.equal(rulePlan('dreamy ambient piece about the ocean').style, 'ambient');
  assert.equal(rulePlan('a song', '', { style: 'dnb' }).style, 'dnb');
});
t('fallback: pasted lyrics set form, title and sections', () => {
  const p = rulePlan('', LYRICS, { style: 'neosoul' });
  assert.deepEqual(p.lyrics.map((s) => s.sec), ['verse', 'chorus', 'verse', 'chorus']);
  assert.deepEqual(p.form.map((f) => f.sec), ['intro', 'verse', 'chorus', 'verse', 'chorus', 'outro']);
  assert.equal(p.title, 'Goodbye LA');
});
t('song prompts vs plain edits', () => {
  for (const s of ['sad indie song about leaving LA', 'a ballad', 'upbeat track about summer', 'female vocal house']) assert.ok(isSongPrompt(s), s);
  for (const s of ['darker', 'less busy', 'more reverb on the vocal', 'add a piano', 'faster', '']) assert.ok(!isSongPrompt(s), s);
  assert.ok(isSongPrompt('', 'some lyrics'));
});
t('plan edits apply through the Describe path', () => {
  const p = rulePlan('sad indie song about leaving LA, female vocal, 90 bpm', '', { style: 'deephouse' });
  const edits = planEdits(p);
  assert.ok(edits.some((e) => e.id === 'bpm' && e.value === 90));
  assert.ok(!edits.some((e) => e.id === 'tempo'));
  const r = applyEdits(songFor(p.style), edits, { seed: 3, style: p.style });
  assert.equal(r.state.bpm, 90);
  assert.equal(r.state.scale, 'minor');
  const hot = planEdits(validatePlan({ ...GOOD, form: [{ sec: 'chorus', energy: 1 }, { sec: 'verse', energy: 0.1 }] }));
  assert.ok(hot.some((e) => e.id === 'section' && e.op === 'energy'));
  assert.deepEqual(planEdits(null), []);
});

// 5. Lyrics follow the song: chorus bars show the chorus.
t('playback: chain sections map to lyric sections', () => {
  const lyrics = cleanLyrics({ sections: splitLyrics(LYRICS) });
  for (const style of ['deephouse', 'neosoul', 'trap', 'ambient']) {
    const s = songFor(style);
    const tl = lyricTimeline(s.chain, lyrics, { kind: style === 'neosoul' || style === 'trap' ? 'groove' : 'club' });
    assert.ok(tl.length > 0, style);
    assert.ok(tl.every((x) => x == null || (lyrics.sections[x.s] && x.l >= 0 && x.l < lyrics.sections[x.s].lines.length)), style);
    assert.ok(tl.some(Boolean), `${style}: some bar shows lyrics`);
  }
  assert.deepEqual(lyricTimeline('', lyrics), []);
  assert.deepEqual(lyricTimeline(songFor('deephouse').chain, null), []);
});

// 6. Sanitize, save and share.
t('sanitize: lyrics kept, bounded and cleaned', () => {
  const s = songFor('neosoul');
  s.lyrics = cleanLyrics(planLyrics(rulePlan('sad song about LA, female vocal', LYRICS), 'sad song about LA, female vocal'));
  const back = sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back.lyrics, s.lyrics);
  assert.equal(back.lyrics.vocal, 'female');
  const dirty = sanitize({ ...s, lyrics: { v: 9, prompt: 'p\u0000'.repeat(500), vocal: 'robot', title: 7, sections: [{ sec: 'verse', lines: ['a\u202Eb', { t: 'x'.repeat(500), n: -4 }] }, { sec: 'evil', lines: ['no'] }, 'junk'], extra: { x: 1 } } });
  assert.equal(dirty.lyrics.vocal, undefined);
  assert.equal(dirty.lyrics.sections[0].lines[0].t, 'a b');
  const bidi = cleanLyrics({ sections: [{ sec: 'verse', lines: ['\u2066evil\u2069 \u202Etxet\u202C\u200F\uFEFF ok'] }] });
  assert.ok(!/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(bidi.sections[0].lines[0].t), bidi.sections[0].lines[0].t);
  assert.ok(dirty.lyrics.prompt.length <= 200 && !/\u0000/.test(dirty.lyrics.prompt));
  assert.deepEqual(dirty.lyrics.sections.map((x) => x.sec), ['verse']);
  assert.ok(dirty.lyrics.sections[0].lines.every((l) => l.t.length <= LIMITS.line && l.n === syllableCount(l.t)));
  assert.equal(dirty.lyrics.extra, undefined);
  for (const junk of [null, 5, 'x', [], { sections: 'no' }, { sections: [] }]) assert.equal(sanitize({ ...s, lyrics: junk }).lyrics, undefined, JSON.stringify(junk));
});
t('promptGenre: the genre a prompt names, whatever is playing', () => {
  assert.equal(promptGenre('sad indie song about leaving LA, female vocal, 90 bpm'), 'neosoul');
  assert.equal(promptGenre('dark trap song about money, male rap, 145 bpm'), 'trap');
  assert.equal(promptGenre('A sunrise drive song'), null);
  for (const style of ['neosoul', 'breaks', 'deephouse']) assert.equal(rulePlan('sad indie song about leaving LA, 90 bpm', '', { style }).style, 'neosoul');
});
t('sanitize: projects without lyrics are unchanged', () => {
  const s = songFor('deephouse');
  const back = sanitize(JSON.parse(JSON.stringify(s)));
  assert.ok(!('lyrics' in back));
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(back))), back);
});
await at('share: lyrics survive a share link', async () => {
  const s = songFor('neosoul');
  s.lyrics = cleanLyrics({ prompt: 'sad indie song', vocal: 'female', sections: splitLyrics(LYRICS) });
  const song = await decodeSong(await encodeSong({ state: s, title: 'Goodbye LA' }));
  assert.deepEqual(song.state.lyrics, s.lyrics);
  const plain = songFor('neosoul');
  assert.ok(!('lyrics' in (await decodeSong(await encodeSong({ state: plain }))).state));
});

// 7. The endpoint: env-gated, rate limited, timed out, and its answer validated.
const reply = (content, status = 200) => async (url, init) => { reply.last = { url, init }; return { ok: status < 300, status, json: async () => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }) }; };
const call = (body, extra = {}) => handlePlan({ method: 'POST', body, key: 'k', fetchImpl: reply(GOOD), ...extra });
await at('endpoint: off without a key, nothing called', async () => {
  let called = false;
  const r = await handlePlan({ method: 'POST', body: { prompt: 'a song' }, fetchImpl: async () => { called = true; } });
  assert.equal(r.status, 501); assert.equal(called, false);
});
await at('endpoint: method and empty input', async () => {
  assert.equal((await handlePlan({ method: 'GET', key: 'k' })).status, 405);
  assert.equal((await call({ prompt: '   ' })).status, 400);
  assert.equal((await call('not json')).status, 400);
});
await at('endpoint: good answer, validated', async () => {
  const r = await call(JSON.stringify({ prompt: 'sad indie song about leaving LA', style: 'deephouse' }));
  assert.equal(r.status, 200); assert.equal(r.json.plan.style, 'neosoul');
  const sent = JSON.parse(reply.last.init.body);
  assert.equal(sent.response_format.type, 'json_object');
  assert.match(sent.model, /lite|mini|flash|haiku/);
  assert.equal(JSON.parse(sent.messages[1].content).request, 'sad indie song about leaving LA');
});
await at('endpoint: pasted lyrics go out numbered and come back word for word', async () => {
  const r = await call({ prompt: 'a song', lyrics: LYRICS }, { fetchImpl: reply({ style: 'neosoul', lyrics: [{ sec: 'verse', from: 1, to: 2 }, { sec: 'chorus', from: 3, to: 4 }, { sec: 'verse', from: 5, to: 6 }, { sec: 'chorus', from: 7, to: 8 }] }) });
  const sent = JSON.parse(JSON.parse(reply.last.init.body).messages[1].content);
  assert.equal(sent.lines[0], '1. Packed the car before the sun came up');
  assert.deepEqual(r.json.plan.lyrics.flatMap((s) => s.lines.map((l) => l.t)), lyricLines(LYRICS));
});
await at('endpoint: bad model output and failures are 502s', async () => {
  assert.equal((await call({ prompt: 'a song' }, { fetchImpl: reply('not json') })).status, 502);
  assert.equal((await call({ prompt: 'a song' }, { fetchImpl: reply({ style: 'evil' }) })).status, 502);
  assert.equal((await call({ prompt: 'a song' }, { fetchImpl: reply(GOOD, 500) })).status, 502);
  const slow = (url, init) => new Promise((_, no) => init.signal.addEventListener('abort', () => no(new Error('aborted'))));
  const t0 = Date.now();
  assert.equal((await call({ prompt: 'a song' }, { fetchImpl: slow, timeout: 50 })).status, 502);
  assert.ok(Date.now() - t0 < 1000);
});
await at('endpoint: rate limited per client per hour', async () => {
  const counts = new Map();
  const kv = async (cmds) => cmds.map(([op, k]) => (op === 'INCR' ? (counts.set(k, (counts.get(k) || 0) + 1), counts.get(k)) : 1));
  const codes = [];
  for (let i = 0; i < 22; i++) codes.push((await call({ prompt: 'a song' }, { kv, client: '1.2.3.4', now: 0 })).status);
  assert.deepEqual(codes.slice(0, 20), Array(20).fill(200));
  assert.equal(codes[21], 429);
  assert.equal((await call({ prompt: 'a song' }, { kv, client: '5.6.7.8', now: 0 })).status, 200);
});

if (fails) { console.error(`\n${fails} song-plan test(s) failed`); process.exit(1); }
console.log('song-plan: ok');
