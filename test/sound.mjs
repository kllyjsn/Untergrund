// Offline sound check: renders real songs through the engine in Node (test/offline-audio.mjs, dry mix)
// and measures where the energy sits per genre — club sub weight, kick/bass sidechain, low-mid mud,
// 2–5 kHz lead harshness — plus synth-vs-recorded voice levels and lead CPU cost.
import assert from 'node:assert/strict';
import { OfflineAudioContext, installGlobals } from './offline-audio.mjs';
installGlobals();
const { defaultState, generate, applyOverrides, arrangement } = await import('../js/state.js');
const { Engine, Sequencer } = await import('../js/engine.js');
const { loadBand, STAB_BAND } = await import('../js/livekit.js');
const { spectralBands, kWeight, lufs } = await import('../js/lab-metrics.js');
const { lowEnd } = await import('../js/lowend.js');

// 48 kHz like a real device: at 32 kHz bright resonant filters sit near Nyquist, where the shim blows up.
const SR = 48000, P = Engine.prototype, orig = {};
for (const k of ['stab', 'lick', 'hook', 'kick']) orig[k] = Object.getOwnPropertyDescriptor(P, k).value;

async function render(style, seed, { stem = 'full', bars = 4, voice = null, mute = null } = {}) {
  const s = defaultState(), g = generate(style, seed);
  applyOverrides(s, g); s.patterns = arrangement(g.pattern, seed); s.current = 6;
  if (voice != null) s.params.stab.voice = voice;
  const band = STAB_BAND[Math.round(s.params.stab.voice)];
  if (band) { await loadBand(band); if (band === 'piano') await loadBand('pianosoft'); }
  const kicks = [];
  P.stab = stem === 'hook' ? () => {} : orig.stab;
  P.lick = stem === 'hook' ? () => {} : orig.lick;
  P.hook = stem === 'chord' ? () => {} : orig.hook;
  P.kick = function (t, v) { kicks.push(t); return orig.kick.call(this, t, v); };
  const solo = { hook: 'stab', chord: 'stab', full: null }[stem] ?? stem;
  if (solo) s.solos[solo] = true;
  if (mute) s.mutes[mute] = true;
  const len = Math.ceil((0.05 + (bars * 16 * 60) / s.bpm / 4 + 0.5) * SR);
  const ctx = new OfflineAudioContext(1, len, SR), e = new Engine(ctx, s, { realtime: false }), q = new Sequencer(e, s);
  for (let i = 0, t = 0.05; i < bars * 16; i++) { q.tick(i, t); t += e.stepDur; }
  const data = (await ctx.startRendering(e.mix)).getChannelData(0);
  Object.assign(P, orig);
  return { data, kicks, engine: e, gen: g, ...spectralBands([data], SR) };
}
// Level of a part's loudest quarter of 50 ms windows: fair to short plucks and held pads alike.
function hitDb(d) {
  const w = SR / 20, e = [];
  for (let i = 0; i + w <= d.length; i += w) { let x = 0; for (let j = i; j < i + w; j++) x += d[j] * d[j]; e.push(x / w); }
  const top = e.sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(e.filter((x) => x > 1e-5).length / 4)));
  return 10 * Math.log10(top.reduce((a, b) => a + b, 0) / top.length + 1e-20);
}
const rmsDb = (d, a, b) => { let e = 0; for (let i = a; i < b; i++) e += d[i] * d[i]; return 10 * Math.log10(e / Math.max(1, b - a) + 1e-20); };

process.on('exit', () => console.table(rows));

// 1. Club low end: the bass carries real sub next to the kick, the kick ducks it, and the low mids stay clear.
const CLUB = { peak: 503, deephouse: 211, dnb: 211, trap: 211, amapiano: 211, reggaeton: 211 };
// 200–500 Hz share of the full mix on main before this pass (same shim, seeds, bars): the louder
// leads and chords must not buy their level with low-mid mud.
const MUD_MAIN = { peak: 0.061, deephouse: 0.032, dnb: 0.042, trap: 0.059, amapiano: 0.232, reggaeton: 0.042 };
const rows = [];
for (const [style, seed] of Object.entries(CLUB)) {
  const full = await render(style, seed), noBass = await render(style, seed, { mute: 'acid' });
  const bass = await render(style, seed, { stem: 'acid' }), kick = await render(style, seed, { stem: 'kick' });
  assert(bass.subDb > -21, `${style}: bass sub ${bass.subDb} dB is too light`);
  assert(bass.subDb > kick.subDb - 8, `${style}: bass sub ${bass.subDb} dB sits too far under the kick (${kick.subDb} dB)`);
  assert(full.mudShare <= MUD_MAIN[style] * 1.25, `${style}: ${full.mudShare.toFixed(3)} of the mix is 200–500 Hz mud (main ${MUD_MAIN[style]})`);
  // The bass as heard in the mix (full minus a render with the bass muted) against the soloed bass,
  // where no kick plays: the difference right after each kick is how far the kick ducks it.
  const d = full.data.map((x, i) => x - noBass.data[i]);
  let sum = 0, n = 0;
  for (const t of full.kicks) {
    const a = Math.round((t + 0.003) * SR), z = Math.round((t + 0.012) * SR), solo = rmsDb(bass.data, a, z);
    if (solo > -50) { sum += solo - rmsDb(d, a, z); n++; }
  }
  const dip = n ? sum / n : 0;
  assert(dip >= 3, `${style}: kick only ducks the bass ${dip.toFixed(1)} dB`);
  const loud = lufs([full.data], SR);
  assert(loud > -16 && loud < -4, `${style}: mix loudness ${loud.toFixed(1)} LUFS`);
  rows.push([style, bass.subDb, kick.subDb, full.mudShare, +dip.toFixed(1), +loud.toFixed(1)]);
}

// 2. Hook leads: present but not harsh, and level with the recorded players.
const LEADS = { trance: 211, hyperpop: 211, dnb: 211, peak: 503, deephouse: 211, trap: 211, amapiano: 211 };
// Hook loudness on main before this pass (LUFS, same shim and seeds); the lead must come forward.
const HOOK_MAIN = { trance: -35.4, hyperpop: -31.3, dnb: -32.9, peak: -28.6, deephouse: -32.5, trap: -26.2, amapiano: -28.5 };
for (const [style, seed] of Object.entries(LEADS)) {
  const h = await render(style, seed, { stem: 'hook' }), lvl = lufs([h.data], SR), v = h.gen.pattern.hook.v;
  assert(h.harshShare <= 0.08, `${style} ${v} hook: ${h.harshShare} of its energy is 2–5 kHz`);
  assert(lvl >= HOOK_MAIN[style] + 1 && lvl < -13, `${style} ${v} hook at ${lvl.toFixed(1)} LUFS (main ${HOOK_MAIN[style]})`);
  rows.push([`${style} hook ${v}`, +lvl.toFixed(1), h.harshShare]);
}

// 3. Synth chord voices sit within 4 dB (K-weighted, as ears weigh it) of the recorded players on the same part.
for (const [style, seed] of [['deephouse', 211], ['trance', 211]]) {
  const level = async (voice) => hitDb(kWeight((await render(style, seed, { stem: 'chord', bars: 2, voice })).data, SR));
  const rec = []; for (const vo of [7, 8, 9, 10]) rec.push(await level(vo));
  const target = rec.reduce((a, b) => a + b, 0) / rec.length;
  const syn = []; for (let vo = 0; vo < 7; vo++) syn.push(await level(vo));
  rows.push([`${style} chords`, +target.toFixed(1), ...syn.map((x) => +x.toFixed(1))]);
  // PLUCK's loudness follows the borrowed CUTOFF by design, so it gets a wider window; KEYS trades
  // half a dB of level for keeping deep house's low mids within 25% of main.
  syn.forEach((lvl, vo) => assert(Math.abs(lvl - target) <= ({ 1: 5, 5: 6 }[vo] ?? 4), `${style}: synth voice ${vo} at ${lvl.toFixed(1)} dB vs recorded ${target.toFixed(1)} dB`));
}

// 4. CPU: a lead note stays a handful of oscillators.
{
  const s = defaultState(); applyOverrides(s, generate('trance', 211));
  const ctx = new OfflineAudioContext(1, SR, SR), e = new Engine(ctx, s, { realtime: false });
  for (const voice of ['analog', 'pulse', 'warm', 'vocal', 'reed', 'mallet']) {
    let n = 0; const make = ctx.createOscillator; ctx.createOscillator = function () { n++; return make.call(this); };
    e.hook(0.1, 0.9, 7, 1.2, voice, 0, false, 1, false, { feel: 0.6, warmth: 0.5 });
    ctx.createOscillator = make;
    assert(n <= 6, `${voice} lead uses ${n} oscillators per note`);
  }
}

// 5. NEO-SOUL's live band is balanced as recorded: no make-up gains, no club sub or sidechain.
{
  const s = defaultState(); applyOverrides(s, generate('neosoul', 9, 'dorian'));
  const e = new Engine(new OfflineAudioContext(1, SR, SR), s, { realtime: false });
  assert(e.soulBand() && lowEnd(s.master) === null, 'NEO-SOUL must keep its live-band balance');
  e.stab(0.1, 0.8); e.hook(0.2, 0.8, 4, 0.5, 'reed');
  assert(!Object.keys(e.trims || {}).length, 'NEO-SOUL voices must not get club make-up gain');
}

console.log('sound ok');
