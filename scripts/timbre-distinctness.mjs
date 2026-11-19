import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { withChrome } from '../test/chrome.mjs';
import { rankTimbres, MAX_CI_WIDTH } from '../js/timbre-metrics.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
if (args.includes('--help')) {
  console.log('node scripts/timbre-distinctness.mjs [--ref git-ref | --root worktree] [--json test/out/timbre.json] [--seeds 11,42,1234,73,211,997] [--styles a,b]');
  process.exit(0);
}
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const ref = option('--ref', null), commit = git('rev-parse', ref || 'HEAD');
let target = resolve(option('--root', root)), worktree;
const output = resolve(root, option('--json', 'test/out/timbre-distinctness.json'));
const seeds = option('--seeds', '11,42,1234,73,211,997').split(',').map(Number);
if (seeds.length < 3 || new Set(seeds).size !== seeds.length || seeds.some((v) => !Number.isFinite(v))) throw new Error('Need at least three distinct numeric seeds');
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const lab = dataUrl(readFileSync(resolve(root, 'js/lab-metrics.js'), 'utf8'));
const features = dataUrl(readFileSync(resolve(root, 'js/timbre-metrics.js'), 'utf8').replace("'./lab-metrics.js'", JSON.stringify(lab)));
try {
  if (ref) {
    worktree = resolve(root, '..', `untergrund-timbre-${process.pid}`);
    git('worktree', 'add', '--detach', worktree, commit); target = worktree;
  }
  process.chdir(target);
  const rows = await withChrome(async (run) => {
    await run(`(async () => { window.q = await import('/test/audio-quality-page.js'); window.tm = await import(${JSON.stringify(features)}); window.st = await import('/js/stems.js'); window.state = await import('/js/state.js'); })()`);
    const styles = option('--styles', null)?.split(',') || await run('Object.keys(window.state.STYLES)');
    const rows = [];
    for (const style of styles) for (const seed of seeds) {
      console.log(`Rendering ${style} seed=${seed}`);
      try {
        const roles = await run(`(async () => {
          const s = q.song(${JSON.stringify(style)}, ${seed});
          const piece = s.patterns.find(p => p.score)?.score?.piece;
          if (piece) await (await import('/js/repertoire.js')).loadPiece(piece);
          const p = q.plan(s, 8), from = p.peakBar, to = Math.min(p.bars, from + 8);
          const ids = st.stemList(s, p.bars), r = st.router(ids);
          let buf;
          try { buf = await q.render({...s, solos: {}}, from, to, {sampleRate: 24000, tail: 1, channels: ids.length * 2, onContext: r.onContext, onEngine: r.onEngine}); } finally { r.restore(); }
          const result = {};
          for (const [role, parts] of Object.entries(tm.ROLES)) {
            const channels = [new Float32Array(buf.length), new Float32Array(buf.length)];
            for (const id of parts) { const k = ids.indexOf(id); if (k < 0) continue; for(let c=0;c<2;c++) { const x = buf.getChannelData(k*2+c); for(let i=0;i<x.length;i++) channels[c][i] += x[i]; } }
            const notes = parts.flatMap(id => p.c.notes[id] || []).filter(n => n.t >= p.barTimes[from] && n.t < p.barTimes[to]).map(n => ({...n, t: n.t - p.barTimes[from] + 0.05})).sort((a,b) => a.t-b.t);
            result[role] = tm.timbreFeatures(channels, buf.sampleRate, notes);
            result[role].stemIds = parts.filter(id => ids.includes(id));
            result[role].noteCount = notes.length;
          }
          return result;
        })()`);
        rows.push({ style, seed, roles });
      } catch (error) {
        console.error(`UNMEASURED ${style}/${seed}: ${error.message}`);
        rows.push({ style, seed, roles: {}, error: error.message });
      }
    }
    return rows;
  });
  if (!rows) throw new Error('Chrome unavailable: no measurements made');
  const report = { schema: 'untergrund.timbre-distinctness/2', ref: ref || target, commit: ref ? commit : execFileSync('git', ['rev-parse', 'HEAD'], {cwd: target, encoding:'utf8'}).trim(), seeds, bars: 8, sampleRate: 24000, bootstrap: 500, maxCIWidth: MAX_CI_WIDTH, generated: new Date().toISOString(), rows, ...rankTimbres(rows) };
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  const print = (p, i) => console.log(`${i + 1}. ${p.a} / ${p.b}: ${p.status}; similarity=${p.similarity?.toFixed(3) ?? 'UNMEASURED'}; 95% CI=${p.ci?.map(x => x.toFixed(3)).join('..') ?? 'UNMEASURED'}; driver=${p.drivingRole ?? 'UNMEASURED'}`);
  console.log('Combined (melodic roles weight 3 each, drums weight 1):');
  report.pairs.filter(p => p.status === 'MEASURED').slice(0, 10).forEach(print);
  console.log('Melodic only:');
  report.melodicRanking.slice(0, 10).forEach(print);
  console.log(`UNMEASURED pairs: ${report.pairs.filter(p => p.status === 'UNMEASURED').length}/${report.pairs.length}`);
  console.log(`Drill neighbours: ${JSON.stringify(report.nearest.find(x => x.style === 'drill')?.neighbours ?? [])}`);
  console.log(`JSON: ${output}`);
} finally {
  process.chdir(root);
  if (worktree) git('worktree', 'remove', '--force', worktree);
}
