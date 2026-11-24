import assert from 'node:assert/strict';
import { memoryKv } from '../api/_lib/kv.js';
import { memoryStore, normalizeTrack } from '../api/_lib/crate.js';
import { memoryJukebox, handleJukebox } from '../api/_lib/jukebox.js';
import { handleAccount, attachTrack } from '../api/_lib/accounts.js';
import { handlePage, renderTrackPage } from '../api/_lib/pages.js';
import { ogImage, artSeed } from '../api/_lib/og.js';
import { defaultState } from '../js/state.js';
import { handleHealth } from '../api/_lib/health.js';

const kv = memoryKv(), crate = memoryStore(), SECRET = 's'.repeat(40);
const claim = await handleAccount({ method: 'POST', body: { action: 'claim', handle: 'nova', name: 'Nova "&" <Co>', bio: 'Warehouse </script> sets' } }, { kv, crate, secret: SECRET });
const accountId = claim.json.account.id;
const track = normalizeTrack({ title: '</title><script>alert(1)</script> Tunnel', artist: 'Nova', style: 'acid', state: defaultState() });
await crate.add(track);
await attachTrack(kv, accountId, track);
const og = { ogImage, artSeed };
const site = 'https://www.untergrund.sh';

const t = await handlePage({ t: track.id }, { kv, crate, site, og });
assert.equal(t.status, 200);
assert.match(t.type, /text\/html/);
const tag = (html, prop) => html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1];
assert.equal(tag(t.body, 'og:title'), '&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; Tunnel — Nova &quot;&amp;&quot; &lt;Co&gt;');
assert.equal(tag(t.body, 'og:type'), 'music.song');
assert.equal(tag(t.body, 'og:url'), `${site}/t/${track.id}`);
assert.equal(tag(t.body, 'og:image'), `${site}/api/page?og=${track.id}&amp;v=2`);
assert.match(t.body, /class="pp-yours"[\s\S]*href="\/\?t=[^"]+&amp;remix=1"/, 'release page invites a remix');
assert.match(t.body, /class="pp-cat">UG-[0-9A-Z]{6}</, 'release page has a catalogue number');
assert.match(t.body, /"@type":"MusicRecording"/);
assert.match(t.body, /twitter:label1" content="Artist"/);
assert.equal(tag(t.body, 'twitter:card'), 'summary_large_image');
assert.match(tag(t.body, 'og:description'), /ACID · 133 BPM/i);
assert.match(t.body, /<meta property="music:musician" content="https:\/\/www.untergrund.sh\/a\/nova"/);
assert(!t.body.includes('<script>alert(1)'), 'titles are escaped');
const json = t.body.match(/<script id="page-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
assert(!json.includes('</'), 'embedded state cannot close the script tag');
const data = JSON.parse(json);
assert.equal(data.kind, 'track');
assert(Array.isArray(data.track.state.patterns), 'track page carries the replayable state so it plays instantly');
assert.equal(data.artist.handle, 'nova');
console.log('track page meta passed');

const a = await handlePage({ a: 'NOVA' }, { kv, crate, site, og });
assert.equal(a.status, 200);
assert.equal(tag(a.body, 'og:type'), 'profile');
assert.equal(tag(a.body, 'og:url'), `${site}/a/nova`);
assert.equal(tag(a.body, 'og:image'), `${site}/api/page?og=${track.id}&amp;v=2`, 'artist card uses the latest track art');
assert.equal(tag(a.body, 'og:description'), 'Warehouse &lt;/script&gt; sets');
assert(a.body.includes(`href="/t/${track.id}"`));
console.log('artist page meta passed');

const miss = await handlePage({ t: 'nope-123' }, { kv, crate, site, og });
assert.equal(miss.status, 404);
assert.equal(tag(miss.body, 'og:image'), `${site}/social-card.png`);
assert.equal((await handlePage({ a: 'admin' }, { kv, crate, site, og })).status, 404);
const off = await handlePage({ a: 'nova' }, { kv: null, crate: null, site, og });
assert.equal(off.status, 404);
assert.match(off.body, /almost live/, 'no storage explains itself instead of erroring');
assert.equal((await handlePage({ og: 'missing' }, { kv, crate, site, og })).location, '/social-card.png');

const img = await handlePage({ og: track.id }, { kv, crate, site, og });
assert.equal(img.type, 'image/png');
assert.deepEqual([...img.body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(img.body.readUInt32BE(16), 1200); assert.equal(img.body.readUInt32BE(20), 630);
assert(img.body.length < 5e6, 'unfurl image stays under the X/Slack size limit');
assert.deepEqual(ogImage(track.state, 7), ogImage(track.state, 7), 'art is deterministic');
assert.equal(artSeed(track.id), artSeed(track.id));
assert.match(renderTrackPage({ track, artist: null }), /<span class="pp-by">Nova<\/span>/);
console.log('Open Graph image passed');

{
  const { flagshipTracks, flagshipIds, handlePage: hp } = await import('../api/_lib/pages.js');
  const store = memoryStore();
  const real = normalizeTrack({ title: 'Pinned One', artist: 'Real Artist', style: 'acid', state: defaultState() });
  await store.add(real);
  await store.countPlay(real.id, 'client-a');
  const list = await flagshipTracks({ kv: null, crate: store, ids: [real.id, 'gone-404', real.id] });
  assert.equal(list.length, 1, 'unknown and duplicate pins are dropped, nothing is invented');
  assert.equal(list[0].by, 'Real Artist');
  assert.equal(list[0].plays, 1, 'plays come from the crate counts');
  assert.deepEqual(await flagshipTracks({ kv: null, crate: store, ids: [] }), [], 'empty config hides the shelf');
  assert.deepEqual(flagshipIds({ FLAGSHIP_TRACKS: ' a-1, b-2 ,' }), ['a-1', 'b-2']);
  const r = await hp({ flagship: '1' }, { kv: null, crate: store, site, og, flagship: [real.id] });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).tracks[0].id, real.id);
  assert.equal(JSON.parse(r.body).kind, 'flagship');
  const jukebox = memoryJukebox(), recent = [];
  for (let i = 0; i < 7; i++) {
    const publication = await handleJukebox('POST', { ...real, kind: 'song', title: `Release ${i}` }, { store: jukebox, crate: store });
    assert.equal(publication.status, 201);
    recent.push(publication.json.item.trackId);
  }
  await jukebox.add({ kind: 'set', trackId: real.id });
  for (let i = 0; i < 6; i++) await jukebox.add({ kind: 'song', trackId: `expired-${i}` });
  const unpublished = normalizeTrack({ ...real, title: 'Generated but not published' });
  await store.add(unpublished);
  const getShelf = async (flagship, releases = jukebox) => JSON.parse((await hp({ flagship: '1' }, { kv: null, crate: store, jukebox: releases, site, og, flagship })).body);
  for (const ids of [[], ['gone-404']]) {
    const fallback = await getShelf(ids);
    assert.equal(fallback.kind, 'recent');
    assert.deepEqual(fallback.tracks.map((t) => t.id), recent.slice(1).reverse());
    assert.ok(fallback.tracks.every((t) => t.by === 'Real Artist' && t.id !== unpublished.id));
  }
  assert.deepEqual((await getShelf(['gone-404', real.id])).tracks.map((t) => t.id), [real.id]);
  assert.deepEqual(await getShelf([], null), { tracks: [], kind: 'recent' });
  console.log('flagship shelf passed');
}

{
  const env = { AUTH_SECRET: 'test-'.repeat(8), VERCEL_GIT_COMMIT_SHA: '0123456789abcdef' };
  assert.deepEqual(await handleHealth('GET', { checkStorage: async () => true, env }), {
    status: 200, json: { ok: true, commit: '0123456789ab', storage: 'ready', features: { accounts: true, recordedSetUploads: false, soundcloud: false } },
  });
  const down = await handleHealth('GET', { checkStorage: async () => { throw new Error('private provider detail'); }, env });
  assert.equal(down.status, 503);
  assert.equal(down.json.storage, 'unavailable');
  assert.equal(JSON.stringify(down).includes('private provider detail'), false);
  const off = await handleHealth('GET', { env: { ...env, VERCEL_GIT_COMMIT_SHA: 'not a public commit' } });
  assert.equal(off.status, 503);
  assert.equal(off.json.storage, 'not_configured');
  assert.equal(off.json.commit, 'dev');
  assert.equal(off.json.features.accounts, false);
  assert.equal((await handleHealth('POST', { env })).status, 405);
  console.log('public health status passed');
}
