// HUM A MELODY + YOUR VOICE AS AN INSTRUMENT. Hum into the mic, see the notes on a mini roll, then
// make it the song's hook or build a whole song around it. Takes never leave this device.
import { h } from './ui.js';
import { sheet } from './sets.js';
import { recordMic } from './sampler.js';
import { prepareHum, hookFor, fitProg, livePitch, noteLabel, NOTE_NAMES, tuneChops } from './hum.js';
import { getChops, setVoice, clearVoice, buildVoice } from './voice.js';
import { KEYS, SCALES, CHORDS } from './params.js';
import { generate } from './state.js';
import { track as trackEvent } from './analytics.js';

const MAX_SEC = 8;
const kk = (key) => (key > 6 ? key - 12 : key);
const SHAPE = [0, 0, 1, 2, 2, 1, 2, 2];

export function micError(err) {
  const n = err?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Microphone is blocked. Allow the mic for this site in your browser settings, then try again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No microphone found. Connect one and try again.';
  if (n === 'NotSupportedError') return 'This browser can\u2019t record here. Try Safari or Chrome.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'Another app is using the microphone.';
  return 'Couldn\u2019t record. Try again.';
}

// The hook lives in every scene of the song; a sung hook is heard from the first bar.
export function placeHook(patterns, hook) {
  patterns.forEach((p, i) => {
    if (p.score) return;
    p.hook = JSON.parse(JSON.stringify(hook));
    p.hm = Math.max(1, p.hm ?? SHAPE[i] ?? 2);
  });
}

// When the hum is major and the style is minor (or the reverse) use the relative key, so every hummed
// pitch class survives and the style keeps its mood.
export function songKey(detected, scaleName) {
  const major = scaleName === 'major';
  if (detected.scale === 'major' && !major) return (detected.key + 9) % 12;
  if (detected.scale === 'minor' && major) return (detected.key + 3) % 12;
  return detected.key;
}

// Build-around picks, from a handful of seeds of the style, the song whose chord changes carry the
// hummed melody best (the main progression counts most; the bridge's alt changes a little).
export function humSeed(style, scale, hum, tries = 24) {
  let best = (Math.random() * 1e9) | 0, score = -1;
  for (let i = 0; i < tries; i++) {
    const seed = (Math.random() * 1e9) | 0, g = generate(style, seed, scale);
    if (!g.pattern.prog?.length || g.pattern.score) return seed;
    const { hook } = hum(g.bpm, scale);
    const fit = fitProg(hook, g.pattern.prog, CHORDS) + 0.3 * fitProg(hook, g.pattern.alt, CHORDS);
    if (fit > score + 1e-9) { best = seed; score = fit; }
  }
  return best;
}

// One big mic button: tap to start, tap (or go quiet) to finish. Shows level and time left.
function micButton(api, { idle, maxSec = MAX_SEC, onTake }) {
  const ring = h('i', { class: 'mic-ring' });
  const label = h('b', {}, idle);
  const sub = h('small', {}, `Up to ${maxSec} seconds`);
  const status = h('div', { class: 'mic-status', role: 'status', 'aria-live': 'polite' });
  const live = h('div', { class: 'mic-live', 'aria-hidden': 'true' });
  const btn = h('button', { class: 'mic-btn', 'aria-label': idle }, ring, h('span', {}, label, sub));
  let rec = null, raf = 0, cleanup = () => {};
  const reset = () => {
    cancelAnimationFrame(raf); cleanup(); cleanup = () => {};
    rec = null; live.replaceChildren(); btn.classList.remove('live'); btn.style.setProperty('--lvl', 0); btn.style.setProperty('--p', 0);
    label.textContent = idle; sub.textContent = `Up to ${maxSec} seconds`;
  };
  btn.onclick = async () => {
    if (rec) { label.textContent = 'Listening back\u2026'; rec.stop(); return; }
    status.textContent = '';
    api.ensureAudio();
    if (api.playing()) api.stop();
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch {}
    try { rec = await recordMic(maxSec, { echoCancellation: true, noiseSuppression: true, autoGainControl: true }); }
    catch (err) { reset(); api.ensureAudio(); status.textContent = micError(err); return; }
    btn.classList.add('live');
    label.textContent = 'Listening\u2026 tap when done';
    navigator.vibrate?.(10);
    let an = null, buf = null, heard = false, quietAt = 0;
    try {
      const ctx = api.engine().ctx, src = ctx.createMediaStreamSource(rec.stream);
      an = ctx.createAnalyser(); an.fftSize = 2048; buf = new Float32Array(an.fftSize);
      src.connect(an);
      cleanup = () => { try { src.disconnect(); } catch {} };
    } catch {}
    const t0 = performance.now(), me = rec, sr = api.engine().ctx.sampleRate;
    // The notes appear as you hum them: a pitch has to hold for a few frames to count.
    let cand = null, held = 0, last = null, frame = 0;
    const hearNote = (m) => {
      const pc = m === null ? null : ((Math.round(m) % 12) + 12) % 12;
      if (pc === cand) held++; else { cand = pc; held = 1; }
      if (pc === null || held !== 4) return;
      live.querySelector('.now')?.classList.remove('now');
      if (pc !== last || !live.lastChild) live.append(h('span', { class: 'now' }, NOTE_NAMES[pc]));
      else live.lastChild.classList.add('now');
      last = pc;
      while (live.childNodes.length > 8) live.firstChild.remove();
    };
    const tick = () => {
      const el = (performance.now() - t0) / 1000;
      btn.style.setProperty('--p', Math.min(1, el / maxSec));
      sub.textContent = `${Math.max(0, Math.ceil(maxSec - el))}s left`;
      if (an) {
        an.getFloatTimeDomainData(buf);
        let s = 0; for (const v of buf) s += v * v;
        const rms = Math.sqrt(s / buf.length);
        btn.style.setProperty('--lvl', Math.min(1, rms * 9).toFixed(2));
        if (rms > 0.03) { heard = true; quietAt = 0; } else if (heard) quietAt ||= performance.now();
        if (frame++ % 2 === 0) hearNote(rms > 0.02 ? livePitch(buf, sr) : null);
        if (quietAt) last = null;
        // Finished singing: stop by itself after a long breath.
        if (heard && quietAt && performance.now() - quietAt > 1400 && el > 1.5) { label.textContent = 'Listening back\u2026'; me.stop(); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    rec.done.then((take) => { reset(); api.ensureAudio(); onTake(take); },
      (err) => { reset(); api.ensureAudio(); status.textContent = micError(err); });
  };
  return { el: h('div', { class: 'mic-wrap' }, btn, live, status), status };
}

// Mini piano roll: the hummed pitch (faint line) under the notes it became, on the 2-bar grid.
export function drawRoll(canvas, res, playStep = -1) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 600, H = canvas.clientHeight || 150;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const base = 60 + kk(res.key);
  const notes = res.hook.s.map((st, i) => st && { step: i, len: st[1], m: base + st[0], echo: res.answered && i >= 16 }).filter(Boolean);
  const ms = notes.map((n) => n.m);
  let lo = Math.min(...ms) - 2, hi = Math.max(...ms) + 2;
  while (hi - lo < 12) { lo--; hi++; }
  const rows = hi - lo + 1, rh = H / rows, cw = W / 32;
  const y = (m) => (hi - m) * rh;
  for (let m = lo; m <= hi; m++) {
    const black = [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
    g.fillStyle = black ? 'rgba(255,255,255,.025)' : 'rgba(255,255,255,.055)';
    g.fillRect(0, y(m) + 0.5, W, rh - 1);
  }
  for (let i = 0; i <= 32; i++) {
    g.fillStyle = i % 16 === 0 ? 'rgba(255,255,255,.32)' : i % 4 === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.04)';
    g.fillRect(Math.round(i * cw), 0, 1, H);
  }
  const first = res.raw[0], step0 = notes[0];
  if (first && step0) {
    const sd = 60 / res.bpm / 4, shift = step0.m - first.midi - (res.tuning || 0);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.5; g.beginPath();
    let pen = false;
    for (const f of res.track.frames) {
      if (f.midi === null) { pen = false; continue; }
      const x = (((f.t - first.start) * res.timeScale) / sd) * cw, yy = y(f.midi + shift) + rh / 2;
      if (x < -4 || x > W + 4) { pen = false; continue; }
      if (pen) g.lineTo(x, yy); else g.moveTo(x, yy);
      pen = true;
    }
    g.stroke();
  }
  const hue = getComputedStyle(canvas).getPropertyValue('--hue').trim() || '#c6ff3d';
  g.font = '600 10px ui-monospace, monospace'; g.textBaseline = 'middle';
  for (const n of notes) {
    const x = n.step * cw + 1, w = Math.max(cw - 2, n.len * cw - 2), on = playStep >= n.step && playStep < n.step + n.len;
    g.fillStyle = hue; g.globalAlpha = on ? 1 : n.echo ? 0.45 : 0.85;
    g.beginPath(); g.roundRect ? g.roundRect(x, y(n.m) + 1, w, rh - 2, 3) : g.rect(x, y(n.m) + 1, w, rh - 2); g.fill();
    g.globalAlpha = 1;
    if (w > 16 && rh > 9) { g.fillStyle = '#0a0b0a'; g.fillText(NOTE_NAMES[((n.m % 12) + 12) % 12], x + 4, y(n.m) + rh / 2); }
  }
  if (playStep >= 0) { g.fillStyle = '#fff'; g.fillRect(Math.round(playStep * cw), 0, 2, H); }
}

// Plays a hook preview without touching the song. Returns its length in seconds.
// Each preview plays through its own bus so a replay (or closing the sheet) can silence the last one.
let previewBus = null;
export function stopPreview() {
  if (!previewBus) return;
  const bus = previewBus, t = bus.context.currentTime;
  previewBus = null;
  bus.gain.setTargetAtTime(0, t, 0.015);
  setTimeout(() => bus.disconnect(), 120);
}

function preview(api, res, voice, sung) {
  stopPreview();
  const e = api.engine(), s = api.state(), t0 = e.ctx.currentTime + 0.08, sd = 60 / res.bpm / 4;
  const off = kk(res.key) - kk(s.key), bus = previewBus = e.ctx.createGain();
  bus.connect(e.ch.stab.input);
  e.hookBus = bus;
  try {
    res.hook.s.forEach((st, i) => {
      if (!st) return;
      const t = t0 + i * sd, dur = st[1] * sd;
      if (voice === 'chop' && sung) e.chopNote(sung, t, st[2], 60 + kk(res.key) + st[0], dur, res.hook.x, null, bus);
      else e.hook(t, st[2], st[0] + off, dur, voice, res.hook.o, false, 0.8, false, res.hook.x);
    });
  } finally { e.hookBus = null; }
  return { t0, sd };
}

export function openHum(api, { from = 'create' } = {}) {
  const s = api.state(), cur = s.patterns[s.current];
  const fromCreate = from === 'create';
  if (cur?.score && !fromCreate) return api.toast('Pick a groove style to hum a melody');
  trackEvent('hum', { kind: 'open' });
  const { body, close } = sheet('HUM A MELODY', { onClose: stopPreview });
  const synthVoice = (cur?.hook?.v && cur.hook.v !== 'chop' ? cur.hook.v : null) || 'warm';
  let take = null, sung = null, voice = synthVoice, raf = 0;
  const intro = () => {
    body.replaceChildren(
      h('p', { class: 'hum-lead' }, 'Hum or sing a few notes. UNTERGRUND turns them into your song\u2019s melody.'),
      micButton(api, { idle: 'Tap and hum', onTake: show }).el,
      h('p', { class: 'hum-note' }, 'Your recording stays on this device.'));
  };
  let prep = null;
  const songRes = () => {
    const { bpm, scale } = api.state();
    const key = fromCreate ? songKey(prep.detected, scale) : api.state().key;
    return hookFor(prep, { bpm, key, scaleNotes: SCALES[scale]?.notes, voice });
  };
  function show(t) {
    take = t;
    prep = prepareHum(take.channels[0], take.sampleRate);
    const res = { ...songRes(), bpm: api.state().bpm };
    if (!res.hook) {
      body.replaceChildren(
        h('p', { class: 'hum-lead' }, 'We couldn\u2019t hear a melody.'),
        h('p', { class: 'hum-note' }, 'Hum a little louder, one clear note at a time, close to the mic.'),
        micButton(api, { idle: 'Hum again', onTake: show }).el);
      return;
    }
    sung = buildVoice(take, 'MY HUM');
    const canvas = h('canvas', { class: 'hum-roll', 'aria-label': 'Detected notes' });
    const names = res.hook.s.slice(0, res.answered ? 16 : 32).map((st) => st && noteLabel(60 + kk(res.key) + st[0]).replace(/-?\d+$/, '')).filter(Boolean);
    const scaleName = SCALES[api.state().scale]?.name || 'MINOR';
    const chips = h('div', { class: 'voice-chips hum-voice', role: 'radiogroup', 'aria-label': 'Sound' });
    const renderChips = () => chips.replaceChildren(...[['SYNTH', synthVoice], ['MY VOICE', 'chop']].map(([name, v]) => h('button', {
      class: `vchip${voice === v ? ' on' : ''}`, role: 'radio', 'aria-checked': String(voice === v), ...(v === 'chop' && !sung ? { disabled: '' } : {}),
      onclick: () => { voice = v; renderChips(); hear(); },
    }, name)));
    renderChips();
    const hear = () => {
      cancelAnimationFrame(raf);
      const { t0, sd } = preview(api, res, voice, sung), ctx = api.engine().ctx;
      const loop = () => {
        const st = (ctx.currentTime - t0) / sd;
        drawRoll(canvas, res, st);
        if (st < 32 && canvas.isConnected) raf = requestAnimationFrame(loop); else drawRoll(canvas, res);
      };
      raf = requestAnimationFrame(loop);
    };
    const hook = () => ({ ...res.hook, v: voice });
    const keep = () => { if (voice === 'chop' && sung) setVoice(sung); };
    const apply = () => {
      keep();
      api.edit((st) => placeHook(st.patterns, hook()));
      trackEvent('hum', { kind: 'apply' });
      close(true);
      api.toast('Your melody is the hook now. Undo anytime.');
      if (!api.playing()) api.play();
    };
    const build = () => {
      keep();
      const pre = prep, v = voice;
      trackEvent('hum', { kind: 'song' });
      close(true);
      api.buildSong((bpm, scale) => {
        const key = songKey(pre.detected, scale);
        return { key, hook: hookFor(pre, { bpm, key, scaleNotes: SCALES[scale]?.notes, voice: v }).hook };
      });
    };
    const primary = h('button', { class: 'btn accent hum-primary', onclick: fromCreate ? build : apply }, fromCreate ? 'BUILD A SONG AROUND IT' : 'USE IN MY SONG');
    const second = fromCreate && cur?.score ? null : h('button', { class: 'btn ghost', onclick: fromCreate ? apply : build }, fromCreate ? 'USE IN THIS SONG' : 'BUILD A NEW SONG');
    body.replaceChildren(
      h('div', { class: 'hum-found' }, h('b', {}, names.join(' \u00b7 ')), h('span', {}, `${names.length} notes \u00b7 ${KEYS[res.key]} ${scaleName} \u00b7 ${res.bpm} BPM`)),
      canvas,
      h('div', { class: 'hum-row' }, chips, h('button', { class: 'btn', onclick: hear }, 'HEAR IT')),
      h('div', { class: 'hum-actions' }, primary, second,
        h('button', { class: 'btn ghost', onclick: () => { cancelAnimationFrame(raf); stopPreview(); intro(); } }, 'HUM AGAIN')));
    requestAnimationFrame(() => { drawRoll(canvas, res); hear(); });
  }
  intro();
}

export function openVoice(api) {
  const { body, close } = sheet('YOUR VOICE AS AN INSTRUMENT');
  const render = () => {
    const vc = getChops();
    const mic = micButton(api, { idle: vc ? 'Record again' : 'Tap and sing', onTake: (take) => {
      if (setVoice(take)) { trackEvent('voice_chops', { kind: 'record' }); render(); }
      else mic.status.textContent = 'Couldn\u2019t find separate sounds. Leave a short gap between each one.';
    } });
    if (!vc) {
      body.replaceChildren(
        h('p', { class: 'hum-lead' }, 'Sing 3 to 6 short sounds with a little gap between: \u201cba\u201d, \u201cooh\u201d, \u201chey\u201d.'),
        h('p', { class: 'hum-note' }, 'We cut them into chops, tune them to your key, and your melody plays them. Your recording stays on this device.'),
        mic.el);
      return;
    }
    const s = api.state(), tuned = tuneChops(vc.chops, s.key, SCALES[s.scale]?.notes || SCALES.minor.notes);
    const pads = h('div', { class: 'chop-pads' }, tuned.map((c, i) => h('button', {
      class: 'chop-pad', style: `--w:${Math.min(1, (c.end - c.start) / 0.6)}`,
      onpointerdown: (e) => { e.preventDefault(); api.ensureAudio(); const en = api.engine(); en.chopNote(vc, en.ctx.currentTime + 0.01, 0.95, c.note ?? 60 + kk(s.key), c.end - c.start, {}, i); },
    }, h('b', {}, String(i + 1)), h('small', {}, c.note === null ? 'HIT' : noteLabel(c.note)))));
    const hasHook = s.patterns.some((p) => p.hook);
    const use = h('button', { class: 'btn accent hum-primary', onclick: () => {
      if (!hasHook) { close(true); return openHum(api, { from: 'studio' }); }
      api.edit((st) => st.patterns.forEach((p) => { if (p.hook) p.hook.v = 'chop'; }));
      trackEvent('voice_chops', { kind: 'use' });
      close(true);
      api.toast('Your voice sings the melody now');
      if (!api.playing()) api.play();
    } }, hasHook ? 'SING MY MELODY WITH IT' : 'HUM A MELODY FOR IT');
    body.replaceChildren(
      h('p', { class: 'hum-lead' }, `${vc.chops.length} chops, tuned to ${KEYS[s.key]}. Tap to play.`),
      pads,
      h('div', { class: 'hum-actions' }, use, mic.el,
        h('button', { class: 'btn ghost', onclick: () => { clearVoice(); api.edit((st) => st.patterns.forEach((p) => { if (p.hook?.v === 'chop') p.hook.v = 'warm'; })); render(); } }, 'REMOVE')),
      h('p', { class: 'hum-note' }, 'Stays on this device unless you publish a song that uses it.'));
  };
  render();
}

// Studio, CHORDS editor: where the song's melody (hook) comes from and which sound sings it.
export function melodyPanel(api) {
  const s = api.state(), hk = s.patterns[s.current]?.hook;
  const setVoice = (v) => api.edit((st) => st.patterns.forEach((p) => { if (p.hook) p.hook.v = v; }));
  const mine = hk?.v === 'chop';
  return h('div', { class: 'melody-panel' },
    h('div', { class: 'glabel' }, 'MELODY'),
    h('b', {}, !hk ? 'No melody yet' : hk.h ? 'Your hummed melody' : 'Generated melody'),
    h('small', {}, mine ? (getChops() ? 'Sung with your voice' : 'Record your voice to hear it') : 'Hum your own and it plays here'),
    h('button', { class: 'btn accent', onclick: () => openHum(api, { from: 'studio' }) }, 'HUM A MELODY'),
    hk ? h('div', { class: 'voice-chips', role: 'radiogroup', 'aria-label': 'Melody sound' },
      [['SYNTH', false], ['MY VOICE', true]].map(([name, on]) => h('button', {
        class: `vchip${on === mine ? ' on' : ''}`, role: 'radio', 'aria-checked': String(on === mine),
        onclick: () => { if (on === mine) return; if (on && !getChops()) return openVoice(api); setVoice(on ? 'chop' : 'warm'); },
      }, name))) : null,
    h('button', { class: 'btn ghost', onclick: () => openVoice(api) }, getChops() ? 'MY VOICE CHOPS' : 'RECORD MY VOICE'));
}

export const humButton = (api) => h('button', { class: 'hum-cta', onclick: () => openHum(api, { from: 'create' }) },
  h('i', { class: 'hum-ico', 'aria-hidden': 'true' }), h('span', {}, 'Hum a melody'));
