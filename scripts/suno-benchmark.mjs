// UNTERGRUND vs Suno: a blind A/B kit on top of the listening lab (lab.html). See docs/suno-benchmark.md.
//   node scripts/suno-benchmark.mjs [render] [--only id,id] [--dir suno-lab] [--pages 3] [--wav]
//       renders our song for every prompt in research/suno/prompts.json at its fixed seed (whatever main generates
//       today), writes <dir>/untergrund/<id>-untergrund.mp3, <dir>/manifest.json (each pair: ours vs the reference slot
//       suno/<id>.mp3) and <dir>/SUNO.md, the checklist of Suno prompts to generate by hand.
//   node scripts/suno-benchmark.mjs status [--dir suno-lab]     which Suno reference files are still missing
//   node scripts/suno-benchmark.mjs score results.json [more.json ...] [--dir suno-lab] [--write]
//       turns lab exports (one per listener) into the scorecard; --write updates research/suno/results.json for /research.
// Licensing: Suno audio is a local reference the user generates and drops into <dir>/suno/ himself. It is never
// committed (.gitignore), deployed (.vercelignore, not in the build), served (server.mjs) or fetched by anything here.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { STYLES, defaultState, generate, arrangement, songChain, applyOverrides } from '../js/state.js';
import { scoreSong } from './composition.mjs';
import { DIMENSIONS, SONGWRITING, versusScorecard } from '../js/lab-metrics.js';
export { DIMENSIONS, SONGWRITING };

export const OURS = 'untergrund', THEIRS = 'suno';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROMPTS = join(ROOT, 'research/suno/prompts.json');
export const RESULTS = join(ROOT, 'research/suno/results.json');
export const LOCAL_DIR = 'suno-lab';

export const loadPrompts = (file = PROMPTS) => JSON.parse(readFileSync(file, 'utf8'));
export const sunoFile = (id) => `suno/${id}.mp3`;
export const oursFile = (id) => `untergrund/${id}-untergrund.mp3`;

// The first UNTERGRUND genre that fits the prompt, matched on id or display name ("R&B" -> "rnb"), or null.
const norm = (x) => String(x).toLowerCase().replace(/&/g, 'n').replace(/[^a-z0-9]/g, '');
export function resolveStyle(prompt, styles = STYLES) {
  for (const want of prompt.styles) {
    const hit = Object.keys(styles).find((id) => norm(id) === norm(want) || norm(styles[id].name) === norm(want));
    if (hit) return hit;
  }
  return null;
}

// js/main.js planSet(), as test/audio-quality-page.js song() builds it for the render.
export function benchSong(style, seed) {
  const s = defaultState();
  s.scale = style === 'euphoric' ? 'major' : 'minor';
  const g = generate(style, seed, s.scale);
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  s.key = g.key;
  applyOverrides(s, g, true);
  s.chainOn = true; s.chain = songChain(style, seed); s.ending = true;
  if (g.pattern.score) s.bpm = g.bpm;
  return s;
}

// Reference-free songwriting metrics of our render: the composition scorecard (scripts/composition.mjs) for
// step-sequenced songs, the form from the chain, note facts from the recorder and the lab's audio metrics.
export function songwriting(style, seed, rendered) {
  const s = benchSong(style, seed), score = s.patterns.some((p) => p.score);
  const comp = score ? null : scoreSong(s);
  const sections = rendered?.sections || [];
  return {
    bpm: rendered?.bpm ?? s.bpm, bars: rendered?.bars ?? null, secs: rendered?.secs ?? null,
    sections: sections.length || null, distinctSections: sections.length ? new Set(sections.map((x) => x.label)).size : null,
    ...(comp && { melodyWindows: comp.melodyWindows, motifRecall: comp.motifRecall, chords: comp.chords, voiceMove: comp.voiceMove, contrast: comp.contrast, drumBars: comp.drumBars }),
    ...(rendered?.notes || {}),
    arcDb: rendered?.audio?.arcDb ?? null, crestDb: rendered?.audio?.crestDb ?? null, lufs: rendered?.audio?.lufs ?? null,
  };
}
export function buildManifest(prompts, rendered, { commit = null, generated = new Date().toISOString() } = {}) {
  const pairs = [], pending = [];
  for (const p of prompts.prompts) {
    const x = rendered[p.id];
    if (!x && resolveStyle(p)) continue;
    if (!x) { pending.push({ id: p.id, name: p.name, genre: p.genre, wants: p.styles }); continue; }
    pairs.push({
      id: p.id, title: p.name, genre: p.genre, style: x.style, seed: x.seed, prompt: p.suno.style,
      // No bpm/renderMs on the candidates: the lab would print grid error / render speed for ours only and unblind it.
      a: { id: OURS, file: oursFile(p.id) },
      b: { id: THEIRS, file: sunoFile(p.id) },
      songwriting: x.songwriting,
    });
  }
  return { id: `untergrund-vs-suno-${commit || 'local'}`, title: `UNTERGRUND vs Suno (${commit || 'working tree'})`, kind: 'suno', versus: { ours: OURS, theirs: THEIRS }, commit, generated, levelMatch: true, dimensions: DIMENSIONS, pairs, pending };
}

export const scorecard = (exports, manifest = null) => versusScorecard(exports, manifest, { ours: OURS, theirs: THEIRS });

function sunoChecklist(prompts, manifest, dir) {
  const lines = [`# Suno reference songs for ${manifest.title}`, '',
    `Generate one song per prompt in Suno (Create > Custom), download it as MP3 and save it as \`${dir}/suno/<id>.mp3\`.`,
    'Use the first generation Suno gives you (the left of the two clips) so neither side is cherry-picked. Keep Instrumental on while UNTERGRUND has no vocals.',
    'These files are a local reference only: never commit, upload or share them (docs/suno-benchmark.md).', '',
    '| id (file name) | genre | Suno title | Suno "Style of Music" | Instrumental |', '|---|---|---|---|---|',
    ...manifest.pairs.map((p) => { const q = prompts.prompts.find((x) => x.id === p.id); return `| \`${p.id}.mp3\` | ${q.name} | ${q.suno.title} | ${q.suno.style} | ${q.suno.instrumental ? 'on' : 'off'} |`; })];
  if (manifest.pending.length) lines.push('', `Pending (no UNTERGRUND genre fits yet, skipped): ${manifest.pending.map((p) => p.id).join(', ')}.`);
  return lines.join('\n') + '\n';
}

function status(dir, manifest) {
  const missing = manifest.pairs.filter((p) => !existsSync(join(dir, p.b.file)));
  const have = manifest.pairs.length - missing.length;
  console.log(`${have}/${manifest.pairs.length} Suno references in ${relative(process.cwd(), join(dir, 'suno')) || 'suno'}/${missing.length ? `; missing: ${missing.map((p) => `${p.id}.mp3`).join(', ')}` : ' (ready: open /lab.html and load the folder)'}`);
  return missing;
}

async function renderAll(prompts, dir, { only, pages, wav }) {
  const { withChrome } = await import('../test/chrome.mjs');
  const jobs = prompts.prompts.map((p) => ({ p, style: resolveStyle(p) })).filter((j) => j.style && (!only || only.includes(j.p.id)));
  mkdirSync(join(dir, 'untergrund'), { recursive: true }); mkdirSync(join(dir, 'suno'), { recursive: true });
  const rendered = {};
  const done = await withChrome(async (runs) => {
    runs = [runs].flat();
    for (const run of runs) await run(`import('/test/suno-benchmark-page.js').then((m) => { window.__s = m; })`);
    let next = 0;
    await Promise.all(runs.map(async (run) => {
      while (next < jobs.length) {
        const { p, style } = jobs[next++], seed = p.seed ?? prompts.seed;
        const x = await run(`window.__s.full(${JSON.stringify(style)}, ${seed})`), parts = [];
        for (let at = 0; at < x.bytes; at += 4 << 20) parts.push(Buffer.from(await run(`window.__s.chunk(${at}, ${4 << 20})`), 'base64'));
        const wavFile = join(dir, 'untergrund', `${p.id}-untergrund.wav`), mp3 = join(dir, oursFile(p.id));
        writeFileSync(wavFile, Buffer.concat(parts));
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wavFile, '-codec:a', 'libmp3lame', '-b:a', '256k', mp3]);
        if (!wav) rmSync(wavFile);
        rendered[p.id] = { ...x, songwriting: songwriting(style, seed, x) };
        console.log(`  ${p.id.padEnd(18)} ${style.padEnd(10)} seed ${seed}  ${x.secs}s  ${x.audio.lufs} LUFS  (${(x.renderMs / 1000).toFixed(0)} s)`);
      }
    }));
    return true;
  }, { pages });
  if (!done) throw new Error('No Chrome found: set CHROME_PATH');
  return rendered;
}

async function main() {
  const argv = process.argv.slice(2), flag = (k) => argv.includes(`--${k}`), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'render', dir = resolve(arg('dir', join(ROOT, LOCAL_DIR))), prompts = loadPrompts();
  const manifestFile = join(dir, 'manifest.json'), readManifest = () => (existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null);
  if (cmd === 'render') {
    let commit = null; try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch {}
    const only = arg('only') ? arg('only').split(',') : null, t0 = Date.now();
    console.log(`rendering ${only ? only.join(', ') : 'every prompt'} at commit ${commit} into ${relative(process.cwd(), dir) || '.'}/untergrund/`);
    const rendered = await renderAll(prompts, dir, { only, pages: +arg('pages', 3), wav: flag('wav') });
    const prev = readManifest();
    if (only && prev) for (const p of prev.pairs) if (!rendered[p.id]) rendered[p.id] = { style: p.style, seed: p.seed, songwriting: p.songwriting };
    const manifest = buildManifest(prompts, rendered, { commit });
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 1) + '\n');
    writeFileSync(join(dir, 'SUNO.md'), sunoChecklist(prompts, manifest, relative(ROOT, dir) || LOCAL_DIR));
    console.log(`wrote ${manifest.pairs.length} pairs to ${relative(process.cwd(), manifestFile)} in ${Math.round((Date.now() - t0) / 1000)} s${manifest.pending.length ? `; pending (no genre yet): ${manifest.pending.map((p) => p.id).join(', ')}` : ''}`);
    console.log(`next: generate the Suno songs listed in ${relative(process.cwd(), join(dir, 'SUNO.md'))}`);
    status(dir, manifest);
  } else if (cmd === 'status') {
    const manifest = readManifest();
    if (!manifest) throw new Error(`${manifestFile} is missing: run npm run benchmark:suno first`);
    status(dir, manifest);
  } else if (cmd === 'score') {
    const files = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--dir'));
    if (!files.length) throw new Error('usage: node scripts/suno-benchmark.mjs score results.json [more.json ...] [--write]');
    const card = scorecard(files.map((f) => JSON.parse(readFileSync(f, 'utf8'))), readManifest());
    console.log(`UNTERGRUND vs Suno: ${card.overall.ratings} rated pairs from ${card.listeners} listener(s); win rate ${card.overall.winRate}`);
    console.table(Object.fromEntries(DIMENSIONS.map((d) => [d, card.overall.dimensions[d]])));
    console.table(Object.fromEntries(Object.entries(card.genres).map(([g, t]) => [g, { pairs: t.ratings, winRate: t.winRate, replayOurs: t.replay.ours, replaySuno: t.replay.theirs, releaseOurs: t.release.ours, releaseSuno: t.release.theirs }])));
    if (flag('write')) { writeFileSync(RESULTS, JSON.stringify(card, null, 1) + '\n'); console.log(`wrote ${relative(process.cwd(), RESULTS)}: commit it, then npm run build to update /research`); }
  } else throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
