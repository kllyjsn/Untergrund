import assert from 'node:assert/strict';
import { handleJukebox, memoryJukebox } from '../api/_lib/jukebox.js';
import { memoryStore } from '../api/_lib/crate.js';
import { freshSong, refreshSong, sanitize } from '../js/state.js';
import { songOf } from '../js/player.js';
import { encodeSong, decodeSong } from '../js/share-code.js';
import { SET_PATH } from '../api/set-upload.js';

const store = memoryJukebox(), crate = memoryStore();
assert.equal((await handleJukebox('GET', null, { store: null })).status, 503);
const state = { ...freshSong('amapiano', 1234), fresh: 1, artist: { title: 'Original', name: 'Mira', style: 'amapiano', seed: 1234 }, chain: 'AABB' };
const draft = sanitize(state);
assert.notEqual(refreshSong(draft).chain, draft.chain, 'an unpinned song would regenerate');
const song = await handleJukebox('POST', { kind: 'song', title: 'Test', style: 'amapiano', state }, { store, crate, client: 'a' });
assert.equal(song.status, 201);
const release = await crate.get(song.json.item.trackId);
assert.deepEqual(songOf(release.state), { ...draft, fresh: 0 }, 'the player uses the published arrangement and settings');
assert.deepEqual((await decodeSong(await encodeSong(release))).state, songOf(release.state), 'the link round-trip keeps the published arrangement');
assert.equal(state.fresh, 1, 'publishing does not pin the studio draft');
const url = 'https://abc123.public.blob.vercel-storage.com/sets/night-AbC12.webm';
const set = await handleJukebox('POST', { kind: 'set', title: 'Live', url, duration: 600, start: 30, end: 540, peaks: [0.5, 2, -1] }, { store, crate, client: 'a' });
assert.equal(set.status, 201);
assert.deepEqual(set.json.item.peaks, [0.5, 1, 0]);
assert.equal(set.json.item.start, 30); assert.equal(set.json.item.end, 540);
for (const bad of ['https://evil.com/sets/x.webm', 'https://abc.public.blob.vercel-storage.com/other/x.webm', 'javascript:alert(1)']) {
  assert.equal((await handleJukebox('POST', { kind: 'set', url: bad, duration: 60 }, { store, crate })).status, 400, bad);
}
assert.equal((await handleJukebox('POST', { kind: 'song', title: 'no state' }, { store, crate })).status, 400);
const list = await handleJukebox('GET', null, { store, crate, uploads: true });
assert.equal(list.json.items.length, 2); assert.equal(list.json.uploads, true);
assert(!('state' in list.json.items[1]), 'list stays light');
for (let i = 0; i < 20; i++) await handleJukebox('POST', { kind: 'set', url, duration: 60 }, { store, crate, client: 'spam' });
assert.equal((await handleJukebox('POST', { kind: 'set', url, duration: 60 }, { store, crate, client: 'spam' })).status, 429);
assert(SET_PATH.test('sets/night-signal.webm') && !SET_PATH.test('sets/../x.webm') && !SET_PATH.test('sets/x.html'));
console.log('jukebox passed');
