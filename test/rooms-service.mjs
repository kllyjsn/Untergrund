import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createRooms, memoryRoomsKv, corsHeaders, normalizeSet, routeRooms } from '../api/_lib/rooms.js';
import { startUpstash } from './fake-upstash.mjs';

const secret = (id) => createHash('sha256').update(id).digest('hex');

// Stateless instances sharing one KV see the same room (a new instance = a cold Vercel function or a restart).
const kv = memoryRoomsKv();
let rooms = createRooms({ kv });
let r = await rooms.post('restart-room', { type: 'presence', clientId: 'host', clientSecret: secret('host'), user: { name: 'Host' } });
const token = r.json.sessionToken;
await rooms.post('restart-room', { id: 'c1', type: 'chat', clientId: 'host', token, clientSecret: secret('host'), user: { name: 'Host' }, payload: { text: 'still here' } });
await rooms.post('restart-room', { id: 's1', type: 'set', clientId: 'host', token, clientSecret: secret('host'), user: { name: 'Host' }, payload: { title: 'Kept', public: false, state: { patterns: [], bpm: 130 } } });
assert(!JSON.stringify([...kv.dump()]).includes(secret('host')), 'only secret hashes are stored');

rooms = createRooms({ kv });
r = await rooms.get('restart-room');
assert.equal(r.json.currentSet.title, 'Kept');
assert.equal(r.json.currentSet.public, false);
assert.equal(r.json.events.find((e) => e.type === 'chat').payload.text, 'still here');
assert.equal(r.json.events.find((e) => e.type === 'set').payload.state, undefined, 'set events stay small; the body lives in currentSet');
r = await rooms.post('restart-room', { type: 'presence', clientId: 'host', token, clientSecret: secret('host'), user: { name: 'Host' } });
assert.equal(r.status, 200, 'returning host keeps its session on another instance');
r = await rooms.post('restart-room', { type: 'presence', clientId: 'host', token: 'forged', clientSecret: secret('guest'), user: { name: 'Impostor' } });
assert.equal(r.status, 401, 'stored secrets still block impersonation');
r = await rooms.post('restart-room', { type: 'presence', clientId: 'host', token: 'forged', clientSecret: secret('host'), user: { name: 'Host' } });
assert.equal(r.status, 401, 'a right secret with a wrong session token is refused');
assert.equal((await rooms.post('restart-room', null)).status, 400);
assert.equal(normalizeSet({ state: { patterns: [] } }).public, true, 'sets are public by default');

// Cost: a known member's heartbeat is one KV read (no write) until its `seen` is BEAT_WRITE_MS old; idle polls are one read.
let clock = 1e12;
const quietKv = memoryRoomsKv();
rooms = createRooms({ kv: quietKv, now: () => clock });
r = await rooms.post('quiet', { type: 'presence', clientId: 'a', clientSecret: secret('a'), user: {} });
const beat = () => rooms.post('quiet', { type: 'presence', clientId: 'a', token: r.json.sessionToken, clientSecret: secret('a'), user: {}, knownJam: '0' });
await beat(); clock += 4000;
let before = quietKv.stats.count;
await beat();
assert.equal(quietKv.stats.count - before, 1, 'quiet heartbeat = 1 command');
clock += 4000; before = quietKv.stats.count;
await beat();
assert.equal(quietKv.stats.count - before, 2, 'refreshing seen = read + one HSET');
before = quietKv.stats.count;
await rooms.get('quiet', 0, { knownJam: '0' });
assert.equal(quietKv.stats.count - before, 1, 'idle poll = 1 command');

// Live directory: only public rooms with a set and someone present, listeners desc then newest set, max 24.
clock = 2e12;
const dirKv = memoryRoomsKv();
const at = (t) => createRooms({ kv: dirKv, now: () => t });
const join = async (svc, room, id, extra = {}) => (await svc.post(room, { type: 'presence', clientId: id, clientSecret: secret(id), user: { name: id, avatar: { shape: 'orb', color: 'cyan', gear: 'cap' } }, ...extra })).json.sessionToken;
const publish = async (svc, room, id, tok, payload) => assert.equal((await svc.post(room, { type: 'set', clientId: id, clientSecret: secret(id), token: tok, payload: { state: { patterns: [], bpm: 124 }, ...payload } })).status, 200);
let svc = at(clock);
await publish(svc, 'small', 'dj1', await join(svc, 'small', 'dj1'), { title: 'Small', artist: 'One' });
await new Promise((ok) => setTimeout(ok, 5));
svc = at(clock + 10);
const t2 = await join(svc, 'big', 'dj2');
await join(svc, 'big', 'fan');
await publish(svc, 'big', 'dj2', t2, { title: 'Big', artist: 'Two', style: 'techno', key: 'Am' });
await publish(svc, 'hidden', 'dj3', await join(svc, 'hidden', 'dj3'), { title: 'Secret', public: false });
await join(svc, 'empty', 'nobody');
const d = await at(clock + 20).directory();
assert.equal(d.enabled, true);
assert.deepEqual(d.rooms.map((x) => x.id), ['big', 'small']);
assert.deepEqual(Object.keys(d.rooms[0]).sort(), ['artist', 'bpm', 'dj', 'id', 'key', 'listeners', 'replay', 'startsAt', 'style', 'title']);
assert.deepEqual(d.rooms[0].dj, { name: 'dj2', shape: 'orb', color: 'cyan', gear: 'cap' });
assert.equal(d.rooms[0].listeners, 2);
assert.equal(d.rooms[0].replay, false);
assert.deepEqual((await at(clock + 20 + 16000).directory()).rooms, [], 'rooms drop out once nobody is present');
assert.deepEqual(await routeRooms(null, { method: 'GET', path: '/api/rooms' }), { status: 200, json: { enabled: false, rooms: [] } });

assert.equal(corsHeaders('https://evil.example', 'https://www.untergrund.sh,https://untergrund.sh')['Access-Control-Allow-Origin'], 'https://www.untergrund.sh');
assert.equal(corsHeaders('https://untergrund.sh', 'https://www.untergrund.sh, https://untergrund.sh')['Access-Control-Allow-Origin'], 'https://untergrund.sh');
assert.equal(corsHeaders('https://x.dev')['Access-Control-Allow-Origin'], '*');

// The production entry never loads test mocks or serves files.
const src = readFileSync(new URL('../rooms-server.mjs', import.meta.url), 'utf8');
assert(!/test\/|mock/i.test(src.replace(/^\/\/.*$/gm, '')), 'rooms-server.mjs must not import test code');

const port = 9040 + Math.floor(Math.random() * 100);
const origin = 'https://www.untergrund.sh';
const start = (extra = {}) => {
  const child = spawn(process.execPath, ['rooms-server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH, PORT: String(port), ROOMS_ALLOWED_ORIGIN: origin, ...extra },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('rooms-server did not start')), 5000);
    child.stdout.on('data', (c) => { if (c.toString().includes('UNTERGRUND rooms on')) { clearTimeout(timer); resolve(); } });
  });
  return { child, ready, stopped: new Promise((resolve) => child.on('exit', resolve)) };
};

// Fake Upstash REST endpoint: rooms written by one rooms-server are there for the next one.
const upstashKv = memoryRoomsKv();
const fakeRedis = await startUpstash(upstashKv);
const kvEnv = fakeRedis.env;
let srv = start(kvEnv);
await srv.ready;
const roomUrl = `http://localhost:${port}/api/rooms/kv-room/events`;
await fetch(roomUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'k1', type: 'chat', clientId: 'kv', clientSecret: secret('kv'), user: { name: 'KV' }, payload: { text: 'survives deploys' } }) });
assert.equal((await (await fetch(`http://localhost:${port}/healthz`)).json()).persistence, 'redis');
srv.child.kill('SIGTERM'); await srv.stopped;
assert(upstashKv.dump().has('untergrund:room:kv-room'));
srv = start(kvEnv);
await srv.ready;
const restored = await (await fetch(roomUrl.replace('/events', ''))).json();
assert.equal(restored.events.at(-1).payload.text, 'survives deploys');
srv.child.kill('SIGTERM'); await srv.stopped;
fakeRedis.close();


const { child: server, ready } = start();
try {
  await ready;
  const base = `http://localhost:${port}`;
  const health = await (await fetch(`${base}/healthz`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.persistence, 'memory');
  assert.equal((await fetch(`${base}/index.html`)).status, 404);
  assert.equal((await fetch(`${base}/api/tracks`)).status, 404);
  const pre = await fetch(`${base}/api/rooms/prod-room/events`, { method: 'OPTIONS', headers: { Origin: origin } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), origin);
  const join = await fetch(`${base}/api/rooms/prod-room/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ type: 'presence', clientId: 'p1', clientSecret: secret('p1'), user: { name: 'One' } }) });
  assert.equal(join.status, 200);
  assert.equal((await join.json()).members.length, 1);
  const big = await fetch(`${base}/api/rooms/prod-room/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(500000) });
  assert.equal(big.status, 413);
  const bad = await fetch(`${base}/api/rooms/prod-room/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(bad.status, 400);
  console.log('room persistence, CORS allow-list and production rooms-server passed');
} finally {
  server.kill('SIGTERM');
}
