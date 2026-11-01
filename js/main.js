import { TRACKS, TRACK_IDS, TRACK_BY_ID, MIX_PARAMS, MASTER_PARAMS, KEYS, SCALES, PATTERN_NAMES, STEPS, formatValue, VOICE_HIDDEN } from './params.js';
import { Engine, Sequencer, parseChain } from './engine.js';
import { defaultState, generate, mutate, arrangement, songChain, applyOverrides, clone, save, load, sanitize, STYLES, emptyPattern, emptyAcidStep } from './state.js';
import { renderBars, bufferToWav } from './render.js';
import { encodeWav, rng } from './dsp.js';
import { knob, numBox, h } from './ui.js';
import { openPublish } from './publish.js';
import { createSetRecorder, openSetCutter, openSongPublish, openJukebox, fmtTime } from './sets.js';
import { loadArtistProfile, openArtistStudio } from './artist.js';
import { openClub, loadAvatar } from './club.js';
import { saveTrack, trackTitle, recentTracks, fetchTrack } from './crate.js';
import { getSample, onSample, loadAudioFile, startRecording, useSynthVox, restoreSample } from './sampler.js';
import { roomTransportPosition, transportResync } from './room-sync.js';

let state = load() || defaultState();
let ctx = null, engine = null, seq = null, timer = null, setRec = null;
const heldPads = new Map(), keyPads = new Set();
// A held pad releases wherever the finger lifts, even if the pad was re-rendered mid-hold
addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse' || !e.buttons) for (const k of [...heldPads.keys()]) if (!keyPads.has(k)) ui.perf?.[k]?.up(); });
addEventListener('blur', () => { for (const k of [...heldPads.keys()]) ui.perf?.[k]?.up(); });
let playing = false, abs = 0, nextTime = 0, lastPlayedPat = null;
let transportOrigin = 0, roomJoinTimer = 0, clockOffset = null;
const uiQueue = [];
let selected = 'kick';
let style = 'hypnotic';
let family = localStorage.getItem('untergrund.family') || 'TECHNO';
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
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(state), 300); }

// ---------------- audio ----------------
// iOS routes Web Audio through the ringer channel, so the silent switch mutes it.
// Playing a silent <audio> element (or setting audioSession) moves the page to the media channel.
let mediaUnlock = null;
function silentWav() {
  const n = 4800, b = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, t) => { for (let i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); b.setUint32(16, 16, true);
  b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, 48000, true); b.setUint32(28, 96000, true);
  b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
function unlockMediaChannel() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  if (!mediaUnlock) {
    mediaUnlock = document.createElement('audio');
    mediaUnlock.setAttribute('playsinline', '');
    mediaUnlock.setAttribute('x-webkit-airplay', 'deny');
    mediaUnlock.loop = true;
    mediaUnlock.preload = 'auto';
    mediaUnlock.src = silentWav();
  }
  if (mediaUnlock.paused) mediaUnlock.play().catch(() => {});
}

function ensureAudio() {
  unlockMediaChannel();
  if (ctx) { if (ctx.state !== 'running') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: matchMedia('(pointer: coarse)').matches ? 'playback' : 'balanced' });
  engine = new Engine(ctx, state);
  seq = new Sequencer(engine, state);
  const src = "let id=null;onmessage=e=>{if(e.data==='start'&&!id)id=setInterval(()=>postMessage(0),15);if(e.data==='stop'){clearInterval(id);id=null;}}";
  timer = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  timer.onmessage = schedule;
  setRec = createSetRecorder(ctx, engine.out);
}

function schedule() {
  if (!playing) return;
  const offset = Date.now() / 1000 - ctx.currentTime;
  clockOffset = clockOffset === null ? offset : clockOffset + (offset - clockOffset) * 0.05;
  const target = transportOrigin / 1000 + abs * engine.stepDur - clockOffset;
  const fix = transportResync(target, nextTime, ctx.currentTime, engine.stepDur);
  if (fix) {
    for (let i = 0; i < fix.skip; i++, abs++) { artistTick(abs); seq.advanceBar(abs); }
    nextTime = fix.nextTime;
  }
  while (nextTime < ctx.currentTime + 0.12) {
    artistTick(abs);
    const pat = seq.tick(abs, nextTime);
    uiQueue.push({ abs, t: nextTime, pat });
    nextTime += engine.stepDur;
    abs++;
  }
}

function play({ step = 0, delay = 0.06 } = {}) {
  stopPreview();
  ensureAudio();
  abs = Math.max(0, Math.floor(step));
  const bar = Math.floor(abs / 16);
  const chain = state.chainOn ? parseChain(state.chain) : [];
  seq.cur = chain.length ? chain[bar % chain.length] : state.current;
  seq.queued = null;
  seq.chainPos = bar + (abs % 16 === 0 ? 0 : 1);
  seq.acidPrevSlide = false;
  state.current = seq.cur;
  nextTime = ctx.currentTime + Math.max(0.01, delay);
  clockOffset = null;
  transportOrigin = Date.now() + Math.max(0.01, delay) * 1000 - abs * (15000 / state.bpm);
  playing = true;
  timer.postMessage('start');
  schedule();
  document.body.classList.add('playing');
  renderHome();
}

function stop() {
  clearTimeout(roomJoinTimer);
  roomJoinTimer = 0;
  playing = false;
  timer?.postMessage('stop');
  engine?.panic();
  uiQueue.length = 0;
  setPlayhead(null);
  lastPlayedPat = null;
  if (seq) seq.queued = null;
  if (artistLive) stopArtistLive(false);
  document.body.classList.remove('playing');
  renderPatterns();
  renderHome();
}

const toggle = () => (playing ? stop() : play());

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
  undoStack.push(JSON.stringify({ patterns: state.patterns, params: state.params, master: state.master, bpm: state.bpm }));
  if (undoStack.length > 40) undoStack.shift();
}
function undo() {
  const s = undoStack.pop();
  if (!s) return toast('Nothing to undo');
  Object.assign(state, JSON.parse(s));
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
  openSongPublish({
    state: clone(state), style: STYLES[a.style] ? a.style : style, artist: a.name || 'UNTERGRUND',
    title: a.title || trackTitle((Math.random() * 144) | 0), toast,
    soundcloud: (title) => showPublish({ title }), jukebox: showJukebox,
  });
}

function showJukebox() {
  openJukebox({
    toast,
    stopSong: () => { if (playing) stop(); },
    playSong: async (item) => {
      ensureAudio();
      const track = await fetchTrack(item.trackId);
      if (!track?.state) throw new Error('track_missing');
      replaceState(sanitize(track.state));
      play();
      const bars = state.chainOn ? parseChain(state.chain).length || 8 : 8;
      return (Math.min(bars, 64) * 16 * 15) / state.bpm;
    },
  });
}

function joinRoomSet(item) {
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
    getTransport: () => ({ playing, startsAt: transportOrigin }),
    startRoomBroadcast,
    unlockAudio: async () => {
      ensureAudio();
      if (ctx.state !== 'running') await ctx.resume().catch(() => {});
      return ctx.state === 'running';
    },
    joinRoomSet,
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
function matchStyleScale() {
  if (style === 'euphoric' && state.scale === 'minor') { state.scale = 'major'; autoMajor = true; }
  else if (style !== 'euphoric' && autoMajor && state.scale === 'major') { state.scale = 'minor'; autoMajor = false; }
}

function doGenerate() {
  pushUndo();
  const seed = (Math.random() * 1e9) | 0;
  const before = clone(pat());
  const lockedParams = Object.fromEntries(TRACK_IDS.filter((id) => state.locks[id]).map((id) => [id, clone(state.params[id])]));
  matchStyleScale();
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
  toast(`${STYLES[style].name} pattern → ${PATTERN_NAMES[state.current]}${TRACK_IDS.some((id) => state.locks[id]) ? ' · locked tracks kept' : ''}`);
}

function doGenerateSet() {
  pushUndo();
  const seed = (Math.random() * 1e9) | 0;
  const source = clone(pat());
  const lockedParams = Object.fromEntries(TRACK_IDS.filter((id) => state.locks[id]).map((id) => [id, clone(state.params[id])]));
  matchStyleScale();
  const g = generate(style, seed, state.scale);
  state.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  state.key = g.key;
  for (const p of state.patterns) for (const id of TRACK_IDS) if (state.locks[id]) {
    p.steps[id] = clone(source.steps[id]);
    p.len[id] = source.len[id];
  }
  applyOverrides(state, g, !playing);
  for (const [id, params] of Object.entries(lockedParams)) state.params[id] = params;
  engine?.applyAll(); engine?.applyDelayTime();
  state.chainOn = true;
  state.chain = songChain(style, seed);
  const title = trackTitle(seed);
  const artist = loadAvatar().name || 'UNTERGRUND';
  state.artist = { name: artist, title, style, seed, created: new Date().toISOString() };
  build(); persist();
  toast(`New ${STYLES[style].name} track “${title}”`);
  saveTrack({ title, artist, style, state: clone(state) })
    .then(({ shared }) => toast(`“${title}” saved to ${shared ? 'the shared CRATE' : 'your CRATE'}`));
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
  app.append(buildHeader(), buildGenerateHome(), h('main', { class: 'main studio-workspace' }, h('div', { class: 'left' }, buildGrid(), buildEditor()), buildMaster()), buildTabBar());
  renderPatterns();
  for (const id of TRACK_IDS) renderRow(id);
  renderRoll();
  if (ui.playhead) ui.lastAbs = null;
  const tab = document.querySelector('.family-tab.on'), row = tab?.parentElement;
  if (row) row.scrollLeft = tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2;
}

function toggleStudio() {
  studioOpen = !studioOpen;
  localStorage.setItem('untergrund.studio-open', studioOpen ? '1' : '0');
  build();
}

const STYLE_HUE = {
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

function selectStyle(id) { style = id; build(); }
function selectFamily(f) {
  family = f;
  localStorage.setItem('untergrund.family', f);
  if (STYLES[style].family !== f) style = Object.keys(STYLES).find((id) => STYLES[id].family === f);
  build();
}
function generateNow() {
  stopPreview();
  generatedAt = performance.now();
  navigator.vibrate?.(12);
  doGenerateSet();
  if (!playing) play();
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
    replaceState(sanitize(track.state));
    play();
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
  let holdTimer = 0, held = false;
  card.addEventListener('pointerdown', () => {
    held = false;
    ensureAudio();
    holdTimer = setTimeout(() => { held = true; startPreview(id, card); }, 380);
  });
  const end = () => { clearTimeout(holdTimer); if (held) stopPreview(); };
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
  const chain = state.chainOn ? parseChain(state.chain) : [];
  ui.npCanvas = h('canvas', { class: 'np-viz', width: 1200, height: 220 });
  ui.npSection = h('b', {}, chain.length ? sectionName(sid, chain[0]) : `PATTERN ${PATTERN_NAMES[state.current]}`);
  ui.npBar = h('span', {}, chain.length ? `BAR 1 / ${chain.length}` : '');
  ui.npCells = chain.map((p) => h('i', { class: 'np-cell' }));
  ui.npChain = chain;
  ui.npStyle = sid;
  return [
    h('div', { class: 'now-playing' },
      h('span', { class: 'np-eyebrow' }, h('i', { class: 'np-dot' }), 'NOW PLAYING'),
      h('h1', {}, a.title || 'Untitled set'),
      h('div', { class: 'np-meta' }, `${a.name || 'UNTERGRUND'} · ${STYLES[sid].name} · ${state.bpm} BPM · ${KEYS[state.key]} ${SCALES[state.scale]?.name || 'MINOR'}`),
      ui.npCanvas,
      h('div', { class: 'np-progress' }, h('div', { class: 'np-label' }, ui.npSection, ui.npBar), h('div', { class: 'np-cells' }, ui.npCells))),
    h('div', { class: 'generate-actions np-actions' },
      h('button', { class: 'np-stop', title: 'Stop (Space)', 'aria-label': 'Stop', onclick: toggle }, h('i')),
      primary,
      h('button', { class: 'btn refine-toggle', onclick: toggleStudio }, 'REFINE'),
      h('button', { class: 'btn ghost np-pub', onclick: showSongPublish }, 'PUBLISH'),
      h('button', { class: 'btn ghost rec', title: 'Record your set, then cut and publish it', onclick: toggleRec }, h('span', { class: 'dot' }), 'REC', h('span', { class: 'rec-time' }))),
  ];
}

function updateNowPlaying(ev) {
  const cells = ui.npCells;
  if (!cells?.length || !cells[0].isConnected) return;
  const i = Math.floor(ev.abs / 16) % ui.npChain.length;
  if (cells.idx === i) return;
  cells.idx = i;
  cells.forEach((c, j) => { c.classList.toggle('now', j === i); c.classList.toggle('past', j < i); });
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
  old.replaceWith(buildGenerateHome());
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
  const primary = h('button', { class: 'generate-primary' + (performance.now() - generatedAt < 900 ? ' fired' : ''), onclick: generateNow },
    h('span', {}, 'GENERATE'), h('small', {}, `${STYLES[style].name} · full track`));
  const showNp = playing && !studioOpen;
  const left = showNp ? buildNowPlaying(primary) : [
    h('div', { class: 'generate-copy' },
      h('span', {}, 'TECHNO · HOUSE · JAZZ · HIP-HOP · BASS'),
      h('h1', {}, 'Press Generate. Hear a finished track.'),
      h('p', {}, 'Choose a sound and UNTERGRUND writes a full arrangement you can perform live, refine in Studio, or spin in the Club.')),
    h('div', { class: 'generate-actions' }, primary,
      h('button', { class: 'btn refine-toggle', onclick: toggleStudio }, studioOpen ? 'HIDE STUDIO' : 'REFINE IN STUDIO'),
      h('button', { class: 'btn ghost', onclick: () => startArtistLive() }, 'ARTIST LIVE')),
    h('div', { class: 'generate-status' }, statusLine()),
  ];
  const recent = recentTracks().slice(0, 8);
  const recents = recent.length ? h('div', { class: 'recents' },
    h('div', { class: 'recents-label' }, 'RECENT TRACKS'),
    h('div', { class: 'recents-row' }, recent.map((t) => h('button', { class: 'recent', style: `--hue:${hue(t.style)}`, onclick: () => openRecent(t) },
      h('i'), h('b', {}, t.title || 'Untitled'), h('span', {}, [STYLES[t.style]?.name, t.bpm && `${t.bpm} BPM`].filter(Boolean).join(' · ')))))) : null;
  const home = h('section', { class: 'generate-home' + (showNp ? ' is-playing' : ''), style: `--hue:${hue(showNp ? playingStyle || style : style)}` }, left, picker, recents);
  ui.home = home;
  return home;
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
    h('button', { class: 'btn ghost', title: 'Copy pattern', onclick: () => { clipboard = clone(pat()); toast(`Copied ${PATTERN_NAMES[state.current]}`); } }, 'CPY'),
    h('button', { class: 'btn ghost', title: 'Paste pattern', onclick: () => { if (!clipboard) return toast('Clipboard empty'); pushUndo(); state.patterns[state.current] = clone(clipboard); build(); persist(); } }, 'PST'),
    h('button', { class: 'btn ghost', title: 'Clear pattern', onclick: () => { pushUndo(); state.patterns[state.current] = emptyPattern(); build(); persist(); } }, 'CLR'));

  const chainInput = h('input', { class: 'chain', value: state.chain, spellcheck: 'false', title: 'Arrangement: one letter per bar, e.g. AABBCCDD',
    oninput: (e) => { state.chain = e.target.value.toUpperCase().replace(/[^A-H]/g, ''); persist(); } });
  const chainBtn = h('button', { class: 'btn toggle' + (state.chainOn ? ' on' : ''), title: 'Play the arrangement chain',
    onclick: (e) => { state.chainOn = !state.chainOn; e.currentTarget.classList.toggle('on', state.chainOn); if (seq) seq.chainPos = 0; persist(); } }, 'CHAIN');

  const styleSel = h('select', { class: 'sel', title: 'Generator style', onchange: (e) => { style = e.target.value; build(); } },
    Object.entries(STYLES).map(([k, v]) => { const o = h('option', { value: k }, v.name); if (k === style) o.selected = true; return o; }));

  const bars = h('select', { class: 'sel', title: 'Bars to render' }, [4, 8, 16, 32, 64].map((b) => { const o = h('option', { value: b }, b + ' BARS'); if (b === 16) o.selected = true; return o; }));
  const exportBtn = h('button', { class: 'btn', title: 'Offline render to 24-bit / 48 kHz WAV (follows chain if on)', onclick: async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'RENDERING…';
    try {
      const buf = await renderBars(state, +bars.value);
      download(bufferToWav(buf), `untergrund-${state.bpm}bpm-${bars.value}bars-${stamp()}.wav`);
      toast(`Rendered ${bars.value} bars · 48 kHz / 24-bit WAV`);
    } catch (err) { console.error(err); toast('Render failed: ' + err.message); }
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
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, h('i'), h('b')), h('div', {}, h('div', { class: 'name' }, 'UNTERGRUND'), h('div', { class: 'sub' }, 'techno synthesis engine'))),
    h('div', { class: 'group transport' }, playBtn, recBtn, h('div', { class: 'transport-fields studio-only' }, h('div', { class: 'field' }, h('label', {}, 'BPM'), bpm.el), swing.el,
      h('div', { class: 'field' }, h('label', {}, 'KEY'), key), h('div', { class: 'field' }, h('label', {}, 'SCALE'), scale))),
    h('div', { class: 'group studio-only' }, h('div', { class: 'field' }, h('label', {}, 'PATTERN'), pats), patTools),
    h('div', { class: 'group studio-only studio-more' }, chainBtn, chainInput),
    h('div', { class: 'group gen studio-only studio-more' }, styleSel,
      h('button', { class: 'btn accent', title: 'Generate a pattern into this slot (G)', onclick: doGenerate }, 'GENERATE'),
      h('button', { class: 'btn', title: 'Generate a whole 8-pattern arrangement and enable chain', onclick: doGenerateSet }, 'NEW SET'),
      h('button', { class: 'btn ghost', title: 'Small variation (M)', onclick: doMutate }, 'MUTATE'),
      h('select', { class: 'sel variation', title: 'How far the next variation moves from this pattern', onchange: (e) => { variation = +e.target.value; } },
        h('option', { value: .12 }, 'SUBTLE'), h('option', { value: .25, selected: true }, 'EVOLVE'), h('option', { value: .55 }, 'WILD')),
      h('button', { class: 'btn ghost evolve', title: 'Create an evolved copy in the next pattern slot', onclick: createVariation }, 'VAR →'),
      h('button', { class: 'btn ghost', title: 'Undo (Ctrl+Z)', onclick: undo }, 'UNDO')),
    h('div', { class: 'group studio-only studio-more' }, liveBtn, bars, exportBtn, publishBtn),
    h('div', { class: 'group studio-only studio-more' },
      h('button', { class: 'btn ghost', title: 'Save project JSON', onclick: () => download(new Blob([JSON.stringify(state)], { type: 'application/json' }), `untergrund-${stamp()}.json`) }, 'SAVE'),
      h('button', { class: 'btn ghost', title: 'Load project JSON', onclick: () => fileIn.click() }, 'LOAD'), fileIn),
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
    h('div', { class: 'foot' }, `${getSample().source === 'synth' ? '100% synthesized · no samples' : 'synth + your own samples'} · 48k/24-bit export`));
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

document.addEventListener('visibilitychange', () => save(state));

build();
requestAnimationFrame(frame);
if (new URLSearchParams(location.search).has('room')) setTimeout(showClub);
else if (new URLSearchParams(location.search).has('jukebox')) setTimeout(showJukebox);
restoreSample();
window.__untergrund = { get state() { return state; }, get engine() { return engine; } };
