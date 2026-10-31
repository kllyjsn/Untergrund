// Generated tracks: shared through /api/tracks when storage is configured, otherwise kept in this browser.
const LOCAL_KEY = 'untergrund.crate.v1';
const FIRST = ['Null', 'Blind', 'Concrete', 'Velvet', 'Neon', 'Hollow', 'Static', 'Golden', 'Last', 'Night', 'Glass', 'Low'];
const SECOND = ['Signal', 'Raum', 'Pulse', 'Tunnel', 'Bloom', 'Echo', 'System', 'Hour', 'Window', 'Choir', 'Engine', 'Tide'];

export const trackTitle = (seed) => `${FIRST[seed % FIRST.length]} ${SECOND[Math.floor(seed / FIRST.length) % SECOND.length]}`;

const localTracks = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; } catch { return []; } };
function keepLocal(track) {
  const tracks = [track, ...localTracks().filter((t) => t.id !== track.id)].slice(0, 30);
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(tracks)); } catch {}
}
const meta = ({ state, ...rest }) => rest;

export async function listCrate() {
  try {
    const res = await fetch('/api/tracks');
    if (res.ok) {
      const shared = (await res.json()).tracks || [];
      const pending = localTracks().filter((t) => String(t.id).startsWith('local-')).map(meta);
      return { shared: true, tracks: [...pending, ...shared] };
    }
  } catch {}
  return { shared: false, tracks: localTracks().map(meta) };
}

export async function fetchTrack(id) {
  const local = localTracks().find((t) => t.id === id);
  if (local?.state) return local;
  const res = await fetch(`/api/tracks?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('track_missing');
  return (await res.json()).track;
}

export async function saveTrack(track) {
  try {
    const res = await fetch('/api/tracks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(track) });
    if (res.ok) {
      const saved = { ...(await res.json()).track, state: track.state };
      keepLocal(saved);
      return { shared: true, track: saved };
    }
  } catch {}
  const local = { ...track, id: `local-${Date.now().toString(36)}`, bpm: track.state.bpm, created: new Date().toISOString() };
  keepLocal(local);
  return { shared: false, track: local };
}
