import { STYLES, refreshSong, sanitize } from '../../js/state.js';
import { songFingerprint } from '../../js/listen.js';
import { clean, MAX_TRACK_BYTES } from './crate.js';

export const LIBRARY_LIMIT = 100;
export const LIBRARY_BODY_BYTES = MAX_TRACK_BYTES;
const REMOVED_LIMIT = 500;
const trackId = /^[a-z0-9-]{3,64}$/;
const edit = `
local id, action = ARGV[1], ARGV[2]
if action == 'delete' then
  redis.call('HDEL', KEYS[1], id)
  redis.call('HDEL', KEYS[2], id)
  redis.call('ZADD', KEYS[3], ARGV[3], id)
  redis.call('ZREMRANGEBYRANK', KEYS[3], 0, -tonumber(ARGV[4]) - 1)
  return 'ok'
end
local existing = redis.call('HGET', KEYS[1], id)
local row = ARGV[4]
if existing then
  local previous, newer = cjson.decode(existing), cjson.decode(row)
  local revision = previous.revision or previous.updatedAt or 0
  if revision == newer.revision and redis.call('HGET', KEYS[2], id) == ARGV[5] then return existing end
  if revision > tonumber(ARGV[6]) or revision >= newer.revision then return 'conflict' end
  newer.created = previous.created
  row = cjson.encode(newer)
else
  if redis.call('ZSCORE', KEYS[3], id) then return 'removed' end
  if redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[3]) then return 'full' end
end
redis.call('HSET', KEYS[1], id, row)
redis.call('HSET', KEYS[2], id, ARGV[5])
return row
`;

export const libraryScripts = {
  [edit](call, [meta, states, removed], [id, action, limit, row, state, base]) {
    if (action === 'delete') {
      call('HDEL', meta, id);
      call('HDEL', states, id);
      call('ZADD', removed, limit, id);
      call('ZREMRANGEBYRANK', removed, 0, -Number(row) - 1);
      return 'ok';
    }
    const existing = call('HGET', meta, id);
    if (existing) {
      const previous = JSON.parse(existing), newer = JSON.parse(row);
      const revision = previous.revision ?? previous.updatedAt ?? 0;
      if (revision === newer.revision && call('HGET', states, id) === state) return existing;
      if (revision > Number(base) || revision >= newer.revision) return 'conflict';
      row = JSON.stringify({ ...newer, created: previous.created });
    } else {
      if (call('ZREVRANGEBYSCORE', removed, '+inf', '-inf').includes(id)) return 'removed';
      if (call('HLEN', meta) >= Number(limit)) return 'full';
    }
    call('HSET', meta, id, row);
    call('HSET', states, id, state);
    return row;
  },
};

const res = (status, json) => ({ status, json });
const fail = (status, error) => res(status, { error });
const isId = (value) => typeof value === 'string' && trackId.test(value);

function sameOrigin(req, secure) {
  if (!req.origin || !req.host) return false;
  try {
    const url = new URL(req.origin);
    return req.origin === url.origin && url.host === req.host &&
      (url.protocol === 'https:' || (!secure && url.protocol === 'http:'));
  } catch { return false; }
}

export async function handleLibrary(req, { kv, account, secure, allowWrite }) {
  if (!account || account.anon) return fail(401, 'sign_in_required');
  if (req.query.library !== account.id) return fail(409, 'account_changed');
  const prefix = `untergrund:library:{${account.id}}`;
  const [meta, states, removed] = ['meta', 'state', 'removed'].map((suffix) => `${prefix}:${suffix}`);
  if (req.method === 'GET') {
    const id = req.query.id;
    if (id !== undefined) {
      if (!isId(id)) return fail(400, 'invalid_track');
      const stored = await kv.cmd(['HGET', states, id]);
      if (!stored) return fail(404, 'track_missing');
      const project = JSON.parse(stored);
      return res(200, project.state ? project : { state: project });
    }
    const fields = await kv.cmd(['HGETALL', meta]);
    const items = fields.filter((_, i) => i % 2).map(JSON.parse)
      .sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id));
    return res(200, { items, removed: await kv.cmd(['ZREVRANGEBYSCORE', removed, '+inf', '-inf']), limit: LIBRARY_LIMIT });
  }
  if (req.method !== 'POST') return fail(405, 'method_not_allowed');
  if (!sameOrigin(req, secure)) return fail(403, 'bad_origin');
  const body = req.body;
  if (req.tooLarge) return fail(413, 'too_large');
  if (!isId(body?.id) || !['upsert', 'delete'].includes(body.action)) return fail(400, 'invalid_track');
  if (Buffer.byteLength(JSON.stringify(body)) > LIBRARY_BODY_BYTES) return fail(413, 'too_large');
  const now = Date.now();
  if (body.action === 'upsert' && (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0 ||
    !Number.isSafeInteger(body.revision) || body.revision <= body.baseRevision || body.revision > now + 300_000)) return fail(400, 'invalid_revision');
  if (!await allowWrite()) return fail(429, 'rate_limited');
  const args = ['EVAL', edit, 3, meta, states, removed, body.id, body.action];
  if (body.action === 'delete') {
    await kv.cmd([...args, Date.now(), REMOVED_LIMIT]);
    return res(200, { deleted: true });
  }
  if (!Array.isArray(body.state?.patterns)) return fail(400, 'invalid_state');
  let state;
  try { state = sanitize(body.state); } catch { return fail(400, 'invalid_state'); }
  const stored = JSON.stringify(state);
  if (Buffer.byteLength(stored) > MAX_TRACK_BYTES) return fail(413, 'too_large');
  const time = typeof body.created === 'string' ? Date.parse(body.created) : NaN;
  const row = {
    id: body.id, title: clean(typeof body.title === 'string' ? body.title : '', 80) || 'Untitled',
    artist: clean(typeof body.artist === 'string' ? body.artist : '', 40),
    style: typeof body.style === 'string' && Object.hasOwn(STYLES, body.style) ? body.style : 'hypnotic',
    bpm: state.bpm, created: new Date(Number.isFinite(time) ? time : now).toISOString(),
    revision: body.revision, updatedAt: body.revision,
    fps: [...new Set([songFingerprint(body.state), songFingerprint(state), songFingerprint(refreshSong(sanitize(state)))])],
  };
  const result = await kv.cmd([...args, LIBRARY_LIMIT, JSON.stringify(row),
    JSON.stringify({ state, revision: row.revision, updatedAt: row.updatedAt }), body.baseRevision]);
  if (result === 'full') return fail(409, 'library_full');
  if (result === 'removed') return fail(409, 'track_deleted');
  if (result === 'conflict') return fail(409, 'revision_conflict');
  return res(200, { item: JSON.parse(result) });
}
