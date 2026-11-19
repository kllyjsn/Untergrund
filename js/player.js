// Minimal standalone player for public pages: plays a stored song state through the real engine, once through its arrangement.
import { Engine, Sequencer, parseChain } from './engine.js';
import { sanitize, refreshSong } from './state.js';
import { liveSet, liveSets, loadSets, setsReady, withTakes } from './livekit.js';
import { createPlaybackAnalytics } from './playback-analytics.js';

// The song as it plays: untouched GENERATE songs come back through today's generator (refreshSong).
export const songOf = (raw) => refreshSong(sanitize(raw));

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function songBars(state) {
  const chain = state.chainOn ? parseChain(state.chain) : [];
  return chain.length ? Math.min(chain.length, 128) : 8;
}

export function createPlayer({ onStart = () => {}, onBar = () => {}, onEnd = () => {} } = {}) {
  const analytics = createPlaybackAnalytics();
  let ctx = null, engine = null, seq = null, state = null, timer = 0, playing = false, abs = 0, nextTime = 0, total = 0, media = null;
  let pending = null, tuningTimer = 0, playback = 0;
  const ensure = (s) => {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
      engine = new Engine(ctx, s);
      if (isIOS() && ctx.createMediaStreamDestination) {
        const route = ctx.createMediaStreamDestination();
        try { engine.out.disconnect(ctx.destination); } catch { engine.out.disconnect(); if (engine.analyser) engine.out.connect(engine.analyser); }
        engine.out.connect(route);
        media = Object.assign(document.createElement('audio'), { autoplay: true, srcObject: route.stream });
        media.setAttribute('playsinline', '');
        media.style.display = 'none';
        document.body.append(media);
      }
      seq = new Sequencer(engine, s);
    }
    if (ctx.state !== 'running') ctx.resume();
    media?.play().catch(() => {});
  };
  const tick = () => {
    if (!playing) return;
    while (nextTime < ctx.currentTime + 0.12) {
      if (abs >= total * 16) {
        if (ctx.currentTime > nextTime + 0.3) { stop('complete'); onEnd(); }
        return;
      }
      if (abs % 16 === 0) {
        const bar = abs / 16, at = nextTime, run = playback;
        setTimeout(() => playback === run && onBar(bar, total), Math.max(0, (at - ctx.currentTime) * 1000));
      }
      seq.tick(abs, nextTime);
      nextTime += engine.stepDur;
      abs++;
    }
  };
  function play(raw, releaseId) {
    if (playing) stop('skip');
    state = songOf(raw);
    ensure(state);
    playing = true;
    const sets = withTakes(liveSets(state));
    const start = pending = () => {
      if (pending !== start) return;
      clearTimeout(tuningTimer); pending = null;
      engine.state = state; seq.s = state; engine.applyAll();
      // Once a song starts, late downloads must not change its instrumentation.
      engine.recLock = new Map(sets.map((name) => [name, !!liveSet(name)]));
      const chain = state.chainOn ? parseChain(state.chain) : [];
      total = songBars(state);
      abs = 0;
      seq.cur = chain.length ? chain[0] : state.current;
      seq.queued = null; seq.chainPos = 0; seq.acidPrevSlide = false;
      nextTime = ctx.currentTime + 0.08;
      const at = nextTime, steps = total * 16;
      if (releaseId) analytics.start({ surface: 'public', trackId: releaseId }, { ctx, at, from: 0,
        progress: () => (abs - Math.max(0, nextTime - ctx.currentTime) / engine.stepDur) / steps });
      timer = setInterval(tick, 25);
      tick();
      onStart();
    };
    if (setsReady(sets)) start();
    else {
      tuningTimer = setTimeout(start, 8000);
      loadSets(sets).then(start, start);
    }
  }
  function stop(outcome) {
    analytics.end(outcome);
    playing = false;
    playback++;
    clearTimeout(tuningTimer); pending = null;
    clearInterval(timer);
    engine?.panic();
  }
  return { play, stop, get playing() { return playing; }, get loading() { return !!pending; }, get analyser() { return engine?.analyser; }, duration: (raw) => { const s = songOf(raw); return (songBars(s) * 16 * 15) / s.bpm; } };
}
