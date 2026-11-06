import { track as trackEvent, reportError, playStarted, playStopped } from './analytics.js';
import { TRACKS, TRACK_IDS, TRACK_BY_ID, MIX_PARAMS, MASTER_PARAMS, KEYS, SCALES, PATTERN_NAMES, STEPS, formatValue, VOICE_HIDDEN } from './params.js';
import { Engine, Sequencer, parseChain } from './engine.js';
import { defaultState, generate, mutate, arrangement, songChain, applyOverrides, clone, save, load, sanitize, STYLES, emptyPattern, emptyAcidStep } from './state.js';
import { renderBars, bufferToWav } from './render.js';
import { exportButtons } from './export-ui.js';
import { encodeWav, rng } from './dsp.js';
import { knob, numBox, h } from './ui.js';
import { openPublish } from './publish.js';
import { createSetRecorder, openSetCutter, openSongPublish, openJukebox, fmtTime, loadReplay } from './sets.js';
import { loadArtistProfile, openArtistStudio } from './artist.js';
import { openClub, loadAvatar } from './club.js';
import { playTimeline, stopTimeline } from './live-sets.js';
import { saveTrack, trackTitle, recentTracks, fetchTrack, countPlay } from './crate.js';
import { dropCard } from './drop.js';
import { getSample, onSample, loadAudioFile, startRecording, useSynthVox, restoreSample } from './sampler.js';
import { roomTransportPosition, transportResync } from './room-sync.js';
import { concertPanel, concertBar, preloadScore, scoreReady, loadPiano } from './concert.js';
import { liveSets, loadSets, setsReady } from './livekit.js';
import { closePractice } from './practice-ui.js';
import { initMidi, midiStrip, midiClockStart, midiClockStep, midiClockStop } from './midi-studio.js';
import { openHum, melodyPanel, humButton, placeHook, humSeed } from './hum-ui.js';
import { restoreVoice } from './voice.js';
import { compose } from './classical.js';
import { PIECE, loadPiece } from './repertoire.js';
import { followingRow } from './feed.js';
import { describeBar } from './describe-ui.js';
import { fetchPublicTrack } from './account.js';
import { openShare, openSharedLanding, countRemix, track } from './share.js';
import { readShareParams, decodeSong, normalizeSong, remixState } from './share-code.js';
import { dailyDrop, dropSong } from './daily.js';
import { songTimeline } from './timeline-ui.js';
import { handoffStep, reanchor, MIN_LEAD } from './handoff.js';

let state = load() || defaultState();
let ctx = null, engine = null, seq = null, timer = null, setRec = null;
const heldPads = new Map(), keyPads = new Set();
// A held pad releases wherever the finger lifts, even if the pad was re-rendered mid-hold
addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse' || !e.buttons) for (const k of [...heldPads.keys()]) if (!keyPads.has(k)) ui.perf?.[k]?.up(); });
addEventListener('blur', () => { for (const k of [...heldPads.keys()]) ui.perf?.[k]?.up(); });
let playing = false, abs = 0, nextTime = 0, lastPlayedPat = null;
let transportOrigin = 0, roomJoinTimer = 0, clockOffset = null;
// A song waiting for its downbeat: { step, from, plan, out } (see queueSong).
let handoff = null;
const uiQueue = [];
let selected = 'kick';
let family = localStorage.getItem('untergrund.family') || 'TECHNO';
// Reopen on the saved project's genre when it belongs to the remembered family, else that family's first genre.
let style = STYLES[state.artist?.style]?.family === family ? state.artist.style
  : Object.keys(STYLES).find((id) => STYLES[id].family === family) || 'hypnotic';
family = STYLES[style].family;
let generatedAt = 0;
function showCrash(err) {
  if (document.querySelector('.crash')) return;
  console.error(err);
  document.body.append(h('div', { class: 'crash' }, h('b', {}, 'Something glitched.'), h('span', {}, 'Your project is saved.'), h('button', { class: 'btn accent', onclick: () => location.reload() }, 'RECOVER')));
}
window.addEventListener('error', (e) => showCrash(e.error || e.message));
let studioOpen = localStorage.getItem('untergrund.studio-open') === '1';
let variation = 0.25;
let artistLive = null;
let clipboard = null;
const undoStack = [];
const ui = { rows: {}, playhead: -1 };

const app = document.getElementById('app');
const isText = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');

let saveTimer = 0;
// While someone else's song plays (shared link, jukebox) the listener's own project stays untouched in storage.
let guest = null;
function persist() { if (guest) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => save(state), 300); }

// ---------------- audio ----------------
// iOS can route Web Audio through the ringer channel even when the page has an
// active media session. Route the real master bus through an <audio> element so
// it uses the same media channel as music and video playback.
let mediaUnlock = null;
let mediaRoute = null;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function unlockMediaChannel() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  if (mediaUnlock?.paused) mediaUnlock.play().catch(() => {});
}

function ensureAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  if (ctx) {
    if (ctx.state !== 'running') ctx.resume()?.catch?.((err) => reportError(err, { kind: 'audio_resume' }));
    if (mediaUnlock?.paused) mediaUnlock.play().catch(() => {});
    return;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: matchMedia('(pointer: coarse)').matches ? 'playback' : 'balanced' });
  } catch (err) { reportError(err, { kind: 'audio_context' }); throw err; }
  engine = new Engine(ctx, state);
  if (isIOS() && ctx.createMediaStreamDestination) {
    mediaRoute = ctx.createMediaStreamDestination();
    try { engine.out.disconnect(ctx.destination); } catch {
      engine.out.disconnect();
      if (engine.analyser) engine.out.connect(engine.analyser);
    }
    engine.out.connect(mediaRoute);
    mediaUnlock = document.createElement('audio');
    mediaUnlock.setAttribute('playsinline', '');
    mediaUnlock.setAttribute('x-webkit-airplay', 'deny');
    mediaUnlock.autoplay = true;
    mediaUnlock.srcObject = mediaRoute.stream;
    mediaUnlock.style.display = 'none';
    document.body.append(mediaUnlock);
    unlockMediaChannel();
  }
  seq = new Sequencer(engine, state);
  const src = "let id=null;onmessage=e=>{if(e.data==='start'&&!id)id=setInterval(()=>postMessage(0),15);if(e.data==='stop'){clearInterval(id);id=null;}}";
  timer = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  timer.onmessage = schedule;
  setRec = createSetRecorder(ctx, engine.out);
}

// lead: how far ahead to queue audio (seconds); the worker tick passes its message event.
let songOver = false;
function schedule(lead) {
  if (!playing || songOver) return;
  const ahead = typeof lead === 'number' ? lead : 0.12;
  const offset = Date.now() / 1000 - ctx.currentTime;
  clockOffset = clockOffset === null ? offset : clockOffset + (offset - clockOffset) * 0.05;
  let base = 60 / state.bpm / 4, landed = null;
  const target = transportOrigin / 1000 + abs * base - clockOffset;
  const fix = transportResync(target, nextTime, ctx.currentTime, base);
  if (fix) {
    for (let i = 0; i < fix.skip; i++, abs++) { artistTick(abs - seq.origin); seq.advanceBar(abs - seq.origin, ctx.currentTime); }
    nextTime = fix.nextTime;
  }
  // Landing redraws the whole UI for the new song, so schedule further ahead first to ride out that frame.
  while (nextTime < ctx.currentTime + (landed ? Math.max(ahead, 0.5) : ahead)) {
    if (handoff && !handoff.out && abs >= handoff.from) { engine.handoffOut(nextTime, nextTime + (handoff.step - abs) * engine.stepDur); handoff.out = true; }
    // A stalled main thread can make the resync skip the planned downbeat; then the new song
    // starts on the first step that still sounds rather than holding the sweep for another bar.
    if (handoff && abs >= handoff.step) { landed = landSong(nextTime); base = 60 / state.bpm / 4; }
    const skip = (abs - seq.origin) % 16 === 0 ? timeline.skip(seq.chainPos) : 0;
    if (skip) {
      abs += skip * 16; seq.chainPos += skip; transportOrigin -= skip * 16 * base * 1000;
      if (handoff?.step != null) { handoff.step += skip * 16; handoff.from += skip * 16; }
    }
    artistTick(abs - seq.origin);
    const pat = seq.tick(abs, nextTime);
    uiQueue.push({ abs: abs - seq.origin, t: nextTime, pat });
    // A score breathes (rubato): the transport clock follows the stretched step, not the metronome.
    const sd = engine.stepDur;
    midiClockStep(ctx, abs, nextTime, sd);
    nextTime += sd;
    transportOrigin += (sd - base) * 1000;
    abs++;
    // A generated song has played its final bar: let it ring, then stop rather than loop back to the intro.
    if (seq.finished && !handoff) {
      songOver = true;
      setTimeout(() => playing && songOver && stop(), Math.max(0, nextTime - ctx.currentTime + 2.5) * 1000);
      break;
    }
  }
  // The audio is queued; now redraw for the new song (it sounds ~0.1 s from now).
  landed?.();
}

// GENERATE while a song plays: keep the clock running and switch on a coming downbeat.
// Pressing again replaces the waiting song; the switch moment and transition stay put.
// A song on recordings not yet downloaded waits (the old one keeps playing) until they're in, up to 8 s.
function queueSong(plan) {
  if (!handoff) handoff = { since: performance.now() };
  const h = handoff;
  h.plan = plan;
  const tryArm = () => {
    if (handoff !== h || h.step != null || !playing) return;
    if (!setsReady(liveSets(h.plan.next)) && performance.now() - h.since < 7990) return;
    // The sweep needs its own lead past the audio already queued, not just from now.
    const lead = nextTime - ctx.currentTime;
    const at = handoffStep({ abs, lead, stepSec: engine.stepDur, origin: seq.origin, minLead: Math.max(MIN_LEAD, lead + 0.4) });
    Object.assign(h, at, { due: performance.now() + at.at * 1000, total: at.at * 1000, out: false });
    renderHome();
  };
  loadSets(liveSets(plan.next)).catch(() => {}).then(tryArm);
  setTimeout(tryArm, 8000 - (performance.now() - h.since));
  tryArm();
  const when = h.step == null ? 'seating the band' : 'on the bar';
  if (!plan.quiet) toast(plan.next.artist?.title ? `Up next: “${plan.next.artist.title}” · ${when}` : `Up next · ${when}`);
  renderHome();
}

// The waiting song takes over on this downbeat (time t): same transport, MIDI clock and
// room clock; the new song starts from its own bar 1 at its own tempo (snapped on the bar).
function landSong(t) {
  const { plan } = handoff;
  handoff = null;
  const fromBpm = state.bpm;
  if (plan.undo) pushUndo();
  autoMajor = plan.autoMajor ?? false;
  for (const k of Object.keys(state)) if (!(k in plan.next)) delete state[k];
  Object.assign(state, plan.next);
  transportOrigin = reanchor(transportOrigin, abs, fromBpm, state.bpm);
  const chain = state.chainOn ? parseChain(state.chain) : [];
  state.current = chain.length ? chain[0] : state.current;
  Object.assign(seq, { origin: abs, chainPos: 0, cur: state.current, queued: null, acidPrevSlide: false, dropNext: false });
  engine.handoffIn(t);
  if (engine.recLock) engine.recLock = new Map();
  uiQueue.length = 0;
  lastPlayedPat = null;
  return () => plan.finish(true);
}

// A song on recorded instruments holds its first downbeat until they're decoded (up to 8 s); a score waits longer,
// since its orchestra has no synth stand-in. Recordings already here start at once, as do seeks and clock-synced starts.
let tuning = null;
function needsTuning() {
  const sc = pat()?.score;
  if (sc) return scoreReady(sc) ? null : { load: () => preloadScore(sc), wait: 30000, label: 'SEATING THE ORCHESTRA' };
  const names = liveSets(state);
  return setsReady(names) ? null : { load: () => loadSets(names), wait: 8000, label: 'SEATING THE BAND' };
}
function play(opts = {}) {
  const need = playing || opts.delay != null ? null : needsTuning();
  if (!need) return start(opts);
  ensureAudio(); stopPreview();
  clearTimeout(tuning?.timer);
  const t = tuning = { label: need.label, at: performance.now() };
  const go = () => { if (tuning !== t) return; endTuning(); start(opts); };
  t.timer = setTimeout(go, need.wait);
  (t.done = need.load().catch(() => {})).then(go);
  document.body.classList.add('tuning');
  renderHome();
}
function endTuning() {
  clearTimeout(tuning?.timer);
  tuning = null;
  document.body.classList.remove('tuning');
}

function start({ step = 0, delay = 0.06 } = {}) {
  const seeking = playing;
  stopPreview();
  closePractice();
  ensureAudio();
  uiQueue.length = 0;
  abs = Math.max(0, Math.floor(step));
  const bar = Math.floor(abs / 16);
  const chain = state.chainOn ? parseChain(state.chain) : [];
  seq.cur = chain.length ? chain[bar % chain.length] : state.current;
  seq.queued = null;
  seq.chainPos = bar + (abs % 16 === 0 ? 0 : 1);
  seq.acidPrevSlide = false;
  seq.finished = false; songOver = false;
  seq.origin = 0;
  if (handoff) { handoff = null; engine.handoffCancel(); }
  state.current = seq.cur;
  nextTime = ctx.currentTime + Math.max(0.01, delay);
  clockOffset = null;
  transportOrigin = Date.now() + Math.max(0.01, delay) * 1000 - abs * (15000 / state.bpm);
  if (!seeking) engine.recLock = new Map();
  playing = true;
  if (pat().score) preloadScore(pat().score);
  timer.postMessage('start');
  midiClockStart(ctx, abs, nextTime);
  schedule();
  document.body.classList.add('playing');
  if (seeking) return;
  playStarted({ genre: style });
  renderHome();
}

function stop() {
  endTuning();
  if (engine) engine.recLock = null;
  clearTimeout(roomJoinTimer);
  roomJoinTimer = 0;
  playing = false;
  handoff = null;
  playStopped();
  timer?.postMessage('stop');
  midiClockStop();
  engine?.panic();
  uiQueue.length = 0;
  setPlayhead(null);
  timeline.frame(null);
  lastPlayedPat = null;
  if (seq) seq.queued = null;
  if (artistLive) stopArtistLive(false);
  document.body.classList.remove('playing');
  renderPatterns();
  renderHome();
}

const toggle = () => (playing || tuning ? stop() : play());

function audition(id) {
  ensureAudio();
  const t = ctx.currentTime + 0.01;
  if (id === 'acid') engine.acid(t, { n: 0, a: true }, false, false, engine.stepDur * 2);
  else engine.trigger(id, t, 1);
}

function auditionNote(n) {
  if (playing) return;
  ensureAudio();
  engine.acid(ctx.currentTime + 0.01, { n, a: false }, false, false, engine.stepDur * 2);
}

let recClock = null;
const setRecTime = (text) => { for (const el of document.querySelectorAll('.rec-time')) el.textContent = text; };
async function toggleRec() {
  ensureAudio();
  if (!setRec?.supported) return toast('This browser cannot record. Try Chrome or Safari.');
  if (!setRec.on) {
    setRec.start();
    if (!playing) play();
    toast('Recording your set. Tap REC again to cut and publish it.');
    recClock = setInterval(() => setRecTime(fmtTime(setRec.elapsed())), 500);
  } else {
    clearInterval(recClock); setRecTime('');
    const take = await setRec.stop();
    if (take.duration < 1 || !take.blob.size) toast('Nothing was recorded');
    else {
      const a = state.artist || {};
      openSetCutter({
        take, toast, download,
        defaults: { title: `${a.title || trackTitle((Math.random() * 144) | 0)} (Live)`, style: STYLES[a.style] ? a.style : style, bpm: state.bpm, artist: a.name || 'UNTERGRUND' },
        soundcloud: (wav, title) => showPublish({ audio: wav, title }),
      });
    }
  }
  document.body.classList.toggle('recording', setRec.on);
}

// ---------------- state ops ----------------
const pat = () => state.patterns[state.current];

function setParam(tid, id, v) {
  if (engine) engine.setParam(tid, id, v); else state.params[tid][id] = v;
  persist();
}
function setMaster(id, v) {
  if (engine) engine.setMaster(id, v); else state.master[id] = v;
  persist();
}

function pushUndo() {
  const { patterns, params, master, bpm, swing, key, scale, mutes, locks, chain, chainOn } = state;
  undoStack.push(JSON.stringify({ patterns, params, master, bpm, swing, key, scale, mutes, locks, chain, chainOn, labels: state.labels || null }));
  if (undoStack.length > 40) undoStack.shift();
}
function undo() {
  const s = undoStack.pop();
  if (!s) return toast('Nothing to undo');
  const { ui: was, ...snap } = JSON.parse(s);
  if (was) { style = was.style; family = was.family; localStorage.setItem('untergrund.family', family); }
  Object.assign(state, snap);
  if (!state.labels) delete state.labels;
  engine?.applyAll(); engine?.applyDelayTime();
  build(); persist(); toast('Undone');
}

function replaceState(s) {
  stop();
  autoMajor = false;
  state = s;
  if (engine) { engine.state = state; seq.s = state; engine.applyAll(); }
  build(); persist();
}

function showPublish({ audio = null, title = '' } = {}) {
  openPublish({
    getState: () => state,
    getStyle: () => style,
    render: async (n) => bufferToWav(await renderBars(state, n)),
    toast, audio, title,
  });
}

function showSongPublish() {
  const a = state.artist || {};
  const sid = STYLES[a.style] ? a.style : style;
  openSongPublish({
    state: clone(state), style: sid, artist: a.name || 'UNTERGRUND',
    title: a.title || trackTitle((Math.random() * 144) | 0), toast,
    soundcloud: (title) => showPublish({ title }), jukebox: showJukebox,
    share: (song) => showShare(song, 'publish'),
  });
}

function currentSong() {
  const a = state.artist || {};
  return { state: clone(state), title: a.title || 'Untitled set', artist: a.name || 'UNTERGRUND', style: STYLES[a.style] ? a.style : style, remixOf: state.remixOf };
}
function showShare(song = currentSong(), source = 'studio') { openShare({ song, toast, download, source, hue: hue(song.style), beforeExport: () => { if (playing) stop(); } }); }

// Play a shared or jukebox song in place; leaveGuest() puts the listener's own project back.
function listen(song) {
  ensureAudio();
  if (!guest) guest = { backup: clone(state), style };
  guest.song = song;
  if (STYLES[song.style]) style = song.style;
  stop(); autoMajor = false;
  state = sanitize(clone(song.state));
  if (engine) { engine.state = state; seq.s = state; engine.applyAll(); }
  build();
  play();
}
function leaveGuest() {
  if (!guest) return;
  const { backup, style: own } = guest;
  guest = null;
  style = own;
  replaceState(backup);
}
function remixSong(song, autoplay = playing) {
  const next = remixState(song, { name: loadArtistProfile().name });
  if (!next) return toast('Could not open that song');
  const own = guest ? guest.backup : clone(state);
  guest = null;
  undoStack.push(JSON.stringify({ patterns: own.patterns, params: own.params, master: own.master, bpm: own.bpm }));
  if (STYLES[song.style]) { style = song.style; family = STYLES[style].family; }
  replaceState(next);
  if (!studioOpen) toggleStudio();
  if (autoplay) play();
  if (readShareParams(location)) history.replaceState(null, '', location.pathname);
  toast(`Remix of “${song.title}” by ${song.artist} is yours now`);
  countRemix(song.trackId);
  track('remix', { kind: song.trackId ? 'published' : 'link', genre: song.style });
}

function showJukebox() {
  let current = null;
  openJukebox({
    toast,
    onCreate: () => generateNow(),
    stopSong: () => { if (playing) stop(); },
    onClose: leaveGuest,
    onRemix: () => current && remixSong(current, true),
    onShare: () => current && showShare(current, 'jukebox'),
    playReplay: async (item) => {
      ensureAudio();
      current = null;
      trackEvent('set_replay', { kind: 'jukebox' });
      return playTimeline(await loadReplay(item), Date.now() + 200, timelineHooks(true));
    },
    playSong: async (item) => {
      ensureAudio();
      if (item.kind === 'drop') {
        const d = dailyDrop(item.drop);
        current = { ...normalizeSong({ state: dropSong(d), title: d.title, artist: 'UNTERGRUND', style: d.style }), trackId: '' };
        trackEvent('daily_drop', { kind: 'jukebox' });
      } else {
        const saved = await fetchTrack(item.trackId);
        if (!saved?.state) throw new Error('track_missing');
        current = { ...normalizeSong({ ...item, state: saved.state, remixOf: saved.remixOf || item.remixOf }), trackId: item.local ? '' : item.trackId };
      }
      listen(current);
      const bars = state.chainOn ? parseChain(state.chain).length || 8 : 8;
      return (Math.min(bars, 64) * 16 * 15) / state.bpm;
    },
  });
}

// Saved Club sets replay from their timeline; `asGuest` (jukebox) keeps the listener's own project safe.
function timelineHooks(asGuest) {
  return {
    load: (s, st) => {
      if (asGuest && !guest) guest = { backup: clone(state), style };
      if (STYLES[st]) style = st;
      const next = sanitize({ ...s, artist: state.artist });
      if (!asGuest) return replaceState(next);
      stop(); autoMajor = false; state = next;
      if (engine) { engine.state = state; seq.s = state; engine.applyAll(); }
      build();
    },
    apply: (s, st) => {
      if (STYLES[st]) style = st;
      const next = sanitize({ ...clone(state), ...s });
      // The DJ generated a new song: the replay hands off on a downbeat too, from the new song's bar 1.
      const newSong = next.chain !== state.chain && JSON.stringify(next.patterns[0]) !== JSON.stringify(state.patterns[0]);
      if (playing && seq && newSong && !pat().score && !next.patterns.some((q) => q.score)) {
        next.artist = state.artist;
        return queueSong({ next, quiet: true, finish: () => { build(); if (!guest) persist(); } });
      }
      if (playing && next.bpm !== state.bpm) transportOrigin = Date.now() - ((Date.now() - transportOrigin) / (15000 / state.bpm)) * (15000 / next.bpm);
      const want = next.current;
      next.current = state.current;
      state = next;
      if (engine) { engine.state = state; seq.s = state; engine.applyAll(); }
      if (seq && !state.chainOn && want !== seq.cur) seq.queued = want;
      build(); if (!guest) persist();
    },
    play, isPlaying: () => playing, onEnd: () => playing && stop(),
  };
}
function replayToRoom(timeline, startsAt) { playTimeline(timeline, startsAt, timelineHooks(false)); }

async function joinRoomReplay(item) {
  try {
    const timeline = item.replay.timeline || await loadReplay(item.replay);
    replayToRoom(timeline, +item.startsAt);
    toast(`Replaying “${item.title}” with the room`);
    trackEvent('set_replay', { kind: 'room_listener' });
  } catch { joinRoomSet({ ...item, replay: null }); }
}

function joinRoomSet(item) {
  stopTimeline();
  if (item?.replay) return joinRoomReplay(item);
  if (!item?.state) return;
  style = STYLES[item.style] ? item.style : STYLES[item.state.artist?.style] ? item.state.artist.style : style;
  const roomState = sanitize(clone(item.state));
  const startsAt = Number.isFinite(+item.startsAt) ? +item.startsAt : Date.now();
  replaceState(roomState);
  const sync = () => {
    const { step, delay } = roomTransportPosition(startsAt, roomState.bpm);
    play({ step, delay });
    toast(`Synced to “${item.title || 'Live Machine Set'}”`);
  };
  const wait = startsAt - Date.now();
  if (wait > 50) roomJoinTimer = setTimeout(sync, wait - 40);
  else sync();
}

function startRoomBroadcast(startsAt) {
  if (playing) return;
  clearTimeout(roomJoinTimer);
  const wait = Math.max(0, startsAt - Date.now());
  const lead = Math.min(60, wait);
  roomJoinTimer = setTimeout(() => play({ delay: lead / 1000 }), Math.max(0, wait - lead));
}

function showClub() {
  openClub({
    getState: () => state,
    getStyle: () => style,
    loadTrack: (track) => {
      style = STYLES[track.style] ? track.style : style;
      replaceState(sanitize(clone(track.state)));
    },
    // Rooms count steps from where the playing song started (a GENERATE handoff restarts the song, not the clock).
    getTransport: () => ({ playing, startsAt: transportOrigin + (seq?.origin || 0) * (15000 / state.bpm) }),
    startRoomBroadcast,
    unlockAudio: async () => {
      ensureAudio();
      if (ctx.state !== 'running') await ctx.resume().catch(() => {});
      return ctx.state === 'running';
    },
    joinRoomSet,
    replayToRoom,
    toast,
  });
}

function loadArtistProject(item) {
  style = item.style;
  replaceState(sanitize(clone(item.state)));
  toast(`Loaded “${item.title}”`);
}

function startArtistLive(item = null) {
  if (item) loadArtistProject(item);
  if (artistLive) return;
  const profile = loadArtistProfile();
  artistLive = {
    profile,
    seed: item?.seed ?? ((Math.random() * 1e9) | 0),
    title: item?.title || state.artist?.title || 'Live Session',
    savedDj: state.master.dj,
    bar: -1,
  };
  state.chainOn = true;
  document.body.classList.add('artist-live');
  if (!playing) play();
  else build();
  toast(`${profile.name} is performing “${artistLive.title}”`);
}

function stopArtistLive(rebuild = true) {
  if (!artistLive) return;
  const savedDj = artistLive.savedDj ?? 0;
  artistLive = null;
  if (seq) seq.roll = null;
  engine?.setThrow(false);
  engine?.riserStop();
  if (engine) engine.setMaster('dj', savedDj); else state.master.dj = savedDj;
  document.body.classList.remove('artist-live');
  const liveBtn = document.querySelector('.live-toggle');
  if (liveBtn) {
    liveBtn.classList.remove('on');
    liveBtn.textContent = 'LIVE';
  }
  if (rebuild) build();
  persist();
  toast('Artist Live stopped');
}

function artistTick(step) {
  if (!artistLive || step % 16 !== 0 || !seq || !engine) return;
  const bar = Math.floor(step / 16);
  if (bar === artistLive.bar) return;
  artistLive.bar = bar;
  let x = (artistLive.seed + bar * 2654435761) | 0;
  const r = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };

  seq.roll = null;
  engine.setThrow(false);
  if (bar % 16 === 0) engine.riserStop();

  if (bar > 0 && bar % 8 === 0) {
    const target = (seq.cur + 2) % state.patterns.length;
    const source = state.patterns[target];
    const amount = .1 + artistLive.profile.energy / 650;
    const evolved = mutate(source, artistLive.seed + bar * 97, amount, SCALES[state.scale].notes);
    for (const id of TRACK_IDS) if (state.locks[id]) {
      evolved.steps[id] = clone(source.steps[id]);
      evolved.len[id] = source.len[id];
    }
    state.patterns[target] = evolved;
    persist();
  }

  if (bar % 8 === 6 && r() < artistLive.profile.space / 80) engine.setThrow(true);
  if (bar % 8 === 7 && r() < .35 + artistLive.profile.energy / 180) {
    seq.roll = ['ch', 'snare', 'ride', 'perc'][Math.floor(r() * 4)];
  }
  if (bar % 16 === 14 && r() < .35 + artistLive.profile.energy / 170) engine.riserStart();

  const phase = bar % 16;
  const filter = phase < 2 ? -.18 + phase * .08 : phase >= 14 ? (phase - 13) * .11 : 0;
  engine.setMaster('dj', filter);
}

function selectPattern(i) {
  if (playing && !state.chainOn) {
    seq.queued = i === seq.cur ? null : i;
    if (seq.queued === null) { state.current = i; build(); }
    renderPatterns();
    return;
  }
  state.current = i;
  build(); persist();
}

let autoMajor = false;
// EUPHORIC wants major; leaving it puts back the minor it borrowed. Returns the new autoMajor.
function matchStyleScale(s = state) {
  if (style === 'euphoric' && s.scale === 'minor') { s.scale = 'major'; return true; }
  if (style !== 'euphoric' && autoMajor && s.scale === 'major') { s.scale = 'minor'; return false; }
  return autoMajor;
}

function doGenerate() {
  pushUndo();
  const seed = (Math.random() * 1e9) | 0;
  const before = clone(pat());
  const lockedParams = Object.fromEntries(TRACK_IDS.filter((id) => state.locks[id]).map((id) => [id, clone(state.params[id])]));
  autoMajor = matchStyleScale();
  const g = generate(style, seed, state.scale);
  state.patterns[state.current] = g.pattern;
  for (const id of TRACK_IDS) if (state.locks[id]) {
    state.patterns[state.current].steps[id] = clone(before.steps[id]);
    state.patterns[state.current].len[id] = before.len[id];
  }
  applyOverrides(state, g, !playing);
  for (const [id, params] of Object.entries(lockedParams)) state.params[id] = params;
  engine?.applyAll(); engine?.applyDelayTime();
  build(); persist();
  trackEvent('generate', { genre: style, kind: 'pattern' });
  toast(`${STYLES[style].name} pattern → ${PATTERN_NAMES[state.current]}${TRACK_IDS.some((id) => state.locks[id]) ? ' · locked tracks kept' : ''}`);
}

// Hum-to-hook: the sheet in hum-ui.js edits the song only through these.
const humApi = {
  state: () => state, engine: () => engine, ensureAudio, toast, play, stop, playing: () => playing,
  edit: (fn) => { pushUndo(); fn(state); engine?.applyAll(); build(); persist(); },
  buildSong: (hum) => { stopPreview(); generatedAt = performance.now(); doGenerateSet(hum); if (!playing) play(); },
};

// `steer(state)` (from Describe it) returns the final state to keep, before it is built, played and saved.
function doGenerateSet(hum = null, drop = null, steer = null) {
  pushUndo();
  adoptPlan(planSet(hum, drop, steer));
}

// A whole new song written into a copy of the project. adoptPlan makes it the one you hear
// now; queueSong makes it the one you hear from the next downbeat.
function planSet(hum = null, drop = null, steer = null, withBpm = !playing) {
  const s = clone(state), id = style;
  let seed = drop ? drop.seed : songSeed();
  const source = clone(pat());
  const lockedParams = Object.fromEntries(TRACK_IDS.filter((t) => s.locks[t]).map((t) => [t, clone(s.params[t])]));
  const major = matchStyleScale(s);
  if (typeof hum === 'function' && !drop) seed = humSeed(id, s.scale, hum);
  const g = generate(id, seed, s.scale);
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  if (source.score?.composer) for (const q of s.patterns) if (q.score?.form) q.score.composer = source.score.composer;
  s.key = g.key;
  for (const p of s.patterns) for (const t of TRACK_IDS) if (s.locks[t]) {
    p.steps[t] = clone(source.steps[t]);
    p.len[t] = source.len[t];
  }
  applyOverrides(s, g, withBpm);
  for (const [t, params] of Object.entries(lockedParams)) s.params[t] = params;
  s.chainOn = true;
  s.chain = songChain(id, seed);
  s.ending = true;
  // A score sets its own tempo even mid-set; a masterwork keeps its title and composer.
  if (g.pattern.score) s.bpm = g.bpm;
  if (typeof hum === 'function' && !g.pattern.score) { const r = hum(s.bpm, s.scale); s.key = r.key; if (r.hook) placeHook(s.patterns, r.hook); }
  const piece = PIECE[g.pattern.score?.piece];
  const title = piece ? piece.title : drop ? drop.title : trackTitle(seed);
  const artist = piece ? piece.composer : loadAvatar().name || 'UNTERGRUND';
  s.artist = { name: artist, title, style: id, seed, created: new Date().toISOString() };
  delete s.remixOf; delete s.drop;
  if (drop) Object.assign(s, { drop: drop.date, remixOf: { id: '', title: `Daily Drop · ${drop.title}`, artist: 'UNTERGRUND' } });
  if (typeof steer === 'function') Object.assign(s, steer(s));
  return {
    next: s, undo: true, autoMajor: major,
    finish: (landed = false) => {
      build(); persist();
      trackEvent('generate', { genre: id, kind: 'song' });
      if (!landed) toast(piece ? `${piece.composer.split(' ').pop()}: ${title}` : `New ${STYLES[id].name} track “${title}”`);
      // The drop itself is everyone's; only a published version joins today's remixes.
      const { drop: _d, remixOf: _r, ...own } = clone(state);
      saveTrack({ title, artist, style: id, state: drop ? own : clone(state) })
        .then(({ shared }) => toast(`“${title}” saved to ${shared ? 'the shared CRATE' : 'your CRATE'}`));
    },
  };
}
function adoptPlan(plan) {
  autoMajor = plan.autoMajor ?? false;
  for (const k of Object.keys(state)) if (!(k in plan.next)) delete state[k];
  adoptState(plan.next);
  if (engine?.recLock) engine.recLock = new Map();
  plan.finish();
}

function doMutate() {
  pushUndo();
  const before = clone(pat());
  state.patterns[state.current] = mutate(pat(), (Math.random() * 1e9) | 0, variation, SCALES[state.scale].notes);
  for (const id of TRACK_IDS) if (state.locks[id]) {
    state.patterns[state.current].steps[id] = clone(before.steps[id]);
    state.patterns[state.current].len[id] = before.len[id];
  }
  build(); persist();
}

function createVariation() {
  pushUndo();
  const from = state.current;
  const next = (from + 1) % state.patterns.length;
  const source = clone(pat());
  const evolved = mutate(source, (Math.random() * 1e9) | 0, variation, SCALES[state.scale].notes);
  for (const id of TRACK_IDS) if (state.locks[id]) {
    evolved.steps[id] = clone(source.steps[id]);
    evolved.len[id] = source.len[id];
  }
  state.patterns[next] = evolved;
  selectPattern(next);
  persist();
  toast(`${PATTERN_NAMES[from]} evolved → ${PATTERN_NAMES[next]} · ${Math.round(variation * 100)}% change`);
}

function randomTrack(id) {
  pushUndo();
  const g = generate(style, (Math.random() * 1e9) | 0);
  pat().steps[id] = g.pattern.steps[id];
  pat().len[id] = g.pattern.len[id];
  renderRow(id); if (id === 'acid') renderRoll(); persist();
}

function clearTrack(id) {
  pushUndo();
  pat().steps[id] = id === 'acid' ? Array.from({ length: STEPS }, emptyAcidStep) : Array(STEPS).fill(0);
  renderRow(id); if (id === 'acid') renderRoll(); persist();
}

function rotateTrack(id, dir) {
  const len = pat().len[id];
  const s = pat().steps[id];
  const head = s.slice(0, len);
  const r = dir > 0 ? [head[len - 1], ...head.slice(0, len - 1)] : [...head.slice(1), head[0]];
  for (let i = 0; i < len; i++) s[i] = r[i];
  renderRow(id); if (id === 'acid') renderRoll(); persist();
}

// ---------------- helpers ----------------
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

let toastTimer = 0;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = h('div', { class: 'toast' }); document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const noteName = (n) => KEYS[(((state.key + n) % 12) + 12) % 12] + (Math.floor((36 + state.key + n) / 12) - 1);
const trackActive = (id) => {
  const anySolo = TRACK_IDS.some((x) => state.solos[x]);
  return !state.mutes[id] && (!anySolo || state.solos[id]);
};

// ---------------- build ----------------
function build() {
  app.innerHTML = '';
  ui.rows = {};
  document.body.classList.toggle('studio-open', studioOpen);
  app.append(buildHeader(), buildGenerateHome(), state.patterns[0]?.score ? '' : timeline.mount(), h('main', { class: 'main studio-workspace' }, h('div', { class: 'left' }, buildGrid(), buildEditor()), buildMaster()), buildTabBar());
  renderPatterns();
  for (const id of TRACK_IDS) renderRow(id);
  renderRoll();
  if (ui.playhead) ui.lastAbs = null;
  const tab = document.querySelector('.family-tab.on'), row = tab?.parentElement;
  if (row && row.scrollWidth > row.clientWidth) {
    const t = tab.getBoundingClientRect(), r = row.getBoundingClientRect();
    row.scrollLeft += t.left - r.left - (row.clientWidth - t.width) / 2;
  }
}

function toggleStudio() {
  studioOpen = !studioOpen;
  localStorage.setItem('untergrund.studio-open', studioOpen ? '1' : '0');
  build();
}

const STYLE_HUE = {
  symphony: '#e8c27a', concerto: '#f0d9a8', nocturne: '#9fb4ff', repertoire: '#d8b4fe',
  hypnotic: '#c6ff2b', industrial: '#ff6a3d', acid: '#f2ff3a', dub: '#3ad6c6', peak: '#ff4d86', hardtechno: '#ff3b3b',
  deephouse: '#6f9bff', minimal: '#e4e4ea', ukg: '#b892ff', euphoric: '#ff9ad5', neosoul: '#ffb347', boombap: '#dca86e',
  breaks: '#ff9340', electro: '#2bd9ff', dnb: '#7dff9a', trance: '#a98bff', ambient: '#8fd8ff',
  amapiano: '#f5c542', afrobeats: '#ff7b54', reggaeton: '#e83cff', bailefunk: '#4dff4d', trap: '#9b5cff', drill: '#5c7cff', jerseyclub: '#00ffd0', hyperpop: '#ff5ce1',
};
const LIVE_KIT_STYLES = new Set(['neosoul', 'boombap']);
const GROOVE_STYLES = new Set(['neosoul', 'boombap', 'deephouse', 'ukg', 'euphoric', 'amapiano', 'afrobeats', 'reggaeton', 'trap', 'drill']);
const SECTION_NAMES = {
  groove: ['INTRO', 'BUILD', 'VERSE', 'FILL', 'BRIDGE', 'BRIDGE', 'HOOK', 'HOOK'],
  club: ['INTRO', 'BUILD', 'DROP', 'FILL', 'BREAKDOWN', 'BREAKDOWN', 'DROP', 'HALF-TIME'],
};
const sectionName = (sid, i) => SECTION_NAMES[GROOVE_STYLES.has(sid) ? 'groove' : 'club'][i] || PATTERN_NAMES[i];
const hue = (id) => STYLE_HUE[id] || '#c6ff2b';

function setSong(on) {
  state.chainOn = on;
  document.querySelector('.chain-toggle')?.classList.toggle('on', on);
  if (seq) seq.chainPos = Math.ceil(abs / 16);
  timeline.refresh();
  persist();
}
const timeline = songTimeline({
  state: () => state,
  kind: () => (GROOVE_STYLES.has(style) ? 'groove' : 'club'),
  playing: () => playing,
  current: () => state.current,
  before: pushUndo,
  after: () => { persist(); const inp = document.querySelector('input.chain'); if (inp) inp.value = state.chain; },
  select: selectPattern,
  jump: (bar) => play({ step: bar * 16 }),
  setSong,
  track: (kind) => trackEvent('song_edit', { kind }),
});

function styleGlyph(id) {
  const r = rng([...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7));
  return h('i', { class: 'glyph', 'aria-hidden': 'true' },
    Array.from({ length: 7 }, (_, i) => h('em', { style: `--h:${18 + Math.round(r() * 82)}%;--d:${(i * 0.07).toFixed(2)}s` })));
}

// Press-and-hold audition: two bars rendered offline, looped straight to the speakers.
const previewCache = new Map();
let preview = null;
async function startPreview(id, card) {
  if (playing) { toast('Stop playback to preview a sound'); return; }
  ensureAudio();
  stopPreview();
  const token = {};
  preview = token;
  card.classList.add('previewing');
  try {
    let p = previewCache.get(id);
    if (!p) {
      const snap = clone(state);
      const scale = id === 'euphoric' ? 'major' : 'minor';
      const g = generate(id, (Math.random() * 1e9) | 0, scale);
      Object.assign(snap, { patterns: [g.pattern], current: 0, chainOn: false, scale, mutes: {}, solos: {} });
      applyOverrides(snap, g, true);
      p = { buf: await renderBars(snap, 2, { tail: 1 }), loopEnd: 0.05 + (32 * 60) / snap.bpm / 4 };
      previewCache.set(id, p);
    }
    if (preview !== token) return;
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    Object.assign(src, { buffer: p.buf, loop: true, loopStart: 0.05, loopEnd: p.loopEnd });
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 0.03);
    src.connect(gain).connect(ctx.destination);
    src.start();
    Object.assign(token, { src, gain });
  } catch (err) {
    console.error(err);
    reportError(err, { kind: 'preview' });
    if (preview === token) { preview = null; card.classList.remove('previewing'); }
  }
}
function stopPreview() {
  const p = preview;
  preview = null;
  document.querySelectorAll('.generate-style.previewing').forEach((c) => c.classList.remove('previewing'));
  if (p?.src && ctx) {
    const t = ctx.currentTime;
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setTargetAtTime(0, t, 0.04);
    p.src.stop(t + 0.3);
  }
}

// The next GENERATE's seed is drawn as soon as a style is picked, so that song's recordings can start downloading first.
let nextSeed = null, warmed = '';
const songSeed = () => { const s = nextSeed ?? ((Math.random() * 1e9) | 0); nextSeed = null; return s; };
function preloadStyle(id) {
  nextSeed ??= (Math.random() * 1e9) | 0;
  if (warmed === `${id}:${nextSeed}`) return;
  warmed = `${id}:${nextSeed}`;
  const g = generate(id, nextSeed, state.scale);
  if (g.pattern.score) preloadScore(g.pattern.score).catch(() => {});
  else loadSets(liveSets(g));
}
function selectStyle(id) { style = id; preloadStyle(id); if (STYLES[id].family === 'CLASSICAL') loadPiano(); build(); }
function selectFamily(f) {
  family = f;
  localStorage.setItem('untergrund.family', f);
  if (STYLES[style].family !== f) style = Object.keys(STYLES).find((id) => STYLES[id].family === f);
  build();
}
function generateNow(drop = null) {
  if (!drop?.date) drop = null;
  stopPreview();
  generatedAt = performance.now();
  navigator.vibrate?.(12);
  // Building the next song blocks the main thread; queue more audio first so it can't starve.
  if (playing) schedule(0.4);
  // The new song arrives at its own tempo; from silence it starts at once.
  const plan = planSet(null, drop, null, true);
  const score = plan.next.patterns.some((q) => q.score);
  // A score starts at its first bar: its bars breathe (rubato) and can be 3/4, so there is no shared downbeat.
  if (playing && !score && !pat().score) {
    queueSong(plan);
    // Then warm the next GENERATE's recordings, after the waiting song's own are in.
    return void loadSets(liveSets(plan.next)).catch(() => {}).then(() => preloadStyle(style));
  }
  if (playing) stop();
  pushUndo();
  adoptPlan(plan);
  if (!playing) play();
  // Then warm the next GENERATE's recordings, after this song's own have the connection to themselves.
  Promise.resolve(tuning?.done).then(() => preloadStyle(style));
}
// "In the style of": the composer model the CLASSICAL generator writes in ('' = UNTERGRUND's own rules).
function setComposer(name) {
  pushUndo();
  for (const q of state.patterns) if (q.score?.form) { if (name) q.score.composer = name; else delete q.score.composer; }
  persist(); build();
  toast(name ? `Rewriting in the style of ${name}` : 'Rewriting in the UNTERGRUND style');
  if (!playing) return;
  stop(); ensureAudio();
  preloadScore(pat().score).then(() => { if (!playing) play(); });
}
// Perform one masterwork from the REPERTOIRE, from its first bar.
function playPiece(id) {
  const p = PIECE[id];
  if (!p) return;
  if (playing) stop();
  if (style !== 'repertoire' || !state.patterns.every((q) => q.score)) { style = 'repertoire'; family = 'CLASSICAL'; doGenerateSet(); }
  pushUndo();
  for (const q of state.patterns) q.score = { piece: id };
  state.bpm = p.bpm; state.key = 0;
  state.artist = { ...state.artist, name: p.composer, title: p.title, style: 'repertoire' };
  persist(); build();
  ensureAudio();
  toast(`Opening ${p.title}…`);
  preloadScore({ piece: id }).then(() => { if (!playing && pat().score?.piece === id) play(); }, (e) => toast(`Couldn't open the score: ${e.message}`));
}
function playDrop(drop) {
  style = drop.style;
  family = STYLES[style].family;
  localStorage.setItem('untergrund.family', family);
  trackEvent('daily_drop', { kind: 'make', genre: style });
  generateNow(drop);
}
function surprise() {
  const ids = Object.keys(STYLES).filter((id) => id !== style);
  style = ids[(Math.random() * ids.length) | 0];
  family = STYLES[style].family;
  localStorage.setItem('untergrund.family', family);
  generateNow();
}
async function openRecent(t) {
  ensureAudio();
  try {
    const track = await fetchTrack(t.id);
    if (!track?.state) throw new Error('track_missing');
    const saved = track.style || t.style;
    if (STYLES[saved]) { style = saved; family = STYLES[saved].family; }
    const next = sanitize(track.state);
    if (playing && !pat().score && !next.patterns.some((q) => q.score)) return queueSong({ next, finish: () => { build(); persist(); } });
    replaceState(next);
    play();
  } catch { toast('Could not load that track'); }
}

// Open a published track from its public page (/?track=<id>) or the following feed.
async function openShared(id, autoplay = false) {
  if (autoplay) ensureAudio();
  try {
    const pub = await fetchPublicTrack(id);
    const track = pub?.track || await fetchTrack(id);
    if (!track?.state) throw new Error('track_missing');
    if (STYLES[track.style]) { style = track.style; family = STYLES[track.style].family; }
    if (playing) stop();
    const next = sanitize(track.state);
    next.artist = { ...(next.artist || {}), title: track.title, name: pub?.artist?.name || track.artist || next.artist?.name, style: track.style };
    replaceState(next);
    if (autoplay) play(); else toast(`Loaded “${track.title}”. Press play.`);
  } catch { toast('Could not load that track'); }
}

function styleCard(id, value, isPlaying) {
  const avg = (value.bpm[0] + value.bpm[1]) / 2;
  const card = h('button', {
    class: 'generate-style' + (style === id ? ' on' : '') + (isPlaying ? ' playing' : ''),
    style: `--hue:${hue(id)};--beat:${(60 / avg).toFixed(3)}s`,
    title: 'Tap to choose. Press and hold to hear it.',
    oncontextmenu: (e) => e.preventDefault(),
  }, styleGlyph(id), h('b', {}, value.name), h('span', {}, value.tag));
  let holdTimer = 0, held = false, hover = 0;
  card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hover = setTimeout(() => preloadStyle(id), 150); });
  card.addEventListener('pointerdown', () => {
    held = false;
    ensureAudio();
    preloadStyle(id);
    holdTimer = setTimeout(() => { held = true; startPreview(id, card); }, 380);
  });
  const end = () => { clearTimeout(holdTimer); clearTimeout(hover); if (held) stopPreview(); };
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) card.addEventListener(type, end);
  card.addEventListener('click', () => { if (held) { held = false; return; } selectStyle(id); });
  return card;
}

function statusLine() {
  const s = STYLES[style];
  const sound = LIVE_KIT_STYLES.has(style) ? 'RECORDED DRUMS + BASS' : getSample().source === 'synth' ? 'SYNTHESIZED' : 'SYNTH + YOUR SAMPLES';
  return [h('b', {}, s.name), h('span', {}, `${s.bpm[0]}–${s.bpm[1]} BPM`), h('span', {}, 'FULL ARRANGEMENT'), h('span', {}, sound)];
}

function buildNowPlaying(primary) {
  const a = state.artist || {};
  const sid = STYLES[a.style] ? a.style : style;
  const sc = pat()?.score ? compose(pat().score) : null;
  const chain = sc ? sc.sections : state.chainOn ? parseChain(state.chain) : [];
  ui.npScore = sc;
  ui.npCanvas = h('canvas', { class: 'np-viz', width: 1200, height: 220 });
  ui.npSection = h('b', {}, sc ? sc.sections[0].name : chain.length ? sectionName(sid, chain[0]) : `PATTERN ${PATTERN_NAMES[state.current]}`);
  ui.npBar = h('span', {}, sc ? `BAR 1 / ${sc.bars}` : chain.length ? `BAR 1 / ${chain.length}` : '');
  // Long songs show one cell per 4-bar section so the strip stays legible on a phone.
  ui.npGroup = chain.length > 48 ? 4 : 1;
  ui.npCells = Array.from({ length: Math.ceil(chain.length / ui.npGroup) }, () => h('i', { class: 'np-cell' }));
  ui.npChain = chain;
  ui.npStyle = sid;
  return [
    h('div', { class: 'now-playing' },
      h('span', { class: 'np-eyebrow' }, h('i', { class: 'np-dot' }), 'NOW PLAYING'),
      h('h1', {}, a.title || 'Untitled set'),
      h('div', { class: 'np-meta' }, [a.name || 'UNTERGRUND', STYLES[sid].name, `${state.bpm} BPM`, sc?.meta ? sc.meta.key.toUpperCase() : `${KEYS[state.key]} ${sc ? (pat().score.mode === 'm' ? 'MINOR' : 'MAJOR') : SCALES[state.scale]?.name || 'MINOR'}`]
        .flatMap((v, i) => [i ? ' ' : '', h('span', {}, i ? `· ${v}` : v)])),
      ui.npCanvas,
      h('div', { class: 'np-progress' }, h('div', { class: 'np-label' }, ui.npSection, ui.npBar), h('div', { class: 'np-cells' }, ui.npCells))),
    h('div', { class: 'generate-actions np-actions' },
      h('button', { class: 'np-stop', title: 'Stop (Space)', 'aria-label': 'Stop', onclick: toggle }, h('i')),
      primary,
      h('button', { class: 'btn refine-toggle', onclick: toggleStudio }, 'REFINE'),
      pat()?.score ? null : h('button', { class: 'btn ghost', title: 'Hum a melody and make it the hook', onclick: () => openHum(humApi, { from: 'studio' }) }, 'HUM'),
      h('button', { class: 'btn ghost np-pub', onclick: showSongPublish }, 'PUBLISH'),
      h('button', { class: 'btn ghost np-share', title: 'Link, TikTok/Reels video or embed', onclick: () => showShare(currentSong(), 'now_playing') }, 'SHARE'),
      h('button', { class: 'btn ghost rec', title: 'Record your set, then cut and publish it', onclick: toggleRec }, h('span', { class: 'dot' }), 'REC', h('span', { class: 'rec-time' }))),
  ];
}

function updateNowPlaying(ev) {
  const cells = ui.npCells;
  if (!cells?.length || !cells[0].isConnected) return;
  const sc = ui.npScore;
  if (sc) {
    const bar = Math.floor(ev.abs / (sc.barLen || 16)) % sc.bars, j = sc.sections.findLastIndex((x) => x.at <= bar);
    concertBar(bar);
    if (cells.bar === bar) return;
    cells.bar = bar;
    cells.forEach((c, k) => { c.classList.toggle('now', k === j); c.classList.toggle('past', k < j); });
    ui.npSection.textContent = sc.sections[j].name;
    ui.npBar.textContent = `BAR ${bar + 1} / ${sc.bars}`;
    return;
  }
  const i = Math.floor(ev.abs / 16) % ui.npChain.length;
  if (cells.idx === i) return;
  cells.idx = i;
  const ci = Math.floor(i / (ui.npGroup || 1));
  cells.forEach((c, j) => { c.classList.toggle('now', j === ci); c.classList.toggle('past', j < ci); });
  ui.npSection.textContent = sectionName(ui.npStyle, ui.npChain[i]);
  ui.npBar.textContent = `BAR ${i + 1} / ${ui.npChain.length}`;
}

function drawNowPlaying() {
  const cv = ui.npCanvas;
  if (!cv || !engine || !cv.isConnected) return;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  const an = engine.analyser;
  const fd = ui.npFd || (ui.npFd = new Uint8Array(an.frequencyBinCount));
  an.getByteFrequencyData(fd);
  g.clearRect(0, 0, W, H);
  g.fillStyle = hue(ui.npStyle);
  const bars = 64, gap = 7, bw = (W - gap * (bars - 1)) / bars, nyq = ctx.sampleRate / 2, bins = fd.length;
  let energy = 0;
  for (let b = 0; b < bars; b++) {
    const f0 = 30 * Math.pow(16000 / 30, b / bars), f1 = 30 * Math.pow(16000 / 30, (b + 1) / bars);
    const i0 = Math.floor((f0 / nyq) * bins), i1 = Math.max(i0 + 1, Math.floor((f1 / nyq) * bins));
    let m = 0;
    for (let i = i0; i < i1 && i < bins; i++) m = Math.max(m, fd[i]);
    const v = Math.pow(m / 255, 1.8);
    energy += v;
    const bh = Math.max(6, v * H), x = b * (bw + gap), y = (H - bh) / 2;
    g.globalAlpha = 0.3 + v * 0.7;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, bw, bh, bw / 2); else g.rect(x, y, bw, bh);
    g.fill();
  }
  g.globalAlpha = 1;
  ui.home?.style.setProperty('--pulse', (energy / bars).toFixed(3));
}

function renderHome() {
  const old = ui.home;
  if (!old?.isConnected) return;
  const scroll = old.querySelector('.family-tabs')?.scrollLeft || 0;
  old.replaceWith(buildGenerateHome());
  const row = ui.home.querySelector('.family-tabs');
  if (row) row.scrollLeft = scroll;
}

function buildGenerateHome() {
  ui.npCanvas = null; ui.npCells = null;
  const families = [...new Set(Object.values(STYLES).map((v) => v.family))];
  if (!families.includes(family)) family = STYLES[style].family;
  const playingStyle = playing && state.artist?.style;
  const picker = h('div', { class: 'generate-families' },
    h('div', { class: 'family-tabs', role: 'tablist' },
      families.map((f) => h('button', { class: 'family-tab' + (f === family ? ' on' : ''), role: 'tab', 'aria-selected': String(f === family), onclick: () => selectFamily(f) }, f)),
      h('button', { class: 'family-tab surprise', title: 'Pick any genre and generate', onclick: surprise }, 'SURPRISE ME')),
    h('div', { class: 'generate-styles' }, Object.entries(STYLES).filter(([, v]) => v.family === family).map(([id, v]) => styleCard(id, v, playingStyle === id))),
    h('div', { class: 'generate-hint' }, 'Tap to choose. Press and hold to hear it.'));
  // While a new song waits for its downbeat the button fills up to the switch.
  const wait = handoff?.due ? Math.max(0, handoff.due - performance.now()) : 0, band = handoff && !handoff.due;
  const primary = tuning
    ? h('button', { class: 'generate-primary tuning', 'aria-busy': 'true', style: `--tune-at:${((tuning.at - performance.now()) / 1000).toFixed(2)}s`, onclick: () => generateNow() },
      h('span', {}, 'TUNING UP'), h('small', {}, `${STYLES[state.artist?.style]?.name || STYLES[style].name} · ${tuning.label}`))
    : h('button', { class: 'generate-primary' + (performance.now() - generatedAt < 900 ? ' fired' : '') + (wait || band ? ' gen-queued' : ''), style: wait ? `--gen-wait:${Math.round(handoff.total)}ms;--gen-at:${Math.round(wait - handoff.total)}ms` : null, onclick: () => generateNow() },
      h('span', {}, 'GENERATE'), h('small', {}, band ? 'Up next · seating the band' : wait ? 'Up next · on the bar' : `${STYLES[style].name} · full track`));
  const showNp = playing && !studioOpen;
  const left = showNp ? buildNowPlaying(primary) : [
    h('div', { class: 'generate-copy' },
      h('span', {}, 'TECHNO · HOUSE · JAZZ · HIP-HOP · BASS'),
      h('h1', {}, 'Press Generate. Hear a finished track.'),
      h('p', {}, 'Choose a sound and UNTERGRUND writes a full arrangement you can perform live, refine in Studio, or spin in the Club.'),
      dropCard({ hue, onMake: playDrop, onLoad: renderHome, onPlay: (t) => { countPlay(t.id); trackEvent('daily_drop', { kind: 'play', genre: t.style }); openShared(t.id, true); } })),
    h('div', { class: 'generate-actions' }, primary,
      h('button', { class: 'btn refine-toggle', onclick: toggleStudio }, studioOpen ? 'HIDE STUDIO' : 'REFINE IN STUDIO'),
      h('button', { class: 'btn ghost', onclick: () => startArtistLive() }, 'ARTIST LIVE'),
      STYLES[style].family === 'CLASSICAL' ? null : humButton(humApi)),
    h('div', { class: 'generate-status' }, statusLine()),
  ];
  const classical = STYLES[style].family === 'CLASSICAL' || !!(playing && pat()?.score);
  const concert = classical ? concertPanel({ state: () => state, engine: () => engine, ensureAudio, persist, score: pat()?.score || null, repertoire: style === 'repertoire', onPiece: playPiece, onComposer: setComposer, stopTransport: () => playing && stop() }) : null;
  const recent = recentTracks().slice(0, 8);
  const recents = recent.length ? h('div', { class: 'recents' },
    h('div', { class: 'recents-label' }, 'RECENT TRACKS'),
    h('div', { class: 'recents-row' }, recent.map((t) => h('button', { class: 'recent', style: `--hue:${hue(t.style)}`, onclick: () => openRecent(t) },
      h('i'), h('b', {}, t.title || 'Untitled'), h('span', {}, [STYLES[t.style]?.name, t.bpm && `${t.bpm} BPM`].filter(Boolean).join(' · ')))))) : null;
  const following = followingRow({ hue, onPlay: (t) => openShared(t.id, true), onLoad: renderHome });
  const home = h('section', { class: 'generate-home' + (showNp ? ' is-playing' : '') + (concert ? ' has-concert' : ''), style: `--hue:${hue(showNp ? playingStyle || style : style)}` }, left, describeBox(), picker, concert, recents, following);
  ui.home = home;
  return home;
}

function describeBox() {
  return describeBar({
    state: () => state, style: () => style, styleName: (id) => STYLES[id].name, depth: () => undoStack.length,
    pushUndo, undo, track: (p) => trackEvent('describe', p),
    // Undo of a genre switch also brings back the old genre and song title.
    switchGenre: (id, steer) => {
      const was = { style, family }, artist = clone(state.artist ?? null);
      style = id; family = STYLES[id].family; localStorage.setItem('untergrund.family', family);
      doGenerateSet(null, null, (s) => {
        undoStack.push(JSON.stringify({ ...JSON.parse(undoStack.pop()), artist, ui: was }));
        return steer(s);
      });
      if (playing && pat().score) stop();
    },
    commit: (next) => { adoptState(next); build(); persist(); },
  });
}

function adoptState(next) {
  if (playing && next.bpm !== state.bpm) transportOrigin = Date.now() - ((Date.now() - transportOrigin) / (15000 / state.bpm)) * (15000 / next.bpm);
  Object.assign(state, next);
  engine?.applyAll(); engine?.applyDelayTime();
}


function openArtist() {
  openArtistStudio({
    getState: () => state,
    loadProject: loadArtistProject,
    performProject: startArtistLive,
    publishProject: (item) => { loadArtistProject(item); showPublish(); },
    toast,
  });
}

function buildTabBar() {
  const closeOverlays = () => {
    for (let i = 0; i < 4 && document.querySelector('.overlay, .club-overlay'); i++) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
  };
  const tab = (label, on, onclick) => h('button', { class: `tab tab-${label.toLowerCase()}` + (on ? ' on' : ''), ...(on && { 'aria-current': 'page' }), onclick: () => { closeOverlays(); onclick(); } }, h('i', { class: `tab-ico ${label.toLowerCase()}` }), h('span', {}, label));
  return h('nav', { class: 'tabbar', 'aria-label': 'Sections' },
    tab('Create', !studioOpen, () => { if (studioOpen) toggleStudio(); else scrollTo({ top: 0, behavior: 'smooth' }); }),
    tab('Studio', studioOpen, () => { if (!studioOpen) toggleStudio(); }),
    tab('Club', false, showClub),
    tab('Jukebox', false, showJukebox),
    tab('Artist', false, openArtist));
}

function buildHeader() {
  const playBtn = h('button', { class: 'btn play', title: 'Play / Stop (Space)', onclick: toggle },
    h('span', { class: 'ico-play' }), h('span', { class: 'ico-stop' }));
  const bpm = numBox({ min: 60, max: 200, step: 1, def: 133 }, state.bpm, (v) => {
    if (playing && v !== state.bpm) {
      const currentStep = (Date.now() - transportOrigin) / (15000 / state.bpm);
      transportOrigin = Date.now() - currentStep * (15000 / v);
    }
    state.bpm = v; engine?.applyDelayTime(); persist();
  }, { cls: 'bpm' });
  bpm.el.title = 'Tempo — drag / wheel / arrows';
  const swing = knob({ id: 'swing', label: 'SWING', min: 0, max: 0.6, def: 0.06 }, state.swing, (v) => { state.swing = v; persist(); },
    { size: 36, format: (v) => Math.round(v * 100) + '%', cls: 'sm' });
  const key = h('select', { class: 'sel', title: 'Key', onchange: (e) => { state.key = +e.target.value; persist(); renderRow('acid'); renderRoll(); } },
    KEYS.map((k, i) => { const o = h('option', { value: i }, k); if (i === state.key) o.selected = true; return o; }));
  const scale = h('select', { class: 'sel', title: 'Scale used by the acid generator and highlighted in the piano roll',
    onchange: (e) => { state.scale = e.target.value; autoMajor = false; persist(); renderRoll(); } },
    Object.entries(SCALES).map(([id, s]) => { const o = h('option', { value: id }, s.name); if (id === state.scale) o.selected = true; return o; }));

  const pats = h('div', { class: 'pats' }, PATTERN_NAMES.map((n, i) => h('button', { class: 'pat', 'data-i': i, onclick: () => selectPattern(i), title: `Pattern ${n} (← →)` }, n)));
  ui.pats = pats;
  const patTools = h('div', { class: 'tools' },
    h('button', { class: 'btn ghost', title: 'Copy pattern', onclick: () => { clipboard = clone(pat()); toast(`Copied ${PATTERN_NAMES[state.current]}`); } }, 'COPY'),
    h('button', { class: 'btn ghost', title: 'Paste pattern', onclick: () => { if (!clipboard) return toast('Clipboard empty'); pushUndo(); state.patterns[state.current] = clone(clipboard); build(); persist(); } }, 'PASTE'),
    h('button', { class: 'btn ghost', title: 'Clear pattern', onclick: () => { pushUndo(); state.patterns[state.current] = emptyPattern(); build(); persist(); } }, 'CLEAR'));

  const chainInput = h('input', { class: 'chain', value: state.chain, spellcheck: 'false', title: 'Arrangement: one letter per bar, e.g. AABBCCDD',
    oninput: (e) => { state.chain = e.target.value.toUpperCase().replace(/[^A-H]/g, ''); persist(); timeline.refresh(); } });
  const chainBtn = h('button', { class: 'btn toggle chain-toggle' + (state.chainOn ? ' on' : ''), title: 'Play the arrangement chain',
    onclick: () => setSong(!state.chainOn) }, 'CHAIN');

  const styleSel = h('select', { class: 'sel', title: 'Generator style', onchange: (e) => { style = e.target.value; build(); } },
    Object.entries(STYLES).map(([k, v]) => { const o = h('option', { value: k }, v.name); if (k === style) o.selected = true; return o; }));

  const bars = h('select', { class: 'sel', title: 'Bars to render' }, [4, 8, 16, 32, 64].map((b) => { const o = h('option', { value: b }, b + ' BARS'); if (b === 16) o.selected = true; return o; }));
  const exportBtn = h('button', { class: 'btn', title: 'Offline render to 24-bit / 48 kHz WAV (follows chain if on)', onclick: async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'RENDERING…';
    try {
      const buf = await renderBars(state, +bars.value);
      download(bufferToWav(buf), `untergrund-${state.bpm}bpm-${bars.value}bars-${stamp()}.wav`);
      toast(`Rendered ${bars.value} bars · 48 kHz / 24-bit WAV`);
      trackEvent('export_wav', { bars: +bars.value });
    } catch (err) { console.error(err); reportError(err, { kind: 'render' }); toast('Render failed: ' + err.message); }
    btn.disabled = false; btn.textContent = 'EXPORT WAV';
  } }, 'EXPORT WAV');
  const recBtn = h('button', { class: 'btn rec', title: 'Record your set any time, then cut and publish it', onclick: toggleRec }, h('span', { class: 'dot' }), 'REC', h('span', { class: 'rec-time' }));
  const jukeboxBtn = h('button', { class: 'btn', title: 'Play every song and set published on UNTERGRUND', onclick: showJukebox }, 'JUKEBOX');
  const artistBtn = h('button', { class: 'btn artist-btn', title: 'Build the artist identity, catalog and release calendar', onclick: openArtist }, 'ARTIST');
  const clubBtn = h('button', { class: 'btn club-btn', title: 'Enter an avatar listening room for UNTERGRUND-native sets', onclick: showClub }, 'CLUB');
  const liveBtn = h('button', {
    class: 'btn live-toggle' + (artistLive ? ' on' : ''),
    title: 'Let the autonomous artist perform and evolve this set',
    onclick: () => artistLive ? stopArtistLive() : startArtistLive(),
  }, artistLive ? 'LIVE ON' : 'LIVE');
  const publishBtn = h('button', { class: 'btn sc', title: 'Publish to the UNTERGRUND jukebox, and optionally SoundCloud', onclick: showSongPublish }, 'PUBLISH');

  const fileIn = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { replaceState(sanitize(JSON.parse(await f.text()))); toast('Project loaded'); } catch { toast('Could not read that file'); }
  } });

  return h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, h('i'), h('b')), h('div', {}, h('div', { class: 'name' }, 'UNTERGRUND'))),
    h('div', { class: 'group transport' }, playBtn, recBtn, h('div', { class: 'transport-fields studio-only' }, h('div', { class: 'field' }, h('label', {}, 'BPM'), bpm.el), swing.el,
      h('div', { class: 'field' }, h('label', {}, 'KEY'), key), h('div', { class: 'field' }, h('label', {}, 'SCALE'), scale))),
    h('div', { class: 'group studio-only' }, h('div', { class: 'field' }, h('label', {}, 'PATTERN'), pats), patTools),
    h('div', { class: 'group studio-only studio-more' }, chainBtn, chainInput),
    h('div', { class: 'group gen studio-only studio-more' }, styleSel,
      h('button', { class: 'btn accent', title: 'Generate a pattern into this slot (G)', onclick: doGenerate }, 'GENERATE'),
      h('button', { class: 'btn', title: 'Generate a whole 8-pattern arrangement and enable chain', onclick: () => doGenerateSet() }, 'NEW SET'),
      h('button', { class: 'btn ghost', title: 'Small variation (M)', onclick: doMutate }, 'MUTATE'),
      h('select', { class: 'sel variation', title: 'How far the next variation moves from this pattern', onchange: (e) => { variation = +e.target.value; } },
        h('option', { value: .12 }, 'SUBTLE'), h('option', { value: .25, selected: true }, 'EVOLVE'), h('option', { value: .55 }, 'WILD')),
      h('button', { class: 'btn ghost evolve', title: 'Create an evolved copy in the next pattern slot', onclick: createVariation }, 'VAR →'),
      h('button', { class: 'btn ghost', title: 'Undo (Ctrl+Z)', onclick: undo }, 'UNDO')),
    h('div', { class: 'group studio-only studio-more' }, liveBtn, publishBtn,
      h('details', { class: 'menu' }, h('summary', { class: 'btn ghost', title: 'Export audio, save or open a project file' }, 'FILE'),
        h('div', { class: 'menu-pop' },
          h('div', { class: 'menu-row' }, bars, exportBtn),
          ...exportButtons({ getState: () => state, getBars: () => +bars.value, download, toast, track: trackEvent, reportError }),
          h('button', { class: 'btn ghost', title: 'Save project file (.json) to reopen later', onclick: () => download(new Blob([JSON.stringify(state)], { type: 'application/json' }), `untergrund-${stamp()}.json`) }, 'SAVE PROJECT'),
          h('button', { class: 'btn ghost', title: 'Open a saved project file', onclick: () => fileIn.click() }, 'OPEN PROJECT'), fileIn,
          h('button', { class: 'btn ghost', title: 'Share a link, a 9:16 video or an embed code', onclick: () => showShare() }, 'SHARE LINK & VIDEO')))),
    h('nav', { class: 'group nav seg' }, artistBtn, clubBtn, jukeboxBtn,
      h('button', { class: 'btn studio-toggle' + (studioOpen ? ' on' : ''), title: 'Sequencer, mixer, export and every control', onclick: toggleStudio }, studioOpen ? 'DONE' : 'STUDIO')),
    h('button', { class: 'btn ghost help studio-only studio-more', title: 'Shortcuts', onclick: showHelp }, '?'),
    h('button', { class: 'btn ghost tools-toggle studio-only', 'aria-expanded': 'false', onclick: (e) => {
      const open = document.body.classList.toggle('tools-open');
      e.currentTarget.setAttribute('aria-expanded', String(open));
      e.currentTarget.textContent = open ? 'FEWER TOOLS' : 'MORE TOOLS';
    } }, 'MORE TOOLS'));
}

function renderPatterns() {
  if (!ui.pats) return;
  for (const b of ui.pats.children) {
    const i = +b.dataset.i;
    const p = state.patterns[i];
    const has = TRACK_IDS.some((id) => (id === 'acid' ? p.steps.acid.some((s) => s.on) : p.steps[id].some(Boolean)));
    b.classList.toggle('cur', i === state.current);
    b.classList.toggle('has', has);
    b.classList.toggle('queued', !!(playing && seq && seq.queued === i));
    b.classList.toggle('live', !!(playing && lastPlayedPat === i));
  }
}

function buildGrid() {
  const grid = h('section', { class: 'grid panel' });
  const head = h('div', { class: 'row head' }, h('div', { class: 'tname' }, ''), h('div', { class: 'ms' }),
    h('div', { class: 'steps' }, Array.from({ length: STEPS }, (_, i) => h('div', { class: 'num' + (i % 4 === 0 ? ' beat' : '') }, String(i + 1)))),
    h('div', { class: 'len-h' }, 'LEN'), h('div', { class: 'lvl-h' }, 'LVL'));
  grid.append(head);
  let paint = null;
  window.onpointerup = () => { paint = null; };

  TRACKS.forEach((t, ti) => {
    const id = t.id;
    const name = h('button', { class: 'tname', style: `--tc:${t.color}`, title: `${t.name} — click to edit & audition (key ${ti + 1} mutes)`,
      onclick: () => { selected = id; build(); audition(id); } }, h('span', { class: 'led' }), t.name);
    const m = h('button', { class: 'm', title: 'Mute', onclick: () => { state.mutes[id] = !state.mutes[id]; renderAllRows(); persist(); } }, 'M');
    const s = h('button', { class: 's', title: 'Solo', onclick: () => { state.solos[id] = !state.solos[id]; renderAllRows(); persist(); } }, 'S');
    const l = h('button', { class: 'l', title: 'Lock this track so generation and evolution preserve it',
      onclick: () => { state.locks[id] = !state.locks[id]; renderAllRows(); persist(); } }, 'L');
    const cells = Array.from({ length: STEPS }, (_, i) => h('div', { class: 'step' + (i % 4 === 0 ? ' beat' : ''), 'data-i': i }, h('span', { class: 'nl' })));
    const steps = h('div', { class: 'steps', style: `--tc:${t.color}` }, cells);
    steps.addEventListener('contextmenu', (e) => e.preventDefault());
    steps.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.step'); if (!cell) return;
      e.preventDefault();
      steps.releasePointerCapture?.(e.pointerId);
      const i = +cell.dataset.i;
      paint = { id, target: stepTarget(id, i, e) };
      applyStep(id, i, paint.target);
    });
    steps.addEventListener('pointerover', (e) => {
      if (!paint || paint.id !== id || !e.buttons) return;
      const cell = e.target.closest('.step'); if (!cell) return;
      applyStep(id, +cell.dataset.i, paint.target);
    });
    const len = numBox({ min: 1, max: STEPS, step: 1, def: STEPS }, pat().len[id], (v) => { pat().len[id] = v; renderRow(id); persist(); }, { cls: 'len' });
    len.el.title = 'Track length (polymeter) — drag / wheel';
    const lvlQ = MIX_PARAMS[0];
    const lvl = knob(lvlQ, state.params[id].level, (v) => { setParam(id, 'level', v); if (selected === id) ui.editorKnobs?.level?.set(v); },
      { size: 28, color: t.color, format: (v) => formatValue(lvlQ, v), cls: 'mini' });
    const row = h('div', { class: 'row' + (selected === id ? ' sel' : ''), 'data-id': id }, name, h('div', { class: 'ms' }, m, s, l), steps, len.el, lvl.el);
    ui.rows[id] = { row, name, cells, m, s, l, len, lvl };
    grid.append(row);
  });
  return grid;
}

function stepTarget(id, i, e) {
  const cur = pat().steps[id][i];
  const alt = e.shiftKey || e.button === 2;
  if (id === 'acid') {
    if (e.altKey) return { mode: 's', val: !(cur.on && cur.s) };
    if (alt) return { mode: 'a', val: !(cur.on && cur.a) };
    return { mode: 'on', val: !cur.on };
  }
  if (alt) return cur === 2 ? 1 : 2;
  return cur ? 0 : 1;
}

function applyStep(id, i, target) {
  const s = pat().steps[id];
  if (id === 'acid') {
    const st = s[i];
    if (target.mode === 'on') st.on = target.val;
    else { st[target.mode] = target.val; if (target.val) st.on = true; }
    renderRoll();
  } else s[i] = target;
  renderRow(id); renderPatterns(); persist();
}

function renderAllRows() { for (const id of TRACK_IDS) renderRow(id); }

function renderRow(id) {
  const r = ui.rows[id]; if (!r) return;
  const p = pat();
  const len = p.len[id];
  r.len.set(len);
  r.row.classList.toggle('muted', !trackActive(id));
  r.m.classList.toggle('on', !!state.mutes[id]);
  r.s.classList.toggle('on', !!state.solos[id]);
  r.l.classList.toggle('on', !!state.locks[id]);
  r.cells.forEach((c, i) => {
    const v = p.steps[id][i];
    const out = i >= len;
    c.classList.toggle('out', out);
    if (id === 'acid') {
      c.classList.toggle('on', v.on);
      c.classList.toggle('acc', v.on && v.a);
      c.classList.toggle('slide', v.on && v.s);
      c.firstChild.textContent = v.on ? noteName(v.n).replace(/\d+$/, '') : '';
    } else {
      c.classList.toggle('on', v > 0);
      c.classList.toggle('acc', v === 2);
    }
  });
}

function setPlayhead(ev) {
  const p = pat();
  for (const id of TRACK_IDS) {
    const r = ui.rows[id]; if (!r) continue;
    const prev = r.ph;
    const i = ev ? ev.abs % p.len[id] : -1;
    if (prev != null && prev !== i) r.cells[prev]?.classList.remove('ph');
    if (i >= 0) {
      r.cells[i].classList.add('ph');
      const v = p.steps[id][i];
      if ((id === 'acid' ? v.on : v) && trackActive(id) && ev.pat === state.current) {
        r.name.classList.remove('hit'); void r.name.offsetWidth; r.name.classList.add('hit');
      }
    }
    r.ph = i >= 0 ? i : null;
  }
  if (ui.rollCols) {
    const i = ev ? ev.abs % p.len.acid : -1;
    ui.rollCols.forEach((col, j) => col.classList.toggle('ph', j === i));
  }
}

// ---------------- editor ----------------
function buildEditor() {
  const t = TRACK_BY_ID[selected];
  const id = t.id;
  ui.editorKnobs = {};
  const voice = Math.round(state.params[id].voice || 0);
  const hidden = VOICE_HIDDEN[id]?.[voice] || [];
  const progLocked = id === 'stab' && state.patterns[state.current]?.prog?.length > 0;
  const mk = (q) => {
    if (q.id === 'voice' && q.list) return voiceChips(q, id, voice, t.color);
    const k = knob(q, state.params[id][q.id], (v) => {
      setParam(id, q.id, v);
      if (q.id === 'level') ui.rows[id]?.lvl.set(v);
      if (q.id === 'voice') { const ed = document.querySelector('.editor'); ed?.replaceWith(buildEditor()); }
    }, { color: t.color, format: (v) => formatValue(q, v) });
    ui.editorKnobs[q.id] = k;
    if (progLocked && q.id === 'chord') {
      k.el.classList.add('locked');
      k.el.title = 'Chords follow this pattern\'s progression. Clear the pattern or generate a techno style to pick one chord.';
    }
    return k.el;
  };
  const tools = h('div', { class: 'etools' },
    h('button', { class: 'btn ghost', title: 'Rotate left', onclick: () => rotateTrack(id, -1) }, '◀'),
    h('button', { class: 'btn ghost', title: 'Rotate right', onclick: () => rotateTrack(id, 1) }, '▶'),
    h('button', { class: 'btn ghost', title: `Random ${t.name} line in ${STYLES[style].name} style`, onclick: () => randomTrack(id) }, 'RND'),
    h('button', { class: 'btn ghost', title: 'Clear track', onclick: () => clearTrack(id) }, 'CLR'));
  const hint = {
    drum: 'Tap a step to add a hit · shift or right-click makes it louder · drag to paint',
    acid: 'Tap a step to play a note · shift = accent · alt = slide · set notes in the piano roll',
    stab: 'Tap a step to play a chord · shift or right-click makes it louder',
    sampler: 'Tap a step to play a slice · SCATTER picks slices · MELODY sings it in key',
  }[t.kind];
  const ed = h('section', { class: 'editor panel', style: `--tc:${t.color}` },
    h('div', { class: 'ehead' }, h('div', { class: 'etitle' }, h('span', { class: 'sw' }), t.name), h('div', { class: 'hint' }, hint), tools),
    h('div', { class: 'ebody' },
      h('div', { class: 'kgroup' }, h('div', { class: 'glabel' }, 'INSTRUMENT & TONE'), h('div', { class: 'knobs' }, t.params.filter((q) => !hidden.includes(q.id)).map(mk))),
      h('div', { class: 'kgroup' }, h('div', { class: 'glabel' }, 'MIX'), h('div', { class: 'knobs' }, MIX_PARAMS.map(mk)))));
  ui.roll = null; ui.rollCols = null;
  if (id === 'acid') ed.append(buildRoll());
  if (id === 'vox') ed.append(samplePanel());
  if (id === 'stab' && !pat()?.score) ed.append(melodyPanel(humApi));
  return ed;
}

// Named instruments read better as choices than as a knob position.
function voiceChips(q, id, voice, color) {
  const pick = (i) => {
    setParam(id, 'voice', i);
    document.querySelector('.editor')?.replaceWith(buildEditor());
    document.querySelector(`.voice-chips [data-v="${i}"]`)?.focus();
  };
  return h('div', { class: 'voice-chips', role: 'radiogroup', 'aria-label': `${TRACK_BY_ID[id].name} instrument`, style: `--kc:${color}` },
    q.list.map((name, i) => h('button', {
      class: `vchip${i === voice ? ' on' : ''}`, role: 'radio', 'aria-checked': String(i === voice), 'data-v': String(i),
      onclick: () => i !== voice && pick(i),
    }, name[0] + name.slice(1).toLowerCase())));
}

function samplePanel() {
  const name = h('b', {}, getSample().name);
  const info = h('small', {}, '');
  const show = (s) => { name.textContent = s.name; info.textContent = `${s.slices.length} slices · ${s.buffer.duration.toFixed(1)}s · stays on this device`; };
  show(getSample());
  const off = onSample((s) => (document.body.contains(name) ? show(s) : off()));
  let rec = null;
  const reset = () => { rec = null; recBtn.textContent = 'RECORD'; recBtn.classList.remove('live'); };
  const recBtn = h('button', { class: 'btn accent', title: 'Record up to 20s from your mic: voice, room, street, anything', onclick: async () => {
    if (rec) { const r = rec; reset(); await r.stop().catch(() => toast('Recording failed')); return; }
    try {
      rec = await startRecording();
      recBtn.textContent = 'STOP'; recBtn.classList.add('live');
      rec.done.then(() => { toast('Recording chopped into VOX'); }, () => {}).finally(() => rec && reset());
    } catch { reset(); toast('Microphone unavailable'); }
  } }, 'RECORD');
  const rights = h('input', { type: 'checkbox' });
  const file = h('input', { type: 'file', accept: 'audio/*', style: 'display:none', onchange: async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await loadAudioFile(f).then(() => toast(`Loaded ${f.name}`), () => toast('Could not decode that audio file'));
  } });
  const load = h('button', { class: 'btn ghost', onclick: () => (rights.checked ? file.click() : toast('Confirm you recorded it or own the rights first')) }, 'LOAD FILE');
  return h('div', { class: 'sampler' },
    h('div', { class: 'glabel' }, 'SOURCE'), name, info, recBtn, load,
    h('label', {}, rights, 'I recorded it or own the rights'),
    h('button', { class: 'btn ghost', onclick: () => useSynthVox() }, 'SYNTH VOX'), file);
}

function buildRoll() {
  const notes = [];
  for (let n = 12; n >= -12; n--) notes.push(n);
  const wrap = h('div', { class: 'roll' });
  const labels = h('div', { class: 'rlabels' }, notes.map((n) => h('div', { class: 'rl' + (n % 12 === 0 ? ' root' : '') }, '')), h('div', { class: 'rl ctl' }, 'ACC'), h('div', { class: 'rl ctl' }, 'SLIDE'));
  const cols = [];
  const grid = h('div', { class: 'rgrid' });
  for (let i = 0; i < STEPS; i++) {
    const col = h('div', { class: 'rcol' + (i % 4 === 0 ? ' beat' : '') });
    for (const n of notes) {
      col.append(h('div', { class: 'rc' + (n % 12 === 0 ? ' root' : ''), onpointerdown: (e) => {
        e.preventDefault();
        pushUndo();
        const st = pat().steps.acid[i];
        if (st.on && st.n === n) st.on = false; else { st.on = true; st.n = n; auditionNote(n); }
        renderRoll(); renderRow('acid'); renderPatterns(); persist();
      } }));
    }
    const toggleFlag = (f) => (e) => { e.preventDefault(); const st = pat().steps.acid[i]; st[f] = !st[f]; if (st[f]) st.on = true; renderRoll(); renderRow('acid'); persist(); };
    col.append(h('div', { class: 'rc ctl acc', onpointerdown: toggleFlag('a') }), h('div', { class: 'rc ctl sl', onpointerdown: toggleFlag('s') }));
    cols.push(col);
    grid.append(col);
  }
  wrap.append(labels, grid);
  ui.roll = { labels, notes };
  ui.rollCols = cols;
  return wrap;
}

function renderRoll() {
  if (!ui.roll || !ui.rollCols) return;
  const { labels, notes } = ui.roll;
  const steps = pat().steps.acid;
  const len = pat().len.acid;
  notes.forEach((n, r) => {
    const name = noteName(n);
    const black = name.includes('#');
    labels.children[r].textContent = name;
    labels.children[r].classList.toggle('black', black);
    const inScale = SCALES[state.scale].notes.some((x) => ((x % 12) + 12) % 12 === ((n % 12) + 12) % 12);
    labels.children[r].classList.toggle('offscale', !inScale);
    ui.rollCols.forEach((col) => {
      col.children[r].classList.toggle('black', black);
      col.children[r].classList.toggle('offscale', !inScale);
    });
  });
  ui.rollCols.forEach((col, i) => {
    const st = steps[i];
    col.classList.toggle('out', i >= len);
    notes.forEach((n, r) => col.children[r].classList.toggle('on', st.on && st.n === n));
    col.children[notes.length].classList.toggle('on', st.on && st.a);
    col.children[notes.length + 1].classList.toggle('on', st.on && st.s);
  });
}

// ---------------- master ----------------
function buildMaster() {
  const canvas = h('canvas', { class: 'viz', width: 640, height: 260 });
  ui.canvas = canvas;
  const mk = (q, size = 46, cls = '') => knob(q, state.master[q.id], (v) => setMaster(q.id, v), { size, format: (v) => formatValue(q, v), cls }).el;
  const by = Object.fromEntries(MASTER_PARAMS.map((q) => [q.id, q]));
  const hold = (label, keyName, title, on, off) => {
    const b = h('button', { class: 'btn perf' + (heldPads.has(keyName) ? ' on' : ''), title: `${title} (hold ${keyName})` }, label, h('small', {}, keyName));
    const down = (e) => {
      e.preventDefault();
      if (heldPads.has(keyName)) return;
      if (!playing) play();
      heldPads.set(keyName, off); b.classList.add('on'); on();
    };
    const up = () => { keyPads.delete(keyName); const f = heldPads.get(keyName); if (!f) return; heldPads.delete(keyName); document.querySelectorAll('.btn.perf.on').forEach((x) => x.lastChild.textContent === keyName && x.classList.remove('on')); f(); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    ui.perf[keyName] = { down: () => { if (!heldPads.has(keyName)) keyPads.add(keyName); down(new Event('x')); }, up };
    return b;
  };
  ui.perf = {};
  return h('aside', { class: 'master panel' },
    h('div', { class: 'mhead' }, h('span', {}, 'MASTER'), h('span', { class: 'meter-txt' })),
    canvas,
    h('div', { class: 'mknobs big' }, mk(by.dj, 84, 'dj'), h('div', { class: 'mk2' }, mk(by.duck), mk(by.drive), mk(by.volume))),
    h('div', { class: 'glabel' }, 'SPACE · ECHO'),
    h('div', { class: 'mknobs' }, mk(by.revLevel), mk(by.revTone), mk(by.dlyTime), mk(by.dlyFb), mk(by.dlyLevel)),
    h('div', { class: 'glabel' }, 'PERFORM'),
    h('div', { class: 'perfs' },
      hold('ROLL', 'R', 'Ratchet the selected drum (or snare) at 1/32', () => { if (seq) seq.roll = TRACK_BY_ID[selected].kind === 'drum' && selected !== 'kick' ? selected : 'snare'; }, () => { if (seq) seq.roll = null; }),
      hold('THROW', 'T', 'Throw everything into delay + reverb', () => engine.setThrow(true), () => engine.setThrow(false)),
      hold('RISER', 'Y', 'Noise riser that builds over 4 bars', () => engine.riserStart(), () => engine.riserStop())),
    midiStrip(),
    h('div', { class: 'foot' }, `${getSample().source === 'synth' ? 'synths + recorded CC0 instruments' : 'synth + your own samples'} · 48k/24-bit export`));
}

function drawViz() {
  const cv = ui.canvas; if (!cv) return;
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.fillStyle = '#0a0a0b'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#1b1b1f'; g.lineWidth = 1;
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const x = Math.log(f / 25) / Math.log(20000 / 25) * (W - 30);
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
  }
  const meterEl = document.querySelector('.meter-txt');
  if (!engine) { g.fillStyle = '#3a3a40'; g.font = '600 18px JetBrains Mono, monospace'; g.fillText('PRESS SPACE', 20, H / 2); return; }
  const an = engine.analyser;
  const fd = ui.fd || (ui.fd = new Float32Array(an.frequencyBinCount));
  const td = ui.td || (ui.td = new Float32Array(an.fftSize));
  an.getFloatFrequencyData(fd);
  an.getFloatTimeDomainData(td);
  const sr = ctx.sampleRate, bins = fd.length, bars = 72, mw = W - 30;
  for (let b = 0; b < bars; b++) {
    const f0 = 25 * Math.pow(20000 / 25, b / bars), f1 = 25 * Math.pow(20000 / 25, (b + 1) / bars);
    const i0 = Math.floor((f0 / (sr / 2)) * bins), i1 = Math.max(i0 + 1, Math.floor((f1 / (sr / 2)) * bins));
    let m = -140;
    for (let i = i0; i < i1 && i < bins; i++) m = Math.max(m, fd[i]);
    const tilt = 3 * Math.log2(Math.max(1, (f0 + f1) / 2 / 100));
    const n = Math.max(0, Math.min(1, (m + tilt + 95) / 85));
    const x = (b / bars) * mw, w = mw / bars - 1.5, hh = n * (H - 10);
    const grad = g.createLinearGradient(0, H, 0, H - hh);
    grad.addColorStop(0, '#5a0d0d'); grad.addColorStop(1, n > 0.85 ? '#ffffff' : '#ff2b2b');
    g.fillStyle = grad; g.fillRect(x, H - hh, w, hh);
  }
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.5; g.beginPath();
  let start = 0;
  for (let i = 1; i < td.length / 2; i++) if (td[i - 1] < 0 && td[i] >= 0) { start = i; break; }
  const span = 1024;
  let peak = 0, sum = 0;
  for (let i = 0; i < td.length; i++) { const a = Math.abs(td[i]); if (a > peak) peak = a; sum += td[i] * td[i]; }
  for (let i = 0; i < span; i++) {
    const x = (i / span) * mw, y = H * 0.32 - td[start + i] * H * 0.28;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  const pdb = 20 * Math.log10(peak || 1e-6), rdb = 10 * Math.log10(sum / td.length || 1e-12);
  ui.peakHold = Math.max(pdb, (ui.peakHold ?? -60) - 0.4);
  const mh = (db) => Math.max(0, Math.min(1, (db + 36) / 36)) * (H - 4);
  g.fillStyle = '#16161a'; g.fillRect(W - 22, 0, 16, H);
  g.fillStyle = rdb > -6 ? '#ffffff' : '#ff2b2b'; g.fillRect(W - 20, H - mh(rdb), 12, mh(rdb));
  g.fillStyle = ui.peakHold > -0.5 ? '#fff' : '#ff8080'; g.fillRect(W - 22, H - mh(ui.peakHold) - 2, 16, 2);
  if (meterEl) meterEl.textContent = `PK ${pdb > -60 ? pdb.toFixed(1) : '-∞'}  RMS ${rdb > -60 ? rdb.toFixed(1) : '-∞'} dB`;
}

function frame() {
  if (playing && ctx) {
    const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    let ev = null;
    while (uiQueue.length && uiQueue[0].t + lat <= ctx.currentTime) ev = uiQueue.shift();
    if (ev) {
      if (ev.pat !== lastPlayedPat) {
        const followView = lastPlayedPat === null || state.current === lastPlayedPat || state.chainOn;
        lastPlayedPat = ev.pat;
        if (followView && state.current !== ev.pat) { state.current = ev.pat; build(); }
        renderPatterns();
      }
      setPlayhead(ev);
      updateNowPlaying(ev);
      timeline.frame(ev);
      const pattern = state.patterns[ev.pat];
      const step = ev.abs % 16;
      window.dispatchEvent(new CustomEvent('untergrund:step', { detail: {
        abs: ev.abs,
        step,
        bar: Math.floor(ev.abs / 16),
        kick: !!pattern?.steps?.kick?.[step % (pattern?.len?.kick || 16)],
        accent: step % 4 === 0,
      } }));
    }
  }
  drawViz();
  drawNowPlaying();
  requestAnimationFrame(frame);
}

// ---------------- keyboard ----------------
function showHelp() {
  const close = () => ov.remove();
  const rows = [
    ['SPACE', 'play / stop'], ['1–9', 'mute track'], ['SHIFT + 1–9', 'solo track'], ['← →', 'previous / next pattern (queued at bar end)'],
    ['G', 'generate pattern'], ['M', 'mutate pattern'], ['CTRL + Z', 'undo'], ['R (hold)', 'roll / ratchet'], ['T (hold)', 'FX throw'], ['Y (hold)', 'riser'],
    ['STEP CLICK', 'toggle · shift/right-click = accent · drag paints'], ['ACID STEP', 'alt-click = slide'], ['KNOBS', 'drag · wheel · shift = fine · double-click = reset'],
    ['L', 'lock a track so generate / mutate / variation keeps it'], ['VAR →', 'evolve this loop into the next pattern slot'],
    ['SCALE', 'guides acid generation and highlights the piano roll'], ['LEN', 'per-track length → polymeter (try 12, 7, 15)'],
    ['ARTIST', 'identity, musical DNA, generated catalog + release calendar'], ['LIVE', 'autonomous evolving performance of the current set'],
    ['CLUB', 'avatar rooms for listening to music made inside UNTERGRUND'],
    ['CHAIN', 'letters = bars, e.g. AAAABBBBCCCC'], ['PUBLISH', 'render + artwork + metadata → SoundCloud'],
  ];
  const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'modal panel' }, h('div', { class: 'mtitle' }, 'UNTERGRUND · CONTROLS'),
      h('table', {}, rows.map(([k, v]) => h('tr', {}, h('td', { class: 'k' }, k), h('td', {}, v)))),
      h('p', { class: 'tip' }, 'Club tips: keep MASTER FILTER for transitions, sidechain 40–60%, kick RUMBLE + DRIVE for warehouse weight, ' +
        'and play the arrangement with CHAIN. Render with EXPORT WAV (48 kHz / 24-bit) or capture a live jam with REC.'),
      h('button', { class: 'btn accent', onclick: close }, 'CLOSE')));
  document.body.append(ov);
}

window.addEventListener('keydown', (e) => {
  if (isText(document.activeElement)) return;
  if (e.repeat && !['ArrowLeft', 'ArrowRight'].includes(e.key)) { if ([' ', 'r', 't', 'y'].includes(e.key.toLowerCase())) e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const digit = e.code.startsWith('Digit') ? +e.code.slice(5) : NaN;
  if (digit >= 1 && digit <= TRACK_IDS.length) {
    const id = TRACK_IDS[digit - 1];
    if (e.shiftKey) state.solos[id] = !state.solos[id]; else state.mutes[id] = !state.mutes[id];
    renderAllRows(); persist(); return;
  }
  if (k === 'arrowleft' || k === 'arrowright') {
    e.preventDefault();
    const base = playing && seq?.queued != null ? seq.queued : (playing ? lastPlayedPat ?? state.current : state.current);
    selectPattern((base + (k === 'arrowright' ? 1 : 7)) % 8);
    return;
  }
  if (k === 'g') return doGenerate();
  if (k === 'm') return doMutate();
  if (ui.perf?.[k.toUpperCase()]) { e.preventDefault(); ui.perf[k.toUpperCase()].down(); }
  if (k === '?') showHelp();
});
window.addEventListener('keyup', (e) => {
  const K = e.key.toUpperCase();
  if (ui.perf?.[K]) ui.perf[K].up();
});

document.addEventListener('visibilitychange', () => { if (!guest) save(state); });

build();
// Once the page is idle, warm the recordings the selected style and the saved song will play.
(window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => {
  preloadStyle(style);
  if (pat()?.score) preloadScore(pat().score).catch(() => {}); else loadSets(liveSets(state));
}, { timeout: 4000 });
// A saved masterwork reopens with its score (and section map) once the notes arrive.
if (pat()?.score?.piece) loadPiece(pat().score.piece).then(() => { if (!playing) build(); }, () => {});
requestAnimationFrame(frame);
const shared = readShareParams(location);
if (shared) setTimeout(() => {
  const load = shared.code ? decodeSong(shared.code)
    : fetch(`/api/tracks?id=${encodeURIComponent(shared.id)}`).then((r) => (r.ok ? r.json().then((j) => j.track) : Promise.reject()))
      .catch(() => fetchTrack(shared.id)).then((t) => t?.state && { ...normalizeSong({ ...t, remixOf: t.remixOf }), trackId: t.id, remixes: t.remixes || 0, children: t.children || [] }).catch(() => null);
  const landing = openSharedLanding({
    load, isPlaying: () => playing,
    play: (song) => { countPlay(song.trackId); listen(song); },
    fetchSong: (id) => fetch(`/api/tracks?id=${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(({ track: t }) => t?.state && { ...normalizeSong(t), trackId: t.id, remixes: t.remixes || 0, children: t.children || [] }),
    stop: () => { if (playing) stop(); },
    remix: remixSong,
    share: (song) => showShare(song, 'shared'),
    close: () => { leaveGuest(); history.replaceState(null, '', location.pathname); },
  });
  addEventListener('keydown', (e) => { if (e.code === 'Space') setTimeout(landing.sync); }, true);
});
else if (new URLSearchParams(location.search).has('room')) setTimeout(showClub);
else if (new URLSearchParams(location.search).has('jukebox')) setTimeout(showJukebox);
else if (new URLSearchParams(location.search).has('track')) openShared(new URLSearchParams(location.search).get('track'));
else if (new URLSearchParams(location.search).has('artist')) setTimeout(openArtist);
restoreSample();
initMidi({
  state: () => state, selected: () => selected, playing: () => playing, persist, setParam, setMaster, toggle,
  play: (step) => play({ step, delay: 0.01 }), stop: () => { if (playing) stop(); },
  pad: (k, down) => ui.perf?.[k]?.[down ? 'down' : 'up'](),
  // External clock: pull the transport toward where that clock says `step` started (Date ms).
  align: (step, at, blend) => { if (playing) transportOrigin += (at - step * (15000 / state.bpm) - transportOrigin) * blend; },
  latency: () => (ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0),
});
restoreVoice();
window.__untergrund = { get state() { return state; }, get engine() { return engine; } };

document.addEventListener('click', (e) => {
  for (const m of document.querySelectorAll('details.menu[open]')) if (!m.contains(e.target)) m.open = false;
});
