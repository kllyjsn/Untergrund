import { getAccount, onAccount } from './account.js';
import { libraryTracks, saveLocalTrack, saveTrack } from './crate.js';

const deviceKey = (id) => `untergrund.library.pending.v1.${id}`;
const readPending = (id) => {
  try { const rows = JSON.parse(localStorage.getItem(deviceKey(id))); return Array.isArray(rows) ? rows : []; } catch { return []; }
};
const writePending = (id, rows) => {
  try { localStorage.setItem(deviceKey(id), JSON.stringify(rows)); return true; } catch { return false; }
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

export function createCloudLibrary({ get = getAccount, subscribe = onAccount, device = libraryTracks, request = api,
  read = readPending, write = writePending, savePublic = saveTrack, saveLocal = saveLocalTrack, change = () => {} } = {}) {
  let account = '', epoch = 0, work = Promise.resolve(), syncing = null;
  let cloud = new Map(), removed = new Set(), notice = '';
  const connected = () => !!account;
  const alive = (id, version) => id === account && version === epoch;

  function tracks() {
    if (!account) return device();
    const rows = new Map(cloud);
    for (const row of [...device(), ...read(account)]) if (!removed.has(row.id)) {
      rows.set(row.id, { ...rows.get(row.id), ...row });
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
    const { id: trackId, title, artist, style, created, state } = row;
    return (await request(id, { action: 'save', id: trackId, title, artist, style, created, state })).item;
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
        for (const row of [...device(), ...pending]) {
          if (!alive(id, version)) return false;
          if (cloud.has(row.id) || removed.has(row.id)) { remaining.delete(row.id); continue; }
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          if (cloud.size >= list.limit) { notice = 'Cloud Library is full. Unsynced songs stay on this device.'; break; }
          try {
            const item = await upload(id, row);
            if (!alive(id, version)) return false;
            cloud.set(row.id, { ...item, cloud: true });
            remaining.delete(row.id);
          } catch (err) {
            if (!alive(id, version)) return false;
            if (err.message === 'track_deleted') { removed.add(row.id); remaining.delete(row.id); continue; }
            notice = 'Some songs could not sync and are still on this device.';
            if (err.message !== 'too_large' && err.message !== 'invalid_state') break;
          }
        }
        write(id, read(id).filter((row) => !pending.some((p) => p.id === row.id) || remaining.has(row.id)));
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
    setAccount(await get());
    return sync();
  }

  async function saveGenerated(track) {
    const info = await get();
    setAccount(info);
    if (!account) return info.unavailable ? saveLocal(track) : savePublic(track);
    const row = { ...track, id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      bpm: track.state.bpm, created: new Date().toISOString() };
    const pending = read(account);
    const kept = pending.length < 30 && write(account, [...pending, row]);
    const result = await run(async (id, version) => {
      try {
        const item = await upload(id, row);
        write(id, read(id).filter((r) => r.id !== row.id));
        if (alive(id, version)) cloud.set(row.id, { ...item, cloud: true });
        return { private: true, synced: true };
      } catch {
        if (alive(id, version)) notice = kept ? 'Song saved on this device. Cloud sync is unavailable or the Library is full.' : 'Could not save this song to your Library.';
        return { private: true, synced: false, kept };
      } finally { if (alive(id, version)) change(); }
    });
    return result || { private: true, synced: false, kept };
  }

  async function load(id) {
    const owner = account, version = epoch;
    if (!owner) throw new Error('sign_in_required');
    const { state } = await request(owner, null, id);
    if (!alive(owner, version)) throw new Error('account_changed');
    return state;
  }

  function remove(id) {
    return run(async (owner, version) => {
      await request(owner, { action: 'delete', id });
      if (!alive(owner, version)) return false;
      cloud.delete(id); removed.add(id);
      write(owner, read(owner).filter((row) => row.id !== id));
      change();
      return true;
    });
  }

  subscribe(setAccount);
  return { connected, refresh, tracks, saveGenerated, load, remove, notice: () => notice };
}
