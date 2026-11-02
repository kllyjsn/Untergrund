// Compact iframe player for /embed.html?s=<code> or ?t=<id>. Plays the song live in the listener's browser.
import { Engine, Sequencer, parseChain } from './engine.js';
import { STYLES } from './state.js';
import { fetchTrack } from './crate.js';
import { drawArtwork } from './artwork.js';
import { readShareParams, decodeSong, normalizeSong, songLink, embedCode, creditLine } from './share-code.js';
import { loadLiveKit, loadBand, STAB_BAND } from './livekit.js';

const $ = (id) => document.getElementById(id);
const track = (name, props = {}) => { try { window.untergrundTrack?.(name, props); } catch {} };
const params = readShareParams(location);
const pageLink = params ? songLink(location.origin, params) : location.origin;
$('open').href = pageLink;

let song = null, ctx = null, engine = null, seq = null, timer = 0, abs = 0, next = 0, playing = false, media = null;

function ensureAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  if (ctx) { if (ctx.state !== 'running') ctx.resume(); if (media?.paused) media.play().catch(() => {}); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
  engine = new Engine(ctx, song.state);
  if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    const route = ctx.createMediaStreamDestination();
    try { engine.out.disconnect(ctx.destination); } catch { engine.out.disconnect(); }
    engine.out.connect(route);
    media = Object.assign(document.createElement('audio'), { autoplay: true, srcObject: route.stream });
    media.setAttribute('playsinline', '');
    document.body.append(media);
    media.play().catch(() => {});
  }
  seq = new Sequencer(engine, song.state);
}

function schedule() {
  while (next < ctx.currentTime + 0.12) { seq.tick(abs, next); next += engine.stepDur; abs++; }
  const chain = song.state.chainOn ? parseChain(song.state.chain) : [];
  const total = (chain.length || 8) * 16;
  $('bar').style.width = `${((abs % total) / total) * 100}%`;
}

async function play() {
  ensureAudio();
  const st = song.state;
  if (Math.round(st.master.kit || 0) === 1) await loadLiveKit().catch(() => {});
  const band = STAB_BAND[Math.round(st.params.stab?.voice || 0)];
  if (band) await loadBand(band).catch(() => {});
  const chain = st.chainOn ? parseChain(st.chain) : [];
  abs = 0; seq.cur = chain.length ? chain[0] : st.current; seq.chainPos = 0; seq.queued = null;
  next = ctx.currentTime + 0.08;
  playing = true; timer = setInterval(schedule, 25); schedule();
  document.body.classList.add('on'); $('play').setAttribute('aria-label', 'Stop');
  track('embed_play', { style: song.style });
}

function stop() {
  playing = false; clearInterval(timer); engine?.panic();
  document.body.classList.remove('on'); $('play').setAttribute('aria-label', 'Play');
}

$('play').onclick = () => (playing ? stop() : play());
$('copy').onclick = async () => {
  const code = embedCode(location.href, song?.title);
  try { await navigator.clipboard.writeText(code); $('copy').textContent = 'COPIED'; setTimeout(() => { $('copy').textContent = 'EMBED'; }, 1500); }
  catch { prompt('Copy the embed code:', code); }
};

(async () => {
  try {
    song = params?.code ? await decodeSong(params.code)
      : params?.id ? await fetchTrack(params.id).then((t) => t?.state && normalizeSong({ ...t, remixOf: t.remixOf }))
      : null;
  } catch { song = null; }
  if (!song) { $('title').textContent = 'Song not found'; $('meta').textContent = 'Open UNTERGRUND to make your own.'; return; }
  document.title = `${song.title} · ${song.artist} · UNTERGRUND`;
  $('title').textContent = song.title;
  $('meta').textContent = [`${song.artist} · ${STYLES[song.style]?.name || ''} · ${song.state.bpm} BPM`, creditLine(song.remixOf)].filter(Boolean).join(' · ');
  $('art').append(drawArtwork(song.state, { title: song.title, style: STYLES[song.style]?.name, seed: 7, size: 240 }));
  $('play').disabled = false;
})();
