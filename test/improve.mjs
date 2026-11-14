import assert from 'node:assert/strict';
import { analyze, listensFrom, parseShape, sectionAt, compare, perArm, proposeExperiment, toMarkdown, METRICS } from '../api/_lib/improve.js';

// Deterministic pseudo-random so the fixture is the same every run.
let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
const T0 = Date.UTC(2026, 10, 1);
let n = 0;
// One listen as the raw signals js/listen.js would send for it.
function listen({ lid, fp = `fp${lid}aaaaaa`.slice(0, 14), style = 'acid', src = 'generate', surf = 'home', dev = 'desktop', co = 'd1_6', arr = 'intro-8.build-8.drop-16',
  outcome = 'complete', end = 32, bars = 32, down = false, why = null, downAt = end, love = false, rewind = null, keep = false, t = T0 }) {
  const lis = `l${(n++).toString(36).padStart(6, '0')}`;
  const base = { v: 1, lis, lid, fp, seed: 5, style, src, surf, dev, co, bars, t };
  const out = [{ ...base, kind: 'start', bar: 0, arr, t }];
  if (rewind != null) out.push({ ...base, kind: 'rewind', bar: rewind, to: 0, t: t + 1 });
  if (love) out.push({ ...base, kind: 'love', bar: 4, t: t + 2 });
  if (down) out.push({ ...base, kind: 'down', bar: downAt, t: t + 3 });
  if (why) out.push({ ...base, kind: 'why', why, bar: downAt, t: t + 4 });
  if (keep) out.push({ ...base, kind: 'keep', bar: end, t: t + 5 });
  out.push({ ...base, kind: outcome, bar: end, pct: Math.round((100 * end) / bars), t: t + 6 });
  return out;
}
const lids = Array.from({ length: 40 }, (_, i) => `listener${String(i).padStart(4, '0')}`);
const signals = [];
for (let i = 0; i < 600; i++) {
  const lid = lids[i % lids.length], t = T0 + Math.floor(i / 40) * 864e5 + i * 1000;
  const dev = i % 5 < 2 ? 'phone' : 'desktop';
  const style = ['acid', 'techno', 'house'][i % 3], src = style === 'techno' && i % 4 < 2 ? 'prompt' : 'generate';
  // Techno from prompts falls apart in the drop and gets downed as boring; everything else is mostly fine.
  if (style === 'techno' && src === 'prompt') {
    const bad = rnd() < 0.7;
    signals.push(...listen({ lid, style, src, dev, t, outcome: bad ? 'partial' : 'complete', end: bad ? 18 + Math.floor(rnd() * 8) : 32, down: bad && rnd() < 0.8, why: bad && rnd() < 0.85 ? 'boring' : null }));
  } else if (style === 'house' && dev === 'phone') {
    // House splits by device: phones skip it, desktops don't.
    signals.push(...listen({ lid, style, src, dev, t, outcome: rnd() < 0.6 ? 'skip' : 'complete', end: rnd() < 0.6 ? 2 : 32 }));
  } else {
    const r = rnd();
    signals.push(...listen({ lid, style, src, dev, t, outcome: r < 0.1 ? 'skip' : 'complete', end: r < 0.1 ? 3 : 32, love: rnd() < 0.2, keep: rnd() < 0.1, rewind: rnd() < 0.1 ? 20 : null }));
  }
}

// Shapes: score sections or one pattern per bar.
assert.deepEqual(parseShape('intro-8.drop_2-16'), [{ kind: 'intro', at: 0, bars: 8 }, { kind: 'drop', at: 8, bars: 16 }]);
assert.deepEqual(parseShape('aabba').map((s) => [s.kind, s.at, s.bars]), [['pattern_a', 0, 2], ['pattern_b', 2, 2], ['pattern_a', 4, 1]]);
assert.deepEqual(parseShape('intro-8.dr'), [{ kind: 'intro', at: 0, bars: 8 }], 'a cut-off token is ignored');
assert.deepEqual(parseShape(''), []);

// One row per listen; reactions net out (love clears an earlier reason); returns only judged after a day.
{
  const rows = listensFrom([
    { lis: 'aaaaaa1', lid: 'x1', fp: 'f1', kind: 'start', t: 1, style: 'acid' }, { lis: 'aaaaaa1', fp: 'f1', kind: 'why', why: 'boring', t: 2 },
    { lis: 'aaaaaa1', fp: 'f1', kind: 'love', t: 3 }, { lis: 'aaaaaa1', fp: 'f1', kind: 'down', bar: 9, t: 4 }, { lis: 'aaaaaa1', fp: 'f1', kind: 'skip', bar: 9, t: 5 },
    { lis: 'bbbbbb1', lid: 'x1', fp: 'f2', kind: 'start', t: 2 * 864e5 }, { lis: 'bbbbbb1', fp: 'f2', kind: 'complete', t: 2 * 864e5 + 1 },
    { lis: 'cccccc1', lid: 'x2', fp: 'f2', kind: 'start', t: 3 },
  ]);
  assert.equal(rows.length, 2, 'a start with no outcome or reaction is not a listen yet');
  const [a, b] = rows;
  assert.deepEqual([a.down, a.love, a.why, a.skip, a.downAt.bar, a.return], [true, false, null, true, 9, true]);
  assert.equal(b.return, null, 'too recent to know whether they came back');
}
// Replaying a song downed in an earlier listen: no new `down`, but its reason still counts as a down with that reason.
{
  const [r1] = listensFrom([{ lis: 'dddddd1', lid: 'x1', fp: 'f3', kind: 'start', t: 1 }, { lis: 'dddddd1', fp: 'f3', kind: 'why', why: 'sounds_bad', bar: 6, t: 2 },
    { lis: 'dddddd1', fp: 'f3', kind: 'partial', bar: 12, t: 3 }]);
  assert.deepEqual([r1.down, r1.why, r1.downAt.bar], [true, 'sounds_bad', 6]);
}
// Listens with no device (older records) stay out of device baselines: identical phone/desktop groups give no split.
{
  const legacy = [];
  for (let i = 0; i < 120; i++) {
    const dev = ['phone', 'desktop', ''][i % 3];
    legacy.push(...listen({ lid: `legacy${i % 12}`, style: 'acid', dev, outcome: dev ? (i % 30 < 3 ? 'skip' : 'complete') : (i % 10 < 9 ? 'skip' : 'complete'), t: T0 + i * 1000 }));
  }
  const lr = analyze(legacy, { now: T0 + 864e5 });
  assert.ok(!lr.findings.some((f) => f.scope.dev), 'no device finding from records without a device');
}

// Stats helpers.
assert.ok(compare(30, 100, 10, 100).z > 3);
assert.equal(compare(0, 0, 0, 0).z, 0);
assert.ok(perArm(0.4, 0.2) > 50 && perArm(0.4, 0.2) < 1000);
assert.equal(perArm(0.3, 0.3), null);

const r = analyze(signals, { now: T0 + 30 * 864e5 });
const again = analyze(signals, { now: T0 + 30 * 864e5 });
assert.deepEqual(r, again, 'deterministic');
assert.equal(r.totals.listens, 600);
assert.equal(r.totals.listeners, 40);
assert.ok(r.totals.downs > 0 && r.totals.downsWithReason <= r.totals.downs);

// No global taste score: no top-level score, every finding is one metric in one scoped segment vs comparable listens.
assert.ok(!Object.keys(r).some((k) => /score|taste/.test(k)));
for (const f of r.findings) {
  assert.ok(Object.keys(f.scope).length >= 1 && METRICS[f.metric], f.id);
  assert.ok(f.comparedTo && f.n >= 8 && Math.abs(f.z) >= 1.96, f.id);
}
// Ranked.
assert.deepEqual(r.findings.map((f) => f.rank), r.findings.map((_, i) => i + 1));
for (let i = 1; i < r.findings.length; i++) assert.ok(r.findings[i - 1].priority >= r.findings[i].priority);

const has = (pred) => r.findings.find(pred);
const moved = (f, m) => f.metric === m || f.also.some((x) => x.metric === m);
const segDown = has((f) => f.type === 'segment' && f.scope.style === 'techno' && f.scope.src === 'prompt' && moved(f, 'down'));
assert.ok(segDown && segDown.direction === 'problem' && segDown.comparedTo.includes('style=techno'), 'techno-from-prompt downs, vs other techno');
const reason = has((f) => f.type === 'reason' && f.reason === 'boring' && f.scope.style === 'techno');
assert.ok(reason, 'the one-tap reason explains the downs');
const section = has((f) => f.type === 'section' && f.scope.style === 'techno' && f.scope.section === 'drop' && moved(f, 'skip'));
assert.ok(section && section.direction === 'problem', 'the drop is where techno loses people');
const split = has((f) => f.type === 'split' && f.scope.style === 'house' && f.scope.dev === 'phone');
assert.ok(split && split.versus.dev === 'desktop', 'house splits by device');
assert.ok(r.findings.some((f) => f.direction === 'strength'), 'what works is found too');

// Experiments: proposals with a lever, a scoped small variant arm, guardrails; nothing is applied.
assert.ok(r.experiments.length >= 3);
const ids = new Set(r.findings.map((f) => f.id));
for (const e of r.experiments) {
  assert.equal(e.status, 'proposed');
  assert.ok(ids.has(e.finding));
  assert.deepEqual(e.arms.map((a) => a.name), ['control', 'variant']);
  assert.ok(e.arms[1].share <= 0.2 && e.arms[0].share + e.arms[1].share === 1);
  assert.ok(e.guardrails.length >= 2 && e.minListensPerArm > 0 && e.unit === 'lid');
  assert.ok(!('apply' in e) && !('defaults' in e));
}
const exp = (pred) => r.experiments.find(pred);
assert.ok(exp((e) => e.lever === 'arrangement' && e.scope.style === 'techno'), 'boring techno → arrangement variant');
assert.ok(exp((e) => e.lever === 'targeting' && e.scope.style === 'house'), 'a taste split → targeting, not a generator change');
assert.equal(proposeExperiment({ ...reason, reason: 'not_my_style' }).lever, 'targeting');
assert.equal(proposeExperiment({ ...reason, reason: 'sounds_bad' }).lever, 'sound');

// A truncated shape (long song, 80-char cap) assigns nothing past its end.
assert.equal(sectionAt(parseShape('intro-8.drop-8'), 12).kind, 'drop');
assert.equal(sectionAt(parseShape('intro-8.drop-8'), 40), null);

// Too little data: no findings, no experiments; the bar is reported.
const first = new Set([...new Set(signals.map((x) => x.lis))].slice(0, 30));
const small = analyze(signals.filter((x) => first.has(x.lis)), { now: T0 });
assert.equal(small.findings.length, 0);
assert.equal(small.experiments.length, 0);
assert.match(toMarkdown(small), /No finding clears the bar/);
const md = toMarkdown(r);
assert.match(md, /## Findings/);
assert.match(md, /Proposals only/);
assert.equal(analyze([]).totals.listens, 0);

// Release loop: shares per published song, share-origin listens and their returns, creator return within a week.
{
  const D = 864e5;
  let k = 0;
  const sig = (lid, fp, t, kinds, { ref, ...extra } = {}) => { const lis = `rl${k++}`; return kinds.map((kind, i) => ({ v: 1, lis, lid, fp, kind, t: t + i, bar: 0, bars: 32, ...extra, ...(kind === 'share' ? { ref } : {}) })); };
  const S = [
    ...sig('creator1', 'pubsong1aaaaaa', T0, ['start', 'publish', 'share', 'complete'], { ref: 'aaaa1111' }),
    ...sig('creator1', 'pubsong1aaaaaa', T0 + 5, ['start', 'share', 'complete'], { ref: 'bbbb2222' }),
    ...sig('creator2', 'pubsong2aaaaaa', T0, ['start', 'publish', 'complete']),
    ...sig('creator3', 'pubsong3aaaaaa', T0, ['start', 'publish', 'complete']),
    ...sig('creator1', 'other00aaaaaaa', T0 + 3 * D, ['start', 'complete']),
    ...sig('creator3', 'other00aaaaaaa', T0 + 8 * D, ['start', 'complete']),
    ...sig('fan1', 'pubsong1aaaaaa', T0 + 36e5, ['start', 'replay', 'complete'], { via: 'aaaa1111', tid: 'trk1' }),
    ...sig('fan2', 'pubsong1aaaaaa', T0 + 72e5, ['start', 'skip'], { via: 'aaaa1111', tid: 'trk1' }),
    ...sig('fan1', 'other00aaaaaaa', T0 + 2 * D, ['start', 'complete']),
    ...sig('someone', 'other00aaaaaaa', T0 + 10 * D, ['start', 'complete']),
  ];
  const L = analyze(S, { now: T0 + 10 * D }).loop;
  assert.deepEqual([L.published, L.shares, L.sharesPerSong], [3, 2, 0.667]);
  assert.deepEqual(L.shareOrigin, { starts: 2, links: 1, listeners: 2, returned: 1, judged: 2, returnRate: 0.5 });
  assert.deepEqual(L.heard.shared, { listens: 2, completion: 0.5, replay: 0.5 });
  assert.equal(L.heard.published.listens, 6);
  assert.deepEqual(L.creators, { total: 3, judged: 3, returned: 1, returnRate7d: 0.333 }, 'back at day 3 counts, day 8 does not');
  const again = analyze([...S, ...sig('fan1', 'pubsong1aaaaaa', T0 + 3 * D, ['start', 'complete'], { via: 'aaaa1111' })], { now: T0 + 10 * D }).loop.shareOrigin;
  assert.deepEqual([again.returned, again.judged], [1, 2], 'a listener who opens shared links twice is judged once');
  const lone = analyze(S.filter((s) => s.lid === 'fan2'), { now: T0 + 2 * D }).loop.shareOrigin;
  assert.deepEqual([lone.returned, lone.judged, lone.returnRate], [0, 1, 0], 'a day on, a share-origin listener never heard again counts as not back');
  const solo = analyze([...S, { v: 1, lis: '', lid: 'creator2', fp: 'pubsong2aaaaaa', kind: 'share', ref: 'cccc3333', surf: 'studio', t: T0 + 50 }], { now: T0 + 10 * D }).loop;
  assert.deepEqual([solo.shares, solo.sharesUnplayed, solo.sharesPerSong, solo.heard.all.listens], [3, 1, 1, L.heard.all.listens], 'a share before playing counts, and adds no listen');
  const early = S.filter((s) => s.t < T0 + 3 * D);
  const fresh = analyze(early, { now: T0 + 3 * D }).loop.creators;
  assert.deepEqual([fresh.judged, fresh.returnRate7d], [0, null], 'nobody judged before a week has passed');
  const quiet = analyze(early, { now: T0 + 8 * D }).loop.creators;
  assert.deepEqual([quiet.judged, quiet.returned, quiet.returnRate7d], [3, 0, 0], 'a week later, creators never heard from again count as not back');
  assert.match(toMarkdown(analyze(S)), /## Release loop[\s\S]*shares per published song \| 0\.667 \(2 shares of 3 songs, 0 before playing\)[\s\S]*creator return within 7 days \| 33% \(1 of 3/);
  assert.deepEqual(analyze([]).loop.creators, { total: 0, judged: 0, returned: 0, returnRate7d: null });
}

if (process.argv.includes('--print')) console.log(toMarkdown(r));
console.log('improvement engine passed');
