import assert from 'node:assert/strict';
import { createListens, songFingerprint, promptHash, promptText, SKIP_MS, LISTEN_KINDS } from '../js/listen.js';

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

// Every kind emitted is part of the contract the server accepts.
assert.ok(sent.every((s) => LISTEN_KINDS.includes(s.kind)));
// No storage (private mode): still works, just forgets.
const bare = createListens({ store: null, now: () => 0 });
bare.begin(ctx(A)); assert.equal(bare.toggleLove(), true);

console.log('listen signals passed');
