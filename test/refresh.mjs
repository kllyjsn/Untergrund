import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitize, refreshSong, refreshable, freshSong, generate, clone } from '../js/state.js';
import { trackTitle } from '../js/crate.js';
import { dailyDrop, dropSong } from '../js/daily.js';

// A song published before today's generator: it plays as that seed is written now, keeping its title, artist and tempo.
const legacy = JSON.parse(readFileSync(new URL('./fixtures/legacy-country.json', import.meta.url)));
const old = sanitize(legacy.state);
assert.ok(refreshable(old), 'untouched legacy GENERATE song refreshes');
const now = refreshSong(old);
const { style, seed } = old.artist;
assert.deepEqual(now.artist, old.artist);
assert.equal(now.bpm, old.bpm);
assert.equal(now.fresh, 1);
assert.equal(now.key, generate(style, seed, old.scale).key);
assert.notDeepEqual(now.patterns, old.patterns, 'patterns come from the current generator');
assert.deepEqual(now.patterns, freshSong(style, seed, { scale: old.scale, bpm: old.bpm, swing: old.swing }).patterns);
assert.deepEqual(refreshSong(sanitize(clone(now))), now, 'refresh is stable and survives sanitize');
assert.deepEqual(sanitize(now).fresh, 1);

// A full song never shrinks to a sketch; a sketch stays a sketch.
assert.ok(now.chain.length >= old.chain.length, `refreshed song keeps its length (${old.chain.length} -> ${now.chain.length} bars)`);
const sketch = Object.assign(freshSong('acid', 77, { length: 'sketch' }), { artist: { name: 'X', title: trackTitle(77), style: 'acid', seed: 77 }, fresh: 1 });
assert.equal(refreshSong(clone(sketch)).chain, sketch.chain);

// Anything the listener or another feature changed keeps its stored notes.
const edited = sanitize({ ...clone(now), fresh: 0 });
assert.equal(refreshSong(edited), edited);
assert.equal(refreshable({ ...clone(old), key: (old.key + 1) % 12 }), false, 'legacy song with a changed key is left alone');
assert.equal(refreshable({ ...clone(old), artist: { ...old.artist, title: 'My Own Name' } }), false, 'renamed legacy song is left alone');
assert.equal(refreshable({ ...clone(now), remixOf: 'abc' }), false, 'remixes keep their notes');
assert.equal(refreshable({ ...clone(now), artist: { ...now.artist, style: 'repertoire' } }), false);
assert.equal(refreshable({ ...clone(now), artist: { ...now.artist, seed: undefined } }), false);

// Fresh songs written today, and today's drop, are already current.
const s = freshSong('acid', 4242);
s.artist = { name: 'X', title: trackTitle(4242), style: 'acid', seed: 4242 };
s.fresh = 1;
assert.deepEqual(refreshSong(clone(s)).patterns, s.patterns);
// Mutes and solos carried over from an earlier song (e.g. stray 1-7 keys) don't silence an untouched song; an edited song keeps its mix.
const muted = { ...clone(s), mutes: { kick: true, ch: true }, solos: { acid: true } };
const replayed = refreshSong(clone(muted));
assert.ok(!Object.values(replayed.mutes).some(Boolean) && !Object.values(replayed.solos).some(Boolean), 'carried-over mutes cleared');
assert.equal(refreshSong({ ...clone(muted), fresh: 0 }).mutes.kick, true, 'an edited song keeps its mutes');
const drop = dropSong(dailyDrop(new Date('2026-11-14T12:00:00Z')));
assert.equal(refreshable(drop), false, 'a drop is rebuilt from its date, not refreshed');
console.log('song refresh passed');
