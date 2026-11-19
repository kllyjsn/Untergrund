// Audio-thread load guard: drives the real Engine + Sequencer through every style's song against a counting fake
// AudioContext and fails if the AudioNodes created per bar (the per-hit churn that crackles on phones) rise well
// above test/audio-nodes-baseline.json. `node test/audio-nodes.mjs --update` rewrites the baseline after a deliberate change.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { STYLES, defaultState, generate, applyOverrides, arrangement, songChain } from '../js/state.js';
import { makeIR } from '../js/dsp.js';
import { VOCAL_FX } from '../js/sing.js';

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
  const ctx = fakeCtx();
  const player = new Engine(ctx, defaultState(), { trackQueuedNotes: true });
  const events = [];
  const source = name => ({ start: (...args) => events.push([name, 'start', ...args]), stop: t => events.push([name, 'stop', t]) });
  player.startSource(source('ringing'), 1);
  player.startSource(source('queued'), 2, 0.4, 0.2);
  ctx.currentTime = 1.5;
  player.discardQueuedNotes(ctx.currentTime);
  player.discardQueuedNotes(ctx.currentTime);
  assert.deepEqual(events, [['ringing', 'start', 1], ['queued', 'start', 2, 0.4, 0.2], ['queued', 'stop', 1.5]]);

  {
    const s = defaultState();
    s.chainOn = true; s.chain = 'AC'; s.master.arr = 1;
    const e = new Engine(fakeCtx(), s, { realtime: false });
    const seq = new Sequencer(e, s);
    let impacts = 0, advances = 0;
    e.impact = () => impacts++;
    const advance = seq.advanceBar.bind(seq);
    seq.advanceBar = (...args) => { advances++; return advance(...args); };
    seq.origin = 64;
    seq.rewind(64, 1);
    assert.equal(advances, 0, 'boundary recovery leaves one-shot bar state for tick');
    seq.tick(64, 1);
    assert.equal(advances, 1);
    assert.equal(impacts, 0, 'the build downbeat is not a drop');
    assert.equal(seq.dropNext, true, 'the following peak still gets its build');
    seq.rewind(68, 2);
    assert.equal(advances, 2, 'mid-bar recovery restores its bar exactly once');
    assert.equal(seq.chainPos, 1);
    assert.equal(seq.cur, 0);
    seq.tick(68, 2);
    assert.equal(impacts, 0);
    seq.queued = 3;
    s.chainOn = false;
    seq.rewind(80, 3);
    assert.equal(seq.queued, 3, 'a queued pattern is not consumed before the recovered downbeat');
    seq.tick(80, 3);
    assert.equal(seq.queued, null);
    assert.equal(seq.cur, 3);
  }

  {
    const c = fakeCtx(), s = defaultState();
    s.bpm = 120;
    const buf = new FakeBuffer({ length: 48000 * 20, sampleRate: 48000 });
    const starts = [];
    c.createBufferSource = () => ({ connect: dst => dst, start: (...args) => starts.push(args), stop() {} });
    const e = new Engine(c, s, { trackQueuedNotes: true,
      vocal: () => ({ buf, gain: 1, duck: 1, lift: 1, ms: 250 }) });
    e.vocal(1, 0);
    c.currentTime = 1.5;
    e.discardQueuedNotes(1.5);
    assert.equal(e.vocalNow, null);
    e.vocal(1.6, 1, 5);
    assert.deepEqual(starts.at(-1), [1.6, 2.375], 'mid-bar recovery resumes at the trimmed stem offset');
    assert.equal(e.vocalNow.next, 2);
    const count = starts.length;
    e.vocal(2.975, 2);
    assert.equal(starts.length, count, 'the next boundary keeps the resumed source playing');
    c.currentTime = 3.5;
    e.vocal(3.49, 1, 4, 3.45);
    assert.ok(Math.abs(starts.at(-1)[0] - 3.505) < 1e-9);
    assert.ok(Math.abs(starts.at(-1)[1] - 2.305) < 1e-9, 'a late room stem starts at the current grid phase');
    e.vocal(4.97, 2, 0, 4.97);
    assert.equal(starts.length, count + 1, 'small room clock updates keep the existing source');
    e.vocal(7.05, 3, 0, 7.05);
    assert.equal(starts.length, count + 1, 'a routine grid correction does not retrigger a continuous stem');
    c.currentTime = 7.1;
    e.discardQueuedNotes(c.currentTime);
    e.vocal(7.1, 3, 0, 7.05);
    assert.equal(starts.length, count + 2, 'a cleared clock jump starts a new stem on the corrected grid');
    assert.ok(Math.abs(starts.at(-1)[1] - 5.805) < 1e-9);
    e.vocal(3, 20, 5);
    assert.equal(e.vocalNow, null, 'an exhausted stem stays silent');
    e.vocalOf = () => null;
    e.vocal(4, 1, 5);
    assert.equal(e.vocalNow, null, 'songs without a stem do not start a source');
  }

  {
    const c = fakeCtx(24000), s = defaultState();
    const buf = new FakeBuffer({ length: 48000, sampleRate: 24000 });
    buf.getChannelData(0).fill(.1);
    let stem = null, buffers = 0;
    const createBuffer = c.createBuffer;
    c.createBuffer = (...args) => { buffers++; return createBuffer(...args); };
    const e = new Engine(c, s, { vocal: () => stem });
    e.prepareVocal();
    assert.equal(e.vocalFx, undefined, 'no stem leaves the vocal FX unbuilt');
    stem = { buf, fx: VOCAL_FX.pop, gain: 1, duck: .5, lift: .8, ms: 0 };
    e.prepareVocal();
    const F = e.vocalFx, impulse = F.plate.buffer, preparedBuffers = buffers, preparedNodes = counts.n;
    const expected = makeIR(c, 1.6, { decay: 3.2, brightStart: .9, brightEnd: .35, predelay: .012, seed: 97 });
    assert.deepEqual(impulse.getChannelData(0), expected.getChannelData(0), 'preparation preserves the plate IR');
    assert.deepEqual(impulse.getChannelData(1), expected.getChannelData(1));
    buffers = preparedBuffers;
    const automation = [];
    for (const [name, p] of [['plate', F.plateSend.gain], ['delay', F.dly.delayTime], ['send', F.dlySend.gain], ['feedback', F.fb.gain]])
      p.setTargetAtTime = (...args) => automation.push([name, ...args]);
    const getChannelData = buf.getChannelData.bind(buf);
    buf.getChannelData = () => { throw new Error('Unprepared vocal buffer scan'); };
    e.prepareVocal();
    assert.equal(counts.n, preparedNodes, 'preparing again does not rebuild FX');
    assert.equal(buffers, preparedBuffers, 'IR and processed stem are cached');
    assert.deepEqual(automation, [], 'preparation does not automate audible send levels');
    e.vocal(1, 0);
    assert.equal(counts.n - preparedNodes, 2, 'first solo vocal creates only its source and fade gain');
    assert.equal(buffers, preparedBuffers, 'first vocal does not build an IR or process the stem');
    assert.equal(F.plate.buffer, impulse);
    assert.deepEqual(automation, [['plate', .14, 0, .02], ['delay', .5 * 60 / s.bpm, 0, .02], ['send', .1, 0, .02], ['feedback', .22, 0, .02]]);
    buf.getChannelData = getChannelData;
    const roomState = { ...s, room: true };
    e.vocalOf = state => state.room ? { ...stem, fx: VOCAL_FX.folk } : stem;
    e.prepareVocal(roomState);
    assert.equal(F.plate.buffer, impulse, 'preparing a queued genre does not change the playing reverb');
    assert.equal(automation.length, 4);
    e.vocalOf = () => null;
    e.prepareVocal();
    assert.equal(F.plate.buffer, impulse);
    e.vocalOf = () => { throw new Error('Stem lookup failed'); };
    assert.throws(() => e.prepareVocal(), /Stem lookup failed/);
    console.log('Vocal preparation PASS: first solo source has no FX/IR/stem/envelope build; identical IR and send automation; cached preparation; silent/queued stems.');
  }

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
