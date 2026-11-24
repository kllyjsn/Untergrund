import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { handleAccount, signSession, COOKIE } from '../api/_lib/accounts.js';
import { memoryKv } from '../api/_lib/kv.js';
import { memoryStore } from '../api/_lib/crate.js';
import { libraryScripts, LIBRARY_LIMIT, LIBRARY_BODY_BYTES } from '../api/_lib/library.js';
import { createCloudLibrary } from '../js/cloud-library.js';
import { defaultState, sanitize } from '../js/state.js';

const kv = memoryKv({ scripts: libraryScripts }), crate = memoryStore(), secret = 'cloud-test'.repeat(5);
const ctx = { kv, crate, secret };
const host = 'untergrund.example', origin = `https://${host}`;
async function session(id, signedIn = true) {
  await kv.cmd(['SET', `untergrund:acct:a:${id}`, JSON.stringify({ id, providers: signedIn ? { soundcloud: { id } } : {} })]);
  return `${COOKIE}=${signSession({ sub: id }, secret)}`;
}
const alice = await session('alice'), bob = await session('bob'), device = await session('device', false);
const call = (cookie, library, body, id, headers = {}) => handleAccount({
  cookie, method: body ? 'POST' : 'GET', query: { library, ...(id && { id }) },
  host, origin, body, ...headers,
}, ctx);
const draft = { id: 'local-song-one', title: 'A private song', artist: 'Alice', style: 'acid',
  created: '2025-10-01T10:00:00Z', state: { ...defaultState(), renderedAudio: 'not stored' } };
for (const cookie of ['', device]) {
  assert.equal((await call(cookie, 'alice')).status, 401);
  assert.equal((await call(cookie, 'alice', { ...draft, action: 'save' })).status, 401);
}
assert.equal((await call(alice, 'bob')).status, 409);
assert.equal((await call(alice, 'alice', { ...draft, action: 'save' }, null, { origin: 'https://evil.example' })).status, 403);
assert.equal((await call(alice, 'alice', { ...draft, action: 'save' }, null, { origin: '' })).status, 403);
assert.equal((await call(alice, 'alice', { ...draft, action: 'save', extra: 'x'.repeat(LIBRARY_BODY_BYTES) })).status, 413);
const first = await call(alice, 'alice', { ...draft, action: 'save' });
assert.equal(first.status, 200);
assert.equal(first.json.item.title, draft.title);
assert.equal(first.json.item.state, undefined);
assert.equal((await call(alice, 'alice', { ...draft, title: 'Different', action: 'save' })).json.item.title, draft.title);
assert.deepEqual((await call(alice, 'alice')).json.items, [first.json.item]);
assert.deepEqual((await call(bob, 'bob')).json.items, []);
assert.equal((await call(bob, 'bob', null, draft.id)).status, 404);
assert.deepEqual((await call(alice, 'alice', null, draft.id)).json.state, sanitize(draft.state));
assert.deepEqual(await crate.list(), []);
assert.equal((await call(alice, 'alice', { id: draft.id, action: 'delete' })).status, 200);
assert.equal((await call(alice, 'alice', null, draft.id)).status, 404);
assert.equal((await call(alice, 'alice', { ...draft, action: 'save' })).json.error, 'track_deleted');

const fill = await session('fill');
for (let i = 0; i < LIBRARY_LIMIT - 1; i++) {
  assert.equal(await kv.cmd(['HSET', 'untergrund:library:{fill}:meta', `saved-${i}`, '{}']), 1);
}
const concurrent = await Promise.all(['a', 'b'].map((id) => call(fill, 'fill', { ...draft, id: `last-${id}`, action: 'save' })));
assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
assert.equal(await kv.cmd(['HLEN', 'untergrund:library:{fill}:meta']), LIBRARY_LIMIT);
console.log('private Library API passed: signed-in access, CSRF, isolated state, atomic limit and deletion');

let active = { account: null }, update, cookie = alice, offline = false, publicSaves = 0, localSaves = 0;
const browser = [{ ...draft, id: 'local-browser-song' }], pending = new Map();
const cloud = createCloudLibrary({
  get: async () => active, subscribe: (cb) => { update = cb; }, device: () => browser,
  request: async (owner, body, id) => {
    if (offline) throw new Error('offline');
    const r = await call(cookie, owner, body, id);
    if (r.status !== 200) throw new Error(r.json.error);
    return r.json;
  },
  read: (id) => pending.get(id) || [], write: (id, rows) => { pending.set(id, rows); return true; },
  savePublic: () => ++publicSaves,
  saveLocal: () => ++localSaves,
});
assert.deepEqual(cloud.tracks(), browser);
assert.equal(await cloud.saveGenerated(draft), 1);
update(active = { account: null, unavailable: true });
await cloud.saveGenerated(draft);
assert.equal(localSaves, 1, 'an unavailable account check never falls through to the public crate');
update(active = { account: { id: 'alice', anon: false } });
await cloud.refresh();
assert.deepEqual((await call(alice, 'alice')).json.items.map((t) => t.id), [browser[0].id]);
assert.deepEqual(await cloud.load(browser[0].id), (await call(alice, 'alice', null, browser[0].id)).json.state);
offline = true;
assert.deepEqual(await cloud.saveGenerated(draft), { private: true, synced: false, kept: true });
assert.equal(pending.get('alice').length, 1);
offline = false;
await cloud.refresh();
assert.equal(pending.get('alice').length, 0);
assert.equal(cloud.tracks().length, 2);
assert.equal(publicSaves, 1, 'signed-in generation never goes through the public crate');
assert.equal(await cloud.remove(browser[0].id), true);
await cloud.refresh();
assert.equal(cloud.tracks().some((t) => t.id === browser[0].id), false);
assert.equal(browser.length, 1, 'initial migration leaves the original browser Library intact');
update(active = { account: null });
assert.deepEqual(cloud.tracks(), browser);
cookie = bob;
update(active = { account: { id: 'bob', anon: false } });
await cloud.refresh();
assert.deepEqual(cloud.tracks().map((t) => t.id), [browser[0].id]);
console.log('cloud Library client passed: local merge, offline retry, private saves and account switching');

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(root, 'test/.library-http-'));
const file = path.join(directory, 'kv.json');
await writeFile(file, JSON.stringify({
  'untergrund:acct:a:alice': { t: 's', v: JSON.stringify({ id: 'alice', providers: { soundcloud: { id: 'alice' } } }) },
}));
const proc = spawn(process.execPath, ['server.mjs'], {
  cwd: root, env: { PATH: process.env.PATH, AUTH_SECRET: secret, DATA_FILE: file, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'],
});
const output = createInterface({ input: proc.stdout }), exited = once(proc, 'exit');
try {
  const [line] = await once(output, 'line', { signal: AbortSignal.timeout(5000) });
  const [base] = line.match(/http:\/\/localhost:\d+/);
  const saved = await fetch(base + '/api/account?library=alice', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: alice },
    body: JSON.stringify({ ...draft, action: 'save', padding: 'x'.repeat(20000) }),
  });
  assert.equal(saved.status, 200, await saved.text());
  const state = await fetch(base + '/api/account?library=alice&id=' + draft.id, { headers: { Cookie: alice } });
  assert.equal(state.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await state.json()).state, sanitize(draft.state));
  assert.equal((await fetch(base + '/' + path.relative(root, file))).status, 404, 'private account file is not a static asset');
  assert.equal((await fetch(base + '/api/tracks?id=' + draft.id)).status, 404, 'no copy in the public crate');
} finally {
  output.close();
  proc.kill();
  await exited;
  await rm(directory, { recursive: true, force: true });
}
console.log('cloud Library HTTP passed: playable private state, no cache, no static account file and no public copy');
