import assert from 'node:assert/strict';
import { mixFixture, realMixFixture, mixBoundaries, mixGraphEdges, channelEnvelope, analyzeMix, matchEvents, realignment, phraseOnsets, boundaryMetric, mixFailures, underrunEvidence, kickAttribution } from './club-sync-mix.mjs';
import { singRequest } from '../js/sing.js';
import { sanitize } from '../js/state.js';
import { postResumeEnvelope, onsets } from './club-sync-audio.mjs';
import { vocalMetrics, vocalFindings, windowOffset, floatWav, levelMatchClips } from './club-sync-vocals.mjs';

const bin = 4, expectedVoice = new Float64Array(8000);
for (let p = 0; p < 9; p++) {
  for (let t = 0; t < 1000; t += bin) {
    const at = 1000 + p * 3000 + t;
    expectedVoice[at / bin] = .2 + .08 * Math.sin(t * (.009 + p * .007)) + .07 * Math.sin(t * (.019 + p * .011));
  }
}
const kickOffsets = Array.from({length:64}, (_, i) => ({at:i * 500, offsetMs:12}));
const measureVoice = rendered => vocalMetrics({expected:expectedVoice, rendered, kickOffsets, from:0, to:30000, marker:6000});
const cleanVoice = measureVoice(expectedVoice);
assert.equal(cleanVoice.vocalVsKick.medianMs, -12);
assert.equal(cleanVoice.gaps.count, 0);
assert.equal(cleanVoice.phrases.missing, 0);
assert.equal(cleanVoice.phrases.doubled, 0);
assert.equal(cleanVoice.recoveryMs, 5000);
assert.deepEqual(vocalFindings([{after:cleanVoice}]), []);
const offsetVoice = new Float64Array(expectedVoice.length);
offsetVoice.set(expectedVoice.subarray(0, -10), 10);
assert.equal(measureVoice(offsetVoice).vocalGrid.medianMs, 40);
assert.equal(measureVoice(offsetVoice).vocalVsKick.medianMs, 28);
assert.equal(measureVoice(offsetVoice).recoveryMs, null);
assert.ok(vocalFindings([{after:measureVoice(offsetVoice)}]).includes('host vocal offset'));
assert.ok(vocalFindings([{after:measureVoice(offsetVoice)}]).includes('host vocal recovery unproven'));
const gapVoice = expectedVoice.slice(); gapVoice.fill(0, 1240 / bin, 1440 / bin);
assert.ok(measureVoice(gapVoice).gaps.intervals.some(g => g.durationMs === 200 && g.startMs === -4760));
const missingVoice = expectedVoice.slice(); missingVoice.fill(0, 4000 / bin, 5000 / bin);
assert.equal(measureVoice(missingVoice).phrases.missing, 1);
const displacedVoice = expectedVoice.slice(); displacedVoice.fill(0, 4000 / bin, 5000 / bin);
displacedVoice.set(expectedVoice.subarray(4000 / bin, 5000 / bin), 4400 / bin);
assert.ok(measureVoice(displacedVoice).phrases.events.some(p => p.start === 4000 && p.status === 'displaced'));
const doubledVoice = expectedVoice.slice(); doubledVoice.set(expectedVoice.subarray(4000 / bin, 5000 / bin), 5400 / bin);
assert.ok(measureVoice(doubledVoice).phrases.events.some(p => p.start === 4000 && p.status === 'doubled'));
assert.ok(measureVoice(doubledVoice).phrases.replays.length);
assert.equal(vocalMetrics({expected:[], rendered:[], to:1000}).measured, false);
assert.equal(vocalMetrics({expected:new Float64Array(1000), rendered:expectedVoice, to:1000}).measured, false);
assert.equal(measureVoice(new Float64Array(expectedVoice.length)).measured, false);
assert.ok(vocalFindings([{after:measureVoice(new Float64Array(expectedVoice.length))}]).includes('host vocal grid unmeasured'));
const periodicVoice = Float64Array.from({length:3000}, (_, i) => .2 + .1 * Math.sin(i * bin * Math.PI / 100));
assert.equal(windowOffset(periodicVoice, periodicVoice, 500, 500).ambiguous, true);
assert.equal(windowOffset(periodicVoice, periodicVoice, 500, 500, 500, bin, 0).lagMs, 0);
const periodicMetrics = vocalMetrics({expected:periodicVoice, rendered:periodicVoice, from:2000, to:9000, marker:2000});
assert.equal(periodicMetrics.phrases.replays.length, 0);
const repeatedPhrases = new Float64Array(8000), repeatedRender = new Float64Array(8000);
for (let p = 0; p < 9; p++) for (let t = 0; t < 1000; t += bin) {
  const i = (1000 + p * 3000 + t) / bin;
  repeatedPhrases[i] = .2 + .08 * Math.sin(t * .035 + p * .17);
  repeatedRender[i + 7] = repeatedPhrases[i];
}
const repeatedMetrics = vocalMetrics({expected:repeatedPhrases, rendered:repeatedRender, from:0, to:30000, marker:0});
assert.equal(repeatedMetrics.phrases.doubled, 0);
assert.equal(repeatedMetrics.phrases.missing, 0);
const clipAudio = {expected:Float32Array.from([.2, -.2, .2, -.2]), listener:Float32Array.from([.4, -.4, .4, -.4]), host:Float32Array.from([.1, -.1, .1, -.1])};
const matching = levelMatchClips(clipAudio, 200);
assert.ok(Math.abs(matching.stats.listener.gain - .25) < 1e-6);
assert.ok(Math.abs(clipAudio.expected[0] - clipAudio.listener[0]) < 1e-6);
const wav = floatWav(clipAudio.expected, 24000);
assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt16LE(20), 3);
assert.equal(wav.readUInt32LE(40), 16);
assert.equal(levelMatchClips({expected:new Float32Array(4), listener:new Float32Array(4)}, 200).activeSamples, 0);
console.log('Vocal ground truth PASS: signed/grid/kick-relative offsets; 200ms gap; missing/displaced/doubled phrases; earlier-content replay; sustained recovery; silence/empty; level matching and float WAV.');

const real = realMixFixture();
assert.deepEqual(real, realMixFixture());
assert.ok(singRequest(real, 'opus')?.score.notes.length);
assert.deepEqual(singRequest(sanitize(real), 'opus'), singRequest(real, 'opus'));
assert.equal(real.bpm, 123);
assert.equal(mixBoundaries(real, 0).find(b => b.section === 'DROP').bar, 8);

const s = mixFixture();
assert.deepEqual(s, mixFixture());
assert.equal(s.chain, 'AAAABBBBCCCCCCCDGGGGGGGHEEEDGGGGGGGHAAAA');
assert.deepEqual(s.solos, {});
const boundaries = mixBoundaries(s, 100000);
assert.equal(boundaries.find(b => b.section === 'DROP').bar, 8);
const hs = [1000, 1500, 2000, 2500];
for (const delta of [-80, -24, 0, 24, 80]) {
  const stats = matchEvents(hs, hs.map(t => t + delta), 900, 2600);
  assert.equal(stats.signedMedianMs, delta);
  assert.equal(stats.signedP95Ms, delta);
  assert.equal(stats.missing, 0);
  assert.equal(stats.extra, 0);
  assert.equal(stats.max, Math.abs(delta));
  assert.equal(realignment({...stats, hostOnsets:hs}, 900), Math.abs(delta) <= 50 ? 1100 + delta : null);
}
const missing = matchEvents(hs, [1020, 2020, 2520, 2300], 900, 2600);
assert.equal(missing.missing, 1); assert.equal(missing.extra, 1);
assert.equal(realignment({...missing, hostOnsets:hs}, 900), null);
const silent = matchEvents(hs, [], 900, 2600);
assert.equal(silent.missing, 4); assert.equal(silent.median, null);
assert.equal(silent.max, null);
assert.equal(matchEvents([], [], 0, 10000).median, null);
assert.deepEqual(phraseOnsets([], .2), []);
const signal = (shift = 0, wrong = false) => Array.from({length:6000}, (_, i) => {
  const t = i * 2;
  const e = t < 4000 ? .2 + .1 * Math.sin(t / 71) : .6 + .25 * Math.sin(t / (wrong ? 17 : 103));
  return [t + shift, e];
});
for (const offset of [-80, -24, 0, 24, 80]) {
  const b = boundaryMetric(signal(), signal(offset), 4000);
  assert.ok(Math.abs(b.deltaMs - offset) <= 4, JSON.stringify(b));
  assert.equal(b.correctSection, Math.abs(offset) <= 50);
}
assert.equal(boundaryMetric(signal(), signal(0, true), 4000).correctSection, false);
assert.equal(boundaryMetric([], [], 4000).correctSection, false);
const kickSignal = (shift = 0, omit = false) => Array.from({length:3000}, (_, i) => {
  const t = i * 2, age = t % 500;
  return [t + shift, omit && t >= 2000 && t < 2500 ? 0 : Math.exp(-age / 25)];
});
for (const delta of [-80, -24, 0, 24, 80]) {
  const k = matchEvents(onsets(kickSignal(), 123), onsets(kickSignal(delta), 123), 900, 2600);
  assert.equal(k.median, Math.abs(delta));
  assert.equal(k.missing, 0);
}
assert.equal(matchEvents(onsets(kickSignal(), 123), onsets(kickSignal(0, true), 123), 900, 2600).missing, 1);
assert.equal(matchEvents(onsets(kickSignal(), 123), [], 900, 2600).missing, 4);
const capture = {errors:[], samples:[[1, .2, .3, .4], [2, .5, .6, .7]], anchors:[[1, 1000], [2, 3000]],
  resumeBoundary:{frame:200, sampleRate:100}};
assert.deepEqual(postResumeEnvelope(capture), [[3000, .5]]);
assert.deepEqual(postResumeEnvelope(capture, 3), [[3000, .7]]);
assert.throws(() => postResumeEnvelope({...capture, resumeBoundary:null}), /Missing resume PCM boundary/);
const graph = await mixGraphEdges();
assert.ok(graph.kick > graph.vocal && graph.vocal > 0);
const isolated = {...capture, channels:{kick:{ready:true, edge:{name:'kick'}, samples:[[1, .8], [2, .9]]}}};
assert.deepEqual(channelEnvelope(isolated, 'kick'), [[1000, .8], [3000, .9]]);
assert.deepEqual(channelEnvelope(isolated, 'kick', true), [[3000, .9]]);
assert.throws(() => channelEnvelope(isolated, 'vocal'), /Missing rendered vocal graph tap/);
const phrases = Array.from({length:4000}, (_, i) => [i * 2, i % 1000 < 750 ? 1 : 0]);
assert.deepEqual(phraseOnsets(phrases, .25), [0, 2000, 4000, 6000]);
assert.equal(matchEvents(phraseOnsets(phrases, .25), phraseOnsets(phrases.filter(([t]) => t < 4000 || t >= 5500), .25), 0, 7000).missing, 1);
assert.ok(mixFailures({phases:{after:{kicks:silent, vocal:{lagMs:null, returnMs:null}}},
  boundaries:[], timeToRealignMs:null, budgetMs:1500, stemInjected:[[], []]}).length >= 3);
const realEvidence = { resolved:true, plays:[{when:1}], apiResponses:[{status:200, type:'audio/ogg'}] };
const realMix = {phases:{after:{kicks:{matched:1, median:0, p95:0, missing:0}, vocal:{lagMs:0, returnMs:0, missing:0, extra:0}}},
  boundaries:[], timeToRealignMs:1000, budgetMs:1500, realStems:[realEvidence, realEvidence]};
assert.deepEqual(mixFailures(realMix, true), []);
for (const realStems of [[], [realEvidence, null], [realEvidence, {...realEvidence, plays:[]}],
  [realEvidence, {...realEvidence, resolved:false}], [realEvidence, {...realEvidence, apiResponses:[{status:502}]}]])
  assert.ok(mixFailures({...realMix, realStems}, true).includes('real stem not loaded/played through API'));
const synthetic = (shift = 0, vocalShift = 0) => {
  const rows = fn => Array.from({length:20000}, (_, i) => [i * .002 + shift / 1000, fn(i * 2)]);
  return {errors:[], anchors:[[0, 0]], samples:rows(t => Math.sin(t / 113) ** 2), stemWarm:{start:-2, end:-1}, sources:[],
    resumeBoundary:{frame:15800 + shift, sampleRate:1000}, stemInjected:[{}], channels:{
      kick:{ready:true, edge:{name:'kick'}, samples:rows(t => Math.exp(-(t % 500) / 25))},
      vocal:{ready:true, edge:{name:'vocal'}, samples:rows(t => t % 4000 < 3000 ? 1 + .3 * Math.sin(t / 31) : 0).map(([t, e]) => [t + vocalShift / 1000, e])},
    }};
};
for (const shift of [-24, 0, 24]) {
  const mix = analyzeMix([synthetic(), synthetic(shift)], s, {interruptAt:15000, recoverAt:15800}, 0);
  for (const phase of Object.values(mix.phases)) {
    assert.equal(phase.kicks.median, Math.abs(shift));
    assert.equal(phase.kicks.missing, 0); assert.equal(phase.kicks.extra, 0);
    assert.ok(Math.abs(phase.vocal.lagMs - shift) <= 4);
    assert.ok(Math.abs(phase.vocal.relativeToKickMs) <= 4);
  }
  assert.equal(mix.baselineFailures.includes('vocal BEFORE'), false);
}
for (const [shift, vocalShift, fails] of [[-60, 0, true], [60, 0, true], [0, -16, true], [0, 16, true], [0, -8, false], [0, 8, false]]) {
  const mix = analyzeMix([synthetic(), synthetic(shift, vocalShift)], s, {interruptAt:15000, recoverAt:15800}, 0);
  assert.equal(mix.baselineFailures.includes('vocal BEFORE'), fails);
}
const silentVocal = synthetic();
silentVocal.channels.vocal.samples = silentVocal.channels.vocal.samples.map(([t]) => [t, 0]);
assert.ok(analyzeMix([synthetic(), silentVocal], s, {interruptAt:15000, recoverAt:15800}, 0).baselineFailures.includes('vocal BEFORE'));
const continuous = shift => {
  const c = synthetic(shift);
  delete c.resumeBoundary;
  return c;
};
for (const events of [{interruptAt:7000, recoverAt:17000}, {interruptAt:7000, recoverAt:27000}, {interruptAt:7000, recoverAt:7000}]) {
  const mix = analyzeMix([continuous(0), continuous(24)], s, events, 0, {resume:false});
  assert.ok(Math.abs(mix.phases.after.kicks.median - 24) < 1e-6);
  assert.ok(Math.abs(mix.phases.after.kicks.max - 24) < 1e-6);
  assert.equal(mix.phases.after.kicks.missing, 0);
  assert.ok(Math.abs(mix.phases.after.vocal.relativeToKickMs) <= 4);
  assert.ok(mix.boundaries.length > 0);
  assert.ok(mix.boundaries.every(b => !b.duringFreeze));
  assert.equal(!!mix.phases.during, events.recoverAt > events.interruptAt);
}
const noBoundary = analyzeMix([continuous(0), continuous(0)], s, {interruptAt:39000, recoverAt:39000}, 0, {resume:false});
assert.ok(noBoundary.baselineFailures.includes('no section boundaries measured'));
assert.throws(() => analyzeMix([continuous(0), {...continuous(0), channels:{}}], s, {interruptAt:7000, recoverAt:17000}, 0, {resume:false}), /Missing rendered kick graph tap/);
console.log('Full-mix analysis PASS: isolated rendered channels despite unrelated destination audio; signed offsets; missing/extra kicks/phrases; strict BEFORE limits; realignment; wrong section; resume boundaries; missing tap errors.');
console.log('Continuous mix analysis PASS: 10s/20s reconnect and handoff windows without resume markers; boundary coverage; maximum alignment; missing tap errors.');

const evidenceCapture = () => ({ anchors:[[0, 0]], errors:[],
  channels:{kick:{samples:[[1.1, 1], [1.18, 1], [1.5, 1], [1.9, 1]]}},
  sources:[1.08, 1.48, 1.88].map(when => ({ tag:'kick', when, at:500,
    clock:{contextTime:.5, outputContextTime:.48, outputEpochMs:480} })),
  playbackStats:[
    {at:500, underrunEvents:0, underrunDuration:0, totalDuration:.5},
    {at:1000, underrunEvents:0, underrunDuration:0, totalDuration:.5},
    {at:1400, underrunEvents:1, underrunDuration:.03, totalDuration:1.4},
    {at:1500, underrunEvents:1, underrunDuration:.03, totalDuration:1.4},
    {at:2200, underrunEvents:1, underrunDuration:.03, totalDuration:2.2},
  ] });
const attributedKicks = {...matchEvents([1100, 1500], [1180, 1900], 500, 2200, 150),
  hostOnsets:[1100, 1500], listenerOnsets:[1180, 1900]};
const telemetry = evidenceCapture(), missingStats = evidenceCapture();
delete missingStats.playbackStats;
telemetry.sources.push({when:1.099, at:500, clock:{contextTime:.5}});
const unchanged = structuredClone(attributedKicks);
const evidence = kickAttribution([telemetry, missingStats], attributedKicks);
assert.deepEqual(attributedKicks, unchanged);
assert.deepEqual(evidence.pairs.map(p => p.kind), ['displaced', 'unmatched-host', 'unmatched-listener']);
assert.equal(evidence.clients[0].countDelta, 1);
assert.equal(evidence.clients[0].durationDeltaMs, 30);
assert.deepEqual(evidence.clients[0].intervals, [{from:500, to:1400, count:1, durationMs:30}]);
assert.equal(evidence.clients[1].available, false);
assert.equal(evidence.clients[1].countDelta, null);
assert.equal(evidence.clients[1].durationDeltaMs, null);
assert.equal(evidence.pairs[0].host.underrunOverlap, true);
assert.equal(evidence.pairs[0].host.nearestStart.when, 1.08, 'Only tagged starts participate');
assert.equal(evidence.pairs[0].host.nearestStart.submitContextTime, .5);
assert.ok(Math.abs(evidence.pairs[0].host.nearestStart.nativeAttackDelayMs - 20) < 1e-9);
assert.equal(evidence.pairs[0].listener.underrunOverlap, null);
assert.equal(evidence.pairs[1].host.underrunOverlap, false);
assert.equal(evidence.pairs[1].listener.onset, null);
assert.equal(evidence.pairs[1].listener.nearestStart.when, 1.48);
assert.equal(evidence.pairs[2].host.onset, null);
const noStarts = evidenceCapture(); noStarts.sources = [];
assert.equal(kickAttribution([noStarts, missingStats], attributedKicks).pairs[0].host.nearestStart, null);
const alignedKicks = {...matchEvents([1100], [1120], 500, 2200, 150), hostOnsets:[1100], listenerOnsets:[1120]};
assert.deepEqual(kickAttribution([telemetry, missingStats], alignedKicks).pairs, []);
assert.deepEqual(underrunEvidence({playbackStats:[]}, 0, 100).intervals, []);
assert.equal(underrunEvidence(telemetry, 1000, 1000).countDelta, null);
assert.equal(underrunEvidence({playbackStats:[{at:0, underrunEvents:NaN, underrunDuration:0}]}, 0, 100).available, false);
const resetStats = {playbackStats:[{at:0, underrunEvents:2, underrunDuration:.2}, {at:100, underrunEvents:0, underrunDuration:0}]};
assert.equal(underrunEvidence(resetStats, 0, 100).countDelta, null);
assert.deepEqual(underrunEvidence(resetStats, 0, 100).intervals, []);
console.log('Kick attribution PASS: overlapping cached-counter interval; tagged native start/submit; unmatched/displaced kicks; no overlap; absent/invalid/reset stats; empty starts; unchanged kick metrics.');
