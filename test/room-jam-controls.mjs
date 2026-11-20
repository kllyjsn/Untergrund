// Real-Engine regression render based on Music's club-jam-refill repro.
import assert from 'node:assert/strict';
import { withChrome } from './chrome.mjs';

async function render(withEdit, route = true, action = '', actionAt = .9) {
  const { Engine, Sequencer } = await import('/js/engine.js');
  const { defaultState } = await import('/js/state.js');
  const { applyPart, extractPart, normalizeLayer } = await import('/js/jam.js');
  const sync = await import('/js/room-sync.js');
  const media = await import('/js/room-media-sync.js');
  const source = await (await fetch('/js/main.js')).text();
  const schedule = source.slice(source.indexOf('function schedule(lead)'), source.indexOf('\n// Jam:'));
  const jam = source.slice(source.indexOf('let jamQueue = [], jamRedraw = 0'), source.indexOf('\n// GENERATE while'));
  const start = source.slice(source.indexOf('function start({'), source.indexOf('\nfunction stop('));

  const rate = 48000, ctx = new OfflineAudioContext(2, 4 * rate, rate);
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
  const noop = () => {}, mediaRoute = route ? {} : null;
  const roomMediaSync = media.createRoomMediaSync();
  const env = {
    ...sync, ...media, seq, engine, ctx, state, applyPart, roomMediaSync, mediaRoute,
    document: {hidden: false, body: {classList: {add: noop}}, querySelectorAll: () => []}, Date: {now: () => 1000000 + 1000 * ctx.currentTime},
    playing: true, roomPlayback: true, songOver: false, queuedRoomReplay: null, roomEditor: false, roomFirstNote: null, clockOffset: 1000,
    abs: 0, nextTime: .06, transportOrigin: 1000100, uiQueue: [], handoff: null,
    timeline: {skip: () => 0}, artistTick: noop, midiClockStep: noop, BG_LEAD: 1.5, ROOM_LEAD: .42,
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
    clearPaused: noop, stopPreview: noop, closePractice: noop, ensureAudio: noop, roomResume: null,
    trackingReplay: true, pat: () => state.patterns[seq.cur], timer: {postMessage: noop},
    midiClockStart: noop, syncNowPlaying: noop, beginListen: noop, listenPos: noop,
    playStarted: noop, renderHome: noop, style: 'test',
    setTimeout: noop,
  };
  const land = [], revEvents = [], jamAt = [];
  const scheduleJamParams = engine.scheduleJamParams.bind(engine);
  engine.scheduleJamParams = (params, at) => { jamAt.push(at); return scheduleJamParams(params, at); };
  const setTo = engine.setTo.bind(engine);
  engine.setTo = (param, value, immediate) => {
    if (param === engine.ch.kick.rev.gain) revEvents.push({at: ctx.currentTime, when: engine.jamAt ?? ctx.currentTime, value});
    return setTo(param, value, immediate);
  };
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
  for (const t of [...Array.from({length: 66}, (_, i) => (i + 3) * .05), 2.06].sort((a,b) => a-b)) {
    if (['stall', 'multi'].includes(action) && t > 1.85 && t < 2.70) continue;
    ticks.push(ctx.suspend(t).then(async () => {
      if (t === .15 || Math.abs(t - .15) < 1e-9) {
        if (withEdit) api.queueJamPart('drums', layer, 1002100);
      }
      if (action === 'multi' && Math.abs(t - .4) < 1e-9) {
        const next = extractPart(state, 'drums'); next.params.kick.level = .9;
        api.queueJamPart('drums', normalizeLayer('drums', next), 1003100);
      }
      if (['seek', 'stop'].includes(action) && Math.abs(t - .9) < 1e-9) {
        if (action === 'stop') { api.cancelRoomPrime(); env.playing = false; }
        else api.start({startsAt: 1000100, room: true});
      }
      if (action === 'stop' && Math.abs(t - 1) < 1e-9) api.start({startsAt: 1000100, room: true});
      if (['replace', 'handoff'].includes(action) && Math.abs(t - actionAt) < 1e-9) {
        if (action === 'replace') api.cancelRoomPrime();
        state.params.kick.level = .7;
        if (action === 'replace') { engine.applyAll(); api.start({startsAt: 1000100, room: true}); }
        else engine.handoffIn(1.06);
      }
      await Promise.resolve();
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
  // Desktop plays the room grid (0.1 s + bars); the media route leads it to land at 0.06 s.
  const grid = route ? 0 : .04;
  return {initialQueueUntil, land, jamAt, rmsDb: [.06,.56,1.06,1.56,2.06,2.56,3.06].map(t => rms(t + grid)),
    tailDb: [1.64,1.72,1.80,1.88,1.98].map(t => rms(t + grid)), revEvents};
}

async function renderDrive(drive, edit = '') {
  const { Engine } = await import('/js/engine.js');
  const { defaultState } = await import('/js/state.js');
  const state = defaultState(), rate = 48000, ctx = new OfflineAudioContext(2, 4 * rate, rate);
  state.params.acid.drive = drive;
  const engine = new Engine(ctx, state, {realtime: false});
  engine.out.disconnect(ctx.destination);
  const oscillator = ctx.createOscillator(); oscillator.frequency.value = 200;
  const gain = ctx.createGain(); gain.gain.value = .2;
  oscillator.connect(gain).connect(engine.acidNodes.pre);
  engine.acidNodes.post.connect(ctx.destination);
  oscillator.start();
  if (edit) {
    for (const [at, value] of [[2.06, .8], [3.06, .3]]) {
      state.params.acid.drive = value;
      engine.scheduleJamParams({acid: {drive: value}}, at);
    }
    if (edit === 'cancel') engine.cancelJamParams();
  }
  const live = edit === 'live' ? ctx.suspend(1.06).then(async () => {
    engine.setParam('acid', 'drive', .5);
    await ctx.resume();
  }) : Promise.resolve();
  const [buffer] = await Promise.all([ctx.startRendering(), live]), y = buffer.getChannelData(0);
  return [1.56, 2.56, 3.56, .56].map(t => {
    let sum = 0;
    for (let i = Math.round(t * rate); i < Math.round((t + .075) * rate); i++) sum += y[i] ** 2;
    return 20 * Math.log10(Math.sqrt(sum / (.075 * rate)));
  });
}

async function renderBoundaryAutomation() {
  const { Engine } = await import('/js/engine.js');
  const { defaultState } = await import('/js/state.js');
  const state = defaultState(), rate = 48000, ctx = new OfflineAudioContext(1, 3 * rate, rate);
  const engine = new Engine(ctx, state, {realtime: false});
  engine.out.disconnect(ctx.destination);
  const dc = ctx.createConstantSource(), gain = engine.ch.kick.level.gain;
  dc.connect(engine.ch.kick.level).connect(ctx.destination); dc.start();
  gain.setValueAtTime(1, 0); gain.linearRampToValueAtTime(.5, engine.gridTime(2.1 + .4 / rate + 1e-13));
  const paths = [];
  const edits = [1, 1.2, 1.4, 1.7].map(t => ctx.suspend(t).then(async () => {
    state.params.acid.drive = .2 + t / 10;
    engine.scheduleJamParams({acid: {drive: state.params.acid.drive}}, t + .1);
    paths.push(engine.jamDrives.length);
    if (t === 1.7) { state.params.kick.level = .9; engine.scheduleJamParams({kick: {level: .9}}, 2.1 + .4 / rate); gain.linearRampToValueAtTime(.9, 2.6); }
    await ctx.resume();
  }));
  const [buffer] = await Promise.all([ctx.startRendering(), ...edits]), y = buffer.getChannelData(0);
  return {paths, gain: [.5, 1.05, 1.95, 2.09, 2.5].map(t => y[Math.round(t * rate)])};
}

async function renderHardPan(edit, style = 'hardtechno', shift = 0) {
  const { Engine } = await import('/js/engine.js');
  const { defaultState } = await import('/js/state.js');
  const state = defaultState(), rate = 48000, ctx = new OfflineAudioContext(1, 3 * rate, rate);
  state.bpm = 120; state.artist = {...state.artist, style: 'hardtechno'};
  const engine = new Engine(ctx, state, {realtime: false});
  engine.out.disconnect(ctx.destination);
  const dc = ctx.createConstantSource();
  dc.connect(engine.ch.kick.level).connect(ctx.destination); dc.start();
  engine.hardSection(.1, 4, 0, 4, 4);
  const done = ctx.suspend(1.7).then(async () => {
    state.artist = {...state.artist, style};
    if (edit) engine.scheduleJamParams(edit === true ? {kick: {pan: .3}} : edit, 2.1 + shift);
    engine.hardSection(2.1 + shift, 4, 1, 4, 4);
    await ctx.resume();
  });
  const [buffer] = await Promise.all([ctx.startRendering(), done]), y = buffer.getChannelData(0);
  return [1.9, 2.1 + shift, 2.2 + shift, 2.9].map(t => y[Math.round(t * rate)]);
}

async function renderHandoffFade() {
  const { Engine } = await import('/js/engine.js');
  const { defaultState } = await import('/js/state.js');
  const state = defaultState(), rate = 48000, ctx = new OfflineAudioContext(1, 4 * rate, rate);
  const engine = new Engine(ctx, state, {realtime: false}), t1 = 3 + .4 / rate;
  engine.out.disconnect(ctx.destination);
  const dc = ctx.createConstantSource(), gain = engine.ch.kick.level.gain;
  dc.connect(engine.ch.kick.level).connect(ctx.destination); dc.start();
  const done = ctx.suspend(2.5).then(async () => {
    gain.setValueAtTime(.9, 2.55); gain.linearRampToValueAtTime(.3, engine.gridTime(t1));
    state.params.kick.level = .8; engine.handoffIn(t1);
    await ctx.resume();
  });
  const [buffer] = await Promise.all([ctx.startRendering(), done]), y = buffer.getChannelData(0);
  return [2.8, 3.5].map(t => y[Math.round(t * rate)]);
}

const result = await withChrome(async run => {
  const out = {};
  for (const route of [true, false]) out[route ? 'primed' : 'desktop'] = {
    control: await run('(' + render.toString() + `)(false,${route})`),
    edited: await run('(' + render.toString() + `)(true,${route})`),
  };
  for (const action of ['seek', 'stop', 'stall', 'multi', 'replace', 'handoff']) out[action] = await run('(' + render.toString() + `)(true,true,${JSON.stringify(action)})`);
  out['desktop-replace'] = await run('(' + render.toString() + ')(true,false,"replace",1.9)');
  out.boundary = await run('(' + renderBoundaryAutomation.toString() + ')()');
  out.handoffFade = await run('(' + renderHandoffFade.toString() + ')()');
  out.hardPan = {control: await run('(' + renderHardPan.toString() + ')(false)'), edited: await run('(' + renderHardPan.toString() + ')(true)')};
  out.hardPanSwitch = await run('(' + renderHardPan.toString() + ')({kick: {level: .9, pan: .3}},"techno")');
  // A clock re-anchor moves the boundary past the queued section fade.
  out.hardPanShift = [];
  for (const shift of [-.1, -.06, -.02, .02, .06, .1])
    out.hardPanShift.push({control: await run('(' + renderHardPan.toString() + `)(false,"hardtechno",${shift})`), edited: await run('(' + renderHardPan.toString() + `)(true,"hardtechno",${shift})`)});
  out.drive = {};
  for (const drive of [.2, .8, .3, .5]) out.drive[drive] = await run('(' + renderDrive.toString() + `)(${drive})`);
  for (const edit of ['edit', 'cancel', 'live']) out.drive[edit] = await run('(' + renderDrive.toString() + `)(.2,${JSON.stringify(edit)})`);
  return out;
});
if (result) {
  console.log('Room jam control render', JSON.stringify(result));
  for (const {control, edited} of [result.primed, result.desktop]) {
    for (const i of [1,2,3]) {
      assert(control.rmsDb[i] > -30);
      assert(Math.abs(edited.rmsDb[i] - control.rmsDb[i]) < 1, 'pre-edit kicks remain intact');
    }
    assert(edited.rmsDb[4] < -100, 'the boundary kick is silent even with all timers blocked');
    assert(edited.rmsDb[5] < -100, 'the following kick stays silent');
    for (const [i, db] of control.tailDb.entries())
      assert(Math.abs(edited.tailDb[i] - db) < 1, 'the previous bar rings out until the boundary');
  }
  assert.equal(result.primed.control.initialQueueUntil, result.primed.edited.initialQueueUntil);
  assert(result.primed.edited.land.every(e => e.at < 1.85), 'native changes are submitted ahead of the boundary');
  assert(result.desktop.edited.land.every(e => e.at < 2.06), 'desktop controls are submitted ahead of the boundary');
  assert(Math.abs(result.primed.edited.jamAt[0] - 2.06) < 1e-6 && Math.abs(result.desktop.edited.jamAt[0] - 2.1) < 1e-6,
    'each route schedules the edit on its own bar boundary');
  for (const action of ['seek', 'stop']) {
    const r = result[action];
    assert(r.rmsDb[1] > -30, 'the kick before cancellation remains intact');
    for (const i of [2,3,4,5]) assert(r.rmsDb[i] < -100, `${action}: the restarted mix retains the updated kick level`);
    const rev = r.revEvents.at(-1);
    assert.equal(rev.value, .6, `${action}: pending FX controls survive cancellation`);
    assert(rev.when > .9 && rev.when < 1);
    assert.equal(r.land.length, 2, 'only initial scheduling and cancellation apply controls');
    assert(r.land[1].at >= .9 && r.land[1].at < 1);
  }
  for (const action of ['stall', 'multi']) {
    const r = result[action], control = result.primed.control;
    for (const i of [1,2,3]) assert(Math.abs(r.rmsDb[i] - control.rmsDb[i]) < 1);
    for (const i of [4,5]) assert(r.rmsDb[i] < -100, 'the first boundary edit survives a stalled main thread and a later edit');
    if (action === 'multi') assert(Math.abs(r.rmsDb[6] - control.rmsDb[6]) < 1, 'the second boundary restores the kick');
    else assert(r.rmsDb[6] < -100);
  }
  console.log('Room jam stall/multiple edits PASS: native AudioParams mute 2.06/2.56s during a 1.85-2.70s timer/scheduler gap; the later edit restores 3.06s.');
  for (const [i, drive] of [.2, .8, .3].entries()) {
    assert(Math.abs(result.drive.edit[i] - result.drive[drive][i]) < .01, 'acid drive switches native paths at each boundary');
    assert(Math.abs(result.drive.cancel[i] - result.drive[.3][i]) < .01, 'cancel restores the latest drive and removes future switches');
  }
  const {gain, paths} = result.boundary, ramp = t => 1 - .5 * t / 2.1;
  for (const [i, t] of [.5, 1.05, 1.95, 2.09].entries()) assert(Math.abs(gain[i] - ramp(t)) < .01, 'a fade ending on the jam boundary plays out');
  assert(Math.abs(gain[4] - .9) < .01);
  assert(Math.max(...paths) <= 2, 'superseded acid drive paths are released');
  for (const [i, v] of result.hardPan.control.entries())
    assert(Math.abs(20 * Math.log10(result.hardPan.edited[i] / v)) < .05, 'a pan-only edit keeps the Hard Techno section level');
  assert(Math.abs(result.hardPanSwitch[2] - .9) < .01, 'a set that leaves Hard Techno drops its section levels');
  for (const {control, edited} of result.hardPanShift) for (const [i, v] of control.entries())
    assert(Math.abs(20 * Math.log10(edited[i] / v)) < .05, 'a pan-only edit keeps the section level whichever way the clock re-anchors');
  assert(Math.abs(result.handoffFade[0] - (.9 - .6 * .25 / .45)) < .01 && Math.abs(result.handoffFade[1] - .8) < .01, 'a handoff on a fade end takes the incoming level');
  console.log('Room jam FX PASS: acid waveshaper and post-gain switch at both audio-clock boundaries; cancel restores one current path.');
  assert(Math.abs(result.drive.live[3] - result.drive[.2][3]) < .01, 'the pre-knob acid retains its original timbre');
  for (const i of [0,1,2]) assert(Math.abs(result.drive.live[i] - result.drive[.5][i]) < .01,
    'a live acid knob changes the active path now and overrides both pending drive boundaries');
  console.log('Room jam live drive PASS: setParam changes the active acid now and carries its drive/post-gain across both queued boundaries.');
  console.log('Room jam restart PASS: real Engine stop/resume and seek retain updated levels/FX and invalidate old callbacks.');
  for (const action of ['replace', 'handoff']) for (const i of [3,4,5,6])
    assert(Math.abs(result[action].rmsDb[i] - result.primed.control.rmsDb[i] - 20 * Math.log10(.7 / .9)) < .01,
      'old jam automation cannot override a replacement or handoff mix');
  for (const i of [3,5,6]) assert(Math.abs(result['desktop-replace'].rmsDb[i] - result.desktop.control.rmsDb[i] - (i > 3 ? 20 * Math.log10(.7 / .9) : 0)) < .01,
    'a desktop replacement between submission and the boundary cancels the pending jam automation');
  console.log('Room jam controls PASS: real Engine retains 0.56/1.06/1.56s kicks, applies the level edit on the bar boundary (2.06s media route, 2.1s desktop), and lets the 1.56s bar ring out to the boundary.');
} else console.log('Room jam controls SKIP: Chrome not installed');
