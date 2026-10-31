// Local / self-hosted server: static files + the SoundCloud token endpoints (same logic as api/*.js on Vercel).
// SC_MOCK=1 points the app at an in-process fake SoundCloud for offline testing.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicConfig, exchangeToken } from './api/_lib/soundcloud.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8000);
const MOCK = process.env.SC_MOCK === '1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };

let mock = null;
const env = { ...process.env };
if (MOCK) {
  mock = await import('./test/mock-soundcloud.mjs');
  Object.assign(env, { SOUNDCLOUD_CLIENT_ID: 'mock-client', SOUNDCLOUD_CLIENT_SECRET: 'mock-secret',
    SOUNDCLOUD_AUTH_URL: `http://localhost:${PORT}/mock-sc`, SOUNDCLOUD_API_URL: `http://localhost:${PORT}/mock-sc/api` });
}

const readBody = (req) => new Promise((ok, fail) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', fail); });
const sendJson = (res, status, json) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(json)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/sc-config') {
      const cfg = publicConfig(env);
      if (MOCK) { const o = `http://${req.headers.host}/mock-sc`; cfg.authUrl = o; cfg.apiUrl = o + '/api'; }
      return sendJson(res, 200, cfg);
    }
    if (url.pathname === '/api/sc-token' && req.method === 'POST') {
      const { status, json } = await exchangeToken(JSON.parse((await readBody(req)).toString() || '{}'), env);
      return sendJson(res, status, json);
    }
    if (MOCK && url.pathname.startsWith('/mock-sc')) return mock.handle(req, res, url, readBody);
    if (MOCK && url.pathname === '/upload' && req.method === 'POST') {
      await mkdir(path.join(ROOT, 'test/out'), { recursive: true });
      await writeFile(path.join(ROOT, 'test/out', path.basename(url.searchParams.get('name') || 'out.wav')), await readBody(req));
      return sendJson(res, 200, { ok: true });
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT) || /\/(\.git|api|node_modules)(\/|$)/.test(file.slice(ROOT.length))) { res.writeHead(404); return res.end(); }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') { res.writeHead(404); return res.end('not found'); }
    console.error(err); sendJson(res, 500, { error: 'server_error' });
  }
}).listen(PORT, () => console.log(`UNTERGRUND on http://localhost:${PORT}${MOCK ? ' (mock SoundCloud)' : ''}`));
