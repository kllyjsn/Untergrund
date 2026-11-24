import assert from 'node:assert/strict';
import { handleJukebox, memoryJukebox } from '../api/_lib/jukebox.js';
import { handleAccount, attachTrack, COOKIE } from '../api/_lib/accounts.js';
import { handleCrate, memoryStore } from '../api/_lib/crate.js';
import { memoryKv } from '../api/_lib/kv.js';
import { handlePage } from '../api/_lib/pages.js';
import { fetchReleaseTrack } from '../js/account.js';
import { fetchTrack } from '../js/crate.js';
import { freshSong, refreshSong, sanitize } from '../js/state.js';
import { songOf } from '../js/player.js';
import { jukeboxPreviewSeconds } from '../js/sets.js';
import { encodeSong, decodeSong, normalizeSong } from '../js/share-code.js';
import { songMidi } from '../js/midi.js';
import { SET_PATH } from '../api/set-upload.js';

const store = memoryJukebox(), crate = memoryStore();
{
  const arranged = { ...freshSong('trance', 42), bpm: 140, chainOn: true, chain: 'AB'.repeat(56), ending: true };
  assert.equal(jukeboxPreviewSeconds(arranged), null, 'a 112-bar song advances on the actual transport ending');
  assert.equal(jukeboxPreviewSeconds({ ...arranged, ending: false }), 64 * 16 * 15 / 140, 'long loops still have a bounded preview');
  assert.equal(jukeboxPreviewSeconds({ ...arranged, chain: 'AB' }), 2 * 16 * 15 / 140, 'short chains loop even when ending is set');
  assert.equal(jukeboxPreviewSeconds({ ...arranged, chainOn: false }), 8 * 16 * 15 / 140, 'unchained loops retain their preview');
  const score = { ...arranged, chainOn: false, current: 0, patterns: [{ score: { form: 'nocturne', seed: 9, mode: 'm' } }] };
  assert.equal(jukeboxPreviewSeconds(score), null, 'a finite variable-tempo score also uses the transport ending');
}
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

{
  const auth = { kv: memoryKv(), secret: 's'.repeat(40) };
  const account = (action, cookie, fields) => handleAccount({ method: 'POST', cookie, body: { action, ...fields } }, auth);
  const password = 'Original long passphrase';
  const created = await account('email-signup', '', { email: 'publisher@example.test', password });
  const cookie = created.cookie.split(';')[0];
  assert(cookie.startsWith(`${COOKIE}=`));
  const song = { kind: 'song', title: 'Account release', state, accountId: created.json.account.id };
  const store = memoryJukebox(), crate = memoryStore();
  const publish = (cookie, target = store, targetCrate = crate) => handleJukebox('POST', song, { store: target, crate: targetCrate, auth: { ...auth, cookie } });
  let changed;
  const racingStore = { ...store, async allow(client) {
    changed = await account('password-change', cookie, { currentPassword: password, password: 'Replacement long passphrase' });
    assert.equal(changed.status, 200);
    return store.allow(client);
  } };
  assert.equal((await publish(cookie, racingStore)).status, 401, 'a session revoked while publishing cannot leave an unattached release');
  assert.equal((await publish(cookie)).status, 401, 'a revoked session cannot publish an unattached release');
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await crate.list(), []);
  const current = changed.cookie.split(';')[0];
  const artist = await account('claim', current, { handle: 'publisher' });
  assert.equal(artist.status, 200);
  const page = () => handleAccount({ method: 'GET', query: { handle: 'publisher' } }, auth);
  const unavailable = { ...crate, async add() { throw new Error('crate write failed'); } };
  await assert.rejects(publish(current, store, unavailable), /crate write failed/);
  assert.deepEqual((await page()).json.tracks, [], 'a failed crate write does not attach an artist release');
  const response = await publish(current);
  assert.equal(response.status, 201);
  assert.equal((await crate.list()).length, 1, 'retry after signing in leaves one public release');
  assert.deepEqual((await page()).json.tracks.map((t) => t.id), [response.json.item.trackId]);
}

{
  const ctx = { kv: memoryKv(), crate: memoryStore(), secret: 's'.repeat(40) };
  const owner = await handleAccount({ method: 'POST', body: { action: 'claim', handle: 'mira', name: 'Mira Live' } }, ctx);
  assert(await attachTrack(ctx.kv, owner.json.account.id, release));
  assert.equal(await ctx.crate.get(release.id), null, 'the rolling crate no longer has this release');
  const page = await handlePage({ t: release.id, room: 'the-bunker' }, ctx);
  assert.equal(page.status, 200);
  const data = JSON.parse(page.body.match(/<script id="page-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert(!data.room, 'the release remains playable without an active matching room');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const { pathname, searchParams } = new URL(url, 'https://untergrund.test');
      const r = pathname === '/api/account'
        ? await handleAccount({ method: 'GET', query: Object.fromEntries(searchParams) }, ctx)
        : await handleCrate('GET', null, ctx.crate, searchParams.get('id'));
      return { ok: r.status === 200, json: async () => r.json };
    };
    await assert.rejects(fetchTrack(release.id), /track_missing/, 'the old crate-only embed lookup fails');
    const linked = normalizeSong(await fetchReleaseTrack(release.id));
    assert.equal(linked.artist, data.artist.name);
    assert.deepEqual(linked.state, { ...draft, fresh: 0 });
    assert.deepEqual(linked.state, songOf(data.track.state), 'the embed and release page schedule the same pinned version');
    assert.deepEqual(songMidi(linked.state), songMidi(songOf(data.track.state)), 'Studio export uses the same notes and tempo');

    await ctx.crate.add(release);
    ctx.kv = null;
    assert.deepEqual(await fetchReleaseTrack(release.id), (await handleCrate('GET', null, ctx.crate, release.id)).json.track, 'crate-only shares still load when accounts are offline');
  } finally { globalThis.fetch = originalFetch; }
}

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
