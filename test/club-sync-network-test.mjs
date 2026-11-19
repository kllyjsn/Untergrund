import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { parseNetwork, netemArgs, portFilters, clockSpread, networkController, probe } from './club-sync-network.mjs';

assert.deepEqual(parseNetwork(), {});
assert.deepEqual(netemArgs(parseNetwork('delay=150,jitter=50,loss=3,rate=1mbit,reorder=2')),
  ['delay', '150ms', '50ms', 'loss', '3%', 'reorder', '2%', 'rate', '1mbit']);
assert.deepEqual(netemArgs(parseNetwork('rate=64kbit')), ['rate', '64kbit']);
assert.deepEqual(netemArgs(parseNetwork('loss=0')), []);
for (const input of ['', 'foo=1', 'loss=101', 'loss=-1', 'loss=NaN', 'rate=1;id', 'delay=1,delay=2', 'delay=1=2', 'jitter=10', 'reorder=2'])
  assert.throws(() => parseNetwork(input));
const filters = portFilters(43210);
assert.equal(filters.length, 4);
for (const protocol of ['ip', 'ipv6']) for (const direction of ['sport', 'dport']) {
  assert.ok(filters.some(f => f.includes(protocol) && f.includes(direction) && f.includes('43210') && f.at(-1) === '7f00:4'));
}
assert.equal(clockSpread({}).all.rangeMs, null);
const spread = clockSpread({anchors:[[1, 10000], [2, 11010], [3, 27000], [4, 28005]], resumeBoundary:{at:20000}});
assert.equal(spread.all.rangeMs, 15005);
assert.equal(spread.beforeResume.rangeMs, 10);
assert.equal(spread.afterResume.rangeMs, 5);
const server = createServer((req, res) => res.end('ok'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let network;
const port = server.address().port;
try {
  network = await networkController(port, {}, 'listener', 'control');
  assert.deepEqual(network.metadata.profile, {});
  assert.deepEqual(network.metadata.clients, {});
  assert.equal(network.metadata.probes.direct.failed, 0);
  assert.equal(network.metadata.probes.direct.samples.length, 5);
  assert.equal(network.base('listener'), `http://localhost:${port}`);
  assert.equal(network.counters(), null);
} finally {
  await network?.close();
  await new Promise(resolve => server.close(resolve));
}
assert.equal((await probe(`http://127.0.0.1:${port}`, 1)).failed, 1);
console.log('Club network tests PASS: profile parsing, subsets, invalid/empty input, safe tc args, IPv4/IPv6 bidirectional port filters, empty and segmented output clocks.');
console.log('Club network probes PASS: no-impairment controller, HTTP success/failure samples and cleanup without sudo.');
