import { song, plan } from './audio-quality-page.js';
import { renderBars } from '/js/render.js';
import { router } from '/js/stems.js';
import { loudness } from '/js/loudness.js';

// scipy.signal.butter(4, [62, 125], 'band', fs=48000, output='sos').
const LOW = [
  [2.8597438140268177e-10, 5.719487628053635e-10, 2.8597438140268177e-10, 1, -1.9911497635197397, 0.9913262509825358],
  [1, 2, 1, 1, -1.9933956747286503, 0.9934948345444103],
  [1, -2, 1, 1, -1.9955995387395102, 0.9958546600774563],
  [1, -2, 1, 1, -1.9977756944958558, 0.9978445963119986],
];

function zeroPhase(samples, sections) {
  const pad = 27, n = samples.length, data = new Float64Array(n + 2 * pad);
  data.set(samples, pad);
  for (let i = 0; i < pad; i++) {
    data[i] = 2 * samples[0] - samples[pad - i];
    data[n + pad + i] = 2 * samples[n - 1] - samples[n - 2 - i];
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const [b0, b1, b2, , a1, a2] of sections) {
      const dc = (b0 + b1 + b2) / (1 + a1 + a2), first = data[0];
      let z0 = (dc - b0) * first, z1 = (b2 - a2 * dc) * first;
      for (let i = 0; i < data.length; i++) {
        const x = data[i], y = b0 * x + z0;
        z0 = b1 * x - a1 * y + z1; z1 = b2 * x - a2 * y;
        data[i] = y;
      }
    }
    data.reverse();
  }
  return data.subarray(pad, pad + n);
}

export async function brassWeight(style, seed, variant) {
  const state = song(style, seed), p = plan(state, 8), route = router(['stab']);
  if (state.params.stab.voice !== 4) throw new Error(`${style}/${seed}: not brass`);
  let calls = 0, buffer;
  try {
    buffer = await renderBars(state, p.bars, {
      sampleRate: 48000, tail: 8, onContext: route.onContext, onScheduled: route.restore,
      onEngine(engine) {
        route.onEngine(engine);
        const chord = engine.analogChord;
        if (variant === 'synth') engine.analogChord = function (voice, ...args) { return voice === 4 ? false : chord.call(this, voice, ...args); };
        if (variant === 'before') {
          const filter = engine.filter; let active = false, shelves = [];
          engine.filter = function (type, hz, q) {
            const node = filter.call(this, type, active && type === 'highpass' && hz === 70 ? 150 : hz, q);
            if (active && type === 'lowshelf' && hz === 125) shelves.push(node);
            return node;
          };
          engine.analogChord = function (voice, ...args) {
            active = voice === 4; shelves = [];
            try { return chord.call(this, voice, ...args); }
            finally { for (const shelf of shelves) shelf.gain.value = 0; active = false; }
          };
        }
        const brass = engine.brass;
        engine.brass = function (...args) { calls++; return brass.apply(this, args); };
      },
    });
  } finally { route.restore(); }
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)], filtered = channels.map(ch => zeroPhase(ch, LOW));
  let ll = 0, rr = 0, lr = 0;
  for (let i = 0; i < filtered[0].length; i++) {
    const l = filtered[0][i], r = filtered[1][i]; ll += l * l; rr += r * r; lr += l * r;
  }
  const stereo = (ll + rr) / (2 * buffer.length), mono = (ll + rr + 2 * lr) / (4 * buffer.length);
  return { style, seed, variant, calls, frames: buffer.length, lufs: loudness(channels, 48000).integrated,
    stereo: 10 * Math.log10(stereo), mono: 10 * Math.log10(mono), correlation: lr / Math.sqrt(ll * rr), loss: 10 * Math.log10(mono / stereo) };
}
