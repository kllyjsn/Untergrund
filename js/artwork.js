// Procedural cover art drawn from the actual pattern data, so each release gets a unique, on-brand square.
import { rng } from './dsp.js';
import { TRACKS, KEYS } from './params.js';

const stepValues = (pat, id) => (id === 'acid' ? pat.steps.acid.map((s) => (s.on ? (s.a ? 2 : 1) : 0)) : pat.steps[id]);
const hits = (pat) => Object.keys(pat.steps).reduce((n, id) => n + stepValues(pat, id).filter(Boolean).length, 0);

export function drawArtwork(state, { title = 'UNTERGRUND', style = '', seed = 1, size = 1200 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rng(seed);
  const hue = Math.floor(r() * 3);
  const accent = ['#ff2b2b', '#c6ff3d', '#2bd1ff'][hue];

  g.fillStyle = '#060607'; g.fillRect(0, 0, size, size);
  const grad = g.createRadialGradient(size * (0.3 + r() * 0.4), size * 0.42, 10, size / 2, size / 2, size * 0.8);
  grad.addColorStop(0, accent + '33'); grad.addColorStop(1, '#00000000');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);

  // Concentric step rings: one ring per track, one segment per active step.
  const pat = state.patterns.reduce((best, p) => (hits(p) > hits(best) ? p : best), state.patterns[state.current]);
  const cx = size / 2, cy = size * 0.44;
  const rot = r() * Math.PI * 2;
  TRACKS.forEach((t, i) => {
    const steps = stepValues(pat, t.id);
    const rad = size * (0.1 + i * 0.033);
    const n = pat.len[t.id] || steps.length;
    for (let s = 0; s < n; s++) {
      const v = steps[s];
      const a0 = rot + (s / n) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / n * 0.78;
      g.beginPath(); g.arc(cx, cy, rad, a0, a1);
      g.lineWidth = size * 0.02;
      g.strokeStyle = v ? (v > 1 ? '#ffffff' : t.color) : '#18181c';
      g.globalAlpha = v ? 0.95 : 1;
      g.stroke();
    }
  });
  g.globalAlpha = 1;
  g.beginPath(); g.arc(cx, cy, size * 0.05, 0, Math.PI * 2); g.fillStyle = accent; g.fill();

  // Scanlines + grain for the warehouse-flyer feel.
  g.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 0; y < size; y += 4) g.fillRect(0, y, size, 1);
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 22; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);

  const pad = size * 0.06;
  g.fillStyle = '#f2f2f4';
  g.textBaseline = 'alphabetic';
  let fs = size * 0.085;
  g.font = `900 ${fs}px "Inter Tight", "Arial Black", sans-serif`;
  const text = title.toUpperCase();
  while (g.measureText(text).width > size - pad * 2 && fs > size * 0.035) { fs -= 2; g.font = `900 ${fs}px "Inter Tight", "Arial Black", sans-serif`; }
  g.fillText(text, pad, size - pad - size * 0.07);
  g.font = `700 ${size * 0.026}px "JetBrains Mono", monospace`;
  g.fillStyle = accent;
  g.fillText(`${state.bpm} BPM · ${KEYS[state.key]} MIN${style ? ' · ' + style.toUpperCase() : ''}`, pad, size - pad);
  g.fillStyle = '#8a8a94';
  g.textAlign = 'right';
  g.fillText('UNTERGRUND', size - pad, size - pad);
  g.fillRect(pad, size - pad - size * 0.045, size - pad * 2, 2);
  return c;
}

export const canvasToBlob = (c) => new Promise((ok) => c.toBlob(ok, 'image/png'));
