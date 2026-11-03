// Record a set at any time, cut it, publish songs and sets to the UNTERGRUND jukebox, and play the jukebox.
import { h } from './ui.js';
import { STYLES } from './state.js';
import { saveTrack } from './crate.js';
import { track as trackEvent } from './analytics.js';
import { encodeWav } from './dsp.js';
import { ensureDevice } from './account.js';
import { creditLine } from './share-code.js';
import { recentDrops } from './daily.js';

const MAX_WAV_SECONDS = 15 * 60;
export const fmtTime = (sec) => {
  const s = Math.max(0, Math.round(sec)), hh = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

export function createSetRecorder(ctx, node) {
  const supported = !!(window.MediaRecorder && ctx.createMediaStreamDestination);
  if (!supported) return { supported, on: false };
  const dest = ctx.createMediaStreamDestination();
  const an = ctx.createAnalyser(); an.fftSize = 2048;
  node.connect(dest); node.connect(an);
  const buf = new Float32Array(an.fftSize);
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
  let mr = null, chunks = [], peaks = [], t0 = 0, timer = null;
  return {
    supported,
    get on() { return !!mr; },
    elapsed: () => (mr ? (performance.now() - t0) / 1000 : 0),
    start() {
      chunks = []; peaks = [];
      mr = new MediaRecorder(dest.stream, { ...(mime && { mimeType: mime }), audioBitsPerSecond: 192000 });
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.start(1000);
      t0 = performance.now();
      timer = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v));
        peaks.push(m);
      }, 250);
    },
    stop() {
      const r = mr, duration = (performance.now() - t0) / 1000;
      clearInterval(timer); mr = null;
      return new Promise((resolve) => {
        r.onstop = () => resolve({ blob: new Blob(chunks, { type: r.mimeType || mime || 'audio/webm' }), duration, peaks: peaks.slice() });
        r.stop();
      });
    },
  };
}

// ---------- storage ----------
export function idb(op, value) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('untergrund-jukebox', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('items', { keyPath: 'id' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('items', op === 'put' ? 'readwrite' : 'readonly'), st = tx.objectStore('items');
      const req = op === 'put' ? st.put(value) : st.getAll();
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    };
  });
}

export async function jukeboxConfig() {
  try {
    const res = await fetch('/api/jukebox'), json = await res.json();
    return { enabled: res.ok && !!json.enabled, uploads: !!json.uploads, items: json.items || [] };
  } catch { return { enabled: false, uploads: false, items: [] }; }
}

async function postEntry(entry) {
  const res = await fetch('/api/jukebox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error === 'rate_limited' ? 'too many publishes this hour' : json.error || `publish failed (${res.status})`);
  return json.item;
}

const localId = () => `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const downsample = (peaks, n) => (peaks.length <= n ? peaks.slice() : Array.from({ length: n }, (_, i) =>
  Math.max(0, ...peaks.slice(Math.floor((i * peaks.length) / n), Math.floor(((i + 1) * peaks.length) / n)))));

export async function publishSong({ state, title, style, artist }) {
  const cfg = await jukeboxConfig();
  if (cfg.enabled) {
    await ensureDevice().catch(() => null);
    return { public: true, item: await postEntry({ kind: 'song', title, style, artist, bpm: state.bpm, state }) };
  }
  const { track } = await saveTrack({ title, style, artist, state });
  const item = { id: localId(), kind: 'song', title, style, artist, bpm: state.bpm, trackId: track.id, created: new Date().toISOString(), local: true, ...(state.remixOf && { remixOf: state.remixOf }) };
  await idb('put', item);
  return { public: false, item };
}

export async function publishSet({ blob, title, style, bpm, artist, duration, start, end, peaks, onProgress }) {
  const cfg = await jukeboxConfig();
  const meta = { kind: 'set', title, style, artist, bpm, duration, start, end, peaks: downsample(peaks, 400) };
  if (cfg.enabled && cfg.uploads) {
    const { upload } = await import('./vendor/blob-client.js');
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'set';
    const res = await upload(`sets/${slug}.${ext}`, blob, {
      access: 'public', handleUploadUrl: '/api/set-upload', contentType: blob.type.split(';')[0],
      multipart: blob.size > 20e6, onUploadProgress: (p) => onProgress?.(p.percentage / 100),
    });
    return { public: true, item: await postEntry({ ...meta, url: res.url }) };
  }
  const item = { ...meta, id: localId(), created: new Date().toISOString(), local: true, blob };
  await idb('put', item);
  return { public: false, item };
}

// A live Club set saved as replayable state + timeline (no audio upload).
export async function publishReplay({ timeline, title, artist, room }) {
  const cfg = await jukeboxConfig();
  if (cfg.enabled) {
    await ensureDevice().catch(() => null);
    return { public: true, item: await postEntry({ kind: 'set', title, artist, room, timeline }) };
  }
  const duration = Math.round(timeline.duration / 100) / 10;
  const item = { id: localId(), kind: 'set', replay: true, title, artist, room, style: timeline.style, bpm: timeline.initial.bpm, duration, start: 0, end: duration, created: new Date().toISOString(), local: true, timeline };
  await idb('put', item);
  return { public: false, item };
}

export async function loadReplay(item) {
  if (item.timeline) return item.timeline;
  const res = await fetch(`/api/jukebox?id=${encodeURIComponent(item.id)}`);
  if (!res.ok) throw new Error('set_missing');
  return (await res.json()).timeline;
}

export async function listReplays() {
  const [cfg, local] = await Promise.all([jukeboxConfig(), idb('all').catch(() => [])]);
  return [...local, ...cfg.items].filter((x) => x.replay).sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

async function trimmedWav(blob, start, end) {
  const buf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await blob.arrayBuffer());
  const a = Math.floor(start * buf.sampleRate), b = Math.min(buf.length, Math.floor(end * buf.sampleRate));
  const ch = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i).slice(a, b));
  if (ch.length === 1) ch.push(ch[0]);
  return encodeWav(ch, buf.sampleRate);
}

// MediaRecorder WebM has no duration until the browser scans it; seeking far forces that scan.
async function seekReady(audio) {
  if (audio.readyState < 1) await new Promise((r) => audio.addEventListener('loadedmetadata', r, { once: true }));
  if (Number.isFinite(audio.duration)) return;
  await new Promise((resolve) => {
    const done = () => { audio.removeEventListener('durationchange', on); resolve(); };
    const on = () => { if (Number.isFinite(audio.duration)) done(); };
    audio.addEventListener('durationchange', on);
    audio.currentTime = 1e7;
    setTimeout(done, 4000);
  });
}

export function drawPeaks(canvas, peaks, start, end, duration, head = -1) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, n = Math.max(1, peaks.length), bw = W / n;
  const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#c6ff00';
  g.clearRect(0, 0, W, H);
  peaks.forEach((p, i) => {
    const t = (i / n) * duration, inside = t >= start && t <= end, bh = Math.max(2, Math.min(1, p * 1.4) * H * 0.92);
    g.fillStyle = !inside ? '#34343c' : head >= 0 && t <= head ? '#ffffff' : accent;
    g.fillRect(i * bw, (H - bh) / 2, Math.max(1, bw - 1), bh);
  });
}

export function sheet(titleText, { beforeClose, onClose } = {}) {
  const ov = h('div', { class: 'overlay', onclick: (e) => e.target === ov && close() });
  const body = h('div', { class: 'pub-body set-body' });
  const onKey = (e) => { if (e.key === 'Escape') close(); e.stopPropagation(); };
  function close(force = false) {
    if (!force && beforeClose && !beforeClose()) return;
    ov.remove(); window.removeEventListener('keydown', onKey, true); onClose?.();
  }
  ov.append(h('div', { class: 'modal panel pub set-modal' },
    h('div', { class: 'pub-head' }, h('div', { class: 'mtitle' }, titleText), h('button', { class: 'btn ghost', onclick: () => close() }, 'CLOSE')), body));
  document.body.append(ov);
  window.addEventListener('keydown', onKey, true);
  return { body, close };
}

const field = (label, input) => h('label', { class: 'club-field set-field' }, h('span', {}, label), input);
const publicNote = (pub) => (pub ? 'Live in the UNTERGRUND jukebox. Anyone can play it.' : 'Saved to the jukebox in this browser. It goes public once storage is connected.');

export function openSetCutter({ take, defaults, toast, download, soundcloud }) {
  const { blob, duration, peaks } = take;
  let start = 0, end = duration, kept = false;
  const url = URL.createObjectURL(blob), audio = new Audio(url);
  audio.preload = 'auto';
  const { body, close } = sheet('CUT YOUR SET', {
    beforeClose: () => kept || confirm('Discard this recording?'),
    onClose: () => { audio.pause(); URL.revokeObjectURL(url); },
  });
  const canvas = h('canvas', { class: 'set-wave', width: 1000, height: 120 });
  const label = h('div', { class: 'set-range-label' });
  const range = (value) => h('input', { type: 'range', class: 'set-range', min: 0, max: duration.toFixed(1), step: 0.1, value: value.toFixed(1) });
  const inRange = range(0), outRange = range(duration);
  const redraw = () => {
    drawPeaks(canvas, peaks, start, end, duration, audio.paused ? -1 : audio.currentTime);
    label.textContent = `IN ${fmtTime(start)}   OUT ${fmtTime(end)}   LENGTH ${fmtTime(end - start)}`;
  };
  inRange.oninput = () => { start = Math.min(+inRange.value, end - 1); inRange.value = start; redraw(); };
  outRange.oninput = () => { end = Math.max(+outRange.value, start + 1); outRange.value = end; redraw(); };
  const previewBtn = h('button', { class: 'btn' }, 'PLAY FROM IN');
  const endingBtn = h('button', { class: 'btn ghost' }, 'HEAR THE OUT');
  const listen = async (from, btn) => {
    if (!audio.paused) { audio.pause(); previewBtn.textContent = 'PLAY FROM IN'; return redraw(); }
    await seekReady(audio);
    audio.currentTime = from;
    await audio.play();
    btn.textContent = btn === previewBtn ? 'PAUSE' : btn.textContent;
  };
  previewBtn.onclick = () => listen(start, previewBtn);
  endingBtn.onclick = () => listen(Math.max(start, end - 8), endingBtn);
  audio.ontimeupdate = () => { if (audio.currentTime >= end) { audio.pause(); previewBtn.textContent = 'PLAY FROM IN'; } redraw(); };
  const title = h('input', { class: 'inp', maxlength: 80, value: defaults.title });
  const status = h('div', { class: 'pub-note set-status' });
  const name = () => title.value.trim() || defaults.title;
  const wavOk = () => end - start <= MAX_WAV_SECONDS;
  const buttons = [];
  const action = (text, cls, fn) => { const b = h('button', { class: `btn ${cls}`, onclick: async () => {
    buttons.forEach((x) => { x.disabled = true; });
    try { await fn(); } catch (err) { console.error(err); status.textContent = 'Failed: ' + err.message; }
    buttons.forEach((x) => { x.disabled = false; });
  } }, text); buttons.push(b); return b; };
  const pub = action('PUBLISH TO UNTERGRUND', 'accent', async () => {
    status.textContent = 'Publishing…';
    const r = await publishSet({ ...defaults, blob, title: name(), duration, start, end, peaks, onProgress: (p) => { status.textContent = `Uploading your set… ${Math.round(p * 100)}%`; } });
    kept = true; status.textContent = publicNote(r.public); pub.textContent = 'PUBLISHED';
    trackEvent('publish', { kind: 'set', public: r.public });
    toast(`“${name()}” is in the jukebox`);
  });
  const sc = action('ALSO ON SOUNDCLOUD', 'sc', async () => {
    if (!wavOk()) return void (status.textContent = `SoundCloud upload works for cuts up to ${MAX_WAV_SECONDS / 60} minutes. Trim it, or publish it to UNTERGRUND.`);
    status.textContent = 'Cutting the audio…';
    const wav = await trimmedWav(blob, start, end);
    status.textContent = ''; kept = true; soundcloud(wav, name());
  });
  const dl = action('DOWNLOAD', 'ghost', async () => {
    const slug = name().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (wavOk()) { status.textContent = 'Cutting the audio…'; download(await trimmedWav(blob, start, end), `${slug}.wav`); status.textContent = 'Downloaded the cut as a 24-bit WAV.'; }
    else { download(blob, `${slug}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`); status.textContent = 'Long set: downloaded the full uncut recording.'; }
    kept = true;
  });
  body.append(h('div', { class: 'set-cut' },
    h('div', { class: 'set-stats' }, h('b', {}, fmtTime(duration)), ' recorded. Drag IN and OUT to cut it.'),
    canvas,
    h('div', { class: 'set-ranges' }, field('IN', inRange), field('OUT', outRange)),
    label,
    h('div', { class: 'set-preview' }, previewBtn, endingBtn),
    field('TITLE', title),
    h('div', { class: 'set-actions' }, pub, sc, dl),
    status));
  redraw();
  return { close };
}

function trackLink(id, toast) {
  const url = `${location.origin}/t/${id}`;
  return h('div', { class: 'set-link' }, h('span', {}, 'Its own page:'), h('a', { href: url, target: '_blank', rel: 'noopener' }, url.replace(/^https?:\/\/(www\.)?/, '')),
    h('button', { class: 'btn ghost', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); } } }, 'COPY LINK'));
}

export function openSongPublish({ state, style, title, artist, toast, soundcloud, jukebox, share }) {
  const { body, close } = sheet('PUBLISH');
  const input = h('input', { class: 'inp', maxlength: 80, value: title });
  const status = h('div', { class: 'pub-note set-status' });
  const pub = h('button', { class: 'btn accent', onclick: async () => {
    pub.disabled = true; status.textContent = 'Publishing…';
    try {
      const name = input.value.trim() || title;
      const r = await publishSong({ state, title: name, style, artist });
      status.textContent = publicNote(r.public); pub.textContent = 'PUBLISHED';
      trackEvent('publish', { kind: 'song', public: r.public });
      if (r.public && r.item?.trackId) status.after(trackLink(r.item.trackId, toast));
      toast(`“${name}” is in the jukebox`);
      if (share) {
        const song = { state, title: name, style, artist, remixOf: state.remixOf, trackId: r.public ? r.item.trackId : '' };
        pub.replaceWith(h('button', { class: 'btn accent', onclick: () => { close(true); share(song); } }, 'SHARE IT'));
      }
    } catch (err) { status.textContent = 'Failed: ' + err.message; pub.disabled = false; }
  } }, 'PUBLISH TO UNTERGRUND');
  const credit = creditLine(state.remixOf);
  body.append(h('div', { class: 'set-cut' },
    h('div', { class: 'set-stats' }, `${STYLES[style]?.name || 'UNTERGRUND'} · ${state.bpm} BPM. Listeners hear it played live by UNTERGRUND in their browser.`),
    credit && h('div', { class: 'pub-note remix-credit' }, credit),
    field('TITLE', input),
    h('div', { class: 'set-actions' }, pub,
      h('button', { class: 'btn sc', onclick: () => { close(true); soundcloud(input.value.trim() || title); } }, 'ALSO ON SOUNDCLOUD'),
      h('button', { class: 'btn ghost', onclick: () => { close(true); jukebox(); } }, 'OPEN JUKEBOX')),
    status));
  input.focus();
}

export function openJukebox({ playSong, playReplay, stopSong, toast, onCreate, onClose, onRemix, onShare }) {
  const audio = new Audio();
  let items = [], queue = [], idx = -1, timer = null, filter = 'all', urls = [];
  const stopAll = () => { audio.pause(); clearTimeout(timer); stopSong(); idx = -1; };
  const jb = sheet('JUKEBOX', { onClose: () => { stopAll(); urls.forEach((u) => URL.revokeObjectURL(u)); onClose?.(); } });
  const { body } = jb;
  const now = h('div', { class: 'jb-now' }, 'Every song and set here was made inside UNTERGRUND.');
  const note = h('div', { class: 'pub-note' }, 'Loading…');
  const list = h('div', { class: 'jb-list' });
  const tabs = h('div', { class: 'jb-tabs' });
  const visible = () => items.filter((x) => filter === 'all' || x.kind === filter);
  const day = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const drops = recentDrops().map((d, i) => ({ id: `drop-${d.date}`, kind: 'drop', drop: d.date, today: !i, title: d.title, artist: 'UNTERGRUND', style: d.style, created: `${d.date}T00:00:00.000Z` }));
  async function playAt(i) {
    stopAll();
    const it = queue[i];
    if (!it) { now.textContent = 'That was the whole jukebox.'; return renderList(); }
    idx = i;
    now.textContent = `NOW PLAYING · ${it.title} · ${it.artist}`;
    renderList();
    try {
      if (it.replay) {
        const secs = await playReplay(it);
        timer = setTimeout(() => playAt(idx + 1), Math.max(1, secs) * 1000);
        now.textContent = `NOW PLAYING · ${it.title} · ${it.artist} live${it.room ? ` in ${it.room}` : ''}`;
      } else if (it.kind === 'set') {
        const src = it.url || URL.createObjectURL(it.blob);
        if (!it.url) urls.push(src);
        audio.src = src;
        await seekReady(audio);
        audio.currentTime = it.start || 0;
        await audio.play();
      } else {
        const secs = await playSong(it);
        timer = setTimeout(() => playAt(idx + 1), Math.max(10, secs) * 1000);
        const credit = creditLine(it.remixOf);
        now.replaceChildren(h('span', { class: 'jb-now-text' }, `NOW PLAYING · ${it.title} · ${it.artist}`, credit && h('small', {}, credit)),
          onRemix && h('span', { class: 'jb-now-actions' },
            h('button', { class: 'btn accent', onclick: () => { jb.close(); onRemix(it); } }, 'REMIX IT'),
            onShare && h('button', { class: 'btn ghost', onclick: () => onShare(it) }, 'SHARE')));
      }
    } catch (err) {
      console.error(err); toast(`Couldn't play “${it.title}”`);
      timer = setTimeout(() => playAt(idx + 1), 800);
    }
  }
  audio.ontimeupdate = () => { const it = queue[idx]; if (it?.kind === 'set' && !audio.paused && audio.currentTime >= (it.end || Infinity)) playAt(idx + 1); };
  audio.onended = () => playAt(idx + 1);
  function renderTabs() {
    tabs.innerHTML = '';
    for (const [id, text] of [['all', 'ALL'], ['song', 'SONGS'], ['drop', 'DROPS'], ['set', 'SETS']]) {
      tabs.append(h('button', { class: 'family-tab' + (filter === id ? ' on' : ''), onclick: () => { filter = id; renderTabs(); renderList(); } }, text));
    }
    tabs.append(h('button', { class: 'btn accent jb-all', onclick: () => { queue = visible(); playAt(0); } }, 'PLAY ALL'),
      h('button', { class: 'btn ghost', onclick: async () => { await navigator.clipboard?.writeText(`${location.origin}/?jukebox`); trackEvent('share_link_copied', { what: 'jukebox' }); toast('Jukebox link copied'); } }, 'COPY LINK'));
  }
  function renderList() {
    list.innerHTML = '';
    const v = visible();
    if (!v.length) list.append(h('div', { class: 'jb-empty' },
      h('p', {}, filter === 'set' ? 'No sets yet. GO LIVE in the Club and your set lands here, or hit REC any time.' : 'Nothing here yet. Make a track, then tap PUBLISH to add it.'),
      onCreate && h('button', { class: 'btn accent', onclick: () => { jb.close?.(); onCreate(); } }, 'MAKE A TRACK')));
    for (const it of v) {
      const on = queue[idx]?.id === it.id;
      const len = it.kind === 'set' ? ` · ${fmtTime((it.end || it.duration) - (it.start || 0))}` : '';
      list.append(h('button', { class: 'jb-item' + (on ? ' on' : ''), onclick: () => { if (on) { stopAll(); now.textContent = 'Stopped.'; return renderList(); } queue = v; playAt(v.indexOf(it)); } },
        h('span', { class: `jb-kind ${it.kind}` }, it.kind.toUpperCase()),
        h('span', { class: 'jb-text' }, h('b', {}, it.title), it.kind === 'drop' ? h('small', {}, `${it.today ? 'Today’s drop' : `Daily Drop · ${day(it.drop)}`} · ${STYLES[it.style]?.name || it.style}`) : h('small', {}, `${it.artist} · ${STYLES[it.style]?.name || it.style}${it.bpm ? ` · ${it.bpm} BPM` : ''}${it.room ? ` · ${it.room}` : ''}${len}${it.local ? ' · THIS BROWSER' : ''}`)),
        h('span', { class: 'jb-play' + (on ? ' on' : '') })));
    }
  }
  body.append(h('div', { class: 'jb' }, now, tabs, note, list));
  renderTabs();
  Promise.all([jukeboxConfig(), idb('all').catch(() => [])]).then(([cfg, local]) => {
    items = [drops[0], ...[...local, ...cfg.items, ...drops.slice(1)].sort((a, b) => String(b.created).localeCompare(String(a.created)))];
    note.textContent = cfg.enabled ? '' : 'Public storage isn\'t connected yet, so this shows what was published from this browser.';
    renderList();
  });
}
