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
function normalize(input, output) {
  const filter = 'loudnorm=I=-16:TP=-1.5:LRA=20';
  const log = ff(['-i', input, '-af', `${filter}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
  for (const key of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']) if (!Number.isFinite(Number(m[key]))) throw new Error(`Silent or invalid excerpt: ${input}`);
  ff(['-i', input, '-af', `${filter}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', output]);
}
export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!/^--(date|seed|seeds|head|base|since|genres|key-dir)$/.test(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid option: ${argv[i]}`);
    options[argv[i].slice(2)] = argv[i + 1];
  }
  const date = options.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid date');
  const seed = options.seed === undefined ? hash(date) : Number(options.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be a uint32');
  const seeds = seedOverrides(options.seeds);
  const keyDir = resolve(options['key-dir'] || join(ROOT, 'test/out/blind-packs'));
  const out = join(ROOT, 'test/out/blind-packs', date), pack = join(out, 'blind-pilot');
  if (keyDir === pack || keyDir.startsWith(pack + '/')) throw new Error('Key directory must be outside the blind pack');
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
  const rng = random(seed), styles = shuffle([...new Set(['minimal', 'drill', 'hardtechno', 'trap', ...mergedPRs.flatMap((p) => p.styles), ...extra])], rng);
  const pairs = styles.map((style, i) => { const first = rng() < 0.5 ? 'original' : 'revised'; return { pair: String(i + 1).padStart(2, '0'), genre: STYLES[style].name, style, renderSeed: seeds[style] ?? (hash(`${seed}:${style}`) || 1), bars: 8, first, second: first === 'original' ? 'revised' : 'original' }; });
  mkdirSync(out, { recursive: true });
  const temp = mkdtempSync(join(tmpdir(), 'ug-blind-')), worktrees = [];
  try {
    for (const [version, commit] of [['original', base], ['revised', head]]) {
      const dir = join(temp, version);
      git('worktree', 'add', '--detach', dir, commit); worktrees.push(dir);
      if (!existsSync(join(dir, 'node_modules')) && existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
      const { withChrome } = await import(pathToFileURL(join(dir, 'test/chrome.mjs')));
      const cwd = process.cwd();
      try {
        process.chdir(dir);
        const rendered = await withChrome(async (run) => {
          const available = await run(`import('/test/audio-quality-page.js').then(m => { window.__q = m; return typeof m.excerpt === 'function'; })`);
          if (!available) throw new Error(`${version} ${commit} lacks excerpt() in test/audio-quality-page.js`);
          for (const p of pairs) {
            console.log(`Rendering ${version} ${p.style} seed=${p.renderSeed}`);
            const x = await run(`window.__q.excerpt(${JSON.stringify(p.style)}, ${p.renderSeed}, { kind: 'peak', bars: 8 })`);
            writeFileSync(join(temp, `${p.style}-${version}.wav`), Buffer.from(x.wav, 'base64'));
          }
          return true;
        });
        if (!rendered) throw new Error('Chrome is required to render the blind pack');
      } finally { process.chdir(cwd); }
    }
    mkdirSync(pack, { recursive: true });
    for (const f of readdirSync(pack)) rmSync(join(pack, f), { recursive: true, force: true });
    for (const p of pairs) {
      const normalized = {};
      for (const version of ['original', 'revised']) { const f = join(temp, `${p.style}-${version}-normalized.wav`); normalize(join(temp, `${p.style}-${version}.wav`), f); normalized[version] = f; }
      const levels = Object.fromEntries(Object.entries(normalized).map(([v, f]) => [v, measure(f)]));
      const target = Math.min(-16, ...Object.values(levels));
      const matched = {};
      for (const version of ['original', 'revised']) { const f = join(temp, `${p.style}-${version}-matched.wav`); ff(['-i', normalized[version], '-af', `volume=${target - levels[version]}dB`, '-c:a', 'pcm_f32le', f]); matched[version] = f; }
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
    writeFileSync(join(pack, 'README.md'), '# Untergrund blind listening\n\nEach MP3 contains two versions of the same generated passage, separated by a short silence. The first/second order was randomized independently. The two excerpts in each pair are matched to within 0.1 LU.\n\nListen at the same playback volume. Rate each pair as a whole from **1 (poor) to 5 (excellent)**, then choose **first**, **second**, or **tie** for release. Judge whether the kick, bass and lead are easy to distinguish without losing the groove or character. If the difference does not matter to you, choose tie. Add a free-form explanation in Why.\n\n| Pair | Pair rating (1–5) | First / second / tie | Why |\n| --- | --- | --- | --- |\n' + pairs.map((p) => `| ${p.pair} | | | |`).join('\n') + '\n\nThese are before/after mixes, not a competitive comparison. This pack does not contain the answer key or automated preferences.\n');
    const zip = join(out, `blind-rating-pack-${date}.zip`);
    rmSync(zip, { force: true });
    execFileSync('zip', ['-q', '-r', zip, 'blind-pilot'], { cwd: out });
    const key = { schema: 'untergrund.blind-pack/1', date, generatedAt: new Date().toISOString(), seed, commit: head, base, sinceTime, mergedPRs, pairs, format: { codec: 'mp3', sampleRate: 48000, channels: 2, bitrate: 192000, silenceSeconds: 1.56, excerpt: 'peak', bars: 8, targetLUFS: -16, targetTruePeakDBTP: -1.5, measurement: 'ffmpeg loudnorm JSON input_i on decoded MP3 halves, excluding the inserted silence', normalization: 'two-pass loudnorm then downward pair gain matching' } };
    mkdirSync(keyDir, { recursive: true });
    writeFileSync(join(keyDir, `${date}.json`), JSON.stringify(key, null, 2) + '\n');
    console.log(`Pack: ${pack}\nZip: ${zip}\nKey: ${join(keyDir, `${date}.json`)}\nBase: ${base}\nHead: ${head}`);
  } finally {
    for (const dir of worktrees.reverse()) git('worktree', 'remove', '--force', dir);
    rmSync(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`blind-pack: ${e.message}`); process.exitCode = 1; });
