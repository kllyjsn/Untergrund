// Real app, separate OS browser processes, HTTP rooms, rendered PCM only.
// Extend SCENARIOS rather than adding app test hooks. Node >=22 required.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from './chrome.mjs';
import { defaultState } from '../js/state.js';
import { installAudioTap, envelope, onsets, compare, correlate } from './club-sync-audio.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'test/out');
const SCENARIOS = [
  { name: 'listener-skew', listenerSkew: 2000 },
  { name: 'host-skew', hostSkew: 2000 },
  { name: 'late-join', joinDelay: 10000 },
  { name: 'cold-invite', cold: true },
];
const args = process.argv.slice(2);
const selected = args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : null;
if (args.some((a, i) => a !== '--assert' && a !== '--scenario' && args[i - 1] !== '--scenario') ||
    (args.includes('--scenario') && !SCENARIOS.some(s => s.name === selected)))
  throw new Error(`Usage: node test/club-sync.mjs [--assert] [--scenario ${SCENARIOS.map(s => s.name).join('|')}]`);
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(100); }
  throw new Error(`Timed out: ${label}`);
}
async function freePort() {
  const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
}
async function terminate(p) {
  if (!p || p.exitCode !== null) return;
  const done = new Promise(r => p.once('exit', r)); p.kill('SIGKILL'); await done;
}
async function client(base, skew = 0, fixture = null) {
  const chrome = findChrome(); if (!chrome) throw new Error('Chrome required');
  const profile = await mkdtemp(join(out, 'chrome-'));
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; proc.stderr.on('data', d => stderr += d);
  let ws;
  const close = async () => {
    ws?.close(); await terminate(proc);
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  try {
    const debug = await until(() => /DevTools listening on (ws:\/\/\S+)/.exec(stderr)?.[1], 'Chrome startup');
    const http = debug.replace(/^ws/, 'http').replace(/\/devtools\/browser\/.*/, '');
    const target = await (await fetch(`${http}/json/new?about:blank`, { method: 'PUT' })).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, reject) => { ws.onopen = r; ws.onerror = reject; });
    let id = 0; const pending = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data), p = pending.get(m.id);
      if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const i = ++id, timer = setTimeout(() => { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      pending.set(i, { resolve, reject, timer }); ws.send(JSON.stringify({ id: i, method, params }));
    });
    const run = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
    };
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installAudioTap})(${skew}, ${JSON.stringify(fixture)})` });
    const nav = async path => { await send('Page.navigate', { url: base + path }); await until(() => run('!!document.querySelector(".club-btn, .club-modal, .club-head")'), 'app ready'); };
    const click = async selector => {
      const point = await until(() => run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2} : null; })()`), selector);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    return { run, nav, click, close };
  } catch (e) { await close(); throw e; }
}

function fixture() {
  const s = defaultState();
  s.bpm = 123; s.swing = 0; s.chainOn = false; s.current = 0;
  s.solos = { kick: true }; s.mutes = {};
  for (const p of s.patterns) p.steps.kick = Array.from({ length: 16 }, (_, i) => i % 4 === 0 ? 1 : 0);
  return s;
}

async function scenario(base, spec) {
  const clients = [];
  try {
    const host = await client(base, spec.hostSkew, fixture()); clients.push(host);
    await host.nav('/'); await host.click('.club-btn');
    let listener;
    if (!spec.cold) { listener = await client(base, spec.listenerSkew); clients.push(listener); await listener.nav('/'); }
    const action = await until(() => host.run(`document.querySelector('.lobby-cta')?.textContent === 'GO LIVE' ? '.lobby-cta' : document.querySelector('.club-primary')?.textContent === 'GO LIVE' ? '.club-primary' : null`), 'GO LIVE');
    await host.click(action);
    const room = await until(() => host.run('new URL(location.href).searchParams.get("room")'), 'Host room invite');
    const broadcast = Date.now();
    if (spec.joinDelay) await pause(spec.joinDelay);
    if (!listener) { listener = await client(base, spec.listenerSkew); clients.push(listener); }
    const navigation = Date.now();
    await listener.nav(`/?room=${encodeURIComponent(room)}`);
    // Chrome's autoplay grant may already unlock and join on invite entry.
    const joined = await until(() => listener.run(`(() => {
      const b = document.querySelector('.club-primary');
      return b?.textContent === 'LISTEN LIVE' ? 'listen' : (__clubAudio.samples.some(r => r[1] > .001) ? 'automatic' : null);
    })()`), 'listener audio or LISTEN LIVE');
    if (joined === 'listen') await listener.click('.club-primary');
    await pause(22000);
    const raw = await Promise.all(clients.map(c => c.run('({...__clubAudio, clockSkew: Date.now() - (performance.timeOrigin + performance.now())})')));
    const [he, le] = raw.map(envelope), [ho, lo] = [he, le].map(e => onsets(e, 123));
    assert.ok(ho.length > 10 && lo.length > 10, 'Enough detected rendered kicks');
    const start = Math.max(ho[0], lo[0]) + 500, end = Math.min(ho.at(-1), lo.at(-1)) - 100;
    const h = ho.filter(t => t >= start && t <= end), l = lo.filter(t => t >= start && t <= end);
    const stats = compare(ho, l, 123);
    stats.missing.host = compare(h, h, 123).missing.host;
    const self = compare(h, h, 123);
    assert.equal(self.max, 0);
    const offsetMs = 80;
    const offset = compare(h, h.map(t => t + offsetMs), 123);
    assert.ok(Math.abs(offset.median - offsetMs) < .001);
    const aligned = lo.find(t => Math.abs(t - ho.reduce((a, b) => Math.abs(b - t) < Math.abs(a - t) ? b : a, Infinity)) <= 50);
    console.log(`${spec.name}: detector self=${self.max}ms; injected +${offsetMs}ms=${offset.median}ms; skew host/listener=${raw.map(r => Math.round(r.clockSkew)).join('/')}ms; join=${joined}`);
    return { name: spec.name, ...stats, crossCorrelation: correlate(he, le), navigationToFirstKickMs: lo[0] - navigation,
      navigationToFirstAlignedKickMs: aligned ? aligned - navigation : null, broadcast, navigation,
      detected: { host: ho.length, listener: lo.length }, detectorValidation: { selfMaxMs: self.max, offsetMs, measuredMs: offset.median },
      spec, join: joined, raw: { captures: raw, hostOnsets: ho, listenerOnsets: lo } };
  } finally { await Promise.all(clients.map(c => c.close())); }
}

await mkdir(out, { recursive: true });
const port = await freePort(), base = `http://localhost:${port}`;
const env = { ...process.env, SC_MOCK: '1', PORT: String(port), DATA_FILE: join(out, 'club-sync-kv.json') };
for (const k of Object.keys(env)) if (/REDIS|KV_REST|ROOMS_API_URL/.test(k)) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', d => serverLog += d); server.stderr.on('data', d => serverLog += d);
const results = [];
try {
  await until(async () => { try { return (await fetch(base)).ok; } catch { return false; } }, 'server');
  console.log('Club sync: isolated Chrome processes; memory rooms; 22s captures; kick-only fixed seed 1337 / 123 BPM.');
  console.log('PCM destination tap → 180Hz low-pass RMS; getOutputTimestamp + true performance.timeOrigin.');
  for (const spec of SCENARIOS.filter(s => !selected || s.name === selected)) {
    console.log(`Running ${spec.name}…`);
    results.push(await scenario(base, spec));
  }
  console.table(results.map(r => ({ scenario: r.name, 'median |Δ| ms': r.median?.toFixed(2), 'p95 ms': r.p95?.toFixed(2),
    'max ms': r.max?.toFixed(2), matched: r.matched, missing: `${r.missing.host}/${r.missing.listener}`,
    'xcorr ms': r.crossCorrelation.lagMs, 'entry→aligned ms': r.navigationToFirstAlignedKickMs?.toFixed(0) })));
  console.log('Detector validation: empty audio has no onsets; empty comparison cannot pass.');
  assert.deepEqual(onsets([], 123), []); assert.equal(compare([], [], 123).median, null);
  assert.throws(() => envelope({ errors: ['unsupported route'], anchors: [], samples: [] }), /unsupported route/);
  const failures = results.filter(r => r.median === null || r.median > 25 || r.p95 > 50 || !r.matched || r.missing.host || r.missing.listener);
  console.log(`Thresholds (unchanged): median ≤25ms, p95 ≤50ms, missing=0: ${failures.length ? 'FAIL: ' + failures.map(r => r.name).join(', ') : 'PASS'}`);
  if (args.includes('--assert') && failures.length) process.exitCode = 1;
} catch (e) { console.error(e); process.exitCode = 1; }
finally {
  await writeFile(join(out, 'club-sync.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results, serverLog }, null, 2));
  console.log('JSON: test/out/club-sync.json');
  await terminate(server);
  await rm(join(out, 'club-sync-kv.json'), { force: true });
}
