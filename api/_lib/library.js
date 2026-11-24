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
if existing then return existing end
if redis.call('ZSCORE', KEYS[3], id) then return 'removed' end
if redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[3]) then return 'full' end
redis.call('HSET', KEYS[1], id, ARGV[4])
redis.call('HSET', KEYS[2], id, ARGV[5])
return ARGV[4]
`;

export const libraryScripts = {
  [edit](call, [meta, states, removed], [id, action, limit, row, state]) {
    if (action === 'delete') {
      call('HDEL', meta, id);
      call('HDEL', states, id);
      call('ZADD', removed, limit, id);
      call('ZREMRANGEBYRANK', removed, 0, -Number(row) - 1);
      return 'ok';
    }
    const existing = call('HGET', meta, id);
    if (existing) return existing;
    if (call('ZREVRANGEBYSCORE', removed, '+inf', '-inf').includes(id)) return 'removed';
    if (call('HLEN', meta) >= Number(limit)) return 'full';
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
      const state = await kv.cmd(['HGET', states, id]);
      return state ? res(200, { state: JSON.parse(state) }) : fail(404, 'track_missing');
    }
    const fields = await kv.cmd(['HGETALL', meta]);
    const items = fields.filter((_, i) => i % 2).map(JSON.parse)
      .sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id));
    return res(200, { items, removed: await kv.cmd(['ZREVRANGEBYSCORE', removed, '+inf', '-inf']), limit: LIBRARY_LIMIT });
  }
  if (req.method !== 'POST') return fail(405, 'method_not_allowed');
  if (!sameOrigin(req, secure)) return fail(403, 'bad_origin');
  const body = req.body;
  if (!isId(body?.id) || !['save', 'delete'].includes(body.action)) return fail(400, 'invalid_track');
  if (Buffer.byteLength(JSON.stringify(body)) > LIBRARY_BODY_BYTES) return fail(413, 'too_large');
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
    bpm: state.bpm, created: new Date(Number.isFinite(time) ? time : Date.now()).toISOString(),
    fps: [...new Set([songFingerprint(body.state), songFingerprint(state), songFingerprint(refreshSong(sanitize(state)))])],
  };
  const result = await kv.cmd([...args, LIBRARY_LIMIT, JSON.stringify(row), stored]);
  if (result === 'full') return fail(409, 'library_full');
  if (result === 'removed') return fail(409, 'track_deleted');
  return res(200, { item: JSON.parse(result) });
}
