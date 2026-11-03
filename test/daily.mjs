import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dailyDrop, dropDate, isDropDate, msToNextDrop, countdown, recentDrops, dropSong } from '../js/daily.js';
import { defaultState, sanitize, STYLES } from '../js/state.js';
import { encodeSong, decodeSong, remixState } from '../js/share-code.js';
import { handleDrop, handlePlay, memoryStore, handleCrate } from '../api/_lib/crate.js';

// DAILY DROP: a pure function of the UTC date.
const a = dailyDrop('2026-11-03');
assert.deepEqual(a, dailyDrop(new Date('2026-11-03T00:00:00Z')));
assert.deepEqual(a, dailyDrop(new Date('2026-11-03T23:59:59.999Z')));
assert.deepEqual(a, dailyDrop(Date.parse('2026-11-03T12:00:00Z')));

// The jukebox's DROPS shelf: today first, one per day, and each plays the same song for everyone.
const shelf = recentDrops(14, Date.parse('2026-11-20T08:00:00Z'));
assert.equal(shelf.length, 14);
assert.deepEqual(shelf.map((d) => d.date).slice(0, 3), ['2026-11-20', '2026-11-19', '2026-11-18']);
assert.equal(new Set(shelf.map((d) => d.date)).size, 14);
const song = dropSong(a);
assert.equal(JSON.stringify(song), JSON.stringify(dropSong(dailyDrop('2026-11-03'))), 'a drop renders the same song every time');
assert.equal(song.drop, '2026-11-03');
assert.equal(song.artist.title, a.title);
assert(song.chainOn && song.patterns.length > 1);
assert.equal(sanitize(song).drop, '2026-11-03');
assert.equal(remixState({ state: song, title: a.title, artist: 'UNTERGRUND', style: a.style }).drop, '2026-11-03', 'remixing a jukebox drop keeps the tag');
assert.notEqual(JSON.stringify(dropSong(dailyDrop('2026-11-04')).patterns), JSON.stringify(song.patterns));
assert.notDeepEqual(a, dailyDrop('2026-11-04'));
assert.equal(dropDate(new Date('2026-11-03T23:59:59Z')), '2026-11-03');
assert.equal(dropDate(new Date('2026-11-04T00:00:00Z')), '2026-11-04');
assert(isDropDate('2028-02-29') && !isDropDate('2026-02-30') && !isDropDate('2026-1-03') && !isDropDate(20261103));
const days = Array.from({ length: 800 }, (_, i) => dailyDrop(new Date(Date.UTC(2026, 0, 1) + i * 86400e3)));
for (const [i, d] of days.entries()) {
  assert(STYLES[d.style], `${d.date} has a real style`);
  assert.notEqual(STYLES[d.style].family, 'CLASSICAL');
  assert.equal(d.genre, STYLES[d.style].name);
  assert(Number.isInteger(d.seed) && d.seed >= 0 && d.seed < 1e9);
  assert.match(d.title, /^\w+ \w+$/);
  if (i) assert.notEqual(d.style, days[i - 1].style, `${d.date} repeats yesterday's genre`);
}
assert(new Set(days.map((d) => d.seed)).size > 790, 'seeds vary day to day');
assert(new Set(days.slice(0, 60).map((d) => d.style)).size >= 20, 'genres rotate');
assert.equal(msToNextDrop(Date.parse('2026-11-03T23:00:00Z')), 3600e3);
assert.equal(msToNextDrop(Date.parse('2026-11-03T00:00:00Z')), 86400e3);
assert.equal(countdown(3600e3 + 5 * 60e3), '1h 05m');
assert.equal(countdown(59e3), '1m');
console.log('daily drop determinism passed');

// `drop` survives sanitize() and a share link; junk is dropped.
assert.equal(sanitize({ ...defaultState(), drop: '2026-11-03' }).drop, '2026-11-03');
assert.equal(sanitize({ ...defaultState(), drop: 'tomorrow' }).drop, undefined);
assert.equal(sanitize(defaultState()).drop, undefined);
const state = { ...defaultState(), drop: '2026-11-03', remixOf: { id: '', title: 'Daily Drop · Quiet Motion', artist: 'UNTERGRUND' } };
const back = await decodeSong(await encodeSong({ state, title: 'Quiet Motion', artist: 'Nova', style: 'hypnotic' }));
assert.equal(back.state.drop, '2026-11-03');
assert.equal(back.state.remixOf.title, 'Daily Drop · Quiet Motion');
const re = remixState({ state, title: 'Quiet Motion', artist: 'Nova', style: 'hypnotic', trackId: 'abc123' }, { name: 'Kai' });
assert.equal(re.drop, '2026-11-03', 'a remix of a drop remix still belongs to the drop');
assert.equal(re.remixOf.id, 'abc123');
console.log('drop sanitize/share round trip passed');

// Without Redis the API says so, and the app falls back to the local crate.
assert.deepEqual(await handleDrop('GET', '2026-11-03', null), { status: 503, json: { enabled: false, tracks: [] } });
const store = memoryStore();
assert.equal((await handleDrop('GET', 'nope', store)).status, 400);
assert.equal((await handlePlay('POST', 'missing', store)).status, 404);
const kept = await handleCrate('POST', { title: 'K', state: { ...defaultState(), drop: '2026-11-03' } }, store);
for (let i = 0; i < 520; i++) await store.add({ id: `filler-${i}`, title: 'f', state: defaultState() });
assert.equal((await handleCrate('GET', null, store, kept.json.track.id)).json.track.state.drop, '2026-11-03', 'drop remixes outlive the rolling crate');

// API listing through the real local server (in-memory KV).
const PORT = 8600 + Math.floor(Math.random() * 300);
const env = { ...process.env, PORT: String(PORT), SC_MOCK: '1' };
for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((ok, fail) => { server.stdout.on('data', (d) => String(d).includes('UNTERGRUND on') && ok()); server.on('exit', fail); setTimeout(fail, 10e3); });
  const base = `http://localhost:${PORT}`;
  const post = (path, body, ip) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ip && { 'X-Forwarded-For': ip }) }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const get = (path) => fetch(base + path).then(async (r) => ({ status: r.status, json: await r.json() }));
  const drop = '2026-11-03';
  const mk = (title, extra = {}) => post('/api/tracks', { title, artist: 'Nova', style: 'hypnotic', state: { ...defaultState(), drop, remixOf: { title: 'Daily Drop · Quiet Motion' }, ...extra } });
  const first = (await mk('First')).json.track, second = (await mk('Second')).json.track;
  assert.equal(first.drop, drop);
  await post('/api/tracks', { title: 'Other day', state: { ...defaultState(), drop: '2026-11-02' } });
  await post('/api/tracks', { title: 'No drop', state: defaultState() });
  let list = await get(`/api/tracks?drop=${drop}`);
  assert.equal(list.status, 200);
  assert.equal(list.json.enabled, true);
  assert.deepEqual(list.json.tracks.map((t) => t.title), ['Second', 'First'], 'newest first before any plays');
  assert.equal(list.json.tracks[0].state, undefined, 'listing is metadata only');
  assert.equal((await post(`/api/tracks?play=${first.id}`)).json.plays, 1);
  assert.equal((await post(`/api/tracks?play=${first.id}`)).json.plays, 1, 'one play per listener per day');
  assert.equal((await post(`/api/tracks?play=nope-nope`)).status, 404);
  list = await get(`/api/tracks?drop=${drop}`);
  assert.deepEqual(list.json.tracks.map((t) => [t.title, t.plays]), [['First', 1], ['Second', 0]], 'ranked by plays');
  assert.equal((await get('/api/tracks?drop=2026-13-01')).status, 400);
  assert.equal((await get('/api/tracks?drop=2026-11-05')).json.tracks.length, 0);

  // REMIX TREE: opening a remix counts it (as the app does), publishing files it under its parent.
  await post(`/api/tracks?remix=${second.id}`);
  const child = (await mk('Second (Remix)', { remixOf: { id: second.id, title: 'Second', artist: 'Nova' } })).json.track;
  const parent = (await get(`/api/tracks?id=${second.id}`)).json.track;
  assert.deepEqual(parent.children.map((t) => t.id), [child.id]);
  assert.equal(parent.children[0].state, undefined);
  assert.equal((await get(`/api/tracks?id=${child.id}`)).json.track.remixOf.id, second.id);
  list = await get(`/api/tracks?drop=${drop}`);
  assert.equal(list.json.tracks[0].title, 'Second', 'remixes of a remix count toward its rank');
  const page = await fetch(`${base}/t/${second.id}`).then((r) => r.text());
  assert.match(page, /REMIXES · 1/);
  assert.match(page, /Second \(Remix\)/);
  assert.match(page, /Remix of the Daily Drop · 2026-11-03/);
  const childPage = await fetch(`${base}/t/${child.id}`).then((r) => r.text());
  assert.match(childPage, new RegExp(`Remix of <a href="/t/${second.id}">Second</a> by Nova`));
  console.log('drop listing + remix tree API passed');
} finally { server.kill(); }
