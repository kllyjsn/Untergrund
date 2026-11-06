// Mix-aware Describe: "the bass is too loud" or "it's muddy" listens to a short render of the drop first,
// mixAdjust in describe.js then sizes the fix by how far the part or band sits from where generated songs put it.
import { renderStems } from './stems.js';
import { lufs, spectralBands } from './lab-metrics.js';

export async function measureMix(state, { bars = 2 } = {}) {
  const s = JSON.parse(JSON.stringify(state));
  if (s.patterns.length >= 8 && !s.patterns.some((p) => p.score)) { s.chainOn = false; s.current = 6; }
  const r = await renderStems(s, { bars });
  const n = r.length, L = new Float32Array(n), R = new Float32Array(n);
  for (const st of r.stems) for (let i = 0; i < n; i++) { L[i] += st.left[i]; R[i] += st.right[i]; }
  const mix = lufs([L, R], r.sampleRate), tracks = {};
  for (const st of r.stems) {
    const v = lufs([st.left, st.right], r.sampleRate);
    if (v > -70) tracks[st.id] = Math.round((v - mix) * 10) / 10;
  }
  return { mix: Math.round(mix * 10) / 10, tracks, bands: spectralBands([L, R], r.sampleRate) };
}
