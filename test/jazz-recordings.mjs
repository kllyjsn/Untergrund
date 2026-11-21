import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EP_BANKS, epLayer, epNotches, recordedJazzKeys } from '../js/jazz-recordings.js';
import { JAZZ_BANKS } from '../js/jazz-sample-data.js';
import { liveSets, STAB_BAND } from '../js/livekit.js';
import { freshSong } from '../js/state.js';

assert.deepEqual([0, 37 / 127, 38 / 127, 65 / 127, 66 / 127, 89 / 127, 90 / 127, 1].map(epLayer), [0, 0, 1, 1, 2, 2, 3, 3]);
assert.equal(STAB_BAND[18], 'nylon', 'existing voice indices stay stable');
assert.deepEqual(epNotches('jep3', 68.01, 2), [[4150, 50, -16], [4978, 50, -18]]);
assert.deepEqual(epNotches('jep1', 68, 1), [], 'unaffected takes remain unfiltered');
for (const style of ['swing', 'modal', 'bossa', 'jazzfunk']) assert(EP_BANKS.every((name) => liveSets(freshSong(style, 42)).includes(name)));
assert(EP_BANKS.every((name) => !liveSets(freshSong('trap', 42)).includes(name)));

const probe = (velocity = .6, params = {}, absent = '') => {
  const calls = [], nodes = [];
  const node = () => { const n = { frequency: {}, pan: {}, gain: {}, connect(to) { return to; }, stop() {} }; nodes.push(n); return n; };
  const e = { rec: (bank) => bank === absent ? null : JAZZ_BANKS[bank].map((m) => [m, { bank, root: m }]), ctx: { createStereoPanner: node, createOscillator: node }, gain: node, startSource() {}, playBuf: (...args) => calls.push(args) };
  const result = recordedJazzKeys(e, 1, velocity * 2, [0, 4, 7], 60, { env: .12, detune: .6, decay: .3, cutoff: 1700, ...params }, {}, 2);
  return { result, calls, nodes };
};
for (const [i, v] of [.2, .4, .6, .9].entries()) {
  const p = probe(v);
  assert(p.result && p.calls.length === 3);
  assert(p.calls.every(([buf]) => buf.bank === EP_BANKS[i]));
  for (const [buf, , , , rate, , fx] of p.calls) {
    const wanted = [60, 64, 67][p.calls.findIndex((c) => c[0] === buf)];
    assert(Math.abs(buf.root - wanted) <= 6, 'nearest root is selected within each dynamic');
    assert(rate > 0 && fx.ringOut && fx.release > 0 && fx.fade > 0);
    assert.equal(fx.lp, undefined, 'no broad low-pass is used as resonance treatment');
  }
}
assert(!probe(.6, {}, 'jep1').result, 'incomplete loading retains the FM fallback');
assert.equal(probe(.6, {}, 'jep1').nodes.length, 0, 'failed loading creates no audio nodes');
assert(probe(.6, { env: .8 }).calls[0][6].release > probe().calls[0][6].release);
assert(probe(.6, { env: .8 }).calls[0][6].fade > probe().calls[0][6].fade);
assert.notEqual(probe(.6, { detune: 20 }).calls[0][4], probe().calls[0][4], 'DETUNE changes recorded playback pitch');
assert(recordedJazzKeys({}, 0, 1, [], 60, {}, {}, 1), 'empty chords are silent');

const provenance = JSON.parse(readFileSync(new URL('../samples/wurlitzer-provenance.json', import.meta.url)));
assert.equal(provenance.license, 'CC-BY-3.0');
assert.equal(provenance.samples.length, 42);
assert.equal(provenance.processing.sampleRate, 48000);
assert.equal(provenance.processing.bits, 24);
for (const s of provenance.samples) {
  assert(s.sourceUrl.includes(provenance.commit) && Number.isFinite(s.measuredCents));
  assert.equal(createHash('sha256').update(readFileSync(new URL(`../samples/live/${s.importedFile}`, import.meta.url))).digest('hex'), s.importedSha256);
}
console.log('jazz recordings: four Wurlitzer dynamics, nearest roots, ENV/DETUNE, loading fallback and provenance passed');
