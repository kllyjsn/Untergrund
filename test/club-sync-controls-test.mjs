import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { findChrome } from './chrome.mjs';
import { installAudioTap } from './club-sync-audio.mjs';

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
const terminate = runInNewContext(`(${source.slice(start, source.indexOf('\nfunction visibleControl(', start))})`);
await terminate(null);
for (const [exitCode, signalCode] of [[null, null], [0, null], [null, 'SIGKILL']]) {
  let onExit, kills = 0, closed = 0;
  await terminate({
    pid: 123, exitCode, signalCode,
    once: (event, callback) => { assert.equal(event, 'exit'); onExit = callback; },
    kill: signal => { assert.equal(signal, 'SIGKILL'); kills++; onExit(); },
    stdout: { destroy: () => closed++ }, stderr: { destroy: () => closed++ },
  });
  assert.equal(kills, exitCode === null && signalCode === null ? 1 : 0);
  assert.equal(closed, 2);
}
await terminate({ exitCode: 0, signalCode: null });
await terminate({ exitCode: null, signalCode: null });
console.log('Club sync Chrome discovery and child-pipe cleanup passed');

const controlStart = source.indexOf('function visibleControl(');
assert.ok(controlStart >= 0);
const select = (elements, selectors = ['.club-primary'], label) => runInNewContext(
  `(${source.slice(controlStart, source.indexOf('\nasync function client(', controlStart))})(${JSON.stringify(selectors)}, ${JSON.stringify(label)})`, {
    document: { querySelectorAll: selector => elements[selector] || [] },
    getComputedStyle: el => ({ visibility: el.visibility }),
  });
const control = (textContent, options = {}) => ({
  textContent, disabled: false, visibility: 'visible',
  getBoundingClientRect: () => ({ width: 100, height: 40 }), ...options,
});
const header = control('LISTEN LIVE'), dock = control('LISTEN LIVE');
const hidden = control('LISTEN LIVE', { getBoundingClientRect: () => ({ width: 0, height: 0 }) });
assert.equal(select({ '.club-primary': [header, hidden] }), header);
assert.equal(select({ '.club-primary': [hidden, dock] }), dock);
assert.equal(select({ '.club-primary': [control('LISTEN LIVE', { disabled: true }), dock] }), dock);
assert.equal(select({ '.club-primary': [control('LISTEN LIVE', { visibility: 'hidden' }), dock] }), dock);
assert.equal(select({ '.club-primary': [control('LISTEN LIVE', { visibility: 'collapse' }), dock] }), dock);
assert.equal(select({ '.club-primary': [control('UPDATE ROOM'), dock] }, ['.club-primary'], 'LISTEN LIVE'), dock);
assert.equal(select({ '.club-primary': [hidden] }), null);
assert.equal(select({}), null);
assert.equal(select({ '.club-primary': [dock] }, ['.club-primary'], 'GO LIVE'), null);
const live = control('GO LIVE'), fallback = control('GO LIVE');
assert.equal(select({ '.lobby-cta': [live], '.club-primary': [fallback] }, ['.lobby-cta', '.club-primary'], 'GO LIVE'), live);
assert.equal(select({ '.lobby-cta': [hidden], '.club-primary': [fallback] }, ['.lobby-cta', '.club-primary'], 'GO LIVE'), fallback);
const pass = control(' PASS DECK ');
assert.equal(select({ '.club-shell button': [hidden, control('PASS DECK', { disabled: true }), pass] }, ['.club-shell button'], 'PASS DECK'), pass);
console.log('Club sync visible controls passed: desktop/header and phone/dock layouts, disabled/hidden duplicates, exact labels, selector priority and empty matches');

const launch = source.slice(source.indexOf('  const proc = spawn(chrome,'), source.indexOf("  let stderr = ''"));
for (const platform of ['darwin', 'linux']) {
  let args;
  runInNewContext(launch, {
    chrome: '/chrome', profile: '/profile', options: {}, fixture: null, audioEnv: undefined,
    process: { platform, env: {} }, spawn: (_chrome, flags) => { args = flags; },
  });
  assert.equal(args.includes('--window-size=1280,900'), platform === 'darwin');
}
console.log('Club sync desktop viewport passed: explicit Mac window; Linux launch arguments unchanged');

const renderingLine = source.split('\n').find(line => line.includes('const rendering ='));
for (const spec of [{}, { joinDelay: 10000 }, { hostSkew: 2000 }, { freezeMs: 800 }]) {
  const rendering = runInNewContext(`${renderingLine}; rendering`, { spec, prejoin: false, handoffMix: false });
  assert.equal(rendering.limitPaint, true);
  assert.equal(rendering.hideStage, true);
}
assert.ok(source.includes('if (spec.mix && !handoffMix && rendering.limitPaint)'));
console.log('Club sync dry paint controls passed: frame limiter and decorative stage only; body controls remain visible');

const context = {
  Date, performance: { timeOrigin: 1000, now: () => 50 },
  PerformanceObserver: class { observe() {} },
  setInterval() {}, document: { addEventListener() {} },
};
runInNewContext(`
  class AudioNode { connect() {} }
  class OscillatorNode extends AudioNode {
    constructor() {
      super(); this.context = { currentTime: 2, getOutputTimestamp: () => ({contextTime:1.9, performanceTime:40}) };
      this.frequency = {value:440};
    }
    start(when) { this.started = when; }
    stop(when) { if (when < 0) throw new Error('negative stop'); this.stopped = when; return 'native'; }
  }
  class AudioBufferSourceNode extends OscillatorNode {}
  class AudioParam { setValueCurveAtTime() {} }
  (${installAudioTap})(0, null);
  globalThis.osc = new OscillatorNode(); osc.start(3);
  globalThis.nativeResult = osc.stop(4);
  osc.stop();
  globalThis.untracked = new AudioBufferSourceNode(); untracked.stop(4);
`, context);
assert.equal(context.nativeResult, 'native');
assert.equal(context.osc.started, 3);
assert.equal(context.osc.stopped, 0);
assert.equal(context.__clubAudio.sources.length, 1);
assert.deepEqual(JSON.parse(JSON.stringify(context.__clubAudio.sources[0].stops)), [
  { at: 1050, when: 4, contextTime: 2 }, { at: 1050, when: 0, contextTime: 2 },
]);
assert.throws(() => runInNewContext('osc.stop(-1)', context), /negative stop/);
assert.equal(context.__clubAudio.sources[0].stops.length, 2);
console.log('Club sync source stops passed: native arguments/return/errors preserved; repeated, default and untracked stops');
