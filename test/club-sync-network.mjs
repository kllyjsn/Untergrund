import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { performance } from 'node:perf_hooks';

const HANDLE = '7f00:';
export function parseNetwork(value) {
  const profile = {};
  if (value === undefined) return profile;
  assert.ok(value, '--net must not be empty');
  for (const entry of value.split(',')) {
    const [key, raw, extra] = entry.split('=');
    assert.ok(!extra && raw && ['delay', 'jitter', 'loss', 'rate', 'reorder'].includes(key), `Invalid --net entry: ${entry}`);
    assert.ok(!(key in profile), `Duplicate --net entry: ${key}`);
    if (key === 'rate') {
      assert.match(raw, /^[1-9]\d*(?:kbit|mbit|gbit)$/i, 'Invalid net rate');
      profile[key] = raw.toLowerCase();
    } else {
      assert.match(raw, /^\d+(?:\.\d+)?$/, `Invalid net ${key}`);
      const number = Number(raw);
      assert.ok(Number.isFinite(number) && number <= (['loss', 'reorder'].includes(key) ? 100 : 60000), `Out-of-range net ${key}`);
      profile[key] = number;
    }
  }
  assert.ok(!profile.jitter || profile.delay, 'net jitter requires delay');
  assert.ok(!profile.reorder || profile.delay, 'net reorder requires delay');
  return profile;
}

export function netemArgs(profile) {
  return [...(profile.delay ? ['delay', `${profile.delay}ms`, ...(profile.jitter ? [`${profile.jitter}ms`] : [])] : []),
    ...(profile.loss ? ['loss', `${profile.loss}%`] : []),
    ...(profile.reorder ? ['reorder', `${profile.reorder}%`] : []),
    ...(profile.rate ? ['rate', profile.rate] : [])];
}

export function portFilters(port) {
  return ['ip', 'ipv6'].flatMap(protocol => ['sport', 'dport'].map(direction =>
    ['filter', 'add', 'dev', 'lo', 'parent', HANDLE, 'protocol', protocol, 'prio', protocol === 'ip' ? '1' : '2', 'u32',
      'match', protocol === 'ip' ? 'ip' : 'ip6', 'protocol', '6', '0xff',
      'match', protocol === 'ip' ? 'ip' : 'ip6', direction, String(port), '0xffff', 'flowid', '7f00:4']));
}

export function clockSpread(capture) {
  const summarize = anchors => {
    const offsets = anchors.map(([context, epoch]) => epoch - context * 1000).filter(Number.isFinite).sort((a, b) => a - b);
    if (!offsets.length) return { count:0, rangeMs:null, p95MinusP5Ms:null };
    return { count:offsets.length, rangeMs:offsets.at(-1) - offsets[0],
      p95MinusP5Ms:offsets[Math.floor((offsets.length - 1) * .95)] - offsets[Math.floor((offsets.length - 1) * .05)] };
  };
  const anchors = capture.anchors || [], boundary = capture.resumeBoundary;
  return { all:summarize(anchors), ...(boundary ? {
    beforeResume:summarize(anchors.filter(([, epoch]) => epoch < boundary.at)),
    afterResume:summarize(anchors.filter(([, epoch]) => epoch >= boundary.at)) } : {}) };
}

export async function probe(url, count = 5) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    try {
      const response = await fetch(`${url}/api/rooms`, { headers:{Connection:'close'}, signal:AbortSignal.timeout(15000) });
      await response.arrayBuffer();
      samples.push({ ms:performance.now() - start, status:response.status });
    } catch (error) { samples.push({ ms:performance.now() - start, error:String(error) }); }
  }
  const times = samples.filter(s => !s.error).map(s => s.ms).sort((a, b) => a - b);
  return { samples, failed:samples.filter(s => s.error).length, total:count,
    medianMs:times.length ? times[Math.floor(times.length / 2)] : null,
    note:'HTTP transaction timings, not ICMP RTT; failures are request failures, not packet-loss estimates. TCP retransmits lost packets.' };
}

export async function networkController(serverPort, profile, target, label) {
  const proxies = [], sockets = new Set();
  let owned = false;
  const tc = args => execFileSync('sudo', ['-n', 'tc', ...args], { encoding:'utf8', stdio:['ignore', 'pipe', 'pipe'] });
  const cleanupSync = () => {
    if (!owned) return;
    const current = tc(['qdisc', 'show', 'dev', 'lo']);
    if (current.includes(`prio ${HANDLE}`)) tc(['qdisc', 'del', 'dev', 'lo', 'root']);
    owned = false;
  };
  const exit = () => { try { cleanupSync(); } catch (error) { console.error('NETEM CLEANUP FAILED:', String(error)); } };
  process.on('exit', exit);
  const close = async () => {
    try { cleanupSync(); } finally {
      for (const socket of sockets) socket.destroy();
      await Promise.all(proxies.map(p => new Promise(resolve => p.close(resolve))));
      process.removeListener('exit', exit);
    }
  };
  const metadata = { label, target, profile, scope:'whole-origin TCP proxy ports; netem applies independently to request and response packets', clients:{} };
  try {
    if (Object.keys(profile).length) {
      const current = tc(['qdisc', 'show', 'dev', 'lo']);
      assert.ok(/^qdisc noqueue 0: root/m.test(current), `Refusing to replace existing lo qdisc: ${current}`);
      tc(['qdisc', 'add', 'dev', 'lo', 'root', 'handle', HANDLE, 'prio', 'bands', '4', 'priomap', ...Array(16).fill('0')]);
      owned = true;
      tc(['qdisc', 'add', 'dev', 'lo', 'parent', '7f00:4', 'handle', '7f40:', 'netem', ...netemArgs(profile)]);
      for (const name of target === 'both' ? ['host', 'listener'] : ['listener']) {
        const proxy = createServer(socket => {
          const upstream = connect({host:'127.0.0.1', port:serverPort});
          for (const s of [socket, upstream]) { sockets.add(s); s.on('close', () => sockets.delete(s)); }
          socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
          socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy());
          socket.pipe(upstream); upstream.pipe(socket);
        });
        proxies.push(proxy);
        await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '::', resolve); });
        const port = proxy.address().port;
        for (const filter of portFilters(port)) tc(filter);
        metadata.clients[name] = { port, base:`http://localhost:${port}` };
      }
      metadata.qdisc = tc(['-s', 'qdisc', 'show', 'dev', 'lo']);
      metadata.filters = tc(['filter', 'show', 'dev', 'lo', 'parent', HANDLE]);
    }
    const direct = `http://localhost:${serverPort}`;
    metadata.probes = { direct:await probe(direct) };
    for (const [name, client] of Object.entries(metadata.clients)) {
      metadata.probes[name] = await probe(client.base);
      const measured = metadata.probes[name];
      assert.ok(measured.medianMs !== null, `Proxy ${name} probe never succeeded`);
      if (profile.delay) assert.ok(measured.medianMs - metadata.probes.direct.medianMs >= profile.delay * .5,
        `Proxy ${name} delay not observed: ${JSON.stringify(measured)}`);
    }
    return { metadata, base:name => metadata.clients[name]?.base || direct, close,
      counters:() => Object.keys(profile).length ? tc(['-s', 'qdisc', 'show', 'dev', 'lo']) : null };
  } catch (error) { await close(); throw error; }
}
