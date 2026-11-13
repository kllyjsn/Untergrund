import assert from 'node:assert/strict';
import { createNowPlaying, resumeStep, songClock, ACTIONS, APP_ART } from '../js/media-session.js';

function fakeSession({ throwOn = [] } = {}) {
  const log = [], handlers = {};
  const session = {
    metadata: null, playbackState: 'none',
    setActionHandler(a, fn) { if (throwOn.includes(a)) throw new TypeError(`${a} unsupported`); handlers[a] = fn; log.push(['action', a, !!fn]); },
    setPositionState(p) { log.push(['position', p]); },
  };
  class Metadata { constructor(o) { Object.assign(this, o); log.push(['metadata', o.title]); } }
  return { session, Metadata, log, handlers };
}

// No API: every call is a harmless no-op.
{
  const np = createNowPlaying({ session: undefined, Metadata: undefined });
  assert.equal(np.supported, false);
  np.metadata({ title: 'x' }); np.state('playing'); np.actions({ play() {} }); np.position({ duration: 10 });
}

// Metadata falls back to the app icon, and identical updates don't touch the session.
{
  const f = fakeSession(), np = createNowPlaying(f);
  np.metadata({ title: 'Night Bus', artist: 'Ada', album: 'UNTERGRUND · TECHNO' });
  assert.equal(f.session.metadata.title, 'Night Bus');
  assert.equal(f.session.metadata.artist, 'Ada');
  assert.deepEqual(f.session.metadata.artwork, APP_ART);
  np.metadata({ title: 'Night Bus', artist: 'Ada', album: 'UNTERGRUND · TECHNO' });
  assert.equal(f.log.filter((l) => l[0] === 'metadata').length, 1, 'deduped');
  const art = [{ src: 'blob:x', sizes: '512x512', type: 'image/jpeg' }];
  np.metadata({ title: 'Night Bus', artist: 'Ada', album: 'UNTERGRUND · TECHNO', artwork: art });
  assert.deepEqual(f.session.metadata.artwork, art, 'cover replaces the icon once drawn');
  np.metadata({ title: '' });
  assert.equal(f.session.metadata, null, 'empty title clears the card');
}

// Playback state is set once per change.
{
  const f = fakeSession(), np = createNowPlaying(f);
  let writes = 0;
  Object.defineProperty(f.session, 'playbackState', { set() { writes++; }, get() { return ''; } });
  np.state('playing'); np.state('playing'); np.state('paused');
  assert.equal(writes, 2);
}

// Handlers: missing ones are cleared (button disabled), unchanged ones aren't rebound, unsupported ones don't throw.
{
  const f = fakeSession({ throwOn: ['previoustrack'] }), np = createNowPlaying(f);
  const play = () => 'play', next = () => 'next';
  np.actions({ play, nexttrack: next });
  assert.equal(f.handlers.play, play);
  assert.equal(f.handlers.nexttrack, next);
  assert.equal(f.handlers.pause, null);
  const n = f.log.length;
  np.actions({ play, nexttrack: next });
  assert.equal(f.log.length, n, 'no rebinding');
  np.actions({ play });
  assert.equal(f.handlers.nexttrack, null, 'a Club listener loses ⏭');
  assert.deepEqual(ACTIONS, ['play', 'pause', 'nexttrack', 'previoustrack']);
}

// Position: clamped, deduped, and cleared without a duration.
{
  const f = fakeSession(), np = createNowPlaying(f);
  np.position({ duration: 120, position: 130 });
  assert.deepEqual(f.log.at(-1), ['position', { duration: 120, position: 120, playbackRate: 1 }]);
  np.position({ duration: 120, position: 120 });
  assert.equal(f.log.filter((l) => l[0] === 'position').length, 1);
  np.position({});
  assert.deepEqual(f.log.at(-1), ['position', undefined]);
}

// Resume picks up at the start of the bar that was sounding, not the one already queued.
{
  const stepSec = 60 / 120 / 4; // 0.125 s
  assert.equal(resumeStep({ next: 16 * 5 + 3, ahead: 0.1, stepSec }), 80);
  assert.equal(resumeStep({ next: 16 * 5 + 1, ahead: 0.5, stepSec }), 64, '4 queued steps reach back into bar 4');
  assert.equal(resumeStep({ next: 16 * 9 + 4, origin: 16 * 3, ahead: 0, stepSec }), 96, 'counted from where the song started');
  assert.equal(resumeStep({ next: 3, ahead: 1.5, stepSec }), 0, 'never before bar 1');
  assert.equal(resumeStep({ next: 300, ahead: 0, stepSec, ended: true }), 0, 'a finished song starts over');
  // Background lookahead (1.5 s) still lands on the sounding bar.
  assert.equal(resumeStep({ next: 16 * 6 + 8, ahead: 1.5, stepSec }), 80);
}

// Song clock for the lock-screen progress bar.
{
  assert.deepEqual(songClock({ bars: 64, bpm: 120, step: 32 }), { duration: 128, position: 4 });
  assert.equal(songClock({ bars: 0, bpm: 120 }), null);
}

// The native iOS bridge receives the same state and can drive the existing remote actions.
{
  const messages = [], listeners = {};
  const native = { postMessage(message) { messages.push(message); } };
  const events = { addEventListener(name, fn) { listeners[name] = fn; } };
  const np = createNowPlaying({ session: undefined, Metadata: undefined, native, events });
  let plays = 0;
  np.metadata({ title: 'Night Bus', artist: 'Ada', album: 'UNTERGRUND · LIVE' });
  np.state('playing');
  np.actions({ play: () => { plays++; }, pause: () => {} });
  np.position({ duration: 120, position: 130 });
  assert.equal(np.supported, true);
  assert.deepEqual(messages, [
    { type: 'nowPlaying', title: 'Night Bus', artist: 'Ada', album: 'UNTERGRUND · LIVE' },
    { type: 'playback', state: 'playing' },
    { type: 'actions', actions: ['play', 'pause'] },
    { type: 'position', duration: 120, position: 120 },
  ]);
  listeners['untergrund:native-command']({ detail: { action: 'play' } });
  listeners['untergrund:native-command']({ detail: { action: 'bogus' } });
  assert.equal(plays, 1);
}

console.log('media-session ok');
