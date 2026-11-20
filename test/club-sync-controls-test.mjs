import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { findChrome } from './chrome.mjs';

const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const linux = '/usr/bin/google-chrome';
const discover = (paths, override) => runInNewContext(`(${findChrome})()`, {
  process: { env: { CHROME_PATH: override } },
  existsSync: path => paths.includes(path), readdirSync: () => [], join,
  execFileSync: () => { throw new Error('not installed'); },
});
assert.equal(discover([mac]), mac);
assert.equal(discover([mac, '/custom/chrome'], '/custom/chrome'), '/custom/chrome');
assert.equal(discover([mac], '/missing/chrome'), mac);
assert.equal(discover([linux]), linux);
assert.equal(discover([]), null);

const source = readFileSync(new URL('./club-sync.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function terminate(p) {');
assert.ok(start >= 0);
const terminate = runInNewContext(`(${source.slice(start, source.indexOf('\nasync function client(', start))})`);
await terminate(null);
for (const [exitCode, signalCode] of [[null, null], [0, null], [null, 'SIGKILL']]) {
  let onExit, kills = 0, closed = 0;
  await terminate({
    exitCode, signalCode,
    once: (event, callback) => { assert.equal(event, 'exit'); onExit = callback; },
    kill: signal => { assert.equal(signal, 'SIGKILL'); kills++; onExit(); },
    stdout: { destroy: () => closed++ }, stderr: { destroy: () => closed++ },
  });
  assert.equal(kills, exitCode === null && signalCode === null ? 1 : 0);
  assert.equal(closed, 2);
}
await terminate({ exitCode: 0, signalCode: null });
console.log('Club sync Chrome discovery and child-pipe cleanup passed');
