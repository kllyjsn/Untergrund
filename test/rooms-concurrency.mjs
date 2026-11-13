// Many clients POSTing at once against several stateless service instances that share one KV (= Vercel functions
// sharing Upstash): no member, chat event, deck join or set may be lost. Runs on the in-memory twin with jittered
// commands, then (when redis-server is available, always in CI) against real Redis through an Upstash-style REST shim.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRooms, memoryRoomsKv } from '../api/_lib/rooms.js';
import { redisKv } from '../api/_lib/kv.js';
import { startUpstash, respKv } from './fake-upstash.mjs';

const secret = (id) => createHash('sha256').update(`c-${id}`).digest('hex');
const N = 24, CHATS = 3;

async function scenario(label, makeService) {
  const svc = Array.from({ length: 4 }, makeService);
  const pick = (i) => svc[i % svc.length];
  const room = `race-${Math.random().toString(36).slice(2, 8)}`;
  const ids = Array.from({ length: N }, (_, i) => `c${i}`);
  const host = 'c0';
  const tok = {};
  const post = async (i, body) => {
    const id = ids[i];
    const r = await pick(i + Math.floor(Math.random() * 4)).post(room, { clientId: id, clientSecret: secret(id), token: tok[id], user: { name: `N${i}`, joinedAt: 1000 + i }, ...body });
    if (r.json.sessionToken) tok[id] = r.json.sessionToken;
    return r;
  };
  // The host arrives first, then everyone joins at once.
  assert.equal((await post(0, { type: 'presence' })).status, 200);
  const joins = await Promise.all(ids.slice(1).map((_, k) => post(k + 1, { type: 'presence' })));
  assert(joins.every((r) => r.status === 200), `${label}: joins ok`);
  // Everyone chats, half queue for the decks, presence keeps beating, the host publishes a set: all in parallel.
  const work = [];
  ids.forEach((_, i) => {
    for (let c = 0; c < CHATS; c++) work.push(post(i, { id: `m-${i}-${c}`, type: 'chat', payload: { text: `hi ${i}.${c}` } }));
    work.push(post(i, { type: 'presence' }));
    if (i && i % 2 === 0) work.push(post(i, { id: `d-${i}`, type: 'deck', payload: { action: 'join' } }));
  });
  work.push(post(0, { id: 'set-1', type: 'set', payload: { title: 'Race', artist: 'Host', state: { patterns: [], bpm: 128 } } }));
  const results = await Promise.all(work);
  assert(results.every((r) => r.status === 200), `${label}: ${results.filter((r) => r.status !== 200).map((r) => r.status + r.json.error).join(',')}`);
  const claims = await Promise.all([1, 3].map((i) => post(i, { id: `jam-${i}`, type: 'jam', payload: { action: 'claim', part: 'drums' } })));
  assert.deepEqual(claims.map((r) => r.status).sort(), [200, 409], `${label}: one drummer wins a claim race`);
  const snap = (await svc[0].get(room, 0)).json;
  assert.equal(snap.members.length, N, `${label}: every member present`);
  assert.equal(snap.hostId, host, `${label}: the first arrival hosts`);
  const chats = snap.events.filter((e) => e.type === 'chat').map((e) => e.id);
  assert.equal(new Set(chats).size, N * CHATS, `${label}: no chat lost`);
  const seqs = snap.events.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), `${label}: events in seq order`);
  assert.equal(new Set(seqs).size, seqs.length, `${label}: unique seqs`);
  assert.equal(snap.jam.parts.drums.owner && ['c1', 'c3'].includes(snap.jam.parts.drums.owner), true);
  assert.equal(snap.seq, N * CHATS + N / 2 - 1 + 2, `${label}: one seq per event`);
  assert.deepEqual([...snap.queue].sort(), ids.filter((_, i) => i && i % 2 === 0).sort(), `${label}: every deck join kept`);
  assert.equal(snap.currentSet?.title, 'Race');
  assert.equal(snap.currentSet.version, 1);
  // Incremental polls see exactly the events after `since`.
  const later = (await svc[1].get(room, snap.seq - 5)).json;
  assert.deepEqual(later.events.map((e) => e.seq), seqs.slice(-5));
  // Set bodies are only sent when the caller's version is stale.
  assert.equal((await svc[2].get(room, snap.seq, { knownSet: '1', knownJam: String(snap.jam.rev) })).json.currentSet, undefined);
  // Two hosts racing to pass the decks: exactly one handoff wins.
  const passes = await Promise.all([post(0, { type: 'deck', payload: { action: 'pass' } }), post(0, { type: 'deck', payload: { action: 'pass' } })]);
  assert(passes.every((r) => r.status === 200));
  const after = (await svc[3].get(room, 0)).json;
  assert.equal(after.hostId, snap.queue[0], `${label}: the first in the queue takes the decks`);
  assert.equal(after.queue.length, N / 2 - 2, `${label}: only one handoff consumed the queue`);
  console.log(`rooms concurrency (${label}): ${N} members, ${results.length} parallel POSTs, nothing lost`);
}

await scenario('memory twin', ((kv) => () => createRooms({ kv }))(memoryRoomsKv({ delay: 4 })));

const hasRedis = spawnSync('redis-server', ['--version']).status === 0;
if (!hasRedis) {
  if (process.env.CI) throw new Error('redis-server is required in CI (real Lua check)');
  console.log('rooms concurrency (redis): skipped, redis-server not installed');
} else {
  const port = 6500 + Math.floor(Math.random() * 400);
  const child = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  try {
    let resp;
    for (let i = 0; i < 50; i++) { try { resp = respKv(port); await resp.ready; break; } catch { resp = null; await new Promise((ok) => setTimeout(ok, 100)); } }
    assert(resp, 'redis-server started');
    const upstash = await startUpstash(resp);
    Object.assign(process.env, upstash.env);
    await scenario('real redis via Upstash REST', () => createRooms({ kv: redisKv() }));
    upstash.close(); resp.close();
  } finally { child.kill(); }
}
