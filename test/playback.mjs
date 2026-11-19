import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import eventsHandler from '../api/events.js';
import { normalizeTrack, redisStore } from '../api/_lib/crate.js';
import { memoryPlaybackKv } from '../api/_lib/playback.js';
import { normalizeSet } from '../api/_lib/rooms.js';
import { RoomBus } from '../js/club.js';
import { createPlaybackAnalytics } from '../js/playback-analytics.js';
import { respKv, startUpstash } from './fake-upstash.mjs';

const token = 'test-stats-token';
const track = normalizeTrack({ state: { patterns: [], bpm: 130 }, style: 'acid', title: 'Release' });
const roomSet = normalizeSet({ state: track.state, trackId: track.id, style: 'acid' });
assert.equal(roomSet.trackId, track.id, 'a broadcast preserves the published song on deck');
assert.equal(normalizeSet({ state: track.state, trackId: '../other' }).trackId, undefined);
assert.equal(normalizeSet({ state: track.state, trackId: track.id, replay: { id: 'set-recording' } }).trackId, undefined);

const publicSet = { ...roomSet, broadcastId: 'same-broadcast', version: 1, public: true };
const bus = Object.assign(Object.create(RoomBus.prototype), {
  onEvent: () => assert.fail('a privacy update must not restart playback'),
  currentSet: publicSet, currentSetKey: 'server:1', appliedBroadcasts: new Set(['same-broadcast']), initiatedSets: new Set(),
});
const visibility = [];
bus.onPlaybackUnavailable = (set) => visibility.push(set.public);
bus.applySet({ ...publicSet, public: false, version: 2 }, 'dj', true);
assert.deepEqual(visibility, [false], 'privacy updates bypass playback rejoin deduplication');

async function scenario(label, kv) {
  const upstash = await startUpstash(kv);
  const original = Object.fromEntries([...Object.keys(upstash.env), 'STATS_TOKEN'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, upstash.env, { STATS_TOKEN: token });
  const request = async (method, body, headers, query = {}) => {
    const reply = { headers: {} };
    await eventsHandler({ method, query: { playback: '1', ...query }, body, headers }, {
      setHeader: (name, value) => { reply.headers[name] = value; },
      status: (status) => { reply.status = status; return { json: (value) => { reply.body = value; } }; },
    });
    assert.equal(reply.headers['Cache-Control'], 'no-store');
    return reply;
  };
  const post = (body, headers = {}) => request('POST', body, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers });
  const report = (query) => request('GET', null, { authorization: 'Bearer ' + token }, query);
  const play = (fields = {}) => ({ playId: randomUUID(), seq: 1, surface: 'public', trackId: track.id, elapsed: 0, progress: 0, outcome: 'playing', ...fields });
  try {
    await redisStore().add(track);
    assert.equal((await request('GET', null, {}, { token })).status, 401, 'report requires a header, not a token in the URL');
    assert.equal((await post(play({ trackId: 'does-not-exist' }))).status, 404);
    assert.equal((await post(play({ genre: 'techno' }))).status, 400, 'the caller cannot supply a genre for a release');
    assert.equal((await post(play({ elapsed: -1 }))).status, 400);
    assert.equal((await post(play({ progress: 105 }))).status, 400);
    assert.equal((await post(play({ progress: 55, outcome: 'complete' }))).status, 400);
    assert.equal((await post(play({ surface: 'private' }))).status, 400);
    assert.equal((await post(play({ bogus: 'x'.repeat(512) }))).status, 413);
    assert.equal((await post(play(), { 'sec-fetch-site': 'cross-site' })).status, 403);
    await post(play(), { 'sec-gpc': '1' });
    await post(play(), { dnt: '1' });
    assert.deepEqual((await report({ days: 7 })).body.genres, []);

    const sent = [];
    const handlers = new Map();
    let tick;
    const win = {
      navigator: {}, crypto: { randomUUID },
      setInterval: (fn) => { tick = fn; }, clearInterval: () => { tick = null; },
      addEventListener: (name, fn) => handlers.set(name, fn),
      fetch: async (url, r) => {
        assert.equal(url, '/api/events?playback=1');
        assert.equal(r.keepalive, true);
        assert.equal(r.credentials, 'omit');
        assert.equal(r.referrerPolicy, 'no-referrer');
        sent.push(JSON.parse(r.body));
      },
    };
    const player = createPlaybackAnalytics(win), ctx = { currentTime: 3 };
    const time = (seconds) => { ctx.currentTime = seconds; tick?.(); };
    const clock = { ctx, at: 4, from: 0, expectedSeconds: 40, progress: () => (ctx.currentTime - 4) / 40 };
    player.start({ surface: 'public', trackId: track.id }, clock);
    player.end();
    assert.equal(sent.length, 0, 'a cancelled preload or count-in is not a start');
    player.start({ surface: 'public', trackId: track.id, roomId: 'never-sent', deviceId: 'never-sent' }, clock);
    time(5); time(10); time(21);
    assert.deepEqual(sent.map((s) => s.outcome), ['playing', 'playing']);
    time(44.1);
    assert.deepEqual(sent.map((s) => s.outcome), ['playing', 'playing', 'complete']);
    const [start, checkpoint, complete] = sent;
    assert.deepEqual(Object.keys(start).sort(), ['elapsed', 'outcome', 'playId', 'progress', 'seq', 'surface', 'trackId']);

    // Exercise checkpoint replacement, concurrent duplicate sends, and a terminal event arriving first.
    const statuses = await Promise.all([post(start), post(start), post(checkpoint), post(checkpoint)]);
    assert(statuses.every((r) => r.status === 202));
    assert.equal((await report()).body.genres[0].unfinished, 1);
    assert.equal((await post({ ...checkpoint, seq: 3, surface: 'club' })).status, 409);
    await post(complete); await post(checkpoint);
    const embed = play({ surface: 'embed' });
    await post({ ...embed, seq: 2, elapsed: 10, progress: 23, outcome: 'skip', deviceId: 'never-stored' });
    await post(embed);

    // A public Club listener who joins late and hears the finale doesn't complete the whole song.
    const n = sent.length;
    player.start({ surface: 'club', trackId: roomSet.trackId }, { ...clock, at: 50, from: 0.65, progress: () => 0.65 + (ctx.currentTime - 50) / 40 });
    time(51); time(65);
    player.end('complete');
    assert.deepEqual(sent.slice(n).map((s) => s.outcome), ['playing', 'stop']);
    for (const sample of sent.slice(n)) assert.equal((await post(sample)).status, 202);
    const loose = play({ trackId: undefined, genre: 'acid', surface: 'club', progress: null, elapsed: 31, outcome: 'stop' });
    await post(loose);

    player.start({ surface: 'club', genre: 'acid' }, { ...clock, at: 65 });
    time(66);
    const beforePrivacyChange = sent.length;
    player.cancel();
    time(85);
    player.end();
    assert.equal(sent.length, beforePrivacyChange, 'privacy changes suppress even the final checkpoint');

    const beforeLoop = sent.length;
    player.start({ surface: 'embed', trackId: track.id }, { ctx, at: 90, from: null, progress: () => null });
    time(91); time(120); time(180);
    player.end();
    assert.deepEqual(sent.slice(beforeLoop).map((s) => s.outcome), ['playing', 'playing', 'playing', 'stop']);
    assert(sent.slice(beforeLoop).every((s) => s.progress === null), 'an open-ended loop has no finish line');

    // Page exit flushes a final snapshot, and opted-out browsers don't send even on exit.
    player.start({ surface: 'embed', genre: 'acid' }, { ...clock, at: 181 });
    time(182); handlers.get('pagehide')();
    assert.equal(sent.at(-1).outcome, 'stop');
    assert.notEqual(sent.at(-1).playId, start.playId);
    const sentBefore = sent.length;
    win.navigator.globalPrivacyControl = true;
    player.start({ surface: 'embed', genre: 'acid' }, clock);
    time(200); handlers.get('pagehide')();
    assert.equal(sent.length, sentBefore);

    const { body } = await report({ days: '7' });
    const [acid] = body.genres;
    assert.equal(body.days, 7);
    assert.equal(acid.genre, 'acid');
    assert.equal(acid.starts, 4);
    assert.equal(acid.completionRate, 1 / 4);
    assert.equal(acid.medianListenSeconds, 22.5);
    assert.deepEqual(acid.topSkipPoints, [{ fromPercent: 20, toPercent: 30, count: 1 }]);
    assert.deepEqual(acid.topStopPoints, [{ fromPercent: 100, toPercent: 100, count: 1 }]);
    assert.equal(acid.songs[0].starts, 3);
    assert.equal(acid.songs[0].trackId, track.id);
    assert.equal((await report({ surface: 'club' })).body.genres[0].starts, 2);
    assert.equal((await report({ surface: 'private' })).status, 400);
    const persisted = JSON.stringify((await kv.cmd(['GET', 'untergrund:{playback}:play:' + embed.playId])));
    assert(!persisted.includes('never-stored'));
    assert(!JSON.stringify(body).includes(start.playId));
    const minute = Math.floor(Date.now() / 60000);
    for (const n of [minute, minute + 1]) await kv.cmd(['SET', 'untergrund:{playback}:minute:' + n, '1500']);
    assert.equal((await post(play())).status, 429);
    delete process.env.STATS_TOKEN;
    const disabled = await report();
    assert.equal(disabled.status, 404);
    assert.deepEqual(disabled.body, { error: 'stats_disabled' });
    console.log(`playback lifecycle and report passed (${label})`);
  } finally {
    upstash.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

await scenario('in-memory', memoryPlaybackKv());
if (spawnSync('redis-server', ['--version']).status === 0) {
  const port = 6900 + Math.floor(Math.random() * 400);
  const child = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  let redis;
  try {
    for (let i = 0; i < 50; i++) {
      try { redis = respKv(port); await redis.ready; break; } catch { redis = null; await wait(100); }
    }
    assert(redis, 'redis-server started');
    await scenario('real Redis / Upstash REST', redis);
  } finally { redis?.close(); child.kill(); }
} else if (process.env.CI) {
  throw new Error('redis-server is required in CI');
}
