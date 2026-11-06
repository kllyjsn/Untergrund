import assert from 'node:assert/strict';
import { generate, arrangement, sanitize, defaultState, STYLES, MUSICIAN_PRINCIPLES } from '../js/state.js';
import { SCALES } from '../js/params.js';

// Every club/pop style gets its own seeded hook; NEO-SOUL and BOOM BAP keep their Rhodes licks.
for (const style of Object.keys(STYLES)) {
  const a = generate(style, 11, 'minor'), b = generate(style, 22, 'minor');
  if (style === 'neosoul' || style === 'boombap') { assert.equal(a.pattern.hook, undefined, style); continue; }
  if (STYLES[style].family === 'CLASSICAL') { assert(a.pattern.score && !a.pattern.hook, `${style} is a score, not a hook loop`); continue; }
  assert(a.pattern.hook && a.pattern.hook.s.length === 32, `${style} needs a hook`);
  const notes = a.pattern.hook.s.filter(Boolean);
  assert(notes.length >= 4, `${style} hook too sparse`);
  const pcs = new Set(SCALES.minor.notes.map((n) => n % 12));
  for (const [n] of notes) assert(pcs.has(((n % 12) + 12) % 12), `${style} hook note ${n} out of scale`);
  assert.notDeepEqual(a.pattern.hook.s, b.pattern.hook.s, `${style} hooks repeat across seeds`);
}
console.log('seeded hooks passed');

assert.deepEqual(Object.keys(MUSICIAN_PRINCIPLES), ['listen', 'respond', 'space', 'develop', 'risk', 'remember']);
for (const style of ['hypnotic', 'deephouse', 'euphoric', 'afrobeats', 'trap']) {
  const hook = generate(style, 84).pattern.hook;
  assert(hook.x && Object.values(hook.x).every((n) => n > 0 && n < 1), `${style} needs an expression plan`);
  assert.notDeepEqual(hook.s.slice(0, 16), hook.s.slice(16), `${style} answer should develop the call`);
  const velocities = new Set(hook.s.filter(Boolean).map((n) => n[2].toFixed(2)));
  assert(velocities.size >= 3, `${style} needs a dynamic phrase`);
}
console.log('musician principles and expression plans passed');

// Seeds change the key, and the groove bass is written per seed rather than picked from a fixed line.
const keys = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => generate('deephouse', seed).key));
assert(keys.size >= 4, 'keys should vary across seeds');
for (const style of ['deephouse', 'ukg', 'afrobeats']) {
  const lines = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(generate(style, seed).pattern.steps.acid)));
  assert(lines.size >= 4, `${style} bass lines repeat across seeds`);
}
console.log('per-seed key and bass passed');

{
  const g = generate('deephouse', 42);
  const scenes = arrangement(g.pattern, 42);
  assert.deepEqual(scenes.map((p) => p.hm), [0, 0, 1, 2, 2, 1, 2, 2], 'hook is held back for the intro');
  const s = defaultState(); s.patterns = scenes;
  const round = sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round.patterns[6].hook, g.pattern.hook);
  assert.equal(round.patterns[0].hm, 0);
}
console.log('hook arrangement and save round-trip passed');

// Neighbouring genres must not share one template: different rooms, lead roles and hook writing.
{
  const g = (st) => generate(st, 21);
  for (const st of ['trap', 'drill', 'reggaeton', 'ukg', 'dnb', 'hyperpop']) {
    assert(g(st).master.revLevel <= 0.4, `${st} should be drier than the ambient/trance room`);
  }
  for (const [a, b] of [['ukg', 'deephouse'], ['dnb', 'euphoric'], ['amapiano', 'afrobeats'], ['hyperpop', 'trance'], ['trap', 'reggaeton']]) {
    const A = g(a), B = g(b);
    const sig = (x) => [x.pattern.hook?.v, x.pattern.hook?.o, x.master.revLevel, x.params.stab.voice, x.params.acid.voice, x.bpm].join('|');
    assert.notEqual(sig(A), sig(B), `${a} and ${b} share a sound signature`);
    const rhythm = (x) => x.pattern.hook.s.map(Boolean).join('');
    assert.notEqual(rhythm(A), rhythm(B), `${a} and ${b} hooks share a rhythm`);
  }
console.log('genre signatures passed');

// A genre is a musical grammar, not one fixed preset. Different seeds should
// recruit different players and registers without borrowing another genre's drums or harmony.
  {
    for (const style of Object.keys(STYLES)) {
      if (STYLES[style].family === 'CLASSICAL') continue;
      const ensembles = new Set();
      for (let seed = 1; seed <= 24; seed++) {
        const g = generate(style, seed);
        ensembles.add([
          g.params.stab.voice,
          g.params.acid.voice,
          g.params.stab.octave,
        ].join('/'));
      }
      assert(ensembles.size >= 4, `${style} needs several seeded ensembles`);
    }
    const recorded = new Set();
    for (const style of Object.keys(STYLES)) {
      for (let seed = 1; seed <= 24; seed++) {
        const voice = generate(style, seed).params.stab.voice;
        if (voice >= 7) recorded.add(voice);
      }
    }
    assert.deepEqual([...recorded].sort((a, b) => a - b), [7, 8, 9, 10], 'all recorded families should appear across generated songs');
    for (const style of ['trap', 'drill']) {
      for (let seed = 1; seed <= 24; seed++) assert.equal(generate(style, seed).params.acid.voice, 2, `${style} must keep its sliding 808`);
    }
    for (const style of ['bailefunk', 'jerseyclub']) {
      for (let seed = 1; seed <= 24; seed++) assert.notEqual(generate(style, seed).params.acid.voice, 4, `${style} must not borrow amapiano's log drum`);
    }
    for (const style of Object.keys(STYLES)) {
      for (let seed = 1; seed <= 24; seed++) {
        const g = generate(style, seed);
        if (g.params.stab.voice === 6) assert(g.params.stab.octave <= 1, `${style} bells are already voiced one octave high`);
        if ([3, 4].includes(g.params.stab.voice)) assert(g.params.stab.octave >= 0, `${style} organ/brass must stay out of the sub register`);
        if (g.params.stab.voice >= 7) assert(g.params.stab.octave >= 0, `${style} recorded chords must not fold into clustered voicings`);
      }
    }
    for (const style of ['industrial', 'acid', 'peak', 'hardtechno']) {
      for (let seed = 1; seed <= 24; seed++) assert(generate(style, seed).pattern.steps.stab.some(Boolean), `${style} ensembles need audible chord steps`);
    }
    for (let seed = 1; seed <= 24; seed++) {
      assert.equal(generate('trance', seed).params.acid.voice, 0, 'trance must keep its rolling 303');
      assert.notEqual(generate('electro', seed).params.acid.voice, 3, 'electro must not borrow the DnB Reese');
      assert.equal(generate('ambient', seed).params.acid.voice, 1, 'ambient bass must avoid an 808 pitch knock');
      const ukg = generate('ukg', seed);
      if (ukg.params.stab.voice === 3) assert(ukg.params.stab.decay <= 0.3, 'UK garage organ must stay gated');
    }
    assert(new Set(Array.from({ length: 24 }, (_, i) => generate('neosoul', i + 1).params.stab.voice)).has(1), 'neo-soul needs Rhodes/keys');
  }
console.log('seeded instrument ensembles passed');
}

// Motif development keeps every variant in the scale and recognisable, and the breakdown gets its own B-phrase.
{
  const { develop, motifPlan, DEVELOP } = await import('../js/motif.js');
  for (const style of ['trance', 'deephouse', 'hypnotic', 'trap']) for (const scale of ['minor', 'major']) {
    const sc = SCALES[scale].notes, pcs = new Set(sc.map((n) => n % 12)), hook = generate(style, 211, scale).pattern.hook.s;
    for (const kind of [...DEVELOP, 'contrast']) {
      const v = develop(hook, kind, sc);
      assert.equal(v.length, 32, `${style} ${kind} keeps 2 bars`);
      assert(v.filter(Boolean).length >= 3, `${style} ${kind} keeps the line`);
      assert.notDeepEqual(v, hook, `${style} ${kind} should vary the motif`);
      for (const [n, l] of v.filter(Boolean)) { assert(pcs.has(((n % 12) + 12) % 12), `${style} ${kind} note ${n} out of ${scale}`); assert(l >= 1 && l <= 16); }
    }
  }
  const plan = Array.from({ length: 20 }, (_, b) => motifPlan(b * 2, 40, 2));
  assert.deepEqual(plan.slice(0, 2), ['orig', 'orig'], 'the hook is stated before it develops');
  assert(plan.slice(-2).every((k) => k === 'orig'), 'the outro brings the hook home');
  assert(new Set(plan).size >= 4, 'a song uses several developments');
  assert.equal(motifPlan(10, 40, 4), 'contrast');
  assert.equal(motifPlan(10, 0, 2), 'orig', 'a looping pattern plays the hook as written');
  console.log('motif development passed');
}

// Song form: 8-bar phrases (16 for techno) that end on a turnaround, and a generated song that closes on one final
// downbeat instead of looping straight back to the intro.
{
  const { songChain } = await import('../js/state.js');
  const { buildSong, playSong } = await import('../scripts/composition.mjs');
  for (const style of ['deephouse', 'hypnotic', 'ambient', 'trap', 'trance']) for (const seed of [1, 2, 3]) {
    const c = songChain(style, seed), phrase = style === 'ambient' || c.length <= 80 ? 8 : 16;
    assert(c.length >= 48 && c.length <= 128 && c.length % phrase === 0, `${style} form ${c.length} bars`);
    for (let b = phrase; b < c.length; b += phrase) {
      if (c[b] !== c[b - 1] && style !== 'ambient') assert('DHB'.includes(c[b - 1]) || c[b] === 'B' || c[b] === 'A', `${style} phrase into bar ${b} has no turnaround (${c.slice(b - phrase, b)})`);
    }
  }
  const s = buildSong('deephouse', 101);
  assert.equal(sanitize(JSON.parse(JSON.stringify(s))).ending, true, 'the ending survives save and load');
  const { log, bars } = playSong(s), last = log.filter((L) => L.step >= (bars - 1) * 16);
  assert(last.length >= 3 && last.every((L) => L.step % 16 === 0), 'the last bar is a single final downbeat');
  assert(last.some((L) => L.k === 'impact'), 'the final downbeat lands with weight');
  const turn = log.filter((L) => L.k === 'trigger' && L.a[0] === 'stab' && L.step % 16 >= 12 && L.step < (bars - 1) * 16);
  assert(turn.length, 'stabs play through turnarounds');
  console.log('song form passed');
}

// A generated song finishes: the sequencer flags the end of its last bar so the transport stops instead of looping,
// and the shared player plays every bar of the longer forms.
{
  const { buildSong, playSong } = await import('../scripts/composition.mjs');
  const { songBars } = await import('../js/player.js');
  for (const style of ['trance', 'industrial', 'deephouse', 'ambient']) {
    const s = buildSong(style, 101);
    assert(s.ending, `${style}: a generated song ends`);
    const { seq, bars } = playSong(s);
    assert(seq.finished, `${style}: the last bar flags the end`);
    assert(songBars(s) === bars, `${style}: the player plays all ${bars} bars (${songBars(s)})`);
  }
  // A stalled main thread can skip the final bar's steps (the transport only advances bars): the song still ends.
  const { Sequencer } = await import('../js/engine.js');
  const s = buildSong('trance', 101), n = s.chain.length, calls = [];
  const e = new Proxy({ stepDur: 0.125, harm: null }, { get: (o, k) => (k in o ? o[k] : () => calls.push(k)), set: (o, k, v) => { o[k] = v; return true; } });
  const seq = new Sequencer(e, s);
  for (let abs = 0; abs < (n - 2) * 16; abs++) seq.tick(abs, abs * 0.125);
  for (let abs = (n - 2) * 16; abs < n * 16; abs++) seq.advanceBar(abs, abs * 0.125);
  calls.length = 0; seq.tick(n * 16, n * 2);
  assert(seq.finished && !calls.some((k) => k === 'trigger' || k === 'hook' || k === 'acid'), 'a song whose last bar was skipped still ends, silently');
  console.log('song ending stops passed');
}
