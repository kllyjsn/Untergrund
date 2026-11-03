// Audio-thread load per genre in headless Chrome: per-hit node churn, concurrent voices and offline render speed
// of each song's busiest 8 bars (test/audio-load-page.js), optionally under CDP CPU throttling and with a realtime
// AudioContext run that reports playbackStats / renderCapacity where this Chrome has them.
//   node scripts/audio-load.mjs [--styles a,b] [--seed 7] [--throttle 4] [--realtime 8] [--json test/out/audio-load.json]
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname, normalize, dirname } from 'node:path';
import { STYLES } from '../js/state.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const styles = arg('styles') ? arg('styles').split(',') : Object.keys(STYLES);
const seed = +arg('seed', 7), throttle = +arg('throttle', 1), rt = +arg('realtime', 0), jsonOut = arg('json');

function findChrome() {
  const cands = [process.env.CHROME_PATH];
  const devin = '/opt/.devin/chrome/chrome';
  if (existsSync(devin)) for (const d of readdirSync(devin)) cands.push(join(devin, d, 'chrome-linux64/chrome'));
  cands.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  for (const c of cands) if (c && existsSync(c)) return c;
  try { return execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}
const chrome = findChrome();
if (!chrome) { console.log('audio-load: no Chrome found'); process.exit(0); }

const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.wav': 'audio/wav', '.flac': 'audio/flac' };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try { const body = await readFile(join(root, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(path === '/blank.html' ? 200 : 404, { 'content-type': 'text/html' }); res.end(''); }
}).listen(0);
const port = server.address().port;
const profile = mkdtempSync(join(tmpdir(), 'ug-chrome-'));
const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox',
  '--autoplay-policy=no-user-gesture-required', '--enable-blink-features=AudioContextPlaybackStats,AudioContextRenderCapacity', '--enable-experimental-web-platform-features', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  const t = setTimeout(() => rej(new Error('Chrome did not start')), 20000);
  proc.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); res(m[1]); } });
});
const done = async () => {
  const exited = new Promise((r) => proc.once('exit', r));
  try { proc.kill('SIGKILL'); } catch {}
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  server.close();
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
};

try {
  const http = wsUrl.replace(/^ws/, 'http').replace(/\/devtools\/browser\/.*/, '');
  const target = await (await fetch(`${http}/json/new?http://localhost:${port}/blank.html`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const run = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result.result.value;
  };
  await new Promise((r) => setTimeout(r, 500));
  if (throttle > 1) await send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const rows = [];
  const dump = arg('dump'), compare = arg('compare');
  if (dump || compare) {
    const { analyzePcm } = await import('../js/lab-metrics.js');
    const dir = dump || compare, man = compare ? JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) : {};
    if (dump) await mkdir(dir, { recursive: true });
    const decode = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
    let worst = 0;
    for (const style of styles) {
      const startBar = compare ? man[style] : (await run(`import('/test/audio-load-page.js').then((m) => m.measure(${JSON.stringify(style)}, ${seed}))`)).startBar;
      const pcm = await run(`import('/test/audio-load-page.js').then((m) => m.renderPcm(${JSON.stringify(style)}, ${seed}, { startBar: ${startBar} }))`);
      const now = pcm.ch.map(decode);
      if (dump) { man[style] = startBar; await writeFile(join(dir, `${style}.f32`), Buffer.concat(pcm.ch.map((c) => Buffer.from(c, 'base64')))); continue; }
      const raw = await readFile(join(dir, `${style}.f32`)), n = raw.length / 4 / now.length;
      const was = now.map((_, c) => new Float32Array(raw.buffer, raw.byteOffset + c * n * 4, n));
      let maxDiff = 0, diffE = 0, sigE = 0;
      for (let c = 0; c < now.length; c++) for (let i = 0; i < n; i++) { const d = now[c][i] - was[c][i]; maxDiff = Math.max(maxDiff, Math.abs(d)); diffE += d * d; sigE += was[c][i] * was[c][i]; }
      const a = analyzePcm(was, pcm.sampleRate), b = analyzePcm(now, pcm.sampleRate);
      const snr = diffE ? 10 * Math.log10(sigE / diffE) : Infinity;
      const bands = ['lowShare', 'midShare', 'highShare'].map((k) => Math.abs(a[k] - b[k]));
      worst = Math.max(worst, maxDiff);
      rows.push({ style, startBar, maxDiff, snrDb: snr, rmsDb: [a.rmsDb, b.rmsDb], bandDelta: Math.max(...bands) });
      console.log(`${style.padEnd(11)} bar ${String(startBar).padStart(3)}  max |diff| ${maxDiff.toExponential(2)}  diff ${snr === Infinity ? 'none (bit-identical)' : `-${snr.toFixed(1)} dB below signal`}  rms ${a.rmsDb} -> ${b.rmsDb} dB  band share delta ${Math.max(...bands).toFixed(4)}`);
    }
    if (dump) await writeFile(join(dir, 'manifest.json'), JSON.stringify(man));
    else console.log(`worst max |diff| ${worst.toExponential(2)}`);
  } else if (arg('timing')) {
    // Interleaved median timings so before/after comparisons on a noisy machine are fair: --timing 5 [--startBars a:1,b:2]
    const starts = Object.fromEntries((arg('startBars') || '').split(',').filter(Boolean).map((x) => x.split(':')).map(([k, v]) => [k, +v]));
    for (const style of styles) {
      const startBar = starts[style] ?? (await run(`import('/test/audio-load-page.js').then((m) => m.measure(${JSON.stringify(style)}, ${seed}))`)).startBar;
      const speed = await run(`import('/test/audio-load-page.js').then((m) => m.timing(${JSON.stringify(style)}, ${seed}, { startBar: ${startBar}, reps: ${+arg('timing')} }))`);
      rows.push({ style, startBar, speed });
      console.log(`${style.padEnd(11)} bar ${String(startBar).padStart(3)}  median render ${(speed * 100).toFixed(1)}% of realtime`);
    }
  } else for (const style of styles) {
    const r = await run(`import('/test/audio-load-page.js').then((m) => m.measure(${JSON.stringify(style)}, ${seed}))`);
    if (rt) r.realtime = await run(`import('/test/audio-load-page.js').then((m) => m.realtime(${JSON.stringify(style)}, ${seed}, { startBar: ${r.startBar}, seconds: ${rt} }))`);
    if (process.argv.includes('--tracks')) r.tracks = await run(`import('/test/audio-load-page.js').then((m) => m.trackCost(${JSON.stringify(style)}, ${seed}, { startBar: ${r.startBar} }))`);
    rows.push(r);
    console.log(`${style.padEnd(11)} bar ${String(r.startBar).padStart(3)}  ${r.perSec.toFixed(0).padStart(5)} nodes/s  ${r.perBar.toFixed(0).padStart(5)}/bar  live nodes max ${String(r.nodes.max).padStart(4)} avg ${r.nodes.avg.toFixed(0).padStart(4)}  voices max ${String(r.voices.max).padStart(3)} avg ${r.voices.avg.toFixed(0).padStart(3)}  render ${(r.speed * 100).toFixed(1).padStart(5)}% of realtime` +
      `  idle ${(r.idleSpeed * 100).toFixed(1)}%` + (r.realtime ? `  rt clock ${r.realtime.clock.toFixed(3)} late ${r.realtime.lateTicks}${r.realtime.stats ? ' stats ' + JSON.stringify(r.realtime.stats) : ''}${r.realtime.caps.length ? ' cap ' + JSON.stringify(r.realtime.caps.at(-1)) : ''}` : '') + (r.tracks ? '\n            tracks ' + JSON.stringify(r.tracks) : ''));
  }
  ws.close();
  if (jsonOut) { await mkdir(dirname(jsonOut), { recursive: true }); await writeFile(jsonOut, JSON.stringify({ seed, throttle, chrome, rows }, null, 1)); }
} finally { await done(); }
