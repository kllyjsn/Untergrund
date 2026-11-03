// EXPORT STEMS in a real browser: the stems of a song add up to its mix bus before the master chain.
// Needs Chrome/Chromium (CHROME_PATH, google-chrome, chromium); skips with a note when there is none.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';

function findChrome() {
  const cands = [process.env.CHROME_PATH];
  const devin = '/opt/.devin/chrome/chrome';
  if (existsSync(devin)) for (const d of readdirSync(devin)) cands.push(join(devin, d, 'chrome-linux64/chrome'));
  cands.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  for (const c of cands) if (c && existsSync(c)) return c;
  try { return execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}
const chrome = findChrome();
if (!chrome) { console.log('stems: no Chrome found, skipped'); process.exit(0); }

const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try { const body = await readFile(join(root, path === '/' ? '/test/listen.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(path === '/blank.html' ? 200 : 404, { 'content-type': 'text/html' }); res.end(''); }
}).listen(0);
const port = server.address().port;
const profile = mkdtempSync(join(tmpdir(), 'ug-chrome-'));
const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  const result = await run(`(async () => {
    const { defaultState, generate, applyOverrides, arrangement, songChain } = await import('/js/state.js');
    const { renderStems, renderPreBus, stemList } = await import('/js/stems.js');
    const out = [];
    for (const [style, seed, bars] of [['neosoul', 42, 3], ['deephouse', 7, 2], ['nocturne', 9, 2]]) {
      const s = defaultState(), g = generate(style, seed);
      applyOverrides(s, g); s.key = g.key; s.patterns = arrangement(g.pattern, seed); s.chainOn = true; s.chain = songChain(style, seed);
      // Start inside the song (bars 8+) so the full band and the hook are playing.
      if (!g.pattern.score) s.chain = s.chain.slice(8);
      const ref = await renderPreBus(s, bars);
      let ticks = 0;
      const r = await renderStems(s, { bars, onProgress: () => ticks++ });
      const L = ref.getChannelData(0), R = ref.getChannelData(1);
      let err = 0, pow = 0, peak = 0;
      const lens = new Set(r.stems.map((x) => x.left.length));
      for (let i = 0; i < L.length; i++) {
        let sl = 0, sr = 0;
        for (const x of r.stems) { sl += x.left[i]; sr += x.right[i]; }
        err += (sl - L[i]) ** 2 + (sr - R[i]) ** 2; pow += L[i] ** 2 + R[i] ** 2; peak = Math.max(peak, Math.abs(L[i]));
      }
      const rms = (x) => Math.sqrt(x.left.reduce((a, v) => a + v * v, 0) / x.left.length);
      out.push({ style, stems: r.stems.map((x) => x.id), lens: [...lens], refLen: L.length, rate: r.sampleRate, relErr: Math.sqrt(err / pow), peak, ticks,
        loud: r.stems.filter((x) => rms(x) > 1e-4).map((x) => x.id) });
    }
    return out;
  })()`);
  for (const r of result) {
    console.log(`${r.style}: ${r.stems.join(', ')} · sum vs mix bus rel err ${r.relErr.toExponential(2)} · peak ${r.peak.toFixed(2)}`);
    assert.equal(r.rate, 48000);
    assert.deepEqual(r.lens, [r.refLen], `${r.style}: every stem is as long as the mix`);
    assert(r.peak > 0.01, `${r.style}: the song is audible`);
    assert(r.relErr < 1e-3, `${r.style}: stems sum to the mix bus (rel err ${r.relErr})`);
    assert(r.stems.includes('fx') && r.loud.includes('fx'), `${r.style}: FX/returns stem carries the reverb`);
    assert(r.ticks > 5, `${r.style}: progress reported`);
    assert(r.loud.length >= r.stems.length - 1, `${r.style}: stems are not silent (${r.loud})`);
  }
  assert(result[1].stems.includes('hook') && result[1].loud.includes('hook'), 'deephouse hook gets its own stem');
  assert(result[2].stems.includes('pno') && !result[2].stems.includes('kick'), 'nocturne stems are orchestra parts');
  ws.close();
  console.log('stems tests passed');
} finally { await done(); }
