import { STYLES } from './state.js';
import { renderBars } from './render.js';
import { liveSets, setsReady, withTakes } from './livekit.js';
import { analyzePcm, lufs, spectralBands } from './lab-metrics.js';
import { TAGS, SCHEMA, mergeJudgments, nextStyle, summarize, songFor, windowOf } from './ear-data.js';

const $ = (id) => document.getElementById(id);
// Play through the iPhone silent switch, like the app.
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
const KEY = 'untergrund:ear:v1';
const params = new URLSearchParams(location.search);
const BARS = Math.max(1, Math.min(16, Math.round(+params.get('bars')) || 8));
const ONLY = params.get('style');
const STYLE_IDS = Object.keys(STYLES).filter((id) => id !== 'repertoire' && (!ONLY || id === ONLY));
const load = () => { try { return mergeJudgments(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; } };
let judgments = load(), build = 'dev', ctx, pair, next, playing = null, tags = new Set();

async function renderSide(style, seed) {
  const s = songFor(style, seed), w = windowOf(s, BARS);
  const t0 = performance.now();
  const buffer = await renderBars(s, w.bars, { startBar: w.startBar, tail: 1.5 });
  // A synth stand-in for a recording that failed to load would make the pick unreproducible: don't ask about it.
  const sets = withTakes(liveSets(s));
  if (!setsReady(sets)) throw new Error('instrument samples did not load; check the connection and reload');
  const ch = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const m = analyzePcm(ch, buffer.sampleRate, { bpm: s.bpm, renderMs: performance.now() - t0 });
  const metrics = { lufs: +lufs(ch, buffer.sampleRate).toFixed(2), ...spectralBands(ch, buffer.sampleRate) };
  for (const [k, v] of Object.entries(m)) if (typeof v === 'number' && Number.isFinite(v)) metrics[k] = v;
  return { seed, ...w, bpm: s.bpm, buffer, metrics };
}
const seed = () => (Math.random() * 1e9) | 0;
async function makePair() {
  // The pair on screen counts as rated, so the prefetched pair balances styles as of after this pick.
  const style = nextStyle(STYLE_IDS, pair ? [...judgments, { style: pair.style }] : judgments);
  const [a, b] = await Promise.all([renderSide(style, seed()), renderSide(style, seed())]);
  // Louder sounds better in a blind test: both play at the quieter one's loudness.
  const quiet = Math.min(a.metrics.lufs, b.metrics.lufs);
  for (const x of [a, b]) x.gain = Math.min(1, 10 ** ((quiet - x.metrics.lufs) / 20));
  return { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, style, a, b, heard: { a: 0, b: 0 }, switches: 0 };
}

function stop() {
  if (!playing) return;
  try { playing.src.stop(); } catch {}
  pair.heard[playing.side] += ctx.currentTime - playing.t0;
  playing = null;
}
// A/B switching keeps the playhead, so both sides are heard at the same moment of the music.
function play(sideId) {
  ctx ||= new AudioContext();
  ctx.resume();
  const at = playing ? (ctx.currentTime - playing.t0 + playing.offset) : 0;
  if (playing?.side === sideId) { stop(); return paint(); }
  if (playing) pair.switches++;
  stop();
  const x = pair[sideId], src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = x.buffer; g.gain.value = x.gain;
  src.connect(g).connect(ctx.destination);
  const offset = at % x.buffer.duration;
  src.start(0, offset);
  src.onended = () => { if (playing?.src === src) { stop(); paint(); } };
  playing = { side: sideId, src, t0: ctx.currentTime, offset };
  paint();
}

function paint() {
  for (const id of ['a', 'b']) {
    const btn = $(`play-${id}`);
    btn.classList.toggle('on', playing?.side === id);
    btn.setAttribute('aria-pressed', String(playing?.side === id));
    btn.disabled = !pair;
  }
  for (const id of ['pick-a', 'pick-b', 'pick-same']) $(id).disabled = !pair || !(pair.heard.a + pair.heard.b > 0 || playing);
  const n = judgments.length;
  $('count').textContent = n === 1 ? '1 pick' : `${n} picks`;
  $('send').disabled = !n;
}
function renderTags() {
  $('tags').replaceChildren(...TAGS.map(([id, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tag' + (tags.has(id) ? ' on' : ''); b.textContent = label;
    b.setAttribute('aria-pressed', String(tags.has(id)));
    b.onclick = () => { tags.has(id) ? tags.delete(id) : tags.add(id); renderTags(); };
    return b;
  }));
}
async function show() {
  pair = null; paint();
  $('status').textContent = 'Rendering two songs…';
  try {
    pair = await (next || makePair());
  } catch (error) {
    next = null;
    $('status').textContent = `Could not render: ${error.message}`;
    return;
  }
  next = makePair().catch(() => null).then((p) => p || makePair());
  tags = new Set(); renderTags();
  $('genre').textContent = STYLES[pair.style].name;
  $('status').textContent = 'Play A and B, switch any time, then pick.';
  paint();
}
function choose(pick) {
  stop();
  const side = (x) => ({ seed: x.seed, startBar: x.startBar, bars: x.bars, metrics: x.metrics });
  const j = {
    schema: SCHEMA, id: pair.id, at: new Date().toISOString(), build, style: pair.style, bpm: pair.a.bpm,
    a: { seed: pair.a.seed, startBar: pair.a.startBar, bars: pair.a.bars }, b: { seed: pair.b.seed, startBar: pair.b.startBar, bars: pair.b.bars },
    pick, tags: [...tags], heardSec: { a: +pair.heard.a.toFixed(1), b: +pair.heard.b.toFixed(1) }, switches: pair.switches,
    metrics: { a: side(pair.a).metrics, b: side(pair.b).metrics },
  };
  judgments = mergeJudgments(judgments, [j]);
  localStorage.setItem(KEY, JSON.stringify(judgments));
  show();
}
async function send() {
  const body = JSON.stringify({ schema: SCHEMA, exportedAt: new Date().toISOString(), summary: summarize(judgments), judgments }, null, 1);
  const name = `ear-${new Date().toISOString().slice(0, 10)}-${judgments.length}.json`;
  const file = new File([body], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'UNTERGRUND ear picks' }); return; } catch (error) { if (error.name === 'AbortError') return; }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file); link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

$('play-a').onclick = () => play('a');
$('play-b').onclick = () => play('b');
$('pick-a').onclick = () => choose('a');
$('pick-b').onclick = () => choose('b');
$('pick-same').onclick = () => choose('same');
$('send').onclick = send;
renderTags(); paint();
fetch('/build.json').then((r) => (r.ok ? r.json() : null)).then((b) => { if (b?.commit) build = b.commit; }).catch(() => {});
window.__ear = { songFor, windowOf, judgments: () => judgments };
show();
