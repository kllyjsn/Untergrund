// Runs before app modules. Only the destination edge is replaced: the worklet
// passes the original samples through unchanged and reports a low-pass envelope.
export function installAudioTap(skew, fixture, displacementMs = 0, mix = false, graph = null) {
  const RealDate = Date;
  globalThis.Date = new Proxy(RealDate, {
    apply: () => new RealDate(RealDate.now() + skew).toString(),
    construct: (target, args) => Reflect.construct(target, args.length ? args : [RealDate.now() + skew]),
    get: (target, key) => key === 'now' ? () => RealDate.now() + skew : Reflect.get(target, key),
  });
  if (fixture) {
    localStorage.setItem('untergrund.v1', JSON.stringify(fixture));
    localStorage.setItem('untergrund.made', '1');
  }
  const tap = globalThis.__clubAudio = { samples: [], anchors: [], errors: [], routes: [], requests: [], lifecycle: [], sources: [], playbackStats: [] };
  if (mix) tap.channels = { kick: { samples: [] }, vocal: { samples: [] } };
  const epoch = () => performance.timeOrigin + performance.now();
  const contexts = [];
  const edges = new WeakMap(), kickNodes = new WeakSet();
  const reachesKick = (node, seen = new Set()) => {
    if (kickNodes.has(node)) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    return [...(edges.get(node) || [])].some(dest => reachesKick(dest, seen));
  };
  const samplePlayback = ctx => {
    try {
      const stats = ctx.playbackStats;
      if (stats && Number.isFinite(stats.underrunEvents) && Number.isFinite(stats.underrunDuration))
        tap.playbackStats.push({ at: epoch(), context: contexts.indexOf(ctx), contextTime: ctx.currentTime,
          underrunEvents: stats.underrunEvents, underrunDuration: stats.underrunDuration, totalDuration: stats.totalDuration });
    } catch (e) { tap.playbackStatsError = String(e); }
  };
  tap.markResume = () => {
    const ctx = contexts[0];
    if (!ctx) return;
    const contextTime = ctx.currentTime;
    tap.resumeBoundary = { at: epoch(), contextTime, sampleRate: ctx.sampleRate,
      frame: Math.round(contextTime * ctx.sampleRate) };
  };
  const clock = ctx => {
    const t = ctx.getOutputTimestamp();
    return { contextTime: ctx.currentTime, outputContextTime: t.contextTime,
      outputEpochMs: performance.timeOrigin + t.performanceTime, state: ctx.state };
  };
  const startOscillator = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when = 0) {
    const kick = graph && reachesKick(this);
    tap.sources.push({ at: epoch(), when, clock: clock(this.context), frequency: this.frequency.value,
      ...(kick ? { tag: 'kick' } : {}) });
    return startOscillator.call(this, when);
  };
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const url = String(args[0]?.url || args[0]);
    if (!url.includes('/api/rooms')) return fetchOriginal(...args);
    const row = { url, method: args[1]?.method || 'GET', start: epoch() }; tap.requests.push(row);
    try { const r = await fetchOriginal(...args); row.status = r.status; return r; }
    catch (e) { row.error = String(e); throw e; }
    finally { row.end = epoch(); }
  };
  for (const name of ['freeze', 'resume', 'visibilitychange']) document.addEventListener(name,
    () => {
      if (name === 'resume') tap.markResume();
      tap.lifecycle.push({ name, at: epoch(), visibility: document.visibilityState, clocks: contexts.map(clock) });
    });
  const connect = AudioNode.prototype.connect;
  const taps = new WeakMap();
  const code = `class Tap extends AudioWorkletProcessor {
    constructor(options) { super(); this.isolated = !!options.processorOptions?.isolated; this.low = 0; this.vi = 0; this.vq = 0; this.rows = []; }
    process(inputs, outputs) {
      const input = inputs[0], output = outputs[0];
      for (let c = 0; c < output.length; c++) output[c].set(input[c] || input[0] || new Float32Array(128));
      let energy = 0, band = 0, vocal = 0;
      const x = input[0];
      if (x) for (let i = 0; i < x.length; i++) {
        this.low += (1 - Math.exp(-2 * Math.PI * 180 / sampleRate)) * (x[i] - this.low);
        energy += this.isolated ? x[i] * x[i] : this.low * this.low;
        if (${mix} && !this.isolated) {
          const phase = 2 * Math.PI * 10500 * (currentFrame + i) / sampleRate;
          this.vi += .002 * (x[i] * Math.cos(phase) - this.vi);
          this.vq += .002 * (x[i] * Math.sin(phase) - this.vq);
          vocal += this.vi ** 2 + this.vq ** 2;
          band += (x[i] - this.low) ** 2;
        }
      }
      this.rows.push([currentFrame / sampleRate, Math.sqrt(energy / 128), Math.sqrt(band / 128), Math.sqrt(vocal / 128)]);
      if (this.rows.length >= 64) { this.port.postMessage(this.rows); this.rows = []; }
      return true;
    }
  }; registerProcessor('club-tap', Tap);`;
  const captured = new WeakSet();
  const captureChannel = (source, name) => {
    if (captured.has(source)) return;
    captured.add(source);
    const ctx = source.context, entry = taps.get(ctx);
    if (!entry) { tap.errors.push('Channel connected before destination tap: ' + name); return; }
    const channel = tap.channels[name];
    if (channel.edge) { tap.errors.push('Duplicate channel edge: ' + name); return; }
    channel.edge = { name, source:source.constructor.name, at:epoch(), line:graph[name] };
    if (name === 'kick') kickNodes.add(source);
    entry.ready.then(() => {
      const node = new AudioWorkletNode(ctx, 'club-tap', { outputChannelCount:[2], processorOptions:{isolated:true} });
      const mute = ctx.createGain(); mute.gain.value = 0;
      node.port.onmessage = ({data}) => channel.samples.push(...data);
      connect.call(source, node); connect.call(node, mute); connect.call(mute, ctx.destination);
      channel.ready = true;
    }).catch(e => tap.errors.push(String(e)));
  };
  AudioNode.prototype.connect = function (dest, ...args) {
    if (graph) {
      if (!edges.has(this)) edges.set(this, new Set());
      edges.get(this).add(dest);
    }
    if (graph && !(tap.channels.kick.edge && tap.channels.vocal.edge) && this instanceof GainNode && dest instanceof GainNode) {
      const stack = new Error().stack || '';
      if (stack.includes('/js/engine.js:' + graph.kick + ':') && dest.gain.value === 0) captureChannel(this, 'kick');
      if (stack.includes('/js/engine.js:' + graph.vocal + ':') && this.gain.value === 0) captureChannel(this, 'vocal');
    }
    // MediaRecorder also uses MediaStreamDestination; that is not an output.
    if (dest !== this.context.destination) return connect.call(this, dest, ...args);
    const ctx = this.context;
    let entry = taps.get(ctx);
    if (!entry) {
      contexts.push(ctx);
      samplePlayback(ctx);
      const gain = ctx.createGain();
      const delay = ctx.createDelay(3);
      delay.delayTime.value = displacementMs / 1000;
      connect.call(delay, gain);
      entry = { gain, input: delay }; taps.set(ctx, entry);
      tap.routes.push('AudioContext.destination');
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      entry.ready = ctx.audioWorklet.addModule(url).then(() => {
        URL.revokeObjectURL(url);
        const node = new AudioWorkletNode(ctx, 'club-tap', { outputChannelCount: [2] });
        node.port.onmessage = ({ data }) => tap.samples.push(...data);
        connect.call(gain, node); connect.call(node, dest);
        entry.node = node;
      }).catch(e => tap.errors.push(String(e)));
      setInterval(() => {
        samplePlayback(ctx);
        const t = ctx.getOutputTimestamp();
        if (t.contextTime > 0 && t.performanceTime > 0)
          tap.anchors.push([t.contextTime, performance.timeOrigin + t.performanceTime]);
      }, 100);
    }
    connect.call(this, entry.input, ...args);
    return dest;
  };
  setInterval(() => {
    if ([...document.querySelectorAll('audio')].some(e => e.srcObject && !e.paused))
      tap.errors.push('Active MediaStream audio element: output clock unsupported (iOS route)');
  }, 1000);
}

export function envelope(capture, column = 1) {
  if (capture.errors.length) throw new Error(capture.errors.join('; '));
  const anchors = [];
  for (const a of capture.anchors) {
    if (Number.isFinite(a[0]) && Number.isFinite(a[1]) && (!anchors.length || a[0] > anchors.at(-1)[0])) anchors.push(a);
  }
  if (!anchors.length || !capture.samples.length) throw new Error('No rendered audio/output timestamps');
  let j = 0;
  return capture.samples.map(row => {
    const t = row[0], e = row[column];
    while (j + 1 < anchors.length && Math.abs(anchors[j + 1][0] - t) < Math.abs(anchors[j][0] - t)) j++;
    const a = anchors[j];
    return [a[1] + (t - a[0]) * 1000, e];
  });
}

export function postResumeEnvelope(capture, column = 1) {
  const boundary = capture.resumeBoundary;
  if (!boundary || !Number.isFinite(boundary.frame) || !(boundary.sampleRate > 0))
    throw new Error('Missing resume PCM boundary');
  return envelope({ ...capture,
    samples: capture.samples.filter(([t]) => Math.round(t * boundary.sampleRate) >= boundary.frame) }, column);
}

export function onsets(rows, bpm) {
  // Smooth away individual bass cycles before taking positive spectral flux.
  let smooth = 0;
  const energy = rows.map(([t, e]) => [t, smooth += .2 * (e - smooth)]);
  const flux = energy.map(([t, e], i) => [t, Math.max(0, e - (energy[Math.max(0, i - 8)]?.[1] || 0))]);
  const peak = Math.max(0, ...flux.map(r => r[1]));
  if (!(peak > .0001)) return [];
  const out = [];
  for (const [t, f] of [...flux].sort((a, b) => b[1] - a[1])) {
    if (f < peak * .25) break;
    if (out.every(x => Math.abs(x - t) > 60000 / bpm * .35)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

const quantile = (a, p) => a.length ? [...a].sort((x, y) => x - y)[Math.ceil((a.length - 1) * p)] : null;

export function correlate(host, listener, searchMs = 3900) {
  if (!host.length || !listener.length) return { lagMs: null, score: null, searchMs };
  const start = Math.max(host[0][0], listener[0][0]), end = Math.min(host.at(-1)[0], listener.at(-1)[0]);
  if (end - start < 1000) return { lagMs: null, score: null, searchMs };
  const bin = rows => {
    const a = new Float64Array(Math.max(0, Math.ceil((end - start) / 4)));
    for (const [t, e] of rows) { const i = Math.floor((t - start) / 4); if (i >= 0 && i < a.length) a[i] = Math.max(a[i], e); }
    return a;
  };
  const a = bin(host), b = bin(listener);
  let best = -Infinity, lag = null;
  for (let d = -Math.floor(searchMs / 4); d <= Math.floor(searchMs / 4); d++) {
    let ab = 0, aa = 0, bb = 0;
    const lo = Math.max(0, -d), hi = Math.min(a.length, b.length - d);
    if ((hi - lo) * 4 < Math.max(2000, (end - start) * .6)) continue;
    for (let i = lo; i < hi; i++) { ab += a[i] * b[i + d]; aa += a[i] ** 2; bb += b[i + d] ** 2; }
    const score = ab / Math.sqrt(aa * bb);
    if (score > best) { best = score; lag = d * 4; }
  }
  return { lagMs: lag, score: Number.isFinite(best) ? best : null, searchMs };
}

export const BPM = 123;
export const STEP_MS = 15000 / BPM;
export const KICK_STEPS = [[0, 3, 8, 12], [0, 6, 10, 14], [2, 5, 9, 13], [1, 4, 8, 13]];
export const PERIOD_MS = STEP_MS * 64;

// Resolve the pattern's signed lag first; only then assign individual onsets.
// A displaced listener is matched to host(t - lag), never nearest host(t).
export function resolvedCompare(hostEnvelope, listenerEnvelope, from, to) {
  const slice = rows => rows.filter(([t]) => t >= from && t <= to);
  const he = slice(hostEnvelope), le = slice(listenerEnvelope);
  const host = onsets(hostEnvelope, BPM), listener = onsets(listenerEnvelope, BPM);
  const enough = host.filter(t => t >= from && t <= to).length >= 4 && listener.filter(t => t >= from && t <= to).length >= 4;
  const correlation = correlate(enough ? he : [], enough ? le : [], PERIOD_MS / 2 - 4);
  const lag = correlation.lagMs;
  const used = new Set(), matched = [], unmatched = [];
  for (const t of listener) {
    let index = -1, distance = Infinity;
    for (let i = 0; i < host.length; i++) {
      const d = Math.abs(t - host[i] - (lag || 0));
      if (!used.has(i) && d < distance) { distance = d; index = i; }
    }
    if (lag !== null && distance <= STEP_MS * .48) {
      used.add(index); matched.push({ host: host[index], listener: t, delta: t - host[index] });
    } else unmatched.push(t);
  }
  // Guards constrain the host events counted, not where their counterparts may lie.
  const observableFrom = lag === null ? from : Math.max(from, listenerEnvelope[0][0] - lag);
  const observableTo = lag === null ? to : Math.min(to, listenerEnvelope.at(-1)[0] - lag);
  const inside = t => t >= observableFrom && t <= observableTo;
  const h = host.filter(inside), pairs = matched.filter(p => inside(p.host));
  const missing = h.filter(t => !used.has(host.indexOf(t)));
  const deltas = pairs.map(p => p.delta), abs = deltas.map(Math.abs);
  const gaps = [];
  for (let i = 0; i < h.length; i++) {
    if (!missing.includes(h[i])) continue;
    const first = i;
    while (i + 1 < h.length && missing.includes(h[i + 1])) i++;
    const end = h[i + 1] ?? observableTo;
    gaps.push({ from: h[first], to: end, missing: i - first + 1, durationMs: end - h[first] });
  }
  return { signedLagMs: lag, correlation, median: quantile(abs, .5), p95: quantile(abs, .95),
    max: abs.length ? Math.max(...abs) : null, matched: pairs.length,
    expected: h.length, missing: missing.length, extra: unmatched.filter(t => inside(t - (lag || 0))).length,
    gaps, deltas, pairs, from, to, observableFrom, observableTo };
}

export function fixtureMissing(hostEnvelope, origin, from, to) {
  if (!Number.isFinite(origin)) throw new Error('Missing server transport origin');
  const host = onsets(hostEnvelope, BPM);
  const positions = KICK_STEPS.flatMap((bar, b) => bar.map(s => (b * 16 + s) * STEP_MS));
  const expected = [];
  for (let n = Math.floor((from - origin - 200) / PERIOD_MS) - 1; origin + n * PERIOD_MS <= to + 200; n++)
    for (const t of positions) { const at = origin + n * PERIOD_MS + t; if (at >= from - 200 && at <= to + 200) expected.push(at); }
  const offsets = expected.map(t => host.reduce((a, b) => Math.abs(b - t) < Math.abs(a - t) ? b : a, Infinity) - t).filter(d => Math.abs(d) < 200);
  const offset = quantile(offsets, .5) || 0;
  const rendered = expected.map(t => t + offset).filter(t => t >= from && t <= to);
  const missingAt = rendered.filter(t => !host.some(h => Math.abs(h - t) <= 60));
  return { expected: rendered.length, missing: missingAt.length, missingAt, outputOffsetMs: offset };
}
