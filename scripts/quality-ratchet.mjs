// Daily quality ratchet: songs only ever get better. Compares the composition scorecard (and, when given, two
// audio-benchmark reports) against the last recorded day, names today's target genre, and keeps a ledger of what
// each day changed so the next run builds on it (docs/quality-ratchet.md).
//   node scripts/quality-ratchet.mjs --plan                       # today's target genre, its weak spots, recent ledger
//   node scripts/quality-ratchet.mjs --check --target <style>     # gains/losses vs test/composition-baseline.json
//        [--audio-before main.json --audio-after branch.json]     # + audio-benchmark reasons that appeared/cleared
//        [--require-gain]                                         # exit 1 unless the target gained and nothing regressed
//   node scripts/quality-ratchet.mjs --record --target <style> --summary "…" [--lever generator] [--audio-…]
//                                                                 # raise the composition floor + append the ledger
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runComposition, loopStyles, HIGHER, LOWER, TOL } from './composition.mjs';
import { dailyDrop } from '../js/daily.js';
import { STYLES } from '../js/state.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = resolve(ROOT, 'test/composition-baseline.json');
export const LEDGER = resolve(ROOT, 'test/quality-ledger.json');
const DAY = 864e5;

// Metrics that moved past their tolerance in the good (gain) or bad (loss) direction, per style.
export function compareComposition(before, after) {
  const gains = [], losses = [];
  for (const [style, m] of Object.entries(after)) {
    const b = before[style];
    if (!b) continue;
    for (const k of [...HIGHER, ...LOWER]) {
      if (b[k] === undefined || m[k] === undefined) continue;
      const tol = TOL[k] ?? 0, up = HIGHER.includes(k), d = +(m[k] - b[k]).toFixed(3);
      const better = up ? d > tol : d < -tol, worse = up ? d < -tol : d > tol;
      if (better) gains.push({ style, metric: k, from: b[k], to: m[k] });
      if (worse) losses.push({ style, metric: k, from: b[k], to: m[k] });
    }
  }
  return { gains, losses };
}

// WARN/FAIL reasons are keyed by style + check: ones only in `after` are new problems, ones only in `before` cleared.
const reasonKeys = (report) => {
  const out = new Map();
  for (const [style, s] of Object.entries(report?.styles || {})) for (const r of s.reasons || []) {
    const key = `${style} ${r.check}`;
    if (!out.has(key) || r.level === 'FAIL') out.set(key, { style, check: r.check, level: r.level, message: r.message });
  }
  return out;
};
// Reports are only comparable when they measured the same tier, seeds and styles; otherwise a missing style reads as cleared.
export function audioMismatch(before, after) {
  const out = [];
  if ((before?.tier ?? null) !== (after?.tier ?? null)) out.push(`tier ${before?.tier} vs ${after?.tier}`);
  if (JSON.stringify(before?.seeds ?? null) !== JSON.stringify(after?.seeds ?? null)) out.push('different seeds');
  const missing = Object.keys(before?.styles || {}).filter((s) => !after?.styles?.[s]);
  if (missing.length) out.push(`styles missing after: ${missing.join(', ')}`);
  return out;
}
export function compareAudio(before, after) {
  const a = reasonKeys(before), b = reasonKeys(after);
  const cleared = [...a].filter(([k, r]) => after?.styles?.[r.style] && (!b.has(k) || (r.level === 'FAIL' && b.get(k).level === 'WARN'))).map(([, r]) => r);
  const appeared = [...b].filter(([k, r]) => !a.has(k) || (r.level === 'FAIL' && a.get(k).level === 'WARN')).map(([, r]) => r);
  const count = (r, lvl) => r?.counts?.[lvl] ?? 0;
  return { cleared, appeared, warn: [count(before, 'WARN'), count(after, 'WARN')], fail: [count(before, 'FAIL'), count(after, 'FAIL')] };
}

// A day counts only if the target genre measurably gained and no genre lost anything (composition or audio).
export function verdict({ gains, losses }, audio, target) {
  const targetGains = gains.filter((g) => g.style === target).length + (audio?.cleared.filter((r) => r.style === target).length || 0);
  const regressions = losses.length + (audio?.appeared.length || 0);
  return { ok: targetGains > 0 && regressions === 0, targetGains, regressions };
}

// Today's target: the genre of the next Daily Drop, so every genre gets a turn and each fix ships before its drop.
export function nextTarget(now = Date.now()) {
  const drop = dailyDrop(new Date(+now + DAY));
  return { style: drop.style, genre: drop.genre, date: drop.date, title: drop.title };
}

export function readLedger(file = LEDGER) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return []; }
}

const fmt = (x) => (typeof x === 'number' ? +x.toFixed(3) : x);
export function toMarkdown({ target, comp, audio, v }) {
  const lines = [`## Quality ratchet: ${target}`, ''];
  lines.push(v.ok ? `PASS: ${v.targetGains} gain(s) in ${target}, no regressions.` : `NOT YET: ${v.targetGains} gain(s) in ${target}, ${v.regressions} regression(s).`, '');
  if (comp.gains.length) lines.push('Gains:', ...comp.gains.map((g) => `- ${g.style} ${g.metric}: ${fmt(g.from)} -> ${fmt(g.to)}`), '');
  if (comp.losses.length) lines.push('Regressions:', ...comp.losses.map((g) => `- ${g.style} ${g.metric}: ${fmt(g.from)} -> ${fmt(g.to)}`), '');
  if (audio) {
    lines.push(`Audio benchmark: WARN ${audio.warn[0]} -> ${audio.warn[1]}, FAIL ${audio.fail[0]} -> ${audio.fail[1]}`);
    if (audio.cleared.length) lines.push(...audio.cleared.map((r) => `- cleared ${r.level} ${r.style} ${r.check}`));
    if (audio.appeared.length) lines.push(...audio.appeared.map((r) => `- new ${r.level} ${r.style} ${r.check}: ${r.message}`));
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const json = (f) => (f ? JSON.parse(readFileSync(resolve(f), 'utf8')) : null);
  const ledger = readLedger();

  if (args.includes('--plan')) {
    const t = nextTarget(), base = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const peers = loopStyles().filter((id) => id !== t.style && STYLES[id].family === STYLES[t.style]?.family);
    const mine = base[t.style] || {}, gaps = [];
    // Where the target trails the best genre in its family: the most concrete place to look first.
    for (const k of [...HIGHER, ...LOWER].filter((k) => k !== 'bars')) {
      const vals = peers.map((p) => base[p]?.[k]).filter((x) => typeof x === 'number');
      if (!vals.length || typeof mine[k] !== 'number') continue;
      const best = HIGHER.includes(k) ? Math.max(...vals) : Math.min(...vals), gap = HIGHER.includes(k) ? best - mine[k] : mine[k] - best;
      if (gap > (TOL[k] ?? 0)) gaps.push(`${k} ${fmt(mine[k])} (family best ${fmt(best)})`);
    }
    const tried = ledger.filter((e) => e.target === t.style);
    console.log([`# Today's target: ${t.genre} (${t.style}), Daily Drop ${t.date} "${t.title}"`, '',
      `Family: ${STYLES[t.style]?.family || '?'}; peers ${peers.join(', ') || 'none'}`,
      `Trails its family on: ${gaps.join('; ') || 'nothing in the composition scorecard'}`, '',
      `Previous days on ${t.style}: ${tried.length ? '' : 'none'}`, ...tried.slice(-5).map((e) => `- ${e.date} [${e.lever}] ${e.summary}${e.pr ? ` (${e.pr})` : ''}`), '',
      'Last 7 days:', ...ledger.slice(-7).map((e) => `- ${e.date} ${e.target} [${e.lever}] ${e.summary}`), ''].join('\n'));
    process.exit(0);
  }

  const target = opt('target');
  if (!target || !STYLES[target]) { console.error('Pass --target <style id> (see --plan).'); process.exit(2); }
  const before = JSON.parse(readFileSync(BASELINE, 'utf8')), after = runComposition(loopStyles());
  const comp = compareComposition(before, after);
  if (!opt('audio-before') !== !opt('audio-after')) { console.error('Pass both --audio-before and --audio-after, or neither.'); process.exit(2); }
  const ab = json(opt('audio-before')), aa = json(opt('audio-after'));
  const mismatch = ab && aa ? audioMismatch(ab, aa) : [];
  if (mismatch.length) { console.error(`Audio reports are not comparable (${mismatch.join('; ')}); rerun both with the same --tier/--seeds/--styles.`); process.exit(2); }
  const audio = ab && aa ? compareAudio(ab, aa) : null;
  const v = verdict(comp, audio, target);
  process.stdout.write(toMarkdown({ target, comp, audio, v }));

  if (args.includes('--record')) {
    if (!v.ok && !args.includes('--force')) { console.error('Nothing to record: the target did not gain or something regressed.'); process.exit(1); }
    // Only gained metrics raise the floor; everything else keeps its old value so tolerance slack never ratchets down.
    const next = structuredClone(before);
    for (const style of Object.keys(after)) next[style] ??= after[style];
    for (const g of comp.gains) next[g.style][g.metric] = g.to;
    writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
    ledger.push({ date: new Date().toISOString().slice(0, 10), target, lever: opt('lever') || 'generator', summary: opt('summary') || '',
      ...(opt('pr') && { pr: opt('pr') }),
      gains: comp.gains.map((g) => `${g.style} ${g.metric} ${fmt(g.from)}->${fmt(g.to)}`),
      ...(audio && { audio: { warn: audio.warn, fail: audio.fail, cleared: audio.cleared.map((r) => `${r.style} ${r.check}`) } }) });
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
    console.log(`recorded ${comp.gains.length} gain(s) in ${BASELINE} and ${LEDGER}`);
  } else if (args.includes('--require-gain') && !v.ok) process.exit(1);
}
