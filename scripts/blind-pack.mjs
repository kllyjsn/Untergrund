import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { STYLES } from '../js/state.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
export function hash(text) {
  let n = 2166136261;
  for (const c of String(text)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
export function random(seed) {
  let n = seed >>> 0;
  return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffle(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export function detectStyles(text, diff = '') {
  const canonical = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = ` ${canonical(text)} `;
  let shipped = true;
  const changed = diff.split('\n').filter((line) => {
    if (line.startsWith('diff --git ')) shipped = false;
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const path = line.slice(4).replace(/^[ab]\//, '');
      if (path !== '/dev/null') shipped = !/^(test|docs|research)\//.test(path) && !/\.md$/i.test(path);
      return false;
    }
    return shipped && /^[+-](?![+-])/.test(line);
  }).join('\n');
  return Object.entries(STYLES).filter(([id, style]) => {
    const named = [id, style.name].some((name) => words.includes(` ${canonical(name)} `));
    const literal = `['"\x60]${id}['"\x60]`;
    const condition = new RegExp(`\\bstyle\\s*(?:[!=]={1,2}|:|=)\\s*${literal}|${literal}\\s*[!=]={1,2}\\s*(?:[\\w]+\\.)?style\\b`);
    return named || condition.test(changed);
  }).map(([id]) => id);
}
export function parseMergedPR(message) {
  const [subject, ...body] = message.trim().split('\n');
  const merge = /^Merge pull request #(\d+)\b/.exec(subject);
  if (merge) return { number: Number(merge[1]), title: body.join('\n').trim() };
  const squash = /^(.*?)\s+\(#(\d+)\)$/.exec(subject);
  return squash ? { number: Number(squash[2]), title: squash[1] } : null;
}
export function mergedPRsBetween(base, head) {
  const mergedPRs = [];
  for (const sha of git('rev-list', '--first-parent', '--reverse', `${base}..${head}`).split('\n').filter(Boolean)) {
    const message = git('show', '-s', '--format=%B', sha), pr = parseMergedPR(message);
    if (!pr) continue;
    mergedPRs.push({ ...pr, commit: sha, styles: detectStyles(message, git('diff', `${sha}^1`, sha, '--', '.', ':!test/**', ':!docs/**', ':!research/**', ':!*.md')) });
  }
  return mergedPRs;
}
export function baseSelection(options, previous, now = Date.now()) {
  if (options.base) return { ref: options.base, sinceTime: options.since || null };
  if (options.since) return { ref: null, sinceTime: options.since };
  if (previous) {
    if (!previous.commit) throw new Error('Previous pack key lacks its head commit');
    return { ref: previous.commit, sinceTime: null };
  }
  return { ref: null, sinceTime: new Date(now - 86400000).toISOString() };
}
export function excerptWithFrom(source) {
  const signature = "{ kind = 'peak', bars = 8 } = {})";
  const selection = "const [a, b, tail] = kind === 'ending' ?";
  if (/export async function excerpt\([^\n]*\bfrom\s*=/.test(source)) return source;
  if (!source.includes(signature) || !source.includes(selection)) throw new Error('Cannot add explicit excerpt window support to this revision');
  return source.replace(signature, "{ kind = 'peak', bars = 8, from = null } = {})")
    .replace(selection, "const [a, b, tail] = from != null ? [from, Math.min(p.bars, from + bars), 0.5] : kind === 'ending' ?");
}
export function checkBarWindow(actual, expected = actual) {
  if (!Array.isArray(actual) || actual.length !== 2 || !actual.every(Number.isInteger) || actual[0] < 0 || actual[1] - actual[0] !== 8 || actual.some((n, i) => n !== expected[i])) throw new Error(`Excerpt bar window mismatch: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
  return [...actual];
}
export function selectExcerptWindow({ sections = null, chain = '', patterns = [], labels = {}, bars, peakBar }, windowBars = 8) {
  if (!Number.isInteger(bars) || !Number.isInteger(windowBars) || windowBars < 1 || bars < windowBars) throw new Error('Invalid song length for excerpt');
  const spans = [];
  let at = 0;
  if (sections) {
    for (const [kind, length] of sections) {
      if (!Number.isInteger(length) || length < 1) throw new Error('Invalid song section');
      const role = kind === 'c' ? 'chorus' : kind;
      spans.push({ role, label: role, from: at, to: at + length });
      at += length;
    }
  } else {
    for (const letter of chain) {
      const index = 'ABCDEFGH'.indexOf(letter);
      if (index < 0) throw new Error('Invalid song chain');
      const role = patterns[index]?.sec || (index >= 6 ? 'drop' : '');
      const label = labels[letter] || role || letter;
      const last = spans.at(-1);
      if (last && last.role === role && last.label === label) last.to++;
      else spans.push({ role, label, from: at, to: at + 1 });
      at++;
    }
  }
  const section = spans.find(({ role, label }) => /^(hook|drop|chorus)$/i.test(role) || /^(hook|drop|chorus)$/i.test(label));
  if (section) {
    if (Math.min(section.to, bars) - section.from < windowBars) throw new Error('First hook/drop section is too short for excerpt');
    return { barWindow: [section.from, section.from + windowBars], method: 'section', section };
  }
  if (!Number.isInteger(peakBar) || peakBar < 0 || peakBar + windowBars > bars) throw new Error('Invalid peak fallback window');
  return { barWindow: [peakBar, peakBar + windowBars], method: 'peak', section: null, fallbackReason: 'no-hook-drop-section' };
}
export function ratingSheet(pairs) {
  return '# Untergrund blind listening\n\nEach MP3 contains two versions of the same generated passage, separated by a short silence. The first/second order was randomized independently. The two excerpts in each pair are matched to within 0.1 LU.\n\nListen at the same playback volume. Rate each pair as a whole from **1 (poor) to 5 (excellent)**, then choose **first**, **second**, or **tie** for release. Judge whether the kick, bass and lead are easy to distinguish without losing the groove or character. If the difference does not matter to you, choose tie. For every pair, write one short reason (one line) in the Why column.\n\n| Pair | Pair rating (1–5) | First / second / tie | Why |\n| --- | --- | --- | --- |\n' + pairs.map((p) => `| ${p.pair} | | | |`).join('\n') + '\n\nThese are before/after mixes, not a competitive comparison. This pack does not contain the answer key or automated preferences.\n';
}
export function seedOverrides(text = '') {
  const out = {};
  for (const pair of text.split(',').filter(Boolean)) {
    const [style, value, ...rest] = pair.split(':');
    const seed = Number(value);
    if (!Object.hasOwn(STYLES, style) || value === undefined || value === '' || rest.length || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || Object.hasOwn(out, style)) throw new Error(`Invalid genre seed: ${pair}`);
    out[style] = seed;
  }
  return out;
}
export function selectStyles(detected, priority = [], maxPairs = Infinity, explicit = null) {
  if (maxPairs !== Infinity && (!Number.isInteger(maxPairs) || maxPairs < (explicit ? 1 : 4))) throw new Error('Invalid max-pairs');
  if (explicit && !explicit.length) throw new Error('Explicit styles must not be empty');
  const candidates = [...new Set(explicit || ['minimal', 'drill', 'hardtechno', 'trap', ...priority, ...detected])];
  for (const style of candidates) if (!Object.hasOwn(STYLES, style)) throw new Error(`Unknown genre: ${style}`);
  return { selected: candidates.slice(0, maxPairs), dropped: candidates.slice(maxPairs) };
}
export function baselineOverrides(text = '') {
  const out = {};
  for (const entry of text.split(',').filter(Boolean)) {
    const [style, commit, ...rest] = entry.split(':');
    if (!Object.hasOwn(STYLES, style) || !/^[a-f0-9]{7,40}$/i.test(commit || '') || rest.length || Object.hasOwn(out, style)) throw new Error(`Invalid baseline: ${entry}`);
    out[style] = commit;
  }
  return out;
}
export function planPairs(styles, seed, seeds, base, head, baselines = {}, nullControl = false, nullCandidates = Object.keys(STYLES)) {
  if (!styles.length) throw new Error('Cannot plan an empty pack');
  const rng = random(seed);
  const entries = styles.map((style) => ({ style, kind: 'comparison', baselineCommit: baselines[style] || base }));
  if (nullControl) {
    const available = [...new Set(nullCandidates)].filter((style) => !styles.includes(style));
    if (!available.length) throw new Error('Null control requires a style outside the real pairs');
    for (const style of available) if (!Object.hasOwn(STYLES, style)) throw new Error(`Unknown null genre: ${style}`);
    entries.push({ style: available[Math.floor(rng() * available.length)], kind: 'null', baselineCommit: head, nullCommit: head });
  }
  return shuffle(entries, rng).map((p, i) => {
    const first = rng() < 0.5 ? 'original' : 'revised';
    return { ...p, pair: String(i + 1).padStart(2, '0'), genre: STYLES[p.style].name, renderSeed: seeds[p.style] ?? (hash(`${seed}:${p.style}`) || 1), bars: 8, first, second: first === 'original' ? 'revised' : 'original', commits: { original: p.baselineCommit, revised: head } };
  });
}
export function pcmDifference(original, revised, threshold = 0.001) {
  if (!original.length || !revised.length || !Number.isFinite(threshold) || threshold < 0) throw new Error('Invalid PCM comparison');
  let xx = 0, yy = 0, xy = 0, dd = 0;
  for (let i = 0; i < Math.max(original.length, revised.length); i++) {
    const x = original[i] ?? 0, y = revised[i] ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid PCM sample');
    xx += x * x; yy += y * y; xy += x * y; dd += (x - y) ** 2;
  }
  if (!xx || !yy) throw new Error('Silent PCM comparison');
  const rawRelativeRMS = Math.sqrt(dd / yy), gainMatchedRelativeRMS = Math.sqrt(Math.max(0, yy - xy * xy / xx) / yy);
  return { rawRelativeRMS, gainMatchedRelativeRMS, baselineGain: xy / xx, threshold, different: gainMatchedRelativeRMS > threshold };
}
function compareFiles(original, revised, threshold) {
  const decode = (file) => {
    const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ar', '48000', '-ac', '2', '-f', 'f32le', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
    const samples = new Float32Array(bytes.length / 4);
    for (let i = 0; i < samples.length; i++) samples[i] = bytes.readFloatLE(i * 4);
    return samples;
  };
  return pcmDifference(decode(original), decode(revised), threshold);
}
export function edgeFadeFilter(seconds = 0.01) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Fade duration must be positive');
  return `afade=t=in:d=${seconds},areverse,asetpts=N/SR/TB,afade=t=in:d=${seconds},areverse,asetpts=N/SR/TB`;
}
function ff(args) {
  const p = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (p.status !== 0) throw new Error(p.error?.message || p.stderr);
  return p.stderr;
}
function measure(file, trim = '') {
  const out = ff(['-i', file, '-af', `${trim}loudnorm=I=-16:TP=-1.5:LRA=20:print_format=json`, '-f', 'null', '-']);
  const integrated = Number(JSON.parse(out.slice(out.lastIndexOf('{'), out.lastIndexOf('}') + 1)).input_i);
  if (!Number.isFinite(integrated)) throw new Error(`Cannot measure loudness: ${file}`);
  return integrated;
}
export function normalize(input, output) {
  const faded = output + '.faded.wav';
  ff(['-i', input, '-af', edgeFadeFilter(), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', faded]);
  try {
  const filter = 'loudnorm=I=-16:TP=-1.5:LRA=20';
  const log = ff(['-i', faded, '-af', `${filter}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
  for (const key of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']) if (!Number.isFinite(Number(m[key]))) throw new Error(`Silent or invalid excerpt: ${input}`);
  ff(['-i', faded, '-af', `${filter}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', output]);
  } finally { rmSync(faded, { force: true }); }
}
export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--null-control') { options['null-control'] = true; continue; }
    if (!/^--(date|seed|seeds|head|base|since|genres|styles|baselines|null-style|min-difference|max-pairs|key-dir)$/.test(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid option: ${argv[i]}`);
    options[argv[i].slice(2)] = argv[++i];
  }
  const date = options.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid date');
  const seed = options.seed === undefined ? hash(date) : Number(options.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be a uint32');
  const seeds = seedOverrides(options.seeds);
  const baselines = baselineOverrides(options.baselines);
  const minDifference = options['min-difference'] === undefined ? null : Number(options['min-difference']);
  if (minDifference !== null && (!Number.isFinite(minDifference) || minDifference < 0)) throw new Error('Invalid min-difference');
  const keyDir = resolve(options['key-dir'] || join(ROOT, 'test/out/blind-packs'));
  const out = join(ROOT, 'test/out/blind-packs', date), pack = join(out, 'blind-pilot');
  if (keyDir === pack || keyDir.startsWith(pack + '/')) throw new Error('Key directory must be outside the blind pack');
  if (existsSync(join(keyDir, `${date}.json`)) || existsSync(out)) throw new Error(`Refusing to overwrite existing pack/key: ${date}`);
  git('fetch', 'origin', 'main');
  const head = git('rev-parse', '--verify', `${options.head || 'origin/main'}^{commit}`);
  const previous = existsSync(keyDir) ? readdirSync(keyDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1) : null;
  const { ref, sinceTime } = baseSelection(options, previous ? JSON.parse(readFileSync(join(keyDir, previous), 'utf8')) : null);
  if (sinceTime !== null && !Number.isFinite(Date.parse(sinceTime))) throw new Error('Invalid since time');
  const base = ref ? git('rev-parse', '--verify', `${ref}^{commit}`) : git('rev-list', '--first-parent', '-1', `--before=${sinceTime}`, 'origin/main');
  if (!base) throw new Error(`No first-parent base commit before ${sinceTime}`);
  git('merge-base', '--is-ancestor', base, head);
  const mergedPRs = mergedPRsBetween(base, head);
  const extra = (options.genres || '').split(',').filter(Boolean).map((s) => {
    const id = Object.keys(STYLES).find((id) => id === s.trim().toLowerCase() || STYLES[id].name.toLowerCase() === s.trim().toLowerCase());
    if (!id) throw new Error(`Unknown genre: ${s}`);
    return id;
  });
  const explicit = options.styles === undefined ? null : options.styles.split(',').map((s) => s.trim());
  const selection = selectStyles(mergedPRs.flatMap((p) => p.styles), extra, options['max-pairs'] === undefined ? Infinity : Number(options['max-pairs']), explicit);
  for (const style of Object.keys(baselines)) {
    baselines[style] = git('rev-parse', '--verify', `${baselines[style]}^{commit}`);
    git('merge-base', '--is-ancestor', baselines[style], head);
  }
  console.log(`Merged PRs: ${mergedPRs.map((p) => '#' + p.number).join(', ')}`);
  console.log(`Selected styles: ${selection.selected.join(', ')}; dropped: ${selection.dropped.join(', ') || 'none'}`);
  if (options['null-style'] && !options['null-control']) throw new Error('null-style requires null-control');
  const pairs = planPairs(selection.selected, seed, seeds, base, head, baselines, options['null-control'], options['null-style'] ? [options['null-style']] : mergedPRs.flatMap((p) => p.styles));
  mkdirSync(out, { recursive: true });
  const temp = mkdtempSync(join(tmpdir(), 'ug-blind-')), worktrees = [];
  try {
    const renderGroups = [{ version: 'revised', commit: head, styles: pairs.map((p) => p.style) }, ...[...new Set(pairs.filter((p) => p.kind !== 'null').map((p) => p.baselineCommit))].map((commit) => ({ version: 'original', commit, styles: pairs.filter((p) => p.kind !== 'null' && p.baselineCommit === commit).map((p) => p.style) }))];
    for (const [groupIndex, { version, commit, styles }] of renderGroups.entries()) {
      const dir = join(temp, `revision-${groupIndex}`);
      git('worktree', 'add', '--detach', dir, commit); worktrees.push(dir);
      const excerptFile = join(dir, 'test/audio-quality-page.js');
      const source = readFileSync(excerptFile, 'utf8'), compatible = excerptWithFrom(source);
      if (source !== compatible) writeFileSync(excerptFile, compatible);
      if (!existsSync(join(dir, 'node_modules')) && existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
      const { withChrome } = await import(pathToFileURL(join(dir, 'test/chrome.mjs')));
      const cwd = process.cwd();
      try {
        process.chdir(dir);
        const rendered = await withChrome(async (run) => {
          const available = await run(`import('/test/audio-quality-page.js').then(m => { window.__q = m; return typeof m.excerpt === 'function'; })`);
          if (!available) throw new Error(`${version} ${commit} lacks excerpt() in test/audio-quality-page.js`);
          for (const style of styles) {
            const p = pairs.find((p) => p.style === style);
            console.log(`Rendering ${version} ${p.style} seed=${p.renderSeed}`);
            if (version === 'revised') {
              const metadata = await run(`(async () => {
                const s = window.__q.song(${JSON.stringify(p.style)}, ${p.renderSeed});
                const piece = s.patterns.find((pattern) => pattern.score)?.score?.piece;
                if (piece) await (await import('/js/repertoire.js')).loadPiece(piece);
                const timeline = window.__q.plan(s, 8);
                const { songPlan } = await import('/js/state.js');
                return { sections: songPlan(${JSON.stringify(p.style)}, ${p.renderSeed}, 'song', s.bpm).sections,
                  chain: s.chain, patterns: s.patterns.map(({ sec }) => ({ sec })), labels: s.labels,
                  bars: timeline.bars, peakBar: timeline.peakBar };
              })()`);
              const { barWindow, ...excerpt } = selectExcerptWindow(metadata);
              p.barWindow = barWindow;
              p.excerpt = excerpt;
            }
            const options = { kind: 'peak', bars: 8, ...(p.barWindow ? { from: p.barWindow[0] } : {}) };
            const x = await run(`window.__q.excerpt(${JSON.stringify(p.style)}, ${p.renderSeed}, ${JSON.stringify(options)})`);
            p.barWindow = checkBarWindow(x.bars, p.barWindow);
            (p.windows ||= {})[version] = [...x.bars];
            console.log(`${version} ${p.style} bars=${x.bars.join('–')}`);
            writeFileSync(join(temp, `${p.style}-${version}.wav`), Buffer.from(x.wav, 'base64'));
          }
          return true;
        });
        if (!rendered) throw new Error('Chrome is required to render the blind pack');
      } finally { process.chdir(cwd); }
    }
    for (const p of pairs) {
      if (p.kind === 'null') {
        p.windows = { original: [...p.barWindow], revised: [...p.barWindow] };
      } else if (minDifference !== null) {
        p.pcmDifference = compareFiles(join(temp, `${p.style}-original.wav`), join(temp, `${p.style}-revised.wav`), minDifference);
        console.log(`${p.style} PCM difference: ${JSON.stringify(p.pcmDifference)}`);
        if (!p.pcmDifference.different) throw new Error(`Near-identical comparison: ${p.style}`);
      }
    }
    mkdirSync(pack, { recursive: true });
    for (const f of readdirSync(pack)) rmSync(join(pack, f), { recursive: true, force: true });
    for (const p of pairs) {
      const normalized = {};
      for (const version of ['original', 'revised']) { const f = join(temp, `${p.pair}-${version}-normalized.wav`); normalize(join(temp, `${p.style}-${p.kind === 'null' ? 'revised' : version}.wav`), f); normalized[version] = f; }
      const levels = Object.fromEntries(Object.entries(normalized).map(([v, f]) => [v, measure(f)]));
      const target = Math.min(-16, ...Object.values(levels));
      const matched = {};
      for (const version of ['original', 'revised']) { const f = join(temp, `${p.pair}-${version}-matched.wav`); ff(['-i', normalized[version], '-af', `volume=${target - levels[version]}dB`, '-c:a', 'pcm_f32le', f]); matched[version] = f; }
      const mp3 = join(pack, `Pair-${p.pair}.mp3`);
      ff(['-i', matched[p.first], '-i', matched[p.second], '-filter_complex', '[0:a]apad=pad_dur=1.56[a];[a][1:a]concat=n=2:v=0:a=1[out]', '-map', '[out]', '-map_metadata', '-1', '-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', mp3]);
      const firstSeconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', matched[p.first]], { encoding: 'utf8' }).trim());
      if (!Number.isFinite(firstSeconds) || firstSeconds <= 0) throw new Error(`Cannot locate pair ${p.pair} silence`);
      const decoded = join(temp, `${p.pair}-decoded.wav`);
      ff(['-i', mp3, '-c:a', 'pcm_f32le', decoded]);
      p.lufs = { first: measure(decoded, `atrim=end=${firstSeconds},asetpts=PTS-STARTPTS,`), second: measure(decoded, `atrim=start=${firstSeconds + 1.56},asetpts=PTS-STARTPTS,`) };
      p.silence = { startSeconds: firstSeconds, endSeconds: firstSeconds + 1.56 };
      console.log(`Pair-${p.pair} decoded MP3: ${p.lufs.first} / ${p.lufs.second} LUFS; difference ${Math.abs(p.lufs.first - p.lufs.second).toFixed(2)} LU`);
      if (Math.abs(p.lufs.first - p.lufs.second) > 0.100001) throw new Error(`Decoded MP3 loudness mismatch: pair ${p.pair}`);
    }
    writeFileSync(join(pack, 'README.md'), ratingSheet(pairs));
    const zip = join(out, `blind-rating-pack-${date}.zip`);
    rmSync(zip, { force: true });
    execFileSync('zip', ['-q', '-r', zip, 'blind-pilot'], { cwd: out });
    const key = { schema: 'untergrund.blind-pack/1', date, generatedAt: new Date().toISOString(), seed, commit: head, base, sinceTime, mergedPRs, droppedStyles: selection.dropped, pairs, format: { codec: 'mp3', sampleRate: 48000, channels: 2, bitrate: 192000, silenceSeconds: 1.56, edgeFadeSeconds: 0.01, excerpt: 'first-hook-drop-or-peak', bars: 8, targetLUFS: -16, targetTruePeakDBTP: -1.5, measurement: 'ffmpeg loudnorm JSON input_i on decoded MP3 halves, excluding the inserted silence', normalization: 'two-pass loudnorm then downward pair gain matching' } };
    mkdirSync(keyDir, { recursive: true });
    writeFileSync(join(keyDir, `${date}.json`), JSON.stringify(key, null, 2) + '\n', { flag: 'wx' });
    console.log(`Pack: ${pack}\nZip: ${zip}\nKey: ${join(keyDir, `${date}.json`)}\nBase: ${base}\nHead: ${head}`);
  } finally {
    for (const dir of worktrees.reverse()) git('worktree', 'remove', '--force', dir);
    rmSync(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`blind-pack: ${e.message}`); process.exitCode = 1; });
