import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const expected = JSON.parse(readFileSync(new URL('test-commands.json', import.meta.url), 'utf8'));
const { scripts } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

function check(scripts, commands) {
  assert.equal(scripts.test, 'npm run test:core && npm run test:audio');
  assert(commands.length > 0, 'command manifest must not be empty');
  assert.equal(new Set(commands).size, commands.length, 'command manifest contains duplicates');
  const halves = ['test:core', 'test:audio'].map((name) => {
    assert.equal(typeof scripts[name], 'string', name);
    const half = scripts[name].split(' && ');
    assert(half.every((command) => commands.includes(command)), name + ' contains an unknown or empty command');
    assert.deepEqual(half, commands.filter((command) => half.includes(command)), name + ' changes command order or repeats a command');
    return half;
  });
  assert.deepEqual(halves.flat().sort(), [...commands].sort(), 'test halves must cover every command exactly once');
}

const fixture = { test: 'npm run test:core && npm run test:audio', 'test:core': 'node a.mjs', 'test:audio': 'node b.mjs' };
const commands = ['node a.mjs', 'node b.mjs'];
check(fixture, commands);
assert.throws(() => check(fixture, []));
assert.throws(() => check(fixture, [...commands, commands[0]]));
assert.throws(() => check({ ...fixture, test: 'npm run test:core' }, commands));
assert.throws(() => check({ ...fixture, 'test:audio': '' }, commands));
assert.throws(() => check({ ...fixture, 'test:audio': 'node a.mjs' }, commands));
assert.throws(() => check({ ...fixture, 'test:audio': 'node unknown.mjs' }, commands));
assert.throws(() => check({ ...fixture, 'test:core': 'node a.mjs && node a.mjs' }, commands));
assert.throws(() => check({ ...fixture, 'test:core': 'node b.mjs && node a.mjs' }, commands));
assert.throws(() => check(fixture, [...commands, 'node missing.mjs']));

check(scripts, expected);
for (const command of expected) {
  const match = /^(?:node|python3) (\S+)(?: .*)?$/.exec(command);
  assert(match && existsSync(new URL(match[1], root)), 'missing command entry point: ' + command);
}
console.log('test split passed: ' + expected.length + ' commands covered exactly once, in relative order');
