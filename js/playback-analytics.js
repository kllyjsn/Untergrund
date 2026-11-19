import { privacyOptOut } from './analytics.js';

export const RELEASE_ID = /^[a-z0-9-]{3,40}$/;
export const MAX_PLAY_SECONDS = 6 * 3600;
export const PLAYBACK_SURFACES = ['public', 'embed', 'club'];
export const PLAYBACK_OUTCOMES = ['playing', 'complete', 'skip', 'stop'];
const MAX_START_WAIT = 30;
const bounded = (p) => Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : null;

// This stream never uses analytics.js's device or tab identifiers. A new ID is made for each audible attempt.
export function createPlaybackAnalytics(win = globalThis) {
  const enabled = () => !privacyOptOut(win) && !win.navigator?.webdriver && win.fetch && win.crypto?.randomUUID;
  let play = null, timer;

  function send(p, elapsed, progress, outcome) {
    const body = JSON.stringify({ ...p.source, playId: p.id, seq: ++p.seq, elapsed: Math.floor(elapsed),
      progress: progress === null ? null : Math.floor(progress * 100), outcome });
    try {
      win.fetch('/api/events?playback=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }).catch(() => {});
    } catch {}
  }

  function sample(outcome = 'playing') {
    const p = play;
    if (!p) return;
    const { ctx, at, progress, from, expectedSeconds = 0 } = p.clock;
    const elapsed = Math.min(MAX_PLAY_SECONDS, ctx.currentTime - at);
    if (!enabled() || (!p.id && elapsed <= 0 && Date.now() - p.created > MAX_START_WAIT * 1000)) return clear();
    if (elapsed <= 0) return;
    const pos = bounded(progress());
    const full = from !== null && from <= 0.05 && pos !== null && pos >= (outcome === 'complete' ? 0.95 : 1)
      && elapsed >= Math.max(1, 0.85 * expectedSeconds);
    if (!p.id) p.id = win.crypto.randomUUID();
    const result = full ? 'complete' : outcome === 'complete' ? 'stop' : outcome;
    if (!p.seq || result !== 'playing' || elapsed - p.last >= 15) {
      send(p, elapsed, full ? 1 : pos, result);
      p.last = elapsed;
    }
    if (result !== 'playing' || elapsed === MAX_PLAY_SECONDS) clear();
  }

  function clear() { win.clearInterval?.(timer); timer = undefined; play = null; }
  function end(outcome = 'stop') { sample(['complete', 'skip'].includes(outcome) ? outcome : 'stop'); clear(); }
  function start(source, clock) {
    end();
    if (!source || !enabled()) return;
    const { surface, trackId, genre } = source;
    play = { source: { surface, ...(trackId ? { trackId } : { genre }) }, clock, id: '', seq: 0, last: 0, created: Date.now() };
    timer = win.setInterval(sample, 500);
    sample();
  }
  win.addEventListener?.('pagehide', () => end());
  return { start, end };
}
