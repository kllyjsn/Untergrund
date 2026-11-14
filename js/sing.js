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
// The vocal's channel strip per genre (js/vocal-chain.js, Engine.vocalSends; docs/singer.md#vocal-chain): high-pass Hz,
// presence [Hz, dB], de-esser (band from hz, at most db cut, past `over` dB re the sung level), compression (threshold
// re the sung level, ratio), reverb (a plate of `sec` seconds, or the band's room) and delay (beats, feedback) sends,
// and carve: the dB the CHORDS channel (keys, guitars) dips at hz while the vocal sings.
export const VOCAL_FX = {
  pop: { hp: 110, presence: [3800, 2.5], deess: { hz: 6500, db: 8, over: -10 }, comp: { thr: -6, ratio: 2.5 },
    reverb: { kind: 'plate', sec: 1.6, send: 0.14 }, delay: { beats: 0.5, fb: 0.22, send: 0.1 }, carve: { hz: 3000, db: 3 } },
  rnb: { hp: 90, presence: [3200, 2], deess: { hz: 6000, db: 8, over: -11 }, comp: { thr: -7, ratio: 2.5 },
    reverb: { kind: 'plate', sec: 2.4, send: 0.2 }, delay: { beats: 0.75, fb: 0.3, send: 0.12 }, carve: { hz: 2800, db: 3 } },
  folk: { hp: 85, presence: [3000, 1.5], deess: { hz: 6500, db: 6, over: -9 }, comp: { thr: -5, ratio: 2 },
    reverb: { kind: 'room', send: 0.35 }, delay: { beats: 0.25, fb: 0.08, send: 0.09 }, carve: { hz: 3000, db: 2.5 } },
};
export const vocalFx = (state) => VOCAL_FX[state?.artist?.style] || VOCAL_FX.pop;
const STEM_HOSTS = /\.public\.blob\.vercel-storage\.com$/;
const stems = new Map();
let probe = null, memo = { sig: null, key: null };

export const singAvailable = () => (probe ??= fetch('/api/sing').then((r) => (r.ok ? r.json() : {})).then((j) => j.enabled === true).catch(() => false));
export const audioFormat = () => (typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs=opus') ? 'opus' : 'wav');
const keyOf = (req) => (req ? JSON.stringify([req.score, req.voice, req.seed, req.expr || null]) : null);
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
  return buf ? { buf, gain: 10 ** (vocalDb(state) / 20), duck: 10 ** (-VOCAL_DUCK_DB / 20), lift: 10 ** (-VOCAL_LIFT_DB / 20), ms: state.sing.ms || 0, fx: vocalFx(state) } : null;
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
