import assert from 'node:assert/strict';
import { normalizeDirectory, OFF, isRoomPublic, setRoomPublic, myRoom, roomInviteUrl, roomLine, directorySignature } from '../js/live-rooms.js';
import { handlePage, renderRoomPage } from '../api/_lib/pages.js';
import { ogImage, artSeed } from '../api/_lib/og.js';
import { clubImage } from '../api/_lib/og-club.js';
import { memoryStore, normalizeTrack } from '../api/_lib/crate.js';
import { songLink } from '../js/share-code.js';
import { defaultState } from '../js/state.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

// The directory is optional: anything but { enabled: true, rooms: [] } turns the live UI off.
for (const bad of [null, undefined, {}, { enabled: false, rooms: [{ id: 'x1' }] }, { enabled: true }, { enabled: 'yes', rooms: [] }, 'nope']) assert.equal(normalizeDirectory(bad), OFF);
const dir = normalizeDirectory({ enabled: true, rooms: [
  { id: 'quiet-room', title: 'Small', style: 'acid', bpm: 133.4, listeners: 2, dj: { name: 'Ana', shape: 'round', color: 'blue', gear: 'hood' }, startsAt: 5 },
  { id: 'BIG-ROOM', title: '<b>Big</b>', style: 'not-a-style', bpm: 'fast', listeners: 30, dj: { name: 'x'.repeat(80), shape: 'cube', color: 'chartreuse', gear: 'jetpack' }, replay: 'true' },
  { id: 'big-room', title: 'dupe', listeners: 99 },
  { id: '../etc', title: 'bad id' },
  { id: 'empty-room' },
] });
assert.equal(dir.enabled, true);
assert.deepEqual(dir.rooms.map((r) => r.id), ['big-room', 'quiet-room', 'empty-room'], 'busiest first, ids lowercased, deduped, invalid dropped');
const [big, quiet, empty] = dir.rooms;
assert.equal(big.title, '<b>Big</b>', 'text is kept as text (h() escapes it)');
assert.equal(big.style, '');
assert.equal(big.bpm, 0);
assert.equal(big.replay, false, 'replay must be a real boolean');
assert.deepEqual([big.dj.shape, big.dj.color, big.dj.gear, big.dj.name.length], ['block', 'lime', 'none', 28]);
assert.equal(quiet.bpm, 133);
assert.equal(roomLine(quiet), 'Ana · ACID · 133 BPM');
assert.equal(empty.listeners, 1);
assert.equal(empty.title, 'Live Machine Set');
assert.notEqual(directorySignature(dir), directorySignature(normalizeDirectory({ enabled: true, rooms: [{ ...quiet, listeners: 3 }] })));

// Public by default, private is remembered per room.
const store = memory();
assert.equal(isRoomPublic('a-room', store), true);
setRoomPublic('a-room', false, store);
assert.equal(isRoomPublic('a-room', store), false);
assert.equal(isRoomPublic('b-room', store), true);
setRoomPublic('a-room', true, store);
assert.equal(isRoomPublic('a-room', store), true);
assert.equal(isRoomPublic('a-room', { getItem: () => '{not json' }), true);

// "My room" is derived from the avatar name once and kept stable.
const mine = memory();
const id = myRoom('Night Listener!!', mine, () => 0.123456);
assert.match(id, /^night-listener-[a-z0-9]{4}$/);
assert.equal(myRoom('Someone Else', mine), id);
assert.match(myRoom('', memory()), /^room-[a-z0-9]{4}$/);
assert.equal(roomInviteUrl('the-bunker', 'https://www.untergrund.sh'), 'https://www.untergrund.sh/r/the-bunker');

// /r/<room> unfurls with what's playing; an idle or unknown room still gets a page that joins.
const site = 'https://www.untergrund.sh', og = { ogImage, artSeed, clubImage };
const tag = (html, prop) => html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1];
const snap = { hostId: 'dj', members: [{ id: 'dj', name: 'Mira <K>' }, { id: 'l1', name: 'L' }],
  currentSet: { title: 'Tunnel "Vision"', style: 'hypnotic', bpm: 132, state: defaultState(), broadcastId: 'b1' } };
const rooms = { get: async (room) => ({ status: 200, json: room === 'live-room' ? snap : { members: [], currentSet: null } }) };
const live = await handlePage({ r: 'live-room' }, { site, og, rooms });
assert.equal(live.status, 200);
assert.match(live.cache, /max-age=15/);
assert.equal(tag(live.body, 'og:title'), 'Tunnel &quot;Vision&quot; — live in live-room');
assert.match(tag(live.body, 'og:description'), /^Mira &lt;K&gt; · HYPNOTIC · 132 BPM · 2 listening\./);
assert.equal(tag(live.body, 'og:url'), `${site}/r/live-room`);
assert.equal(tag(live.body, 'og:image'), `${site}/api/page?og_room=live-room&amp;v=club`);
assert.match(live.body, /"kind":"room"/);
assert.match(live.body, /href="\/\?room=live-room"/);
const img = await handlePage({ og_room: 'live-room' }, { site, og, rooms });
assert.equal(img.type, 'image/png');
assert(img.body.length > 1000);
const idle = await handlePage({ r: 'Quiet-Room' }, { site, og, rooms });
assert.equal(tag(idle.body, 'og:title'), 'Join quiet-room on UNTERGRUND Club');
assert.equal(tag(idle.body, 'og:image'), `${site}/social-card.png`);
assert.equal((await handlePage({ og_room: 'quiet-room' }, { site, og, rooms })).status, 302);
assert.equal((await handlePage({ r: '../../x' }, { site, og, rooms })).status, 302);
assert.match(renderRoomPage('no-store', null, { site }), /Join no-store on UNTERGRUND Club/, 'works without a room store');
assert.match((await handlePage({ r: 'down-room' }, { site, og, rooms: { get: async () => { throw new Error('kv down'); } } })).body, /Join down-room/);

// A song shared while it's live in a room unfurls with that room's stage; once the room moves on, its own cover.
const png = (b) => b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' && b.readUInt32BE(16) === 1200 && b.readUInt32BE(20) === 630;
assert(png(img.body), 'the room preview is the 1200x630 stage');
for (const style of ['acid', 'folk', 'rock', 'country', 'neosoul', 'nocturne', 'symphony', 'nope']) assert(png(clubImage({ ...snap, currentSet: { ...snap.currentSet, style } }, 'live-room')), style);
assert(png(clubImage({ members: [], currentSet: null }, 'x1')), 'renders without a set or crowd');
const crate = memoryStore(), song = normalizeTrack({ title: 'Tunnel "Vision"', artist: 'Mira', style: 'hypnotic', state: defaultState() });
await crate.add(song);
assert.equal(songLink(site, { id: song.id, room: 'live-room' }, '/', 'k3j9x0aa'), `${site}/t/${song.id}?r=k3j9x0aa&room=live-room`);
assert.equal(songLink(site, { id: song.id, room: '../x' }), `${site}/t/${song.id}`, 'bad room ids are dropped');
assert.equal(songLink(site, { id: song.id, room: 'live-room' }, '/embed.html'), `${site}/embed.html?t=${song.id}`);
const onAir = await handlePage({ t: song.id, room: 'live-room' }, { site, og, crate, rooms });
assert.equal(tag(onAir.body, 'og:image'), `${site}/api/page?og_room=live-room&amp;t=${song.id}&amp;v=club`);
assert.equal(tag(onAir.body, 'og:url'), `${site}/t/${song.id}`);
assert.match(tag(onAir.body, 'og:description'), /^Live now in UNTERGRUND Club live-room\./);
assert.match(onAir.cache, /max-age=15/);
assert.match(onAir.body, /href="\/\?room=live-room">Join the live room/);
assert.match(onAir.body, /"room":"live-room"/, 'the hydrated page keeps the room link');
const untitled = normalizeTrack({ title: 'Untitled Signal', artist: 'Mira', style: 'hypnotic', state: snap.currentSet.state });
await crate.add(untitled);
assert.match((await handlePage({ t: untitled.id, room: 'live-room' }, { site, og, crate, rooms })).body, /og_room=live-room/, 'same notes, different title');
const shot = await handlePage({ og_room: 'live-room', t: song.id }, { site, og, crate, rooms });
assert(png(shot.body));
for (const q of [{ t: song.id, room: 'quiet-room' }, { t: song.id, room: '../x' }, { t: song.id }]) {
  const page = await handlePage(q, { site, og, crate, rooms });
  assert.equal(tag(page.body, 'og:image'), `${site}/api/page?og=${song.id}&amp;v=2`, JSON.stringify(q));
  assert.doesNotMatch(page.body, /Join the live room/);
}
const other = normalizeTrack({ title: 'Something Else', artist: 'Mira', style: 'acid', state: { ...defaultState(), bpm: 99 } });
await crate.add(other);
assert.doesNotMatch((await handlePage({ t: other.id, room: 'live-room' }, { site, og, crate, rooms })).body, /og_room/, 'only the song on stage gets the room');
assert.equal((await handlePage({ og_room: 'live-room', t: other.id }, { site, og, crate, rooms })).location, `${site}/api/page?og=${other.id}&v=2`);
assert.equal((await handlePage({ og_room: 'quiet-room', t: song.id }, { site, og, crate, rooms })).location, `${site}/api/page?og=${song.id}&v=2`);

console.log('live rooms ok');
