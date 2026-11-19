import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { findChrome, findVisibleControl } from './chrome.mjs';

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

const control = (textContent = '', options = {}) => ({
  textContent, disabled: false, visibility: 'visible',
  getBoundingClientRect: () => ({ width: 100, height: 40 }), ...options,
});
const tab = control(), legacy = control();
const hidden = control('', { getBoundingClientRect: () => ({ width: 0, height: 0 }) });
const select = (elements, selectors = ['.tab-club', '.club-btn'], label) => runInNewContext(
  `(${findVisibleControl})(${JSON.stringify(selectors)}, ${JSON.stringify(label)})`, {
    document: { querySelectorAll: selector => elements[selector] || [] },
    getComputedStyle: el => ({ visibility: el.visibility }),
  });
assert.equal(select({ '.tab-club': [tab], '.club-btn': [legacy] }), tab);
assert.equal(select({ '.tab-club': [hidden], '.club-btn': [legacy] }), legacy);
assert.equal(select({ '.tab-club': [hidden], '.club-btn': [hidden] }), null);
assert.equal(select({ '.tab-club': [control('', { visibility: 'hidden' })], '.club-btn': [legacy] }), legacy);
assert.equal(select({ '.tab-club': [control('', { disabled: true })], '.club-btn': [legacy] }), legacy);
assert.equal(select({}), null);
const pass = control(' PASS DECK ');
assert.equal(select({ button: [control('PASS DECK', { disabled: true }), hidden, pass] }, ['button'], 'PASS DECK'), pass);
assert.equal(select({ button: [pass] }, ['button'], 'UPDATE ROOM'), null);
console.log('Club sync Chrome discovery and visible controls passed');
