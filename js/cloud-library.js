import { getAccount, onAccount } from './account.js';
import { libraryTracks, recentTracks, saveLocalTrack, saveTrack } from './crate.js';
import { sanitize } from './state.js';
import { songFingerprint } from './listen.js';

const deviceKey = (id) => `untergrund.library.pending.v1.${id}`;
const cacheKey = (id) => `untergrund.library.cache.v1.${id}`;
export const newLibraryId = () => `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const readPending = (id) => {
  try { const rows = JSON.parse(localStorage.getItem(deviceKey(id))); return Array.isArray(rows) ? rows : []; } catch { return []; }
};
const writePending = (id, rows) => {
  try { localStorage.setItem(deviceKey(id), JSON.stringify(rows)); return true; } catch { return false; }
};
function readCache(owner) {
  try { const rows = JSON.parse(localStorage.getItem(cacheKey(owner)) || '[]'); return Array.isArray(rows) ? rows : []; } catch { return []; }
}
function writeCache(owner, rows) {
  try { localStorage.setItem(cacheKey(owner), JSON.stringify(rows.slice(0, 8))); } catch {}
}
const full = 'Your cloud Library is full (100 songs). Remove a song to sync more.';
const tooLarge = 'This song is too large to sync (200 KB limit).';
const MAX_UPLOAD_BYTES = 200_000;
const revisionOf = (row) => row?.revision ?? row?.updatedAt ?? 0;
function reapply(base, draft, latest) {
  if (JSON.stringify(base) === JSON.stringify(draft)) return latest;
  if (Array.isArray(base) && Array.isArray(draft) && base.length === draft.length &&
      Array.isArray(latest) && latest.length === base.length) {
    return draft.map((value, i) => reapply(base[i], value, latest[i]));
  }
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  if (object(base) && object(draft) && object(latest)) {
    const result = { ...latest };
    for (const key of Object.keys(base)) if (!Object.hasOwn(draft, key)) delete result[key];
    for (const [key, value] of Object.entries(draft)) {
      if (JSON.stringify(value) !== JSON.stringify(base[key])) {
        Object.defineProperty(result, key, { value: reapply(base[key], value, latest[key]), enumerable: true, configurable: true, writable: true });
      }
    }
    return result;
  }
  return draft;
}
const saveNotice = (error, kept) => {
  const location = kept ? ' It stays on this device.' : ' The song could not be saved to your Library.';
  return (error === 'library_full' ? full : error === 'too_large' ? tooLarge : 'Cloud Library sync is unavailable.') + location;
};

async function api(account, body, id) {
  const query = new URLSearchParams({ library: account, ...(id && { id }) });
  const res = await fetch(`/api/account?${query}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {});
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'library_unavailable');
  return json;
}

export function createCloudLibrary({ get = getAccount, subscribe = onAccount, device = libraryTracks, deviceRecent = recentTracks, request = api,
  read = readPending, write = writePending, readSaved = readCache, writeSaved = writeCache,
  savePublic = saveTrack, saveLocal = saveLocalTrack, change = () => {} } = {}) {
  let account = '', known = false, epoch = 0, syncing = null;
  let cloud = new Map(), removed = new Set(), notice = '';
  const flights = new Map(), timers = new Map();
  const connected = () => !!account;
  const alive = (id, version) => id === account && version === epoch;
  const pending = (owner, id) => read(owner).find((row) => row.id === id);
  const cached = (owner, id) => readSaved(owner).find((row) => row.id === id);
  const forget = (owner, id) => writeSaved(owner, readSaved(owner).filter((row) => row.id !== id));
  function cache(owner, id, project) {
    const rows = readSaved(owner), previous = rows.find((row) => row.id === id);
    if (revisionOf(previous) <= revisionOf(project)) {
      writeSaved(owner, [{ id, ...project }, ...rows.filter((row) => row.id !== id)]);
    }
  }

  function stage(owner, row) {
    const current = pending(owner, row.id);
    if (current && revisionOf(current) >= revisionOf(row)) return true;
    const rest = read(owner).filter((item) => item.id !== row.id);
    const existing = current || row.baseRevision || (owner === account && cloud.has(row.id)) || cached(owner, row.id);
    return (existing || rest.filter((item) => !item.baseRevision && !(owner === account && cloud.has(item.id))).length < 30) &&
      write(owner, [...rest, row]);
  }

  function acknowledge(owner, item) {
    const row = pending(owner, item.id);
    if (!row || revisionOf(row) !== revisionOf(item)) return;
    if (revisionOf(row) === revisionOf(item)) {
      const state = sanitize(row.state);
      if (item.fps?.includes(songFingerprint(state))) cache(owner, item.id, { state, revision: revisionOf(item), item });
    }
    write(owner, read(owner).filter((row) => row.id !== item.id || revisionOf(row) > revisionOf(item)));
  }

  function rebased(owner, row, project) {
    const baseRevision = revisionOf(project);
    if (!row || baseRevision <= (row.baseRevision || 0)) return row;
    const state = row.baseState ? reapply(row.baseState, row.state, project.state) : row.state;
    const next = { ...row, state, bpm: state.bpm, baseState: project.state, baseRevision,
      revision: Math.max(Date.now(), revisionOf(row) + 1, baseRevision + 1) };
    return stage(owner, next) ? next : row;
  }

  function tracks() {
    if (!account) return device();
    const rows = new Map(cloud);
    for (const row of device()) if (!removed.has(row.id)) {
      rows.set(row.id, { ...row, ...rows.get(row.id) });
    }
    for (const row of read(account)) if (!removed.has(row.id)) {
      const saved = rows.get(row.id);
      if (!saved?.cloud || revisionOf(row) > revisionOf(saved)) rows.set(row.id, { ...saved, ...row, pending: true });
    }
    return [...rows.values()].filter((row) => !removed.has(row.id))
      .sort((a, b) => String(b.created).localeCompare(String(a.created)));
  }

  function schedule(owner, id) {
    if (!owner || owner !== account) return;
    const key = `${owner}:${id}`;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); void flush(owner, id); }, 500));
  }

  function flush(owner, id, fallback) {
    const version = epoch, key = `${owner}:${id}`;
    if (!owner || !alive(owner, version) || removed.has(id)) return Promise.resolve({});
    if (flights.has(key)) return flights.get(key);
    let current = pending(owner, id) || fallback;
    if (!current) return Promise.resolve({ item: cloud.get(id) });
    const active = (async () => {
      try {
        const upload = (row) => {
          const { title, artist, style, created, state, baseRevision = 0 } = row;
          const body = { action: 'upsert', id, title, artist, style, created, state, baseRevision, revision: revisionOf(row) };
          if (new TextEncoder().encode(JSON.stringify(body)).length > MAX_UPLOAD_BYTES) throw new Error('too_large');
          return request(owner, body);
        };
        let result;
        try {
          result = await upload(current);
        } catch (err) {
          if (err.message !== 'revision_conflict') throw err;
          const project = await request(owner, null, id);
          if (!alive(owner, version) || removed.has(id)) return {};
          const latest = pending(owner, id) || current;
          current = rebased(owner, latest, project);
          if (current === latest) throw err;
          result = await upload(current);
        }
        const { item } = result;
        if (item.id !== id || revisionOf(item) !== revisionOf(current)) throw new Error('invalid_ack');
        if (!alive(owner, version) || removed.has(id)) return {};
        const playable = sanitize(current.state);
        if (item.fps?.includes(songFingerprint(playable))) cache(owner, id, { state: playable, revision: item.revision, item });
        acknowledge(owner, item);
        if (revisionOf(item) >= revisionOf(cloud.get(id))) cloud.set(id, { ...item, cloud: true });
        if (pending(owner, id)) schedule(owner, id);
        return { item };
      } catch (err) {
        if (alive(owner, version)) {
          if (err.message === 'track_deleted') { cloud.delete(id); removed.add(id); forget(owner, id); }
          else {
            const newer = pending(owner, id);
            notice = saveNotice(err.message, !!newer || device().some((row) => row.id === id));
            if (revisionOf(newer) > revisionOf(current)) schedule(owner, id);
          }
        }
        return { error: err.message };
      } finally { if (alive(owner, version)) change(); }
    })();
    flights.set(key, active);
    active.finally(() => { if (flights.get(key) === active) flights.delete(key); });
    return active;
  }

  function sync() {
    if (syncing) return syncing;
    const id = account, version = epoch;
    if (!id) return Promise.resolve(false);
    const previous = new Map(cloud);
    const pendingSync = (async () => {
      try {
        const list = await request(id);
        if (!alive(id, version)) return false;
        const latest = new Map(list.items.map((row) => [row.id, { ...row, cloud: true }]));
        for (const key of list.removed) removed.add(key);
        for (const [key, row] of cloud) {
          if (row !== previous.get(key) && revisionOf(row) > revisionOf(latest.get(key))) latest.set(key, row);
        }
        for (const key of removed) latest.delete(key);
        cloud = latest;
        notice = '';
        change();
        const seen = new Set();
        for (const row of [...read(id), ...device()]) {
          if (!alive(id, version)) return false;
          if (seen.has(row.id) || removed.has(row.id)) continue;
          seen.add(row.id);
          let queued = pending(id, row.id);
          if (!queued && cloud.has(row.id)) continue;
          if (!cloud.has(row.id) && cloud.size >= list.limit) { notice = saveNotice('library_full', true); continue; }
          if (!revisionOf(queued)) {
            queued = { ...row, revision: Date.now() };
            stage(id, queued);
          }
          const { error } = await flush(id, row.id, queued);
          if (error && !['too_large', 'library_full', 'invalid_state', 'track_deleted'].includes(error)) break;
        }
        return true;
      } catch {
        if (alive(id, version)) notice = 'Cloud Library is unavailable. Songs on this device are still available.';
        return false;
      } finally { if (alive(id, version)) change(); }
    })();
    syncing = pendingSync;
    const done = () => { if (syncing === pendingSync) syncing = null; };
    pendingSync.then(done, done);
    return pendingSync;
  }

  function setAccount(info) {
    if (info?.unavailable) return;
    known = true;
    const id = info?.account && !info.account.anon ? info.account.id : '';
    if (id === account) return;
    account = id; epoch++; cloud = new Map(); removed = new Set(); notice = ''; syncing = null;
    change();
    if (account) sync();
  }

  async function refresh() {
    setAccount(await get(true));
    return sync();
  }

  async function saveGenerated(track, trackId = newLibraryId(), onPrivate = () => {}) {
    const expected = account;
    const unowned = pending('', trackId);
    const original = pending(expected, trackId) || unowned ||
      { ...track, id: trackId, revision: Date.now(), bpm: track.state.bpm, created: new Date().toISOString() };
    stage(expected, original);
    const info = await get(true);
    setAccount(info);
    const row = pending(expected, trackId) || original;
    if (expected && expected !== account) return { private: true, synced: false, kept: !!pending(expected, trackId) };
    if (!account) {
      const { title, artist, style, state } = row;
      const local = { title, artist, style, state };
      const saved = await (info.unavailable ? saveLocal(local) : savePublic(local));
      write('', read('').filter((item) => item.id !== trackId || revisionOf(item) > revisionOf(row)));
      return saved;
    }
    const owner = account;
    const kept = stage(owner, row);
    if (kept && (!expected || unowned)) write('', read('').filter((item) => item.id !== trackId || revisionOf(item) > revisionOf(row)));
    onPrivate(owner, revisionOf(row));
    const { item, error } = await flush(owner, trackId, row);
    return item ? { private: true, synced: true, item, owner } :
      { private: true, synced: false, kept, ...(error && { message: saveNotice(error, kept) }) };
  }

  async function load(id) {
    const owner = account, version = epoch;
    if (!owner) throw new Error('sign_in_required');
    if (removed.has(id)) throw new Error('track_missing');
    const queued = pending(owner, id);
    const onDevice = queued || cached(owner, id) || device().find((row) => row.id === id);
    const view = (row) => ({ state: row.state, updatedAt: revisionOf(row), owner });
    if (onDevice && globalThis.navigator?.onLine === false) return view(onDevice);
    try {
      const project = await request(owner, null, id);
      if (!alive(owner, version)) throw new Error('account_changed');
      cache(owner, id, { ...project, item: cloud.get(id) || cached(owner, id)?.item });
      const draft = pending(owner, id);
      if (draft && revisionOf(draft) !== revisionOf(project)) return view(rebased(owner, draft, project));
      return view(draft || project);
    } catch (err) {
      if (!alive(owner, version) || ['account_changed', 'sign_in_required'].includes(err.message) ||
          err.message === 'track_missing' && !pending(owner, id) || !onDevice) throw err;
      return view(pending(owner, id) || onDevice);
    }
  }

  function update(owner, id, state, after = 0, previous) {
    const queued = pending(owner, id);
    if (!owner && !queued || owner && known && owner !== account || owner === account && removed.has(id)) return;
    const saved = owner === account && cloud.get(id);
    const local = cached(owner, id);
    const row = queued || saved || local?.item || device().find((row) => row.id === id) ||
      { id, title: state.artist?.title, artist: state.artist?.name, style: state.artist?.style };
    const revision = Math.max(Date.now(), after + 1, revisionOf(saved) + 1, revisionOf(queued) + 1, revisionOf(local) + 1);
    const { title, artist, style, created } = row;
    const baseRevision = queued ? queued.baseRevision || 0 : after || revisionOf(local) || revisionOf(saved);
    const baseState = queued ? queued.baseState || queued.state : previous || local?.state;
    const kept = stage(owner, { id, title, artist, style, created, state, bpm: state.bpm, revision, baseRevision, baseState });
    if (kept) schedule(owner, id);
    else if (owner) { notice = 'Could not save the Library edit on this device.'; change(); }
    return { revision, kept };
  }

  async function remove(id) {
    const owner = account, version = epoch;
    if (!owner) return false;
    await request(owner, { action: 'delete', id });
    if (!alive(owner, version)) return false;
    cloud.delete(id); removed.add(id);
    forget(owner, id);
    write(owner, read(owner).filter((row) => row.id !== id));
    change();
    return true;
  }

  subscribe(setAccount);
  return { connected, owner: () => account, refresh, tracks, recent: () => (account ? tracks() : deviceRecent()).slice(0, 8),
    saveGenerated, resumeDraft: (id, onPrivate) => {
      const row = pending('', id);
      if (account && row) return saveGenerated(row, id, onPrivate);
    }, load, update, remove, notice: () => notice };
}
