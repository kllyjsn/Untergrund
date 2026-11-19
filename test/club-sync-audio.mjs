// Runs before app modules. Only the destination edge is replaced: the worklet
// passes the original samples through unchanged and reports a low-pass envelope.
export function installAudioTap(skew, fixture) {
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
  const tap = globalThis.__clubAudio = { samples: [], anchors: [], errors: [], routes: [] };
  const connect = AudioNode.prototype.connect;
  const taps = new WeakMap();
  const code = `class Tap extends AudioWorkletProcessor {
    constructor() { super(); this.low = 0; this.rows = []; }
    process(inputs, outputs) {
      const input = inputs[0], output = outputs[0];
      for (let c = 0; c < output.length; c++) output[c].set(input[c] || input[0] || new Float32Array(128));
      let energy = 0;
      const x = input[0];
      if (x) for (let i = 0; i < x.length; i++) {
        this.low += (1 - Math.exp(-2 * Math.PI * 180 / sampleRate)) * (x[i] - this.low);
        energy += this.low * this.low;
      }
      this.rows.push([currentFrame / sampleRate, Math.sqrt(energy / 128)]);
      if (this.rows.length >= 64) { this.port.postMessage(this.rows); this.rows = []; }
      return true;
    }
  }; registerProcessor('club-tap', Tap);`;
  AudioNode.prototype.connect = function (dest, ...args) {
    // MediaRecorder also uses MediaStreamDestination; that is not an output.
    if (dest !== this.context.destination) return connect.call(this, dest, ...args);
    const ctx = this.context;
    let entry = taps.get(ctx);
    if (!entry) {
      const gain = ctx.createGain();
      entry = { gain }; taps.set(ctx, entry);
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
        const t = ctx.getOutputTimestamp();
        if (t.contextTime > 0 && t.performanceTime > 0)
          tap.anchors.push([t.contextTime, performance.timeOrigin + t.performanceTime]);
      }, 100);
    }
    connect.call(this, entry.gain, ...args);
    return dest;
  };
  setInterval(() => {
    if ([...document.querySelectorAll('audio')].some(e => e.srcObject && !e.paused))
      tap.errors.push('Active MediaStream audio element: output clock unsupported (iOS route)');
  }, 1000);
}

export function envelope(capture) {
  if (capture.errors.length) throw new Error(capture.errors.join('; '));
  if (!capture.anchors.length || !capture.samples.length) throw new Error('No rendered audio/output timestamps');
  let j = 0;
  return capture.samples.map(([t, e]) => {
    while (j + 1 < capture.anchors.length && Math.abs(capture.anchors[j + 1][0] - t) < Math.abs(capture.anchors[j][0] - t)) j++;
    const a = capture.anchors[j];
    return [a[1] + (t - a[0]) * 1000, e];
  });
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
    if (out.every(x => Math.abs(x - t) > 60000 / bpm * .72)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

const quantile = (a, p) => a.length ? [...a].sort((x, y) => x - y)[Math.ceil((a.length - 1) * p)] : null;
export function compare(host, listener, bpm) {
  const beat = 60000 / bpm;
  const deltas = listener.map(t => t - host.reduce((a, b) => Math.abs(b - t) < Math.abs(a - t) ? b : a, Infinity));
  const matched = deltas.filter(d => Math.abs(d) < beat / 2);
  const gaps = a => a.slice(1).reduce((n, t, i) => n + Math.max(0, Math.round((t - a[i]) / beat) - 1), 0);
  const abs = matched.map(Math.abs);
  return { median: quantile(abs, .5), p95: quantile(abs, .95), max: abs.length ? Math.max(...abs) : null,
    matched: matched.length, missing: { host: gaps(host), listener: gaps(listener) }, deltas: matched };
}

export function correlate(host, listener) {
  const start = Math.max(host[0][0], listener[0][0]), end = Math.min(host.at(-1)[0], listener.at(-1)[0]);
  const bin = rows => {
    const a = new Float64Array(Math.max(0, Math.ceil((end - start) / 4)));
    for (const [t, e] of rows) { const i = Math.floor((t - start) / 4); if (i >= 0 && i < a.length) a[i] = Math.max(a[i], e); }
    return a;
  };
  const a = bin(host), b = bin(listener);
  let best = -Infinity, lag = null;
  for (let d = -25; d <= 25; d++) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 25; i < a.length - 25; i++) { ab += a[i] * b[i + d]; aa += a[i] ** 2; bb += b[i + d] ** 2; }
    const score = ab / Math.sqrt(aa * bb);
    if (score > best) { best = score; lag = d * 4; }
  }
  return { lagMs: lag, score: Number.isFinite(best) ? best : null, searchMs: 100 };
}
