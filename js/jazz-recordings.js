export const EP_BANKS = ['jep1', 'jep2', 'jep3', 'jep4'];
export const epLayer = (velocity) => velocity < 38 / 127 ? 0 : velocity < 66 / 127 ? 1 : velocity < 90 / 127 ? 2 : 3;
const EP_PEAKS = { jep3: { 68: [[2075, 50, -16], [2489, 50, -18]], 73: [[2214, 50, -14]] } };
export const epNotches = (bank, midi, rate) => (EP_PEAKS[bank]?.[Math.round(midi)] || []).map(([f, q, db]) => [f * rate, q, db]);

export function recordedJazzKeys(e, t, v, iv, root, p, out, mix) {
  if (!iv.length) return true;
  const sets = EP_BANKS.map((name) => e.rec?.(name));
  if (sets.some((set) => !set?.length)) return false;
  const velocity = Math.max(0, Math.min(1, v / mix));
  const set = sets[epLayer(velocity)];
  const env = Number.isFinite(p.env) ? Math.max(0, Math.min(1, p.env)) : .12;
  const detune = Number.isFinite(p.detune) ? Math.max(0, Math.min(40, p.detune)) : .6;
  const duration = Math.max(.08, p.decay * 2.5), release = .08 + env * .32;
  const pan = e.ctx.createStereoPanner(), trem = e.gain(.96), lfo = e.ctx.createOscillator();
  lfo.frequency.value = 4.8;
  lfo.connect(e.gain(.07)).connect(pan.pan);
  lfo.connect(e.gain(.04)).connect(trem.gain);
  pan.connect(trem).connect(out);
  e.startSource(lfo, t); lfo.stop(t + duration + release * 8 + .1);
  for (const [k, n] of iv.entries()) {
    const midi = root + n;
    const [c, buf] = set.reduce((a, b) => Math.abs(b[0] - midi) < Math.abs(a[0] - midi) ? b : a);
    const rate = 2 ** ((midi - c + (k % 2 ? 1 : -1) * detune * .0025) / 12);
    e.playBuf(buf, t, v * .68 / Math.sqrt(iv.length), pan, rate, duration, {
      fade: .003 + env * .04, release, ringOut: true,
      peaks: epNotches(EP_BANKS[epLayer(velocity)], c, rate),
      shelves: [[3000, Math.max(-12, Math.min(12, 6 * Math.log2(Math.max(40, p.cutoff) / 1700)))]],
    });
  }
  return true;
}
