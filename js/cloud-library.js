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
  let account = '', epoch = 0, work = Promise.resolve(), syncing = null;
  let cloud = new Map(), removed = new Set(), notice = '';
  const connected = () => !!account;
  const alive = (id, version) => id === account && version === epoch;
  const forget = (owner, id) => writeSaved(owner, readSaved(owner).filter((row) => row.id !== id));
  function cache(owner, id, project) {
    const rows = readSaved(owner), previous = rows.find((row) => row.id === id);
    if (!previous || (previous.updatedAt || 0) <= (project.updatedAt || 0)) {
      writeSaved(owner, [{ id, ...project }, ...rows.filter((row) => row.id !== id)]);
    }
  }

  function tracks() {
    if (!account) return device();
    const rows = new Map(cloud);
    for (const row of device()) if (!removed.has(row.id)) {
      rows.set(row.id, { ...row, ...rows.get(row.id) });
    }
    for (const row of read(account)) if (!removed.has(row.id)) {
      const saved = rows.get(row.id);
      if (!saved?.cloud || row.updatedAt > saved.updatedAt) rows.set(row.id, { ...saved, ...row, pending: true });
    }
    return [...rows.values()].filter((row) => !removed.has(row.id))
      .sort((a, b) => String(b.created).localeCompare(String(a.created)));
  }

  function run(fn) {
    const id = account, version = epoch;
    const pending = work.then(() => alive(id, version) && id ? fn(id, version) : false);
    work = pending.catch(() => {});
    return pending;
  }

  async function upload(id, row) {
    const { id: trackId, title, artist, style, created, state, updatedAt, action = 'save' } = row;
    const body = { action, id: trackId, title, artist, style, created, state, updatedAt };
    if (new TextEncoder().encode(JSON.stringify(body)).length > MAX_UPLOAD_BYTES) throw new Error('too_large');
    const { item } = await request(id, body);
    const playable = sanitize(state);
    if (action === 'save' ? item.fps.includes(songFingerprint(playable)) : item.updatedAt === updatedAt) {
      cache(id, trackId, { state: playable, updatedAt: item.updatedAt, item });
    }
    return item;
  }

  function sync() {
    if (syncing) return syncing;
    const pendingSync = run(async (id, version) => {
      try {
        const list = await request(id);
        if (!alive(id, version)) return false;
        cloud = new Map(list.items.map((row) => [row.id, { ...row, cloud: true }]));
        removed = new Set(list.removed);
        notice = '';
        change();
        const pending = read(id);
        const remaining = new Set(pending.map((row) => row.id));
        const seen = new Set();
        for (const row of [...pending, ...device()]) {
          if (!alive(id, version)) return false;
          if (removed.has(row.id) || cloud.has(row.id) && (row.action !== 'update' || cloud.get(row.id).updatedAt >= row.updatedAt)) {
            remaining.delete(row.id); continue;
          }
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          if (row.action !== 'update' && cloud.size >= list.limit) { notice = saveNotice('library_full', true); continue; }
          try {
            const item = await upload(id, row);
            if (!alive(id, version)) return false;
            cloud.set(row.id, { ...item, cloud: true });
            remaining.delete(row.id);
          } catch (err) {
            if (!alive(id, version)) return false;
            if (err.message === 'track_deleted' || err.message === 'track_missing') { remaining.delete(row.id); continue; }
            notice = saveNotice(err.message, true);
            if (!['too_large', 'library_full', 'invalid_state'].includes(err.message)) break;
          }
        }
        write(id, read(id).filter((row) => !pending.some((p) => p.id === row.id && p.updatedAt === row.updatedAt) || remaining.has(row.id)));
        return true;
      } catch {
        if (alive(id, version)) notice = 'Cloud Library is unavailable. Songs on this device are still available.';
        return false;
      } finally { if (alive(id, version)) change(); }
    });
    syncing = pendingSync;
    const done = () => { if (syncing === pendingSync) syncing = null; };
    pendingSync.then(done, done);
    return pendingSync;
  }

  function setAccount(info) {
    if (info?.unavailable) return;
    const id = info?.account && !info.account.anon ? info.account.id : '';
    if (id === account) return;
    account = id; epoch++; cloud = new Map(); removed = new Set(); notice = ''; work = Promise.resolve(); syncing = null;
    change();
    if (account) sync();
  }

  async function refresh() {
    setAccount(await get(true));
    return sync();
  }

  async function saveGenerated(track, trackId = newLibraryId(), onPrivate = () => {}) {
    const info = await get(true);
    setAccount(info);
    if (!account) return info.unavailable ? saveLocal(track) : savePublic(track);
    const row = { ...track, id: trackId, updatedAt: Date.now(), bpm: track.state.bpm, created: new Date().toISOString() };
    const owner = account;
    const pending = read(account);
    const kept = pending.length < 30 && write(account, [...pending, row]);
    onPrivate(owner);
    const result = await run(async (id, version) => {
      try {
        const current = read(id).find((r) => r.id === trackId) || row;
        const item = await upload(id, current);
        write(id, read(id).filter((r) => r.id !== trackId || r.updatedAt !== current.updatedAt));
        if (alive(id, version)) cloud.set(row.id, { ...item, cloud: true });
        return { private: true, synced: true, item, owner: id };
      } catch (err) {
        const message = saveNotice(err.message, kept);
        if (alive(id, version)) notice = message;
        return { private: true, synced: false, kept, message };
      } finally { if (alive(id, version)) change(); }
    });
    return result || { private: true, synced: false, kept };
  }

  async function load(id) {
    const owner = account, version = epoch;
    if (!owner) throw new Error('sign_in_required');
    const pending = read(owner).find((row) => row.id === id);
    const cached = readSaved(owner).find((row) => row.id === id);
    if (removed.has(id)) throw new Error('track_missing');
    let project;
    try {
      project = await request(owner, null, id);
      if (alive(owner, version)) cache(owner, id, { ...project, item: cloud.get(id) || cached?.item });
    }
    catch (err) {
      if (['account_changed', 'sign_in_required'].includes(err.message) ||
        err.message === 'track_missing' && (!pending || pending.action === 'update')) throw err;
      const latest = cloud.get(id)?.updatedAt || 0;
      if (pending && pending.updatedAt >= latest) project = pending;
      else if (cached && (cached.updatedAt || 0) >= latest) project = cached;
      else throw err;
    }
    if (!alive(owner, version)) throw new Error('account_changed');
    if (pending?.updatedAt > (project.updatedAt || 0)) project = pending;
    return { state: project.state, updatedAt: project.updatedAt || 0, owner };
  }

  function stageEdit(owner, id, state, updatedAt, saved) {
    const pending = read(owner), queued = pending.find((row) => row.id === id);
    if (queued && queued.updatedAt > updatedAt) return;
    const cached = readSaved(owner).find((row) => row.id === id)?.item;
    const row = saved || queued || cached || { id, title: state.artist?.title, artist: state.artist?.name, style: state.artist?.style };
    const action = !saved && queued && queued.action !== 'update' ? 'save' : 'update';
    const edit = { ...row, action, state, bpm: state.bpm, updatedAt };
    const remaining = pending.filter((row) => row.id !== id);
    return { edit, kept: remaining.length < 30 && write(owner, [...remaining, edit]) };
  }

  async function update(owner, id, state, updatedAt) {
    if (!account) {
      const info = await get();
      setAccount(info);
      if (!account && info.unavailable) {
        stageEdit(owner, id, state, updatedAt);
        return;
      }
    }
    if (owner !== account || removed.has(id)) return;
    return run(async (idOwner, version) => {
      const staged = stageEdit(owner, id, state, updatedAt, cloud.get(id));
      if (!staged) return;
      const { edit, kept } = staged;
      try {
        const item = await upload(idOwner, edit);
        write(idOwner, read(idOwner).filter((r) => r.id !== id || r.updatedAt !== updatedAt));
        if (alive(idOwner, version)) cloud.set(id, { ...item, cloud: true });
      } catch (err) {
        if (alive(idOwner, version)) notice = saveNotice(err.message, kept);
      } finally { if (alive(idOwner, version)) change(); }
    });
  }

  function remove(id) {
    return run(async (owner, version) => {
      await request(owner, { action: 'delete', id });
      if (!alive(owner, version)) return false;
      cloud.delete(id); removed.add(id);
      forget(owner, id);
      write(owner, read(owner).filter((row) => row.id !== id));
      change();
      return true;
    });
  }

  subscribe(setAccount);
  return { connected, refresh, tracks, recent: () => (account ? tracks() : deviceRecent()).slice(0, 8),
    saveGenerated, load, update, remove, notice: () => notice };
}
