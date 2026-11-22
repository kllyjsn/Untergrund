import assert from 'node:assert/strict';
import { withChrome } from './chrome.mjs';
import { nullMetrics, measure } from '../scripts/render-determinism.mjs';

assert.equal(nullMetrics(new Float32Array(4), new Float32Array(4), 1, [0, 2]).rms, 0);
assert.equal(nullMetrics(new Float32Array(4), new Float32Array(4), 1, [0, 2]).silent, true);
assert.throws(() => nullMetrics(new Float32Array(), new Float32Array(), 1, [0, 0]), /Empty render/);
assert.throws(() => nullMetrics(new Float32Array(4), new Float32Array(4), 1, [2, 0]), /Invalid render timeline/);
assert.throws(() => nullMetrics(new Float32Array(4), new Float32Array(4), Infinity, [0, 2]), /Invalid render timeline/);
assert.throws(() => nullMetrics(new Float32Array(4), new Float32Array(4), 1, [0, 0, 2]), /Invalid render timeline/);
assert.throws(() => nullMetrics(new Float32Array([NaN, 0]), new Float32Array(2), 1, [0, 1]), /Nonfinite PCM/);
assert.throws(() => nullMetrics(new Float32Array(2), new Float32Array([0, Infinity]), 1, [0, 1]), /Nonfinite PCM/);
assert.throws(() => nullMetrics(new Float32Array(2), new Float32Array(4), 1, [0, 2]), /length changed/);
const impulse = nullMetrics(new Float32Array([1, 1, 1, 1]), new Float32Array([1, 1, 0, 1]), 1, [0, 1, 2]);
assert.equal(impulse.windows[0].share, 0);
assert.equal(impulse.windows[1].share, 1);
assert.equal(impulse.peak, 1);
assert.equal(impulse.first['0.000001'].frame, 1);
assert.equal(impulse.first['0.000001'].sample, 2);
assert.equal(impulse.first['0.001'].channel, 0);
assert.equal(impulse.first['0.001'].tail, true);
assert.equal(nullMetrics(new Float32Array(4), new Float32Array(4), 1, [0, 2]).first['0.001'], null);
assert.equal(nullMetrics(new Float32Array([0, 0, 0, 1]), new Float32Array(4), 1, [0, 2 - Number.EPSILON]).first['0.001'].sample, 3);
const waltz = nullMetrics(new Float32Array([1, 1, 1, 1, 1, 1]), new Float32Array([1, 1, 0, 1, 1, 1]), 1, [0, 2, 3], 0.5, 3);
assert.equal(waltz.first['0.001'].bar, 1);
assert.equal(waltz.first['0.001'].beat, 2);
await assert.rejects(measure({ runs: 2 }), /three independent/);
await assert.rejects(measure({ stems: ['not-a-track'] }), /Unknown TRACK_ID/);
await assert.rejects(measure({ prompt: 'deep house song minor' }), /Supported prompt/);
await assert.rejects(measure({ stems: [] }), /at least one stem/);
await assert.rejects(measure({ style: 'not-a-style', seed: 11 }), /Unknown style/);
await assert.rejects(measure({ style: 'deephouse', seed: NaN }), /integer seed/);
await assert.rejects(measure({ style: 'deephouse', seed: 11, bars: -1 }), /integer bar count/);

const rows = [];
for (let launch = 0; launch < 3; launch++) {
  const row = await withChrome(run => run(`(async () => {
    const { deterministicAudioSums } = await import('/js/audio-sums.js');
    const original = AudioNode.prototype.connect;
    const results = [];
    for (const incremental of [false, true]) for (const values of [[], [0.125], [1e8, -1e8, 1], [0.125, 0.25, 0.5]]) {
      const ctx = new OfflineAudioContext(2, 128, 48000);
      const other = new OfflineAudioContext(2, 128, 48000), untouched = other.createGain();
      const flush = deterministicAudioSums(ctx, { incremental });
      const create = ctx.createGain;
      deterministicAudioSums(ctx);
      if (create !== ctx.createGain) throw Error('Context was wrapped twice');
      if (untouched.connect !== original || other.createGain().connect !== original || AudioNode.prototype.connect !== original) throw Error('Other contexts were modified');
      for (const value of values) {
        const source = ctx.createConstantSource(); source.offset.value = value;
        source.connect(ctx.destination); source.connect(ctx.destination); source.start();
      }
      flush();
      const removed = ctx.createConstantSource(); removed.offset.value = 123;
      removed.connect(ctx.destination); removed.disconnect(ctx.destination); removed.start();
      let threw = false;
      try { ctx.createChannelSplitter(0); } catch { threw = true; }
      if (!threw) throw Error('Invalid factory input did not throw');
      flush();
      const buf = await ctx.startRendering();
      results.push([buf.getChannelData(0)[64], buf.getChannelData(1)[64]]);
    }
    for (const incremental of [false, true]) for (let repeat = 0; repeat < 10; repeat++) {
      const ctx = new OfflineAudioContext(2, 128, 48000);
      const flush = deterministicAudioSums(ctx, { incremental });
      const output = ctx.createConstantSource(); output.offset.value = 1e8;
      for (const value of [-1e8, 1]) {
        const source = ctx.createConstantSource(); source.offset.value = value;
        source.connect(output.offset); source.start();
      }
      output.connect(ctx.destination); output.start(); flush();
      const buf = await ctx.startRendering();
      results.push([buf.getChannelData(0)[64], buf.getChannelData(1)[64]]);
    }
    for (const incremental of [false, true]) for (const kind of ['gain', 'merger', 'compressor']) for (let repeat = 0; repeat < 10; repeat++) {
      const ctx = new OfflineAudioContext(2, 2048, 48000);
      const flush = deterministicAudioSums(ctx, { incremental });
      const stereo = ctx.createChannelMerger(2);
      for (const [channel, value] of [[0, 1e8], [1, -1e8]]) {
        const source = ctx.createConstantSource(); source.offset.value = value;
        source.connect(stereo, 0, channel); source.start();
      }
      const mono = kind === 'gain' ? ctx.createGain() : kind === 'merger' ? ctx.createChannelMerger(1) : ctx.createDynamicsCompressor();
      mono.channelCount = 1;
      if (kind === 'gain') mono.channelCountMode = 'explicit';
      stereo.connect(mono);
      const source = ctx.createConstantSource(); source.offset.value = 1;
      source.connect(mono); source.start();
      mono.connect(ctx.destination); flush();
      const buf = await ctx.startRendering();
      results.push([buf.getChannelData(0)[1024], buf.getChannelData(1)[1024]]);
    }
    return results;
  })()`));
  if (row === null) throw Error('Render determinism regression requires Chrome');
  rows.push(row);
}
for (const row of rows) assert.deepEqual(row, [[0, 0], [0.125, 0.125], [1, 1], [0.875, 0.875], [0, 0], [0.125, 0.125], [0, 0], [0.875, 0.875], ...Array.from({ length: 80 }, () => [0, 0])]);
console.log('Render determinism: node sums, intrinsic AudioParam sums, mono downmix, silence, connections, errors and context isolation passed across 3 Chrome launches');
