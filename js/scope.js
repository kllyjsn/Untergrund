// Edits that land on part of the song: a pattern can carry per-bar takes (`p.at`), so "the second drop" or
// "bars 9-16" change only those bars of the chain while every other bar keeps playing the pattern itself.
// A take is { b: [from, to] } (0-based chain positions, inclusive) plus the parts it replaces: steps/len per
// track, and optionally hm (melody on/off), prog (chords) and hook.
import { TRACK_IDS, STEPS } from './params.js';

export const MAX_TAKES = 32;
const LETTERS = 'ABCDEFGH';
const cache = new WeakMap();

// The pattern as it plays at chain position `pos` (the latest take covering it wins).
export function patternAt(pat, pos) {
  const at = pat?.at;
  if (!at?.length || !(pos >= 0)) return pat;
  let v = null;
  for (let i = at.length - 1; i >= 0; i--) if (at[i].b[0] <= pos && pos <= at[i].b[1]) { v = at[i]; break; }
  if (!v) return pat;
  const c = cache.get(v);
  if (c && c.base === pat && TRACK_IDS.every((id) => v.steps?.[id] || c.merged.steps[id] === pat.steps[id]) && (v.hook || c.merged.hook === pat.hook) && (v.prog || c.merged.prog === pat.prog)) return c.merged;
  const merged = { ...pat, steps: { ...pat.steps, ...(v.steps || {}) }, len: { ...pat.len, ...(v.len || {}) } };
  delete merged.at;
  for (const k of ['hm', 'prog', 'hook']) if (v[k] !== undefined) merged[k] = v[k];
  cache.set(v, { base: pat, merged });
  return merged;
}

const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Writes `eff` (the edited pattern for chain position pos) back as a take on base, keeping only what differs.
export function setTake(base, pos, eff) {
  const take = { b: [pos, pos] };
  for (const id of TRACK_IDS) {
    if (!sameJSON(eff.steps[id], base.steps[id])) (take.steps ??= {})[id] = eff.steps[id];
    if ((eff.len?.[id] || STEPS) !== (base.len?.[id] || STEPS)) (take.len ??= {})[id] = eff.len[id];
  }
  for (const k of ['hm', 'prog', 'hook']) if (!sameJSON(eff[k], base[k])) take[k] = eff[k] ?? null;
  const at = (base.at || []).map((v) => ({ ...v, b: [...v.b] }));
  // Cut pos out of any take that covers it, then add the new one-bar take.
  const out = [];
  for (const v of at) {
    if (v.b[0] > pos || v.b[1] < pos) { out.push(v); continue; }
    if (v.b[0] < pos) out.push({ ...v, b: [v.b[0], pos - 1] });
    if (v.b[1] > pos) out.push({ ...v, b: [pos + 1, v.b[1]] });
  }
  if (Object.keys(take).length > 1) out.push(take);
  base.at = compact(out);
  if (!base.at.length) delete base.at;
}

// Neighbouring takes with the same content become one range; oldest first so later edits still win.
function compact(at) {
  const body = (v) => { const { b, ...x } = v; return JSON.stringify(x); };
  const sorted = [...at].sort((a, c) => a.b[0] - c.b[0]);
  const out = [];
  for (const v of sorted) {
    const p = out[out.length - 1];
    if (p && p.b[1] + 1 === v.b[0] && body(p) === body(v)) p.b[1] = v.b[1];
    else out.push(v);
  }
  return out.slice(-MAX_TAKES);
}

// Chain positions -> [letter, run index of that letter, offset in the run], so takes survive a longer intro.
function runMap(chain) {
  const out = [], runs = {};
  for (let i = 0; i < chain.length; i++) {
    const L = chain[i];
    if (i === 0 || chain[i - 1] !== L) runs[L] = (runs[L] ?? -1) + 1;
    let a = i; while (a > 0 && chain[a - 1] === L) a--;
    out.push(`${L}:${runs[L]}:${i - a}`);
  }
  return out;
}
// After the chain changed (a section got longer, shorter or skipped), moves each take to the same bars of the same run.
export function remapTakes(patterns, before, after) {
  if (before === after || !patterns.some((p) => p.at)) return;
  const was = runMap(before), now = runMap(after), where = new Map(now.map((k, i) => [k, i]));
  for (const p of patterns) {
    if (!p.at) continue;
    const bars = [];
    for (const v of p.at) for (let pos = v.b[0]; pos <= v.b[1]; pos++) { const to = where.get(was[pos]); if (to != null) bars.push([to, v]); }
    p.at = compact(bars.map(([to, v]) => ({ ...v, b: [to, to] })));
    if (!p.at.length) delete p.at;
  }
}

// Bars (0-based) whose playing pattern differs between two states.
export function changedBars(a, b) {
  const ca = String(a.chain || ''), cb = String(b.chain || '');
  if (ca !== cb) return null;
  const out = [];
  for (let pos = 0; pos < cb.length; pos++) {
    const i = LETTERS.indexOf(cb[pos]);
    if (i < 0 || !a.patterns[i] || !b.patterns[i]) continue;
    if (!sameJSON(strip(patternAt(a.patterns[i], pos)), strip(patternAt(b.patterns[i], pos)))) out.push(pos);
  }
  return out;
}
const strip = (p) => { const { at, ...x } = p; return x; };

// [[from, to], ...] runs of consecutive bars.
export function ranges(bars) {
  const out = [];
  for (const b of [...bars].sort((x, y) => x - y)) {
    const r = out[out.length - 1];
    if (r && r[1] + 1 === b) r[1] = b; else if (!r || r[1] !== b) out.push([b, b]);
  }
  return out;
}
export const barsLabel = (bars) => {
  const r = ranges(bars);
  if (!r.length) return '';
  const one = ([a, b]) => (a === b ? `${a + 1}` : `${a + 1}–${b + 1}`);
  return `${r.length === 1 && r[0][0] === r[0][1] ? 'bar' : 'bars'} ${r.slice(0, 3).map(one).join(', ')}${r.length > 3 ? '…' : ''}`;
};

// Saved/shared takes: positions in range, track arrays shaped like the pattern's (cleanStep cleans one step).
export function cleanTakes(at, cleanSteps, cleanHook, cleanProg) {
  if (!Array.isArray(at)) return null;
  const out = [];
  for (const v of at.slice(-MAX_TAKES)) {
    const b = Array.isArray(v?.b) ? v.b.map((x) => Math.max(0, Math.min(127, x | 0))) : null;
    if (!b || b[1] < b[0]) continue;
    const x = { b: [b[0], b[1]] };
    for (const id of TRACK_IDS) {
      if (Array.isArray(v.steps?.[id])) (x.steps ??= {})[id] = cleanSteps(id, v.steps[id]);
      if (v.len?.[id]) (x.len ??= {})[id] = Math.max(1, Math.min(STEPS, v.len[id] | 0));
    }
    if (v.hm != null) x.hm = Math.max(0, Math.min(2, Math.round(+v.hm) || 0));
    if (v.hook === null) x.hook = null; else if (v.hook && cleanHook) x.hook = cleanHook(v.hook);
    if (Array.isArray(v.prog) && cleanProg) x.prog = cleanProg(v.prog);
    if (Object.keys(x).length > 1) out.push(x);
  }
  return out.length ? out : null;
}
