// Server-side unfurl for a live Club room: the stage as the room sees it (the set for the song's genre, the DJ at their
// instrument, the band, the crowd in their own looks) plus the "live in this room" card, rasterised to a 1200x630 PNG
// with no canvas dependency. The scene comes from the same stageScene/ensembleLayout/crowdSlots as js/club-stage.js.
import { encodePng, GLYPHS, pixelText, wrapText, OG_W, OG_H } from './og.js';
import { stageScene, ensembleLayout, crowdSlots } from '../../js/club-stage.js';
import { SHAPES, COLORS, GEAR } from '../../js/club-identity.js';
import { rng } from '../../js/dsp.js';

const W = OG_W, H = OG_H, SUB = 4;
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const AV = { lime: '#30d158', red: '#ff4c4c', orange: '#ff9f0a', blue: '#45c8ff', violet: '#9b6cff', pink: '#ff375f', bone: '#e5dfd2' };
const INK = hex('#19191a'), GREEN = hex('#30d158');

function canvas() {
  const px = new Float32Array(W * H * 3);
  const cov = new Float32Array(W);
  const blend = (x, y, col, a) => {
    if (a <= 0) return;
    const o = (y * W + x) * 3;
    px[o] += (col[0] - px[o]) * a; px[o + 1] += (col[1] - px[o + 1]) * a; px[o + 2] += (col[2] - px[o + 2]) * a;
  };
  // Even-odd polygon fill with SUB sub-scanlines and exact horizontal coverage; `col` may be (x, y) => rgb.
  function poly(pts, col, alpha = 1) {
    let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (const [x, y] of pts) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    const ya = Math.max(0, Math.floor(y0)), yb = Math.min(H - 1, Math.ceil(y1)), xa = Math.max(0, Math.floor(x0)), xb = Math.min(W - 1, Math.ceil(x1));
    if (ya > yb || xa > xb) return;
    for (let py = ya; py <= yb; py++) {
      cov.fill(0, xa, xb + 1);
      for (let k = 0; k < SUB; k++) {
        const sy = py + (k + 0.5) / SUB, xs = [];
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[j];
          if ((ay > sy) !== (by > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        }
        xs.sort((a, b) => a - b);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const l = Math.max(xa, xs[i]), r = Math.min(xb + 1, xs[i + 1]);
          if (r <= l) continue;
          const li = Math.floor(l), ri = Math.floor(r);
          if (li === ri) { cov[li] += (r - l) / SUB; continue; }
          cov[li] += (li + 1 - l) / SUB;
          for (let x = li + 1; x < ri && x <= xb; x++) cov[x] += 1 / SUB;
          if (ri <= xb) cov[ri] += (r - ri) / SUB;
        }
      }
      for (let x = xa; x <= xb; x++) if (cov[x] > 0) blend(x, py, typeof col === 'function' ? col(x, py) : col, Math.min(1, cov[x]) * alpha);
    }
  }
  const rect = (x, y, w, h, col, a = 1) => w > 0 && h > 0 && poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], col, a);
  function rrect(x, y, w, h, r, col, a = 1) {
    r = Math.min(r, w / 2, h / 2);
    if (r < 0.5) return rect(x, y, w, h, col, a);
    const pts = [];
    for (const [cx, cy, a0] of [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]])
      for (let i = 0; i <= 6; i++) { const t = ((a0 + i * 15) * Math.PI) / 180; pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); }
    poly(pts, col, a);
  }
  const ellipse = (cx, cy, rx, ry, col, a = 1) => poly(Array.from({ length: 40 }, (_, i) => [cx + Math.cos((i / 40) * Math.PI * 2) * rx, cy + Math.sin((i / 40) * Math.PI * 2) * ry]), col, a);
  // A rectangle of width w from p to q (a stick, a neck, a mic stand).
  function line(p, q, w, col, a = 1) {
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1, nx = (-dy / len) * (w / 2), ny = (dx / len) * (w / 2);
    poly([[p[0] + nx, p[1] + ny], [q[0] + nx, q[1] + ny], [q[0] - nx, q[1] - ny], [p[0] - nx, p[1] - ny]], col, a);
  }
  function glow(cx, cy, rx, ry, col, a) {
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++)
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(W - 1, Math.ceil(cx + rx)); x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (d < 1) blend(x, y, col, a * (1 - d) * (1 - d));
      }
  }
  function text(s, x, y, size, col, a = 1) {
    let cx = x;
    for (const ch of s) {
      const g = GLYPHS[ch];
      if (g) for (let row = 0; row < 7; row++) for (let c = 0; c < 5; c++) if (g[row] & (16 >> c)) rect(cx + c * size, y + row * size, size, size, col, a);
      cx += 6 * size;
    }
  }
  return { px, poly, rect, rrect, ellipse, line, glow, text, blend };
}
const textW = (s, size) => Math.max(0, s.length * 6 * size - size);

const look = (m = {}, dim = false) => {
  const l = { ...m, ...(m.avatar || {}) };
  const pick = (v, list, f) => (list.includes(v) ? v : f);
  return { name: String(l.name || '').slice(0, 28), shape: pick(l.shape, SHAPES, 'block'), color: pick(l.color, COLORS, 'lime'), gear: pick(l.gear, GEAR, 'none'), dim };
};
// The crowd's ambient silhouettes: CSS `brightness(.32) saturate(.25)`.
const dimmer = (on) => (c) => { if (!on) return c; const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; return c.map((v) => (l + (v - l) * 0.25) * 0.32); };

// One bot, front three-quarter view, drawn from the CSS box model (club-person/.bot/.cube) in bot units scaled by s.
// (x, y) is where its feet meet the floor. Returns the anchor points instruments attach to.
function bot(cv, x, y, s, who, { arms = [12, -12], seated = false, behind = null, front = null } = {}) {
  const f = dimmer(who.dim), av = hex(AV[who.color]);
  const C = { av: f(av), top: f(mix(av, [255, 255, 255], 0.28)), side: f(mix(av, INK, 0.48)), shell: f(hex('#33313b')), shellTop: f(hex('#494453')), shellSide: f(hex('#26252c')), ink: f(INK), screen: f(hex('#1e1e22')) };
  if (seated) y += 14 * s;
  const X = (u) => x + u * s, Y = (u) => y - u * s, ox = 0.34, oy = 0.3;
  // A cube: front face, top and right side, 2px dark outlines like `.cube > i`.
  function cube(cx, bottom, w, h, d, face, top, side, r = 0) {
    const l = X(cx - w / 2), rgt = X(cx + w / 2), t = Y(bottom + h), b = Y(bottom), dx = d * ox * s, dy = -d * oy * s, e = 2 * Math.max(0.7, s * 0.8);
    cv.poly([[rgt - e / 2, t], [rgt + dx, t + dy], [rgt + dx, b + dy], [rgt - e / 2, b]], C.ink);
    cv.poly([[rgt, t + e / 2], [rgt + dx - e / 2, t + dy + e / 2], [rgt + dx - e / 2, b + dy - e / 2], [rgt, b - e / 2]], side);
    cv.poly([[l, t + e / 2], [l + dx, t + dy], [rgt + dx, t + dy], [rgt, t + e / 2]], C.ink);
    cv.poly([[l + e, t], [l + dx + e / 2, t + dy + e / 2], [rgt + dx - e, t + dy + e / 2], [rgt - e / 2, t]], top);
    cv.rrect(l, t, rgt - l, b - t, r * s, C.ink);
    cv.rrect(l + e, t + e, rgt - l - 2 * e, b - t - 2 * e, Math.max(0, r * s - e), face);
    return { l, r: rgt, t, b };
  }
  function arm(side, deg) {
    const sx = side * 30, top = 70, a = (deg * Math.PI) / 180, len = 38;
    const p = [X(sx), Y(top)], q = [p[0] - Math.sin(a) * len * s, p[1] + Math.cos(a) * len * s];
    cv.line(p, q, 13 * s, C.ink);
    cv.line(p, q, 9.5 * s, C.side);
    cv.line([p[0] + 2 * s, p[1]], [q[0] + 2 * s, q[1]], 3 * s, C.av, 0.55);
    return q;
  }
  cv.ellipse(X(0), Y(-6), 36 * s, 7 * s, [0, 0, 0], who.dim ? 0.35 : 0.6);
  behind?.(X, Y, s);
  if (!seated) { cube(-10, 0, 14, 28, 14, C.shell, C.shellTop, C.shellSide); cube(10, 0, 14, 28, 14, C.shell, C.shellTop, C.shellSide); }
  const torso = cube(0, 26, 46, 44, 30, C.shell, C.shellTop, C.shellSide);
  cv.rect(torso.l + 2 * s, torso.t + 2 * s, torso.r - torso.l - 4 * s, 8 * s, C.av);
  for (let i = -1; i <= 1; i++) cv.rect(X(i * 10 - 3), Y(26 + 18), 6 * s, 10 * s, i === -1 && !who.dim ? C.av : f(hex('#43414c')));
  const visor = who.shape === 'visor', round = who.shape === 'round', hh = visor ? 40 : 46;
  if (who.gear === 'hood') cube(0, 68, 62, 50, 48, C.shell, C.shellTop, C.shellSide, round ? 20 : 4);
  const head = cube(0, 70, 54, hh, 42, C.av, C.top, C.side, round ? 18 : visor ? 8 : 0);
  const sl = head.l + 6 * s, st = head.t + 8 * s, sw = head.r - head.l - 12 * s, sh = head.b - head.t - 17 * s;
  cv.rrect(sl, st, sw, sh, (round ? 14 : 5) * s, C.screen);
  if (who.gear === 'goggles') { cv.rect(sl - 3 * s, st + 6 * s, sw + 6 * s, 14 * s, C.ink); cv.rect(sl - 1 * s, st + 8 * s, sw + 2 * s, 10 * s, f(hex('#8fe6ff'))); }
  else if (visor) { cv.rrect(sl + 7 * s, st + 9 * s, 14 * s, 4 * s, 2 * s, C.av); cv.rrect(sl + sw - 21 * s, st + 9 * s, 14 * s, 4 * s, 2 * s, C.av); }
  else for (const ex of [sl + 9 * s, sl + sw - 17 * s]) round ? cv.ellipse(ex + 4 * s, st + 13 * s, 4 * s, 4 * s, C.av) : cv.rect(ex, st + 9 * s, 8 * s, 8 * s, C.av);
  if (!who.dim && who.gear !== 'goggles') for (const ex of [sl + 13 * s, sl + sw - 13 * s]) cv.glow(ex, st + 13 * s, 12 * s, 12 * s, av, 0.35);
  cv.rect(X(-7), st + sh - 8 * s, 14 * s, 3 * s, C.av, 0.7);
  if (who.gear === 'phones') {
    for (const side of [-1, 1]) cv.rect(X(side * 32 - 5), Y(70 + 33), 10 * s, 22 * s, C.av);
    const arc = Array.from({ length: 13 }, (_, i) => { const t = Math.PI + (i / 12) * Math.PI; return [X(Math.cos(t) * 32), Y(70 + hh - 4) + Math.sin(t) * 14 * s]; });
    for (let i = 1; i < arc.length; i++) cv.line(arc[i - 1], arc[i], 4 * s, f(hex('#26252b')));
  }
  if (who.gear === 'antenna') { cv.line([X(0), Y(70 + hh)], [X(0), Y(70 + hh + 18)], 3 * s, f(hex('#26252b'))); cv.ellipse(X(0), Y(70 + hh + 22), 5.5 * s, 5.5 * s, C.av); if (!who.dim) cv.glow(X(0), Y(70 + hh + 22), 18 * s, 18 * s, av, 0.5); }
  const hands = [arm(-1, arms[0]), arm(1, arms[1])];
  front?.(X, Y, s, hands);
  return { head, hands, X, Y };
}

// Instruments, from the CSS props (left/bottom in bot units around the feet).
const wood = hex('#d49a5b'), dark = hex('#19191a');
function guitar(cv, X, Y, s, kind) {
  const body = hex(kind === 'egtr' ? '#c8342c' : kind === 'bass' ? '#2c5fb8' : '#d49a5b'), long = kind === 'bass' ? 1.25 : 1;
  const a = (22 * Math.PI) / 180, o = [X(14), Y(46)];
  const at = (u, v) => [o[0] + (u * Math.cos(a) - v * Math.sin(a)) * s, o[1] + (u * Math.sin(a) + v * Math.cos(a)) * s];
  cv.line(at(-76 * long, 0), at(-10, 0), 10 * s, dark); cv.line(at(-76 * long, 0), at(-10, 0), 6.5 * s, hex('#5a3d24'));
  cv.line(at(-84 * long, 0), at(-72 * long, 0), 12 * s, dark);
  const ell = (u, v, rx, ry, col) => cv.poly(Array.from({ length: 36 }, (_, i) => { const t = (i / 36) * Math.PI * 2; return at(u + Math.cos(t) * rx, v + Math.sin(t) * ry); }), col);
  ell(2, 0, 22, 18, dark); ell(2, 0, 20, 16, body); ell(-8, -1, 14, 12, dark); ell(-8, -1, 12, 10.5, body);
  if (kind === 'agtr') ell(-6, 0, 6, 6, hex('#24160d')); else { ell(4, 0, 8, 7, dark); ell(4, 0, 6.5, 5.5, hex('#f4efe6')); }
}
const PROPS = {
  grand: (cv, X, Y, s) => {
    cv.rect(X(-28), Y(26), 56 * s, 14 * s, dark); cv.rect(X(-26), Y(24), 52 * s, 10 * s, hex('#2a2a2e'));
    cv.poly([[X(28), Y(44)], [X(160), Y(44)], [X(154), Y(50)], [X(34), Y(84)], [X(28), Y(82)]], dark);
    cv.rrect(X(14), Y(46), 158 * s, 30 * s, 10 * s, dark);
    cv.rrect(X(16), Y(44), 154 * s, 26 * s, 9 * s, (x, y) => mix(hex('#34343a'), hex('#0f0f11'), Math.min(1, Math.max(0, (y - Y(44)) / (26 * s)))));
    cv.rect(X(8), Y(38), 28 * s, 9 * s, dark);
    for (let i = 0; i < 5; i++) cv.rect(X(9 + i * 5.2), Y(36.5), 4 * s, 6 * s, hex('#f4f1ea'));
    cv.rect(X(26), Y(18), 7 * s, 22 * s, hex('#111111')); cv.rect(X(150), Y(18), 7 * s, 22 * s, hex('#111111'));
  },
  keys: (cv, X, Y, s) => {
    cv.line([X(-22), Y(-6)], [X(22), Y(34)], 4 * s, hex('#3a383f')); cv.line([X(22), Y(-6)], [X(-22), Y(34)], 4 * s, hex('#3a383f'));
    cv.rect(X(-46), Y(44), 92 * s, 16 * s, dark); cv.rect(X(-44), Y(42), 88 * s, 4 * s, hex('#26252b'));
    for (let i = 0; i < 14; i++) cv.rect(X(-44 + i * 6.3), Y(38), 5.3 * s, 8 * s, hex('#f4f1ea'));
  },
  drums: (cv, X, Y, s) => {
    cv.ellipse(X(-28), Y(36), 17 * s, 7 * s, dark); cv.ellipse(X(-28), Y(36), 15 * s, 5.5 * s, hex('#d9d6cf'));
    cv.ellipse(X(28), Y(38), 16 * s, 7 * s, dark); cv.ellipse(X(28), Y(38), 14 * s, 5.5 * s, hex('#d9d6cf'));
    cv.ellipse(X(-46), Y(55), 18 * s, 4 * s, hex('#e2b544')); cv.ellipse(X(44), Y(65), 22 * s, 4 * s, hex('#e2b544'));
    cv.ellipse(X(0), Y(16), 24 * s, 24 * s, dark); cv.ellipse(X(0), Y(16), 21 * s, 21 * s, hex('#c8342c')); cv.ellipse(X(0), Y(16), 15 * s, 15 * s, hex('#f2efe8'));
  },
  timpani: (cv, X, Y, s) => { for (const u of [-30, 30]) { cv.ellipse(X(u), Y(30), 27 * s, 8 * s, hex('#e8e4dc')); cv.poly([[X(u - 27), Y(30)], [X(u + 27), Y(30)], [X(u + 14), Y(-4)], [X(u - 14), Y(-4)]], hex('#9c5226')); } },
  cello: (cv, X, Y, s) => { cv.line([X(0), Y(50)], [X(0), Y(104)], 6 * s, hex('#251810')); cv.ellipse(X(0), Y(28), 17 * s, 30 * s, dark); cv.ellipse(X(0), Y(28), 15 * s, 28 * s, hex('#8b3f17')); },
  contrabass: (cv, X, Y, s) => { cv.line([X(0), Y(70)], [X(0), Y(130)], 6 * s, hex('#251810')); cv.ellipse(X(0), Y(38), 22 * s, 40 * s, dark); cv.ellipse(X(0), Y(38), 20 * s, 38 * s, hex('#7a3614')); },
  harp: (cv, X, Y, s) => { cv.line([X(-84), Y(-4)], [X(-84), Y(118)], 9 * s, hex('#d8a13a')); cv.poly([[X(-80), Y(112)], [X(-36), Y(112)], [X(-80), Y(10)]], hex('#b8862a'), 0.5); cv.line([X(-80), Y(114)], [X(-38), Y(112)], 5 * s, hex('#b8862a')); },
  violin: (cv, X, Y, s) => { cv.line([X(-52), Y(70)], [X(-14), Y(74)], 5 * s, hex('#2a1b12')); cv.ellipse(X(-6), Y(76), 13 * s, 9 * s, dark); cv.ellipse(X(-6), Y(76), 11 * s, 7.5 * s, hex('#a4521f')); },
  viola: (cv, X, Y, s) => { cv.line([X(-56), Y(70)], [X(-16), Y(74)], 5 * s, hex('#2a1b12')); cv.ellipse(X(-6), Y(76), 15 * s, 10 * s, dark); cv.ellipse(X(-6), Y(76), 13 * s, 8.5 * s, hex('#93461a')); },
  sax: (cv, X, Y, s) => { cv.line([X(-2), Y(78)], [X(6), Y(28)], 13 * s, dark); cv.line([X(-2), Y(78)], [X(6), Y(28)], 9 * s, hex('#e2b544')); cv.ellipse(X(14), Y(30), 9 * s, 9 * s, dark); cv.ellipse(X(14), Y(30), 7 * s, 7 * s, hex('#3a2a10')); },
  trumpet: (cv, X, Y, s) => { cv.ellipse(X(0), Y(77), 14 * s, 14 * s, dark); cv.ellipse(X(0), Y(77), 12 * s, 12 * s, hex('#e9bd4a')); cv.ellipse(X(0), Y(77), 5 * s, 5 * s, hex('#2a2010')); },
  horn: (cv, X, Y, s) => { cv.ellipse(X(19), Y(49), 19 * s, 19 * s, dark); cv.ellipse(X(19), Y(49), 16 * s, 16 * s, hex('#d8a13a')); cv.ellipse(X(19), Y(49), 7 * s, 7 * s, hex('#3a2a12')); },
  flute: (cv, X, Y, s) => cv.line([X(-12), Y(84)], [X(60), Y(78)], 5 * s, hex('#d4d4da')),
  clarinet: (cv, X, Y, s) => cv.line([X(2), Y(80)], [X(-4), Y(28)], 7 * s, hex('#1b1b1d')),
  agtr: (cv, X, Y, s) => guitar(cv, X, Y, s, 'agtr'),
  egtr: (cv, X, Y, s) => guitar(cv, X, Y, s, 'egtr'),
  bass: (cv, X, Y, s) => guitar(cv, X, Y, s, 'bass'),
  baton: () => {},
  mic: () => {},
};
// Arm angles per instrument (the CSS --la0/--ra0, at the top of the playing motion).
const ARMS = { agtr: [74, 30], egtr: [74, 30], bass: [74, 30], violin: [108, 80], viola: [108, 80], cello: [-138, 40], contrabass: [-138, 40],
  drums: [-34, 34], timpani: [-28, 28], keys: [-20, 20], grand: [-20, 20], harp: [46, 76], flute: [-98, -112], clarinet: [-48, 42], sax: [-48, 42],
  trumpet: [-70, 70], horn: [-46, 14], baton: [60, -100], mic: [30, 130], dj: [-24, 24] };
const SEATED = new Set(['drums', 'cello', 'grand']);
const BEHIND = new Set(['grand']);
const HAND = {
  stick: (cv, h, side, s) => cv.line(h, [h[0] - side * 18 * s, h[1] + 24 * s], 3.5 * s, hex('#e7c58b')),
  bow: (cv, h, side, s) => cv.line([h[0] - 34 * s, h[1] + 6 * s], [h[0] + 34 * s, h[1] - 6 * s], 2.5 * s, hex('#e2d6b8')),
  baton: (cv, h, side, s) => cv.line(h, [h[0] + 6 * s, h[1] - 30 * s], 2.5 * s, hex('#f4f1ea')),
  mic: (cv, h, side, s) => { cv.line(h, [h[0] - 4 * s, h[1] - 16 * s], 8 * s, hex('#222226')); cv.ellipse(h[0] - 5 * s, h[1] - 20 * s, 7 * s, 7 * s, dark); cv.ellipse(h[0] - 5 * s, h[1] - 20 * s, 5.5 * s, 5.5 * s, hex('#8a8a90')); },
};
const HANDS = { drums: ['stick', 'stick'], timpani: ['stick', 'stick'], violin: [null, 'bow'], viola: [null, 'bow'], cello: [null, 'bow'], contrabass: [null, 'bow'], baton: [null, 'baton'], mic: [null, 'mic'] };

function performer(cv, x, y, s, who, inst, { mic = false } = {}) {
  const prop = PROPS[inst];
  const micStand = (X, Y, sc) => { cv.line([X(0), Y(-6)], [X(0), Y(76)], 3.5 * sc, hex('#2a2a2e')); cv.ellipse(X(0), Y(-6), 14 * sc, 3 * sc, hex('#2a2a2e')); cv.rrect(X(-5.5), Y(90), 11 * sc, 15 * sc, 5 * sc, dark); cv.rrect(X(-4), Y(88.5), 8 * sc, 12 * sc, 4 * sc, hex('#55555b')); };
  if (inst === 'baton') cv.rect(x - 36 * s, y - 12 * s, 72 * s, 26 * s, hex('#5a3b22'));
  return bot(cv, x, y, s, who, {
    arms: ARMS[inst] || [12, -12], seated: SEATED.has(inst),
    behind: BEHIND.has(inst) ? (X, Y, sc) => prop(cv, X, Y, sc) : null,
    front: (X, Y, sc, hands) => {
      if (prop && !BEHIND.has(inst)) prop(cv, X, Y, sc);
      if (mic) micStand(X, Y, sc);
      (HANDS[inst] || []).forEach((k, i) => k && HAND[k](cv, hands[i], i ? 1 : -1, sc));
    },
  });
}

// The set dressing and lights (css/style.css `.club-stage.set-*`).
const SETS = {
  club: { wall: ['#231f29', '#26212d'], floor: '#1c1b1d', grid: '#8d5cff', lights: ['#8d5cff', '#ff453a', '#30d158'], riser: ['#3a3036', '#241e22', '#4d4249'] },
  hall: { wall: ['#2a1c16', '#2f2018'], floor: '#2c1d12', planks: '#3a2718', lights: ['#ffdca8', '#ffdca8', '#ffdca8'], riser: ['#5a3b22', '#3a2616', '#7a5434'], beam: 0.11 },
  barn: { wall: ['#3a291c', '#2b1e14'], floor: '#2c1d12', planks: '#3a2718', lights: ['#ffb04d', '#ff8a3d', '#ffe3a3'], riser: ['#5a3b22', '#3a2616', '#7a5434'] },
  arena: { wall: ['#141417', '#18181c'], floor: '#18181b', grid: '#ffffff', gridA: 0.05, lights: ['#ff453a', '#ffffff', '#0a84ff'], riser: ['#3a3036', '#241e22', '#4d4249'] },
  lounge: { wall: ['#261d29', '#2a2030'], floor: '#1d1719', planks: '#2a1e1e', lights: ['#bf5af2', '#ff9f0a', '#ff375f'], riser: ['#3a3036', '#241e22', '#4d4249'] },
};
const STAGE = 440, FLOOR = 470;

function backdrop(cv, set, r) {
  const S = SETS[set] || SETS.club;
  cv.rect(0, 0, W, FLOOR, (x, y) => mix(hex(S.wall[1]), hex(S.wall[0]), y / FLOOR));
  if (set === 'barn') for (let y = 0; y < FLOOR; y += 28) cv.rect(0, y + 26, W, 2, hex(S.wall[1]));
  else for (let x = 0; x < W; x += W * (set === 'hall' ? 0.08 : 0.12)) cv.rect(x, 0, 3, FLOOR, set === 'hall' ? hex('#e8c27a') : [255, 255, 255], set === 'hall' ? 0.05 : 0.025);
  cv.rect(0, FLOOR, W, H - FLOOR, hex(S.floor));
  if (S.planks) for (let x = 0; x < W; x += W * 0.06) cv.rect(x, FLOOR, W * 0.058, H - FLOOR, hex(S.planks));
  if (S.grid) {
    const g = hex(S.grid), a = S.gridA ?? 0.09;
    for (let i = -10; i <= 10; i++) cv.line([W / 2 + i * 60, FLOOR], [W / 2 + i * 150, H], 2, g, a);
    for (let k = 1; k < 6; k++) { const y = FLOOR + (H - FLOOR) * (k / 6) ** 1.6; cv.rect(0, y, W, 2, g, a); }
  }
  // Light cones from the rig.
  S.lights.forEach((c, i) => {
    const cx = [W * 0.16, W * 0.5, W * 0.84][i] + (r() - 0.5) * 80, spread = 190 + r() * 60, lean = (r() - 0.5) * 220;
    cv.poly([[cx - 18, -10], [cx + 18, -10], [cx + lean + spread, FLOOR + 40], [cx + lean - spread, FLOOR + 40]], (x, y) => hex(c), S.beam ?? (i === 1 ? 0.1 : 0.14));
  });
  if (set === 'hall') {
    for (const left of [true, false]) {
      const x0 = left ? 0 : W * 0.91, w = W * 0.09;
      const edge = (y) => (y > FLOOR - 120 ? ((y - (FLOOR - 120)) / 120) ** 2 * w * 0.6 : 0);
      const pts = left ? [[0, 0], [w, 0], ...Array.from({ length: 13 }, (_, i) => { const y = (FLOOR - 40) * (i / 12); return [w - edge(y), y]; }), [0, FLOOR - 40]]
        : [[x0, 0], [W, 0], [W, FLOOR - 40], ...Array.from({ length: 13 }, (_, i) => { const y = (FLOOR - 40) * (1 - i / 12); return [x0 + edge(y), y]; })];
      cv.poly(pts, (x) => mix(hex('#4a1014'), hex('#7a1d22'), 0.5 + 0.5 * Math.sin((x / 20) * Math.PI * 2)));
    }
    cv.rect(0, 0, W, 10, hex('#4a1014'));
    for (let x = 22; x < W; x += 44) cv.ellipse(x, 6, 22, 22, hex('#7a1d22'), 1);
  }
  if (set === 'barn') for (const [y0, off] of [[44, 0], [94, 19]]) {
    cv.line([40, y0], [W / 2, y0 + 22], 1.5, hex('#5b4a38')); cv.line([W / 2, y0 + 22], [W - 40, y0], 1.5, hex('#5b4a38'));
    for (let x = 60 + off; x < W - 50; x += 38) { const y = y0 + 22 * (1 - Math.abs(x - W / 2) / (W / 2 - 40)) + 4; cv.glow(x, y, 16, 16, hex('#ffbe5a'), 0.6); cv.ellipse(x, y, 3.5, 3.5, hex('#ffd68a')); }
  }
  if (set === 'barn') for (const [x, y, w] of [[W * 0.84, STAGE - 46, 150], [W * 0.86, STAGE - 92, 110]]) { cv.rrect(x, y, w, 46, 4, dark); cv.rect(x + 2, y + 2, w - 4, 42, (xx, yy) => ((yy | 0) % 8 < 6 ? hex('#b38a3a') : hex('#9c7631'))); }
  if (set === 'arena') {
    cv.rect(36, 30, W - 72, 14, hex('#3b3a40'));
    for (let x = 40; x < W - 40; x += 12) cv.line([x, 32], [x + 8, 42], 2, hex('#55545c'));
    for (const x of [40, W - 40 - 96]) { cv.rect(x, STAGE - 150, 96, 150, hex('#2e2d33')); cv.rect(x + 3, STAGE - 147, 90, 144, hex('#161618')); cv.rect(x + 3, STAGE - 147, 90, 26, hex('#222126')); }
  }
  if (set === 'lounge') for (const x of [W * 0.08, W * 0.92]) { cv.rect(x - 2, STAGE - 140, 4, 140, hex('#3a3238')); cv.glow(x, STAGE - 150, 90, 70, hex('#ffb45c'), 0.4); cv.poly([[x - 12, STAGE - 164], [x + 12, STAGE - 164], [x + 22, STAGE - 136], [x - 22, STAGE - 136]], hex('#e9b872')); }
}

function riser(cv, set, x0 = W * 0.08, x1 = W * 0.92) {
  const [top, bottom, lip] = (SETS[set] || SETS.club).riser.map(hex);
  cv.rect(x0, STAGE, x1 - x0, 30, (x, y) => mix(top, bottom, (y - STAGE) / 30));
  cv.rect(x0, STAGE, x1 - x0, 3, lip);
  cv.rect(x0, STAGE + 30, x1 - x0, 26, [0, 0, 0], 0.35);
}

function booth(cv, cx) {
  const w = 400, h = 104, x = cx - w / 2, y = STAGE - 64;
  cv.poly([[x - 6, y], [x + w + 6, y], [x + w, y + h], [x, y + h]], hex('#3b3546'));
  cv.poly([[x - 4, y + 2], [x + w + 4, y + 2], [x + w - 2, y + h - 2], [x + 2, y + h - 2]], (xx, yy) => mix(hex('#393741'), hex('#201f23'), (yy - y) / h));
  for (const dx of [70, w - 70]) { cv.ellipse(x + dx, y + h / 2, 32, 32, hex('#534d5b')); cv.ellipse(x + dx, y + h / 2, 29, 29, hex('#29272d')); cv.ellipse(x + dx, y + h / 2, 17, 17, hex('#3a3640')); }
  const label = 'UNTERGRUND';
  cv.text(label, cx - textW(label, 3) / 2, y + h / 2 - 10, 3, GREEN);
  cv.glow(cx, y + h / 2, 120, 30, GREEN, 0.12);
}

function nameTag(cv, name, cx, y) {
  const t = pixelText(name).slice(0, 18);
  if (!t) return;
  const w = textW(t, 3) + 20;
  cv.rect(cx - w / 2, y - 30, w, 30, GREEN);
  cv.text(t, cx - textW(t, 3) / 2, y - 25, 3, hex('#1b1c1b'));
}

// The "LIVE IN THIS ROOM" card from the Club header, plus where it is.
function card(cv, { title, line, label }) {
  const one = wrapText(title || 'Live set', 14, 1)[0], fits = pixelText(title || 'Live set').length <= 14;
  const size = fits ? 6 : 5, lines = fits ? [one] : wrapText(title || 'Live set', 17, 2), lh = size * 7 + 12;
  const tw = Math.max(...lines.map((l) => textW(l, size)), textW(label, 3), textW(line, 3));
  const x = 40, y = 28, w = tw + 50, h = 20 + 21 + 14 + lines.length * lh + 21 + 18;
  cv.rect(x, y, w, h, hex('#19191b'), 0.86);
  cv.rect(x, y, 6, h, GREEN);
  cv.text(label, x + 26, y + 20, 3, GREEN);
  lines.forEach((l, i) => cv.text(l, x + 26, y + 55 + i * lh, size, hex('#f4f1ea')));
  cv.text(line, x + 26, y + 55 + lines.length * lh, 3, hex('#a09ba8'));
}

export function clubImage(snap, roomId = '') {
  const set = snap?.currentSet || {};
  const members = Array.isArray(snap?.members) ? snap.members : [];
  const host = members.find((m) => m.id === snap?.hostId) || members[0] || { name: set.artist };
  const scene = stageScene(set.style, set.state);
  const r = rng([...`${roomId}:${set.broadcastId || set.title}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7));
  const cv = canvas();
  backdrop(cv, scene.set, r);
  riser(cv, scene.set);
  const lead = look(host);
  const mapX = (p) => W * 0.1 + (p / 100) * W * 0.8, k = 1.42;
  let headY;
  if (scene.kind === 'dj') {
    cv.glow(W / 2, STAGE - 150, 300, 220, GREEN, 0.08);
    headY = performer(cv, W / 2, STAGE - 20, 1.75, lead, 'dj').head.t;
    booth(cv, W / 2);
  } else {
    const layout = ensembleLayout(scene);
    const order = scene.players.map((inst, i) => ({ inst, p: layout.players[i], i })).sort((a, b) => a.p.z - b.p.z);
    for (const { inst, p, i } of order) {
      const who = look({ shape: SHAPES[(i + 1) % SHAPES.length], color: COLORS[(i * 3 + 1) % COLORS.length], gear: GEAR[(i * 2) % GEAR.length] });
      performer(cv, mapX(p.x), STAGE + 10 - p.y * 0.9, p.s * k, who, inst, { mic: false });
    }
    const L = layout.lead;
    cv.glow(mapX(L.x), STAGE - 120, 240, 200, scene.set === 'hall' ? hex('#ffdca8') : GREEN, 0.1);
    headY = performer(cv, mapX(L.x), STAGE + 14 - L.y * 0.9, L.s * k, lead, scene.lead, { mic: scene.mic }).head.t;
    nameTag(cv, lead.name || set.artist, mapX(L.x), headY - 14);
  }
  if (scene.kind === 'dj') nameTag(cv, lead.name || set.artist, W / 2, headY - 14);

  // The crowd: everyone in the room in their own look up front, ambient silhouettes behind (createStage update()).
  const crowd = members.filter((m) => m !== host).map((m) => look(m));
  const slots = crowdSlots();
  const ambient = Array.from({ length: Math.max(0, 14 - crowd.length) }, (_, i) => look({ shape: SHAPES[i % SHAPES.length], color: COLORS[(i + 2) % COLORS.length], gear: GEAR[i % GEAR.length] }, true));
  const ROWS = [{ y: 790, s: 1.55 }, { y: 712, s: 1.22 }, { y: 648, s: 0.98 }];
  const people = [...crowd, ...ambient].slice(0, slots.length).map((who, i) => ({ who, slot: slots[i], i }));
  const seated = scene.crowd === 'seated';
  for (const row of [2, 1, 0]) {
    const R = ROWS[row];
    for (const { who, slot, i } of people.filter((p) => p.slot.row === row).sort((a, b) => Math.abs(b.slot.x - 50) - Math.abs(a.slot.x - 50))) {
      const hype = !seated && !who.dim && i % 2 === 0;
      bot(cv, (slot.x / 100) * W, R.y, R.s, who, { arms: hype ? [150, -150] : [14, -14] });
    }
    if (seated) for (let x = 0; x < W; x += 168) cv.rrect(x + 8 - (row % 2) * 84, R.y - 64 * R.s, 152, 70 * R.s, 6, hex('#1a1412'));
  }

  const listeners = members.length;
  const meta = [set.artist || lead.name, set.bpm && `${Math.round(set.bpm)} BPM`, set.key].filter(Boolean).join(' · ');
  card(cv, { title: set.title, line: pixelText(meta).slice(0, 34), label: `LIVE IN THIS ROOM · ${listeners} HERE` });
  const brand = 'UNTERGRUND CLUB', where = pixelText(`/R/${roomId}`).slice(0, 26);
  const bw = Math.max(textW(brand, 3), textW(where, 3)) + 28;
  cv.rect(W - 40 - bw, 34, bw, 62, hex('#19191b'), 0.84);
  cv.text(brand, W - 40 - bw + 14, 46, 3, hex('#f4f1ea'));
  cv.text(where, W - 40 - bw + 14, 70, 3, GREEN);

  // Quantise with a little grain so gradients don't band.
  const rgb = Buffer.alloc(W * H * 3), grain = Float32Array.from({ length: 64 * 64 }, () => (r() - 0.5) * 6);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3, n = grain[(y & 63) * 64 + (x & 63)];
    for (let c = 0; c < 3; c++) rgb[o + c] = Math.max(0, Math.min(255, cv.px[o + c] + n));
  }
  return encodePng(rgb, W, H);
}
