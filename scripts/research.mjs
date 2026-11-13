// UNTERGRUND Research (/research): posts in research/posts/<slug>.md, each pinned to its own data snapshot
// research/data/<slug>.json, rendered at build time to static HTML with inline SVG charts and a PNG social card.
//
//   node scripts/research.mjs new <slug> --title "..." [--run]   snapshot the benchmark reports + scaffold a post
//   node scripts/research.mjs snapshot <slug> [--run]             (re)write research/data/<slug>.json only
//   node scripts/research.mjs build [outDir]                      render into outDir (default dist), as npm run build does
//
// --run runs the deep and fast audio benchmarks first (~20 min); otherwise the latest test/out reports are used.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../api/_lib/og.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.untergrund.sh';
export const SCHEMA = 'untergrund.research/1';
const POSTS = join(ROOT, 'research/posts'), DATA = join(ROOT, 'research/data');
const LEVEL = { PASS: 0, WARN: 1, FAIL: 2 };
const worse = (a, b) => (LEVEL[b] > LEVEL[a] ? b : a);
const r = (v, p = 2) => (Number.isFinite(v) ? +v.toFixed(p) : null);

// ---------------- snapshot ----------------

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

function compactAudio(rep, { charts }) {
  const styles = {};
  for (const [id, s] of Object.entries(rep.styles)) {
    const seeds = {};
    for (const [seed, d] of Object.entries(s.seeds || {})) {
      const x = { bars: d.bars, secs: r(d.secs, 1), bpm: d.bpm, loudness: { integrated: r(d.loudness?.integrated), deltaTarget: r(d.loudness?.deltaTarget), lra: r(d.loudness?.lra, 1) } };
      if (charts && d.barLufs) Object.assign(x, { barLufs: d.barLufs.map((v) => r(v, 1)), sections: (d.sections || []).map(({ label, from, to, lufs }) => ({ label, from, to, lufs: r(lufs, 1) })) });
      if (charts && d.ending) {
        const env = d.ending.envelopeDb || [];
        x.ending = { t40: r(d.ending.t40, 1), deadAirSec: r(d.ending.deadAirSec, 1), cliffDb: r(d.ending.cliffDb, 1), stepSec: 0.1, envelopeDb: env.filter((_, i) => i % 2 === 0).map((v) => r(v, 1)) };
      }
      seeds[seed] = x;
    }
    styles[id] = { name: s.name, family: s.family, verdict: s.verdict,
      metrics: Object.fromEntries(Object.entries(s.metrics).map(([k, m]) => [k, { worst: m.worst, worstSeed: m.worstSeed ?? null, level: m.level, ...(m.values && { values: m.values }) }])), seeds };
  }
  return {
    tier: rep.tier, verdict: rep.verdict, commit: rep.run?.commit ?? null, generated: rep.run?.generated ?? null, wallSec: rep.run?.wallSec ?? null,
    seeds: rep.seeds, counts: rep.counts, baseline: rep.baseline,
    checks: Object.fromEntries(Object.entries(rep.checks).map(([k, c]) => [k, { group: c.group, label: c.label, unit: c.unit, worseWhen: c.worseWhen, warn: c.warn, fail: c.fail, why: c.why }])),
    global: rep.global,
    reasons: rep.reasons.map(({ style, check, level, kind, seed, value, threshold, baseline, delta, message }) => ({ style, check, level, kind, seed, value, threshold, ...(baseline != null && { baseline, delta }), message })),
    closest: rep.closest.slice(0, 8), families: rep.families, styles,
  };
}

// The checked-in baselines' git history: the trend over time, without rerunning old commits.
function history() {
  const log = (path) => {
    try { return git('log', '--format=%h %cs', '--', path).split('\n').filter(Boolean).map((l) => l.split(' ')).reverse(); } catch { return []; }
  };
  const at = (sha, path) => { try { return JSON.parse(git('show', `${sha}:${path}`)); } catch { return null; } };
  const med = (xs) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const loudness = log('test/loudness-baseline.json').map(([commit, date]) => {
    const b = at(commit, 'test/loudness-baseline.json'), s = Object.values(b?.styles || {});
    const lufs = s.map((x) => x.lufs).filter(Number.isFinite), tp = s.map((x) => x.tp).filter(Number.isFinite);
    return lufs.length && { commit, date, genres: lufs.length, lufsMin: r(Math.min(...lufs)), lufsMax: r(Math.max(...lufs)), lufsMedian: r(med(lufs)), worstTruePeak: r(Math.max(...tp)) };
  }).filter(Boolean);
  const composition = log('test/composition-baseline.json').map(([commit, date]) => {
    const b = Object.values(at(commit, 'test/composition-baseline.json') || {});
    return b.length && { commit, date, genres: b.length, ...Object.fromEntries(['motifRecall', 'contrast', 'voiceMove', 'chords'].map((k) => [k, r(med(b.map((x) => x[k])), 3)])) };
  }).filter(Boolean);
  const audio = log('test/audio-baseline/deep.json').map(([commit, date]) => {
    const b = at(commit, 'test/audio-baseline/deep.json');
    return b?.counts && { commit, date, ...b.counts };
  }).filter(Boolean);
  return { loudness, composition, audio };
}

function runNode(args) { execFileSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] }); }

export async function takeSnapshot(slug, { run = false, deepFile, fastFile } = {}) {
  const out = (f) => (f === 'audio-benchmark-deep.json' && deepFile) || (f === 'audio-benchmark-fast.json' && fastFile) || join(ROOT, 'test/out', f);
  if (run) {
    runNode(['scripts/audio-benchmark.mjs', '--tier', 'deep', '--quiet', '--json', out('audio-benchmark-deep.json')]);
    runNode(['scripts/audio-benchmark.mjs', '--quiet', '--json', out('audio-benchmark-fast.json')]);
  }
  for (const f of ['audio-benchmark-deep.json', 'audio-benchmark-fast.json']) {
    if (!existsSync(out(f))) throw new Error(`test/out/${f} is missing: run with --run, or npm run benchmark:audio${f.includes('deep') ? ':deep' : ''} first`);
  }
  runNode(['scripts/music-benchmark.mjs', '--json', out('music-benchmark.json')]);
  const { runComposition, loopStyles, SEEDS } = await import('./composition.mjs');
  const music = readJson(out('music-benchmark.json'));
  const deep = readJson(out('audio-benchmark-deep.json')), fast = readJson(out('audio-benchmark-fast.json'));
  let commit = null;
  try { commit = git('rev-parse', '--short', 'HEAD'); } catch {}
  commit = deep.run?.commit?.slice(0, 7) || commit;
  const data = {
    schema: SCHEMA, slug, taken: new Date().toISOString(), commit,
    audio: { deep: compactAudio(deep, { charts: true }), fast: compactAudio(fast, { charts: false }) },
    composition: { seeds: SEEDS, styles: runComposition(loopStyles()) },
    music: { projects: music.projects, genres: music.genres, seeds: music.seeds?.length ?? null, determinism: music.determinism, genreDistance: { p10: music.genreDistance.p10, median: music.genreDistance.median, p90: music.genreDistance.p90, exactCollisions: music.genreDistance.exactCollisions } },
    history: history(),
  };
  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, `${slug}.json`), JSON.stringify(data) + '\n');
  return data;
}

const TEMPLATE = (title, date) => `---
title: ${title}
date: ${date}
summary: One or two sentences for the index and link previews.
card: ${title.toUpperCase().slice(0, 28)}
---
Lead paragraph. Numbers come from this post's own snapshot, e.g. {{v audio.deep.counts.PASS}} of {{v audio.deep.counts.styles}} genres pass.

{{kpis}}

## Scoreboard

{{chart scoreboard}}

## What it found

{{findings}}

{{chart loudness}}

{{chart truepeak}}

{{chart energy hypnotic,deephouse,neosoul,dnb,trance,amapiano,trap,symphony}}

{{chart endings hypnotic,deephouse,ambient,nocturne,trap}}

{{chart composition}}

{{chart trend}}

## What it can't conclude

Write this honestly.
`;

// ---------------- rendering helpers ----------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, p = 1) => (Number.isFinite(v) ? String(+v.toFixed(p)).replace('-', '−') : '–');
const signed = (v, p = 1) => (Number.isFinite(v) && v > 0 ? '+' : '') + num(v, p);
const FAMILY_ORDER = ['TECHNO', 'HOUSE', 'JAZZ & HIP-HOP', 'BREAKS & BASS', 'TRANCE & AMBIENT', 'AFRO & LATIN', 'TRAP & POP', 'CLASSICAL'];
const GROUPS = [['peaks', 'PEAK', 'Peaks'], ['loudness', 'LOUD', 'Loudness'], ['spectrum', 'TONE', 'Spectrum'], ['stereo', 'WIDE', 'Stereo'], ['balance', 'MIX', 'Balance'], ['silence', 'GAPS', 'Silence'], ['arrangement', 'FORM', 'Arrangement'], ['ending', 'END', 'Ending']];
const TINY = { peaks: 'PK', loudness: 'LUD', spectrum: 'TON', stereo: 'WID', balance: 'MIX', silence: 'GAP', arrangement: 'FRM', ending: 'END', fast: 'FST' };
const GLYPH = { PASS: '✓', WARN: '!', FAIL: '×' };
const PALETTE = ['var(--accent)', 'var(--teal)', 'var(--purple)', 'var(--orange)', 'var(--pink)', 'var(--green)', 'var(--yellow)', 'var(--red)'];
const WIDE = 680, NARROW = 350;

function styleOrder(audio) {
  return Object.keys(audio.styles).sort((a, b) => FAMILY_ORDER.indexOf(audio.styles[a].family) - FAMILY_ORDER.indexOf(audio.styles[b].family));
}

let figureId = 0;
function svg(w, h, title, desc, body) {
  const id = `c${++figureId}`;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="${id}t ${id}d"><title id="${id}t">${esc(title)}</title><desc id="${id}d">${esc(desc)}</desc>${body}</svg>`;
}
const text = (x, y, s, cls = '', anchor = 'start') => `<text x="${r(x, 1)}" y="${r(y, 1)}"${cls ? ` class="${cls}"` : ''}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}>${esc(s)}</text>`;
const line = (x1, y1, x2, y2, cls) => `<line x1="${r(x1, 1)}" y1="${r(y1, 1)}" x2="${r(x2, 1)}" y2="${r(y2, 1)}" class="${cls}"/>`;
const rect = (x, y, w, h, cls, extra = '') => `<rect x="${r(x, 1)}" y="${r(y, 1)}" width="${r(Math.max(0, w), 1)}" height="${r(Math.max(0, h), 1)}" class="${cls}"${extra}/>`;
const path = (pts, cls, extra = '') => `<path d="${pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r(x, 1)} ${r(y, 1)}`).join('')}" class="${cls}"${extra}/>`;

function table(head, rows, { numeric = true } = {}) {
  return `<div class="tbl"><table><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td${numeric ? ' class="n"' : ''}>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// One chart drawn twice, for a 680 px column and a phone; CSS shows one (the hidden one leaves the a11y tree).
function figure({ title, caption, draw, svgs, data, wideOnly = false }) {
  const viz = svgs ?? (wideOnly ? `<div class="viz">${draw(WIDE)}</div>` : `<div class="viz dual"><div class="wide">${draw(WIDE)}</div><div class="narrow">${draw(NARROW)}</div></div>`);
  return `<figure class="chart"><figcaption><b>${esc(title)}</b>${caption ? ` ${caption}` : ''}</figcaption>${viz}${data ? `<details><summary>Show the numbers</summary>${data}</details>` : ''}</figure>`;
}

// ---------------- charts ----------------

function groupLevels(audio, id) {
  const s = audio.styles[id], out = {};
  for (const [k, m] of Object.entries(s.metrics)) { const g = audio.checks[k]?.group; if (g) out[g] = worse(out[g] || 'PASS', m.level); }
  return out;
}

function scoreboard(d) {
  const deep = d.audio.deep, fast = d.audio.fast, ids = styleOrder(deep);
  const cols = [...GROUPS.map(([g, short]) => [g, short]), ['fast', 'FAST']];
  const draw = (W) => {
    const narrow = W < 500, lw = narrow ? 96 : 170, cw = (W - lw) / cols.length, rh = narrow ? 20 : 22, fh = 22, top = 30;
    let y = top, body = '';
    cols.forEach(([g, short], i) => { body += text(lw + cw * i + cw / 2, 18, narrow ? TINY[g] : short, narrow ? 'ax b tiny' : 'ax b', 'middle'); });
    let fam = null;
    for (const id of ids) {
      const s = deep.styles[id];
      if (s.family !== fam) { fam = s.family; y += 6; body += text(0, y + fh - 8, fam, 'fam'); y += fh; }
      const lv = groupLevels(deep, id);
      body += text(0, y + rh / 2 + 4, s.name, 'lab');
      cols.forEach(([g], i) => {
        const level = g === 'fast' ? fast.styles[id]?.verdict : lv[g];
        const x = lw + cw * i + 2;
        if (!level) { body += text(x + (cw - 4) / 2, y + rh / 2 + 4, '–', 'ax', 'middle'); return; }
        body += rect(x, y + 2, cw - 4, rh - 4, `cell lv-${level}`, ' rx="2"') + text(x + (cw - 4) / 2, y + rh / 2 + 4, GLYPH[level], 'glyph', 'middle');
      });
      y += rh;
    }
    const c = deep.counts;
    return svg(W, y + 6, 'Pass, warn and fail by genre and check group',
      `${c.styles} genres, ${c.songs} whole songs: ${c.PASS} pass, ${c.WARN} warn, ${c.FAIL} fail. Each cell is the worst result in that group of checks across the seeds. ${deep.reasons.filter((x) => x.level !== 'PASS').map((x) => `${deep.styles[x.style].name}: ${x.level} on ${deep.checks[x.check]?.label || x.check}`).join('; ')}.`, body);
  };
  const rows = ids.map((id) => { const lv = groupLevels(deep, id); return [deep.styles[id].name, ...GROUPS.map(([g]) => lv[g] || '–'), fast.styles[id]?.verdict || '–', deep.styles[id].verdict]; });
  return figure({ title: 'Scoreboard.', caption: `Each cell is a genre's worst result in one group of checks, over whole songs at seeds ${deep.seeds.join(', ')}. Columns: peaks, loudness, tone, stereo width, mix balance, gaps, form (arrangement), ending, and FAST, the quicker tier that runs on every change. ✓ pass, ! warn, × fail.`,
    draw, data: table(['Genre', ...GROUPS.map(([, , l]) => l), 'Fast tier', 'Overall'], rows, { numeric: false }) });
}

function loudnessChart(d) {
  const deep = d.audio.deep, ids = styleOrder(deep), c = deep.checks.loudnessTarget, lim = 4.5;
  const rowsData = ids.map((id) => {
    const s = deep.styles[id], seeds = Object.entries(s.seeds).map(([seed, x]) => ({ seed, delta: x.loudness.deltaTarget, lufs: x.loudness.integrated }));
    const worst = seeds.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a), seeds[0]);
    return { id, s, seeds, worst, target: r(worst.lufs - worst.delta, 0) };
  });
  const draw = (W) => {
    const narrow = W < 500, lw = narrow ? 92 : 150, rw = narrow ? 40 : 56, x0 = lw, x1 = W - rw, rh = 17, top = 26;
    const X = (v) => x0 + ((Math.max(-lim, Math.min(lim, v)) + lim) / (2 * lim)) * (x1 - x0), H = top + rowsData.length * rh + 26;
    let body = rect(X(-lim), top - 4, X(-c.fail) - X(-lim), H - top - 18, 'band-fail') + rect(X(c.fail), top - 4, X(lim) - X(c.fail), H - top - 18, 'band-fail')
      + rect(X(-c.fail), top - 4, X(-c.warn) - X(-c.fail), H - top - 18, 'band-warn') + rect(X(c.warn), top - 4, X(c.fail) - X(c.warn), H - top - 18, 'band-warn');
    for (const t of [-4, -3, -1.5, 0, 1.5, 3, 4]) { body += line(X(t), top - 4, X(t), H - 22, t === 0 ? 'axis0' : 'grid'); if (!narrow || [-3, 0, 3].includes(t)) body += text(X(t), H - 8, signed(t), 'ax', 'middle'); }
    body += text(X(0), 14, 'on target', 'ax', 'middle') + text(X(lim), 14, 'louder →', 'ax', 'end') + text(X(-lim), 14, '← quieter', 'ax');
    rowsData.forEach((row, i) => {
      const y = top + i * rh + rh / 2;
      body += text(0, y + 4, row.s.name, 'lab') + line(x0, y, x1, y, 'grid faint');
      for (const p of row.seeds) {
        const lvl = Math.abs(p.delta) > c.fail ? 'FAIL' : Math.abs(p.delta) > c.warn ? 'WARN' : 'PASS';
        body += `<circle cx="${r(X(p.delta), 1)}" cy="${y}" r="3.6" class="dot lv-${lvl}"/>`;
      }
      body += text(W, y + 4, signed(row.worst.delta), `val${Math.abs(row.worst.delta) > c.warn ? ' hot' : ''}`, 'end');
    });
    const off = rowsData.filter((x) => Math.abs(x.worst.delta) > c.warn);
    return svg(W, H, 'Whole-song loudness versus each genre\'s target',
      `Dots are seeds; the horizontal axis is integrated loudness minus the genre's target in LU. Shaded bands are the warn (±${c.warn} LU) and fail (±${c.fail} LU) guardrails. ${off.length ? off.map((x) => `${x.s.name} is ${signed(x.worst.delta)} LU at seed ${x.worst.seed}`).join('; ') : 'Every genre is within the warn band'}.`, body);
  };
  const rows = rowsData.map((x) => [x.s.name, `${num(x.target, 0)} LUFS`, ...x.seeds.map((p) => `${num(p.lufs)} (${signed(p.delta)})`)]);
  return figure({ title: 'Loudness vs target.', caption: `Integrated loudness of the whole song minus the genre's target (−10 LUFS club, −14 quiet, −16 classical). Each dot is one seed; the light band is a warning (over ±${c.warn} LU), the darker one a failure (over ±${c.fail} LU).`,
    draw, data: table(['Genre', 'Target', ...deep.seeds.map((s) => `Seed ${s} LUFS (Δ)`)], rows) });
}

function truePeakChart(d) {
  const deep = d.audio.deep, c = deep.checks.truePeak, all = [];
  for (const [id, s] of Object.entries(deep.styles)) for (const [seed, v] of Object.entries(s.metrics.truePeak?.values || {})) all.push({ id, seed, v });
  const lo = Math.floor(Math.min(...all.map((a) => a.v))), hi = 0, step = 0.25, bins = [];
  for (let b = lo; b < hi - 1e-9; b += step) bins.push({ from: b, to: b + step, n: all.filter((a) => a.v >= b && (a.v < b + step)).length });
  const max = Math.max(...bins.map((b) => b.n)), top = all.reduce((a, b) => (b.v > a.v ? b : a));
  const draw = (W) => {
    const x0 = 8, x1 = W - 8, y0 = 28, y1 = 170, H = 200, X = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
    let body = '';
    for (const b of bins) {
      const level = b.to > c.warn + 1e-9 ? 'WARN' : 'PASS', h = (b.n / max) * (y1 - y0);
      if (b.n) body += rect(X(b.from) + 1, y1 - h, X(b.to) - X(b.from) - 2, h, `bar lv-${level}`);
    }
    for (let t = lo; t <= hi; t++) body += line(X(t), y1, X(t), y1 + 4, 'grid') + text(X(t), y1 + 18, num(t, 0), 'ax', 'middle');
    body += line(X(-1), y0 - 14, X(-1), y1, 'ceiling') + text(X(-1) - 4, y0 - 4, 'limiter ceiling −1 dBTP', 'ax', 'end');
    body += line(x0, y1, x1, y1, 'axis0') + text(x1, y1 + 30, 'dBTP', 'ax', 'end');
    return svg(W, H, 'Distribution of true peaks over every rendered song',
      `${all.length} songs. Median ${num(deep.global.truePeak?.p50, 2)} dBTP, highest ${num(top.v, 2)} dBTP (${deep.styles[top.id].name}, seed ${top.seed}). The limiter ceiling is −1 dBTP; the warning starts above ${num(c.warn)} dBTP and failure at ${num(c.fail)} dBTP.`, body);
  };
  return figure({ title: 'True peaks.', caption: `Every rendered song's 4×-oversampled peak. The master limiter is set to −1 dBTP; nothing should cross ${num(c.warn)}. Highest: ${esc(deep.styles[top.id].name)} at ${num(top.v, 2)} dBTP.`,
    draw, data: table(['Bin (dBTP)', 'Songs'], bins.filter((b) => b.n).map((b) => [`${num(b.from, 2)} to ${num(b.to, 2)}`, b.n])) });
}

function panel({ W = 340, H = 128, title, sub, body: inner, desc }) {
  return svg(W, H, title, desc, text(0, 14, title, 'ptitle') + (sub ? text(W, 14, sub, 'ax', 'end') : '') + inner);
}

function energyChart(d, arg) {
  const deep = d.audio.deep, want = (arg ? arg.split(',') : styleOrder(deep)).filter((id) => deep.styles[id]);
  const seed = String(deep.seeds.includes(42) ? 42 : deep.seeds[0]);
  const panels = want.map((id) => {
    const s = deep.styles[id], x = s.seeds[seed];
    if (!x?.barLufs?.length) return '';
    const vals = x.barLufs, finite = vals.filter(Number.isFinite), peak = Math.max(...finite), floor = -24;
    const W = 340, x0 = 0, x1 = W, y0 = 30, y1 = 112, n = vals.length;
    const X = (i) => x0 + (i / n) * (x1 - x0), Y = (v) => y0 + (Math.min(0, Math.max(floor, v - peak)) / floor) * (y1 - y0);
    let body = '';
    (x.sections || []).forEach((sec, i) => {
      body += rect(X(sec.from), y0 - 6, X(sec.to) - X(sec.from), y1 - y0 + 6, i % 2 ? 'sec alt' : 'sec');
      if (X(sec.to) - X(sec.from) > 22) body += text(X(sec.from) + 3, y1 + 13, sec.label.slice(0, 7).toUpperCase(), 'ax tiny');
    });
    const pts = vals.map((v, i) => [X(i + 0.5), Y(Number.isFinite(v) ? v : peak + floor)]);
    body += path([[X(0), y1], ...pts, [X(n), y1]], 'area') + path(pts, 'curve');
    const contrast = s.metrics.contrast?.values?.[seed], pob = s.metrics.peakOverBreak?.values?.[seed];
    return `<div>${panel({ W, H: 130, title: s.name, sub: `spread ${num(contrast)} LU`, body,
      desc: `${s.name}, seed ${seed}: loudness of each of ${n} bars relative to the loudest bar (0 to −24 LU). Bar-to-bar spread (p90 − p10) is ${num(contrast)} LU${Number.isFinite(pob) ? `; peak sections sit ${signed(pob)} LU over the breakdowns` : ''}. Sections: ${(x.sections || []).map((q) => `${q.label} bars ${q.from + 1}–${q.to}`).join(', ')}.` })}</div>`;
  });
  const rows = want.map((id) => { const s = deep.styles[id]; return [s.name, s.seeds[seed]?.bars ?? '–', num(s.metrics.contrast?.values?.[seed]), signed(s.metrics.peakOverBreak?.values?.[seed]), signed(s.metrics.peakOverIntro?.values?.[seed]), (s.seeds[seed]?.sections || []).map((q) => q.label).join(' · ')]; });
  return figure({ title: 'Energy over the song.', caption: `Bar-by-bar loudness for one song per family (seed ${seed}), relative to its loudest bar; shaded blocks are the arrangement's sections. A flat line is a loop; a dip and a return is a breakdown and a drop.`,
    svgs: `<div class="viz grid2">${panels.join('')}</div>`, data: table(['Genre', 'Bars', 'Spread LU', 'Peak − breakdown LU', 'Peak − intro LU', 'Sections'], rows) });
}

function endingsChart(d, arg) {
  const deep = d.audio.deep, want = (arg ? arg.split(',') : ['ambient', 'nocturne']).filter((id) => deep.styles[id]);
  const seed = String(deep.seeds.includes(42) ? 42 : deep.seeds[0]);
  const series = want.map((id, i) => {
    const s = deep.styles[id], e = s.seeds[seed]?.ending;
    if (!e?.envelopeDb?.length) return null;
    const ref = Math.max(...e.envelopeDb.filter(Number.isFinite));
    return { id, s, e, color: PALETTE[i % PALETTE.length], pts: e.envelopeDb.map((v, k) => [k * e.stepSec, Number.isFinite(v) ? v - ref : -90]) };
  }).filter(Boolean);
  const tMax = Math.min(24, Math.max(...series.map((x) => x.pts.length * x.e.stepSec)));
  const draw = (W) => {
    const x0 = 34, x1 = W - 6, y0 = 10, y1 = 190, H = 220, X = (t) => x0 + (Math.min(t, tMax) / tMax) * (x1 - x0), Y = (v) => y0 + (Math.min(0, Math.max(-60, v)) / -60) * (y1 - y0);
    let body = '';
    for (const v of [0, -20, -40, -60]) body += line(x0, Y(v), x1, Y(v), v === -40 ? 'ceiling' : 'grid') + text(x0 - 6, Y(v) + 4, num(v, 0), 'ax', 'end');
    for (let t = 0; t <= tMax; t += tMax > 12 ? 4 : 2) body += text(X(t), y1 + 16, `${t}s`, 'ax', 'middle');
    body += text(x1, Y(-40) - 5, '−40 dB', 'ax', 'end');
    for (const x of series) body += path(x.pts.filter(([t]) => t <= tMax).map(([t, v]) => [X(t), Y(v)]), 'curve thin', ` style="stroke:${x.color}"`);
    return svg(W, H, 'How each song\'s final hit decays', `Envelope of the ending from the final hit (0 dB) for seed ${seed}. ${series.map((x) => `${x.s.name} reaches −40 dB after ${num(x.e.t40)} s with ${num(x.e.deadAirSec)} s of dead air`).join('; ')}.`, body);
  };
  const legend = `<ul class="legend">${series.map((x) => `<li><i style="background:${x.color}"></i>${esc(x.s.name)} <span>${num(x.e.t40)} s to −40 dB</span></li>`).join('')}</ul>`;
  const c = deep.checks.ringOut;
  return figure({ title: 'Endings.', caption: `The final hit's decay, in dB below its peak (seed ${seed}). The benchmark warns when a ring-out takes longer than ${num(c?.warn)} s to fall 40 dB, or when the cut is abrupt.`,
    svgs: `<div class="viz dual"><div class="wide">${draw(WIDE)}</div><div class="narrow">${draw(NARROW)}</div></div>${legend}`,
    data: table(['Genre', 'Ring-out to −40 dB (s)', 'Steepest drop (dB/10 ms)', 'Dead air (s)'], series.map((x) => [x.s.name, num(x.e.t40), num(x.e.cliffDb), num(x.e.deadAirSec)])) });
}

const COMP = [['motifRecall', 'Motif recall', 'How often the hook comes back (0–1)', 2], ['contrast', 'Section contrast', 'How different sections are (0–1)', 2], ['voiceMove', 'Voice movement', 'Semitones per chord change; lower is smoother', 2], ['chords', 'Chords', 'Distinct chords per song', 0]];
function compositionChart(d) {
  const c = d.composition, ids = Object.keys(c.styles), names = d.audio.deep.styles;
  const max = Object.fromEntries(COMP.map(([k]) => [k, Math.max(...ids.map((id) => c.styles[id][k]))]));
  const rows = ids.map((id) => `<tr><th scope="row">${esc(names[id]?.name || id)}</th>${COMP.map(([k, , , p]) => `<td class="n"><span class="hb"><i style="width:${r((c.styles[id][k] / max[k]) * 100, 0)}%"></i></span>${num(c.styles[id][k], p)}</td>`).join('')}</tr>`).join('');
  const html = `<div class="tbl"><table class="comp"><thead><tr><th scope="col">Genre</th>${COMP.map(([, l]) => `<th scope="col">${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  return figure({ title: 'Composition scorecard.', caption: `Note-level measurements of every non-classical genre's full song, played through the real sequencer: the median of ${c.seeds.length} seeds. ${COMP.map(([, l, why]) => `<i>${esc(l)}</i>: ${esc(why)}.`).join(' ')}`, svgs: html });
}

function spark({ title, unit, points, fmt = (v) => num(v, 2), better }) {
  const W = 340, H = 120, x0 = 6, x1 = W - 6, y0 = 30, y1 = 92, ys = points.map((p) => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const X = (i) => (points.length === 1 ? (x0 + x1) / 2 : x0 + 14 + (i / (points.length - 1)) * (x1 - x0 - 28)), Y = (v) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);
  let body = line(x0, y1 + 4, x1, y1 + 4, 'grid') + path(points.map((p, i) => [X(i), Y(p.y)]), 'curve thin');
  points.forEach((p, i) => {
    body += `<circle cx="${r(X(i), 1)}" cy="${r(Y(p.y), 1)}" r="3" class="pt"/>`;
    if (i === 0 || i === points.length - 1) body += text(X(i), Y(p.y) - 8, fmt(p.y), 'val', i === 0 && points.length > 1 ? 'start' : 'end');
  });
  body += text(X(0), H - 6, points[0].x, 'ax tiny') + (points.length > 1 ? text(X(points.length - 1), H - 6, points.at(-1).x, 'ax tiny', 'end') : '');
  return `<div>${panel({ W, H, title, sub: unit, body, desc: `${title}${better ? ` (${better})` : ''}: ${points.map((p) => `${p.x} ${fmt(p.y)}`).join(', ')}.` })}</div>`;
}

function trendChart(d) {
  const h = d.history || {}, short = (x) => `${x.date.slice(5)} ${x.commit}`, out = [];
  if (h.loudness?.length) {
    out.push(spark({ title: 'Loudness spread across genres', unit: 'LU', better: 'lower is more even', points: h.loudness.map((x) => ({ x: short(x), y: x.lufsMax - x.lufsMin })) }));
    out.push(spark({ title: 'Loudest true peak of any genre', unit: 'dBTP', better: 'must stay under −1', points: h.loudness.map((x) => ({ x: short(x), y: x.worstTruePeak })) }));
  }
  if (h.composition?.length) {
    out.push(spark({ title: 'Median motif recall', unit: '0–1', better: 'higher means the hook returns', points: h.composition.map((x) => ({ x: short(x), y: x.motifRecall })), fmt: (v) => num(v, 3) }));
    out.push(spark({ title: 'Median voice movement', unit: 'semitones', better: 'lower is smoother', points: h.composition.map((x) => ({ x: short(x), y: x.voiceMove })), fmt: (v) => num(v, 2) }));
  }
  if (!out.length) return '';
  const rows = [...(h.loudness || []).map((x) => [`${x.date} ${x.commit}`, 'loudness baseline', `${num(x.lufsMin, 2)} to ${num(x.lufsMax, 2)} LUFS, peak ${num(x.worstTruePeak, 2)} dBTP`]),
    ...(h.composition || []).map((x) => [`${x.date} ${x.commit}`, 'composition baseline', `motif ${num(x.motifRecall, 3)}, contrast ${num(x.contrast, 3)}, voice move ${num(x.voiceMove, 2)}`])];
  return figure({ title: 'Over time.', caption: 'Every commit that re-recorded a checked-in baseline, oldest to newest. These come from the repository history, not from rerunning old code.',
    svgs: `<div class="viz grid2">${out.join('')}</div>`, data: table(['Commit', 'Baseline', 'Summary'], rows, { numeric: false }) });
}

// Crest, clipper shaving and bus saturation side by side: where each genre's peaks go.
function squashChart(d) {
  const deep = d.audio.deep, ids = styleOrder(deep).filter((id) => deep.styles[id].metrics.crest);
  if (!ids.length) return '';
  const ck = deep.checks, cols = [
    { id: 'crest', head: 'Crest p10', tiny: 'CREST', unit: 'dB', max: 14, fmt: (v) => num(v, 1), lines: [ck.crest?.warn, ck.crest?.fail] },
    { id: 'clipperShare', head: 'Clipper > 1 dB', tiny: 'CLIP', unit: '%', max: 0.3, fmt: (v) => `${num(v * 100, 1)}%`, lines: [ck.clipperShare?.warn, ck.clipperShare?.fail] },
    { id: 'saturatorDepth', head: 'Saturator (DRIVE)', tiny: 'DRIVE', unit: 'dB', max: 8, fmt: (v) => num(v, 1), lines: [], drive: true },
  ];
  const val = (id, c) => deep.styles[id].metrics[c.id]?.worst ?? null;
  const draw = (W) => {
    const narrow = W < 500, lw = narrow ? 106 : 150, gap = narrow ? 8 : 16, cw = (W - lw - gap * (cols.length - 1)) / cols.length, rh = 17, top = 30;
    let body = '';
    cols.forEach((c, i) => {
      const x = lw + i * (cw + gap), X = (v) => x + (Math.max(0, Math.min(c.max, v)) / c.max) * cw;
      body += text(x, 14, narrow ? c.tiny : c.head, 'ax b');
      c.lines.forEach((t, k) => { if (t != null) body += line(X(t), top - 6, X(t), top + ids.length * rh, k ? 'ceiling' : 'warnline'); });
      ids.forEach((id, j) => {
        const v = val(id, c), y = top + j * rh;
        if (v == null) return;
        const level = c.drive ? 'drive' : `lv-${deep.styles[id].metrics[c.id].level}`;
        body += rect(x, y + 3, X(v) - x, rh - 6, `sq ${c.drive ? 'drive' : level === 'lv-PASS' ? 'ok' : level}`);
        if (!narrow) body += text(X(v) + 4, y + rh / 2 + 4, c.fmt(v), 'ax');
      });
      body += line(x, top + ids.length * rh, x + cw, top + ids.length * rh, 'axis0');
    });
    ids.forEach((id, j) => { body += text(0, top + j * rh + rh / 2 + 4, deep.styles[id].name, 'lab'); });
    const H = top + ids.length * rh + 8, low = ids.filter((id) => deep.styles[id].metrics.crest.level !== 'PASS').map((id) => `${deep.styles[id].name} ${num(val(id, cols[0]), 1)} dB`);
    const sat = [...ids].sort((a, b) => (val(b, cols[2]) ?? 0) - (val(a, cols[2]) ?? 0)).slice(0, 3).map((id) => `${deep.styles[id].name} ${num(val(id, cols[2]), 1)} dB`);
    const clip = [...ids].sort((a, b) => (val(b, cols[1]) ?? 0) - (val(a, cols[1]) ?? 0))[0];
    return svg(W, H, 'Crest factor, clipper shaving and bus saturation by genre',
      `Worst seed per genre. Crest factor under ${num(ck.crest?.warn)} dB warns: ${low.join(', ') || 'none'}. Most clipper shaving: ${deep.styles[clip].name}, ${cols[1].fmt(val(clip, cols[1]))} of frames over 1 dB (warn at ${num(ck.clipperShare?.warn * 100)}%). Deepest bus saturation (DRIVE, not gated): ${sat.join(', ')}.`, body);
  };
  const rows = ids.map((id) => [deep.styles[id].name, ...cols.map((c) => (val(id, c) == null ? '–' : c.fmt(val(id, c)))), deep.styles[id].metrics.hardClip ? `${num(deep.styles[id].metrics.hardClip.worst * 100, 1)}%` : '–', deep.styles[id].metrics.limiterOver6 ? `${num(deep.styles[id].metrics.limiterOver6.worst * 100, 1)}%` : '–']);
  return figure({ title: 'Where the peaks go.', caption: `Three ways a mix loses its transients, worst seed per genre. <i>Crest</i>: peak over RMS of the most squashed bars; under ${num(ck.crest?.warn)} dB warns. <i>Clipper</i>: share of the song where the master clipper takes more than 1 dB off a peak; over ${num(ck.clipperShare?.warn * 100)}% warns. <i>Saturator</i>: how hard the bus saturator, the style's DRIVE, presses the loudest peaks. It is sound design, so it is tracked, not graded.`,
    draw, data: table(['Genre', 'Crest p10 (dB)', 'Clipper > 1 dB', 'Saturator p99 (dB)', 'Clipper input at full scale', 'Limiter over 6 dB'], rows) });
}

function findings(d) {
  const seen = new Set(), items = [];
  for (const [tier, a] of [['deep', d.audio.deep], ['fast', d.audio.fast]]) {
    for (const x of a.reasons) {
      const key = `${x.style}:${x.check}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(`<li class="lv-${x.level}"><b class="badge">${x.level}</b><span><strong>${esc(a.styles[x.style]?.name || x.style)}</strong> · ${esc(x.message)}${tier === 'fast' ? ' <em>(fast tier)</em>' : ''}</span></li>`);
    }
  }
  return items.length ? `<ul class="findings">${items.join('')}</ul>` : '<p>No warnings or failures.</p>';
}

function closest(d) {
  const a = d.audio.deep;
  return `<ul class="findings near">${a.closest.slice(0, 5).map((x) => `<li><b class="badge">NEAR</b><span><strong>${esc(a.styles[x.style]?.name || x.style)}</strong> · ${esc(a.checks[x.check]?.label || x.check)} ${num(x.value, 2)} ${esc(a.checks[x.check]?.unit || '')} (seed ${x.seed})</span></li>`).join('')}</ul>`;
}

function kpis(d) {
  const a = d.audio.deep, m = d.music;
  const k = [[`${a.counts.styles}`, 'genres'], [`${a.counts.songs}`, 'whole songs rendered'], [`${a.counts.PASS} · ${a.counts.WARN} · ${a.counts.FAIL}`, 'pass · warn · fail'], [`${Math.round((m.determinism?.rate ?? 0) * 100)}%`, `of ${m.projects} seeded projects reproduce exactly`]];
  return `<dl class="kpis">${k.map(([v, l]) => `<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

const CHARTS = { scoreboard, loudness: loudnessChart, truepeak: truePeakChart, energy: energyChart, endings: endingsChart, composition: compositionChart, trend: trendChart, squash: squashChart };

// ---------------- posts ----------------

const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
function inline(s, data) {
  return esc(s)
    .replace(/\{\{v ([\w.\-]+)(?:\|(\d))?\}\}/g, (_, p, digits) => { const v = get(data, p); if (v == null) throw new Error(`research: no value at ${p}`); return typeof v === 'number' ? (digits ? v.toFixed(+digits).replace('-', '−') : num(v, 2)) : esc(v); })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${href}">${t}</a>`);
}

const plain = (s, data) => inline(s, data).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function parsePost(src, slug) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`research/posts/${slug}.md: missing front matter`);
  const meta = Object.fromEntries(m[1].split('\n').filter(Boolean).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  for (const k of ['title', 'date', 'summary']) if (!meta[k]) throw new Error(`research/posts/${slug}.md: front matter needs ${k}`);
  return { slug, ...meta, data: meta.data || slug, body: m[2] };
}

function renderBody(body, data) {
  const out = [];
  for (const block of body.trim().split(/\n{2,}/)) {
    const b = block.trim(), dir = b.match(/^\{\{(chart|kpis|findings|closest)(?: (\w+))?(?: ([\w,]+))?\}\}$/);
    if (dir) {
      if (dir[1] === 'chart') { const f = CHARTS[dir[2]]; if (!f) throw new Error(`research: unknown chart ${dir[2]}`); out.push(f(data, dir[3])); } else out.push({ kpis, findings, closest }[dir[1]](data));
    } else if (b.startsWith('## ')) out.push(`<h2 id="${b.slice(3).toLowerCase().replace(/[^a-z0-9]+/g, '-')}">${inline(b.slice(3), data)}</h2>`);
    else if (b.startsWith('### ')) out.push(`<h3>${inline(b.slice(4), data)}</h3>`);
    else if (/^- /.test(b)) out.push(`<ul>${b.split(/\n(?=- )/).map((li) => `<li>${inline(li.slice(2).replace(/\n\s*/g, ' '), data)}</li>`).join('')}</ul>`);
    else if (b.startsWith('> ')) out.push(`<aside class="note">${inline(b.replace(/^> ?/gm, '').replace(/\n/g, ' '), data)}</aside>`);
    else out.push(`<p>${inline(b.replace(/\n/g, ' '), data)}</p>`);
  }
  return out.join('\n');
}

// ---------------- social card (1200x630 PNG, no canvas) ----------------

const FONT = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110', D: '11110100011000110001100011000111110',
  E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000', G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001', O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001', S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100', W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100011000101010001000010000100', Z: '11111000010001000100010001000011111', 0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110',
  2: '01110100010000100010001000100011111', 3: '11111000100010000010000011000101110', 4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110',
  6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000', 8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100',
  '-': '00000000000000011111000000000000000', '.': '00000000000000000000000000110001100', '·': '00000000000110001100000000000000000', '/': '00001000100001000100010000100010000',
  ':': '00000011000110000000011000110000000', ',': '00000000000000000000011000010001000', "'": '00100001000100000000000000000000000', '&': '01100100101010001000101011001001101', ' ': '0'.repeat(35),
};
const HEX = { bg: [28, 28, 30], panel: [36, 36, 38], text: [236, 236, 240], dim: [152, 152, 159], accent: [10, 132, 255], PASS: [48, 209, 88], WARN: [255, 214, 10], FAIL: [255, 69, 58], none: [56, 56, 58] };

function card({ eyebrow, title, line: sub, grid }) {
  const W = 1200, H = 630, px = Buffer.alloc(W * H * 3);
  const fill = (x, y, w, h, c) => { for (let j = Math.max(0, y | 0); j < Math.min(H, (y + h) | 0); j++) for (let i = Math.max(0, x | 0); i < Math.min(W, (x + w) | 0); i++) { const o = (j * W + i) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; } };
  const write = (s, x, y, scale, c, spacing = 1) => {
    for (const ch of s.toUpperCase()) {
      const g = FONT[ch] ?? FONT[' '];
      for (let k = 0; k < 35; k++) if (g[k] === '1') fill(x + (k % 5) * scale, y + Math.floor(k / 5) * scale, scale, scale, c);
      x += (5 + spacing) * scale;
    }
    return x;
  };
  const width = (s, scale, spacing = 1) => s.length * (5 + spacing) * scale;
  fill(0, 0, W, H, HEX.bg);
  fill(72, 72, 36, 36, HEX.accent); fill(78, 78, 24, 24, HEX.bg); fill(85, 85, 10, 10, HEX.accent);
  write('UNTERGRUND', 128, 79, 3, HEX.text, 2); write(eyebrow, 128 + width('UNTERGRUND', 3, 2) + 24, 79, 3, HEX.dim, 2);
  const words = title.toUpperCase().split(' '), lines = [];
  for (const w of words) { const cur = lines.at(-1); if (cur && width(`${cur} ${w}`, 9) <= (grid ? 640 : 1056)) lines[lines.length - 1] = `${cur} ${w}`; else lines.push(w); }
  lines.slice(0, 3).forEach((l, i) => write(l, 72, 196 + i * 84, 9, HEX.text));
  if (sub) { let x = 72; for (const [s, c] of sub) x = write(s, x, 520, 4, HEX[c] || HEX.dim); }
  if (grid) {
    const cols = grid[0].length, cw = 30, ch = 13, gx = 1128 - cols * cw, gy = 168;
    grid.forEach((row, j) => row.forEach((lv, i) => fill(gx + i * cw, gy + j * ch, cw - 4, ch - 3, HEX[lv] || HEX.none)));
  }
  fill(0, H - 6, W, 6, HEX.accent);
  return encodePng(px, W, H);
}

function gridOf(data) {
  const deep = data.audio.deep;
  return styleOrder(deep).map((id) => { const lv = groupLevels(deep, id); return [...GROUPS.map(([g]) => lv[g] || 'none'), data.audio.fast.styles[id]?.verdict || 'none']; });
}

// ---------------- pages ----------------

let cssCache = null;
function css() {
  if (cssCache) return cssCache;
  const root = readFileSync(join(ROOT, 'css/style.css'), 'utf8').match(/:root\s*\{[\s\S]*?\}/)[0];
  cssCache = (root + readFileSync(join(ROOT, 'css/research.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '');
  return cssCache;
}
const fmtDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

function page({ title, description, url, image, imageAlt, type = 'website', body, published }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${url}" />
<meta name="theme-color" content="#1c1c1e" />
<meta property="og:type" content="${type}" />
<meta property="og:site_name" content="UNTERGRUND" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${esc(imageAlt)}" />
${published ? `<meta property="article:published_time" content="${published}" />\n` : ''}<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${image}" />
<link rel="alternate" type="application/rss+xml" title="UNTERGRUND Research" href="/research/feed.xml" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%23070708'/><rect x='6' y='6' width='20' height='20' fill='none' stroke='%23ff2b2b' stroke-width='3'/><rect x='13' y='13' width='6' height='6' fill='%23ff2b2b'/></svg>" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter+Tight:wght@500;700;900&display=swap" rel="stylesheet" />
<style>${css()}</style>
</head>
<body>
<header class="rs-top"><a class="rs-brand" href="/research/" aria-label="UNTERGRUND Research"><span class="logo" aria-hidden="true"><b></b></span>UNTERGRUND<span class="rs-section">RESEARCH</span></a><a class="rs-app" href="/">Open the app</a></header>
${body}
<footer class="rs-foot"><a href="/research/">All research</a><a href="/research/feed.xml">RSS</a><a href="https://github.com/kllyjsn/Untergrund">Source</a><a href="/">UNTERGRUND</a></footer>
</body>
</html>
`;
}

export function loadPosts(root = ROOT) {
  const dir = join(root, 'research/posts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const post = parsePost(readFileSync(join(dir, f), 'utf8'), f.slice(0, -3));
    const file = join(root, 'research/data', `${post.data}.json`);
    if (!existsSync(file)) throw new Error(`research/posts/${f}: data snapshot research/data/${post.data}.json is missing (node scripts/research.mjs snapshot ${post.data})`);
    const data = readJson(file);
    if (data.schema !== SCHEMA) throw new Error(`research/data/${post.data}.json: schema ${data.schema}, want ${SCHEMA}`);
    return { ...post, dataset: data };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

function renderPost(post) {
  const d = post.dataset, deep = d.audio.deep, url = `${SITE}/research/${post.slug}`;
  const sub = [[`${deep.counts.PASS} PASS`, 'PASS'], ['  ·  ', 'dim'], [`${deep.counts.WARN} WARN`, 'WARN'], ['  ·  ', 'dim'], [`${deep.counts.FAIL} FAIL`, 'FAIL']];
  const body = `<main class="rs-main"><article>
<p class="rs-eyebrow"><time datetime="${post.date}">${fmtDate(post.date)}</time> · Benchmark snapshot <code>${esc(d.commit || '')}</code></p>
<h1>${esc(post.title)}</h1>
<p class="rs-dek">${inline(post.summary, d)}</p>
${renderBody(post.body, d)}
<aside class="rs-method"><h2>Reproduce this</h2><p>Every number and chart on this page is generated from <a href="https://github.com/kllyjsn/Untergrund/blob/main/research/data/${esc(post.data)}.json">research/data/${esc(post.data)}.json</a>, a snapshot of the benchmark reports taken at commit <code>${esc(d.commit || '?')}</code> on ${esc(d.taken.slice(0, 10))}. The audio was rendered by the real engine in headless Chrome; the deep tier took ${num((deep.wallSec || 0) / 60, 0)} minutes on 8 pages. To refresh: <code>node scripts/research.mjs new &lt;slug&gt; --title "…" --run</code>, then <code>npm run build</code>.</p></aside>
</article></main>`;
  return { html: page({ title: `${post.title} · UNTERGRUND Research`, description: plain(post.summary, d), url, image: `${url}/og.png`, imageAlt: `${post.title}: ${deep.counts.PASS} pass, ${deep.counts.WARN} warn, ${deep.counts.FAIL} fail across ${deep.counts.styles} genres.`, type: 'article', body, published: post.date }),
    png: card({ eyebrow: 'RESEARCH', title: post.card || post.title, line: sub, grid: gridOf(d) }) };
}

// UNTERGRUND vs Suno (scripts/suno-benchmark.mjs score --write): the checked-in blind A/B scorecard, or a placeholder.
export const SUNO_RESULTS = 'research/suno/results.json';
export function loadSuno(root = ROOT) {
  const file = join(root, SUNO_RESULTS);
  if (!existsSync(file)) return null;
  const d = readJson(file);
  if (d.schema !== 'untergrund.lab-versus/1') throw new Error(`${SUNO_RESULTS}: schema ${d.schema}, want untergrund.lab-versus/1`);
  return d.overall?.ratings ? d : null;
}
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
function sunoSection(d) {
  const how = '<a href="https://github.com/kllyjsn/Untergrund/blob/main/docs/suno-benchmark.md">How the benchmark works</a>';
  if (!d) return `<section class="rs-suno" aria-labelledby="suno-h"><h2 id="suno-h">UNTERGRUND vs Suno</h2><p class="rs-empty">No results yet. A blind A/B listening test pits our song for each of ${PROMPT_COUNT()} fixed prompts against a Suno song from the same prompt, rated on musicality, originality, genre accuracy and emotional pull. ${how}.</p></section>`;
  const o = d.overall, picks = (p) => `${p.ours} · ${p.theirs} · ${p.neither}`;
  const k = [[pct(o.winRate), 'win rate vs Suno, mean of the four dimensions'], [pct(o.replay.oursRate), 'picked ours to replay'], [pct(o.release.oursRate), 'picked ours to release'], [`${o.ratings}`, `rated pairs · ${d.listeners} listener${d.listeners === 1 ? '' : 's'}`]];
  const dims = table(['Dimension', 'Win rate', 'Ours', 'Suno', 'W · T · L'], Object.entries(o.dimensions).map(([n, x]) => [n, pct(x.winRate), num(x.ours, 2), num(x.theirs, 2), `${x.wins} · ${x.ties} · ${x.losses}`]));
  const genres = table(['Genre', 'Pairs', 'Win rate', 'Replay ours · Suno · neither', 'Release ours · Suno · neither'], Object.entries(d.genres).map(([g, x]) => [g, x.ratings, pct(x.winRate), picks(x.replay), picks(x.release)]));
  const keys = (d.songwritingKeys || []).filter(({ k }) => d.pairs.some((p) => p.songwriting?.[k] != null)).slice(0, 7);
  const songs = table(['Prompt', 'Win rate', ...keys.map(({ label, unit }) => (unit && unit !== 'share' && unit !== 'cv' ? `${label} (${unit})` : label))], d.pairs.map((p) => [p.title, pct(p.winRate), ...keys.map(({ k }) => (p.songwriting?.[k] == null ? '—' : num(p.songwriting[k], 2)))]));
  return `<section class="rs-suno" aria-labelledby="suno-h"><h2 id="suno-h">UNTERGRUND vs Suno</h2><p>Blind A/B: our song at a fixed seed against a Suno song from the same prompt, engine commit <code>${esc(d.commit || '?')}</code>. A win is the higher rating on a dimension; a tie counts half. ${how}.</p><dl class="kpis">${k.map(([v, l]) => `<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${dims}<h3>By genre</h3>${genres}<h3>Next to the ratings: reference-free songwriting metrics of our renders</h3>${songs}</section>`;
}
let promptCount = null;
const PROMPT_COUNT = () => (promptCount ??= (() => { try { return readJson(join(ROOT, 'research/suno/prompts.json')).prompts.length; } catch { return 'about 20'; } })());

function renderIndex(posts, suno = null) {
  const list = posts.map((p) => {
    const g = gridOf(p.dataset), c = p.dataset.audio.deep.counts;
    const strip = `<span class="strip" aria-hidden="true">${g.map((row) => `<i class="lv-${row.reduce((a, b) => (b === 'none' ? a : worse(a, b)), 'PASS')}"></i>`).join('')}</span>`;
    return `<li><a href="/research/${p.slug}"><time datetime="${p.date}">${fmtDate(p.date)}</time><h2>${esc(p.title)}</h2><p>${inline(p.summary, p.dataset)}</p>${strip}<span class="meta">${c.styles} genres · ${c.PASS} pass · ${c.WARN} warn · ${c.FAIL} fail</span></a></li>`;
  }).join('');
  let trend = '';
  if (posts.length > 1) {
    const pts = [...posts].reverse().map((p) => ({ x: p.date.slice(5), y: p.dataset.audio.deep.counts.PASS }));
    trend = figure({ title: 'Passing genres per post.', svgs: `<div class="viz grid2">${spark({ title: 'Genres passing every check', unit: 'count', points: pts, fmt: (v) => num(v, 0) })}${spark({ title: 'Genres failing a check', unit: 'count', points: [...posts].reverse().map((p) => ({ x: p.date.slice(5), y: p.dataset.audio.deep.counts.FAIL })), fmt: (v) => num(v, 0) })}</div>` });
  }
  const body = `<main class="rs-main"><h1>Research</h1><p class="rs-dek">How UNTERGRUND measures the music it makes: what we test, what the numbers say, and what they can't tell us. Every chart is generated from a checked-in benchmark snapshot.</p>${trend}${sunoSection(suno)}<ul class="rs-list">${list}</ul></main>`;
  const latest = posts[0];
  return { html: page({ title: 'Research · UNTERGRUND', description: 'Benchmarks of the music UNTERGRUND generates: loudness, peaks, arrangement and composition, with the data behind every chart.', url: `${SITE}/research/`, image: `${SITE}/research/og.png`, imageAlt: 'UNTERGRUND Research', body }),
    png: card({ eyebrow: 'RESEARCH', title: 'How we measure the sound', line: latest ? [[`LATEST: ${latest.dataset.audio.deep.counts.styles} GENRES TESTED`, 'dim']] : null, grid: latest ? gridOf(latest.dataset) : null }) };
}

function feed(posts) {
  const items = posts.map((p) => `<item><title>${esc(p.title)}</title><link>${SITE}/research/${p.slug}</link><guid>${SITE}/research/${p.slug}</guid><pubDate>${new Date(`${p.date}T12:00:00Z`).toUTCString()}</pubDate><description>${esc(plain(p.summary, p.dataset))}</description></item>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0"><channel><title>UNTERGRUND Research</title><link>${SITE}/research/</link><description>Benchmarks of the music UNTERGRUND generates.</description>${items}</channel></rss>\n`;
}

// Every research file keyed by URL path.
export function renderSite(root = ROOT) {
  figureId = 0; cssCache = null;
  const posts = loadPosts(root), files = new Map();
  const index = renderIndex(posts, loadSuno(root));
  files.set('/research/index.html', { type: 'text/html; charset=utf-8', body: index.html });
  files.set('/research/og.png', { type: 'image/png', body: index.png });
  files.set('/research/feed.xml', { type: 'application/rss+xml; charset=utf-8', body: feed(posts) });
  for (const p of posts) {
    const { html, png } = renderPost(p);
    files.set(`/research/${p.slug}/index.html`, { type: 'text/html; charset=utf-8', body: html });
    files.set(`/research/${p.slug}/og.png`, { type: 'image/png', body: png });
  }
  return files;
}

export function writeSite(outDir) {
  const files = renderSite();
  for (const [p, f] of files) { const out = join(outDir, p); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, f.body); }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, slug] = process.argv.slice(2), flag = (k) => process.argv.includes(`--${k}`), arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
  if (cmd === 'build') {
    const files = writeSite(resolve(slug && !slug.startsWith('--') ? slug : join(ROOT, 'dist')));
    console.log(`research: ${files.size} files`);
  } else if ((cmd === 'snapshot' || cmd === 'new') && /^[a-z0-9-]+$/.test(slug || '')) {
    const data = await takeSnapshot(slug, { run: flag('run'), deepFile: arg('deep') && resolve(arg('deep')), fastFile: arg('fast') && resolve(arg('fast')) });
    console.log(`wrote research/data/${slug}.json (deep ${data.audio.deep.verdict}: ${data.audio.deep.counts.PASS}/${data.audio.deep.counts.WARN}/${data.audio.deep.counts.FAIL}, commit ${data.commit})`);
    const post = join(POSTS, `${slug}.md`);
    if (cmd === 'new' && !existsSync(post)) {
      mkdirSync(POSTS, { recursive: true });
      writeFileSync(post, TEMPLATE(arg('title') || slug.replace(/-/g, ' '), new Date().toISOString().slice(0, 10)));
      console.log(`wrote research/posts/${slug}.md: edit the prose, then npm run build`);
    }
  } else {
    console.log('usage: node scripts/research.mjs new <slug> --title "..." [--run] [--deep report.json] [--fast report.json] | snapshot <slug> [same flags] | build [outDir]');
    process.exit(1);
  }
}
