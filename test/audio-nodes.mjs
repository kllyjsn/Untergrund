// Audio-thread load guard: drives the real Engine + Sequencer through every style's song against a counting fake
// AudioContext and fails if the AudioNodes created per bar (the per-hit churn that crackles on phones) rise well
// above test/audio-nodes-baseline.json. `node test/audio-nodes.mjs --update` rewrites the baseline after a deliberate change.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { STYLES, defaultState, generate, applyOverrides, arrangement, songChain } from '../js/state.js';

const BASELINE = new URL('./audio-nodes-baseline.json', import.meta.url);
const SLACK = 1.15, FLOOR = 12;

class FakeBuffer {
  constructor({ length, numberOfChannels = 1, sampleRate = 48000 }) { this.length = length; this.numberOfChannels = numberOfChannels; this.sampleRate = sampleRate; this.duration = length / sampleRate; this.ch = Array.from({ length: numberOfChannels }, () => new Float32Array(length)); }
  getChannelData(i) { return this.ch[i]; }
  copyToChannel(d, i) { this.ch[i].set(d); }
}
const param = () => new Proxy({ value: 0 }, { get: (o, k) => (k in o ? o[k] : typeof k === 'string' ? () => o : undefined) });
const node = (ctx, kind) => new Proxy({ kind, ctx, numberOfInputs: 1, connect: (dst) => dst, disconnect() {}, start() {}, stop() {}, addEventListener() {} }, {
  get(o, k) { if (k in o) return o[k]; if (typeof k !== 'string' || k === 'then') return undefined; return (o[k] = param()); },
  set(o, k, v) { o[k] = v; return true; },
});
const counts = { n: 0, by: {} };
let tag = 'setup';
function fakeCtx(sampleRate = 48000) {
  const ctx = { currentTime: 0, sampleRate, state: 'running', destination: null, listener: param(),
    createBuffer: (n, length, sr) => new FakeBuffer({ length, numberOfChannels: n, sampleRate: sr }),
    createPeriodicWave: () => ({}), decodeAudioData: async (ab) => new FakeBuffer({ length: Math.max(1, (ab.byteLength - 44) >> 1), sampleRate: 44100 }),
    resume: async () => {}, startRendering: async () => new FakeBuffer({ length: 1 }) };
  ctx.destination = node(ctx, 'Destination');
  return new Proxy(ctx, { get(o, k) {
    if (k in o) return o[k];
    if (typeof k === 'string' && k.startsWith('create')) return () => { counts.n++; counts.by[tag] = (counts.by[tag] || 0) + 1; return node(o, k.slice(6)); };
    return undefined;
  } });
}
globalThis.AudioBuffer = FakeBuffer;
globalThis.OfflineAudioContext = function (ch, len, sr) { return fakeCtx(sr); };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!u.startsWith('file:')) return realFetch(url);
  try { const b = await readFile(fileURLToPath(u)); return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), json: async () => JSON.parse(b.toString()), text: async () => b.toString() }; }
  catch { return { ok: false, status: 404 }; }
};

const { Engine, Sequencer, parseChain, scoreKinds } = await import('../js/engine.js');
const { loadLiveKit, loadBand, BAND } = await import('../js/livekit.js');
const { loadPiece } = await import('../js/repertoire.js');
await loadLiveKit();
await Promise.all(Object.keys(BAND).map((k) => loadBand(k)));

// Attribute each node to the outermost Engine method that created it.
for (const k of Object.getOwnPropertyNames(Engine.prototype)) {
  const f = Object.getOwnPropertyDescriptor(Engine.prototype, k).value;
  if (k === 'constructor' || typeof f !== 'function') continue;
  Engine.prototype[k] = function (...a) { if (tag !== 'tick') return f.apply(this, a); tag = k === 'trigger' ? `${k}.${a[0]}` : k; try { return f.apply(this, a); } finally { tag = 'tick'; } };
}

function songFor(style, seed) {
  const s = defaultState(), g = generate(style, seed);
  applyOverrides(s, g);
  s.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  if (g.key != null) s.key = g.key;
  if (g.scale) s.scale = g.scale;
  s.chainOn = true;
  s.chain = songChain(style, seed);
  return s;
}

export async function measure(style, seed = 7) {
  const state = songFor(style, seed);
  const score = state.patterns.find((p) => p.score)?.score;
  if (score?.piece) await loadPiece(score.piece);
  const rnd = Math.random; let x = 12345; Math.random = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  try {
    counts.n = 0; counts.by = {}; tag = 'setup';
    const engine = new Engine(fakeCtx(), JSON.parse(JSON.stringify(state)), { realtime: false });
    const seq = new Sequencer(engine, engine.state);
    const fixed = counts.n;
    const bars = Math.max(16, parseChain(state.chain).length || 0);
    const perBar = [];
    counts.by = {};
    for (let abs = 0, t = 0.05; abs < bars * 16; abs++) {
      const before = counts.n; tag = 'tick';
      seq.tick(abs, t); t += engine.stepDur;
      tag = 'setup';
      perBar[abs >> 4] = (perBar[abs >> 4] || 0) + counts.n - before;
    }
    const peak = Math.max(...perBar), avg = perBar.reduce((a, b) => a + b, 0) / bars;
    return { style, fixed, bars, peak, avg: Math.round(avg), by: Object.fromEntries(Object.entries(counts.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v / bars)])) };
  } finally { Math.random = rnd; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = [];
  for (const style of Object.keys(STYLES)) rows.push(await measure(style));
  if (process.argv.includes('--verbose')) for (const r of rows) console.log(r.style.padEnd(11), 'peak', String(r.peak).padStart(4), 'avg', String(r.avg).padStart(4), JSON.stringify(r.by));
  if (process.argv.includes('--update')) {
    await writeFile(BASELINE, `{\n${rows.map((r) => ` ${JSON.stringify(r.style)}: ${JSON.stringify({ peak: r.peak, avg: r.avg })}`).join(',\n')}\n}\n`);
    console.log('audio-nodes: baseline updated');
  } else {
    const base = JSON.parse(await readFile(BASELINE, 'utf8'));
    let fails = 0;
    for (const r of rows) {
      const b = base[r.style];
      if (!b) { fails++; console.error(`FAIL ${r.style}: no baseline (run node test/audio-nodes.mjs --update)`); continue; }
      for (const k of ['peak', 'avg']) if (r[k] > b[k] * SLACK + FLOOR) { fails++; console.error(`FAIL ${r.style}: ${r[k]} nodes/bar (${k}) vs baseline ${b[k]}; top creators ${JSON.stringify(r.by)}`); }
    }
    if (fails) process.exit(1);
    console.log(`audio-nodes: ${rows.length} styles within ${Math.round((SLACK - 1) * 100)}% of the node-per-bar baseline`);
  }
}
