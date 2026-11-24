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
import { defaultState, load, sanitize, save } from '../js/state.js';
import { songFingerprint } from '../js/listen.js';

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
  created: '2025-10-01T10:00:00Z', action: 'upsert', revision: Date.now(), baseRevision: 0,
  state: { ...defaultState(), renderedAudio: 'not stored' } };
draft.state.params = Object.fromEntries(Object.entries(draft.state.params).reverse());
for (const cookie of ['', device]) {
  assert.equal((await call(cookie, 'alice')).status, 401);
  assert.equal((await call(cookie, 'alice', draft)).status, 401);
}
assert.equal((await call(alice, 'bob')).status, 409);
assert.equal((await call(alice, 'alice', draft, null, { origin: 'https://evil.example' })).status, 403);
assert.equal((await call(alice, 'alice', draft, null, { origin: '' })).status, 403);
assert.equal((await call(alice, 'alice', { ...draft, extra: 'x'.repeat(LIBRARY_BODY_BYTES) })).status, 413);
const first = await call(alice, 'alice', draft);
assert.equal(first.status, 200);
assert.equal(first.json.item.title, draft.title);
assert.equal(first.json.item.state, undefined);
assert.notEqual(songFingerprint(draft.state), songFingerprint(sanitize(draft.state)), 'fixture changes fingerprint when sanitized');
assert.ok(first.json.item.fps.includes(songFingerprint(draft.state)), 'reactions to the song as made remain visible');
assert.ok(first.json.item.fps.includes(songFingerprint(sanitize(draft.state))), 'reactions to the stored version remain visible');
assert.equal((await call(alice, 'alice', { ...draft, title: 'Different' })).json.item.title, draft.title);
assert.deepEqual((await call(alice, 'alice')).json.items, [first.json.item]);
assert.deepEqual((await call(bob, 'bob')).json.items, []);
assert.equal((await call(bob, 'bob', null, draft.id)).status, 404);
assert.deepEqual((await call(alice, 'alice', null, draft.id)).json.state, sanitize(draft.state));
const revision = { ...draft, baseRevision: draft.revision, revision: draft.revision + 2, state: { ...draft.state, bpm: 145 } };
assert.equal((await call(bob, 'alice', revision)).status, 409);
assert.equal((await call(alice, 'alice', revision, null, { origin: '' })).status, 403);
assert.equal((await call(alice, 'alice', { ...revision, revision: 0 })).json.error, 'invalid_revision');
assert.equal((await call(alice, 'alice', { ...revision, extra: 'x'.repeat(LIBRARY_BODY_BYTES) })).json.error, 'too_large');
const revised = await call(alice, 'alice', { ...revision, created: '2026-01-01' });
assert.equal(revised.json.item.bpm, 145);
assert.equal(revised.json.item.created, first.json.item.created);
const conflict = await call(alice, 'alice', { ...revision, revision: revision.revision + 1, state: draft.state });
assert.equal(conflict.status, 409);
assert.equal(conflict.json.error, 'revision_conflict');
assert.equal((await call(alice, 'alice', revision)).json.item.bpm, 145, 'an identical retry acknowledges an already accepted revision');
assert.equal((await call(alice, 'alice', null, draft.id)).json.updatedAt, revision.revision);
assert.equal((await call(alice, 'alice', null, draft.id)).json.state.bpm, 145);
assert.deepEqual(await crate.list(), []);
assert.equal((await call(alice, 'alice', { id: draft.id, action: 'delete' })).status, 200);
assert.equal((await call(alice, 'alice', null, draft.id)).status, 404);
assert.equal((await call(alice, 'alice', draft)).json.error, 'track_deleted');
assert.equal((await call(alice, 'alice', revision)).json.error, 'track_deleted');

const fill = await session('fill');
for (let i = 0; i < LIBRARY_LIMIT - 1; i++) {
  assert.equal(await kv.cmd(['HSET', 'untergrund:library:{fill}:meta', `saved-${i}`, '{}']), 1);
}
const concurrent = await Promise.all(['a', 'b'].map((id) => call(fill, 'fill', { ...draft, id: `last-${id}` })));
assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
assert.equal(concurrent.find((r) => r.status === 409).json.error, 'library_full');
assert.equal(await kv.cmd(['HLEN', 'untergrund:library:{fill}:meta']), LIBRARY_LIMIT);
console.log('private Library API passed: signed-in access, CSRF, isolated state, atomic limit and deletion');

let active = { account: null }, cached = active, update, cookie = alice, offline = false, publicSaves = 0, localSaves = 0;
const browser = [{ ...draft, id: 'local-browser-song' }], pending = new Map(), savedCopies = new Map();
const cloud = createCloudLibrary({
  get: async (force) => force ? active : cached, subscribe: (cb) => { update = (info) => { cached = info; cb(info); }; }, device: () => browser,
  request: async (owner, body, id) => {
    if (offline) throw new Error('offline');
    const r = await call(cookie, owner, body, id);
    if (r.status !== 200) throw new Error(r.json.error);
    return r.json;
  },
  read: (id) => pending.get(id) || [], write: (id, rows) => { pending.set(id, rows); return true; },
  readSaved: (id) => savedCopies.get(id) || [], writeSaved: (id, rows) => { savedCopies.set(id, rows); },
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
const original = await cloud.load(browser[0].id);
assert.deepEqual(original.state, (await call(alice, 'alice', null, browser[0].id)).json.state);
await cloud.update('alice', browser[0].id, { ...original.state, bpm: 147 }, original.updatedAt + 1);
await cloud.refresh();
assert.equal((await cloud.load(browser[0].id)).state.bpm, 147, 'opening an existing local song fetches the newer cloud edit');
assert.equal(cloud.tracks().find((t) => t.id === browser[0].id).bpm, 147, 'cloud metadata takes precedence over the original local copy');
offline = true;
assert.equal((await cloud.load(browser[0].id)).state.bpm, 147, 'offline playback uses the synced edit, not the original browser copy');
await cloud.update('alice', browser[0].id, { ...original.state, bpm: 151 }, original.updatedAt + 2);
assert.equal((await cloud.load(browser[0].id)).state.bpm, 151, 'an offline edit takes priority on this device');
let bound;
const pendingId = 'local-offline-new';
const localSave = await cloud.saveGenerated(draft, pendingId, (id) => { bound = id; });
assert.equal(localSave.synced, false);
assert.equal(localSave.kept, true);
assert.equal(bound, 'alice', 'a pending save binds to Studio before the upload result');
await cloud.update(bound, pendingId, { ...draft.state, bpm: 154 }, Date.now() + 2);
assert.equal((await cloud.load(pendingId)).state.bpm, 154);
assert.equal(pending.get('alice').length, 2);
offline = false;
await cloud.refresh();
assert.equal(pending.get('alice').length, 0);
assert.equal((await call(alice, 'alice', null, browser[0].id)).json.state.bpm, 151, 'the edit syncs when back online');
assert.equal((await call(alice, 'alice', null, pendingId)).json.state.bpm, 154, 'first upload uses the edited pending state');
const reloaded = createCloudLibrary({
  get: async () => ({ unavailable: true }), subscribe: () => {}, device: () => [],
  read: (id) => pending.get(id) || [], write: (id, rows) => { pending.set(id, rows); return true; },
  readSaved: (id) => savedCopies.get(id) || [], writeSaved: (id, rows) => { savedCopies.set(id, rows); },
  request: async () => assert.fail('an offline reload must not upload until the account is verified'),
});
await reloaded.update('alice', pendingId, { ...draft.state, bpm: 155 }, Date.now() + 10);
assert.equal(pending.get('alice')[0].state.bpm, 155, 'edits after an offline reload remain attached to the private song');
assert.deepEqual(reloaded.recent(), [], 'offline reload does not reveal private recents without an account');
await cloud.refresh();
assert.equal((await call(alice, 'alice', null, pendingId)).json.state.bpm, 155);
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
update({ account: null });
const fromStaleTab = await cloud.saveGenerated(draft);
assert.equal(fromStaleTab.private, true, 'sign-in in another tab must not publish a private song');
assert.equal(publicSaves, 1);
assert.equal(cloud.recent()[0].title, draft.title, 'a newly saved private song appears in Create recents');
assert.equal(cloud.recent()[0].cloud, true);
update({ account: null });
assert.deepEqual(cloud.recent(), [], 'private recents do not survive sign-out');
for (const [error, message] of [
  ['library_full', 'Your cloud Library is full (100 songs). Remove a song to sync more. It stays on this device.'],
  ['too_large', 'This song is too large to sync (200 KB limit). It stays on this device.'],
]) {
  const rows = new Map();
  const limited = createCloudLibrary({
    get: async () => ({ account: { id: 'alice' } }), subscribe: () => {}, device: () => [],
    read: (id) => rows.get(id) || [], write: (id, value) => { rows.set(id, value); return true; },
    request: async (owner, body) => { if (body) throw new Error(error); return { items: [], removed: [], limit: LIBRARY_LIMIT }; },
  });
  assert.equal((await limited.saveGenerated(draft)).message, message);
  assert.equal(limited.notice(), message);
}
{
  const rows = new Map();
  const account = { account: { id: 'alice' } };
  const newClient = (request, get = async () => account, device = () => []) => createCloudLibrary({
    get, subscribe: () => {}, request, device,
    read: (id) => rows.get(id) || [], write: (id, value) => { rows.set(id, value); return true; },
  });
  const server = async (owner, body, id) => {
    const r = await call(alice, owner, body, id);
    if (r.status !== 200) throw new Error(r.json.error);
    return r.json;
  };
  const deferred = () => { let resolve; const promise = new Promise((ok) => { resolve = ok; }); return { promise, resolve }; };

  const lostId = 'local-lost-response';
  let lose = true;
  const lost = newClient(async (owner, body, id) => {
    const result = await server(owner, body, id);
    if (body?.id === lostId && lose) { lose = false; throw new Error('offline'); }
    return result;
  });
  assert.equal((await lost.saveGenerated(draft, lostId)).synced, false);
  assert.equal(rows.get('alice').find((row) => row.id === lostId).revision, (await server('alice', null, lostId)).revision);
  lost.update('alice', lostId, { ...draft.state, bpm: 156 });
  await lost.refresh();
  assert.equal((await server('alice', null, lostId)).state.bpm, 156, 'retry updates the same song after a lost create response');

  const started = deferred(), response = deferred(), flightId = 'local-in-flight';
  const firstPage = newClient(async (owner, body, id) => {
    const result = await server(owner, body, id);
    if (body?.id === flightId) { started.resolve(); await response.promise; }
    return result;
  });
  const saving = firstPage.saveGenerated(draft, flightId);
  await started.promise;
  firstPage.update('alice', flightId, { ...draft.state, bpm: 157 });
  response.resolve();
  await saving;
  assert.equal(rows.get('alice').find((row) => row.id === flightId).state.bpm, 157, 'an older in-flight acknowledgment does not clear the newer edit');
  const secondPage = newClient(server);
  await secondPage.refresh();
  assert.equal((await server('alice', null, flightId)).state.bpm, 157, 'the edit survives a reload before the debounce timer fires');

  const checking = deferred(), slowId = 'local-slow-first-save';
  const slow = newClient(server, () => checking.promise);
  const firstSave = slow.saveGenerated(draft, slowId);
  slow.update('', slowId, { ...draft.state, bpm: 158 });
  assert.equal(rows.get('').find((row) => row.id === slowId).state.bpm, 158, 'edits stage synchronously before account lookup finishes');
  checking.resolve(account);
  await firstSave;
  assert.equal((await server('alice', null, slowId)).state.bpm, 158, 'first upload contains the latest edit');

  let online = true;
  const imported = { ...draft, id: 'local-imported-song', revision: undefined };
  const importer = newClient((...args) => {
    if (!online) throw new Error('offline');
    return server(...args);
  }, undefined, () => [imported]);
  await importer.refresh();
  assert.equal((await server('alice', null, imported.id)).state.bpm, draft.state.bpm);
  online = false;
  assert.equal((await importer.load(imported.id)).state.bpm, draft.state.bpm, 'an imported song opens offline without a cloud cache');

  const sharedId = 'local-competing-devices';
  const deviceA = newClient(server);
  await deviceA.saveGenerated(draft, sharedId);
  const before = await deviceA.load(sharedId);
  await server('alice', { ...draft, id: sharedId, baseRevision: before.updatedAt,
    revision: before.updatedAt + 1, state: { ...before.state, bpm: 160 } });
  const fresh = await deviceA.load(sharedId);
  assert.equal(fresh.state.bpm, 160, 'online load fetches changes made after the last Library list refresh');
  await server('alice', { ...draft, id: sharedId, baseRevision: fresh.updatedAt,
    revision: fresh.updatedAt + 1, state: { ...fresh.state, bpm: 161 } });
  const changed = { ...fresh.state, master: { ...fresh.state.master, volume: 0.375 } };
  deviceA.update('alice', sharedId, changed, fresh.updatedAt, fresh.state);
  await deviceA.refresh();
  const merged = (await server('alice', null, sharedId)).state;
  assert.equal(merged.bpm, 161, 'rebasing the local edit preserves another device’s BPM change');
  assert.equal(merged.master.volume, 0.375, 'the local edit is reapplied after the conflict');

  rows.set('alice', Array.from({ length: 30 }, (_, i) => ({ ...draft, id: `local-new-${i}` })));
  const offlinePage = newClient(() => assert.fail('offline edits must not make a request'));
  const capped = offlinePage.update('alice', sharedId, { ...merged, bpm: 162 }, fresh.updatedAt + 1, merged);
  assert.equal(capped.kept, true, 'an existing Library song can be edited when the new-song queue is full');
  offlinePage.update('alice', sharedId, { ...merged, bpm: 163 }, capped.revision, merged);
  const existing = rows.get('alice').filter((row) => row.id === sharedId);
  assert.equal(rows.get('alice').length, 31);
  assert.deepEqual(existing.map((row) => row.state.bpm), [163]);
}
const oversizedSong = createCloudLibrary({
  get: async () => ({ account: { id: 'alice' } }), subscribe: () => {}, device: () => [],
  read: () => [], write: () => true,
  request: async (owner, body) => {
    assert.equal(body, undefined, 'an oversize project must not trigger an upload');
    return { items: [], removed: [], limit: LIBRARY_LIMIT };
  },
});
const tooBig = await oversizedSong.saveGenerated({ ...draft, state: { ...draft.state, extra: 'ü'.repeat(100_000) } });
assert.equal(tooBig.message, 'This song is too large to sync (200 KB limit). It stays on this device.');
const previousFetch = globalThis.fetch, previousListener = globalThis.addEventListener;
const previousStorage = globalThis.localStorage;
try {
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => store.get(key), setItem: (key, value) => store.set(key, value) } });
  const libraryRef = { id: 'local-studio-song', owner: 'alice', updatedAt: 100 };
  save({ ...draft.state, libraryRef });
  assert.deepEqual(load(true).libraryRef, libraryRef, 'Studio reload preserves the Library identity');
  assert.equal(load().libraryRef, undefined, 'Library ownership is not part of the playable or exported project');
  save(draft.state);
  assert.equal(load(true).libraryRef, undefined, 'an unrelated project clears the saved identity');
} finally {
  if (previousStorage === undefined) delete globalThis.localStorage;
  else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
}
try {
  let notifyStorage, resolveAccount;
  globalThis.addEventListener = (name, fn) => { if (name === 'storage') notifyStorage = fn; };
  globalThis.fetch = async () => Response.json({ enabled: true, account: { id: 'alice' } });
  const { getAccount, onAccount } = await import('../js/account.js?cross-tab');
  const otherTab = createCloudLibrary({ get: getAccount, subscribe: onAccount, device: () => [],
    request: async () => ({ items: [first.json.item], removed: [], limit: LIBRARY_LIMIT }) });
  await otherTab.refresh();
  assert.equal(otherTab.recent()[0].id, draft.id);
  globalThis.fetch = () => new Promise((resolve) => { resolveAccount = resolve; });
  const stale = getAccount(true);
  notifyStorage({ key: 'untergrund.account.signed-out', newValue: 'signed-out' });
  assert.deepEqual(otherTab.recent(), [], 'another tab signing out immediately clears private recents');
  resolveAccount(Response.json({ enabled: true, account: { id: 'alice' } }));
  assert.equal((await stale).account, null, 'a late response cannot restore the signed-out account');
  assert.deepEqual(otherTab.recent(), []);
} finally {
  globalThis.fetch = previousFetch;
  if (previousListener === undefined) delete globalThis.addEventListener;
  else globalThis.addEventListener = previousListener;
}
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
    body: JSON.stringify({ ...draft, padding: 'x'.repeat(20000) }),
  });
  assert.equal(saved.status, 200, await saved.text());
  const state = await fetch(base + '/api/account?library=alice&id=' + draft.id, { headers: { Cookie: alice } });
  assert.equal(state.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await state.json()).state, sanitize(draft.state));
  const oversized = await fetch(base + '/api/account?library=alice', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: alice },
    body: JSON.stringify({ ...draft, padding: 'x'.repeat(LIBRARY_BODY_BYTES) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, 'too_large');
  assert.equal((await fetch(base + '/' + path.relative(root, file))).status, 404, 'private account file is not a static asset');
  assert.equal((await fetch(base + '/api/tracks?id=' + draft.id)).status, 404, 'no copy in the public crate');
} finally {
  output.close();
  proc.kill();
  await exited;
  await rm(directory, { recursive: true, force: true });
}
console.log('cloud Library HTTP passed: playable private state, no cache, no static account file and no public copy');
