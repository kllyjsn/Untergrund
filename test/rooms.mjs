import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const port = 8840 + Math.floor(Math.random() * 100);
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('room test server did not start')), 5000);
  server.stdout.on('data', (chunk) => {
    if (chunk.toString().includes('UNTERGRUND on')) {
      clearTimeout(timer);
      resolve();
    }
  });
});

const base = `http://localhost:${port}/api/rooms/test-room`;
const tokens = {};
const secrets = {
  host: createHash('sha256').update('host').digest('hex'),
  guest: createHash('sha256').update('guest').digest('hex'),
};
const post = async (body) => {
  const token = Object.hasOwn(body, 'token') ? body.token : (tokens[body.clientId] || '');
  const clientSecret = body.clientSecret || secrets[body.clientId] || createHash('sha256').update(body.clientId).digest('hex');
  const request = { ...body, token, clientSecret };
  const response = await fetch(`${base}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const json = await response.json();
  if (json.sessionToken) tokens[body.clientId] = json.sessionToken;
  return { status: response.status, json };
};

try {
  await ready;
  await post({ type: 'presence', clientId: 'host', user: { name: 'Host', shape: 'round', color: 'violet', gear: 'hood' } });
  await post({ type: 'presence', clientId: 'guest', user: { name: 'Guest', shape: 'visor', color: 'blue', gear: 'goggles' } });

  let result = await post({ type: 'presence', clientId: 'host', token: 'forged', clientSecret: secrets.guest, user: { name: 'Impostor' } });
  assert.equal(result.status, 401);

  result = await post({ id: 'queue', type: 'deck', clientId: 'guest', user: { name: 'Guest' }, payload: { action: 'join' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.queue, ['guest']);

  result = await post({ id: 'blocked', type: 'set', clientId: 'guest', user: { name: 'Guest' }, payload: { title: 'Blocked' } });
  assert.equal(result.status, 403);

  result = await post({ id: 'pass', type: 'deck', clientId: 'host', user: { name: 'Host' }, payload: { action: 'pass' } });
  assert.equal(result.json.hostId, 'guest');
  assert.deepEqual(result.json.queue, []);

  result = await post({
    id: 'set',
    type: 'set',
    clientId: 'guest',
    user: { name: 'Guest' },
    payload: {
      title: 'Night Signal',
      bpm: 999,
      state: { patterns: [], bpm: 999, chain: 'A!Z', params: { acid: { cutoff: 'invalid' } } },
      startsAt: Date.now() + 1000,
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.json.currentSet.title, 'Night Signal');
  assert.equal(result.json.currentSet.bpm, 240);
  assert.equal(result.json.currentSet.state.patterns.length, 8);
  assert.equal(result.json.currentSet.state.chain, 'A');
  assert.equal(result.json.currentSet.version, 1);

  result = await post({
    id: 'set-2', type: 'set', clientId: 'guest', user: { name: 'Guest' },
    payload: { title: 'Night Signal', state: { patterns: [], bpm: 138 }, startsAt: Date.now() + 1000 },
  });
  assert.equal(result.json.currentSet.version, 2);
  assert.equal(result.json.currentSet.by, 'guest');

  result = await post({ id: 'chat', type: 'chat', clientId: 'host', user: { name: '<Host>' }, payload: { text: '<b>Signal</b>' } });
  assert.equal(result.status, 200);
  assert.equal(result.json.events.at(-1).payload.text, 'bSignal/b');

  const snapshot = await (await fetch(`${base}?since=0`)).json();
  assert.equal(snapshot.members.length, 2);
  assert.equal(snapshot.hostId, 'guest');
  assert.equal(snapshot.currentSet.title, 'Night Signal');
  assert(snapshot.events.some((event) => event.type === 'deck'));
  assert(snapshot.events.some((event) => event.type === 'set'));

  console.log('room presence, DJ queue, host controls, chat and native set broadcast passed');
} finally {
  server.kill('SIGTERM');
}
