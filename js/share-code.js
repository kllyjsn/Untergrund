// Share links: a song's replayable state packed into a short URL that works with no backend.
// Format: z<base64url(deflate-raw(JSON))>, or j<base64url(JSON)> where CompressionStream is missing.
import { sanitize, STYLES } from './state.js';

const MAX_CODE = 60_000, MAX_JSON = 400_000;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const cleanId = (v) => String(v ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);

const toB64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
async function pipe(bytes, Stream, mode, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(new Stream(mode)).getReader();
  const parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { reader.cancel(); throw new Error('too_large'); }
    parts.push(value);
  }
  const out = new Uint8Array(size); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function remixCredit(r) {
  if (!r || typeof r !== 'object') return null;
  const title = clean(r.title, 80), artist = clean(r.artist, 40);
  return title ? { id: cleanId(r.id), title, artist: artist || 'UNTERGRUND' } : null;
}

// Every value that comes out of a link goes through the same sanitization as saved projects.
export function normalizeSong(song) {
  if (!song || typeof song !== 'object' || !song.state || !Array.isArray(song.state.patterns)) return null;
  const state = sanitize(song.state);
  const style = STYLES[song.style] ? song.style : STYLES[state.artist?.style] ? state.artist.style : 'hypnotic';
  return {
    title: clean(song.title, 80) || state.artist?.title || 'Untitled Signal',
    artist: clean(song.artist, 40) || state.artist?.name || 'UNTERGRUND',
    style, state, remixOf: remixCredit(song.remixOf || state.remixOf),
  };
}

export async function encodeSong(song) {
  const s = normalizeSong(song);
  if (!s) throw new Error('invalid_song');
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, t: s.title, a: s.artist, y: s.style, s: s.remixOf ? { ...s.state, remixOf: s.remixOf } : s.state }));
  if (typeof CompressionStream === 'undefined') return 'j' + toB64url(bytes);
  return 'z' + toB64url(await pipe(bytes, CompressionStream, 'deflate-raw'));
}

export async function decodeSong(code) {
  try {
    code = String(code || '').trim();
    if (code.length < 2 || code.length > MAX_CODE || !/^[zj][A-Za-z0-9_-]+$/.test(code)) return null;
    let bytes = fromB64url(code.slice(1));
    if (code[0] === 'z') bytes = await pipe(bytes, DecompressionStream, 'deflate-raw', MAX_JSON);
    if (bytes.length > MAX_JSON) return null;
    const p = JSON.parse(new TextDecoder().decode(bytes));
    return normalizeSong({ title: p.t, artist: p.a, style: p.y, state: p.s });
  } catch { return null; }
}

// ?s=<code> or #s=<code> carries the whole song; ?t=<id> is a short id from the shared crate.
// A share ref (`r`) tags one shared link so listens that arrive through it can be counted (docs/listen-signals.md).
export const SHARE_REF = /^[a-z0-9]{8}$/;
export const newShareRef = () => Array.from({ length: 8 }, () => ((Math.random() * 36) | 0).toString(36)).join('');
export function readShareParams(loc) {
  const q = new URLSearchParams(loc.search), hash = new URLSearchParams(String(loc.hash || '').replace(/^#/, ''));
  const r = q.get('r') || hash.get('r'), ref = SHARE_REF.test(r || '') ? { ref: r } : {};
  const code = q.get('s') || hash.get('s');
  if (code) return { code, ...ref };
  const id = cleanId(q.get('t'));
  return id ? { id, ...ref } : null;
}

export const songLink = (origin, { code, id }, page = '/', ref = '') =>
  `${origin}${page}?${id ? `t=${encodeURIComponent(id)}` : `s=${code}`}${SHARE_REF.test(ref) ? `&r=${ref}` : ''}`;
export const embedCode = (src, title = 'UNTERGRUND') =>
  `<iframe src="${src}" title="${clean(title, 80).replace(/"/g, '&quot;')} on UNTERGRUND" width="100%" height="152" style="border:0;border-radius:14px;max-width:560px" allow="autoplay; clipboard-write" loading="lazy"></iframe>`;

// Forking a song: the state keeps the credit so it survives saves, publishing and further remixes.
export function remixState(song, me = {}) {
  const s = normalizeSong(song);
  if (!s) return null;
  const state = s.state;
  state.remixOf = { id: cleanId(song.trackId || song.id), title: s.title, artist: s.artist };
  state.artist = {
    ...(state.artist || {}),
    name: clean(me.name, 40) || 'UNTERGRUND',
    title: clean(`${s.title} (Remix)`, 80),
    style: s.style,
    seed: Number.isFinite(+state.artist?.seed) ? +state.artist.seed : 0,
    created: new Date().toISOString(),
  };
  return state;
}

export const creditLine = (r) => (r?.title ? `Remix of ${r.title} by ${r.artist || 'UNTERGRUND'}` : '');
