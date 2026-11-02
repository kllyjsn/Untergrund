// REPERTOIRE: real public-domain and CC0 masterworks (data/repertoire, see its LICENSE.md),
// performed by js/perform.js on the recorded piano and strings. Scores load on demand.
import { REPERTOIRE } from './repertoire-index.js';
import { perform } from './perform.js';

export { REPERTOIRE };
export const PIECE = Object.fromEntries(REPERTOIRE.map((p) => [p.id, p]));
const played = new Map(), pending = new Map(), written = new Map();

export function registerPiece(raw) {
  const sc = perform(raw);
  sc.meta = PIECE[raw.id] || raw;
  played.set(raw.id, sc);
  written.set(raw.id, raw);
  return sc;
}
export const pieceScore = (id) => played.get(id) || null;
// The notes as written, with their hands (PRACTICE teaches these, not the performance).
export const writtenScore = (id) => written.get(id) || null;

export function loadPiece(id) {
  if (played.has(id)) return Promise.resolve(played.get(id));
  if (!PIECE[id]) return Promise.reject(new Error(`Unknown piece ${id}`));
  if (!pending.has(id)) {
    pending.set(id, fetch(new URL(`../data/repertoire/${id}.json`, import.meta.url))
      .then((r) => { if (!r.ok) throw new Error(`Score ${id}: HTTP ${r.status}`); return r.json(); })
      .then(registerPiece)
      .finally(() => pending.delete(id)));
  }
  return pending.get(id);
}

// While a score is still on its way the transport holds one silent bar.
const WAIT = { bars: 1, barLen: 16, sections: [{ at: 0, name: 'OPENING THE SCORE', len: 1 }], notes: [], at: Array.from({ length: 16 }, () => []), tempo: new Array(16).fill(1), waiting: true };
export const waitingScore = () => WAIT;
