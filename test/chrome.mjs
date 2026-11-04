// Headless Chrome over CDP with Node 22's built-in WebSocket (no deps), serving the repo root.
// withChrome(fn) calls fn(run) where run(expr) evaluates an async expression in a page and returns its value;
// resolves to null (after a note) when no Chrome is installed.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';

export function findChrome() {
  const cands = [process.env.CHROME_PATH];
  const devin = '/opt/.devin/chrome/chrome';
  if (existsSync(devin)) for (const d of readdirSync(devin)) cands.push(join(devin, d, 'chrome-linux64/chrome'));
  cands.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  for (const c of cands) if (c && existsSync(c)) return c;
  try { return execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };

export async function withChrome(fn, { pages = 1 } = {}) {
  const chrome = findChrome();
  if (!chrome) return null;
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try { const body = await readFile(join(root, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(path === '/blank.html' ? 200 : 404, { 'content-type': 'text/html' }); res.end(''); }
  }).listen(0);
  const port = server.address().port;
  const profile = mkdtempSync(join(tmpdir(), 'ug-chrome-'));
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const sockets = [];
  try {
    const wsUrl = await new Promise((res, rej) => {
      let buf = '';
      const t = setTimeout(() => rej(new Error('Chrome did not start')), 20000);
      proc.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); res(m[1]); } });
    });
    const http = wsUrl.replace(/^ws/, 'http').replace(/\/devtools\/browser\/.*/, '');
    const open = async () => {
      const target = await (await fetch(`${http}/json/new?http://localhost:${port}/blank.html`, { method: 'PUT' })).json();
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      sockets.push(ws);
      await new Promise((r) => ws.addEventListener('open', r, { once: true }));
      let id = 0;
      const pending = new Map();
      ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
      const send = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
      await new Promise((r) => setTimeout(r, 300));
      return async (expr) => {
        const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
        return r.result.result.value;
      };
    };
    const runs = [];
    for (let i = 0; i < pages; i++) runs.push(await open());
    return await fn(pages === 1 ? runs[0] : runs);
  } finally {
    for (const ws of sockets) try { ws.close(); } catch {}
    const exited = new Promise((r) => proc.once('exit', r));
    try { proc.kill('SIGKILL'); } catch {}
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    server.close();
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
}
