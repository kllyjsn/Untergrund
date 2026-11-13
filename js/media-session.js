// Lock screen, Control Center, headphone and media-key controls (Media Session API) for the app's own player.
// Every setter dedupes, so callers can sync on each transport change; all of it is a no-op where the API is missing.
export const ACTIONS = ['play', 'pause', 'nexttrack', 'previoustrack'];
export const APP_ART = [
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
];

export function createNowPlaying({ session = globalThis.navigator?.mediaSession, Metadata = globalThis.MediaMetadata } = {}) {
  const supported = !!(session && Metadata);
  let metaKey = null, playback = null, posKey = null;
  const bound = {};
  return {
    supported,
    // title '' clears the lock-screen card.
    metadata({ title = '', artist = 'UNTERGRUND', album = 'UNTERGRUND', artwork = null } = {}) {
      if (!supported) return;
      const art = artwork?.length ? artwork : APP_ART;
      const key = title ? JSON.stringify([title, artist, album, art]) : '';
      if (key === metaKey) return;
      metaKey = key;
      session.metadata = title ? new Metadata({ title, artist, album, artwork: art }) : null;
    },
    state(s) {
      if (!supported || s === playback) return;
      playback = s;
      try { session.playbackState = s; } catch {}
    },
    // A missing handler disables that button; browsers throw on actions they don't know.
    actions(map) {
      if (!supported) return;
      for (const a of ACTIONS) {
        const fn = map[a] || null;
        if (a in bound && bound[a] === fn) continue;
        bound[a] = fn;
        try { session.setActionHandler(a, fn); } catch {}
      }
    },
    // Seconds. No duration (an endless or rubato song) clears the progress bar.
    position({ duration = 0, position = 0 } = {}) {
      if (!supported || !session.setPositionState) return;
      const ok = Number.isFinite(duration) && duration > 0;
      const pos = ok ? Math.min(duration, Math.max(0, position)) : 0;
      const key = ok ? `${duration.toFixed(2)}|${pos.toFixed(1)}` : '';
      if (key === posKey) return;
      posKey = key;
      try { session.setPositionState(ok ? { duration, position: pos, playbackRate: 1 } : undefined); } catch {}
    },
  };
}

// The step to pick a paused song up from: the start of the bar that was sounding, so it re-enters on a downbeat.
// next: the next step not yet queued; origin: the step the song started on; ahead: seconds already queued.
export function resumeStep({ next, origin = 0, ahead = 0, stepSec, ended = false }) {
  if (ended || !(stepSec > 0)) return 0;
  const sounding = next - origin - Math.max(0, ahead) / stepSec;
  return Math.max(0, Math.floor(sounding / 16) * 16);
}

// Where a song is (seconds) for the lock-screen progress bar; null for songs without a fixed length.
export function songClock({ bars, bpm, step = 0 }) {
  if (!(bars > 0) || !(bpm > 0)) return null;
  const sec = 15 / bpm;
  return { duration: bars * 16 * sec, position: Math.max(0, step) * sec };
}
