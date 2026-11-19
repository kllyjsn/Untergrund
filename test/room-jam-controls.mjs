// Real-Engine regression render based on Music's club-jam-refill repro.
import assert from 'node:assert/strict';
import { withChrome } from './chrome.mjs';

async function render(withEdit, route = true, action = '') {
  const { Engine, Sequencer } = await import('/js/engine.js');
  const { defaultState } = await import('/js/state.js');
  const { applyPart, extractPart, normalizeLayer } = await import('/js/jam.js');
  const sync = await import('/js/room-sync.js');
  const media = await import('/js/room-media-sync.js');
  const source = await (await fetch('/js/main.js')).text();
  const schedule = source.slice(source.indexOf('function schedule(lead)'), source.indexOf('\n// Jam:'));
  const jam = source.slice(source.indexOf('let jamQueue = [], jamRedraw = 0'), source.indexOf('\n// GENERATE while'));
  const start = source.slice(source.indexOf('function start({'), source.indexOf('\nfunction stop('));

  const rate = 48000, ctx = new OfflineAudioContext(2, 3 * rate, rate);
  const state = defaultState();
  state.bpm = 120;
  state.swing = 0;
  state.params.kick.level = .9;
  for (const pattern of state.patterns)
    pattern.steps.kick = Array.from({length: 16}, (_, i) => +(i % 4 === 0));
  state.patterns.forEach(p => { p.len.kick = 16; });
  for (const part of Object.keys(state.params)) state.mutes[part] = part !== 'kick';
  const rawLayer = extractPart(state, 'drums');
  rawLayer.params.kick.level = 0;
  rawLayer.params.kick.rev = .6;
  const layer = normalizeLayer('drums', rawLayer);
  if (layer.params.kick.level !== 0) throw new Error('Layer must pass the server normalizer at zero kick level');

  const engine = new Engine(ctx, state, {realtime: false, trackQueuedNotes: true});
  engine.out.disconnect(ctx.destination);
  engine.ch.kick.level.connect(ctx.destination);
  const seq = new Sequencer(engine, state);
  seq.startAt(0, .06);
  const noop = () => {}, mediaRoute = route ? {} : null, timers = [];
  const roomMediaSync = media.createRoomMediaSync();
  const env = {
    ...sync, ...media, seq, engine, ctx, state, applyPart, roomMediaSync, mediaRoute,
    document: {hidden: false, body: {classList: {add: noop}}, querySelectorAll: () => []}, Date: {now: () => 1000000 + 1000 * ctx.currentTime},
    playing: true, roomPlayback: true, songOver: false, roomEditor: false, clockOffset: 1000,
    abs: 0, nextTime: .06, transportOrigin: 1000100, uiQueue: [], handoff: null,
    timeline: {skip: () => 0}, artistTick: noop, midiClockStep: noop, BG_LEAD: 1.5, ROOM_LEAD: .42,
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
    clearPaused: noop, stopPreview: noop, closePractice: noop, ensureAudio: noop, roomResume: null,
    trackingReplay: true, pat: () => state.patterns[seq.cur], timer: {postMessage: noop},
    midiClockStart: noop, syncNowPlaying: noop, beginListen: noop, listenPos: noop,
    playStarted: noop, renderHome: noop, style: 'test',
    setTimeout: (fn, ms) => timers.push({ fn, at: ctx.currentTime + ms / 1000 }),
  };
  const land = [];
  const applyParam = engine.applyParam.bind(engine);
  engine.applyParam = (track, key, immediate) => {
    const prev = engine.ch.kick.level.gain.value;
    const ret = applyParam(track, key, immediate);
    if (track === 'kick' && key === 'level') land.push({at: ctx.currentTime, prev, next: engine.ch.kick.level.gain.value});
    return ret;
  };
  const api = new Function('env', 'with(env){' + schedule + '\n' + jam + '\n' + start + '\nreturn {schedule,queueJamPart,start,cancelRoomPrime};}')(
    env);
  roomMediaSync.begin({broadcastId:'room:test', startsAt:1000100, state}, false, false, mediaRoute);
  roomMediaSync.start(true, mediaRoute);
  api.schedule();
  const initialQueueUntil = env.nextTime;
  const ticks = [];
  for (const t of [...Array.from({length: 50}, (_, i) => (i + 3) * .05), 2.06].sort((a,b) => a-b)) {
    ticks.push(ctx.suspend(t).then(async () => {
      if (t === .15 || Math.abs(t - .15) < 1e-9) {
        if (withEdit) api.queueJamPart('drums', layer, 1002100);
      }
      if (action && Math.abs(t - .9) < 1e-9) {
        if (action === 'stop') { api.cancelRoomPrime(); env.playing = false; }
        else api.start({startsAt: 1000100, room: true});
      }
      if (action === 'stop' && Math.abs(t - 1) < 1e-9) api.start({startsAt: 1000100, room: true});
      await Promise.resolve();
      const due = timers.filter(timer => timer.at <= ctx.currentTime);
      for (const timer of due) { timers.splice(timers.indexOf(timer), 1); timer.fn(); }
      api.schedule();
      await ctx.resume();
    }));
  }
  const [buf] = await Promise.all([ctx.startRendering(), Promise.all(ticks)]);
  const y = buf.getChannelData(0);
  const rms = t => {
    const a = Math.round(t * rate), b = a + 0.075 * rate;
    let s = 0;
    for (let i=a; i<b; i++) s += y[i] * y[i];
    return 20 * Math.log10(Math.max(1e-8, Math.sqrt(s/(b-a))));
  };
  return {initialQueueUntil, land, rmsDb: [.06,.56,1.06,1.56,2.06,2.56].map(rms), boundaryTailDb: rms(2.06 + 128 / rate), revGain: engine.ch.kick.rev.gain.value};
}

const result = await withChrome(async run => {
  const out = {};
  for (const route of [true, false]) out[route ? 'primed' : 'desktop'] = {
    control: await run('(' + render.toString() + `)(false,${route})`),
    edited: await run('(' + render.toString() + `)(true,${route})`),
  };
  for (const action of ['seek', 'stop']) out[action] = await run('(' + render.toString() + `)(true,true,${JSON.stringify(action)})`);
  return out;
});
if (result) {
  console.log('Room jam control render', JSON.stringify(result));
  for (const {control, edited} of [result.primed, result.desktop]) {
    for (const i of [1,2,3]) {
      assert(control.rmsDb[i] > -30);
      assert(Math.abs(edited.rmsDb[i] - control.rmsDb[i]) < 1, 'pre-edit kicks remain intact');
    }
    assert(control.boundaryTailDb > -30);
    assert(edited.boundaryTailDb < -100, 'the boundary kick is silent after the deferred audio-clock callback quantum');
    assert(edited.rmsDb[5] < -100, 'the following kick stays silent');
  }
  assert.equal(result.primed.control.initialQueueUntil, result.primed.edited.initialQueueUntil);
  assert(result.primed.edited.land.every(e => e.at >= 2.06 && e.at < 2.06 + 128 / 48000));
  assert(result.desktop.edited.land.every(e => e.at < 2.06), 'desktop keeps its existing cutoff application');
  for (const action of ['seek', 'stop']) {
    const r = result[action];
    assert(r.rmsDb[1] > -30, 'the kick before cancellation remains intact');
    for (const i of [2,3,4,5]) assert(r.rmsDb[i] < -100, `${action}: the restarted mix retains the updated kick level`);
    assert(Math.abs(r.revGain - .6) < 1e-6, `${action}: pending FX controls survive cancellation`);
    assert.equal(r.land.length, 1, 'the canceled callback cannot reapply after restart');
    assert(r.land[0].at >= .9 && r.land[0].at < 1);
  }
  console.log('Room jam restart PASS: real Engine stop/resume and seek retain updated levels/FX and invalidate old callbacks.');
  console.log('Room jam controls PASS: real Engine retains 0.56/1.06/1.56s kicks, applies the level edit at 2.06s, and preserves the desktop cutoff.');
} else console.log('Room jam controls SKIP: Chrome not installed');
