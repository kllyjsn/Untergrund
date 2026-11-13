// EXPORT MIDI: plays the song through the real Sequencer into a recorder instead of the audio engine,
// so every pocket, swing and humanize offset and every velocity lands in the file as played.
import { Engine, Sequencer, parseChain } from './engine.js';
import { CHORDS, KEYS, SCALES } from './params.js';
import { compose } from './classical.js';
import { PIECE } from './repertoire.js';

export const PPQ = 480;
const hash = (n, k) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

// GM drum map (channel 10) and GM programs, so a DAW opens the file on sensible instruments.
export const GM_DRUMS = { kick: 36, clap: 39, snare: 38, ch: 42, oh: 46, ride: 51, perc: 63 };
const DRUM_NAMES = { kick: 'Kick', clap: 'Clap', snare: 'Snare', ch: 'Hats', oh: 'Open Hat', ride: 'Ride', perc: 'Perc' };
const STAB_PROGRAM = [81, 4, 89, 16, 61, 45, 14, 0, 25, 61, 48];
export const PARTS = {
  vln1: ['Violin I', 40], vln2: ['Violin II', 40], vla: ['Viola', 41], vc: ['Cello', 42], cb: ['Contrabass', 43],
  fl: ['Flute', 73], ob: ['Oboe', 68], cl: ['Clarinet', 71], hn: ['Horn', 60], tpt: ['Trumpet', 56],
  harp: ['Harp', 46], timp: ['Timpani', 47], pno: ['Piano', 0],
};

const clampVel = (v) => Math.max(1, Math.min(127, Math.round(v * 127)));
const vlq = (n) => { const b = [n & 127]; while ((n >>= 7)) b.unshift((n & 127) | 128); return b; };
const text = (s) => [...new TextEncoder().encode(s)];
const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];

// Bars the whole song lasts: the score, the chain, or the given loop length.
export function songBars(state, loopBars = 16) {
  const score = state.patterns.find((p) => p.score)?.score;
  if (score) { const sc = compose(score); return Math.max(1, Math.round(sc.at.length / (sc.barLen || 16))); }
  const chain = state.chainOn ? parseChain(state.chain) : [];
  return chain.length || loopBars;
}

// Key signature meta: sharps (+) / flats (-) and minor flag.
const MAJOR_SF = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
export function keySignature(pc, minor) { return { sf: MAJOR_SF[(((minor ? pc + 3 : pc) % 12) + 12) % 12], mi: minor ? 1 : 0 }; }
export function parseKeyName(name = '') {
  const m = /^([A-Ga-g])\s*(-?\s*(?:flat|sharp)|[#b♭♯])?\s*(major|minor)?/i.exec(name.trim());
  if (!m) return null;
  let pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  const acc = (m[2] || '').toLowerCase();
  if (/flat|b|♭/.test(acc)) pc -= 1; else if (/sharp|#|♯/.test(acc)) pc += 1;
  return { pc: (pc + 12) % 12, minor: /minor/i.test(m[3] || '') };
}

// Records what the Sequencer asks the engine to play. Pitch helpers are borrowed from the real Engine.
class Recorder {
  constructor(state) { this.state = state; this.notes = {}; this.harm = null; this.stepScale = 1; this.noteVel = 1; this.bass = null; }
  get stepDur() { return (60 / this.state.bpm / 4) * (this.stepScale || 1); }
  add(track, t, m, dur, v) { (this.notes[track] ||= []).push({ t, m, dur: Math.max(0.01, dur), v }); }
  chord() { const p = this.state.params.stab, h = this.harm; return CHORDS[h ? h.c : Math.round(p.chord)].iv; }
  dust() {} sweep() {} impact() {} breakSweep() {} breakOpen() {}
  crash(t, v) { this.add('oh', t, 49, this.stepDur * 4, v); }
  tom(t, v, high) { this.add('snare', t, high ? 48 : 45, this.stepDur, v); }
  acidRelease(t) { if (this.bass) { this.bass.dur = Math.max(0.01, Math.min(this.bass.dur, t - this.bass.t)); this.bass = null; } }
  trigger(id, t, v) {
    if (id === 'stab') {
      const p = this.state.params.stab, root = 48 + this.state.key + Math.round(p.octave) * 12 + this.harmRoot();
      const len = Math.max(this.stepDur * 2, (p.decay || 0.3) * 1.5);
      for (const n of this.chord()) this.add('stab', t, root + n, len, v);
    } else if (GM_DRUMS[id]) this.add(id, t, GM_DRUMS[id], this.stepDur, v);
  }
  vox(t, v, step) {
    const p = this.state.params.vox, notes = SCALES[this.state.scale]?.notes || SCALES.minor.notes;
    const degree = hash(step, 3) < p.melody ? notes[Math.floor(hash(step, 4) * notes.length)] : 0;
    this.add('vox', t, 60 + Math.round(p.pitch) + degree, Math.max(0.03, p.length * this.stepDur), v);
  }
  lick(t, v, k) {
    const p = this.state.params.stab, iv = this.chord(), n = iv[k % iv.length] + 12 * Math.floor(k / iv.length);
    this.add('stab', t, 60 + this.state.key + Math.round(p.octave) * 12 + this.harmRoot() + n, this.stepDur * 2, v);
  }
  hook(t, v, n, dur, voice, oct = 0, strong = false, b = 1, up = false) {
    const h = this.harm;
    if (strong || up) {
      const tones = this.chord().map((x) => ((((h ? h.r : 0) + x) % 12) + 12) % 12), pc = ((n % 12) + 12) % 12;
      const d = up ? [1, 2, 3, 4, 5].find((x) => tones.includes((pc + x) % 12)) : [0, -1, 1, -2, 2].find((x) => tones.includes((pc + x + 12) % 12));
      n += d ?? 0;
    }
    const k = this.state.key > 6 ? this.state.key - 12 : this.state.key;
    this.add('hook', t, 60 + k + oct * 12 + n, dur * 0.92, v);
  }
  acid(t, st, sliding, holdNext, sd) {
    const p = this.state.params.acid, vo = Math.round(p.voice);
    this.acidRelease(t);
    const len = holdNext ? sd * 2 : vo === 0 ? sd * 0.55 : st.ap ? sd * 0.9 : sd * (0.9 + p.decay * 2);
    this.add('acid', t, this.bassMidi(st), len, (st.a ? 1 : 0.82) * (this.noteVel ?? 1));
    this.bass = this.notes.acid.at(-1);
  }
  orch(part, t, m, dur, vel) { this.add(part, t, m, dur, vel); }
}
Recorder.prototype.harmRoot = Engine.prototype.harmRoot;
Recorder.prototype.bassMidi = Engine.prototype.bassMidi;

// Plays the full arrangement (or score) into note lists, plus the timeline needed to place them in ticks.
export function capture(state, loopBars = 16) {
  const s = JSON.parse(JSON.stringify(state));
  s.solos = {};
  const score = s.patterns.find((p) => p.score)?.score, sc = score ? compose(score) : null;
  const barLen = sc?.barLen || 16, bars = songBars(s, loopBars), steps = bars * barLen;
  const rec = new Recorder(s), seq = new Sequencer(rec, s), at = [], dur = [], chords = [];
  for (let abs = 0, t = 0; abs < steps; abs++) {
    at.push(t);
    seq.tick(abs, t);
    if (!sc && abs % 16 === 0) {
      const h = rec.harm, c = CHORDS[h ? h.c : Math.round(s.params.stab.chord)];
      chords.push({ t, name: KEYS[(((s.key + (h ? h.r : 0)) % 12) + 12) % 12] + ' ' + c.name });
    }
    dur.push(rec.stepDur);
    t += rec.stepDur;
  }
  let key;
  if (score?.piece) key = parseKeyName(PIECE[score.piece]?.key) || { pc: 0, minor: false };
  else if (score) key = { pc: s.key, minor: score.mode === 'm' };
  else key = { pc: s.key, minor: s.scale !== 'major' };
  // A bar of n 16ths: 4/4, 3/4, 2/4 ... or n/2 eighths (6/8, 12/8) when it isn't a whole number of beats.
  const timeSig = barLen % 4 === 0 && barLen !== 24 ? [barLen / 4, 4] : [barLen / 2, 8];
  return { state: s, score, sc, notes: rec.notes, at, dur, chords, bars, barLen, key, timeSig };
}

// Seconds -> ticks through the step timeline: each 16th step is PPQ/4 ticks, a score's rubato becomes tempo changes.
function ticker(at, dur) {
  const q = PPQ / 4;
  return (t) => {
    if (t <= 0) return 0;
    let lo = 0, hi = at.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (at[mid] <= t) lo = mid; else hi = mid - 1; }
    return Math.max(0, Math.round(lo * q + ((t - at[lo]) / dur[lo]) * q));
  };
}

function trackChunk(events) {
  // events: [tick, order, bytes]; note-offs sort before note-ons on the same tick.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  let last = 0;
  for (const [tick, , bytes] of events) { out.push(...vlq(tick - last), ...bytes); last = tick; }
  out.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, (out.length >>> 24) & 255, (out.length >>> 16) & 255, (out.length >>> 8) & 255, out.length & 255, ...out];
}

// Standard MIDI File, type 1: a conductor track (tempo, metre, key, chord markers) then one track per instrument.
export function writeMidi({ title = 'UNTERGRUND', tempos, timeSig = [4, 4], key, markers = [], tracks }) {
  const cond = [[0, 0, meta(0x03, text(title))]];
  for (const [tick, bpm] of tempos) { const us = Math.round(60e6 / bpm); cond.push([tick, 1, meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255])]); }
  cond.push([0, 2, meta(0x58, [timeSig[0], Math.log2(timeSig[1]), 24, 8])]);
  if (key) cond.push([0, 3, meta(0x59, [key.sf & 255, key.mi])]);
  for (const [tick, name] of markers) cond.push([tick, 4, meta(0x06, text(name))]);
  const chunks = [trackChunk(cond)];
  for (const tr of tracks) {
    const ch = tr.channel, ev = [[0, 0, meta(0x03, text(tr.name))]];
    if (tr.program != null) ev.push([0, 1, [0xc0 | ch, tr.program]]);
    // A note can't overlap itself on one channel: a repeated pitch ends the previous one.
    const notes = [...tr.notes].sort((a, b) => a.on - b.on), open = new Map();
    for (const n of notes) {
      const prev = open.get(n.m);
      if (prev && prev.off > n.on) prev.off = n.on;
      open.set(n.m, n);
    }
    for (const n of notes) {
      const off = Math.max(n.on + 1, n.off);
      ev.push([n.on, 3, [0x90 | ch, n.m, n.vel]], [off, 2, [0x80 | ch, n.m, 0]]);
    }
    chunks.push(trackChunk(ev));
  }
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (chunks.length >> 8) & 255, chunks.length & 255, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array([...head, ...chunks.flat()]);
}

// The whole song (or score) as a .mid; also returns per-track note counts.
export function songMidi(state, { loopBars = 16, title } = {}) {
  const c = capture(state, loopBars), tick = ticker(c.at, c.dur), s = c.state;
  const order = c.score ? Object.keys(PARTS) : [...Object.keys(GM_DRUMS), 'acid', 'stab', 'hook', 'vox'];
  let chan = 0;
  const tracks = [];
  for (const id of order) {
    const notes = c.notes[id];
    if (!notes?.length) continue;
    const drum = !c.score && GM_DRUMS[id] != null;
    const channel = drum ? 9 : chan === 9 ? ++chan : chan;
    if (!drum) chan = Math.min(15, channel + 1);
    const name = c.score ? PARTS[id][0] : drum ? DRUM_NAMES[id] : { acid: 'Bass', stab: 'Chords', hook: 'Hook', vox: 'Vocals' }[id];
    const program = c.score ? PARTS[id][1] : drum ? null : { acid: Math.round(s.params.acid.voice) === 1 ? 33 : 38, stab: STAB_PROGRAM[Math.round(s.params.stab.voice)] ?? 4, hook: 80, vox: 54 }[id];
    // Two hits of one pitch on the same tick (a lick doubling a chord tone) are one note, at the louder velocity.
    const seen = new Map(), out = [];
    for (const n of notes) {
      const x = { on: tick(n.t), off: tick(n.t + n.dur), m: Math.max(0, Math.min(127, Math.round(n.m))), vel: clampVel(n.v) }, k = x.on * 128 + x.m, prev = seen.get(k);
      if (prev) { prev.vel = Math.max(prev.vel, x.vel); prev.off = Math.max(prev.off, x.off); continue; }
      seen.set(k, x); out.push(x);
    }
    tracks.push({ id, name, channel, program, notes: out });
  }
  const base = s.bpm, tempos = [[0, base]];
  if (c.score) {
    let lastBpm = base;
    c.dur.forEach((d, i) => { const bpm = Math.round((60 / (d * 4)) * 1000) / 1000; if (i && Math.abs(bpm - lastBpm) > 0.01) { tempos.push([i * (PPQ / 4), bpm]); lastBpm = bpm; } });
    tempos[0][1] = Math.round((60 / (c.dur[0] * 4)) * 1000) / 1000;
  }
  const markers = c.score ? (c.sc.sections || []).map((x) => [x.at * c.barLen * (PPQ / 4), x.name]) : c.chords.map((x) => [tick(x.t), x.name]);
  const bytes = writeMidi({ title: title || s.artist?.title || 'UNTERGRUND', tempos, timeSig: c.timeSig, key: keySignature(c.key.pc, c.key.minor), markers, tracks });
  return { bytes, tracks: tracks.map((t) => ({ id: t.id, name: t.name, channel: t.channel, notes: t.notes.length })), bars: c.bars, key: c.key };
}

