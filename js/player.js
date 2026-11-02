// Minimal standalone player for public pages: plays a stored song state through the real engine, once through its arrangement.
import { Engine, Sequencer, parseChain } from './engine.js';
import { sanitize } from './state.js';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function songBars(state) {
  const chain = state.chainOn ? parseChain(state.chain) : [];
  return chain.length ? Math.min(chain.length, 64) : 8;
}

export function createPlayer({ onBar = () => {}, onEnd = () => {} } = {}) {
  let ctx = null, engine = null, seq = null, state = null, timer = 0, playing = false, abs = 0, nextTime = 0, total = 0, media = null;
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
        if (ctx.currentTime > nextTime + 0.3) { stop(); onEnd(); }
        return;
      }
      if (abs % 16 === 0) { const bar = abs / 16, at = nextTime; setTimeout(() => playing && onBar(bar, total), Math.max(0, (at - ctx.currentTime) * 1000)); }
      seq.tick(abs, nextTime);
      nextTime += engine.stepDur;
      abs++;
    }
  };
  function play(raw) {
    state = sanitize(raw);
    ensure(state);
    engine.state = state; seq.s = state; engine.applyAll();
    const chain = state.chainOn ? parseChain(state.chain) : [];
    total = songBars(state);
    abs = 0;
    seq.cur = chain.length ? chain[0] : state.current;
    seq.queued = null; seq.chainPos = 0; seq.acidPrevSlide = false;
    nextTime = ctx.currentTime + 0.08;
    playing = true;
    clearInterval(timer);
    timer = setInterval(tick, 25);
    tick();
  }
  function stop() {
    playing = false;
    clearInterval(timer);
    engine?.panic();
  }
  return { play, stop, get playing() { return playing; }, get analyser() { return engine?.analyser; }, duration: (s) => (songBars(sanitize(s)) * 16 * 15) / sanitize(s).bpm };
}
