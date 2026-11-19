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
    for (const [style, seed, bars] of [['neosoul', 42, 4], ['deephouse', 7, 4], ['nocturne', 9, 2], ['drill', 7, 4]]) {
      const s = defaultState(), g = generate(style, seed);
      applyOverrides(s, g); s.key = g.key; s.patterns = arrangement(g.pattern, seed); s.chainOn = true; s.chain = songChain(style, seed);
      // Start at the first chorus so the full band and the hook are playing. Four bars of the sung genres:
      // the chords' licks answer the singer in the breath at the end of the 4-bar phrase.
      if (!g.pattern.score) s.chain = s.chain.slice(s.chain.indexOf('G'));
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
  const bass = await run(`(async () => {
    const { Engine } = await import('/js/engine.js');
    const { DRILL_808 } = await import('/js/params.js');
    const { freshSong } = await import('/js/state.js');
    const { encodeSong, decodeSong } = await import('/js/share-code.js');
    const state = freshSong('drill', 7);
    const render = async (s) => {
      const ctx = new OfflineAudioContext(1, 48000, 48000), e = new Engine(ctx, s, { realtime: false });
      e.ch.acid.input = ctx.destination;
      e.acid(.05, { n: 0, a: false }, false, true, .11);
      const pickup = e.mono;
      e.acid(.16, { n: 5, a: true }, true, false, .11);
      const continued = e.mono === pickup;
      const x = (await ctx.startRendering()).getChannelData(0);
      const harmonic = (hz) => {
        let re = 0, im = 0;
        for (let i = 14400; i < 33600; i++) {
          const z = x[i] * (1 - Math.cos(2 * Math.PI * (i - 14400) / 19200)), p = 2 * Math.PI * i * hz / 48000;
          re += z * Math.cos(p); im += z * Math.sin(p);
        }
        return re * re + im * im;
      };
      return { continued, sub: harmonic(e.mono.f), upper: harmonic(18 * e.mono.f), pitch: e.mono.f };
    };
    const saved = (await decodeSong(await encodeSong({ state, style: 'drill' }))).state;
    const candidate = await render(saved);
    state.fresh = 0;
    state.params.acid.voice = 2;
    const legacy = (await decodeSong(await encodeSong({ state, style: 'drill' }))).state;
    return { candidate, legacy: await render(legacy), savedVoice: saved.params.acid.voice === DRILL_808, legacyVoice: legacy.params.acid.voice };
  })()`);
  assert(bass.savedVoice && bass.legacyVoice === 2, 'shared Drill songs preserve their selected 808, including the old voice');
  assert(bass.candidate.continued && bass.legacy.continued, 'both 808 voices glide without restarting');
  assert.equal(bass.candidate.pitch, bass.legacy.pitch, 'the new voice lands on the written pitch');
  assert(Math.abs(10 * Math.log10(bass.candidate.sub / bass.legacy.sub)) < 0.4, 'the 808 fundamental stays in place');
  assert(bass.candidate.upper > 10 * bass.legacy.upper, 'the Drill 808 has a stronger upper harmonic');
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
  assert(result[3].loud.includes('hook') && result[3].loud.includes('kick'), 'the sidechained Drill hook and kick have separate stems');
  ws.close();
  console.log('stems tests passed');
} finally { await done(); }
