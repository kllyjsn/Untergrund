// Server-side Open Graph image for a track: the same step-ring artwork as js/artwork.js, rasterised to a 1200x630 PNG
// with only node:zlib, so link unfurls (iMessage, Slack, X) show the song's own art without a canvas dependency.
import { deflateSync } from 'node:zlib';
import { rng } from '../../js/dsp.js';
import { TRACKS } from '../../js/params.js';
import { artSeed } from '../../js/artwork.js';

export { artSeed };

export const OG_W = 1200, OG_H = 630;
const ACCENTS = [[255, 43, 43], [198, 255, 61], [43, 209, 255]];
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const stepValues = (pat, id) => (id === 'acid' ? (pat.steps.acid || []).map((s) => (s?.on ? (s.a ? 2 : 1) : 0)) : pat.steps[id] || []);
const hits = (pat) => TRACKS.reduce((n, t) => n + stepValues(pat, t.id).filter(Boolean).length, 0);

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}


// 5x7 pixel font for the unfurl's wordmark, title and artist (one row = 5 bits, MSB left).
const GLYPHS = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], "'": [4, 4, 8, 0, 0, 0, 0], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4],
  '&': [12, 18, 20, 8, 21, 18, 13], ':': [0, 12, 12, 0, 12, 12, 0], '/': [1, 1, 2, 4, 8, 16, 16], '#': [10, 10, 31, 10, 31, 10, 10],
  '+': [0, 4, 4, 31, 4, 4, 0], ',': [0, 0, 0, 0, 12, 4, 8], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], '·': [0, 0, 0, 4, 0, 0, 0], ' ': [0, 0, 0, 0, 0, 0, 0],
};
// Uppercase, accents folded, anything the font lacks dropped.
export const pixelText = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[’‘]/g, "'").replace(/[–—]/g, '-')
  .split('').filter((c) => GLYPHS[c]).join('').replace(/\s+/g, ' ').trim();
// Greedy word wrap to `cols` characters, at most `rows` lines; an overflowing last line ends in "...".
export function wrapText(s, cols, rows) {
  const lines = [];
  let cur = '';
  for (const word of pixelText(s).split(' ').filter(Boolean)) {
    for (let w = word; w;) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length <= cols) { cur = next; w = ''; }
      else if (cur) { lines.push(cur); cur = ''; }
      else { lines.push(w.slice(0, cols)); w = w.slice(cols); }
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > rows) { lines.length = rows; lines[rows - 1] = `${lines[rows - 1].slice(0, cols - 3).trimEnd()}...`; }
  return lines;
}
// Stamps text into a per-pixel ink map (value = colour index + 1).
function stamp(ink, W, text, x0, y0, px, color) {
  let x = x0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
      if (!(g[row] & (16 >> col))) continue;
      for (let y = y0 + row * px; y < y0 + (row + 1) * px; y++) ink.fill(color, y * W + x + col * px, y * W + x + (col + 1) * px);
    }
    x += 6 * px;
  }
}

// The unfurl card: the song's step rings on the right, and when `text` is given the UNTERGRUND wordmark, title and artist
// in the pixel font on the left.
export function ogImage(state, seed = 1, text = null) {
  const W = OG_W, H = OG_H, r = rng(seed);
  const accent = ACCENTS[Math.floor(r() * 3)];
  const gx = W * (0.3 + r() * 0.4), gy = H * 0.45;
  const patterns = Array.isArray(state?.patterns) && state.patterns.length ? state.patterns : [{ steps: {}, len: {} }];
  const pat = patterns.reduce((best, p) => (hits(p) > hits(best) ? p : best), patterns[state.current] || patterns[0]);
  const rot = r() * Math.PI * 2, TAU = Math.PI * 2;
  const S = 800, cx = text ? W - 330 : W / 2, cy = H / 2, lw = S * 0.02, dot = S * 0.05;
  const rings = TRACKS.map((t, i) => {
    const steps = stepValues(pat, t.id), n = Math.max(1, (pat.len?.[t.id] | 0) || steps.length || 16);
    return { rad: S * (0.1 + i * 0.033), n, steps, color: hex(t.color) };
  });
  const off = [24, 24, 28];
  const rgb = Buffer.alloc(W * H * 3);
  const ink = new Uint8Array(W * H), INK = [accent, [246, 246, 248], [168, 168, 178], [110, 110, 120]];
  if (text) {
    const X = 72;
    stamp(ink, W, 'UNTERGRUND', X, 72, 4, 1);
    const title = wrapText(text.title || 'Untitled', 12, 3), px = title.length > 2 || title.some((l) => l.length > 10) ? 6 : 7;
    const top = 72 + 28 + Math.round((H - 72 - 28 - 150 - title.length * 9 * px) / 2);
    title.forEach((l, i) => stamp(ink, W, l, X, top + i * 9 * px, px, 2));
    const by = wrapText(text.artist || '', 22, 1)[0];
    if (by) stamp(ink, W, by, X, top + title.length * 9 * px + 14, 4, 3);
    const line = wrapText(text.line || '', 34, 1)[0];
    if (line) stamp(ink, W, line, X, H - 72 - 21, 3, 4);
  }
  // Film grain from a small repeating tile so the PNG stays compact for unfurl crawlers.
  const grain = Float32Array.from({ length: 64 * 64 }, () => (r() - 0.5) * 14);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gd = Math.hypot(x - gx, y - gy) / (S * 0.8);
      const glow = Math.max(0, 1 - gd) * 0.2;
      let c = [6 + (accent[0] - 6) * glow, 6 + (accent[1] - 6) * glow, 7 + (accent[2] - 7) * glow];
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      const i = Math.round((d / S - 0.1) / 0.033);
      if (i >= 0 && i < rings.length) {
        const ring = rings[i], radial = Math.min(1, Math.max(0, lw / 2 - Math.abs(d - ring.rad) + 0.5));
        if (radial > 0) {
          let a = Math.atan2(dy, dx) - rot; a = ((a % TAU) + TAU) % TAU;
          const segA = TAU / ring.n, s = Math.floor(a / segA), frac = a - s * segA, arc = segA * 0.78;
          const ang = frac < arc ? Math.min(1, Math.max(0, Math.min(frac, arc - frac) * d + 0.5)) : 0;
          const v = ring.steps[s % ring.n], col = v ? (v > 1 ? [255, 255, 255] : ring.color) : off;
          const cov = radial * ang * (v ? 0.95 : 1);
          c = c.map((ch, k) => ch + (col[k] - ch) * cov);
        }
      }
      if (d < dot + 1) { const cov = Math.min(1, Math.max(0, dot - d + 0.5)); c = c.map((ch, k) => ch + (accent[k] - ch) * cov); }
      if (ink[y * W + x]) c = INK[ink[y * W + x] - 1].slice();
      if (y % 4 === 0) c = c.map((ch) => ch + (255 - ch) * 0.025);
      const n = grain[(y & 63) * 64 + (x & 63)], o = (y * W + x) * 3;
      rgb[o] = Math.max(0, Math.min(255, c[0] + n)); rgb[o + 1] = Math.max(0, Math.min(255, c[1] + n)); rgb[o + 2] = Math.max(0, Math.min(255, c[2] + n));
    }
  }
  return encodePng(rgb, W, H);
}
