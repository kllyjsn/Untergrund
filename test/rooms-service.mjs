import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createRooms, memoryRoomStore, corsHeaders } from '../api/_lib/rooms.js';

const secret = (id) => createHash('sha256').update(id).digest('hex');

// Rooms survive a restart when a store is configured.
const store = memoryRoomStore();
let rooms = createRooms({ store, saveDelay: 1 });
let r = await rooms.post('restart-room', { type: 'presence', clientId: 'host', clientSecret: secret('host'), user: { name: 'Host' } });
const token = r.json.sessionToken;
await rooms.post('restart-room', { id: 'c1', type: 'chat', clientId: 'host', token, clientSecret: secret('host'), user: { name: 'Host' }, payload: { text: 'still here' } });
await rooms.post('restart-room', { id: 's1', type: 'set', clientId: 'host', token, clientSecret: secret('host'), user: { name: 'Host' }, payload: { title: 'Kept', state: { patterns: [], bpm: 130 } } });
await rooms.flush();
assert(store.data.has('restart-room'));
assert(!JSON.parse(store.data.get('restart-room')).secrets[0][1].includes(secret('host')), 'only secret hashes are stored');

rooms = createRooms({ store });
r = await rooms.get('restart-room');
assert.equal(r.json.currentSet.title, 'Kept');
assert.equal(r.json.events.find((e) => e.type === 'chat').payload.text, 'still here');
r = await rooms.post('restart-room', { type: 'presence', clientId: 'host', token, clientSecret: secret('host'), user: { name: 'Host' } });
assert.equal(r.status, 200, 'returning host keeps its session after restart');
r = await rooms.post('restart-room', { type: 'presence', clientId: 'host', token: 'forged', clientSecret: secret('guest'), user: { name: 'Impostor' } });
assert.equal(r.status, 401, 'restored secrets still block impersonation');
assert.equal((await rooms.post('restart-room', null)).status, 400);

// Presence-only heartbeats from known members do not write to the store.
const writes = { n: 0 };
rooms = createRooms({ store: { kind: 'count', async load() { return null; }, async save() { writes.n++; } }, saveDelay: 1 });
r = await rooms.post('quiet', { type: 'presence', clientId: 'a', clientSecret: secret('a'), user: {} });
await rooms.flush();
for (let i = 0; i < 5; i++) await rooms.post('quiet', { type: 'presence', clientId: 'a', token: r.json.sessionToken, clientSecret: secret('a'), user: {} });
await rooms.flush();
assert.equal(writes.n, 1);

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

// Fake Upstash REST endpoint: a SIGTERM'd server flushes rooms and the next one restores them.
const kv = new Map();
const fakeRedis = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const [cmd, key, value] = JSON.parse(Buffer.concat(chunks).toString());
    if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
    const result = cmd === 'SET' ? (kv.set(key, value), 'OK') : cmd === 'GET' ? (kv.get(key) ?? null) : null;
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ result }));
  });
});
await new Promise((resolve) => fakeRedis.listen(0, resolve));
const kvEnv = { KV_REST_API_URL: `http://127.0.0.1:${fakeRedis.address().port}`, KV_REST_API_TOKEN: 'test-token' };
let srv = start(kvEnv);
await srv.ready;
const roomUrl = `http://localhost:${port}/api/rooms/kv-room/events`;
await fetch(roomUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'k1', type: 'chat', clientId: 'kv', clientSecret: secret('kv'), user: { name: 'KV' }, payload: { text: 'survives deploys' } }) });
assert.equal((await (await fetch(`http://localhost:${port}/healthz`)).json()).persistence, 'redis');
srv.child.kill('SIGTERM'); await srv.stopped;
assert(kv.has('untergrund:room:kv-room'));
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
