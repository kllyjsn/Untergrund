// Radio: what plays next when a song ends, on ⏭, or after a "not for me" reason.
// A Library queue plays through in order (skipping songs you turned down), then new songs in the same style keep coming;
// "not my style" moves to another style in the same family. Pure: the caller loads tracks and generates songs.
export const RADIO_KEY = 'untergrund.radio';
export function radioOn(store = globalThis.localStorage) {
  try { return store?.getItem(RADIO_KEY) !== '0'; } catch { return true; }
}
export function setRadio(on, store = globalThis.localStorage) {
  try { store?.setItem(RADIO_KEY, on ? '1' : '0'); } catch {}
  return !!on;
}

// queue: { ids, i } (the Library list and the index playing now); styles: STYLES; skip(id): true for songs to pass over.
// -> { kind: 'track', i } for the next queued song, or { kind: 'generate', style } for a new one.
export function nextUp({ queue = null, style, styles, why = '', skip = () => false, rand = Math.random }) {
  if (queue && why !== 'not_my_style') {
    for (let i = queue.i + 1; i < queue.ids.length; i++) if (!skip(queue.ids[i])) return { kind: 'track', i };
  }
  if (why !== 'not_my_style' || !styles[style]) return { kind: 'generate', style };
  const fam = styles[style].family;
  const others = Object.keys(styles).filter((id) => id !== style && styles[id].family !== 'CLASSICAL');
  const near = others.filter((id) => styles[id].family === fam);
  const pool = near.length ? near : others;
  return { kind: 'generate', style: pool.length ? pool[Math.floor(rand() * pool.length) % pool.length] : style };
}
