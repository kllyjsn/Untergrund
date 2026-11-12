import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { defaultState, clone } from '../js/state.js';
import { PART_IDS, PARTS, extractPart, applyPart, normalizeLayer, jamStep, stepWall, emptyJam, reconcileJam, jamAction, partIdea, jammable } from '../js/jam.js';

// ---- pure rules ----
const song = defaultState();
const set = (over = {}) => ({ state: song, bpm: 120, startsAt: 1_000_000, version: 1, broadcastId: 'b1', ...over });

// Parts split the song cleanly: every track belongs to at most one part, and a part's layer only touches its tracks.
const owned = PART_IDS.flatMap((p) => PARTS[p].tracks);
assert.equal(new Set(owned).size, owned.length);
for (const part of PART_IDS) {
  const idea = normalizeLayer(part, partIdea(song, 'hypnotic', part, 'new', 42));
  assert.deepEqual(Object.keys(idea.params).sort(), [...PARTS[part].tracks].sort());
  const out = applyPart(clone(song), part, idea);
  assert.deepEqual(extractPart(out, part), idea, `${part} round-trips`);
  for (const other of PART_IDS.filter((p) => p !== part)) assert.deepEqual(extractPart(out, other), extractPart(song, other), `${part} leaves ${other} alone`);
  assert.deepEqual(out.patterns.map((p) => p.steps.vox), song.patterns.map((p) => p.steps.vox));
}
const drop = partIdea(song, 'hypnotic', 'drums', 'drop');
assert.ok(PARTS.drums.tracks.every((id) => drop.mutes[id]));
assert.ok(PARTS.drums.tracks.every((id) => !partIdea(applyPart(clone(song), 'drums', drop), 'hypnotic', 'drums', 'drop').mutes[id]), 'DROP toggles back in');

// Layers are rebuilt from native state only: foreign tracks, audio URLs and junk are dropped.
const dirty = { patterns: [{ steps: { kick: [1, 0, 0, 0], acid: [{ on: true, n: 3 }] }, len: { kick: 4 }, audio: 'https://example.com/a.mp3' }], params: { kick: { level: 99 }, acid: { url: 'x' } }, sample: 'data:audio/wav;base64,AAAA' };
const clean = normalizeLayer('drums', dirty);
assert.deepEqual(Object.keys(clean.patterns[0].steps).sort(), [...PARTS.drums.tracks].sort());
assert.equal(clean.patterns.length, 8);
assert.ok(!JSON.stringify(clean).includes('http') && !JSON.stringify(clean).includes('data:'));
assert.ok(clean.params.kick.level <= 1.2, "params are clamped");
assert.equal(normalizeLayer('vocals', dirty), null);
assert.equal(normalizeLayer('bass', { patterns: 'nope' }), null);
assert.equal(normalizeLayer('bass', { patterns: [{ steps: { acid: 'x'.repeat(70000) } }] }), null, 'oversized layers are refused');

// Changes land on a downbeat at least the lead away, on the phrase when that is close.
const s = set();
const stepMs = 125; // 120 BPM sixteenths
for (const at of [0, 30, 33, 47, 200, 511]) {
  const now = s.startsAt + at * stepMs + 7;
  const step = jamStep(s, now);
  assert.equal(step % 16, 0, 'lands on a bar');
  assert.ok(stepWall(s, step) - now >= 1500, 'leaves time for every client to hear about it');
  assert.ok(stepWall(s, step) - now <= 1500 + 3000 + 16 * stepMs, 'never waits long');
}
assert.equal(jamStep(s, s.startsAt + 50 * stepMs), 64, 'phrase (bar 5) when close');
assert.equal(jamStep(s, s.startsAt + 2 * stepMs), 16, 'next bar when the phrase is far away');
assert.equal(jamStep(s, s.startsAt + 8 * stepMs), 32, 'skips a bar that is too close to reach everyone');
assert.equal(jamStep(set({ startsAt: 1_004_000 }), 1_000_000), 0, 'before the set starts, a change is there from bar 1');
assert.equal(stepWall(s, 64), s.startsAt + 64 * stepMs);

// Claim / release / play / host lock.
const ctx = (clientId, now = s.startsAt + 100 * stepMs) => ({ clientId, hostId: 'host', set: s, now });
const jam = emptyJam(1);
assert.equal(jamAction(jam, { ...ctx('ana'), set: null }, { action: 'claim', part: 'drums' }).error, 'not_live');
assert.equal(jamAction(jam, { ...ctx('ana'), set: set({ replay: { id: 'r' } }) }, { action: 'claim', part: 'drums' }).error, 'not_jammable');
assert.equal(jammable(set({ state: { ...song, patterns: [{ score: {} }] } })), false);
assert.equal(jamAction(jam, ctx('ana'), { action: 'claim', part: 'vocals' }).error, 'invalid_part');
assert.equal(jamAction(jam, ctx('ana'), { action: 'boo', part: 'drums' }).error, 'invalid_action');
assert.deepEqual(jamAction(jam, ctx('ana'), { action: 'claim', part: 'drums' }).payload, { action: 'claim', part: 'drums', owner: 'ana', step: 0 });
assert.equal(jamAction(jam, ctx('ben'), { action: 'claim', part: 'drums' }).status, 409, 'one player per part');
assert.equal(jamAction(jam, ctx('ben'), { action: 'claim', part: 'bass' }).payload.owner, 'ben');
jamAction(jam, ctx('ben'), { action: 'claim', part: 'lead' });
assert.equal(jam.parts.bass.owner, null, 'one part per player: switching frees the old one');
assert.equal(jam.parts.lead.owner, 'ben');
const layer = partIdea(song, 'hypnotic', 'drums', 'new', 9);
assert.equal(jamAction(jam, ctx('ben'), { action: 'play', part: 'drums', layer }).status, 403, 'only the owner plays a part');
let r = jamAction(jam, ctx('ana'), { action: 'play', part: 'drums', layer, step: 128 });
assert.deepEqual(r.payload, { action: 'play', part: 'drums', owner: 'ana', step: 128 });
assert.deepEqual(jam.parts.drums.layer, normalizeLayer('drums', layer));
assert.equal(jam.parts.drums.rev, jam.rev);
r = jamAction(jam, ctx('ana'), { action: 'play', part: 'drums', layer, step: 3 });
assert.equal(r.payload.step, 112, 'a late change still lands on a bar the room has not played yet');
assert.equal(jamAction(jam, ctx('ana'), { action: 'play', part: 'drums', layer, step: 117 }).payload.step, 128, 'requested steps snap to a bar');
assert.equal(jamAction(jam, ctx('ana'), { action: 'play', part: 'drums', layer: { nope: 1 } }).error, 'invalid_layer');
assert.equal(jamAction(jam, ctx('ana'), { action: 'release', part: 'lead' }).status, 403);
assert.equal(jamAction(jam, ctx('ana'), { action: 'lock' }).status, 403, 'only the host locks the band');
assert.deepEqual(jamAction(jam, ctx('host'), { action: 'lock' }).payload, { action: 'lock', open: false });
assert.ok(PART_IDS.every((p) => !jam.parts[p].owner), 'locking frees every part');
assert.ok(jam.parts.drums.layer, 'but what was played keeps playing');
assert.equal(jamAction(jam, ctx('ana'), { action: 'claim', part: 'drums' }).status, 423);
assert.equal(jamAction(jam, ctx('host'), { action: 'claim', part: 'drums' }).payload.owner, 'host', 'the host can still play');
jamAction(jam, ctx('host'), { action: 'open' });
jamAction(jam, ctx('ana'), { action: 'claim', part: 'bass' });
assert.equal(jamAction(jam, ctx('host'), { action: 'release', part: 'bass' }).payload.owner, null, 'the host can free any part');

// Leavers free their part; a new set clears the layers (it already carries the room mix) but keeps the band.
jamAction(jam, ctx('ana'), { action: 'claim', part: 'bass' });
reconcileJam(jam, { setVersion: 1, members: new Map([['host', {}]]) });
assert.equal(jam.parts.bass.owner, null);
assert.equal(jam.parts.drums.owner, 'host');
reconcileJam(jam, { setVersion: 2, members: new Map([['host', {}]]) });
assert.equal(jam.parts.drums.owner, 'host');
assert.ok(PART_IDS.every((p) => !jam.parts[p].layer));
assert.equal(reconcileJam(null, { setVersion: 3 }).setVersion, 3);

// ---- room service protocol ----
const port = 8740 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('jam test server did not start')), 5000);
  server.stdout.on('data', (chunk) => { if (chunk.toString().includes('UNTERGRUND on')) { clearTimeout(timer); resolve(); } });
});
const base = `http://localhost:${port}/api/rooms/jam-room`;
const tokens = {};
const post = async (clientId, type, payload = {}, extra = {}) => {
  const response = await fetch(`${base}/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: `${clientId}-${type}-${Math.random()}`, type, clientId, clientSecret: createHash('sha256').update(clientId).digest('hex'), token: tokens[clientId] || '', user: { name: clientId.toUpperCase() }, payload, ...extra }),
  });
  const json = await response.json();
  if (json.sessionToken) tokens[clientId] = json.sessionToken;
  return { status: response.status, json };
};

try {
  await ready;
  for (const id of ['host', 'ana', 'ben']) await post(id, 'presence');
  let res = await post('ana', 'jam', { action: 'claim', part: 'drums' });
  assert.equal(res.status, 409);
  assert.equal(res.json.error, 'not_live');
  assert.ok(res.json.jam, 'a refused move still returns the room state to resync from');

  res = await post('host', 'set', { title: 'Jam', state: song, startsAt: Date.now() - 4000 });
  assert.equal(res.status, 200);
  const version = res.json.currentSet.version;
  assert.equal(res.json.jam.setVersion, version);

  res = await post('ana', 'jam', { action: 'claim', part: 'drums' });
  assert.equal(res.status, 200);
  assert.equal(res.json.jam.parts.drums.owner, 'ana');
  assert.equal((await post('ben', 'jam', { action: 'claim', part: 'drums' })).json.error, 'part_taken');
  assert.equal((await post('ben', 'jam', { action: 'claim', part: 'bass' })).json.jam.parts.bass.owner, 'ben');

  const bass = partIdea(song, 'hypnotic', 'bass', 'new', 5);
  res = await post('ben', 'jam', { action: 'play', part: 'bass', layer: { ...bass, url: 'https://example.com/x.mp3' } });
  assert.equal(res.status, 200);
  const slot = res.json.jam.parts.bass;
  assert.deepEqual(slot.layer, normalizeLayer('bass', bass));
  assert.ok(!JSON.stringify(res.json.jam).includes('example.com'));
  assert.equal(slot.step % 16, 0);
  assert.ok(stepWall(res.json.currentSet, slot.step) > Date.now(), 'lands on a bar still to come');
  const ev = res.json.events.find((e) => e.type === 'jam' && e.payload.action === 'play');
  assert.deepEqual(ev.payload, { action: 'play', part: 'bass', owner: 'ben', step: slot.step });
  assert.ok(!('layer' in ev.payload), 'the event log stays small: layers live in the room state');
  assert.equal((await post('ana', 'jam', { action: 'play', part: 'bass', layer: bass })).status, 403);

  // A late joiner (or a reload) gets owners and layers from a plain GET.
  const late = await (await fetch(`${base}?since=0`)).json();
  assert.equal(late.jam.parts.drums.owner, 'ana');
  assert.deepEqual(late.jam.parts.bass.layer, slot.layer);
  assert.equal(late.jam.parts.bass.step, slot.step);

  assert.equal((await post('ana', 'jam', { action: 'lock' })).status, 403);
  res = await post('host', 'jam', { action: 'lock' });
  assert.equal(res.json.jam.open, false);
  assert.equal((await post('ana', 'jam', { action: 'claim', part: 'lead' })).status, 423);
  await post('host', 'jam', { action: 'open' });
  assert.equal((await post('ana', 'jam', { action: 'claim', part: 'lead' })).json.jam.parts.lead.owner, 'ana');

  // A rebroadcast starts a fresh song: layers clear, the band stays.
  res = await post('host', 'set', { title: 'Jam 2', state: song, startsAt: Date.now() });
  assert.ok(res.json.currentSet.version > version);
  assert.equal(res.json.jam.parts.lead.owner, 'ana');
  assert.ok(PART_IDS.every((p) => !res.json.jam.parts[p].layer));

  // Replays play as written.
  res = await post('host', 'set', { title: 'Replay', state: song, startsAt: Date.now(), replay: { id: 'abc', title: 'Old set' } });
  assert.equal((await post('ana', 'jam', { action: 'play', part: 'lead', layer: partIdea(song, 'hypnotic', 'lead', 'vary') })).json.error, 'not_jammable');
} finally {
  server.kill();
}
console.log('jam: parts, timing, claim/release, host lock and room protocol ok');
