// Upstash-compatible REST endpoint for tests: POST / runs one command, POST /pipeline runs a list.
// Backed by any { cmd, pipe } KV: the in-memory twin, or a real redis-server via respKv() to exercise the Lua script.
import http from 'node:http';
import net from 'node:net';

export async function startUpstash(kv, token = 'test-token') {
  const stats = { requests: 0, commands: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const send = (status, json) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'unauthorized' });
      const body = JSON.parse(Buffer.concat(chunks).toString() || 'null');
      stats.requests++;
      if (req.url === '/pipeline') {
        stats.commands += body.length;
        const out = await kv.pipe(body);
        return send(200, out.map((r) => (r instanceof Error ? { error: r.message } : { result: r })));
      }
      stats.commands++;
      try { send(200, { result: await kv.cmd(body) }); } catch (err) { send(400, { error: err.message }); }
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, stats, env: { KV_REST_API_URL: `http://127.0.0.1:${server.address().port}`, KV_REST_API_TOKEN: token }, close: () => server.close() };
}

// Minimal RESP2 client (one connection, replies in order) so tests can run the real Lua against redis-server.
export function respKv(port) {
  const sock = net.connect(port, '127.0.0.1');
  const waiting = [];
  let buf = Buffer.alloc(0);
  const parse = (i) => {
    const nl = buf.indexOf('\r\n', i);
    if (nl < 0) return null;
    const t = String.fromCharCode(buf[i]), line = buf.toString('utf8', i + 1, nl), next = nl + 2;
    if (t === '+') return [line, next];
    if (t === '-') return [new Error(line), next];
    if (t === ':') return [+line, next];
    if (t === '$') { const n = +line; if (n < 0) return [null, next]; if (buf.length < next + n + 2) return null; return [buf.toString('utf8', next, next + n), next + n + 2]; }
    if (t === '*') {
      const n = +line; if (n < 0) return [null, next];
      const out = []; let at = next;
      for (let k = 0; k < n; k++) { const r = parse(at); if (!r) return null; out.push(r[0]); at = r[1]; }
      return [out, at];
    }
    throw new Error(`bad RESP ${t}`);
  };
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (let r; buf.length && (r = parse(0));) { buf = buf.subarray(r[1]); waiting.shift()(r[0]); }
  });
  const send = (args) => new Promise((ok) => {
    waiting.push(ok);
    sock.write(`*${args.length}\r\n${args.map((a) => { const s = String(a); return `$${Buffer.byteLength(s)}\r\n${s}\r\n`; }).join('')}`);
  });
  return {
    kind: 'redis',
    ready: new Promise((ok, fail) => { sock.once('connect', ok); sock.once('error', fail); }),
    async cmd(args) { const r = await send(args); if (r instanceof Error) throw r; return r; },
    pipe: (list) => Promise.all(list.map(send)),
    close: () => sock.end(),
  };
}
