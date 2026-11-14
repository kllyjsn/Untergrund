// The improvement engine: turns raw listen signals (docs/listen-signals.md) into ranked findings and
// controlled variant experiment proposals (docs/improvement-engine.md). Pure and deterministic: no I/O, no defaults changed.
// There is deliberately no global taste score: every finding is one metric, in one segment, against comparable listens.
export const IMPROVE_VERSION = 1;
export const DEFAULTS = { minListens: 20, minListeners: 3, minSongListens: 8, z: 1.96, top: 25, experiments: 8, share: 0.1, returnAfterMs: 864e5 };

// Each metric is read from one listen; `bad` says which direction is a problem.
export const METRICS = {
  skip: { bad: 'up', weight: 1, label: 'early skips' },
  down: { bad: 'up', weight: 1.2, label: 'downs' },
  complete: { bad: 'down', weight: 0.8, label: 'completions' },
  love: { bad: 'down', weight: 1, label: 'loves' },
  keep: { bad: 'down', weight: 0.7, label: 'keeps (export, remix)' },
  spread: { bad: 'down', weight: 0.7, label: 'shares, publishes, go-lives' },
  replay: { bad: 'down', weight: 0.5, label: 'replays' },
  rewind: { bad: 'down', weight: 0.5, label: 'rewinds' },
  return: { bad: 'down', weight: 0.6, label: 'listeners coming back another day' },
};
// Segments are compared only against comparable listens: the rest of their parent (same style, other sources, …).
export const SEGMENTS = [
  ['style'], ['src'], ['surf'], ['dev'], ['co'],
  ['style', 'src'], ['style', 'surf'], ['style', 'dev'], ['style', 'co'],
];
const COHORT_DIMS = ['dev', 'co'];
const REASON_LEVER = { boring: 'arrangement', sounds_bad: 'sound', not_my_style: 'targeting' };

// ---- one row per listen
// Sections from the start record's `arr`: "intro-8.drop-16" (score sections) or "aabbc" (one pattern per bar).
export function parseShape(arr = '') {
  const out = [];
  let at = 0;
  if (String(arr).includes('-')) {
    for (const tok of String(arr).split('.')) {
      const m = /^([a-z0-9_]*)-(\d+)$/.exec(tok);
      if (!m || !+m[2]) continue;
      out.push({ kind: m[1].replace(/_?\d+$/, '') || m[1] || 'section', at, bars: +m[2] }); at += +m[2];
    }
  } else for (const ch of String(arr).replace(/[^a-z]/g, '')) {
    const last = out[out.length - 1];
    if (last && last.kind === `pattern_${ch}` && last.at + last.bars === at) last.bars++;
    else out.push({ kind: `pattern_${ch}`, at, bars: 1 });
    at++;
  }
  return out;
}
// `arr` is capped at 80 chars, so a long song's shape can end early: bars past its end belong to no known section.
export const sectionAt = (shape, bar) => shape.findLast((s) => s.at <= bar && bar < s.at + s.bars) || null;

export function listensFrom(signals = [], { returnAfterMs = DEFAULTS.returnAfterMs } = {}) {
  const by = new Map();
  for (const s of [...signals].filter((x) => x && x.lis && x.fp).sort((a, b) => (a.t || 0) - (b.t || 0))) {
    let l = by.get(s.lis);
    if (!l) by.set(s.lis, l = { lis: s.lis, lid: s.lid || '', sid: s.sid || '', fp: s.fp, t: s.t || 0, outcome: null, love: false, down: false, why: null,
      replay: false, rewind: false, keep: false, spread: false, rewinds: [], end: null, downAt: null });
    for (const k of ['tid', 'seed', 'style', 'src', 'surf', 'ph', 'co', 'dev', 'arr', 'xp', 'arm', 'via']) if (l[k] == null || l[k] === '' || l[k] === -1) if (s[k] != null && s[k] !== '') l[k] = s[k];
    if (s.kind === 'start' && s.pt) l.pt = s.pt;
    if (s.kind === 'complete' || s.kind === 'skip' || s.kind === 'partial') { l.outcome = s.kind; l.end = { bar: s.bar, bars: s.bars, pct: s.pct, ms: s.ms, sec: s.sec }; }
    else if (s.kind === 'love') { l.love = true; l.down = false; l.why = null; }
    else if (s.kind === 'unlove') l.love = false;
    else if (s.kind === 'down') { l.down = true; l.love = false; l.downAt = { bar: s.bar, pct: s.pct, sec: s.sec }; }
    else if (s.kind === 'undown') { l.down = false; l.why = null; l.downAt = null; }
    // A reason is only offered on a downed song; without a `down` in this listen, it is still downed from an earlier one.
    else if (s.kind === 'why') { if (!l.down) { l.down = true; l.love = false; l.downAt = { bar: s.bar, pct: s.pct, sec: s.sec }; } l.why = s.why; }
    else if (s.kind === 'replay') l.replay = true;
    else if (s.kind === 'rewind') { l.rewind = true; l.rewinds.push({ bar: s.bar, to: s.to ?? 0, sec: s.sec }); }
    else if (s.kind === 'keep') l.keep = true;
    else if (['share', 'publish', 'live'].includes(s.kind)) l.spread = true;
  }
  const rows = [...by.values()].filter((l) => l.outcome || l.down || l.love);
  // Returns: did this listener hear anything again at least a day later? Only judged once a day has passed.
  const latest = rows.reduce((m, l) => Math.max(m, l.t), 0);
  const times = new Map();
  for (const l of rows) if (l.lid) (times.get(l.lid) || times.set(l.lid, []).get(l.lid)).push(l.t);
  for (const l of rows) {
    l.complete = l.outcome === 'complete';
    l.skip = l.outcome === 'skip';
    l.return = l.lid && latest - l.t >= returnAfterMs ? (times.get(l.lid) || []).some((t) => t - l.t >= returnAfterMs) : null;
  }
  return rows;
}

// ---- stats
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496735) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const pTwo = (z) => 1 - erf(Math.abs(z) / Math.SQRT2);
export function compare(k1, n1, k0, n0) {
  const p1 = n1 ? k1 / n1 : 0, p0 = n0 ? k0 / n0 : 0, p = (k1 + k0) / Math.max(1, n1 + n0);
  const se = Math.sqrt(p * (1 - p) * (1 / Math.max(1, n1) + 1 / Math.max(1, n0)));
  const z = se ? (p1 - p0) / se : 0;
  return { rate: p1, base: p0, lift: p1 - p0, z, p: pTwo(z) };
}
// Listens per arm to detect moving `from` halfway to `to` (two-sided α=.05, power .8).
export function perArm(from, to) {
  const a = Math.min(0.99, Math.max(0.01, from)), b = Math.min(0.99, Math.max(0.01, (from + to) / 2));
  if (Math.abs(a - b) < 1e-3) return null;
  const m = (a + b) / 2, n = (1.96 * Math.sqrt(2 * m * (1 - m)) + 0.8416 * Math.sqrt(a * (1 - a) + b * (1 - b))) ** 2 / (a - b) ** 2;
  return Math.ceil(n);
}
const an = (w) => `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w.replace(/_/g, ' ')}`;
const pct = (x) => `${Math.round(100 * x)}%`;
const label = (scope) => Object.entries(scope).map(([k, v]) => `${k}=${v}`).join(' · ');
const fid = (...p) => p.join(':').replace(/ · /g, ',').replace(/[^a-z0-9_:=.,-]/gi, '');
const count = (rows, m) => rows.reduce((n, l) => n + (l[m] === true ? 1 : 0), 0);
const judged = (rows, m) => (m === 'return' ? rows.filter((l) => l.return != null) : m === 'skip' || m === 'complete' ? rows.filter((l) => l.outcome) : rows);
const groupBy = (rows, f) => { const g = new Map(); for (const l of rows) { const k = f(l); if (k != null && k !== '') (g.get(k) || g.set(k, []).get(k)).push(l); } return g; };
const listeners = (rows) => new Set(rows.map((l) => l.lid || l.sid || l.lis)).size;

function finding(type, scope, metric, c, n, extra, o) {
  const spec = METRICS[metric] || { bad: 'up', weight: 1 };
  const problem = spec.bad === 'up' ? c.lift > 0 : c.lift < 0;
  const priority = +(spec.weight * Math.abs(c.lift) * (1 - c.p) * Math.min(1, Math.sqrt(n / (o.minListens * 4)))).toFixed(4);
  return { id: fid(type, label(scope), metric), type, direction: problem ? 'problem' : 'strength', scope, metric, rate: +c.rate.toFixed(4), comparable: +c.base.toFixed(4),
    lift: +c.lift.toFixed(4), z: +c.z.toFixed(2), n, priority, ...extra };
}

// Metric × segment vs the rest of its parent: "techno from prompts gets downed 3x more than other techno".
function segmentFindings(rows, o) {
  const out = [];
  for (const dims of SEGMENTS) {
    const parentDims = dims.slice(0, -1), dim = dims[dims.length - 1];
    for (const [pk, parent] of groupBy(rows, (l) => (parentDims.every((d) => l[d]) ? parentDims.map((d) => l[d]).join('|') || '*' : null))) {
      const segs = groupBy(parent, (l) => l[dim] || null);
      if (segs.size < 2) continue;
      const parentScope = Object.fromEntries(parentDims.map((d, i) => [d, pk.split('|')[i]]));
      // A style that one cohort (device, listening age) likes and another doesn't is a taste split: a targeting question.
      const type = parentScope.style && COHORT_DIMS.includes(dim) ? 'split' : 'segment';
      for (const metric of Object.keys(METRICS)) {
        const found = [];
        for (const [v, seg] of segs) {
          const a = judged(seg, metric), rest = parent.filter((l) => l[dim] && l[dim] !== v), b = judged(rest, metric);
          if (a.length < o.minListens || b.length < o.minListens || listeners(a) < o.minListeners) continue;
          const c = compare(count(a, metric), a.length, count(b, metric), b.length);
          if (Math.abs(c.z) < o.z) continue;
          const others = [...new Set(rest.map((l) => l[dim]).filter(Boolean))].sort();
          found.push(finding(type, { ...parentScope, [dim]: v }, metric, c, a.length,
            { comparedTo: `${parentDims.length ? `${label(parentScope)}, ` : ''}${dim}=${others.join('/')}`, versus: { [dim]: others.join('/') }, listeners: listeners(a) }, o));
        }
        // With two values, "A is worse" and "B is better" are one fact: keep the problem side.
        out.push(...(segs.size === 2 && found.length === 2 ? found.filter((f) => f.direction === 'problem') : found));
      }
    }
  }
  return out;
}

// Where songs lose people: exits (early skip or stop before the end) and downs per section kind, vs the other sections of that style.
function sectionFindings(rows, o) {
  const out = [];
  for (const [style, group] of groupBy(rows, (l) => l.style || null)) {
    const by = new Map();
    const at = (kind) => by.get(kind) || by.set(kind, { reached: 0, exits: 0, downs: 0, rewinds: 0, lids: new Set() }).get(kind);
    for (const l of group) {
      const shape = parseShape(l.arr);
      if (!shape.length) continue;
      const lastBar = l.outcome === 'complete' ? Infinity : l.end?.bar ?? l.downAt?.bar ?? 0;
      for (const s of shape) if (s.at <= lastBar) { const x = at(s.kind); x.reached++; x.lids.add(l.lid || l.lis); }
      if (l.outcome && l.outcome !== 'complete') { const s = sectionAt(shape, l.end?.bar ?? 0); if (s) at(s.kind).exits++; }
      if (l.down && l.downAt) { const s = sectionAt(shape, l.downAt.bar); if (s) at(s.kind).downs++; }
      for (const r of l.rewinds) { const s = sectionAt(shape, r.bar); if (s) at(s.kind).rewinds++; }
    }
    const tot = { reached: 0, exits: 0, downs: 0, rewinds: 0 };
    for (const x of by.values()) for (const k in tot) tot[k] += x[k];
    for (const [kind, x] of by) {
      const rest = tot.reached - x.reached;
      if (x.reached < o.minListens || rest < o.minListens || x.lids.size < o.minListeners) continue;
      for (const [metric, key] of [['skip', 'exits'], ['down', 'downs'], ['rewind', 'rewinds']]) {
        const c = compare(x[key], x.reached, tot[key] - x[key], rest);
        // A section with fewer exits only means people leave elsewhere; only more exits/downs, or more rewinds, say something.
        if (Math.abs(c.z) < o.z || c.lift <= 0) continue;
        out.push(finding('section', { style, section: kind }, metric, c, x.reached, { comparedTo: `other sections of ${style}`, listeners: x.lids.size,
          note: metric === 'skip' ? 'exit rate among listens that reached this section' : metric === 'down' ? 'downs while this section played' : 'rewinds from this section' }, o));
      }
    }
  }
  return out;
}

// Why the downs: the one-tap reasons in a segment vs everywhere else. One tap with no reason still counts as a down.
function reasonFindings(rows, o) {
  const out = [], downs = rows.filter((l) => l.down && l.why);
  const minDowns = Math.max(8, Math.round(o.minListens / 2));
  for (const dims of [['style'], ['style', 'src'], ['src']]) {
    for (const [k, seg] of groupBy(downs, (l) => (dims.every((d) => l[d]) ? dims.map((d) => l[d]).join('|') : null))) {
      const rest = downs.filter((l) => dims.map((d) => l[d]).join('|') !== k);
      if (seg.length < minDowns || listeners(seg) < o.minListeners) continue;
      for (const why of Object.keys(REASON_LEVER)) {
        const n1 = seg.filter((l) => l.why === why).length, n0 = rest.filter((l) => l.why === why).length;
        // Against the other segments' reasons when there are enough of them, else against an even split.
        const even = 1 / Object.keys(REASON_LEVER).length, se = Math.sqrt((even * (1 - even)) / seg.length);
        const c = rest.length >= minDowns ? compare(n1, seg.length, n0, rest.length) : { rate: n1 / seg.length, base: even, lift: n1 / seg.length - even, z: (n1 / seg.length - even) / se, p: pTwo((n1 / seg.length - even) / se) };
        if (c.rate < 0.5 || c.z < o.z) continue;
        const scope = Object.fromEntries(dims.map((d, i) => [d, k.split('|')[i]]));
        out.push({ ...finding('reason', scope, 'down', c, seg.length, { reason: why, listeners: listeners(seg), comparedTo: rest.length >= minDowns ? 'down reasons elsewhere' : 'an even split of reasons' }, o),
          id: fid('reason', label(scope), why), direction: 'problem' });
      }
    }
  }
  return out;
}

// Single songs (fingerprints) that stand out against their style: candidates to study, hold out or build on.
const SONG_METRICS = ['down', 'skip', 'love', 'keep'];
// { listens, <metric>: [judged, hits] } for a set of rows; a song's "rest" is its style's tally minus its own (linear, not songs × rows).
const tally = (rows) => Object.fromEntries([['listens', rows.length], ...SONG_METRICS.map((m) => { const j = judged(rows, m); return [m, [j.length, count(j, m)]]; })]);
function songFindings(rows, o) {
  const out = [], byStyle = new Map();
  const styles = new Map();
  for (const l of rows) (styles.get(l.style) || styles.set(l.style, []).get(l.style)).push(l);
  for (const [style, seg] of styles) byStyle.set(style, tally(seg));
  for (const [fp, seg] of groupBy(rows, (l) => l.fp)) {
    const style = seg[0].style, all = byStyle.get(style), own = tally(seg.filter((l) => l.style === style));
    if (seg.length < o.minSongListens || !all || all.listens - own.listens < o.minListens || listeners(seg) < o.minListeners) continue;
    for (const metric of SONG_METRICS) {
      const a = judged(seg, metric), bn = all[metric][0] - own[metric][0];
      if (!a.length || !bn) continue;
      const c = compare(count(a, metric), a.length, all[metric][1] - own[metric][1], bn);
      if (Math.abs(c.z) < o.z) continue;
      const s = seg.find((l) => l.pt) || seg[0];
      out.push(finding('song', { style, fp }, metric, c, a.length, { comparedTo: `other ${style} songs`, listeners: listeners(seg), song: { fp, seed: s.seed ?? -1, tid: s.tid || '', src: s.src || '', arr: s.arr || '', ...(s.pt ? { pt: s.pt } : {}) } }, o));
    }
  }
  return out;
}

// ---- experiments: a finding becomes a proposal with one lever, a control, a small variant arm and guardrails. Never applied here.
function lever(f) {
  if (f.type === 'reason') return { lever: REASON_LEVER[f.reason], reason: f.reason };
  if (f.type === 'split') return { lever: 'targeting' };
  if (f.type === 'section') return { lever: 'arrangement', section: f.scope.section };
  if (f.type === 'song') return { lever: f.direction === 'problem' ? 'rotation' : 'seed' };
  if (f.metric === 'return') return { lever: 'next_song' };
  if (['keep', 'spread'].includes(f.metric)) return { lever: 'lifecycle' };
  return { lever: f.scope.surf && !f.scope.style ? 'surface' : 'generator' };
}
const CHANGES = {
  arrangement: (f, x) => (f.direction === 'strength'
    ? `Give ${x.section || 'the strongest section'} more room in ${f.scope.style || 'this style'}: repeat or extend it, keeping everything else fixed.`
    : `In ${f.scope.style || 'this segment'}, vary ${x.section ? `the ${x.section}` : 'the arrangement'}: shorten it by a phrase or add one change of texture there; nothing else changes.`),
  sound: (f) => `A/B one sound change for ${label(f.scope)}: the master/mix chain or a single instrument's params, with patterns and arrangement fixed.`,
  targeting: (f) => `Leave ${f.scope.style || 'the style'} unchanged; change who hears it: show it less to ${label(Object.fromEntries(Object.entries(f.scope).filter(([k]) => k !== 'style')))}, or ask for a style first there.`,
  rotation: (f) => `Hold this song out of autoplay surfaces (daily drop, jukebox) for the variant arm; compare the next song's outcomes.`,
  seed: (f) => `Seed new ${f.scope.style} songs near this one (same arrangement shape and sound, new seed) for the variant arm.`,
  next_song: (f) => `After a listen in ${label(f.scope)}, offer the next song from the listener's best style instead of the default.`,
  lifecycle: (f) => `Surface the keep/share step sooner in ${label(f.scope)} (once, after the first complete listen).`,
  surface: (f) => `Change one thing about the ${f.scope.surf} surface (what plays first, or autoplay), not the generator.`,
  generator: (f) => `Try one generator variation scoped to ${label(f.scope)} (e.g. intro length or energy curve), behind the experiment arm only.`,
};
export function proposeExperiment(f, o = DEFAULTS) {
  const x = lever(f), spec = METRICS[f.metric] || {};
  const target = f.type === 'reason' ? null : perArm(f.rate, f.comparable);
  const guards = ['skip', 'down', 'complete'].filter((m) => m !== f.metric).map((m) => ({ metric: m, rule: METRICS[m].bad === 'up' ? 'must not rise by > 2 points' : 'must not fall by > 2 points' }));
  return {
    id: `exp:${f.id}`, finding: f.id, status: 'proposed', lever: x.lever,
    hypothesis: f.type === 'reason' ? `${label(f.scope)} downs are mostly "${f.reason}" (${pct(f.rate)}); ${an(x.lever)} change should cut downs there.`
      : f.direction === 'problem' ? `${label(f.scope)} gets ${pct(f.rate)} ${spec.label} vs ${pct(f.comparable)} for ${f.comparedTo}; ${an(x.lever)} change scoped to it should close part of that gap.`
        : `${label(f.scope)} gets ${pct(f.rate)} ${spec.label} vs ${pct(f.comparable)} for ${f.comparedTo}; doing more of it may lift comparable listens.`,
    change: CHANGES[x.lever](f, x), scope: f.scope,
    arms: [{ name: 'control', share: +(1 - o.share).toFixed(2), change: 'none' }, { name: 'variant', share: o.share }],
    unit: 'lid', assignment: `fnv(lid + "${f.id}") % 100 < ${Math.round(o.share * 100)} → variant; listens outside the scope are never assigned`,
    primary: { metric: f.type === 'reason' ? 'down' : f.metric, goal: spec.bad === 'up' ? 'lower' : 'higher' },
    guardrails: guards, minListensPerArm: target || Math.max(100, o.minListens * 5),
    stop: 'Stop the variant early if any guardrail is breached at |z| ≥ 2; otherwise read out at minListensPerArm per arm. Ship only by a reviewed PR.',
  };
}

const rank = (fs) => fs.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
const within = (narrow, broad) => Object.entries(broad).every(([k, v]) => narrow[k] === v) && Object.keys(narrow).length > Object.keys(broad).length;
// How much of `metric` a finding accounts for: its lead metric, or one riding along in `also`.
const excess = (f, metric = f.metric) => { const x = f.metric === metric ? f : f.also?.find((a) => a.metric === metric); return x ? x.n * Math.abs(x.lift) : 0; };
// Keep review short: one finding per scope and direction (other metrics that moved ride along in `also`), and a broad
// finding is dropped when a narrower one in the same direction explains most of it (techno·prompt explains "prompt").
function dedupe(all) {
  const byScope = new Map();
  for (const f of rank(all)) {
    const key = `${f.type === 'reason' ? `reason:${f.reason}` : f.type === 'song' ? 'song' : 'metric'}|${label(f.scope)}|${f.direction}`;
    const top = byScope.get(key);
    if (!top) byScope.set(key, { ...f, also: [] });
    else top.also.push({ metric: f.metric, rate: f.rate, comparable: f.comparable, z: f.z, n: f.n, lift: f.lift });
  }
  const kept = [...byScope.values()];
  return kept.filter((f) => !kept.some((g) => g !== f && g.direction === f.direction && (g.type === 'reason') === (f.type === 'reason') && g.reason === f.reason
    && within(g.scope, f.scope) && excess(g, f.metric) >= 0.8 * excess(f)));
}

// ---- running experiments: control vs variant on the experiment's own primary metric and guardrails.
const GUARD_POINTS = 0.02, GUARD_Z = 2;
const worse = (metric, lift) => (METRICS[metric]?.bad === 'up' ? lift : -lift);
export function experimentResults(rows, running = [], o = DEFAULTS) {
  const out = [];
  const ids = [...new Set([...running.map((e) => e.id), ...rows.map((l) => l.xp).filter(Boolean)])];
  for (const id of ids) {
    const spec = running.find((e) => e.id === id), tagged = rows.filter((l) => l.xp === id);
    const arm = (name) => tagged.filter((l) => l.arm === name);
    const c = arm('control'), v = arm('variant');
    const primary = spec?.primary || { metric: 'down', goal: 'lower' };
    const readout = (metric) => {
      const a = judged(v, metric), b = judged(c, metric);
      return { metric, ...Object.fromEntries(Object.entries(compare(count(a, metric), a.length, count(b, metric), b.length)).map(([k, x]) => [k, +x.toFixed(4)])), n: a.length, nControl: b.length };
    };
    const main = readout(primary.metric);
    const guardrails = (spec?.guardrails || ['skip', 'down', 'complete'].filter((m) => m !== primary.metric)).map((m) => {
      const g = readout(m);
      return { ...g, breached: worse(m, g.lift) > GUARD_POINTS && Math.abs(g.z) >= GUARD_Z && g.n >= o.minListens && g.nControl >= o.minListens };
    });
    const need = spec?.minListensPerArm || Math.max(100, o.minListens * 5);
    const better = primary.goal === 'lower' ? main.lift < 0 : main.lift > 0;
    // Stop rule from the proposal: a breached guardrail stops it early; otherwise read out once both arms have enough listens.
    const status = !spec ? 'ended' : guardrails.some((g) => g.breached) ? 'stop' : v.length >= need && c.length >= need ? 'ready' : 'collecting';
    const verdict = status === 'collecting' ? null : Math.abs(main.z) >= o.z ? (better ? 'variant_better' : 'variant_worse') : 'no_difference';
    out.push({ id, lever: spec?.lever || '', scope: spec?.scope || {}, status, verdict, primary: { ...primary, ...main }, guardrails, minListensPerArm: need,
      arms: { control: { listens: c.length, listeners: listeners(c) }, variant: { listens: v.length, listeners: listeners(v) } } });
  }
  return out;
}

// The release loop: do published songs get shared, do shared links bring listeners who finish, replay and come back,
// and do creators come back within a week of publishing? Rates are null until there is something to divide by.
export const CREATOR_WEEK_MS = 7 * 864e5;
export function releaseLoop(signals = [], rows = listensFrom(signals), { returnAfterMs = DEFAULTS.returnAfterMs, now = Date.now() } = {}) {
  const sig = signals.filter((s) => s && s.fp), rate = (k, n) => (n ? Math.round((1000 * k) / n) / 1000 : null);
  const publishes = sig.filter((s) => s.kind === 'publish'), published = new Set(publishes.map((s) => s.fp));
  const shares = sig.filter((s) => s.kind === 'share' && published.has(s.fp)).length;
  const shareStarts = sig.filter((s) => s.kind === 'start' && s.via);
  const heard = (r) => ({ listens: r.length, completion: rate(count(r, 'complete'), r.length), replay: rate(count(r, 'replay'), r.length) });
  const shared = rows.filter((l) => l.via);
  // A share-origin listener came back if heard again at least a day after their first share-origin start; judged
  // per listener, once that day has passed at report time.
  const firstVia = new Map(), heardVia = new Map();
  for (const s of shareStarts) if (s.lid && !(firstVia.get(s.lid) <= s.t)) firstVia.set(s.lid, s.t || 0);
  for (const s of sig) if (firstVia.has(s.lid)) (heardVia.get(s.lid) || heardVia.set(s.lid, []).get(s.lid)).push(s.t || 0);
  const visited = [...firstVia].filter(([, t]) => now - t >= returnAfterMs);
  const cameBack = visited.filter(([lid, t]) => heardVia.get(lid).some((u) => u - t >= returnAfterMs)).length;
  // A creator is a device that published; it came back if it was heard from again between a day and a week after its
  // first publish. Only creators whose first publish is at least a week old (at report time) are judged.
  const first = new Map(), seen = new Map();
  for (const s of publishes) if (s.lid && !(first.get(s.lid) <= s.t)) first.set(s.lid, s.t || 0);
  for (const s of sig) if (first.has(s.lid)) (seen.get(s.lid) || seen.set(s.lid, []).get(s.lid)).push(s.t || 0);
  const ripe = [...first].filter(([, t]) => now - t >= CREATOR_WEEK_MS);
  const back = ripe.filter(([lid, t]) => seen.get(lid).some((u) => u - t >= returnAfterMs && u - t <= CREATOR_WEEK_MS)).length;
  return {
    published: published.size, shares, sharesPerSong: rate(shares, published.size),
    shareOrigin: { starts: shareStarts.length, links: new Set(shareStarts.map((s) => s.via)).size, listeners: listeners(shared),
      returned: cameBack, judged: visited.length, returnRate: rate(cameBack, visited.length) },
    heard: { all: heard(rows), published: heard(rows.filter((l) => l.tid || published.has(l.fp))), shared: heard(shared) },
    creators: { total: first.size, judged: ripe.length, returned: back, returnRate7d: rate(back, ripe.length) },
  };
}

export function analyze(signals = [], options = {}) {
  const o = { ...DEFAULTS, ...options };
  const all = listensFrom(signals, o);
  // Findings describe what everyone hears by default: variant-arm listens only count in their experiment's read-out.
  const rows = all.filter((l) => l.arm !== 'variant');
  const findings = rank(dedupe([...segmentFindings(rows, o), ...sectionFindings(rows, o), ...reasonFindings(rows, o), ...songFindings(rows, o)])).slice(0, o.top).map((f, i) => ({ rank: i + 1, ...f }));
  // A scope that already has a running experiment gets no new proposal for it.
  const busy = new Set((o.running || []).map((e) => label(e.scope || {})));
  // One experiment per scope, from the highest-ranked finding that calls for one; capped so review stays short.
  const seen = new Set(), experiments = [];
  for (const f of findings) {
    if (experiments.length >= o.experiments) break;
    if (f.direction !== 'problem' && !(f.type === 'section' && f.metric === 'rewind') && f.type !== 'song') continue;
    const e = proposeExperiment(f, o), key = label(e.scope);
    if (seen.has(key) || busy.has(key)) continue;
    seen.add(key); experiments.push({ rank: experiments.length + 1, ...e });
  }
  const ts = all.map((l) => l.t).filter(Boolean);
  const reasons = Object.fromEntries(Object.keys(REASON_LEVER).map((w) => [w, all.filter((l) => l.down && l.why === w).length]));
  return {
    version: IMPROVE_VERSION, generated: new Date(o.now ?? Date.now()).toISOString(),
    window: ts.length ? { from: new Date(Math.min(...ts)).toISOString(), to: new Date(Math.max(...ts)).toISOString() } : null,
    totals: { signals: signals.length, listens: all.length, listeners: listeners(all), downs: count(all, 'down'), downsWithReason: all.filter((l) => l.down && l.why).length, reasons },
    thresholds: { minListens: o.minListens, minListeners: o.minListeners, minSongListens: o.minSongListens, z: o.z },
    findings, experiments, running: experimentResults(all, o.running || [], o), loop: releaseLoop(signals, all, o),
  };
}

// The report as Markdown, for a PR description, an issue or a scheduled digest.
export function toMarkdown(r) {
  const lines = [`# Listen findings (v${r.version})`, '', `${r.totals.listens} listens by ${r.totals.listeners} listeners${r.window ? `, ${r.window.from.slice(0, 10)} to ${r.window.to.slice(0, 10)}` : ''}. ${r.totals.downs} downs (${r.totals.downsWithReason} with a reason).`, ''];
  if (!r.findings.length) lines.push(`No finding clears the bar yet (≥ ${r.thresholds.minListens} listens from ≥ ${r.thresholds.minListeners} listeners and |z| ≥ ${r.thresholds.z}).`);
  else {
    lines.push('## Findings', '', '| # | type | scope | metric | rate | comparable | n | z |', '|---|---|---|---|---|---|---|---|');
    for (const f of r.findings) lines.push(`| ${f.rank} | ${f.direction} ${f.type} | ${label(f.scope)}${f.reason ? ` · why=${f.reason}` : ''} | ${f.metric} | ${pct(f.rate)} | ${pct(f.comparable)} (${f.comparedTo}) | ${f.n} | ${f.z} |`);
  }
  if (r.coverage) lines.splice(3, 0, '', `Window: ${r.coverage.from} to ${r.coverage.to} (${r.coverage.records} records${r.coverage.capped.length ? `; days at the per-day cap: ${r.coverage.capped.join(', ')}` : ''}).`);
  if (r.running?.length) {
    lines.push('', '## Running experiments', '', '| experiment | status | primary | variant | control | z | listens (variant/control) | guardrails |', '|---|---|---|---|---|---|---|---|');
    for (const x of r.running) lines.push(`| ${x.id} | ${x.status}${x.verdict ? ` · ${x.verdict}` : ''} | ${x.primary.metric} (${x.primary.goal}) | ${pct(x.primary.rate)} | ${pct(x.primary.base)} | ${x.primary.z} | ${x.arms.variant.listens}/${x.arms.control.listens} of ≥ ${x.minListensPerArm} | ${x.guardrails.filter((g) => g.breached).map((g) => `${g.metric} breached`).join(', ') || 'ok'} |`);
  }
  if (r.loop) {
    const L = r.loop, p = (x) => (x == null ? '–' : pct(x)), h = L.heard;
    lines.push('', '## Release loop', '', '| metric | value |', '|---|---|',
      `| shares per published song | ${L.sharesPerSong ?? '–'} (${L.shares} shares of ${L.published} songs) |`,
      `| share-origin listens | ${L.shareOrigin.starts} starts from ${L.shareOrigin.links} links, ${L.shareOrigin.listeners} listeners |`,
      `| completion (shared · published · all) | ${p(h.shared.completion)} · ${p(h.published.completion)} · ${p(h.all.completion)} |`,
      `| replay (shared · published · all) | ${p(h.shared.replay)} · ${p(h.published.replay)} · ${p(h.all.replay)} |`,
      `| share-origin listeners back a day later | ${p(L.shareOrigin.returnRate)} (${L.shareOrigin.returned} of ${L.shareOrigin.judged}) |`,
      `| creator return within 7 days | ${p(L.creators.returnRate7d)} (${L.creators.returned} of ${L.creators.judged} creators a week past their first publish) |`);
  }
  if (r.experiments.length) {
    lines.push('', '## Proposed experiments', '', 'Proposals only: nothing here changes a default. Each runs as a small variant arm against control.', '');
    for (const e of r.experiments) lines.push(`${e.rank}. **${e.lever}** · ${label(e.scope)}: ${e.change} Primary: ${e.primary.metric} (${e.primary.goal}); ${e.arms[1].share * 100}% of listeners; ≥ ${e.minListensPerArm} listens per arm. _${e.hypothesis}_`);
  }
  return lines.join('\n') + '\n';
}
