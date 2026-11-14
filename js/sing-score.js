// The singer's score (docs/singer.md): the melody the song actually sings, bar by bar through the arrangement, with
// the lyric syllables laid on its syllable slots, in the format of the self-hosted neural singer (Scylla's Band v4,
// singer/). One pass of the chain, from bar 1: the returned stem starts on the song's first downbeat.
import { Sequencer, parseChain } from './engine.js';
import { Recorder } from './midi.js';
import { lineSlots, lyricTimeline } from './lyrics.js';

export const SING_FORMAT = 'untergrund-sing/1';
// Scylla's Band v4 built-in voices (spybyscript/scyllasband, voices.json). No other voice can be asked for.
export const SING_VOICES = ['ariadne', 'felix', 'gwen', 'ink', 'kincade', 'max', 'orpheus', 'poppy', 'priya', 'rex', 'scylla', 'stone', 'thistle', 'tuesday'];
export const VOCAL_VOICE = { female: 'gwen', male: 'felix', duet: 'gwen', choir: 'priya' };
export const SING_FORMATS = ['opus', 'mp3', 'wav'];
// Expression knobs the singer applies to the score (singer/expression.py has the same names and ranges; docs/singer.md
// #expression says what each does): [lowest, highest].
export const SING_EXPR = {
  scoop: [0, 3], scoop_ms: [20, 250], glide_ms: [0, 150], vib_cents: [0, 80], vib_rate: [3.5, 8], vib_delay: [0, 1], vib_ramp: [0.05, 1.5],
  breath: [0, 40], lead: [0, 1], stress_db: [0, 4], stress_vowel: [0, 0.6], guidance: [1, 2], align: [0, 1],
};
export function cleanExpr(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(SING_EXPR)) {
    const v = typeof raw[k] === 'boolean' && k === 'align' ? +raw[k] : raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = k === 'align' ? +!!v : Math.round(Math.min(hi, Math.max(lo, v)) * 1e4) / 1e4;
  }
  return Object.keys(out).length ? out : null;
}
// Per genre: the voice for a female or male lead and the expression (picked by singer/voice_survey.py; docs/singer.md).
const EXPR_BASE = { scoop: 1, scoop_ms: 90, glide_ms: 60, vib_cents: 30, vib_rate: 5.5, vib_delay: 0.3, vib_ramp: 0.4, breath: 22, lead: 0.5, stress_db: 1.5, stress_vowel: 0.3, align: 1 };
export const SING_STYLE = {
  pop: { female: 'gwen', male: 'felix', expr: { ...EXPR_BASE } },
  rnb: { female: 'gwen', male: 'felix', expr: { ...EXPR_BASE, scoop: 1.5, scoop_ms: 120, glide_ms: 90, vib_cents: 35, vib_rate: 5.2 } },
  folk: { female: 'gwen', male: 'felix', expr: { ...EXPR_BASE, scoop: 0.6, glide_ms: 40, vib_cents: 22, vib_rate: 5.0, vib_delay: 0.35, breath: 20 } },
};
const styleSing = (style) => SING_STYLE[style] || SING_STYLE.pop;
export const SING_LIMITS = { notes: 1500, beats: 1600, seconds: 420, text: 4000, label: 40, bpm: [40, 240], midi: [36, 91], seed: 2 ** 31 - 1 };
// Gaps shorter than this inside a line are sung through (legato); longer ones are rests (a breath).
const LEGATO = 1;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const BALLAD = new Set(['folk', 'country', 'soul', 'gospel', 'ballad', 'lofi', 'ambient']);
// The singer's two sung deliveries: pop for most songs, ballad for slow and acoustic ones.
export const deliveryFor = (style, bpm) => (BALLAD.has(style) || bpm < 84 ? 'ballad' : 'pop');
const word = (w) => String(w).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');
const hash = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return x >>> 0; };
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// Every note the Sequencer sings in one pass of the chain, as the engine plays it (section registers, pickups into
// the next section, key lifts and chord snaps), with its part, phrase and syllable slot. at/dur in 16th steps.
export function sungNotes(state) {
  const s = JSON.parse(JSON.stringify(state));
  s.solos = {}; s.mutes = { ...s.mutes, stab: false };
  const chain = s.chainOn ? parseChain(s.chain) : [];
  if (!chain.length || !s.patterns?.some((p) => p.hook?.m)) return [];
  const rec = new Recorder(s), seq = new Sequencer(rec, s), out = [], hook = rec.hook.bind(rec), sing = seq.sing.bind(seq);
  let now = null, abs = 0;
  seq.sing = (sung, i16, ...a) => {
    now = sung.notes.filter((o) => o.at === i16 && !(seq.dropNext && i16 >= 8 && !o.pickup));
    sing(sung, i16, ...a);
    now = null;
  };
  rec.hook = (...a) => {
    hook(...a);
    if (!now?.length || a[9]?.harm) return;
    const o = now.shift(), m = rec.notes.hook.at(-1).m;
    out.push({ at: abs, dur: o.x[1], midi: m, q: o.q, ph: o.x[4], slot: o.x[5], cycle: abs - o.x[0], pickup: !!o.pickup });
  };
  for (; abs < chain.length * 16 && !seq.finished; abs++) seq.tick(abs, abs * rec.stepDur);
  return out;
}

// The lyric section each bar sings: songs with section patterns (verse/pre/chorus/bridge) by their sections, the
// way lyricTimeline() pairs them (the nth verse sings the nth written verse, every chorus the last chorus), others by
// lyricTimeline() itself. One entry per bar: { s, block } or null.
export function lyricBars(state, { kind = 'club' } = {}) {
  const written = state.lyrics?.sections || [], chain = parseChain(state.chain);
  if (!written.length || !chain.length) return [];
  if (!state.patterns.some((p) => p.sec)) {
    let block = -1, prev = null;
    return lyricTimeline(state.chain, state.lyrics, { kind, labels: state.labels || {} }).map((x) => {
      if (!x) { prev = null; return null; }
      if (x.s !== prev) { block++; prev = x.s; }
      return { s: x.s, block };
    });
  }
  const used = {}, out = [];
  let role = null, s = null, block = -1;
  chain.forEach((p) => {
    const sec = state.patterns[p]?.sec || null;
    // Patterns without a section (fills, builds) carry on the section before them.
    if (sec && sec !== role) {
      role = sec; block++;
      const mine = written.map((w, j) => (w.sec === sec ? j : -1)).filter((j) => j >= 0), k = used[sec] || 0;
      used[sec] = k + 1;
      s = sec === 'chorus' ? mine[Math.min(k, mine.length - 1)] : mine[k];
    }
    out.push(s == null ? null : { s, block });
  });
  return out;
}

// One sung phrase: its notes, then its words laid on the slots. More syllables than slots: the longest notes split
// in two (same pitch) until the words fit, else the line ends on its last whole word that fits. Fewer: the last
// syllable holds over the remaining notes as a melisma, up to a gap of LEGATO steps, after which the notes rest.
function layWords(notes, text) {
  const syl = lineSlots(text).map((x, i, a) => ({ ...x, word: x.w + (i && a[i - 1].w > x.w ? 1e6 : 0) }));
  const slots = [];
  for (const n of notes) { const last = slots.at(-1); if (last && last.slot === n.slot) last.notes.push(n); else slots.push({ slot: n.slot, notes: [{ ...n }] }); }
  let need = syl.length - slots.length;
  while (need > 0) {
    let best = -1;
    slots.forEach((x, i) => { if (x.notes.length === 1 && x.notes[0].dur >= 2 && (best < 0 || x.notes[0].dur > slots[best].notes[0].dur)) best = i; });
    if (best < 0) break;
    const n = slots[best].notes[0], a = Math.ceil(n.dur / 2);
    slots.splice(best, 1, { notes: [{ ...n, dur: a }] }, { notes: [{ ...n, at: n.at + a, dur: n.dur - a }] });
    need--;
  }
  let use = syl;
  if (syl.length > slots.length) {
    const fit = syl.slice(0, slots.length), cut = fit.length < syl.length && syl[fit.length].w === fit.at(-1)?.w ? fit.at(-1).w : null;
    use = cut == null ? fit : fit.filter((x) => x.w !== cut);
  }
  const out = [];
  slots.forEach((x, i) => {
    if (i < use.length) return out.push({ syl: use[i], notes: x.notes });
    const prev = out.at(-1), end = prev && prev.notes.at(-1).at + prev.notes.at(-1).dur;
    if (prev && use.length && x.notes[0].at - end < LEGATO && prev.syl === use.at(-1)) prev.notes.push(...x.notes);
  });
  return { sung: out, dropped: syl.length - use.length };
}

// The score for a song, or null when it has nothing to sing (no sung melody, no chain or no lyrics).
export function singScore(state, { voice, seed, kind = 'club', format = 'opus' } = {}) {
  if (!state?.lyrics?.sections?.length) return null;
  const notes = sungNotes(state);
  if (!notes.length) return null;
  const bars = lyricBars(state, { kind }), nb = bars.length;
  const phrases = new Map();
  for (const n of notes) {
    const k = `${n.q}:${n.cycle}:${n.ph}`;
    if (!phrases.has(k)) phrases.set(k, { q: n.q, notes: [], bar: null });
    const p = phrases.get(k);
    p.notes.push(n);
    if (p.bar == null && !n.pickup) p.bar = Math.floor(n.at / 16);
  }
  // Lines of a lyric block go to its phrases in order; a block with more phrases than lines sings them again.
  const list = [...phrases.values()].filter((p) => p.bar != null && bars[p.bar % nb]).sort((a, b) => a.notes[0].at - b.notes[0].at);
  const byBlock = new Map();
  for (const p of list) { const b = bars[p.bar % nb]; p.s = b.s; (byBlock.get(b.block) || byBlock.set(b.block, []).get(b.block)).push(p); }
  for (const ps of byBlock.values()) {
    const lines = state.lyrics.sections[ps[0].s].lines, L = lines.length, P = ps.length;
    ps.forEach((p, i) => {
      const [a, b] = P <= L ? [Math.floor((i * L) / P), Math.floor(((i + 1) * L) / P)] : [i % L, (i % L) + 1];
      p.text = lines.slice(a, b).map((l) => l.t).join(' ');
    });
  }
  const swing = state.swing || 0, beat = (step) => (step + (step % 2 ? swing * 0.5 : 0)) / 4;
  const rows = [], words = [], meta = [];
  let cursor = 0;
  // A gap too short to be a rest (rounding) lengthens the note before it.
  const rest = (to) => {
    const gap = r4(to - cursor), last = rows.at(-1);
    if (gap <= 0) return;
    if (last && (last[0] === '-' || gap < 0.01)) last[2] = r4(last[2] + gap); else if (gap >= 0.01) rows.push(['-', 'rest', gap]);
    cursor = to;
  };
  for (const p of list) {
    const { sung, dropped } = layWords(p.notes, p.text || '');
    // A fragment that can't hold half its line is left to the instruments.
    if (!sung.length || dropped > sung.length) continue;
    const groups = [];
    for (const x of sung) {
      const g = groups.at(-1);
      if (g && g.w === x.syl.word) g.parts.push(...x.notes); else groups.push({ w: x.syl.word, text: lineSlots(p.text).filter((y) => y.w === x.syl.w), parts: [...x.notes] });
    }
    const sungWords = [];
    groups.forEach((g, gi) => {
      const label = word(g.text.map((y) => y.s).join('')).slice(0, SING_LIMITS.label) || 'la';
      g.parts.forEach((n, j) => {
        let start = beat(n.at), end = beat(n.at + n.dur);
        const nxt = g.parts[j + 1] || groups[gi + 1]?.parts[0];
        if (nxt) {
          const ns = beat(nxt.at), within = j + 1 < g.parts.length;
          if (within || ns - end < LEGATO / 4) end = ns;
          end = Math.min(end, ns);
        }
        if (start < cursor) start = cursor;
        if (end - start < 0.05) return;
        rest(start);
        rows.push([g.parts.length > 1 ? `${label}~${j + 1}` : label, noteName(n.midi), r4(end - start)]);
        cursor = start + r4(end - start);
      });
      // A word whose every part fell away is not in the text either.
      if (rows.length && rows.at(-1)[0].split('~')[0] === label) { words.push(label); sungWords.push(label); }
    });
    meta.push({ part: p.q, bar: p.bar, start: r4(beat(p.notes[0].at)), text: sungWords.join(' '), dropped });
  }
  if (!words.length) return null;
  // Melisma labels need unbroken numbering: renumber each run of parts of one word.
  for (let i = 0; i < rows.length; i++) {
    const [lab] = rows[i];
    if (!lab.includes('~')) continue;
    const base = lab.split('~')[0];
    let j = i;
    while (j < rows.length && rows[j][0].startsWith(base + '~') && (j === i || rows[j][0] !== `${base}~1`)) j++;
    if (j - i === 1) rows[i][0] = base;
    else for (let k = i; k < j; k++) rows[k][0] = `${base}~${k - i + 1}`;
    i = j - 1;
  }
  // Long instrumental stretches as rests of at most 32 beats; the text is the words the notes now spell.
  const notesOut = rows.flatMap((r) => { if (r[0] !== '-' || r[2] <= 32) return [r]; const k = Math.ceil(r[2] / 32); return Array.from({ length: k }, (_, i) => ['-', 'rest', i < k - 1 ? 32 : r4(r[2] - 32 * (k - 1))]); });
  const text = notesOut.filter(([l]) => l !== '-' && (!l.includes('~') || l.endsWith('~1'))).map(([l]) => l.split('~')[0]).join(' ');
  const style = state.artist?.style || '';
  const score = { text, bpm: state.bpm, style: deliveryFor(style, state.bpm), notes: notesOut };
  const ss = styleSing(style), gender = state.lyrics.vocal === 'male' ? 'male' : 'female';
  const v = SING_VOICES.includes(voice) ? voice : (['female', 'male'].includes(state.lyrics.vocal) ? ss[gender] : VOCAL_VOICE[state.lyrics.vocal]) || ss.female;
  const sd = Number.isInteger(seed) ? seed : hash(JSON.stringify(score) + v) % SING_LIMITS.seed;
  return { format: SING_FORMAT, voice: v, seed: sd, audio: SING_FORMATS.includes(format) ? format : 'opus', score, expr: cleanExpr(ss.expr), key: state.key, phrases: meta };
}

// Server-side check of a sing request (api/_lib/sing.js; singer/singer.py checks the same limits again).
export function validateSing(raw) {
  if (!raw || typeof raw !== 'object' || raw.format !== SING_FORMAT) return null;
  const { score } = raw, L = SING_LIMITS;
  if (!score || typeof score !== 'object' || !Array.isArray(score.notes)) return null;
  const bpm = +score.bpm;
  if (!(bpm >= L.bpm[0] && bpm <= L.bpm[1])) return null;
  if (!['pop', 'ballad'].includes(score.style)) return null;
  if (!score.notes.length || score.notes.length > L.notes) return null;
  if (typeof score.text !== 'string' || score.text.length > L.text) return null;
  let beats = 0;
  const words = [];
  for (const row of score.notes) {
    if (!Array.isArray(row) || row.length !== 3) return null;
    const [label, name, b] = row;
    if (typeof label !== 'string' || typeof name !== 'string' || !(typeof b === 'number' && b > 0 && b <= 64)) return null;
    beats += b;
    if (label === '-') { if (name !== 'rest') return null; continue; }
    if (!/^[a-z0-9']{1,40}(~[1-9][0-9]?)?$/.test(label) || !/^[A-G]#?-?[0-9]$/.test(name)) return null;
    const m = NAMES.indexOf(name.replace(/-?[0-9]$/, '')) + 12 * (parseInt(name.match(/-?[0-9]$/)[0], 10) + 1);
    if (m < L.midi[0] || m > L.midi[1]) return null;
    const [base, part] = label.split('~');
    if (!part || part === '1') words.push(base);
  }
  if (beats > L.beats || (beats * 60) / bpm > L.seconds || words.join(' ') !== score.text) return null;
  const voice = SING_VOICES.includes(raw.voice) ? raw.voice : null, seed = raw.seed;
  if (!voice || !Number.isInteger(seed) || seed < 0 || seed > L.seed) return null;
  const expr = cleanExpr(raw.expr);
  return { format: SING_FORMAT, voice, seed, audio: SING_FORMATS.includes(raw.audio) ? raw.audio : 'opus', score: { text: score.text, bpm, style: score.style, notes: score.notes.map((r) => [...r]) }, ...(expr && { expr }) };
}
