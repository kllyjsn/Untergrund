// SING: the current song's vocal stem from the self-hosted neural singer (/api/sing, docs/singer.md), played as a vocal
// track by Engine.vocal() live, in renders and in exports. Off (and invisible) unless the server has a singer configured.
// Stems live in memory only, keyed by the score they sing: change the melody, lyrics, tempo or voice and the old one stops.
import { singScore } from './sing-score.js';

// While it sings, the vocal sits VOCAL_OVER_BAND_DB over the band and the band dips VOCAL_DUCK_DB under it, so band plus
// vocal carry the band's own power: the sung mix lands on the style's loudness target with no extra limiting.
export const VOCAL_OVER_BAND_DB = 1;
export const VOCAL_DUCK_DB = 10 * Math.log10(1 + 10 ** (VOCAL_OVER_BAND_DB / 10));
// The limiter eases off the ducked band, so the sung parts still came out about 1.2 dB louder after it (seed-7 pop, R&B
// and folk): the master output dips that much while the vocal sings (Engine.singTrim, after the limiter and clipper).
export const VOCAL_LIFT_DB = 1.2;
// The stem arrives at -20 dBFS RMS on its sung notes (singer/singer.py). These lift it to VOCAL_OVER_BAND_DB over the
// ducked band per style (measured through the master chain on the seed-7 songs in docs/singer.md); others get the base.
export const VOCAL_BASE_DB = 10;
export const VOCAL_STYLE_DB = { pop: 13.7, rnb: 8.5, folk: 4.5 };
export const vocalDb = (state) => (VOCAL_STYLE_DB[state?.artist?.style] ?? VOCAL_BASE_DB) + (state?.sing?.db || 0);
const STEM_HOSTS = /\.public\.blob\.vercel-storage\.com$/;
const stems = new Map();
let probe = null, memo = { sig: null, key: null };

export const singAvailable = () => (probe ??= fetch('/api/sing').then((r) => (r.ok ? r.json() : {})).then((j) => j.enabled === true).catch(() => false));
export const audioFormat = () => (typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs=opus') ? 'opus' : 'wav');
const keyOf = (req) => (req ? JSON.stringify([req.score, req.voice, req.seed]) : null);
const sigOf = (s) => JSON.stringify([s.chain, s.chainOn, s.bpm, s.key, s.scale, s.swing, s.lyrics, s.patterns, s.master?.arr, s.ending, s.artist?.style, s.sing?.voice]);
export const singRequest = (state, format = audioFormat()) => singScore(state, { voice: state.sing?.voice, format });
export function stemKey(state) {
  const sig = sigOf(state);
  if (memo.sig !== sig) memo = { sig, key: keyOf(singRequest(state, 'wav')) };
  return memo.key;
}
export const hasStem = (state) => stems.has(stemKey(state));

// What Engine.vocal() plays for this state, or null.
export function vocalStem(state) {
  if (!state?.sing?.on || !stems.size) return null;
  const buf = stems.get(stemKey(state));
  return buf ? { buf, gain: 10 ** (vocalDb(state) / 20), duck: 10 ** (-VOCAL_DUCK_DB / 20), lift: 10 ** (-VOCAL_LIFT_DB / 20), ms: state.sing.ms || 0 } : null;
}

const wait = (ms, signal) => new Promise((ok, no) => { const t = setTimeout(ok, ms); signal?.addEventListener('abort', () => { clearTimeout(t); no(new DOMException('cancelled', 'AbortError')); }); });

// Sings the song (or finds it in the cache): resolves to the decoded stem. onWait(seconds) while the singer works.
export async function singSong(state, { onWait, signal, poll = 4000, limit = 10 * 60e3 } = {}) {
  const req = singRequest(state);
  if (!req) throw new Error('Nothing to sing yet: the song needs lyrics and a melody');
  const key = keyOf(req);
  if (stems.has(key)) return stems.get(key);
  const post = (body) => fetch('/api/sing', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t0 = Date.now();
  let res = await post(req);
  while (res.status === 202) {
    const { job, hash } = await res.json();
    if (Date.now() - t0 > limit) throw new Error('The singer took too long. Try again');
    onWait?.(Math.round((Date.now() - t0) / 1000));
    await wait(poll, signal);
    res = await post({ job, hash });
  }
  if (!res.ok) throw new Error(res.status === 429 ? 'The singer is busy. Try again in a few minutes' : 'The singer is unavailable right now');
  let bytes;
  if ((res.headers.get('content-type') || '').startsWith('application/json')) {
    const { url } = await res.json();
    if (!url || !STEM_HOSTS.test(new URL(url).hostname)) throw new Error('The singer sent an unexpected answer');
    bytes = await (await fetch(url, { signal })).arrayBuffer();
  } else bytes = await res.arrayBuffer();
  const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes);
  stems.set(key, buf);
  while (stems.size > 4) stems.delete(stems.keys().next().value);
  return buf;
}
