// 9:16 clip of a song's peak for TikTok/Reels/Shorts: audio rendered offline (glitch-free), then recorded
// with beat-reactive artwork via MediaRecorder. mp4 (H.264/AAC) where supported, otherwise WebM.
import { renderBars } from './render.js';
import { parseChain } from './engine.js';
import { TRACKS, KEYS, SCALES } from './params.js';
import { STYLES } from './state.js';
import { stepValues, hits } from './artwork.js';
import { creditLine } from './share-code.js';

export const VIDEO_W = 1080, VIDEO_H = 1920;
const FPS = 30;
// H.264 in MP4 first (what TikTok/Reels and iOS Photos expect); Chrome without AAC gets H.264 + Opus.
const MIMES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d002a,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1.64002a,opus', 'video/mp4;codecs=avc1,opus', 'video/mp4',
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function videoMime() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return '';
  return MIMES.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
}

const isPeak = (p) => p === 2 || p === 6, isFill = (p) => p === 3 || p === 7;

// Bar to start the clip at: the densest stretch of the song chain, entered from its fill when there is one.
export function peakWindow(state, bars) {
  const chain = state.chainOn ? parseChain(state.chain) : [];
  if (chain.length <= bars) return 0;
  const energy = chain.map((p) => hits(state.patterns[p]) + (isPeak(p) ? 24 : 0) + (state.patterns[p].hm === 2 ? 8 : 0));
  let best = 0, bestScore = -1;
  for (let i = 0; i + bars <= chain.length; i++) {
    const score = energy.slice(i, i + bars).reduce((a, b) => a + b, 0);
    if (score > bestScore) { best = i; bestScore = score; }
  }
  if (best > 0 && isPeak(chain[best]) && isFill(chain[best - 1])) best--;
  return best;
}

// Per-frame loudness and low-end punch, measured from the rendered audio so visuals hit on the beat.
function envelopes(buf, frames) {
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const per = buf.sampleRate / FPS, a = 1 - Math.exp((-2 * Math.PI * 140) / buf.sampleRate);
  const kick = new Float32Array(frames), level = new Float32Array(frames);
  let lp = 0, i = 0;
  for (let f = 0; f < frames; f++) {
    let pk = 0, sq = 0; const end = Math.min(L.length, Math.round((f + 1) * per)), n = Math.max(1, end - i);
    for (; i < end; i++) { const m = (L[i] + R[i]) * 0.5; lp += a * (m - lp); pk = Math.max(pk, Math.abs(lp)); sq += m * m; }
    kick[f] = pk; level[f] = Math.sqrt(sq / n);
  }
  const norm = (arr) => { let m = 1e-6; for (const v of arr) m = Math.max(m, v); for (let f = 0; f < arr.length; f++) arr[f] /= m; };
  norm(kick); norm(level);
  for (let f = 1; f < frames; f++) kick[f] = Math.max(kick[f], kick[f - 1] * 0.82);
  return { kick, level };
}

function wrap(g, text, max, lines = 2) {
  const words = text.split(/\s+/), out = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width <= max || !line) line = next; else { out.push(line); line = w; }
  }
  out.push(line);
  if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].replace(/\s*\S*$/, '…'); }
  return out;
}

export function makeScene(song, { hue = '#ff2b2b', startBar = 0, seconds = 15 } = {}) {
  const st = song.state, c = document.createElement('canvas');
  c.width = VIDEO_W; c.height = VIDEO_H;
  const g = c.getContext('2d');
  const chain = st.chainOn ? parseChain(st.chain) : [];
  const patAt = (bar) => st.patterns[chain.length ? chain[(startBar + bar) % chain.length] : st.current];
  const sd = 15 / st.bpm, cx = VIDEO_W / 2, cy = 820;
  const sans = '"Inter Tight", "Arial Black", system-ui, sans-serif', mono = '"JetBrains Mono", ui-monospace, monospace';

  const text = document.createElement('canvas');
  text.width = VIDEO_W; text.height = VIDEO_H;
  const t = text.getContext('2d'), pad = 84;
  t.fillStyle = hue; t.fillRect(pad, 132, 34, 34); t.fillStyle = '#060607'; t.fillRect(pad + 11, 143, 12, 12);
  t.fillStyle = '#f2f2f4'; t.font = `900 40px ${sans}`; t.textBaseline = 'middle'; t.fillText('UNTERGRUND', pad + 56, 150);
  t.textAlign = 'right'; t.font = `700 32px ${mono}`; t.fillStyle = '#8a8a94'; t.fillText('untergrund.sh', VIDEO_W - pad, 150);
  t.textAlign = 'left'; t.textBaseline = 'alphabetic';
  let fs = 112; t.font = `900 ${fs}px ${sans}`;
  const title = song.title.toUpperCase();
  while (fs > 72 && wrap(t, title, VIDEO_W - pad * 2, 9).length > 2) { fs -= 4; t.font = `900 ${fs}px ${sans}`; }
  const lines = wrap(t, title, VIDEO_W - pad * 2);
  let y = 1440;
  t.fillStyle = '#f2f2f4';
  for (const l of lines) { t.fillText(l, pad, y); y += fs * 1.02; }
  t.font = `700 50px ${sans}`; t.fillStyle = '#d4d4da'; t.fillText(song.artist, pad, y + 6);
  t.font = `700 30px ${mono}`; t.fillStyle = hue;
  t.fillText(`${(STYLES[song.style]?.name || '').toUpperCase()} · ${st.bpm} BPM · ${KEYS[st.key]} ${SCALES[st.scale]?.name || 'MINOR'}`, pad, y + 66);
  const credit = creditLine(song.remixOf);
  if (credit) { t.fillStyle = '#8a8a94'; t.fillText(wrap(t, credit, VIDEO_W - pad * 2, 1)[0], pad, y + 112); }
  t.font = `700 34px ${mono}`; t.fillStyle = '#f2f2f4'; t.textAlign = 'center';
  t.fillText('Remix it at untergrund.sh', cx, 1842);

  // Grain and scanlines baked into the same overlay as the text: one drawImage per frame.
  const grain = document.createElement('canvas');
  grain.width = VIDEO_W / 2; grain.height = VIDEO_H / 2;
  const gg = grain.getContext('2d'), img = gg.createImageData(grain.width, grain.height);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 9; }
  gg.putImageData(img, 0, 0);
  gg.fillStyle = 'rgba(255,255,255,0.03)';
  for (let yy = 0; yy < grain.height; yy += 2) gg.fillRect(0, yy, grain.width, 1);
  t.drawImage(grain, 0, 0, VIDEO_W, VIDEO_H);

  const glow = document.createElement('canvas');
  glow.width = glow.height = 256;
  const gl = glow.getContext('2d'), grad = gl.createRadialGradient(128, 128, 4, 128, 128, 128);
  grad.addColorStop(0, hue); grad.addColorStop(1, hue + '00');
  gl.fillStyle = grad; gl.fillRect(0, 0, 256, 256);

  const rot0 = -Math.PI / 2;
  return {
    canvas: c,
    draw(time, { kick = 0, level = 0, spectrum = null } = {}) {
      const abs = Math.max(0, Math.floor(time / sd)), pat = patAt(Math.floor(abs / 16));
      g.globalAlpha = 1;
      g.fillStyle = '#060607'; g.fillRect(0, 0, VIDEO_W, VIDEO_H);
      const gr = 760 + 160 * kick;
      g.globalAlpha = 0.16 + 0.47 * kick;
      g.drawImage(glow, cx - gr, cy - gr, gr * 2, gr * 2);
      g.globalAlpha = 1;

      const S = 1000 * (1 + 0.035 * kick), rot = rot0 + time * 0.12;
      TRACKS.forEach((tr, i) => {
        const steps = stepValues(pat, tr.id), n = pat.len[tr.id] || steps.length, now = abs % n;
        const rad = S * (0.1 + i * 0.033);
        for (let s = 0; s < n; s++) {
          const v = steps[s], a0 = rot + (s / n) * Math.PI * 2, a1 = a0 + ((Math.PI * 2) / n) * 0.78;
          const lit = s === now;
          g.beginPath(); g.arc(cx, cy, rad, a0, a1);
          if (lit && v) { g.lineWidth = S * 0.06; g.strokeStyle = tr.color; g.globalAlpha = 0.3; g.stroke(); }
          g.lineWidth = S * (lit && v ? 0.03 : 0.02);
          g.strokeStyle = v ? (lit || v > 1 ? '#ffffff' : tr.color) : lit ? '#34343c' : '#18181c';
          g.globalAlpha = v ? (lit ? 1 : 0.55 + 0.4 * level) : 1;
          g.stroke();
        }
      });
      g.globalAlpha = 1;
      g.beginPath(); g.arc(cx, cy, S * 0.05 * (1 + 0.5 * kick), 0, Math.PI * 2); g.fillStyle = hue; g.fill();

      if (spectrum) {
        const bars = 40, gap = 10, bw = (VIDEO_W - 168 - gap * (bars - 1)) / bars, top = 1270, hMax = 70;
        g.fillStyle = hue;
        for (let b = 0; b < bars; b++) {
          const i0 = Math.floor(2 * Math.pow(spectrum.length / 4, b / bars)), i1 = Math.max(i0 + 1, Math.floor(2 * Math.pow(spectrum.length / 4, (b + 1) / bars)));
          let m = 0; for (let i = i0; i < i1; i++) m = Math.max(m, spectrum[i]);
          const v = Math.pow(m / 255, 1.6), bh = Math.max(6, v * hMax);
          g.globalAlpha = 0.25 + 0.75 * v;
          g.beginPath(); g.roundRect ? g.roundRect(84 + b * (bw + gap), top - bh / 2, bw, bh, bw / 2) : g.rect(84 + b * (bw + gap), top - bh / 2, bw, bh); g.fill();
        }
        g.globalAlpha = 1;
      }
      g.drawImage(text, 0, 0);
      g.fillStyle = '#222227'; g.fillRect(84, 1780, VIDEO_W - 168, 6);
      g.fillStyle = hue; g.fillRect(84, 1780, (VIDEO_W - 168) * Math.min(1, time / seconds), 6);
    },
  };
}

// Call from a tap: the AudioContext is created synchronously so iOS lets it run.
export async function exportVideo(song, { seconds = 15, hue, onProgress = () => {}, signal } = {}) {
  const mime = videoMime();
  if (!mime) throw new Error('This browser cannot record video. Try Chrome or Safari.');
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume?.();
  try {
    await Promise.all([document.fonts?.load(`900 100px "Inter Tight"`), document.fonts?.load(`700 30px "JetBrains Mono"`)].map((p) => p?.catch?.(() => {})));
    const st = song.state, barSec = 240 / st.bpm, bars = Math.ceil(seconds / barSec);
    const startBar = peakWindow(st, bars);
    onProgress(0, 'Mixing the audio…');
    const full = await renderBars(st, bars, { startBar, tail: 0.6 });
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const sr = full.sampleRate, len = Math.round(seconds * sr), lead = Math.round(0.05 * sr);
    const clip = ctx.createBuffer(2, len, sr), fadeIn = Math.round(0.004 * sr), fadeOut = Math.round(0.35 * sr);
    for (let ch = 0; ch < 2; ch++) {
      const src = full.getChannelData(Math.min(ch, full.numberOfChannels - 1)), dst = clip.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const gain = Math.min(1, i / fadeIn, (len - i) / fadeOut);
        dst[i] = (src[lead + i] || 0) * gain;
      }
    }
    const frames = Math.ceil(seconds * FPS) + 2, env = envelopes(clip, frames);
    const scene = makeScene(song, { hue, startBar, seconds });
    scene.draw(0);

    if (ctx.state !== 'running') await ctx.resume();
    const dest = ctx.createMediaStreamDestination(), an = ctx.createAnalyser();
    an.fftSize = 1024; an.smoothingTimeConstant = 0.55;
    const spectrum = new Uint8Array(an.frequencyBinCount);
    const source = ctx.createBufferSource();
    source.buffer = clip; source.connect(dest); source.connect(an);
    let video = scene.canvas.captureStream(0).getVideoTracks()[0];
    if (!video.requestFrame) { video.stop(); video = scene.canvas.captureStream(FPS).getVideoTracks()[0]; }
    const stream = new MediaStream([video, ...dest.stream.getAudioTracks()]);
    const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
    const chunks = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { mr.onstop = r; });
    mr.start(500);
    const t0 = ctx.currentTime + 0.08;
    source.start(t0);
    let last = -2;
    await new Promise((resolve, reject) => {
      const tick = () => {
        if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
        const time = ctx.currentTime - t0, f = Math.max(-1, Math.min(frames - 1, Math.floor(time * FPS)));
        if (f !== last) {
          last = f;
          an.getByteFrequencyData(spectrum);
          scene.draw(Math.max(0, time), { kick: f >= 0 ? env.kick[f] : 0, level: f >= 0 ? env.level[f] : 0, spectrum: f >= 0 ? spectrum : null });
          video.requestFrame?.();
          onProgress(Math.min(1, Math.max(0, time) / seconds), 'Recording the video…');
        }
        if (time >= seconds + 0.1) resolve(); else requestAnimationFrame(tick);
      };
      tick();
    }).finally(() => { if (mr.state !== 'inactive') mr.stop(); });
    await stopped;
    stream.getTracks().forEach((tr) => tr.stop());
    const type = (mr.mimeType || mime).split(';')[0];
    return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm', seconds, startBar };
  } finally {
    ctx.close?.();
  }
}
