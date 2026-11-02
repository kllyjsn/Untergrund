// CLASSICAL: a composer, not a loop. Each piece is a whole movement written as a score (positions in
// 16th-note steps) with functional harmony, periods that close on half and perfect cadences, a motif
// that is stated, sequenced and developed, voice-led accompaniment, and orchestration that changes by section.
import { rng } from './dsp.js';
import { pieceScore, waitingScore } from './repertoire.js';

const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };
const mod = (x, n) => ((x % n) + n) % n;
const pick = (r, a) => a[Math.floor(r() * a.length)];

// Orchestra sections the mixer manages; every part belongs to one.
export const SECTIONS = ['strings', 'winds', 'brass', 'harp', 'timpani', 'piano'];
export const PART_SECTION = {
  vln1: 'strings', vln2: 'strings', vla: 'strings', vc: 'strings', cb: 'strings',
  fl: 'winds', ob: 'winds', cl: 'winds', hn: 'brass', tpt: 'brass', harp: 'harp', timp: 'timpani', pno: 'piano',
};
export const FORMS = {
  symphony: { name: 'SYMPHONY', bpm: [104, 120], tag: 'sonata-form allegro · full orchestra' },
  concerto: { name: 'PIANO CONCERTO', bpm: [100, 112], tag: 'piano soloist · orchestra' },
  nocturne: { name: 'NOCTURNE', bpm: [60, 72], tag: 'solo piano · cantabile' },
};

// Roman numerals in a key: 'I', 'ii6', 'I64', 'V7', 'viio7', 'V7/V'. Minor keys raise the leading tone in V and vii°.
export function chord(sym, key) {
  const [main, sec] = sym.split('/');
  let k = key;
  if (sec) {
    const sc = key.m === 'M' ? MAJ : MIN;
    k = { t: mod(key.t + sc[ROMAN[sec.toLowerCase()] - 1], 12), m: 'M' };
  }
  const [, num, dim, sev, inv] = /^([iIvV]+)(o?)(7?)(64|6)?$/.exec(main);
  const d = ROMAN[num.toLowerCase()], sc = k.m === 'M' ? MAJ : MIN;
  const raise = k.m === 'm' && (d === 5 || (d === 7 && dim));
  const rel = [0, 2, 4, 6].slice(0, sev ? 4 : 3).map((j) => { const x = sc[(d - 1 + j) % 7]; return raise && x === 10 ? 11 : x; });
  const pcs = rel.map((x) => mod(x + k.t, 12));
  const home = new Set((key.m === 'M' ? MAJ : MIN).map((x) => mod(x + key.t, 12)));
  if (key.m === 'm') home.add(mod(key.t + 11, 12));
  // Chromatic chord tones pull the melody's diatonic note onto them (F -> F# over V7/V).
  const alt = {};
  pcs.forEach((pc, j) => {
    if (!j || home.has(pc)) return;
    if (j < 3 && home.has(mod(pc - 1, 12))) alt[mod(pc - 1, 12)] = pc;
    else if (home.has(mod(pc + 1, 12))) alt[mod(pc + 1, 12)] = pc;
  });
  return { sym, pcs, root: pcs[0], bass: pcs[inv === '64' ? 2 : inv === '6' ? 1 : 0], dom: d === 5 || !!sec, d, alt, key };
}

// 'I | IV | ii6 V | V' -> bars of [chord, start, length]
function prog(str, key) {
  return str.split('|').map((bar) => {
    const cs = bar.trim().split(/\s+/), len = 16 / cs.length;
    return cs.map((c, j) => [chord(c, key), j * len, len]);
  });
}
const chordAt = (bar, s) => { let c = bar[0][0]; for (const [ch, st] of bar) if (s >= st) c = ch; return c; };

const OPEN = ['I | IV', 'I | V6', 'I V6 | vi IV', 'I | ii6 V7', 'I IV | V7 I', 'I | vi'];
const HALF = ['IV ii6 | V', 'ii6 V7/V | V', 'vi I64 | V', 'IV I64 | V'];
const PERFECT = ['IV V7 | I', 'ii6 V7 | I', 'I64 V7 | I', 'vi ii6 | V7 I'];
const LIVELY = [[4, 4, 4, 4], [6, 2, 4, 4], [4, 2, 2, 4, 4], [2, 2, 4, 8], [8, 4, 4], [4, 4, 8], [3, 1, 4, 4, 4], [2, 2, 2, 2, 4, 4]];
const LYRIC = [[8, 4, 4], [6, 2, 8], [12, 4], [4, 8, 4], [6, 2, 4, 4], [4, 4, 8], [8, 8]];
const HC_END = [[12, -4], [8, -8], [4, 4, 8]], PAC_END = [[12, -4], [8, -8], [16]];

function contour(r, n, rise) {
  const out = []; let dir = rise ? 1 : -1, last = 0;
  for (let k = 0; k < n; k++) {
    if (Math.abs(last) >= 3) { out.push((last = -Math.sign(last))); continue; }
    if (r() < 0.25) dir = -dir;
    const x = r(), size = x < 0.08 ? 0 : x < 0.66 ? 1 : x < 0.88 ? 2 : x < 0.96 ? 3 : 4;
    out.push((last = size * dir));
  }
  return out;
}
const motifBar = (r, pool, rise) => { const rh = pick(r, pool); return { rh, ct: contour(r, rh.filter((d) => d > 0).length, rise) }; };

// A melodic line in diatonic steps; strong beats land on chord tones, leaps land on chord tones,
// cadences resolve: 2 or 7 before the tonic, 2/5/7 on a half cadence.
function line(bars, key, plan, { start = 0, lo = 60, hi = 84, base = 60 } = {}) {
  const sc = key.m === 'M' ? MAJ : MIN;
  const midi = (idx, ch) => {
    let m = base + key.t + sc[mod(idx, 7)] + 12 * Math.floor(idx / 7);
    if (key.m === 'm' && ch.dom && (mod(idx, 7) === 6 || mod(idx, 7) === 5)) m += 1;
    const pc = mod(m, 12);
    if (ch.alt[pc] != null) m += mod(ch.alt[pc] - pc + 6, 12) - 6;
    return m;
  };
  const isCT = (idx, ch) => ch.pcs.includes(mod(midi(idx, ch), 12));
  const snap = (idx, ch, pref, ok = () => true) => {
    for (const d of [0, pref, -pref, 2 * pref, -2 * pref, 3 * pref, -3 * pref]) if (isCT(idx + d, ch) && ok(idx + d)) return idx + d;
    return idx;
  };
  const out = []; let p = start, first = true;
  plan.forEach(({ rh, ct, end }, b) => {
    let s = 0, k = 0;
    const notes = rh.filter((d) => d > 0).length;
    rh.forEach((d) => {
      if (d < 0) { s -= d; return; }
      const ch = chordAt(bars[b], s), nth = k++;
      let idx = first ? start : p + (ct[nth] ?? 0);
      if (midi(idx, ch) > hi || midi(idx, ch) < lo) idx = p - (ct[nth] ?? 0);
      const strong = s % 8 === 0 || d >= 8, pref = idx >= p ? 1 : -1;
      if (end === 'pac' && nth === notes - 1) idx = snap(Math.round((p) / 7) * 7, ch, 1, (i) => mod(i, 7) === 0);
      else if (end === 'hc' && nth === notes - 1) idx = snap(p, ch, pref, (i) => [1, 4, 6].includes(mod(i, 7)));
      else if (end === 'lead' && nth === notes - 1) idx = snap(p, ch, pref, (i) => [1, 6].includes(mod(i, 7)));
      else if (strong || Math.abs(idx - p) > 1) idx = snap(idx, ch, pref);
      while (midi(idx, ch) > hi) idx -= 7;
      while (midi(idx, ch) < lo) idx += 7;
      out.push({ b, s, d, m: midi(idx, ch), strong });
      p = idx; first = false; s += d;
    });
  });
  return { notes: out, last: p };
}

// 8-bar parallel period: antecedent ends on V, consequent repeats the opening and closes on I.
function period(r, key, { lyrical = false, start } = {}) {
  const pool = lyrical ? LYRIC : LIVELY;
  const open = pick(r, OPEN), half = pick(r, HALF), perf = pick(r, PERFECT);
  const bars = [...prog(`${open} | ${half}`, key), ...prog(`${open} | ${perf}`, key)];
  const a = motifBar(r, pool, true), b = motifBar(r, pool, r() < 0.5), c = motifBar(r, pool, false);
  const lead = { ...motifBar(r, pool, false), end: 'lead' };
  const plan = [a, b, a, { rh: pick(r, HC_END), ct: [-1, -1, 1], end: 'hc' }, a, b, perf.startsWith('vi') ? c : { ...c, end: 'lead' }, { rh: pick(r, PAC_END), ct: [-1, 1, -1], end: 'pac' }];
  if (perf.startsWith('vi')) plan[6] = lead;
  return { bars, plan, motif: a, start: start ?? pick(r, [0, 2, 4, 7]) };
}

// Upper-voice chord with the smallest total motion from the previous one; sevenths drop the fifth.
function voicing(ch, prev, lo, hi, n = 3) {
  const need = ch.pcs.length === 4 ? [ch.pcs[0], ch.pcs[1], ch.pcs[3]] : ch.pcs.slice(0, 3);
  if (n === 4) need.push(ch.pcs.length === 4 ? ch.pcs[2] : ch.pcs[0]);
  const opts = need.map((pc) => { const o = []; for (let m = lo; m <= hi; m++) if (mod(m, 12) === pc) o.push(m); return o; });
  let best = null, cost = Infinity;
  const rec = (k, acc) => {
    if (k === need.length) {
      const v = [...acc].sort((x, y) => x - y);
      if (new Set(v).size < v.length || v[v.length - 1] - v[0] > (n === 4 ? 24 : 16)) return;
      const c = prev ? v.reduce((a, m, i) => a + Math.abs(m - prev[i]), 0) : Math.abs(v.reduce((a, m) => a + m, 0) / v.length - (lo + hi) / 2);
      if (c < cost) { cost = c; best = v; }
      return;
    }
    for (const m of opts[k]) rec(k + 1, [...acc, m]);
  };
  rec(0, []);
  return best || need.map((pc) => lo + mod(pc - lo, 12));
}
function bassOf(ch, prev, lo, hi) {
  let best = lo, c = Infinity;
  for (let m = lo; m <= hi; m++) if (mod(m, 12) === ch.bass) { const d = Math.abs(m - (prev ?? (lo + hi) / 2 - 3)); if (d < c) { c = d; best = m; } }
  return best;
}

class Score {
  constructor() { this.notes = []; this.sections = []; this.bar = 0; this.v = {}; }
  add(bar, s, m, d, vel, part) { this.notes.push([bar * 16 + s, m, d, Math.max(0.05, Math.min(1, vel)), part]); }
  section(name, len, key) { this.sections.push({ name, at: this.bar, len, key }); }
  // texture helpers operate on bars starting at this.bar
  each(bars, fn) { bars.forEach((bar, b) => bar.forEach(([ch, s, d]) => fn(this.bar + b, ch, s, d, b))); }
  melody(l, part, vel, { oct = 0, arch = true } = {}) {
    for (const n of l.notes) {
      const phrase = (n.b % 4) / 3, shape = arch ? 0.9 + 0.14 * Math.sin(Math.PI * Math.min(1, phrase * 1.2)) : 1;
      this.add(this.bar + n.b, n.s, n.m + oct, n.d * 0.95, vel * shape * (n.strong ? 1.06 : 0.94), part);
    }
  }
  sustain(bars, vel, parts = ['vln2', 'vla'], lo = 55, hi = 76) {
    this.each(bars, (bar, ch, s, d) => {
      const v = (this.v.str = voicing(ch, this.v.str, lo, hi));
      this.add(bar, s, v[2], d, vel, parts[0]); this.add(bar, s, v[1], d, vel * 0.92, parts[0]); this.add(bar, s, v[0], d, vel * 0.9, parts[1]);
    });
  }
  pulse(bars, vel, parts = ['vln2', 'vla']) {
    this.each(bars, (bar, ch, s, d) => {
      const v = (this.v.str = voicing(ch, this.v.str, 55, 74));
      for (let x = s; x < s + d; x += 2) {
        const acc = x % 4 === 0 ? 1 : 0.8;
        this.add(bar, x, v[2], 1.6, vel * acc, parts[0]); this.add(bar, x, v[1], 1.6, vel * acc * 0.9, parts[0]); this.add(bar, x, v[0], 1.6, vel * acc * 0.9, parts[1]);
      }
    });
  }
  bass(bars, vel, { cb = true, walk = false } = {}) {
    this.each(bars, (bar, ch, s, d) => {
      const m = (this.v.bass = bassOf(ch, this.v.bass, 36, 52));
      if (walk) for (let x = s; x < s + d; x += 4) this.add(bar, x, m, 3.2, vel * (x % 8 ? 0.85 : 1), 'vc');
      else this.add(bar, s, m, d, vel, 'vc');
      if (cb) this.add(bar, s, m - 12 >= 28 ? m - 12 : m, walk ? Math.min(d, 8) : d, vel * 0.9, 'cb');
    });
  }
  horns(bars, vel) {
    this.each(bars, (bar, ch, s, d) => { const v = (this.v.hn = voicing(ch, this.v.hn, 48, 65)); this.add(bar, s, v[0], d, vel, 'hn'); this.add(bar, s, v[2], d, vel * 0.9, 'hn'); });
  }
  winds(bars, vel) {
    this.each(bars, (bar, ch, s, d) => { const v = (this.v.ww = voicing(ch, this.v.ww, 62, 81)); this.add(bar, s, v[2], d, vel, 'fl'); this.add(bar, s, v[1], d, vel, 'ob'); this.add(bar, s, v[0], d, vel, 'cl'); });
  }
  tutti(bars, vel, hits = [0, 4, 8, 12]) {
    this.each(bars, (bar, ch, s, d) => {
      const v = (this.v.tp = voicing(ch, this.v.tp, 60, 76));
      for (const x of hits) if (x >= s && x < s + d) {
        this.add(bar, x, v[2], 1.8, vel, 'tpt'); this.add(bar, x, v[1], 1.8, vel * 0.9, 'tpt');
        if (x === 0) this.timp(bar, x, ch, vel);
      }
    });
  }
  timp(bar, s, ch, vel, roll = 0) {
    const pc = ch.root, home = mod(this.home, 12);
    if (pc !== home && pc !== mod(home + 7, 12)) return;
    this.add(bar, s, 40 + mod(pc - 40, 12), roll || 2, vel, 'timp');
  }
  alberti(bars, vel, part = 'pno') {
    this.each(bars, (bar, ch, s, d) => {
      const v = (this.v.lh = voicing(ch, this.v.lh, 48, 67));
      const b = bassOf(ch, this.v.lb, 36, 50); this.v.lb = b;
      this.add(bar, s, b, d, vel * 1.05, part);
      for (let x = s, k = 0; x < s + d; x += 2, k++) this.add(bar, x, v[[0, 2, 1, 2][k % 4]], 2.4, vel * (k % 4 ? 0.72 : 0.85), part);
    });
  }
  nocturne(bars, vel, part = 'pno') {
    this.each(bars, (bar, ch, s, d) => {
      const b = (this.v.lb = bassOf(ch, this.v.lb, 33, 47)), up = [];
      for (let m = b + 7; up.length < 5 && m < b + 30; m++) if (ch.pcs.includes(mod(m, 12)) && m - b >= 7) up.push(m);
      const seq = [b, up[0], up[1], up[2], up[3] ?? up[2], up[2], up[1], up[0]];
      const n = d / 2;
      for (let k = 0; k < n; k++) this.add(bar, s + k * 2, seq[Math.floor((k * 8) / n)], d - k * 2, vel * (k ? 0.62 - 0.03 * (k % 4) : 1), part);
    });
  }
  harp(bars, vel) {
    this.each(bars, (bar, ch, s, d) => {
      const up = []; for (let m = 50; up.length < 8 && m < 92; m++) if (ch.pcs.includes(mod(m, 12))) up.push(m);
      for (let k = 0; k < Math.min(8, d); k++) this.add(bar, s + k, up[k], 6, vel * (0.75 + 0.03 * k), 'harp');
    });
  }
  guide(bars, vel, part, lo, hi) {
    this.each(bars, (bar, ch, s, d) => {
      if (d < 8 && s % 8) return;
      const tones = [ch.pcs[1], ch.pcs[3] ?? ch.pcs[1]];
      const key = 'guide:' + part;
      let best = this.v[key] ?? Math.round((lo + hi) / 2), c = Infinity, prev = best;
      for (let m = lo; m <= hi; m++) if (tones.includes(mod(m, 12)) && Math.abs(m - prev) < c) { c = Math.abs(m - prev); best = m; }
      this.v[key] = best; this.add(bar, s, best, d, vel, part);
    });
  }
  run(bar, key, from, to, vel, parts) {
    const sc = key.m === 'M' ? MAJ : MIN;
    for (let k = 0; k < 16; k++) {
      const idx = from + Math.round(((to - from) * k) / 15);
      const m = 60 + key.t + sc[mod(idx, 7)] + 12 * Math.floor(idx / 7) + (key.m === 'm' && mod(idx, 7) >= 5 ? 1 : 0);
      for (const p of parts) this.add(bar, k, m + (p === 'fl' ? 12 : 0), 1, vel * (0.7 + 0.3 * k / 15), p);
    }
  }
  next(n) { this.bar += n; }
}

function development(S, r, motif, devKey, home, vel, { soloist = false } = {}) {
  const seqStr = devKey.m === 'm' ? 'i | iv | VII | III | VI | iio | V | i' : 'vi | ii | V | I | IV | viio | iii | vi';
  const bars = prog(seqStr, devKey);
  S.section('DEVELOPMENT', 12, devKey);
  const voices = soloist ? [['ob', 64, 86], ['vln1', 62, 86], ['cl', 55, 79], ['fl', 67, 91]] : [['vln1', 62, 88], ['vc', 43, 64], ['fl', 67, 91], ['vla', 52, 72]];
  for (let k = 0; k < 8; k++) {
    const [part, lo, hi] = voices[k % 4];
    const l = line([bars[k]], devKey, [motif], { start: 2 + (k % 3), lo, hi, base: lo < 55 ? 48 : 60 });
    const at = S.bar;
    S.bar = at + k; S.melody(l, part, vel * (0.85 + 0.03 * k), { arch: false }); S.bar = at;
  }
  if (soloist) S.alberti(bars, vel * 0.7); else S.pulse(bars, vel * 0.7);
  S.bass(bars, vel * 0.8, { walk: true });
  S.horns(bars.slice(4), vel * 0.6);
  S.next(8);
  // Retransition: dominant pedal, timpani roll, a rising run into the recapitulation.
  const re = prog('ii6 | I64 | V | V7', home);
  S.sustain(re, vel * 0.85); S.horns(re, vel * 0.7);
  S.each(re, (bar, ch, s, d) => { const m = bassOf(chord('V', home), 40, 36, 50); for (let x = s; x < s + d; x += 2) S.add(bar, x, m, 1.6, vel * (0.7 + 0.06 * (bar - S.bar)), 'vc'); S.add(bar, s, m - 12, d, vel * 0.8, 'cb'); });
  S.timp(S.bar + 2, 0, chord('V', home), vel * 0.8, 32);
  S.winds(re.slice(0, 2), vel * 0.55);
  S.run(S.bar + 3, home, 4, 11, vel * 1.05, soloist ? ['pno'] : ['vln1', 'fl']);
  S.next(4);
}

function coda(S, home, vel, { piano = false } = {}) {
  const bars = prog('I | IV | I64 | V7 | I | I', home);
  S.section('CODA', 7, home);
  S.sustain(bars, vel); S.bass(bars, vel, { walk: true }); S.horns(bars, vel * 0.85); S.winds(bars, vel * 0.7);
  S.tutti(bars.slice(0, 4), vel);
  if (piano) S.alberti(bars.slice(0, 4), vel * 0.85);
  const fin = chord('I', home), v = voicing(fin, null, 60, 84, 4);
  for (const [b, s, dd] of [[S.bar + 4, 0, 3], [S.bar + 4, 4, 3], [S.bar + 4, 8, 3]]) {
    for (const m of v) S.add(b, s, m, dd, vel, 'vln1');
    S.add(b, s, 40 + mod(fin.root - 40, 12), dd, vel, 'timp');
    S.add(b, s, v[3], dd, vel * 0.95, 'tpt');
  }
  const end = S.bar + 5;
  for (const m of v) { S.add(end, 0, m, 22, vel, 'vln1'); S.add(end, 0, m, 22, vel * 0.7, 'fl'); }
  S.add(end, 0, bassOf(fin, 40, 36, 50), 22, vel, 'vc'); S.add(end, 0, bassOf(fin, 40, 36, 50) - 12, 22, vel, 'cb');
  for (const m of voicing(fin, null, 48, 64)) S.add(end, 0, m, 22, vel * 0.8, 'hn');
  S.add(end, 0, 40 + mod(fin.root - 40, 12), 22, vel * 0.9, 'timp');
  if (piano) for (const m of [...voicing(fin, null, 60, 84, 4), bassOf(fin, 40, 28, 40)]) S.add(end, 0, m, 22, vel, 'pno');
  S.next(7);
}

function sonata(r, mode, soloist) {
  const S = new Score(), home = { t: 0, m: mode }; S.home = 0;
  const K2 = mode === 'M' ? { t: 7, m: 'M' } : { t: 3, m: 'M' };
  const devKey = mode === 'M' ? { t: 9, m: 'm' } : { t: 0, m: 'm' };
  const A = period(r, home), B = period(r, K2, { lyrical: true });
  // Introduction: soft sustained strings, horn pedal, timpani roll swelling into the theme.
  const intro = prog('I | ii6 | I64 | V7', home);
  S.section('INTRODUCTION', 4, home);
  S.sustain(intro, 0.38); S.bass(intro, 0.4); S.horns(intro, 0.3);
  S.melody(line(intro, home, [{ rh: [8, 8], ct: [0, 1] }, { rh: [8, 8], ct: [1, -1] }, { rh: [6, 2, 8], ct: [1, 1, -1] }, { rh: [16], ct: [-1], end: 'hc' }], { start: 4, lo: 64, hi: 88 }), 'ob', 0.42);
  S.timp(S.bar + 3, 0, chord('V', home), 0.5, 16);
  if (soloist) S.nocturne(intro.slice(2), 0.4);
  S.next(4);
  // Exposition: first theme in the tonic, a modulating transition, the second theme in the new key.
  const themeA = line(A.bars, home, A.plan, { start: A.start, lo: 62, hi: 86 });
  S.section('THEME A', 8, home);
  if (soloist) {
    S.melody({ notes: themeA.notes.filter((n) => n.b < 4) }, 'vln1', 0.72);
    S.melody({ notes: themeA.notes.filter((n) => n.b >= 4) }, 'pno', 0.78, { oct: 12 });
    S.pulse(A.bars.slice(0, 4), 0.5); S.bass(A.bars.slice(0, 4), 0.62); S.horns(A.bars.slice(0, 4), 0.42);
    S.bar += 4; S.alberti(A.bars.slice(4), 0.5); S.sustain(A.bars.slice(4), 0.32); S.bass(A.bars.slice(4), 0.45, { cb: false }); S.bar -= 4;
  } else {
    S.melody(themeA, 'vln1', 0.76);
    S.melody({ notes: themeA.notes.filter((n) => n.b >= 4) }, 'fl', 0.55, { oct: 12 });
    S.pulse(A.bars, 0.52); S.bass(A.bars, 0.66, { walk: true }); S.horns(A.bars, 0.42);
    S.tutti([A.bars[7]], 0.68, [0]);
  }
  S.next(8);
  const trans = [...prog('I | vi', home), ...prog('ii6 V | V7', K2)];
  S.section('TRANSITION', 4, K2);
  S.pulse(trans, 0.62); S.bass(trans, 0.7, { walk: true }); S.horns(trans, 0.55); S.tutti(trans.slice(0, 2), 0.7, [0, 8]);
  S.run(S.bar + 3, K2, -3, 4, 0.7, soloist ? ['pno'] : ['vln1']);
  S.next(4);
  const themeB = line(B.bars, K2, B.plan, { start: B.start, lo: 62, hi: 84 });
  S.section('THEME B', 8, K2);
  S.melody(themeB, soloist ? 'pno' : 'ob', 0.6, { oct: soloist ? 12 : 0 });
  if (!soloist) S.melody({ notes: themeB.notes.filter((n) => n.b >= 4) }, 'cl', 0.45, { oct: -12 });
  S.sustain(B.bars, 0.36); S.bass(B.bars, 0.45); S.guide(B.bars, 0.38, 'vc', 48, 62);
  if (soloist) S.nocturne(B.bars, 0.42); else S.harp(B.bars, 0.42);
  S.next(8);
  const close = prog('I IV | I64 V7 | I | I', K2);
  S.section('CLOSING', 4, K2);
  S.sustain(close, 0.6); S.bass(close, 0.68, { walk: true }); S.horns(close, 0.58); S.winds(close, 0.45); S.tutti(close, 0.72, [0, 8]);
  S.melody(line(close, K2, [A.motif, { rh: [4, 4, 8], ct: [-1, -1, -1], end: 'lead' }, { rh: [12, -4], ct: [-1], end: 'pac' }, { rh: [-16], ct: [] }], { start: 4, lo: 62, hi: 86 }), soloist ? 'pno' : 'vln1', 0.74, { oct: soloist ? 12 : 0 });
  S.next(4);
  development(S, r, A.motif, devKey, home, 0.62, { soloist });
  // Recapitulation: both themes return in the tonic, now with the full orchestra.
  S.section('RECAPITULATION', 8, home);
  S.melody(themeA, 'vln1', 0.86); S.melody(themeA, 'fl', 0.62, { oct: 12 });
  if (soloist) S.alberti(A.bars, 0.6); else S.melody({ notes: themeA.notes.filter((n) => n.strong) }, 'tpt', 0.5);
  S.pulse(A.bars, 0.62); S.bass(A.bars, 0.76, { walk: true }); S.horns(A.bars, 0.6); S.tutti([A.bars[3], A.bars[7]], 0.8, [0]);
  S.next(8);
  const Bh = { ...B, bars: B.bars.map((bar) => bar.map(([ch, s, d]) => [chord(ch.sym, home), s, d])) };
  const themeB2 = line(Bh.bars, home, B.plan, { start: B.start, lo: 62, hi: 86 });
  S.section('THEME B (TONIC)', 8, home);
  S.melody(themeB2, soloist ? 'pno' : 'vln1', 0.66, { oct: soloist ? 12 : 0 });
  S.melody(themeB2, soloist ? 'vln1' : 'cl', 0.42, { oct: -12 });
  S.sustain(Bh.bars, 0.42); S.bass(Bh.bars, 0.5); S.guide(Bh.bars, 0.4, 'hn', 50, 65); S.harp(Bh.bars, 0.36);
  S.next(8);
  coda(S, home, 0.9, { piano: soloist });
  return S;
}

function nocturne(r, mode) {
  const S = new Score(), home = { t: 0, m: mode }; S.home = 0;
  const K2 = mode === 'M' ? { t: 9, m: 'm' } : { t: 3, m: 'M' };
  const A = period(r, home, { lyrical: true }), B = period(r, K2, { lyrical: true });
  const lA = line(A.bars, home, A.plan, { start: A.start, lo: 64, hi: 88, base: 72 });
  S.section('THEME', 8, home); S.melody(lA, 'pno', 0.62); S.nocturne(A.bars, 0.4); S.next(8);
  // Second statement: the melody sings an octave higher, with turns around the long notes.
  S.section('THEME (ORNAMENTED)', 8, home);
  const orn = { notes: lA.notes.flatMap((n) => (n.d >= 8 && n.s % 8 === 0 ? [{ ...n, d: 1, m: n.m + 2, strong: false }, { ...n, s: n.s + 1, d: 1, m: n.m, strong: false }, { ...n, s: n.s + 2, d: n.d - 2 }] : [n])) };
  S.melody(orn, 'pno', 0.68); S.nocturne(A.bars, 0.44); S.next(8);
  const lB = line(B.bars, K2, B.plan, { start: B.start, lo: 60, hi: 84, base: 72 });
  S.section('MIDDLE SECTION', 8, K2); S.melody(lB, 'pno', 0.7); S.nocturne(B.bars, 0.48); S.next(8);
  const back = prog('ii6 | I64 | V | V7', home);
  S.section('RETURN', 4, home); S.nocturne(back, 0.36);
  S.melody(line(back, home, [{ rh: [8, 4, 4], ct: [1, -1, -1] }, { rh: [8, 8], ct: [1, -1] }, { rh: [4, 4, 4, 4], ct: [1, 1, 1, 1] }, { rh: [12, -4], ct: [1], end: 'hc' }], { start: 4, lo: 64, hi: 91, base: 72 }), 'pno', 0.5);
  S.next(4);
  S.section('THEME (RETURN)', 8, home); S.melody(lA, 'pno', 0.58); S.nocturne(A.bars, 0.38); S.next(8);
  const cod = prog('I | IV64 | I | I', home);
  S.section('CODA', 5, home); S.nocturne(cod.slice(0, 2), 0.3);
  const fin = chord('I', home);
  for (const m of [...voicing(fin, null, 64, 88, 4), bassOf(fin, 40, 33, 45)]) S.add(S.bar + 2, 0, m, 28, 0.42, 'pno');
  S.next(5);
  return S;
}

// Step-length multipliers. Each 4-bar phrase presses forward a little and broadens into its cadence;
// the bar before a new section takes time, and the last bars slow into the final chord.
function tempoMap(bars, sections, depth) {
  const t = new Array(bars * 16).fill(1), ends = new Set(sections.map((x) => x.at - 1));
  for (let i = 0; i < t.length; i++) {
    const bar = Math.floor(i / 16), ph = ((bar % 4) * 16 + (i % 16)) / 64, d = depth * (0.6 + 0.8 * (Math.sin(Math.floor(bar / 4) * 91.7) * 0.5 + 0.5));
    let m = 1 - 0.025 * d * Math.sin(Math.PI * ph * 1.6) + (ph > 0.85 ? 0.05 * d * (ph - 0.85) / 0.15 : 0);
    if (ends.has(bar) && i % 16 >= 8) m += 0.06 * depth * ((i % 16) - 7) / 8;
    t[i] = m;
  }
  const rit = (bars - 3) * 16;
  for (let i = rit; i < t.length; i++) t[i] *= 1 + 0.7 * ((i - rit) / (t.length - rit)) ** 1.6;
  return t;
}

const cache = new Map();
// { bars, sections, at: notes grouped by the step they start in }
// A REPERTOIRE spec { piece } returns that masterwork as performed (or a silent bar while it loads).
export function compose(spec = {}) {
  if (spec.piece) return pieceScore(spec.piece) || waitingScore();
  const { form = 'symphony', seed = 1, mode = 'M' } = spec;
  const id = `${form}:${seed}:${mode}`;
  if (cache.has(id)) return cache.get(id);
  const r = rng(seed | 0);
  const S = form === 'nocturne' ? nocturne(r, mode) : sonata(r, mode, form === 'concerto');
  const bars = S.bar + 1, at = Array.from({ length: bars * 16 }, () => []);
  S.notes.sort((a, b) => a[0] - b[0]);
  // Played, not quantised: downbeats lean, offbeats lighten, and the tempo breathes (see tempoMap).
  for (const n of S.notes) {
    const p = n[0] % 16;
    n[3] = Math.max(0.05, Math.min(1, n[3] * (p === 0 ? 1.06 : p === 8 ? 1.02 : p % 4 ? 0.93 : 0.99)));
    at[Math.min(at.length - 1, Math.floor(n[0]))].push(n);
  }
  const tempo = tempoMap(bars, S.sections, form === 'nocturne' ? 2 : 1.6);
  const out = { bars, sections: S.sections, notes: S.notes, at, tempo };
  cache.set(id, out);
  return out;
}
