// Real-stem Club vocal timing eval (docs/vocal-timing-eval.md). Renders Music's real sung stems through the
// production Club vocal scheduler at one or two git revisions and scores voiced cuts, forced-fade midpoint pitch
// separation and time over 50 ms. Audio never enters the repo: stems come from a private dir or URL, checked by sha256.
//
//   node scripts/vocal-timing-eval.mjs --stems <dir> [--base <ref>] [--head <ref>] [--json out.json] [--require]
//   VOCAL_STEMS_DIR=<dir> or VOCAL_STEMS_URL=<private base URL> [VOCAL_STEMS_TOKEN=<bearer>] also work.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withChrome } from '../test/chrome.mjs';
import { SR, compare, readWav, scoreRun } from '../test/vocal-timing-metrics.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'test/vocal-timing-inputs.json'), 'utf8'));
const OUT = join(ROOT, 'test/out/vocal-timing');

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// Resolve every manifest stem from a private dir or URL; returns null (unmeasured) when none is configured.
export async function loadStems({ dir = process.env.VOCAL_STEMS_DIR, url = process.env.VOCAL_STEMS_URL, token = process.env.VOCAL_STEMS_TOKEN } = {}) {
  if (!dir && !url) return null;
  const out = {};
  for (const [name, meta] of Object.entries(MANIFEST.stems)) {
    let buf, cache = join(OUT, 'stems', meta.file);
    if (dir) buf = readFileSync(join(dir, meta.file));
    else if (existsSync(cache) && sha256(readFileSync(cache)) === meta.sha256) buf = readFileSync(cache);
    else {
      const res = await fetch(new URL(meta.file, url.endsWith('/') ? url : url + '/'), { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`Fetching ${meta.file}: HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, buf);
    }
    if (sha256(buf) !== meta.sha256) throw new Error(`${meta.file}: sha256 mismatch (not Music's reviewed stem)`);
    out[name] = buf;
  }
  return out;
}

// The 22 s dry excerpt each case plays, as Music's kit cut it (first channel, from the stem's offset).
export function excerpts(stems) {
  const out = {};
  for (const [style, c] of Object.entries(MANIFEST.cases)) {
    const wav = readWav(stems[c.stem]);
    if (wav.rate !== SR) throw new Error(`${c.stem}: expected ${SR} Hz`);
    const from = Math.round(c.offsetS * SR), x = wav.samples.slice(from, from + Math.round(MANIFEST.render.lengthS * SR));
    if (x.length !== Math.round(MANIFEST.render.lengthS * SR)) throw new Error(`${c.stem}: too short for its excerpt`);
    out[style] = x;
  }
  return out;
}

// Browser side: Music's PR 297 review harness (slew6.mjs), generalised. The production post-tick vocal block is cut from
// js/main.js and run against the real Engine methods; the pre-tick transport resync is mirrored.
const harness = (cfg) => `(async () => {
  const cfg = ${JSON.stringify(cfg)};
  const { transportResync, slewTransport } = await import('/js/room-sync.js');
  const { Engine } = await import('/js/engine.js');
  const { rubatoMap } = await import('/js/perform.js');
  const SR = ${SR}, sd = 60 / cfg.bpm / 4, T0 = cfg.t0, LEN = cfg.lengthS + 2;
  const map = rubatoMap(...cfg.rubato), res = {};
  const main = await (await fetch('/js/main.js')).text();
  const a = main.indexOf('    const voice = engine.vocalNow, pos = seq.songBars'), b = main.indexOf('    uiQueue.push', a);
  if (a < 0 || b < 0) throw new Error('Missing production vocal scheduling block in js/main.js');
  const vocalSchedule = new Function('env', 'with(env){' + main.slice(a, b) + ';return {dirty:vocalGridDirty};}');
  const enc = a => {const u=new Uint8Array(a.buffer, a.byteOffset, a.byteLength);let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s);};
  for (const style of cfg.styles) {
    const pcm = new Float32Array(await (await fetch(cfg.inputs + style + '.f32')).arrayBuffer());
    for (const r of cfg.residuals) {
      const c = new OfflineAudioContext(1, SR * LEN, SR);
      let now = 0, abs = 0;
      const sources = [], steps = [];
      const ctx = new Proxy(c, {get(o, k) {
        if (k === 'currentTime') return now;
        if (k === 'createBufferSource') return () => {
          const src = c.createBufferSource(), rec = {step:abs, events:[]};
          sources.push(rec);
          const start = src.start.bind(src), stop = src.stop.bind(src);
          src.start = (at, offset = 0) => {Object.assign(rec, {at, offset}); return start(at, offset);};
          src.stop = at => {rec.stop = at; return stop(at);};
          for (const [name, kind] of [['setValueAtTime','s'],['linearRampToValueAtTime','l'],['cancelScheduledValues','c']]) {
            const fn = src.playbackRate[name].bind(src.playbackRate);
            src.playbackRate[name] = (...args) => {rec.events.push(kind==='c'?[null,args[0],kind]:[args[0],args[1],kind]); return fn(...args);};
          }
          return src;
        };
        const v = Reflect.get(o, k, o); return typeof v === 'function' ? v.bind(o) : v;
      }});
      const buf = c.createBuffer(1, pcm.length, SR); buf.getChannelData(0).set(pcm);
      const bus = c.createGain(); bus.connect(c.destination);
      const engine = Object.create(Engine.prototype);
      Object.assign(engine, {ctx, state:{bpm:cfg.bpm}, vocalBus:bus, ch:{}, bandDuck:c.createGain(), singTrim:c.createGain(),
        vocalOf:() => ({buf, gain:1, ms:0, duck:1, lift:1, fx:null}), vocalSends:() => {}, stepScale:1});
      // Sequencer.scoreStep keeps this set for the whole score whenever any step is stretched, even on unstretched steps.
      engine.variableScoreTempo = map.some(scale => scale !== 1);
      const seq = {origin:0, songBars:128, chainPos:1, gridSpan:(at, n) => {let d=engine.stepDur;for(let k=1;k<n;k++)d+=(map[at+k]??1)*sd;return d;}};
      const timeline = {skip:() => false};
      let nextTime = T0 - r, target = T0, vocalGridDirty = false;
      for (abs = 0; target < T0 + cfg.lengthS && abs < map.length; abs++) {
        now = nextTime - cfg.leadS;
        const before = engine.stepDur, err = target - nextTime;
        if (Math.abs(err) > .000001) vocalGridDirty = true;
        if (engine.vocalNow?.correction || (Math.abs(err) > .03 && (engine.roomSlewRate ?? 1) === 1)) {
          nextTime = slewTransport(target, nextTime, .05);
        } else {
          const s = transportResync(target, nextTime, now, before, false, -abs, engine.roomSlewRate ?? 1, true, engine.roomSlewProfile);
          if (s?.slew) {
            const shifted = slewTransport(s.nextTime, nextTime, .05);
            if (!engine.vocalNow) engine.slewVocal(shifted-nextTime, nextTime-before, before, s.rate, s.endRate);
            engine.roomSlewRate = s.endRate; engine.roomSlewProfile = s.profile; nextTime = shifted;
          }
        }
        const t = nextTime, pos = Math.floor(abs / 16);
        // Sequencer.tick calls vocal() before the current step's scale is applied.
        if (abs % 16 === 0) engine.vocal(t, pos, 0, nextTime, false, true);
        engine.stepScale = map[abs];
        seq.chainPos = pos + 1;
        vocalGridDirty = vocalSchedule({engine, seq, timeline, abs, nextTime, gridTarget:target, ctx, roomPlayback:true, vocalGridDirty, transportResync, t}).dirty;
        steps.push({at:t});
        const duration = engine.stepDur;
        nextTime += duration; target += duration;
      }
      const out = (await c.startRendering()).getChannelData(0);
      const splices = sources.map(s => {const from=Math.max(0,Math.round((s.at-.1)*SR));return {from:from/SR, pcm:enc(out.slice(from, from+Math.round(.2*SR)))};});
      res[style + ':' + r] = {sd, sources, steps, splices};
    }
  }
  return res;
})()`;

export function scoreRender(raw, dry) {
  const out = {};
  for (const [key, run] of Object.entries(raw)) {
    run.splices = run.splices.map(s => ({ from: s.from, pcm: new Float32Array(Uint8Array.from(Buffer.from(s.pcm, 'base64')).buffer) }));
    out[key] = scoreRun(run, dry[key.split(':')[0]]);
  }
  return out;
}

// Render at a git revision from a detached worktree (the current checkout when ref is omitted).
async function renderAt(ref, dry) {
  let root = ROOT, sha = 'worktree';
  if (ref) {
    sha = execFileSync('git', ['rev-parse', '--short', ref], { cwd: ROOT, encoding: 'utf8' }).trim();
    root = join(OUT, `wt-${sha}`);
    if (!existsSync(root)) execFileSync('git', ['worktree', 'add', '--detach', root, sha], { cwd: ROOT, stdio: 'ignore' });
  }
  const inputs = join(root, 'test/out/vocal-timing/inputs');
  mkdirSync(inputs, { recursive: true });
  for (const [style, x] of Object.entries(dry)) writeFileSync(join(inputs, `${style}.f32`), Buffer.from(x.buffer, x.byteOffset, x.byteLength));
  const r = MANIFEST.render, cwd = process.cwd();
  process.chdir(root);
  try {
    const raw = await withChrome(async run => run(harness({ ...r, styles: Object.keys(dry), inputs: '/test/out/vocal-timing/inputs/' })));
    return { ref: ref || 'worktree', sha, cases: scoreRender(raw, dry) };
  } finally { process.chdir(cwd); }
}

function table(label, cases) {
  console.log(`\n${label}`);
  console.table(Object.fromEntries(Object.entries(cases).map(([k, c]) => [k, { starts: c.starts, voicedCuts: c.voicedCuts,
    maxSepCents: c.maxSepCents, movingCuts: c.movingCuts, overS: c.overS, longestOverS: c.longestOverS, peakMs: c.peakMs, endMs: c.endMs }])));
}

async function main(argv) {
  const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const stems = await loadStems({ dir: arg('--stems') ?? process.env.VOCAL_STEMS_DIR, url: process.env.VOCAL_STEMS_URL });
  if (!stems) {
    console.log('UNMEASURED: no private stems configured (set --stems, VOCAL_STEMS_DIR or VOCAL_STEMS_URL; docs/vocal-timing-eval.md)');
    process.exit(argv.includes('--require') ? 1 : 0);
  }
  const dry = excerpts(stems), report = { version: MANIFEST.version, measuredAt: new Date().toISOString() };
  const base = arg('--base'), head = arg('--head');
  if (base) { report.base = await renderAt(base, dry); table(`base ${report.base.ref} (${report.base.sha})`, report.base.cases); }
  report.head = await renderAt(head, dry); table(`head ${report.head.ref} (${report.head.sha})`, report.head.cases);
  for (const [k, c] of Object.entries(report.head.cases)) for (const cut of c.cuts.filter(x => x.voiced))
    console.log(`voiced cut ${k} @${cut.time.toFixed(3)}s step ${cut.step}: sep ${cut.sep2048}/${cut.sep4096} c, motion ${cut.motionCents} c/10ms, jump ${cut.jumpMs} ms`);
  if (base) {
    report.gate = compare(report.base.cases, report.head.cases);
    console.log(`\nGATE ${report.gate.verdict.toUpperCase()}${report.gate.reasons.map(r => `\n  - ${r}`).join('')}`);
  }
  const json = arg('--json');
  if (json) { mkdirSync(dirname(resolve(json)), { recursive: true }); writeFileSync(json, JSON.stringify(report, null, 2)); }
  if (report.gate?.verdict === 'hold' && argv.includes('--assert')) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
