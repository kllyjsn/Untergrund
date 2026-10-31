import { TRACKS, TRACK_IDS, TRACK_BY_ID, MIX_PARAMS, MASTER_PARAMS, KEYS, SCALES, PATTERN_NAMES, STEPS, formatValue } from './params.js';
import { Engine, Sequencer, parseChain } from './engine.js';
import { defaultState, generate, mutate, arrangement, applyOverrides, clone, save, load, sanitize, STYLES, emptyPattern, emptyAcidStep } from './state.js';
import { renderBars, bufferToWav } from './render.js';
import { encodeWav } from './dsp.js';
import { knob, numBox, h } from './ui.js';
import { openPublish } from './publish.js';
import { loadArtistProfile, openArtistStudio } from './artist.js';
import { openClub } from './club.js';
import { roomTransportPosition, transportResync } from './room-sync.js';

let state = load() || defaultState();
let ctx = null, engine = null, seq = null, timer = null, recNode = null;
let playing = false, abs = 0, nextTime = 0, lastPlayedPat = null;
let transportOrigin = 0, roomJoinTimer = 0, clockOffset = null;
const uiQueue = [];
let selected = 'kick';
let style = 'hypnotic';
let studioOpen = localStorage.getItem('untergrund.studio-open') === '1';
let variation = 0.25;
let artistLive = null;
let clipboard = null;
const undoStack = [];
const rec = { on: false, chunks: [], start: 0 };
const ui = { rows: {}, playhead: -1 };

const app = document.getElementById('app');
const isText = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');

let saveTimer = 0;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(state), 300); }

// ---------------- audio ----------------
function ensureAudio() {
  if (ctx) { if (ctx.state !== 'running') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  engine = new Engine(ctx, state);
  seq = new Sequencer(engine, state);
  const src = "let id=null;onmessage=e=>{if(e.data==='start'&&!id)id=setInterval(()=>postMessage(0),15);if(e.data==='stop'){clearInterval(id);id=null;}}";
  timer = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  timer.onmessage = schedule;
  setupRecorder();
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

async function setupRecorder() {
  if (!ctx.audioWorklet) return;
  const src = `class R extends AudioWorkletProcessor{constructor(){super();this.on=false;this.port.onmessage=e=>this.on=e.data}
  process(i){const x=i[0];if(this.on&&x&&x.length){this.port.postMessage([x[0].slice(0),(x[1]||x[0]).slice(0)])}return true}}
  registerProcessor('untergrund-rec',R)`;
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  recNode = new AudioWorkletNode(ctx, 'untergrund-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
  engine.out.connect(recNode);
  const sink = ctx.createGain(); sink.gain.value = 0;
  recNode.connect(sink).connect(ctx.destination);
  recNode.port.onmessage = (e) => { if (rec.on) rec.chunks.push(e.data); };
}

function toggleRec() {
  ensureAudio();
  if (!recNode) return toast('Recorder is still starting — try again');
  if (!rec.on) {
    rec.chunks = []; rec.on = true; rec.start = performance.now();
    recNode.port.postMessage(true);
    if (!playing) play();
    toast('Recording master output…');
  } else {
    rec.on = false;
    recNode.port.postMessage(false);
    const len = rec.chunks.reduce((a, c) => a + c[0].length, 0);
    const L = new Float32Array(len), R = new Float32Array(len);
    let o = 0;
    for (const [l, r] of rec.chunks) { L.set(l, o); R.set(r, o); o += l.length; }
    rec.chunks = [];
    download(encodeWav([L, R], ctx.sampleRate), `untergrund-live-${stamp()}.wav`);
    toast(`Saved ${(len / ctx.sampleRate).toFixed(1)}s live recording (24-bit WAV)`);
  }
  document.body.classList.toggle('recording', rec.on);
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
  state = s;
  if (engine) { engine.state = state; seq.s = state; engine.applyAll(); }
  build(); persist();
}

function showPublish() {
  openPublish({
    getState: () => state,
    getStyle: () => style,
    render: async (n) => bufferToWav(await renderBars(state, n)),
    toast,
  });
}

function joinRoomSet(item) {
  if (!item?.state) return;
  style = item.style || item.state.artist?.style || style;
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

function doGenerate() {
  pushUndo();
  const seed = (Math.random() * 1e9) | 0;
  const before = clone(pat());
  const lockedParams = Object.fromEntries(TRACK_IDS.filter((id) => state.locks[id]).map((id) => [id, clone(state.params[id])]));
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
  const g = generate(style, seed, state.scale);
  state.patterns = arrangement(g.pattern, seed);
  for (const p of state.patterns) for (const id of TRACK_IDS) if (state.locks[id]) {
    p.steps[id] = clone(source.steps[id]);
    p.len[id] = source.len[id];
  }
  applyOverrides(state, g, !playing);
  for (const [id, params] of Object.entries(lockedParams)) state.params[id] = params;
  engine?.applyAll(); engine?.applyDelayTime();
  state.chainOn = true;
  build(); persist();
  toast(`New ${STYLES[style].name} set A–H · chain on: ${state.chain}`);
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
  app.append(buildHeader(), buildGenerateHome(), h('main', { class: 'main studio-workspace' }, h('div', { class: 'left' }, buildGrid(), buildEditor()), buildMaster()));
  renderPatterns();
  for (const id of TRACK_IDS) renderRow(id);
  renderRoll();
  if (ui.playhead) ui.lastAbs = null;
}

function buildGenerateHome() {
  const styleCards = h('div', { class: 'generate-styles' }, Object.entries(STYLES).map(([id, value]) =>
    h('button', {
      class: 'generate-style' + (style === id ? ' on' : ''),
      onclick: () => { style = id; build(); },
    }, h('b', {}, value.name), h('span', {}, ({ hypnotic: 'deep · rolling', industrial: 'hard · metallic', acid: '303 · elastic', dub: 'spacious · low', peak: 'urgent · main room' })[id]))));
  const generate = () => {
    doGenerateSet();
    if (!playing) play();
  };
  return h('section', { class: 'generate-home' },
    h('div', { class: 'generate-copy' },
      h('span', {}, 'AUTONOMOUS TECHNO INSTRUMENT'),
      h('h1', {}, 'Generate the set. Then make it yours.'),
      h('p', {}, 'Start with musical intent, not a wall of controls. UNTERGRUND builds an editable eight-scene arrangement from synthesized sound.')),
    styleCards,
    h('div', { class: 'generate-actions' },
      h('button', { class: 'generate-primary', onclick: generate }, h('span', {}, 'GENERATE'), h('small', {}, `${STYLES[style].name} · full arrangement`)),
      h('button', { class: 'btn refine-toggle', onclick: () => { studioOpen = !studioOpen; localStorage.setItem('untergrund.studio-open', studioOpen ? '1' : '0'); build(); } }, studioOpen ? 'HIDE STUDIO' : 'REFINE IN STUDIO'),
      h('button', { class: 'btn ghost', onclick: startArtistLive }, 'ARTIST LIVE')),
    h('div', { class: 'generate-status' },
      h('b', {}, `${state.bpm} BPM`), h('span', {}, `${KEYS[state.key]} ${SCALES[state.scale]?.name || 'MINOR'}`),
      h('span', {}, state.chainOn ? '8 SCENES · ARRANGED' : `PATTERN ${PATTERN_NAMES[state.current]}`),
      h('span', {}, '100% SYNTHESIZED')));
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
    KEYS.map((k, i) => { const o = h('option', { value: i }, k + ' min'); if (i === state.key) o.selected = true; return o; }));
  const scale = h('select', { class: 'sel', title: 'Scale used by the acid generator and highlighted in the piano roll',
    onchange: (e) => { state.scale = e.target.value; persist(); renderRoll(); } },
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
  const recBtn = h('button', { class: 'btn rec', title: 'Record live master output to WAV', onclick: toggleRec }, h('span', { class: 'dot' }), 'REC');
  const artistBtn = h('button', {
    class: 'btn artist-btn',
    title: 'Build the artist identity, catalog and release calendar',
    onclick: () => openArtistStudio({
      getState: () => state,
      loadProject: loadArtistProject,
      performProject: startArtistLive,
      publishProject: (item) => { loadArtistProject(item); showPublish(); },
      toast,
    }),
  }, 'ARTIST');
  const clubBtn = h('button', { class: 'btn club-btn', title: 'Enter an avatar listening room for UNTERGRUND-native sets', onclick: showClub }, 'CLUB');
  const liveBtn = h('button', {
    class: 'btn live-toggle' + (artistLive ? ' on' : ''),
    title: 'Let the autonomous artist perform and evolve this set',
    onclick: () => artistLive ? stopArtistLive() : startArtistLive(),
  }, artistLive ? 'LIVE ON' : 'LIVE');
  const publishBtn = h('button', { class: 'btn sc', title: 'Render and publish straight to SoundCloud', onclick: showPublish }, 'PUBLISH');

  const fileIn = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { replaceState(sanitize(JSON.parse(await f.text()))); toast('Project loaded'); } catch { toast('Could not read that file'); }
  } });

  return h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, h('i'), h('b')), h('div', {}, h('div', { class: 'name' }, 'UNTERGRUND'), h('div', { class: 'sub' }, 'techno synthesis engine'))),
    h('div', { class: 'group transport' }, playBtn, h('div', { class: 'field' }, h('label', {}, 'BPM'), bpm.el), swing.el,
      h('div', { class: 'field' }, h('label', {}, 'KEY'), key), h('div', { class: 'field' }, h('label', {}, 'SCALE'), scale)),
    h('div', { class: 'group studio-only' }, h('div', { class: 'field' }, h('label', {}, 'PATTERN'), pats), patTools),
    h('div', { class: 'group studio-only' }, chainBtn, chainInput),
    h('div', { class: 'group gen studio-only' }, styleSel,
      h('button', { class: 'btn accent', title: 'Generate a pattern into this slot (G)', onclick: doGenerate }, 'GENERATE'),
      h('button', { class: 'btn', title: 'Generate a whole 8-pattern arrangement and enable chain', onclick: doGenerateSet }, 'NEW SET'),
      h('button', { class: 'btn ghost', title: 'Small variation (M)', onclick: doMutate }, 'MUTATE'),
      h('select', { class: 'sel variation', title: 'How far the next variation moves from this pattern', onchange: (e) => { variation = +e.target.value; } },
        h('option', { value: .12 }, 'SUBTLE'), h('option', { value: .25, selected: true }, 'EVOLVE'), h('option', { value: .55 }, 'WILD')),
      h('button', { class: 'btn ghost evolve', title: 'Create an evolved copy in the next pattern slot', onclick: createVariation }, 'VAR →'),
      h('button', { class: 'btn ghost', title: 'Undo (Ctrl+Z)', onclick: undo }, 'UNDO')),
    h('div', { class: 'group' }, artistBtn, liveBtn, clubBtn, bars, exportBtn, recBtn, publishBtn),
    h('div', { class: 'group' },
      h('button', { class: 'btn ghost', title: 'Save project JSON', onclick: () => download(new Blob([JSON.stringify(state)], { type: 'application/json' }), `untergrund-${stamp()}.json`) }, 'SAVE'),
      h('button', { class: 'btn ghost', title: 'Load project JSON', onclick: () => fileIn.click() }, 'LOAD'), fileIn,
      h('button', { class: 'btn ghost', title: 'Shortcuts', onclick: showHelp }, '?')));
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
  const mk = (q) => {
    const k = knob(q, state.params[id][q.id], (v) => {
      setParam(id, q.id, v);
      if (q.id === 'level') ui.rows[id]?.lvl.set(v);
    }, { color: t.color, format: (v) => formatValue(q, v) });
    ui.editorKnobs[q.id] = k;
    return k.el;
  };
  const tools = h('div', { class: 'etools' },
    h('button', { class: 'btn ghost', title: 'Rotate left', onclick: () => rotateTrack(id, -1) }, '◀'),
    h('button', { class: 'btn ghost', title: 'Rotate right', onclick: () => rotateTrack(id, 1) }, '▶'),
    h('button', { class: 'btn ghost', title: `Random ${t.name} line in ${STYLES[style].name} style`, onclick: () => randomTrack(id) }, 'RND'),
    h('button', { class: 'btn ghost', title: 'Clear track', onclick: () => clearTrack(id) }, 'CLR'));
  const hint = {
    drum: 'click = step · shift/right-click = accent · drag to paint',
    acid: 'grid: click = gate · shift = accent · alt = slide · piano roll sets notes',
    stab: 'click = step · shift/right-click = accent · pair with DELAY + REVERB',
  }[t.kind];
  const ed = h('section', { class: 'editor panel', style: `--tc:${t.color}` },
    h('div', { class: 'ehead' }, h('div', { class: 'etitle' }, h('span', { class: 'sw' }), t.name), h('div', { class: 'hint' }, hint), tools),
    h('div', { class: 'ebody' },
      h('div', { class: 'kgroup' }, h('div', { class: 'glabel' }, 'VOICE'), h('div', { class: 'knobs' }, t.params.map(mk))),
      h('div', { class: 'kgroup' }, h('div', { class: 'glabel' }, 'CHANNEL'), h('div', { class: 'knobs' }, MIX_PARAMS.map(mk)))));
  ui.roll = null; ui.rollCols = null;
  if (id === 'acid') ed.append(buildRoll());
  return ed;
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
    const b = h('button', { class: 'btn perf', title: `${title} (hold ${keyName})` }, label, h('small', {}, keyName));
    const down = (e) => { e.preventDefault(); ensureAudio(); b.classList.add('on'); on(); };
    const up = () => { if (!b.classList.contains('on')) return; b.classList.remove('on'); off(); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    ui.perf[keyName] = { down: () => down(new Event('x')), up };
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
    h('div', { class: 'foot' }, '100% synthesized · no samples · 48k/24-bit export'));
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
window.__untergrund = { get state() { return state; }, get engine() { return engine; } };
