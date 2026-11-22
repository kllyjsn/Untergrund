import { publishedTrack } from './accounts.js';
import { validToken } from './events.js';
import { memoryKv } from './kv.js';
import { STYLES } from '../../js/state.js';
import { RELEASE_ID, MAX_PLAY_SECONDS, PLAYBACK_SURFACES, PLAYBACK_OUTCOMES } from '../../js/playback-analytics.js';

export const MAX_PLAYBACK_BODY = 512;
const NS = 'untergrund:{playback}:', DAY_MS = 864e5, PLAY_TTL = 12 * 3600, REPORT_TTL = 91 * 86400;
const TIME_BIN = 5, PROGRESS_BIN = 10, PER_MINUTE = 1500;
const day = (t) => new Date(t).toISOString().slice(0, 10);
const dayKey = (date) => NS + 'day:' + date;
const validGenre = (id) => typeof id === 'string' && Object.hasOwn(STYLES, id);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const json = (status, data) => ({ status, json: data });

// A checkpoint replaces that play's old contribution. CAS keeps reorders, retries and simultaneous unloads from double-counting.
const REPLACE = `if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
for i = 5, #ARGV, 2 do
  if redis.call('HINCRBY', KEYS[2], ARGV[i], ARGV[i+1]) == 0 then redis.call('HDEL', KEYS[2], ARGV[i]) end
end
redis.call('EXPIRE', KEYS[2], ARGV[4])
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1`;
export const memoryPlaybackKv = () => memoryKv({ scripts: { [REPLACE]: (call, [key, report], [expected, next, ttl, reportTtl, ...changes]) => {
  if ((call('GET', key) || '') !== expected) return 0;
  for (let i = 0; i < changes.length; i += 2) {
    if (!call('HINCRBY', report, changes[i], changes[i + 1])) call('HDEL', report, changes[i]);
  }
  call('EXPIRE', report, reportTtl);
  call('SET', key, next, 'EX', ttl);
  return 1;
} } });

function parse(raw) {
  let b;
  try { b = JSON.parse(raw); } catch { return null; }
  if (!b || typeof b !== 'object' || !PLAYBACK_SURFACES.includes(b.surface) ||
    typeof b.playId !== 'string' || !UUID.test(b.playId) || !int(b.seq, 1, 1500) ||
    !int(b.elapsed, 0, MAX_PLAY_SECONDS) || !PLAYBACK_OUTCOMES.includes(b.outcome) ||
    (b.progress !== null && !int(b.progress, 0, 100)) || (b.outcome === 'complete' && b.progress !== 100)) return null;
  const { playId, seq, elapsed, progress, outcome, surface, trackId, genre } = b;
  if (trackId !== undefined ? (typeof trackId !== 'string' || !RELEASE_ID.test(trackId) || genre !== undefined) : !validGenre(genre)) return null;
  return { playId, seq, elapsed, progress, outcome, surface, trackId: trackId || '', genre };
}

function fields(p) {
  if (!p) return [];
  const dim = `${p.genre}:${p.trackId}:${p.surface}:`;
  const keys = ['starts', p.outcome, 'time:' + TIME_BIN * Math.floor(p.elapsed / TIME_BIN)];
  if (p.furthest !== null) keys.push('progress:' + p.furthest);
  if (p.progress !== null && ['skip', 'stop'].includes(p.outcome)) keys.push(p.outcome + 'At:' + p.progress);
  return keys.map((k) => dim + k);
}

async function store(p, { kv, accountKv, crate, now }) {
  const key = NS + 'play:' + p.playId, rate = NS + 'minute:' + Math.floor(now / 60000);
  const results = await kv.pipe([['INCR', rate], ['EXPIRE', rate, 120], ['GET', key]]);
  if (results.some((r) => r instanceof Error)) throw new Error('playback storage unavailable');
  if (+results[0] > PER_MINUTE) return json(429, { error: 'rate_limited' });
  let raw = results[2], genre = p.genre;
  if (!raw && p.trackId) {
    const track = await publishedTrack(accountKv, crate, p.trackId);
    if (!track) return json(404, { error: 'release_not_found' });
    genre = validGenre(track.style) ? track.style : 'hypnotic';
  }
  for (let i = 0; i < 4; i++) {
    const prev = raw && JSON.parse(raw);
    if (prev && (p.surface !== prev.surface || p.trackId !== prev.trackId || (!p.trackId && p.genre !== prev.genre))) return json(409, { error: 'play_source_changed' });
    if (prev && (prev.outcome !== 'playing' || p.seq <= prev.seq || p.elapsed < prev.elapsed)) return json(202, { ok: true });
    const progress = p.progress === null ? null : PROGRESS_BIN * Math.floor(p.progress / PROGRESS_BIN);
    const furthest = prev?.furthest == null ? progress : Math.max(prev.furthest, progress ?? 0);
    const next = { day: prev?.day || day(now), expires: prev?.expires || now + PLAY_TTL * 1000,
      trackId: p.trackId, genre: prev?.genre || genre, surface: p.surface, seq: p.seq, elapsed: p.elapsed, outcome: p.outcome, progress, furthest };
    const oldFields = new Set(fields(prev)), newFields = new Set(fields(next));
    const deltas = [...[...oldFields].filter((f) => !newFields.has(f)).flatMap((f) => [f, -1]),
      ...[...newFields].filter((f) => !oldFields.has(f)).flatMap((f) => [f, 1])];
    const ttl = Math.max(1, Math.ceil((next.expires - now) / 1000));
    if (+await kv.cmd(['EVAL', REPLACE, 2, key, dayKey(next.day), raw || '', JSON.stringify(next), ttl, REPORT_TTL, ...deltas])) return json(202, { ok: true });
    raw = await kv.cmd(['GET', key]);
    if (!raw) break;
  }
  return json(503, { error: 'try_again' });
}

const count = (m, k) => m.get(k) || 0;
const add = (m, k, n) => m.set(k, count(m, k) + n);
const bins = (m, name) => [...m].filter(([k]) => k.startsWith(name + ':')).map(([k, n]) => [+k.split(':')[1], n]);
function median(entries) {
  const size = entries.reduce((n, [, count]) => n + count, 0);
  if (!size) return null;
  const low = Math.ceil(size / 2), high = Math.floor(size / 2) + 1;
  let n = 0, lower;
  for (const [value, count] of entries.sort(([a], [b]) => a - b)) {
    n += count;
    if (n >= low && lower === undefined) lower = value;
    if (n >= high) return (lower + value) / 2;
  }
}
const topPoints = (m, name) => bins(m, name).sort(([a, x], [b, y]) => y - x || a - b).slice(0, 3)
  .map(([fromPercent, count]) => ({ fromPercent, toPercent: Math.min(100, fromPercent + PROGRESS_BIN), count }));
const metrics = (m) => ({
  starts: count(m, 'starts'), completed: count(m, 'complete'), skipped: count(m, 'skip'), stopped: count(m, 'stop'), unfinished: count(m, 'playing'),
  completionRate: count(m, 'complete') / count(m, 'starts'),
  medianListenSeconds: median(bins(m, 'time')), medianProgressPercent: median(bins(m, 'progress')),
  topSkipPoints: topPoints(m, 'skipAt'), topStopPoints: topPoints(m, 'stopAt'),
});
const ranked = (a, b) => b.starts - a.starts;

async function report(kv, now, days, surface) {
  const dates = Array.from({ length: days }, (_, i) => day(now - i * DAY_MS));
  const genres = new Map();
  for (let at = 0; at < dates.length; at += 7) {
    const rows = await kv.pipe(dates.slice(at, at + 7).map((date) => ['HGETALL', dayKey(date)]));
    for (const row of rows) {
      if (!Array.isArray(row)) throw new Error('playback report unavailable');
      for (let i = 0; i < row.length; i += 2) {
        const [genre, trackId, s, ...rest] = row[i].split(':'), n = +row[i + 1];
        if (surface && surface !== s) continue;
        const type = rest.join(':');
        if (!genres.has(genre)) genres.set(genre, { totals: new Map(), songs: new Map() });
        const { totals, songs } = genres.get(genre);
        add(totals, type, n);
        if (trackId) {
          if (!songs.has(trackId)) songs.set(trackId, new Map());
          add(songs.get(trackId), type, n);
        }
      }
    }
  }
  return { days, from: dates.at(-1), through: dates[0], surface: surface || 'all',
    genres: [...genres].map(([genre, { totals, songs }]) => ({ genre, label: STYLES[genre]?.name || genre, ...metrics(totals),
      songs: [...songs].map(([trackId, counts]) => ({ trackId, ...metrics(counts) })).sort(ranked) })).sort(ranked) };
}

export async function handlePlayback({ method, query = {}, headers = {}, body, kv, accountKv = kv, crate,
  statsToken = '', now = Date.now() }) {
  if (method === 'GET') {
    if (!statsToken) return json(404, { error: 'stats_disabled' });
    const given = String(headers['x-stats-token'] || String(headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!validToken(given, statsToken)) return json(401, { error: 'unauthorized' });
    if (!kv) return json(503, { enabled: false, error: 'storage_unavailable' });
    if (query.surface && !PLAYBACK_SURFACES.includes(query.surface)) return json(400, { error: 'invalid_surface' });
    const days = Math.max(1, Math.min(90, Math.round(+query.days || 30)));
    return json(200, await report(kv, now, days, query.surface));
  }
  if (method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (headers.dnt === '1' || headers['sec-gpc'] === '1') return json(202, { ok: true });
  if (headers['sec-fetch-site'] && headers['sec-fetch-site'] !== 'same-origin') return json(403, { error: 'cross_origin' });
  if (!/^application\/json(?:\s*;|$)/i.test(headers['content-type'] || '')) return json(415, { error: 'expected_json' });
  if (!kv) return json(202, { ok: true, enabled: false });
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  if (Buffer.byteLength(raw) > MAX_PLAYBACK_BODY) return json(413, { error: 'too_large' });
  const p = parse(raw);
  if (!p) return json(400, { error: 'invalid_playback' });
  return store(p, { kv, accountKv, crate, now });
}
