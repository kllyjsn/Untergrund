import assert from 'node:assert/strict';
import { withChrome } from './chrome.mjs';
import { OfflineAudioContext, installGlobals } from './offline-audio.mjs';
installGlobals();
const { freshSong, INSTRUMENTS, STYLES } = await import('../js/state.js');
const { instrumentFor } = await import('../js/palette-defaults.js');
const { Engine } = await import('../js/engine.js');
const { analogSet, liveSets, loadBand, bandKit } = await import('../js/livekit.js');

const mapping = {
  hypnotic: { 2: 'juno' }, ambient: { 2: 'juno' }, peak: { 2: 'jpad', 4: 'jxbr' },
  hardtechno: { 2: 'jpad' }, trance: { 2: 'jxstr', 4: 'jbr' }, industrial: { 4: 'jxbr' },
  electro: { 4: 'jxbr' }, electrohiphop: { 4: 'jxbr' },
};
function instrument(style, seed = 42) {
  const state = freshSong(style, seed), ctx = new OfflineAudioContext(2, 48000, 48000), nodes = [];
  state.artist = { style, seed };
  const e = new Engine(ctx, state, { realtime: false });
  for (const method of ['createBufferSource', 'createOscillator', 'createGain']) {
    const make = ctx[method].bind(ctx);
    ctx[method] = (...args) => { const node = make(...args); nodes.push(node); return node; };
  }
  return { e, ctx, nodes };
}
for (const style of Object.keys(STYLES)) for (const voice of [0, 2, 4, 10]) {
  const expected = mapping[style]?.[voice] || null, s = freshSong(style, 42);
  s.artist = { style, seed: 42 };
  s.params.stab.voice = voice;
  assert.equal(analogSet(style, voice), expected);
  const sets = liveSets(s);
  const replaySets = liveSets({ ...s, artist: { style: 'ambient' } }, style);
  for (const name of ['juno', 'jpad', 'jxstr', 'jxbr', 'jbr', 'dpad']) {
    assert.equal(sets.includes(name), name === expected || style === 'dub' && name === 'dpad', `${style}/${voice}: ${name} preload`);
    assert.equal(replaySets.includes(name), name === expected || style === 'dub' && name === 'dpad', `${style}/${voice}: ${name} replay preload`);
  }
}
for (const [style, voices] of Object.entries(mapping)) for (const voice of Object.keys(voices).map(Number)) {
  const { e, nodes } = instrument(style), args = [0.1, 0.8, [0, 3, 7], 60, e.state.params.stab, e.ch.stab.input];
  const method = voice === 2 ? 'pad' : 'brass';
  e.rec = () => null;
  e[method](...args);
  assert(nodes.some(n => n.frequency && n.detune), `${style}: missing buffers use synth`);
  nodes.length = 0;
  e.rec = () => [];
  e[method](...args);
  assert(nodes.some(n => n.frequency && n.detune), `${style}: empty buffers use synth`);
  nodes.length = 0;
  const set = await loadBand(voices[voice]);
  assert(set?.length);
  e.rec = () => set;
  e[method](...args);
  const sources = nodes.filter(n => n.buffer), sides = voice === 2 ? [-1, 0, 1] : [-1, 1];
  assert.equal(sources.length, 3 * sides.length, `${style}: detuned recording layers per chord tone`);
  assert(sources.every(n => n.loop && n.loopStart > 0 && n.loopEnd < n.buffer.duration - 0.08));
  assert(!nodes.some(n => n.frequency && n.detune), `${style}: loaded recordings replace oscillators`);
  sources.forEach((source, k) => {
    const m = 60 + args[2][Math.floor(k / sides.length)], nearest = set.reduce((a, b) => Math.abs(a[0] - m) <= Math.abs(b[0] - m) ? a : b);
    assert(Math.abs(source.playbackRate.value - 2 ** ((m - nearest[0]) / 12)) < 1e-9, 'measured nearest center, including BAND_TUNE');
    assert.equal(source.buffer.numberOfChannels, nearest[1].numberOfChannels);
    assert.notEqual(source.buffer, nearest[1], 'loop preparation does not modify original decoded audio');
    const a = Math.round(source.loopStart * source.buffer.sampleRate), b = Math.round(source.loopEnd * source.buffer.sampleRate);
    for (let ch = 0; ch < source.buffer.numberOfChannels; ch++) {
      const loop = source.buffer.getChannelData(ch), raw = nearest[1].getChannelData(ch);
      assert.equal(loop[b - 1], raw[a - 1], 'crossfade ends on the sample preceding the loop start');
      assert.equal(loop[a], raw[a], 'loop start is unchanged');
    }
    assert(source.t1 > 0.1 + (voice === 2 ? args[4].decay * 2 : args[4].decay * 0.8), 'release is scheduled');
    const spread = voice === 2 ? (4 + args[4].detune) * (style === 'hardtechno' ? 3 : 1) : args[4].detune * 0.5;
    assert.equal(source.detune.at(0.1), sides[k % sides.length] * spread + (style === 'hardtechno' ? 240 : 0), 'synth-scale cents spread');
    if (style === 'hardtechno') {
      assert(source.detune.at(0.11) - source.detune.at(0.15) > 150, 'Hard Techno attack settles');
    }
  });
  nodes.length = 0;
  e[method](0.1, 0.8, [], 60, args[4], args[5]);
  assert.equal(nodes.length, 0, 'empty chord is silent');
  const renderDetune = async detune => {
    const { e, ctx } = instrument(style);
    e.rec = () => set;
    e[method](0.1, 0.8, [0, 3, 7], 60, { ...e.state.params.stab, detune }, e.ch.stab.input);
    return (await ctx.startRendering(e.ch.stab.input)).getChannelData(0);
  };
  const narrow = await renderDetune(0), wide = await renderDetune(40);
  const difference = Math.sqrt(narrow.reduce((sum, x, i) => sum + (x - wide[i]) ** 2, 0) / narrow.length);
  assert(difference > 0.001, `${style}/${voice}: recorded DETUNE 0 vs 40 changes PCM`);
}
{
  const { e, nodes } = instrument('dub');
  const set = await loadBand('dpad'); e.rec = () => set;
  e.dubPad(0.1, 0.8, [0, 3, 7], 48);
  let sources = nodes.filter(n => n.buffer);
  assert.equal(sources.length, 6, 'Dub retains its two stereo seats');
  assert(sources.every(n => n.loop && n.t1 > e.stepDur * 24 + 5));
  e.dubPad(0.1 + e.stepDur * 47, 0.8, [0, 3, 7], 48);
  assert.equal(nodes.filter(n => n.buffer).length, 6, 'Dub does not retrigger before 48 steps');
  e.dubPad(0.1 + e.stepDur * 48 + 1e-6, 0.8, [0, 3, 7], 48);
  assert.equal(nodes.filter(n => n.buffer).length, 12);
  const fallback = instrument('dub'); fallback.e.rec = () => null;
  fallback.e.dubPad(0.1, 0.8, [0, 3, 7], 48);
  assert.equal(fallback.nodes.filter(n => n.frequency && n.detune).length, 6, 'Dub missing-buffer synth fallback');
}
for (const [style, voices] of Object.entries(mapping)) for (const tuple of INSTRUMENTS[style]) if (voices[tuple[0]]) {
  let seed = 1; while (instrumentFor(INSTRUMENTS[style], seed) !== tuple) seed++;
  assert.equal(freshSong(style, seed).params.stab.voice, tuple[0]);
}
assert(bandKit('jxbr').every(([center]) => Math.abs(center - Math.round(center)) > 0), 'Brassy measured tuning is loaded');
assert.equal(bandKit('jxbr')[0][0], 48 - 23.6 / 100);
const stereoBrass = await withChrome(async run => run(`(async () => {
  const { freshSong } = await import('/js/state.js');
  const { Engine } = await import('/js/engine.js');
  const { loadBand } = await import('/js/livekit.js');
  const { fft } = await import('/js/audio-quality.js');
  await Promise.all([loadBand('jxbr'), loadBand('jbr')]);
  const rows = [];
  for (const [style, seed] of [['electrohiphop', 1], ['trance', 3], ['industrial', 5], ['peak', 1], ['electro', 3]]) {
    const state = freshSong(style, seed), sr = 48000;
    state.artist = { style, seed };
    const ctx = new OfflineAudioContext(2, sr * 3, sr), engine = new Engine(ctx, state, { realtime: false });
    const out = ctx.createGain(); out.connect(ctx.destination);
    engine.brass(0.1, 0.8, [0, 3, 7], 48, state.params.stab, out);
    const cached = engine.analogBrassOut(out) === engine.analogBrassOut(out);
    const buffer = await ctx.startRendering(), n = 2 ** Math.ceil(Math.log2(buffer.length));
    const spectra = [0, 1].map(ch => {
      const re = new Float64Array(n), im = new Float64Array(n);
      re.set(buffer.getChannelData(ch)); fft(re, im); return { re, im };
    });
    let ll = 0, rr = 0, lr = 0, high = 0, highSide = 0;
    for (let k = 1; k < n / 2; k++) {
      const f = k * sr / n, [l, r] = spectra;
      const a = l.re[k] ** 2 + l.im[k] ** 2, b = r.re[k] ** 2 + r.im[k] ** 2;
      const cross = l.re[k] * r.re[k] + l.im[k] * r.im[k];
      if (f >= 62 && f <= 250) { ll += a; rr += b; lr += cross; }
      if (f >= 700 && f <= 5000) { high += a + b; highSide += (a + b - 2 * cross) / 2; }
    }
    rows.push({ style, cached, energy: ll + rr, correlation: lr / Math.sqrt(ll * rr),
      loss: 10 * Math.log10((ll + rr + 2 * lr) / (2 * (ll + rr))), highSide: highSide / high });
  }
  return rows;
})()`));
assert(stereoBrass, 'native stereo brass verification requires Chrome');
for (const row of stereoBrass) {
  assert(row.cached, `${row.style}: brass bus is reused`);
  assert(row.energy > 1, `${row.style}: low-band test is not silent`);
  assert(row.correlation > 0.98, `${row.style}: 62–250 Hz L/R correlation ${row.correlation}`);
  assert(row.loss > -0.05, `${row.style}: low-band mono loss ${row.loss} dB`);
  assert(row.highSide > 0.001, `${row.style}: upper-band stereo is preserved`);
}
const weightCases = [['peak', 1], ['industrial', 5], ['electrohiphop', 20], ['electrohiphop', 1]];
const brassWeight = await withChrome(async runs => Promise.all(weightCases.map(([style, seed], i) => runs[i](`(async () => {
  const { brassWeight } = await import('/test/brass-weight-page.js');
  const rows = [];
  for (const variant of ${JSON.stringify(i === 0 ? ['synth', 'before', 'current'] : ['synth', 'current'])}) rows.push(await brassWeight('${style}', ${seed}, variant));
  return rows;
})()`))), { pages: weightCases.length });
assert(brassWeight, 'native whole-render brass weight verification requires Chrome');
for (const rows of brassWeight) {
  const main = rows.find(r => r.variant === 'synth'), current = rows.find(r => r.variant === 'current'), before = rows.find(r => r.variant === 'before');
  assert(current.calls > 0 && current.frames === main.frames, `${current.style}: aligned whole-song brass`);
  if (current.style === 'electrohiphop') {
    assert(Math.abs(current.lufs - main.lufs) < 0.5, `${current.style}/${current.seed}: brass loudness delta ${current.lufs - main.lufs} LU`);
  } else {
    for (const channel of ['stereo', 'mono']) assert(Math.abs(current[channel] - main[channel]) < 1, `${current.style}: 62–125 Hz ${channel} delta ${current[channel] - main[channel]} dB`);
  }
  assert(current.correlation > 0.98, `${current.style}: whole-render low-band correlation ${current.correlation}`);
  assert(current.loss > -0.05, `${current.style}: whole-render low-band mono loss ${current.loss} dB`);
  if (before) assert(Math.abs(current.lufs - before.lufs) < 0.5, `Peak: brass loudness change ${current.lufs - before.lufs} LU`);
}
console.log('analog brass weight: native whole-song raw stems, zero-phase Butterworth 62–125 Hz, mono safety and integrated loudness passed');
console.log('analog: style/tuple preloads, synth fallbacks, measured pitch, stereo crossfaded loops, DETUNE PCM/spread, mono-safe brass, release, Hard Techno attack and Dub cadence passed');
