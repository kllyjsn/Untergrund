import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { handlePublicApi, publicApiRoute, PUBLIC_API_LIMIT } from '../api/_lib/public-api.js';
import { handleAccount, attachTrack } from '../api/_lib/accounts.js';
import { memoryStore, normalizeTrack } from '../api/_lib/crate.js';
import { memoryKv } from '../api/_lib/kv.js';
import { createRooms, memoryRoomsKv, roomsHandler } from '../api/_lib/rooms.js';
import pageHandler from '../api/page.js';
import legacyRoomsHandler from '../api/rooms.js';
import { defaultState } from '../js/state.js';

const site = 'https://www.untergrund.sh', kv = memoryKv(), crate = memoryStore(), rooms = createRooms({ kv: memoryRoomsKv() });
const ctx = { site, kv, crate, rooms };
const req = (path, options = {}, context = ctx) => {
  const route = publicApiRoute('/api/v1/' + path);
  assert.ok(route, 'public API requests go through the v1 router');
  return handlePublicApi({ method: 'GET', ip: '192.0.2.10', ...route, ...options }, context);
};

const account = await handleAccount({ method: 'POST', body: { action: 'claim', handle: 'nova' } }, { ...ctx, secret: 's'.repeat(40) });
const first = normalizeTrack({ title: 'First', artist: 'Nova', style: 'acid', state: defaultState() });
const recent = normalizeTrack({ title: 'Latest', artist: 'Guest', style: 'hypnotic', state: defaultState() });
await crate.add(first);
await crate.add(recent);
await attachTrack(kv, account.json.account.id, first);

const listing = await req('tracks');
assert.equal(listing.status, 200);
assert.deepEqual(listing.json.data.tracks.map((t) => t.id), [recent.id, first.id]);
assert.equal(listing.headers['Access-Control-Allow-Origin'], '*');
assert.match(listing.headers['Cache-Control'], /public.*max-age=30/);
const detail = (await req(`tracks/${first.id}`)).json.data;
assert.equal(detail.track.url, site + '/t/' + first.id);
assert.equal(detail.track.embedUrl, site + '/embed.html?t=' + first.id);
assert.equal(detail.track.state, undefined);
assert.equal(detail.creator.handle, 'nova');
assert.equal(detail.creator.id, undefined);
assert.equal((await req(`tracks/${recent.id}`)).json.data.creator, null);
const artist = (await req('artists/NOVA')).json.data;
assert.equal(artist.artist.url, site + '/a/nova');
assert.equal(artist.artist.providers, undefined);
assert.deepEqual(artist.tracks, [detail.track]);

for (const [id, isPublic] of [['public-stage', true], ['private-stage', false]]) {
  const clientSecret = createHash('sha256').update(id).digest('hex');
  const user = { name: 'DJ Nova' };
  const { json: { sessionToken: token } } = await rooms.post(id, { type: 'presence', clientId: id, clientSecret, user });
  const result = await rooms.post(id, { id: 'set-1', type: 'set', clientId: id, clientSecret, user, token,
    payload: { public: isPublic, title: 'Set', key: 'A minor', state: defaultState() } });
  assert.equal(result.status, 200);
}
const live = await req('rooms');
assert.deepEqual(live.json.data.rooms.map((room) => room.url), [site + '/r/public-stage']);
assert.equal(live.json.data.rooms[0].key, 'A minor');
assert.equal(live.json.data.rooms[0].clientSecret, undefined);
assert.match(live.headers['Cache-Control'], /max-age=5/);

{
  const upstream = roomsHandler(rooms);
  const server = createServer((request, response) => upstream(request, response, new URL(request.url, site)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const oldBase = process.env.ROOMS_API_URL;
  process.env.ROOMS_API_URL = `http://127.0.0.1:${server.address().port}/`;
  try {
    const call = async (handler, request) => {
      const response = { setHeader() {}, status(value) { this.code = value; return this; }, json(value) { return value; } };
      const json = await handler({ method: 'GET', headers: {}, ...request }, response);
      assert.equal(response.code, 200);
      return json;
    };
    const legacy = await call(legacyRoomsHandler, { url: '/api/rooms' });
    const versioned = await call(pageHandler, { query: { publicApi: 'rooms' } });
    assert.deepEqual(legacy.rooms.map(({ id }) => id), ['public-stage']);
    assert.deepEqual(versioned.data.rooms.map(({ url, ...room }) => room), legacy.rooms);
  } finally {
    if (oldBase === undefined) delete process.env.ROOMS_API_URL;
    else process.env.ROOMS_API_URL = oldBase;
    await new Promise((resolve) => server.close(resolve));
  }
}

assert.equal(publicApiRoute('/api/tracks'), null);
for (const path of ['tracks/missing-123', 'tracks/%2F', 'artists/nobody-here', 'elsewhere']) {
  const failure = await req(path);
  assert.equal(failure.status, 404);
  assert.equal(failure.json.error.code, 'not_found');
  assert.equal(failure.headers['Cache-Control'], 'no-store');
}
assert.equal((await req('rooms', {}, { ...ctx, rooms: null })).status, 503);
assert.equal((await req('tracks', {}, { ...ctx, crate: { list: () => { throw new Error('private provider detail'); } } })).json.error.message, 'The requested data is temporarily unavailable.');
const write = await req('tracks', { method: 'POST' });
assert.equal(write.status, 405);
assert.equal(write.headers.Allow, 'GET, OPTIONS');
const cors = await req('tracks', { method: 'OPTIONS' });
assert.equal(cors.status, 204);
assert.equal(cors.headers['Access-Control-Allow-Methods'], 'GET, OPTIONS');

const rateKv = memoryKv(), limited = { ...ctx, rateKv, now: 30000 };
for (let i = 0; i < PUBLIC_API_LIMIT; i++) assert.equal((await req('tracks', {}, limited)).status, 200);
const blocked = await req('rooms', {}, limited);
assert.equal(blocked.status, 429);
assert.equal(blocked.headers['Retry-After'], '30');
assert.equal(blocked.headers['Cache-Control'], 'no-store');
assert.equal((await req('tracks', { ip: '192.0.2.11' }, limited)).status, 200);
assert.equal((await req('tracks', {}, { ...limited, now: 60000 })).status, 200);
assert.equal((await req('openapi.json', {}, limited)).json.openapi, '3.1.0');
const spec = (await req('openapi.json')).json;
assert.deepEqual(Object.keys(spec.paths), ['/tracks', '/tracks/{id}', '/artists/{handle}', '/rooms', '/openapi.json']);
assert.deepEqual(Object.keys(detail.track), spec.components.schemas.Track.required);
console.log('public API passed: catalog, creators, room visibility, CORS, cache, rate limit and OpenAPI');
