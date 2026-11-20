import assert from 'node:assert/strict';
import { mixFixture, realMixFixture, popHandoffTargetAt, syntheticHandoffTargetAt, mixBoundaries, mixGraphEdges, channelEnvelope, analyzeMix, matchEvents, realignment, beatRealignment, realignmentEvidence, phraseOnsets, boundaryMetric, mixFailures, underrunEvidence, kickAttribution, vocalSourceEvidence } from './club-sync-mix.mjs';
import { singRequest } from '../js/sing.js';
import { sanitize } from '../js/state.js';
import { postResumeEnvelope, onsets } from './club-sync-audio.mjs';
import { gridKicks, vocalMetrics, sustainedRecovery, vocalFindings, windowOffset, clipRange, floatWav, levelMatchClips } from './club-sync-vocals.mjs';
import { stepFixture, correctionGrid, forcedStepEvidence } from './club-sync-steps.mjs';

const bin = 4, expectedVoice = new Float64Array(8000);
assert.equal(vocalSourceEvidence({vocalStarts:[{}]}).allowed, 1);
assert.deepEqual(vocalSourceEvidence({vocalStarts:[{}, {reason:'wake'}]}, 1), {count:2, nonZeroOffsets:0, midPhraseRestarts:0, gapRealigns:0, unclassifiedStarts:0, expected:2, corrections:[], allowed:2});
assert.equal(vocalSourceEvidence({vocalStarts:[{}, {}, {}], vocalCorrections:[{errorMs:20}, {errorMs:-40, appliedTime:1}]}, 1).allowed, 3);
assert.equal(vocalSourceEvidence({vocalStarts:[{}, {}, {}], vocalCorrections:[{errorMs:-40, gap:false}]}, 1).allowed, 2, 'an unapplied correction cannot authorize a restart');
assert.equal(vocalSourceEvidence({vocalStarts:[{offset:0}, {offset:2}]}).nonZeroOffsets, 1);
assert.equal(vocalSourceEvidence({vocalStarts:[]}).count, 0);
assert.equal(vocalSourceEvidence({}).count, null);
assert.equal(vocalSourceEvidence({vocalStarts:{}}).midPhraseRestarts, null);
assert.equal(vocalSourceEvidence({vocalStarts:[{}, {startSinging:true}]}).midPhraseRestarts, 1);
assert.equal(vocalSourceEvidence({vocalStarts:[{}, {startSinging:false}]}).gapRealigns, 1);
assert.equal(vocalSourceEvidence({vocalStarts:[{}, {}]}).unclassifiedStarts, 1);
assert.equal(vocalSourceEvidence({vocalStarts:[{}, {reason:'wake', startSinging:true}, {reason:'wake', startSinging:true}]}, 1).midPhraseRestarts, 1, 'only one explicitly observed wake start is exempt');
console.log('Vocal source evidence PASS: explicit join/wake exemptions, mid-phrase versus silent-gap starts, only applied >30ms credit, empty and missing telemetry remain distinct.');
{
  const song = stepFixture(mixFixture()), force = {at:109500, step:68, base:60 / 123 / 4, nextTime:10, deltaMs:-2 * 60000 / 123 / 4,
    clock:{outputContextTime:0, outputEpochMs:100000}};
  const adoption = {at:110000, contextTime:10};
  const capture = drop => ({forcedWholeStep:force, gridAdoptions:[adoption], errors:[], anchors:[[0,100000]], channels:Object.fromEntries([['kick', 'kick'], ['hat', 'ch']].map(([name, part]) => {
    const grid = correctionGrid(song, force, part, adoption), hits = [...grid.before, ...grid.after.filter(n => n.step !== drop)].map(n => n.at + 12);
    const from = grid.before[0].at - 200, to = grid.to + 200;
    const samples = Array.from({length:Math.ceil((to - from) / 4)}, (_, i) => {
      const at = from + i * 4;
      return [(at - 100000) / 1000, Math.max(0, ...hits.map(t => at >= t && at < t + 60 ? Math.exp(-(at - t) / 18) : 0))];
    });
    return [name, {edge:{}, ready:true, samples}];
  }))});
  const clean = forcedStepEvidence(capture(), song);
  assert.deepEqual(clean.failures, []);
  assert.ok(clean.channels.kick.expected >= 4 && clean.channels.hat.expected >= 6);
  assert.ok(clean.adoptionMs < clean.budgetMs && clean.firstAlignedMs < clean.budgetMs);
  const dropped = forcedStepEvidence(capture(76), song);
  assert.ok(dropped.channels.kick.missing > 0 && dropped.channels.hat.missing > 0, 'a real shared kick/hat step cannot disappear into host/listener agreement');
  const empty = capture(); empty.channels.kick.samples = []; empty.channels.hat.samples = [];
  assert.ok(forcedStepEvidence(empty, song).failures.length >= 2);
  assert.ok(forcedStepEvidence({}, song).failures.length > 0);
  const noAdoption = capture(); delete noAdoption.gridAdoptions;
  assert.deepEqual(forcedStepEvidence(noAdoption, song).failures, ['grid adoption marker']);
  const missing = capture(); delete missing.channels.hat;
  assert.ok(forcedStepEvidence(missing, song).failures.includes('hat capture'));
  const delayed = capture(); delayed.gridAdoptions = [{...adoption, at:adoption.at + 2000}];
  assert.ok(forcedStepEvidence(delayed, song).failures.includes('grid adoption budget'));
  console.log('Whole-step grid PASS: future-at-adoption kick/hat expectations, drain/adoption and first-alignment budgets, real missing step, empty capture and missing telemetry.');
}
assert.deepEqual(clipRange(10000, 40000), {from:6000,to:40000});
assert.ok(clipRange(10000, 40000).to >= 10000 + 28000);
assert.throws(() => clipRange(10000, 10000), RangeError);
assert.throws(() => clipRange(10000, NaN), RangeError);
for (let p = 0; p < 9; p++) {
  for (let t = 0; t < 1000; t += bin) {
    const at = 1000 + p * 3000 + t;
    expectedVoice[at / bin] = .2 + .08 * Math.sin(t * (.009 + p * .007)) + .07 * Math.sin(t * (.019 + p * .011));
  }
}
const kickOffsets = Array.from({length:64}, (_, i) => ({at:i * 500, offsetMs:12}));
const measureVoice = rendered => vocalMetrics({expected:expectedVoice, rendered, kickOffsets, from:0, to:30000, marker:6000, baselineMs:-12});
const cleanVoice = measureVoice(expectedVoice);
assert.equal(cleanVoice.vocalVsKick.medianMs, -12);
assert.equal(cleanVoice.gaps.count, 0);
assert.equal(cleanVoice.phrases.missing, 0);
assert.equal(cleanVoice.phrases.doubled, 0);
assert.equal(cleanVoice.absoluteGridRecoveryMs, 5000);
assert.ok(cleanVoice.recoveryMs >= 700 && cleanVoice.recoveryMs < 2000);
const recoveryWindows = Array.from({length:8}, (_, i) => ({start:i * 100, end:i * 100 + 500, activeMs:500, vocalVsKickMs:-20}));
assert.equal(sustainedRecovery(recoveryWindows, [], -20, 0), 700);
assert.equal(sustainedRecovery(recoveryWindows, [], null, 0), null);
assert.equal(sustainedRecovery(recoveryWindows.map(w => ({...w,vocalVsKickMs:20})), [], -20, 0), null);
assert.equal(sustainedRecovery(recoveryWindows, [{startMs:200,durationMs:40}], -20, 0), 1000);
assert.equal(sustainedRecovery(recoveryWindows.map(w => ({...w,vocalVsKickMs:null})), [], -20, 0), null);
assert.deepEqual(vocalFindings([{after:cleanVoice}]), []);
const offsetVoice = new Float64Array(expectedVoice.length);
offsetVoice.set(expectedVoice.subarray(0, -10), 10);
assert.equal(measureVoice(offsetVoice).vocalGrid.medianMs, 40);
assert.equal(measureVoice(offsetVoice).vocalVsKick.medianMs, 28);
assert.equal(measureVoice(offsetVoice).recoveryMs, null);
assert.ok(vocalFindings([{after:measureVoice(offsetVoice)}]).includes('host vocal offset'));
assert.ok(vocalFindings([{after:measureVoice(offsetVoice)}]).includes('host vocal recovery unproven'));
const largeOffsetVoice = new Float64Array(expectedVoice.length);
largeOffsetVoice.set(expectedVoice.subarray(0, -100), 100);
assert.equal(measureVoice(largeOffsetVoice).vocalGrid.medianMs, 400);
assert.equal(measureVoice(largeOffsetVoice).vocalVsKick.medianMs, 388);
assert.ok(vocalFindings([{after:measureVoice(largeOffsetVoice)}]).includes('host vocal offset'));
let voiceSeed = 7;
const aliasExpected = Float64Array.from({length:1000}, () => {
  voiceSeed = (Math.imul(voiceSeed, 1664525) + 1013904223) >>> 0;
  return .1 + .2 * voiceSeed / 2 ** 32;
});
const aliasRendered = Float64Array.from(aliasExpected, (v, i) => .7 * (aliasExpected[i + 109] ?? 0) + .3 * v);
const aliasHit = windowOffset(aliasExpected, aliasRendered, 125, 500);
assert.equal(aliasHit.lagMs, -436);
assert.equal(aliasHit.ambiguous, false);
assert.equal(windowOffset(aliasExpected, aliasRendered, 125, 500, 500, bin, null, 0).ambiguous, true);
const aliasMetrics = vocalMetrics({expected:aliasExpected, rendered:aliasRendered, kickOffsets:[{at:1000,offsetMs:0}], from:500, to:2500, marker:0});
assert.equal(aliasMetrics.windows[0].ambiguous, true);
assert.equal(aliasMetrics.vocalVsKick.p95AbsMs, null);
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
const popOrigin = 100000, passTarget = popHandoffTargetAt(popOrigin, real.bpm);
const popKickGrid = gridKicks(real).map(t => t + popOrigin);
const kicksAfterPass = marker => popKickGrid.filter(t => t >= marker).slice(0, 3);
assert.deepEqual(kicksAfterPass(passTarget - 100), kicksAfterPass(passTarget + 100));
assert.ok(kicksAfterPass(passTarget - 100)[2] - (passTarget - 100) < 3 * 60000 / real.bpm);

const s = mixFixture();
assert.deepEqual(s, mixFixture());
const syntheticTarget = syntheticHandoffTargetAt(popOrigin, s.bpm);
const syntheticKickGrid = gridKicks(s).map(t => t + popOrigin);
assert.ok(Math.abs((syntheticTarget - popOrigin) / (60000 / s.bpm) - 13.5) < 1e-9);
assert.ok(syntheticKickGrid.every(t => Math.abs(t - syntheticTarget) > 200));
for (const drift of [-100, 0, 100]) {
  const marker = syntheticTarget + drift;
  const next = syntheticKickGrid.filter(t => t >= marker).slice(0, 3);
  assert.equal(next.length, 3);
  assert.ok(next[2] + 50 - marker < 3 * 60000 / s.bpm);
}
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
const fixtureKicks = gridKicks(s), passAt = 14350, budget = 3 * 60000 / s.bpm;
const recovery = listener => beatRealignment({...matchEvents(fixtureKicks, listener, passAt, passAt + 6000, 150), hostOnsets:fixtureKicks}, passAt,
  {bpm:s.bpm, origin:0, expectedKicks:fixtureKicks});
const sparse = recovery(fixtureKicks);
assert.ok(sparse.attackConfirmationMs > budget);
assert.ok(sparse.timeToRealignMs <= budget);
assert.deepEqual(sparse.beats.map(b => b.status), ['aligned', 'planned-rest', 'aligned']);
assert.equal(recovery(fixtureKicks.map(t => t + 100)).timeToRealignMs, null);
const dropped = recovery(fixtureKicks.filter(t => t < passAt || t >= passAt + 2200));
assert.ok(dropped.timeToRealignMs > budget);
assert.ok(dropped.beats.some(b => b.status === 'missing-listener' && b.streak === 0));
const transient = recovery(fixtureKicks.map(t => t >= passAt && t < passAt + 2000 ? t + 100 : t));
assert.ok(transient.timeToRealignMs > budget);
const missingAfterRest = recovery(fixtureKicks.filter(t => Math.round(t * s.bpm / 60000) !== 32));
assert.ok(missingAfterRest.timeToRealignMs > budget);
assert.equal(missingAfterRest.beats.find(b => b.index === 32).streak, 0);
assert.equal(recovery([]).timeToRealignMs, null);
const noHost = beatRealignment({hostOnsets:[], pairs:[], to:2000}, 0, {bpm:120, origin:0, expectedKicks:[0, 500, 1000]});
assert.equal(noHost.timeToRealignMs, null);
assert.ok(noHost.beats.slice(0, 3).every(b => b.status === 'missing-host'));
const unexpectedHost = [0, 500, 1000, 1500, 2000];
const unexpected = beatRealignment({...matchEvents(unexpectedHost, [0, 1000, 1500, 2000], 0, 2500), hostOnsets:unexpectedHost}, 0,
  {bpm:120, origin:0, expectedKicks:[0, 1000, 1500, 2000]});
assert.equal(unexpected.beats[1].status, 'missing-listener');
assert.equal(unexpected.beats[1].streak, 0);
assert.equal(unexpected.timeToRealignMs, 2000);
assert.equal(beatRealignment({...silent, hostOnsets:hs}, 900, {bpm:120, origin:0, expectedKicks:[]}).timeToRealignMs, null);
assert.throws(() => beatRealignment(silent, 0, {bpm:0, origin:0, expectedKicks:[]}), /Finite recovery grid/);
console.log(`Beat recovery PASS: sparse zero-offset ${sparse.attackConfirmationMs.toFixed(1)}→${sparse.timeToRealignMs.toFixed(1)}ms / ${budget.toFixed(1)}ms; misalignment, 2s origin delay, dropped kicks, missing kick after rest and silence still fail.`);
const emptyRecovery = realignmentEvidence({...silent, hostOnsets:hs}, 900);
assert.deepEqual(emptyRecovery, {firstAlignedMs:null, confirmationMs:null, confirmationSpanMs:null, confirmingPairs:[], hostGapsMs:[]});
const alignedRecovery = realignmentEvidence({...matchEvents(hs, hs.map(t => t + 24), 900, 2600), hostOnsets:hs}, 900);
assert.equal(alignedRecovery.firstAlignedMs, 124);
assert.equal(alignedRecovery.confirmationMs, 1124);
assert.equal(alignedRecovery.confirmationSpanMs, 1000);
assert.deepEqual(alignedRecovery.hostGapsMs, [500, 500]);
const driftHost = [1000, 1500, 2000, 2500, 3000];
const correctedRecovery = realignmentEvidence({...matchEvents(driftHost, [1080, 1580, 2020, 2520, 3020], 900, 3100), hostOnsets:driftHost}, 900);
assert.equal(correctedRecovery.firstAlignedMs, 1120);
assert.equal(correctedRecovery.confirmationMs, 2120);
assert.deepEqual(correctedRecovery.confirmingPairs.map(p => p.deltaMs), [20, 20, 20]);
const unalignedRecovery = realignmentEvidence({...matchEvents(hs, hs.map(t => t + 80), 900, 2600), hostOnsets:hs}, 900);
assert.equal(unalignedRecovery.firstAlignedMs, null);
assert.equal(unalignedRecovery.confirmationMs, null);
assert.deepEqual(unalignedRecovery.confirmingPairs, []);
const sparseRecovery = realignmentEvidence({...matchEvents(fixtureKicks, fixtureKicks, passAt, passAt + 2500), hostOnsets:fixtureKicks}, passAt);
assert.deepEqual(fixtureKicks.filter(t => t >= passAt).slice(0, 3).map(t => Math.round(t * s.bpm / 60000)), [30, 32, 33]);
assert.ok(sparseRecovery.firstAlignedMs < 350);
assert.ok(sparseRecovery.confirmationMs > 3 * 60000 / s.bpm, 'the fixture rest alone exceeds the unchanged recovery budget even with perfect alignment');
assert.ok(sparseRecovery.hostGapsMs[0] > 1.9 * 60000 / s.bpm);
assert.ok(sparseRecovery.confirmingPairs.every(p => p.deltaMs === 0));
console.log('Club recovery evidence PASS: first alignment, three-kick confirmation, corrected/unaligned/empty input and the synthetic fixture rest remain distinct.');
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
assert.deepEqual(postResumeEnvelope(capture, 2), [[3000, .6]]);
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
  assert.equal(mix.timeToRealignMs, realignment(mix.phases.after.kicks, 15800));
  assert.equal(mix.recoveryEvidence.attackConfirmationMs, realignment(mix.phases.after.kicks, 15800));
  assert.equal(mix.recoveryEvidence.timeToRealignMs, mix.timeToRealignMs);
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
{
  const check = (host, listener) => analyzeMix([host, listener], s,
    {interruptAt:7000, recoverAt:17000}, 0, {resume:false, checkFirstDownbeat:true});
  const noFirstKick = () => {
    const c = continuous(0);
    c.channels.kick.samples = c.channels.kick.samples.map(([t, rms]) => [t, t < .25 ? 0 : rms]);
    return c;
  };
  const aligned = check(continuous(0), continuous(24));
  assert.ok(Math.abs(aligned.firstDownbeat.deltaMs - 24) < 1e-6);
  assert.ok(!mixFailures(aligned).includes('first downbeat'));
  assert.ok(mixFailures(check(continuous(0), continuous(60))).includes('first downbeat'));
  for (const host of [continuous(0), noFirstKick()]) {
    const miss = check(host, noFirstKick());
    assert.equal(miss.phases.before.kicks.missing, 0, 'later baseline still matches');
    assert.equal(miss.firstDownbeat.listenerAt, null, 'the next beat is not the first downbeat');
    assert.ok(mixFailures(miss).includes('first downbeat'));
  }
}
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
const steadyState = analyzeMix([continuous(0), continuous(60)], s,
  {baselineAt:2000, interruptAt:9000, recoverAt:29000}, 0, {resume:false});
assert.equal(steadyState.phases.before.kicks.from, 2150);
assert.ok(steadyState.baselineFailures.includes('kicks BEFORE'));
assert.ok(mixFailures(steadyState).includes('kicks AFTER'));
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
