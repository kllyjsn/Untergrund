// Song timeline model: the chain string (one letter A–H per bar) as a list of sections.
// Pure functions only, so the arrangement view, tests and saved/shared projects all agree.
export const LETTERS = 'ABCDEFGH';
export const MAX_BARS = 128;
export const COLORS = ['#6f9bff', '#3ad6c6', '#ff3b3b', '#ff9340', '#b892ff', '#e83cff', '#ff4d86', '#f2ff3a'];
const ROLES = {
  club: ['INTRO', 'BUILD', 'DROP', 'FILL', 'BREAK', 'BREAK', 'DROP', 'FILL'],
  groove: ['INTRO', 'BUILD', 'VERSE', 'FILL', 'BRIDGE', 'BRIDGE', 'HOOK', 'HOOK'],
};
const QUIET = new Set([0, 1]);

const clean = (chain) => String(chain || '').toUpperCase().replace(/[^A-H]/g, '').slice(0, MAX_BARS);
const copy = (sections) => sections.map((s) => ({ p: s.p, bars: s.bars }));

// 'AABCCC' → [{p:0,bars:2},{p:1,bars:1},{p:2,bars:3}]
export function toSections(chain) {
  const out = [];
  for (const ch of clean(chain)) {
    const p = ch.charCodeAt(0) - 65, last = out[out.length - 1];
    if (last && last.p === p) last.bars++;
    else out.push({ p, bars: 1 });
  }
  return out;
}

export function toChain(sections) {
  return sections.map((s) => LETTERS[s.p].repeat(Math.max(1, s.bars | 0))).join('').slice(0, MAX_BARS);
}

export const totalBars = (sections) => sections.reduce((n, s) => n + s.bars, 0);
export const starts = (sections) => { let at = 0; return sections.map((s) => { const a = at; at += s.bars; return a; }); };

// Which section a bar of the (looping) song falls in.
export function locate(sections, bar) {
  const n = totalBars(sections);
  if (!n) return { index: -1, offset: 0 };
  let b = ((Math.floor(bar) % n) + n) % n;
  for (let i = 0; i < sections.length; i++) {
    if (b < sections[i].bars) return { index: i, offset: b };
    b -= sections[i].bars;
  }
  return { index: sections.length - 1, offset: 0 };
}

// Default names come from the role arrangement() gives each pattern slot; quiet patterns after the
// song has opened up are the outro. Custom labels (per pattern letter) win.
export function sectionNames(sections, kind = 'club', labels = {}) {
  const roles = ROLES[kind] || ROLES.club;
  let tail = sections.length;
  while (tail > 0 && QUIET.has(sections[tail - 1].p)) tail--;
  const opened = sections.slice(0, tail).some((s) => !QUIET.has(s.p));
  return sections.map((s, i) => labels?.[LETTERS[s.p]] || (opened && i >= tail && i > 0 ? 'OUTRO' : roles[s.p]));
}

export function cleanLabel(v) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().toUpperCase().slice(0, 16);
}

export function cleanLabels(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  for (const k of LETTERS) { const t = cleanLabel(v[k]); if (t) out[k] = t; }
  return Object.keys(out).length ? out : null;
}

// ---- edits: each returns a new section list and never exceeds MAX_BARS in total.
const room = (sections, i) => MAX_BARS - (totalBars(sections) - (sections[i]?.bars || 0));

export function move(sections, from, to) {
  const out = copy(sections);
  if (from < 0 || from >= out.length) return out;
  const [s] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, s);
  return out;
}

export function resize(sections, i, bars) {
  const out = copy(sections);
  if (!out[i]) return out;
  out[i].bars = Math.max(1, Math.min(room(sections, i), Math.round(bars) || 1));
  return out;
}

export function duplicate(sections, i) {
  const out = copy(sections);
  if (!out[i]) return out;
  const bars = Math.min(out[i].bars, MAX_BARS - totalBars(out));
  if (bars > 0) out.splice(i + 1, 0, { p: out[i].p, bars });
  return out;
}

export function remove(sections, i) {
  const out = copy(sections);
  if (out.length > 1 && out[i]) out.splice(i, 1);
  return out;
}

export function setPattern(sections, i, p) {
  const out = copy(sections);
  if (out[i] && p >= 0 && p < LETTERS.length) out[i].p = p | 0;
  return out;
}

export function append(sections, p, bars = 4) {
  const out = copy(sections);
  const n = Math.min(bars, MAX_BARS - totalBars(out));
  if (n > 0) out.push({ p, bars: n });
  return out;
}

// Insertion slot for a dragged section whose centre sits at `bar` (in bars from the song start).
export function dropIndex(sections, from, bar) {
  const rest = sections.filter((_, k) => k !== from);
  let at = 0, k = 0;
  for (; k < rest.length; k++) {
    if (bar < at + rest[k].bars / 2) break;
    at += rest[k].bars;
  }
  return k;
}

// Section loop: how many bars to skip forward (always ahead, so the transport clock stays monotonic)
// when the song is about to leave sections [first..last]. chainPos is the bar about to start.
export function loopSkip(sections, loop, chainPos) {
  const n = totalBars(sections);
  if (!loop || !n || !sections[loop.first] || !sections[loop.last]) return 0;
  const from = starts(sections)[loop.first], to = starts(sections)[loop.last] + sections[loop.last].bars;
  const pos = ((chainPos % n) + n) % n;
  return pos >= from && pos < to ? 0 : (from - pos + n) % n;
}
