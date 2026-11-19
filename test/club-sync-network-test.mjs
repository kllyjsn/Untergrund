import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
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

const source = await readFile(new URL('./club-sync.mjs', import.meta.url), 'utf8');
const start = source.indexOf('if (results.some(r => r.failed))');
const plot = source.slice(start, source.indexOf('\n  } finally {', start));
for (const failed of [false, true]) for (const unavailable of [false, true]) for (const exitCode of [undefined, 1]) {
  let calls = 0;
  const process = {exitCode};
  runInNewContext(plot, {results:[{failed}], process, root:'', out:'', options:{output:'capture.json'},
    join:(...parts) => parts.join('/'), console:{log(){}, error(){}}, execFileSync:() => {
      calls++;
      if (unavailable) throw new Error('matplotlib unavailable');
      return 'plot.png';
    }});
  assert.equal(calls, Number(failed));
  assert.equal(process.exitCode, exitCode, 'optional plotting never changes the scenario verdict');
}
console.log('Club optional plots PASS: success, empty results and missing matplotlib preserve the scenario exit status.');

const clipStart = source.indexOf('async function saveClips(');
const clipSource = source.slice(clipStart, source.indexOf('\n}', clipStart) + 2);
const pcm = {pcm:Buffer.alloc(8).toString('base64'), coverage:1};
const clients = [0, 1].map(() => ({run:async () => ({vocal:pcm, mix:pcm, expected:pcm, sampleRate:48000})}));
const written = new Map();
const save = (options, networkProfile, writeFile = async (path, samples) => {
  assert.ok(!written.has(path), 'network clip path must not overwrite earlier audio');
  written.set(path, samples);
}) => runInNewContext(`(${clipSource})`, {options, networkProfile, createHash, Buffer, Float32Array, out:'out',
  clipRange:() => ({from:0, to:1000}), extractPCM:() => {}, vocalDb:() => 0, levelMatchClips:() => ({}),
  mkdir:async () => {}, join:(...parts) => parts.join('/'), floatWav:samples => samples, writeFile});
const clipOptions = {output:'capture.json', vocal:'real', 'net-label':'L1', 'net-target':'listener'};
const profile = {delay:50, jitter:10};
const original = await save(clipOptions, profile)(clients, {}, 'reconnect-mix', 1, {recoverAt:0}, 0, 1000);
for (const [options, networkProfile, run] of [
  [{...clipOptions, 'net-label':'L2'}, profile, 1],
  [clipOptions, {...profile, delay:150}, 1],
  [{...clipOptions, 'net-target':'both'}, profile, 1],
  [clipOptions, profile, 2],
  [{...clipOptions, output:'other.json'}, profile, 1],
  [{...clipOptions, vocal:'synthetic-pop'}, profile, 1],
]) {
  const result = await save(options, networkProfile)(clients, {}, 'reconnect-mix', run, {recoverAt:0}, 0, 1000);
  assert.equal(Object.keys(result.paths).length, 5);
  assert.equal(result.sampleRate, 48000);
  assert.equal(result.markerOffsetMs, 4000);
}
const reordered = await save(clipOptions, {jitter:10, delay:50}, async () => {})(clients, {}, 'reconnect-mix', 1, {recoverAt:0}, 0, 1000);
assert.equal(reordered.paths.host, original.paths.host, 'profile key order does not change its evidence identity');
assert.equal(written.size, 35, 'all earlier JSON clip references still address their original audio');
await assert.rejects(() => save(clipOptions, profile)([], {}, 'reconnect-mix', 1, {recoverAt:0}, 0, 1000));
await assert.rejects(() => save(clipOptions, profile, async () => { throw new Error('disk full'); })(clients, {}, 'reconnect-mix', 1, {recoverAt:0}, 0, 1000), /disk full/);
console.log('Club clip paths PASS: labels, profiles, targets, repeats, outputs and vocal modes preserve earlier WAVs; canonical profile order, empty captures and write errors covered.');
