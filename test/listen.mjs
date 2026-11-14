import assert from 'node:assert/strict';
import { createListens, songFingerprint, promptHash, promptText, SKIP_MS, LISTEN_KINDS, DOWN_REASONS } from '../js/listen.js';

const storage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const song = (bpm = 124) => ({ patterns: [{ steps: [1, 0, 1] }], chain: 'AABB', chainOn: true, bpm, key: 'A', scale: 'minor', params: { cutoff: 0.4 }, master: { vol: 0.8 }, artist: { title: 'x' } });
const ctx = (fp, extra = {}) => ({ fp, tid: '', seed: 42, style: 'acid', src: 'generate', surf: 'home', ph: '', pt: '', ...extra });

// Fingerprint: deterministic, stable across cosmetic fields (title), changes with the music.
assert.match(songFingerprint(song()), /^[a-z0-9]{14}$/);
assert.equal(songFingerprint(song()), songFingerprint({ ...song(), artist: { title: 'renamed' } }));
assert.notEqual(songFingerprint(song()), songFingerprint(song(125)));
assert.equal(songFingerprint(null), '');
assert.notEqual(songFingerprint(song()), songFingerprint({ ...song(), swing: 0.3 }), 'swing is a different version');
assert.notEqual(songFingerprint(song()), songFingerprint({ ...song(), mutes: { kick: true } }), 'a muted track is a different version');
assert.equal(songFingerprint(song()), songFingerprint({ ...song(), mutes: { kick: false } }), 'unmuted flags do not count');

// Prompts: hashed always; plain text only when it has nothing that looks like contact details.
assert.equal(promptHash('  Dark  ACID at 4am '), promptHash('dark acid at 4am'));
assert.equal(promptHash(''), '');
assert.equal(promptText('dark acid at 4am'), 'dark acid at 4am');
for (const bad of ['mail me a@b.com', 'see https://x.io', 'call 415 555 1234']) assert.equal(promptText(bad), '', bad);
assert.equal(promptText('x'.repeat(300)).length, 120);

let t = 0;
const sent = [];
const store = storage();
const make = () => createListens({ emit: (kind, rec) => sent.push({ kind, ...rec }), now: () => t, store });
const kinds = () => sent.map((s) => s.kind);
const L = make();
const A = songFingerprint(song()), B = songFingerprint(song(130));
const pos = (bar, bars = 32, sec = 'intro') => ({ bar, bars, sec });

// Start carries the full context; an early stop is a skip.
L.begin(ctx(A, { pt: 'dark acid', ph: promptHash('dark acid') }), pos(0));
t = 5_000;
L.end(pos(2));
assert.deepEqual(kinds(), ['start', 'skip']);
const [start, skip] = sent;
for (const k of ['v', 'lis', 'fp', 'tid', 'seed', 'style', 'src', 'surf', 'ph', 'bar', 'bars', 'sec', 'pct', 'ms']) assert.ok(k in start, k);
assert.equal(start.pt, 'dark acid');
assert.equal(skip.pt, undefined, 'prompt text only rides on start');
assert.equal(skip.lis, start.lis);
assert.equal(skip.ms, 5_000);
assert.equal(skip.pct, 6);
assert.equal(skip.seed, 42);

// Same song again: start + replay; past the skip window but short of the end: partial.
sent.length = 0;
L.begin(ctx(A), pos(0));
t += SKIP_MS + 1;
L.end(pos(10));
assert.deepEqual(kinds(), ['start', 'replay', 'partial']);

// Pause/resume is one listen; reaching 90% (or the song's end) is a completion.
sent.length = 0;
L.begin(ctx(B), pos(0));
t += 20_000; L.hold(pos(8));
t += 600_000; assert.equal(L.end(pos(8)), null, 'a held listen survives stop()');
L.begin(ctx(B), pos(8));
t += 20_000; L.end(pos(30));
assert.deepEqual(kinds(), ['start', 'complete']);
assert.equal(sent[1].ms, 40_000, 'paused time is not listening time');
sent.length = 0;
L.begin(ctx(B), pos(0)); t += 60_000;
L.end(pos(3), { finished: true });
assert.deepEqual(kinds(), ['start', 'replay', 'complete']);
assert.equal(sent.at(-1).pct, 100);

// A different song replaces a held one: the held listen ends first.
sent.length = 0;
L.begin(ctx(A), pos(0)); t += 1000; L.hold(pos(1));
L.begin(ctx(B), pos(0));
assert.deepEqual(kinds(), ['start', 'replay', 'skip', 'start', 'replay']);

// Actions: keep/publish/share/live once per listen, also just after it ends; then nothing.
sent.length = 0;
assert.ok(L.act('share', pos(4)));
assert.equal(L.act('share', pos(5)), null, 'share counted once per listen');
L.end(pos(6));
assert.ok(L.act('publish'));
assert.equal(L.act('nonsense'), null);
t += 11 * 60_000;
assert.equal(L.act('keep'), null, 'too long after the listen');
assert.deepEqual(kinds(), ['share', 'skip', 'publish']);

// Love: a toggle on the song you hear, remembered across reloads.
sent.length = 0;
assert.equal(L.toggleLove(pos(0)), null, 'nothing playing');
L.begin(ctx(A), pos(0));
assert.equal(L.toggleLove(pos(1)), true);
assert.equal(L.toggleLove(pos(2)), false);
assert.equal(L.toggleLove(pos(3)), true);
assert.deepEqual(kinds(), ['start', 'replay', 'love', 'unlove', 'love']);
assert.ok(make().isLoved(A), 'love persists in storage');
assert.ok(!make().isLoved(B));

// Down: one tap is a complete signal; it replaces a love (and vice versa), and is remembered per song.
sent.length = 0;
assert.equal(L.toggleDown(pos(4, 32, 'drop')), true);
assert.deepEqual(kinds(), ['unlove', 'down'], 'a down clears the love first');
assert.ok(!L.isLoved(A) && L.isDowned(A));
assert.equal(sent.at(-1).sec, 'drop', 'the down keeps where in the song it happened');
assert.ok(make().isDowned(A), 'down persists in storage');
// Optional one-tap reasons: only the fixed categories, only after a down; never any free text.
assert.deepEqual(DOWN_REASONS, ['boring', 'sounds_bad', 'not_my_style']);
assert.equal(L.reason('too loud!!'), null, 'no free-form reason');
const why = L.reason('boring', pos(5));
assert.equal(why.why, 'boring');
assert.equal(L.reason('boring', pos(5)), null, 'same reason twice is one signal');
assert.equal(L.reason('sounds_bad', pos(5)).why, 'sounds_bad', 'a later tap replaces the reason');
assert.ok(Object.keys(why).every((k) => !/text|comment|note|feedback/.test(k)), 'no text field in the record');
assert.equal(L.toggleLove(pos(6)), true);
assert.deepEqual(kinds().slice(-2), ['undown', 'love'], 'a love clears the down');
assert.equal(L.reason('boring'), null, 'no reason without a down');
// Rewind: jumping back inside the song you hear, with where from and to.
sent.length = 0;
const rw = L.rewind(pos(12, 32, 'verse'), 0);
assert.deepEqual([rw.bar, rw.to, rw.sec], [12, 0, 'verse']);
assert.equal(L.rewind(pos(0), 0), null, 'restarting from bar 0 is not a rewind');
L.hold(pos(12));
assert.equal(L.rewind(pos(12), 0), null, 'not while paused');
// The song's structure rides on start.
L.begin(ctx(B, { arr: 'intro-8.drop-16' }), pos(0));
assert.equal(sent.find((x) => x.kind === 'start').arr, 'intro-8.drop-16');

// Every kind emitted is part of the contract the server accepts.
assert.ok(sent.every((s) => LISTEN_KINDS.includes(s.kind)));
// No storage (private mode): still works, just forgets.
const bare = createListens({ store: null, now: () => 0 });
bare.begin(ctx(A)); assert.equal(bare.toggleLove(), true);

console.log('listen signals passed');

// Share attribution: a listen that arrived through a shared link carries its ref on every signal; a share records the ref it minted.
{
  const out = [];
  const S = createListens({ emit: (kind, rec) => out.push({ kind, ...rec }), now: () => 0, store: storage() });
  S.begin(ctx(A, { src: 'shared', via: 'k3j9x0aa' }));
  S.act('share', { bar: 1, bars: 8, sec: 'a' }, { ref: 'zz11yy22' });
  assert.equal(S.share({ fp: 'other00000000' }, null, { ref: 'zz11yy33' }), null, 'one share per listen, even through share()');
  assert.deepEqual(out.map((r) => [r.kind, r.via, r.ref]), [['start', 'k3j9x0aa', undefined], ['share', 'k3j9x0aa', 'zz11yy22']]);
  S.begin(ctx(B));
  assert.equal(out.at(-1).via, undefined, 'no ref, no via');
  const lone = [], L = createListens({ emit: (kind, rec) => lone.push({ kind, ...rec }), now: () => 0, store: storage() });
  assert.equal(L.share(null, null, { ref: 'zz11yy44' }), null, 'no song, no share');
  L.share({ fp: 'other00000000', tid: 'trk-9', style: 'acid', surf: 'studio' }, null, { ref: 'zz11yy44' });
  assert.equal(L.share({ fp: 'other00000000', surf: 'studio' }, null, { ref: 'zz11yy44' }), null, 'a link and a video from one share sheet are one share');
  assert.deepEqual(lone.map((r) => [r.kind, r.lis, r.fp, r.tid, r.surf, r.ref]), [['share', '', 'other00000000', 'trk-9', 'studio', 'zz11yy44']], 'a share before playing goes out standalone');
  console.log('share attribution passed');
}
