import { withChrome } from './chrome.mjs';

const mode = process.argv[2] || 'out';
console.log(await withChrome((run) => run(`(async () => {
  const { song } = await import('/test/audio-quality-page.js');
  const { renderBars } = await import('/js/render.js');
  const s = song('hardtechno', 42); s.chain = 'CCCEEFFGGGGGGGGG';
  const mode = ${JSON.stringify(mode)};
  if (${process.argv.includes('--stable')}) (await import('/test/stable-audio-sums.js')).stableAudioSums();
  if (mode === 'sum') {
    const samples = [];
    for (let i = 0; i < 30; i++) {
      const ctx = new OfflineAudioContext(1, 128, 48000);
      for (const value of [1e8, -1e8, 1]) {
        const source = ctx.createConstantSource(); source.offset.value = value;
        source.connect(ctx.destination); source.start();
      }
      samples.push((await ctx.startRendering()).getChannelData(0)[0]);
    }
    return { mode, samples };
  }
  const opts = { startBar: 1, onEngine(e) {
    if (mode === 'no-conv') for (const n of ['revConv','roomConv','bandConv','rumbleConv']) e[n].disconnect();
    else if (mode !== 'out') { e.out.disconnect(); (e.ch[mode]?.input || e[mode]).connect(e.ctx.destination); }
  }};
  const a = await renderBars(s, 8, opts), b = await renderBars(s, 8, opts);
  return Array.from({length: a.numberOfChannels}, (_, c) => {
    const x = a.getChannelData(c), y = b.getChannelData(c), window = a.sampleRate / 10;
    let peak = 0, rms = 0, at = 0, first = -1;
    for (let i = 0; i < x.length; i += window) {
      let energy = 0;
      for (let k = i; k < Math.min(i + window, x.length); k++) {
        const d = x[k] - y[k]; peak = Math.max(peak, Math.abs(d)); energy += d*d;
        if (d && first < 0) first = k / a.sampleRate;
      }
      const r = Math.sqrt(energy / Math.min(window, x.length-i));
      if (r > rms) { rms = r; at = i / a.sampleRate; }
    }
    return { mode, channel: c, peak, rms, at, first };
  });
})()`)));
