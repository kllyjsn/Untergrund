// Listen signals: one record per thing a listener does with a song (start, finish, skip, replay, keep, publish,
// share, go live, love), each with the context needed to learn from it later. Contract: docs/listen-signals.md.
// Pure: the caller supplies emit(kind, record) and the song context; js/analytics.js sends it.
export const LISTEN_VERSION = 1;
export const SKIP_MS = 30_000, COMPLETE_PCT = 90, AFTER_MS = 10 * 60_000;
export const LISTEN_KINDS = ['start', 'complete', 'skip', 'partial', 'replay', 'keep', 'publish', 'share', 'live', 'love', 'unlove'];
const ONCE = new Set(['keep', 'publish', 'share', 'live']);
const HEARD = 'untergrund.heard', LOVED = 'untergrund.loved', HEARD_MAX = 200, LOVED_MAX = 300;

// FNV-1a 32-bit, base36: a short stable id for a prompt; two passes (64 bits) for a song.
export function fnv(str, basis = 0x811c9dc5) {
  let x = basis;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); }
  return (x >>> 0).toString(36);
}
// Same notes, sounds, arrangement and tempo -> same fingerprint; any edit makes a new version. Titles and names don't count.
export function songFingerprint(s) {
  if (!s) return '';
  const json = JSON.stringify([s.patterns, s.chainOn ? s.chain : '', !!s.chainOn, s.bpm, s.key, s.scale, s.params, s.master, s.ending ?? null, s.lyrics ?? null]);
  return fnv(json).padStart(7, '0') + fnv(json, 0x01000193).padStart(7, '0');
}
const normPrompt = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const promptHash = (t) => (normPrompt(t) ? fnv(normPrompt(t)) : '');
// The prompt text rides on `start` only, and never when it looks like contact details.
export function promptText(t) {
  const s = String(t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return /@|https?:|www\.|\d[\d\s().-]{6,}\d/i.test(s) ? '' : s;
}

const list = (store, key) => { try { const v = JSON.parse(store?.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const keep = (store, key, arr, max) => { try { store?.setItem(key, JSON.stringify(arr.slice(-max))); } catch {} };
const rid = () => Array.from({ length: 10 }, () => ((Math.random() * 36) | 0).toString(36)).join('');

// ctx (per listen): { fp, tid, seed, style, src, surf, ph, pt }; pos (per signal): { bar, bars, sec }.
export function createListens({ emit = () => {}, now = () => Date.now(), store = globalThis.localStorage } = {}) {
  let cur = null, last = null;
  const heard = new Set(list(store, HEARD)), loved = new Set(list(store, LOVED));
  const played = (l) => l.ms + (l.since != null ? now() - l.since : 0);
  const pctOf = (pos) => (pos?.bars > 0 ? Math.max(0, Math.min(100, Math.round((100 * pos.bar) / pos.bars))) : -1);

  function send(kind, l, pos = l.pos, extra = {}) {
    if (pos) l.pos = pos;
    const p = l.pos || {};
    const rec = { v: LISTEN_VERSION, lis: l.id, fp: l.fp, tid: l.tid || '', seed: Number.isFinite(l.seed) ? l.seed : -1, style: l.style || '',
      src: l.src || '', surf: l.surf || '', ph: l.ph || '', bar: p.bar ?? 0, bars: p.bars ?? 0, sec: p.sec || '', pct: pctOf(p), ms: Math.round(played(l)), ...extra };
    emit(kind, rec);
    return rec;
  }

  function end(pos, { finished = false, force = false } = {}) {
    const l = cur;
    if (!l || (l.held && !force)) return null;
    if (l.since != null) { l.ms += now() - l.since; l.since = null; }
    if (pos && !l.held) l.pos = pos;
    const pct = pctOf(l.pos);
    const kind = finished || pct >= COMPLETE_PCT ? 'complete' : l.ms < SKIP_MS ? 'skip' : 'partial';
    const rec = send(kind, l, l.pos, finished ? { pct: 100 } : {});
    cur = null; last = { l, at: now() };
    return rec;
  }

  function begin(ctx, pos = { bar: 0, bars: 0, sec: '' }) {
    if (cur?.held && cur.fp === ctx.fp) { cur.held = false; cur.since = now(); return cur; }
    if (cur) end(cur.pos, { force: true });
    const l = cur = { ...ctx, id: rid(), ms: 0, since: now(), pos, done: new Set(), held: false };
    send('start', l, pos, ctx.pt ? { pt: ctx.pt } : {});
    if (heard.has(l.fp)) send('replay', l);
    heard.delete(l.fp); heard.add(l.fp); keep(store, HEARD, [...heard], HEARD_MAX);
    return l;
  }

  // Pause (lock screen, a call): the listen carries on if the same song resumes.
  function hold(pos) {
    if (!cur || cur.held) return;
    if (cur.since != null) { cur.ms += now() - cur.since; cur.since = null; }
    if (pos) cur.pos = pos;
    cur.held = true;
  }

  // An action on the song playing, or the one that just ended (publish after it finishes).
  function target() { return cur || (last && now() - last.at < AFTER_MS ? last.l : null); }
  function act(kind, pos) {
    const l = target();
    if (!l || !LISTEN_KINDS.includes(kind)) return null;
    if (ONCE.has(kind)) { if (l.done.has(kind)) return null; l.done.add(kind); }
    return send(kind, l, l === cur && !l.held ? pos : l.pos);
  }

  const isLoved = (fp) => !!fp && loved.has(fp);
  // The explicit reaction: love toggles on the song you hear (or just heard).
  function toggleLove(pos) {
    const l = target();
    if (!l) return null;
    const on = !loved.has(l.fp);
    if (on) loved.add(l.fp); else loved.delete(l.fp);
    keep(store, LOVED, [...loved], LOVED_MAX);
    send(on ? 'love' : 'unlove', l, l === cur && !l.held ? pos : l.pos);
    return on;
  }

  return { begin, end, hold, act, toggleLove, isLoved, current: () => cur, recent: target };
}
