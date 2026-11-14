// The digital ear's training data: Jason's blind A/B picks (ear.html) and what each render measured.
// No DOM, so the page, scripts/ear.mjs and test/ear.mjs share it.
import { defaultState, generate, arrangement, applyOverrides, applySongPlan, MAJOR_STYLES } from './state.js';

// One-tap reasons, in Jason's own words from past feedback (research/taste/critiques.json). They describe the worse
// render (both, on SAME). A closed set: there is never a text box.
export const TAGS = [
  ['computer', 'computer-like'], ['metallic', 'metallic / clangy'], ['tune', 'out of tune'], ['static', 'static / noisy'],
  ['thin', 'thin / toy'], ['repetitive', 'repetitive'], ['groove', 'no groove'], ['emotion', 'no emotion'],
];
export const TAG_IDS = TAGS.map(([id]) => id);
export const PICKS = ['a', 'b', 'same'];
export const SCHEMA = 'untergrund.ear/1';

// The song GENERATE would write for this style and seed (js/main.js planSet, without the listener's project).
export function songFor(style, seed) {
  const s = defaultState();
  if (style === 'euphoric' || MAJOR_STYLES.has(style)) s.scale = 'major';
  const g = generate(style, seed, s.scale);
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  s.key = g.key;
  applyOverrides(s, g, true);
  s.chainOn = true;
  s.ending = true;
  if (g.pattern.score) s.bpm = g.bpm;
  applySongPlan(s, style, seed, 'song');
  s.artist = { name: 'UNTERGRUND', title: 'ear', style, seed, created: '' };
  return s;
}
// Rate the part a song is judged on: from the first chorus/drop (G), else a third of the way in.
export function windowOf(s, bars = 8) {
  const chain = s.chainOn ? s.chain.replace(/[^A-Z]/g, '') : '';
  const g = chain.indexOf('G');
  const startBar = g >= 0 ? g : Math.floor(chain.length / 3);
  return { startBar: Math.max(0, Math.min(startBar, Math.max(0, chain.length - bars))), bars };
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const side = (x) => x && Number.isInteger(x.seed) && Number.isInteger(x.startBar) && x.startBar >= 0 && Number.isInteger(x.bars) && x.bars > 0;

// A judgment is reproducible: style + seed + window + build re-renders the exact audio for offline features.
export function validJudgment(j) {
  if (!j || typeof j.id !== 'string' || !j.id || typeof j.style !== 'string' || !PICKS.includes(j.pick)) return false;
  if (!side(j.a) || !side(j.b) || typeof j.build !== 'string' || !finite(Date.parse(j.at))) return false;
  if (!Array.isArray(j.tags) || j.tags.some((t) => !TAG_IDS.includes(t))) return false;
  return true;
}

// Exports from several devices and days merge into one log: one row per id, later edits win, sorted by time.
export function mergeJudgments(...lists) {
  const byId = new Map();
  for (const list of lists) for (const j of list || []) if (validJudgment(j)) byId.set(j.id, j);
  return [...byId.values()].sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || x.id.localeCompare(y.id));
}

// The next pair goes to the style with the fewest picks so far (ties broken by `rand`), so every genre gets labels.
export function nextStyle(styles, judgments, rand = Math.random) {
  const count = Object.fromEntries(styles.map((s) => [s, 0]));
  for (const j of judgments) if (j.style in count) count[j.style]++;
  const least = Math.min(...Object.values(count)), pool = styles.filter((s) => count[s] === least);
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

// How often a measured feature already agrees with Jason: on decisive picks, the share where the winner had the
// higher value. 0.5 is a coin flip; far from 0.5 either way is signal (below means "lower wins").
export function featureAgreement(judgments, { min = 5 } = {}) {
  const tally = {};
  for (const j of judgments) {
    if (j.pick === 'same' || !j.metrics?.a || !j.metrics?.b) continue;
    const [win, lose] = j.pick === 'a' ? [j.metrics.a, j.metrics.b] : [j.metrics.b, j.metrics.a];
    for (const [k, v] of Object.entries(win)) {
      if (!finite(v) || !finite(lose[k]) || v === lose[k]) continue;
      const t = (tally[k] ||= { n: 0, higher: 0 });
      t.n++; if (v > lose[k]) t.higher++;
    }
  }
  return Object.entries(tally).filter(([, t]) => t.n >= min)
    .map(([feature, t]) => ({ feature, n: t.n, agreement: +(t.higher / t.n).toFixed(3), direction: t.higher * 2 >= t.n ? 'higher' : 'lower', strength: +Math.abs(t.higher / t.n - 0.5).toFixed(3) }))
    .sort((x, y) => y.strength - x.strength || y.n - x.n);
}

export function summarize(judgments) {
  const styles = {}, tags = Object.fromEntries(TAG_IDS.map((t) => [t, 0])), picks = { a: 0, b: 0, same: 0 };
  for (const j of judgments) {
    styles[j.style] = (styles[j.style] || 0) + 1;
    picks[j.pick]++;
    for (const t of j.tags) tags[t]++;
  }
  return { judgments: judgments.length, picks, styles, tags };
}

// Hearts, downs and down reasons from the player (docs/listen-signals.md) are labels too: absolute ones, on whole
// songs. The device id stays out of the public repo; only this short hash of it is kept.
export const DOWN_REASONS = ['boring', 'sounds_bad', 'not_my_style'];
export function deviceHash(lid) {
  let h = 0x811c9dc5;
  for (const c of `ear:${lid}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
const REACT = { love: 'love', down: 'down', unlove: null, undown: null };

// Raw listen records → one row per device and song: its latest reaction (love/down) and down reason.
// With `cleared`, songs whose heart/down was taken back are kept as reaction null, so a merge can drop them.
export function reactionsOf(signals, { devices, cleared = false } = {}) {
  const rows = new Map();
// The API lists newest first; reversing before the stable sort keeps same-millisecond switches (unlove, then down) in order.
  for (const r of [...signals].reverse().filter((r) => r?.lid && r.fp).sort((x, y) => (x.t || 0) - (y.t || 0))) {
    const dev = deviceHash(r.lid);
    if (devices && !devices.has(dev)) continue;
    const id = `${dev}:${r.fp}`, row = rows.get(id) || { id, dev, fp: r.fp, reaction: null, why: null };
    if (r.style) row.style = r.style;
    if (Number.isInteger(r.seed) && r.seed >= 0) row.seed = r.seed;
    if (r.src) row.src = r.src;
    if (r.kind in REACT) { row.reaction = REACT[r.kind]; if (r.kind !== 'down') row.why = null; row.at = r.at || new Date(r.t).toISOString(); }
    if (r.kind === 'why' && DOWN_REASONS.includes(r.why)) row.why = r.why;
    if (Number.isFinite(r.ms)) row.ms = Math.max(row.ms || 0, r.ms);
    if (Number.isFinite(r.pct)) row.pct = Math.max(row.pct ?? -1, r.pct);
    rows.set(id, row);
  }
  return [...rows.values()].filter((r) => r.at && (cleared || r.reaction));
}
export const validReaction = (r) => !!r && typeof r.id === 'string' && /^[0-9a-f]{8}$/.test(r.dev) && typeof r.fp === 'string'
  && (r.reaction === 'love' || r.reaction === 'down') && (r.why === null || DOWN_REASONS.includes(r.why)) && Number.isFinite(Date.parse(r.at));
export function mergeReactions(...lists) {
  const byId = new Map();
  for (const list of lists) for (const r of list || []) {
    if (byId.get(r?.id)?.at > r.at) continue;
    if (validReaction(r)) byId.set(r.id, r);
    else if (r?.reaction === null) byId.delete(r.id);
  }
  return [...byId.values()].sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || x.id.localeCompare(y.id));
}
export function summarizeReactions(reactions) {
  const out = { love: 0, down: 0, why: Object.fromEntries(DOWN_REASONS.map((w) => [w, 0])), styles: {} };
  for (const r of reactions) {
    out[r.reaction]++;
    if (r.why) out.why[r.why]++;
    const s = (out.styles[r.style || '?'] ||= { love: 0, down: 0 });
    s[r.reaction]++;
  }
  return out;
}
