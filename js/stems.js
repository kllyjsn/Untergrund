// EXPORT STEMS: the whole arrangement rendered offline as one aligned WAV per instrument plus an FX/returns
// stem, zipped. Every voice plays in every render (so ducking, round-robins and sends behave exactly as in
// the mix); only the point where each sound joins the mix bus is re-routed to its own output channels.
// The stems sum to the mix bus *before* master processing (DJ filter, breakdown filter, glue compressor,
// saturation, warmth, volume, limiter and clipper), so they leave the master chain to the producer's DAW.
import { Engine } from './engine.js';
import { renderBars } from './render.js';
import { encodeWav } from './dsp.js';
import { KEYS, TRACK_IDS } from './params.js';
import { loadPiece } from './repertoire.js';
import { capture, songBars, parseKeyName, PARTS } from './midi.js';
import { PIECE } from './repertoire.js';
import { ZipWriter } from './zip.js';
import { vocalStem, VOCAL_DUCK_DB } from './sing.js';

export const STEM_NAMES = {
  kick: 'kick', clap: 'clap', snare: 'snare', ch: 'hats', oh: 'open-hat', ride: 'ride', perc: 'perc',
  acid: 'bass', stab: 'chords', hook: 'hook', vox: 'vocals', sung: 'sung-vocal', fx: 'fx-returns',
  ...Object.fromEntries(Object.entries(PARTS).map(([id, [name]]) => [id, name.toLowerCase().replace(/\s+/g, '-')])),
};
const BUDGET = 256 * 1024 * 1024;

const slug = (s) => String(s || 'untergrund').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untergrund';
export function songKey(state) {
  const score = state.patterns.find((p) => p.score)?.score;
  if (score?.piece) { const k = parseKeyName(PIECE[score.piece]?.key); if (k) return KEYS[k.pc] + (k.minor ? 'm' : ''); }
  const minor = score ? score.mode === 'm' : state.scale !== 'major';
  return KEYS[((state.key % 12) + 12) % 12] + (minor ? 'm' : '');
}
export const exportName = (state, suffix) => `${slug(state.artist?.title)}-${Math.round(state.bpm)}bpm-${songKey(state)}${suffix}`;

// The stems this song actually plays, in mixer order: the instruments with notes, then FX/returns.
export function stemList(state, loopBars = 16) {
  const c = capture(state, loopBars), ids = c.score ? Object.keys(PARTS) : [...TRACK_IDS.slice(0, TRACK_IDS.indexOf('stab') + 1), 'hook', ...TRACK_IDS.slice(TRACK_IDS.indexOf('stab') + 1)];
  return [...ids.filter((id) => c.notes[id]?.length), ...(vocalStem(state) ? ['sung'] : []), 'fx'];
}

// Re-routes everything that would reach engine.mix / engine.duck / engine.preMaster into per-stem sums on its own channel pair.
// prebus: no stems, just the mix bus straight out (the reference the stems sum to).
export function router(want, { prebus = false } = {}) {
  const proto = AudioNode.prototype, orig = proto.connect;
  let ctx = null, E = null, part = null;
  const conns = [], sums = {}, clones = {}, owner = new Map();
  const restore = () => { if (proto.connect !== orig) proto.connect = orig; };
  const route = (src, dst) => {
    if (src === E.duck) return dst;
    const stem = part || owner.get(src) || 'fx', sum = sums[stem];
    if (!sum) return dst;
    let target = sum;
    if (dst === E.duck) {
      // Sidechain ducking happens on the shared duck bus; each ducked stem gets its own copy of it.
      if (!clones[stem]) { clones[stem] = ctx.createGain(); orig.call(clones[stem], sum); }
      target = clones[stem];
    }
    orig.call(src, target);
    return dst;
  };
  return {
    restore,
    onContext(c) {
      ctx = c;
      proto.connect = function (dst, ...a) {
        if (this.context === ctx) {
          if (E && !prebus && (dst === E.mix || dst === E.duck || dst === E.preMaster)) return route(this, dst);
          if (!E) conns.push([this, dst]);
        }
        return orig.call(this, dst, ...a);
      };
    },
    onEngine(engine) {
      E = engine;
      E.mix.disconnect();
      if (prebus) { orig.call(E.mix, ctx.destination); E.vocalBus.disconnect(); orig.call(E.vocalBus, ctx.destination); restore(); return; }
      const dest = ctx.destination, merge = ctx.createChannelMerger(want.length * 2);
      dest.channelCount = want.length * 2; dest.channelCountMode = 'explicit'; dest.channelInterpretation = 'discrete';
      orig.call(merge, dest);
      want.forEach((id, k) => {
        const sum = ctx.createGain(), split = ctx.createChannelSplitter(2);
        sum.channelCount = 2; sum.channelCountMode = 'explicit';
        orig.call(sum, split); orig.call(split, merge, 0, 2 * k); orig.call(split, merge, 1, 2 * k + 1);
        sums[id] = sum;
      });
      for (const id of TRACK_IDS) owner.set(E.ch[id].pan, id);
      owner.set(E.vocalBus, 'sung');
      for (const [src, dst] of conns) if (dst === E.mix || dst === E.duck || dst === E.preMaster) { src.disconnect(dst); route(src, dst); }
      // The hook plays through a copy of the CHORDS channel (same level, pan and sends) so it gets its own stem.
      const S = E.ch.stab, g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
      const hc = { input: g(), level: g(S.level.gain.value), pan: ctx.createStereoPanner(), rev: g(S.rev.gain.value), dly: g(S.dly.gain.value), band: g() };
      hc.pan.pan.value = S.pan.pan.value;
      owner.set(hc.pan, 'hook');
      // Its own copy of the CHORDS channel strip EQ too, kept in step with the band mix (see Engine.applyStrips).
      hc.strip = (S.strip || []).map((f) => { const n = ctx.createBiquadFilter(); n.type = f.type; return n; });
      const syncStrip = () => hc.strip.forEach((n, k) => { for (const p of ['frequency', 'Q', 'gain']) n[p].value = S.strip[k][p].value; });
      [hc.input, ...hc.strip].reduce((a, n) => a.connect(n)).connect(hc.level).connect(hc.pan);
      hc.pan.connect(E.duck); hc.pan.connect(hc.rev).connect(E.revIn); hc.pan.connect(E.roomIn); hc.pan.connect(hc.dly).connect(E.dlyIn); hc.pan.connect(E.throwBus);
      hc.band.connect(hc.input); hc.band.connect(E.bandIn);
      const P = Engine.prototype;
      E.hook = function (...a) { const s = this.ch.stab; syncStrip(); this.ch.stab = hc; try { return P.hook.apply(this, a); } finally { this.ch.stab = s; } };
      E.orchBus = function (p) {
        if (this.orchBuses?.[p]) return this.orchBuses[p];
        part = p;
        try { return P.orchBus.call(this, p); } finally { part = null; }
      };
      E.duckAt = function (...a) {
        P.duckAt.apply(this, a);
        const d = this.duck;
        try { for (const c of Object.values(clones)) { this.duck = c; P.duckAt.apply(this, a); } } finally { this.duck = d; }
      };
    },
  };
}

// Suspends the offline render every so often to report progress and honour cancel.
function progressHooks(ctx, onTick, signal, steps = 40) {
  const frames = ctx.length, done = new Set();
  for (let i = 1; i < steps; i++) {
    const f = Math.floor((frames * i) / steps / 128) * 128;
    if (f <= 0 || f >= frames || done.has(f)) continue;
    done.add(f);
    ctx.suspend(f / ctx.sampleRate).then(() => {
      if (signal?.aborted) return;
      onTick?.(f / frames);
      ctx.resume();
    });
  }
}

const abortError = () => Object.assign(new Error('Export cancelled'), { name: 'AbortError' });
function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((res, rej) => {
    if (signal.aborted) return rej(abortError());
    signal.addEventListener('abort', () => rej(abortError()), { once: true });
    promise.then(res, rej);
  });
}

async function renderWith(state, bars, r, channels, { onProgress, signal } = {}) {
  try {
    return await abortable(renderBars(state, bars, {
      channels,
      onContext: r.onContext, onEngine: r.onEngine,
      onScheduled: (ctx) => { r.restore(); progressHooks(ctx, onProgress, signal); },
    }), signal);
  } finally { r.restore(); }
}

// The mix bus with no master processing: what the stems add up to.
export async function renderPreBus(state, bars) { return renderWith(state, bars, router([], { prebus: true }), 2); }

// Renders the stems in as few passes as memory allows. Returns { stems: [{ id, name, left, right }], sampleRate, length }.
export async function renderStems(state, { loopBars = 16, bars: only, onProgress, signal } = {}) {
  const s = JSON.parse(JSON.stringify(state));
  s.solos = {};
  const score = s.patterns.find((p) => p.score)?.score;
  if (score?.piece) await loadPiece(score.piece);
  const bars = only || songBars(s, loopBars), ids = stemList(s, loopBars);
  // Estimate the render length from a stereo pass's size: bars * 16 steps at the base tempo, plus the tail.
  const frames = Math.ceil(((bars * 16 * 60) / s.bpm / 4 + 5) * 48000) * (score ? 1.4 : 1);
  const perPass = Math.max(1, Math.min(16, Math.floor(BUDGET / (frames * 4 * 2))));
  const batches = [];
  for (let i = 0; i < ids.length; i += perPass) batches.push(ids.slice(i, i + perPass));
  const stems = [];
  let sampleRate = 48000, length = 0;
  for (const [b, want] of batches.entries()) {
    const buf = await renderWith(s, bars, router(want), want.length * 2, { signal, onProgress: (p) => onProgress?.((b + p) / batches.length, want) });
    sampleRate = buf.sampleRate; length = buf.length;
    want.forEach((id, k) => stems.push({ id, name: STEM_NAMES[id] || id, left: buf.getChannelData(2 * k), right: buf.getChannelData(2 * k + 1) }));
    onProgress?.((b + 1) / batches.length, want);
  }
  return { stems, sampleRate, length, bars };
}

const readme = (state, r) => `${state.artist?.title || 'UNTERGRUND'} — stems
Made in UNTERGRUND (https://www.untergrund.sh)

${Math.round(state.bpm)} BPM · key ${songKey(state)} · ${r.bars} bars · ${r.sampleRate / 1000} kHz / 24-bit WAV

Every stem starts at the same sample and has the same length: drop them all at bar 1 and they line up.
Played together they equal the mix bus BEFORE the master chain, so the DJ filter, breakdown filter sweeps,
glue compressor, saturation, warmth, master volume, limiter and clipper are not printed. Add your own.
Each instrument stem is dry plus its own channel processing; reverb, delay, room, kick rumble and
arrangement FX (risers, impacts, vinyl dust) are in the fx-returns stem. Recorded live-kit pieces are
in the stem of the drum they play (kick.wav holds the recorded kick when the live kit is on).
Notes come in a separate EXPORT MIDI file from the same FILE menu.
${r.stems.some((x) => x.id === 'sung') ? `The other stems are printed without the ${VOCAL_DUCK_DB.toFixed(1)} dB dip the band takes while the sung vocal sings: duck them under sung-vocal.wav to rebuild the mix.\n` : ''}${r.sungDb ? `sung-vocal.wav is printed ${(-r.sungDb).toFixed(1)} dB under its mix level so it does not clip: raise it ${(-r.sungDb).toFixed(1)} dB to rebuild the mix.\n` : ''}
${r.stems.map((x, i) => `${String(i + 1).padStart(2, '0')}-${x.name}.wav`).join('\n')}
`;

// The finished .zip: one WAV per stem plus a README.
export async function stemsZip(state, opts = {}) {
  const r = await renderStems(state, opts);
  const sung = r.stems.find((x) => x.id === 'sung');
  if (sung) {
    let peak = 0;
    for (const c of [sung.left, sung.right]) for (const v of c) peak = Math.max(peak, Math.abs(v));
    // The singer's stem peaks far above its RMS; at mix level it would clip in a fixed-point WAV.
    if (peak > 0.99) {
      const g = 0.99 / peak;
      for (const c of [sung.left, sung.right]) for (let i = 0; i < c.length; i++) c[i] *= g;
      r.sungDb = 20 * Math.log10(g);
    }
  }
  const zip = new ZipWriter(), dir = exportName(state, '-stems');
  for (const [i, x] of r.stems.entries()) {
    if (opts.signal?.aborted) throw abortError();
    await zip.add(`${dir}/${String(i + 1).padStart(2, '0')}-${x.name}.wav`, encodeWav([x.left, x.right], r.sampleRate));
  }
  await zip.add(`${dir}/README.txt`, readme(state, r));
  return { blob: zip.blob(), name: `${dir}.zip`, stems: r.stems.length, bars: r.bars };
}
