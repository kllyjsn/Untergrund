import assert from 'node:assert/strict';
import { generate, arrangement, sanitize, defaultState, STYLES, MAJOR_STYLES, MUSICIAN_PRINCIPLES } from '../js/state.js';
import { SCALES } from '../js/params.js';

// Every club/pop style gets its own seeded hook; NEO-SOUL and BOOM BAP sing one over their Rhodes licks.
for (const style of Object.keys(STYLES)) {
  const a = generate(style, 11, 'minor'), b = generate(style, 22, 'minor');
  if (STYLES[style].family === 'CLASSICAL') { assert(a.pattern.score && !a.pattern.hook, `${style} is a score, not a hook loop`); continue; }
  assert(a.pattern.hook && a.pattern.hook.s.length === 32, `${style} needs a hook`);
  const notes = a.pattern.hook.s.filter(Boolean);
  assert(notes.length >= 4, `${style} hook too sparse`);
  // Song genres are major-key; generate() moves them off the minor default.
  const pcs = new Set(SCALES[MAJOR_STYLES.has(style) ? 'major' : 'minor'].notes.map((n) => n % 12));
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
  assert.deepEqual(scenes.map((p) => p.hm), [0, 2, 1, 2, 2, 1, 2, 2], 'hook is held back for the intro, the pre-chorus climbs it whole');
  assert.deepEqual(arrangement(generate('peak', 42).pattern, 42).map((p) => p.hm), [0, 0, 1, 2, 2, 1, 2, 2], 'club forms tease the hook in the build');
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
        const { voice, level } = generate(style, seed).params.stab;
        assert(level === undefined || (Number.isFinite(level) && level > 0), `${style} seed ${seed}: stab level ${level} for voice ${voice}`);
        if (voice >= 7) recorded.add(voice);
      }
    }
    assert.deepEqual([...recorded].sort((a, b) => a - b), [7, 8, 9, 10, 11, 12, 13, 14, 15], 'all recorded families should appear across generated songs');
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

// Songs have real sections: the verse its own changes, sparser and lower; a pre-chorus that holds the kick back and
// climbs to the dominant; a bridge away from home; a fuller, wider chorus. Club forms keep their own scenes.
{
  const { SONG_STYLES } = await import('../js/state.js');
  const { buildSong, playSong } = await import('../scripts/composition.mjs');
  const key = (pr) => JSON.stringify(pr);
  for (const style of SONG_STYLES) for (const seed of [1, 2, 3, 4]) {
    const g = generate(style, seed), sc = arrangement(g.pattern, seed), S = g.pattern.sections;
    assert(S, `${style} writes sections`);
    assert.deepEqual(sc.map((p) => p.sec), [undefined, 'pre', 'verse', undefined, 'bridge', 'bridge', 'chorus', 'chorus'], `${style} section slots`);
    assert.notEqual(key(sc[2].prog), key(sc[6].prog), `${style}/${seed} verse and chorus have different changes`);
    assert.equal(sc[1].prog.at(-1).r, 7, `${style}/${seed} pre-chorus ends on the dominant`);
    assert(sc[1].prog.slice(0, -1).every((h) => h.r !== 0), `${style}/${seed} pre-chorus withholds the tonic`);
    assert.equal(sc[1].steps.kick.filter(Boolean).length, 1, `${style}/${seed} pre-chorus holds the kick back`);
    assert.notEqual(sc[4].prog[0].r, 0, `${style}/${seed} bridge starts away from home`);
    assert(sc[2].steps.stab.filter(Boolean).length <= sc[6].steps.stab.filter(Boolean).length, `${style}/${seed} verse chords are sparser`);
    assert(!sc[2].steps.oh.some(Boolean) && sc[6].steps.oh.some(Boolean), `${style}/${seed} open hats wait for the chorus`);
    if (g.pattern.hook) {
      assert.deepEqual(sc[6].hook, g.pattern.hook, `${style} chorus plays the hook as generated`);
      assert.deepEqual(sc[2].hook.s.map((x) => x && x[1]), g.pattern.hook.s.map((x) => x && x[1]), `${style} verse keeps the hook's rhythm`);
      const lo = (h) => h.s.filter(Boolean).reduce((a, x) => a + x[0], 0);
      assert(lo(sc[2].hook) < lo(g.pattern.hook), `${style}/${seed} verse melody sits lower`);
    }
    const round = sanitize(JSON.parse(JSON.stringify({ ...defaultState(), patterns: sc })));
    assert.deepEqual(round.patterns.map((p) => p.sec), sc.map((p) => p.sec), 'sections survive save and load');
  }
  for (const style of ['hypnotic', 'peak', 'trance', 'ambient', 'dnb']) {
    const g = generate(style, 5);
    assert(!g.pattern.sections && arrangement(g.pattern, 5).every((p) => !p.sec), `${style} keeps its club scenes`);
  }
  // The pre-chorus melody climbs a step per bar, and only the chorus opens the stab voicing.
  const s = buildSong('euphoric', 101), { log } = playSong(s);
  const pre = s.chain.indexOf('B'), tops = [0, 1, 2, 3].map((k) => Math.max(...log.filter((L) => L.k === 'hook' && !L.a[9]?.counter && Math.floor(L.step / 16) === pre + k).map((L) => L.a[2])));
  assert(tops[3] > tops[0], `pre-chorus climbs (${tops})`);
  console.log('song sections passed');
}

// Harmony for the styles without written changes, in their own idiom, and the final-chorus lift.
{
  const { CHORDS } = await import('../js/params.js');
  const { buildSong, playSong } = await import('../scripts/composition.mjs');
  const MINOR = new Set([0, 2, 3, 5, 7, 8, 10]), pc = (x) => ((x % 12) + 12) % 12;
  const diatonic = (h) => CHORDS[h.c].iv.every((i) => MINOR.has(pc(h.r + i)));
  for (const style of ['hypnotic', 'peak', 'dub', 'breaks', 'electro', 'dnb', 'bailefunk', 'jerseyclub', 'ambient']) for (const seed of [1, 2, 3, 4]) {
    const g = generate(style, seed), sc = arrangement(g.pattern, seed), techno = !!g.pattern.pedal;
    const progs = techno ? [sc[6].prog, sc[7].prog] : sc.map((p) => p.prog);
    for (const pr of progs) {
      assert(pr && new Set(pr.map((h) => h.r)).size >= 2, `${style}/${seed} has harmonic motion`);
      if (diatonic(pr[0])) assert(pr.every(diatonic), `${style}/${seed} off-tonic chords stay in the key: ${JSON.stringify(pr)}`);
    }
    if (techno) assert(sc.slice(0, 6).every((p) => !p.prog) && pr0(sc[6]).slice(0, 6).every((h) => h.r === 0), `${style} holds the pedal outside the peak`);
  }
  function pr0(p) { return p.prog; }
  for (const style of ['euphoric', 'trance', 'hyperpop']) {
    const s = buildSong(style, 101), { log, bars } = playSong(s), c = s.chain;
    assert.equal(sanitize(JSON.parse(JSON.stringify(s))).patterns[6].lift, 2, 'the lift survives save and load');
    const lastPeak = c.lastIndexOf('G'), early = log.filter((L) => L.k === 'trigger' && L.a[0] === 'stab' && L.step < 16 * c.indexOf('G') + 64 && L.harm);
    const late = log.filter((L) => L.k === 'trigger' && L.a[0] === 'stab' && L.step >= 16 * lastPeak - 64 && L.step < 16 * lastPeak && L.harm);
    const roots = (xs) => new Set(xs.map((L) => pc(L.harm.r)));
    assert([...roots(late)].some((r) => !roots(early).has(r)) || [...roots(late)].every((r) => [...roots(early)].map((x) => pc(x + 2)).includes(r)), `${style} final chorus is lifted`);
    const end = log.find((L) => L.k === 'hook' && L.step === (bars - 1) * 16);
    assert(end && pc(end.a[2]) === 2, `${style} ends on the lifted tonic (${end?.a[2]})`);
  }
  console.log('idiomatic harmony passed');
}

// Interplay: licks yield to the hook, the bass answers its rests, breakdowns get a guide-tone countermelody.
{
  const { CHORDS } = await import('../js/params.js');
  const { buildSong, playSong } = await import('../scripts/composition.mjs');
  const pc = (x) => ((x % 12) + 12) % 12;
  let answers = 0, counters = 0;
  for (const style of ['deephouse', 'neosoul', 'ukg', 'afrobeats', 'trance', 'dub']) for (const seed of [101, 211, 307]) {
    const s = buildSong(style, seed), { log } = playSong(s), hook = new Map();
    for (const L of log) if (L.k === 'hook' && !L.a[9]?.harm) for (let k = 0; k < Math.max(1, Math.round(L.a[3] / 0.125)); k++) hook.set(L.step + k, true);
    for (const L of log.filter((x) => x.k === 'lick')) assert(!hook.has(L.step) && !hook.has(L.step + 1), `${style}/${seed} lick at ${L.step} talks over the hook`);
    const acidAt = new Set(log.filter((x) => x.k === 'acid').map((x) => x.step));
    answers += log.filter((x) => x.k === 'acid' && x.a[1]?.answer && !hook.has(x.step) && 'CG'.includes(s.chain[Math.floor(x.step / 16)])).length;
    for (const L of log.filter((x) => x.k === 'hook' && x.a[9]?.counter)) {
      counters++;
      assert('EF'.includes(s.chain[Math.floor(L.step / 16)]), `${style} countermelody only in breakdowns`);
      if (L.harm) { const rel = pc(L.a[2] - L.harm.r); assert(CHORDS[L.harm.c].iv.map(pc).includes(rel), `${style} counter note ${L.a[2]} is a chord tone of ${JSON.stringify(L.harm)}`); }
    }
  }
  assert(answers > 20, `the bass answers the hook (${answers})`);
  assert(counters > 20, `breakdowns carry a countermelody (${counters})`);
  console.log('interplay passed');
}

// Techno builds: the intro layers in, long runs end every 8 bars on a roll over a dropped kick, the drums develop.
{
  const { buildSong, playSong } = await import('../scripts/composition.mjs');
  for (const style of ['industrial', 'acid', 'peak', 'hardtechno', 'electro']) for (const seed of [101, 307]) {
    const s = buildSong(style, seed), { log } = playSong(s), chain = s.chain;
    const at = (k, bar) => log.filter((L) => L.k === 'trigger' && L.a[0] === k && Math.floor(L.step / 16) === bar).map((L) => L.step % 16);
    assert(chain.startsWith('AAAAAAAA') && at('ch', 0).length === 0, `${style} intro opens on the kick alone`);
    assert(at('kick', 0).length, `${style} intro has its kick`);
    let fills = 0;
    for (let b = 0; b + 1 < chain.length; b++) {
      let a = b; while (a > 0 && chain[a - 1] === chain[b]) a--;
      let e = b; while (e + 1 < chain.length && chain[e + 1] === chain[b]) e++;
      if (!'CG'.includes(chain[b]) || e - a + 1 < 8 || (b - a) % 8 !== 7 || b === e) continue;
      fills++;
      assert(!at('kick', b).some((i) => i >= 12), `${style}/${seed} bar ${b}: the kick drops for the phrase-end fill`);
      const roll = s.patterns[2].steps.snare.some(Boolean) ? 'snare' : 'clap';
      assert(at(roll, b).filter((i) => i >= 12).length >= 4, `${style}/${seed} bar ${b}: a ${roll} roll ends the phrase`);
    }
    assert(fills >= 3, `${style}/${seed} has phrase-end fills (${fills})`);
  }
  console.log('techno builds passed');
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
  // A generated score ends with its final chord: no empty bars after it, and the transport stops on its last step.
  const { compose } = await import('../js/classical.js');
  for (const style of ['symphony', 'concerto', 'nocturne']) {
    const s = buildSong(style, 11), sc = compose(s.patterns.find((p) => p.score).score), seq = new Sequencer(e, s);
    const last = sc.at.findLastIndex((x) => x.length), bar = sc.barLen || 16;
    assert(sc.at.length - last <= bar, `${style}: the final chord is in the last bar (${(sc.at.length - last) / bar} bars before the end)`);
    let end = -1;
    for (let abs = 0; abs < sc.at.length + 32 && end < 0; abs++) { seq.tick(abs, abs * 0.125); if (seq.finished) end = abs; }
    assert(end === sc.at.length - 1, `${style}: playback stops after the score's last step (${end} of ${sc.at.length})`);
  }
  console.log('song ending stops passed');
}

// Song sections set the output level: the chorus lands 1.5-3 dB over the verse; techno and ambient stay at unity.
{
  const { buildSong } = await import('../scripts/composition.mjs');
  const { Sequencer } = await import('../js/engine.js');
  for (const style of ['euphoric', 'reggaeton', 'neosoul', 'pop', 'rock', 'country', 'hypnotic', 'ambient']) {
    const s = buildSong(style, 101), lv = {}, at = [];
    const e = new Proxy({ stepDur: 0.125, harm: null }, {
      get: (o, k) => (k in o ? o[k] : k === 'sectionGain' ? (t, db) => at.push(db) : () => {}),
      set: (o, k, v) => { o[k] = v; return true; },
    });
    const seq = new Sequencer(e, s);
    for (let abs = 0; abs < s.chain.length * 16 && !seq.finished; abs++) {
      seq.tick(abs, abs * 0.125);
      const sec = s.patterns[seq.cur].sec;
      if (abs % 16 === 0 && sec && at.length) lv[sec] = at.at(-1);
    }
    if (!s.patterns.some((p) => p.sec)) { assert(at.every((db) => db === 0), `${style}: no section levels`); continue; }
    const lift = lv.chorus - lv.verse;
    assert(lift >= 1 && lift <= 3, `${style}: chorus ${lift} dB over the verse`);
  }
  // As heard: pop's and country's bands play a much fuller chorus on top of the level change, so the mastered
  // render (median 3 s loudness, chorus minus verse) must still land in 1.5-3 dB.
  const { withChrome } = await import('./chrome.mjs');
  const jobs = [['pop', 11], ['pop', 42], ['pop', 77], ['country', 11], ['country', 42], ['country', 77]];
  const heard = await withChrome(async (runs) => {
    const out = [];
    let next = 0;
    await Promise.all(runs.map(async (run) => {
      await run(`import('/test/loudness-page.js').then((m) => { window.__m = m; })`);
      while (next < jobs.length) { const i = next++; out[i] = await run(`window.__m.sectionLift('${jobs[i][0]}', ${jobs[i][1]})`); }
    }));
    return out;
  }, { pages: 3 });
  if (!heard) console.log('section levels: no Chrome found, rendered chorus lift skipped');
  else jobs.forEach(([style, seed], i) => assert(heard[i] >= (style === 'pop' ? 1.5 : 1) && heard[i] <= 3, `${style}/${seed}: rendered chorus ${heard[i].toFixed(2)} dB over the verse`));
  console.log(`section levels passed${heard ? ` (rendered chorus over verse: ${jobs.map(([st, se], i) => `${st}/${se} ${heard[i].toFixed(2)}`).join(', ')} dB)` : ''}`);
}
