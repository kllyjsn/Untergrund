import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { freshSong, defaultState } from '../js/state.js';
import { localSpec, songState } from '../js/song-spec.js';
import { rulePlan, planLyrics } from '../js/song-plan.js';
import { vocalFx } from '../js/sing.js';
import { envelope, postResumeEnvelope, onsets, correlate } from './club-sync-audio.mjs';
import { gridKicks } from './club-sync-grid.mjs';

export function mixFixture() {
  const s = freshSong('hypnotic', 7, { length: 'sketch', bpm: 123, swing: 0 });
  s.artist = { name: 'Sync fixture', title: 'Seed 7', style: 'hypnotic', seed: 7 };
  s.fresh = 0;
  s.solos = {}; s.mutes = {};
  s.sing = { on: true, voice: 'gwen', db: 0, ms: 0 };
  return s;
}

export function realMixFixture() {
  const prompt = 'upbeat pop song about summer nights, female vocal';
  const s = songState(localSpec(prompt, {}), 7, defaultState()).state;
  s.lyrics = planLyrics(rulePlan(prompt, '[Verse]\nStreetlights hum along the avenue\nI keep the window open just for you\n[Chorus]\nStay with me tonight\nHold on till the morning light'), prompt);
  s.bpm = 123; s.swing = 0;
  s.chain = 'CCCCBBBBGGGGGGGHEEEDGGGGGGGHAAAA';
  s.fresh = 0; s.solos = {}; s.mutes = {};
  s.sing = { on: true, voice: 'gwen', db: 0, ms: 0 };
  return s;
}

export const popHandoffTargetAt = (origin, bpm) => origin + 13.375 * 60000 / bpm;
export const syntheticHandoffTargetAt = (origin, bpm) => origin + 13.5 * 60000 / bpm;

export async function loadRealMixStem(s) {
  const { singSong, hasStem, vocalFx } = await import('/js/sing.js');
  const { processedStem } = await import('/js/vocal-chain.js');
  const epoch = () => performance.timeOrigin + performance.now();
  const evidence = __clubAudio.realStem = { start: epoch(), apiResponses: [], plays: [] };
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await original(...args);
    if (String(args[0]).includes('/api/sing') && args[1]?.method === 'POST')
      evidence.apiResponses.push({ status: response.status, type: response.headers.get('content-type') });
    return response;
  };
  let buf;
  try { buf = await singSong(s); } finally { globalThis.fetch = original; }
  evidence.resolved = hasStem(s);
  evidence.duration = buf.duration; evidence.sampleRate = buf.sampleRate;
  evidence.end = epoch();
  __clubAudio.stemWarm = { start: evidence.start, end: evidence.end };
  const processed = processedStem(buf, vocalFx(s), new OfflineAudioContext(1, 1, 48000));
  globalThis.__clubExpectedStem = processed;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, ...rest) {
    if (this.buffer === processed) evidence.plays.push({ at: epoch(), when, offset });
    return start.call(this, when, offset, ...rest);
  };
}

export function mixBoundaries(s, origin) {
  const roles = ['INTRO', 'BUILD', 'DROP', 'FILL', 'BREAK', 'BREAK', 'DROP', 'FILL'];
  return [...s.chain].flatMap((letter, bar) => bar && letter !== s.chain[bar - 1]
    ? [{ bar, letter, section: roles[letter.charCodeAt(0) - 65], at: origin + bar * 240000 / s.bpm }] : []);
}

export async function mixGraphEdges() {
  const source = await readFile(new URL('../js/engine.js', import.meta.url), 'utf8');
  const lines = source.split('\n');
  const find = marker => {
    const matches = lines.flatMap((line, i) => line.includes(marker) ? [i + 1] : []);
    assert.equal(matches.length, 1, `Unique Engine graph edge: ${marker}`);
    return matches[0];
  };
  return {kick:find('level.connect(ch.rumble).connect(this.rumbleIn)'), vocal:find('this.vocalBus.connect(this.vocalOut).connect(this.preMaster)')};
}

// A false conditional breakpoint writes the private cache without replacing module code.
export async function installMixStem(send, base, s) {
  const source = await readFile(new URL('../js/sing.js', import.meta.url), 'utf8');
  const lineNumber = source.split('\n').findIndex(l => l.includes('if (!state?.sing?.on || !stems.size)'));
  assert.ok(lineNumber >= 0, 'vocalStem cache gate');
  await send('Debugger.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const sr = 24000, bar = ${240 / s.bpm}, duration = bar * ${s.chain.length};
    const buf = new AudioBuffer({numberOfChannels:1, length:Math.ceil(sr * duration), sampleRate:sr});
    const x = buf.getChannelData(0);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr, phase = t % (bar * 2), n = Math.floor(t / (bar * 2));
      const gate = Math.min(1, phase / .015, (bar * 1.85 - phase) / .015);
      x[i] = .07 * Math.max(0, gate) * (1 + .35 * Math.sin(2 * Math.PI * (5 + n % 4) * t)) * Math.sin(2 * Math.PI * 10500 * t);
    }
    globalThis.__clubMixStem = buf;
    globalThis.__clubMixReady = import('/js/vocal-chain.js').then(({processedStem}) => {
      const start = performance.timeOrigin + performance.now();
      globalThis.__clubExpectedStem = processedStem(buf, ${JSON.stringify(vocalFx(s))}, new OfflineAudioContext(1, 1, 48000));
      __clubAudio.stemWarm = {start, end:performance.timeOrigin + performance.now()};
    }).catch(e => __clubAudio.errors.push('Stem warm-up: ' + String(e)));
  })()` });
  await send('Debugger.setBreakpointByUrl', { url: `${base}/js/sing.js`, lineNumber,
    condition: `(() => { if (state?.sing?.on && globalThis.__clubMixStem) {
      const key = stemKey(state); if (!stems.has(key)) {
        stems.set(key, __clubMixStem); (__clubAudio.stemInjected ||= []).push({at:performance.timeOrigin+performance.now(), key});
      }
    } return false; })()` });
}

const quantile = (xs, q) => xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil((xs.length - 1) * q)] : null;
export function matchEvents(host, listener, from, to, tolerance = 100) {
  const hs = host.filter(t => t >= from && t <= to), ls = listener.filter(t => t >= from - tolerance && t <= to + tolerance);
  const used = new Set(), pairs = [];
  for (const h of hs) {
    let best = -1, distance = tolerance;
    ls.forEach((l, i) => { if (!used.has(i) && Math.abs(l - h) <= distance) { best = i; distance = Math.abs(l - h); } });
    if (best >= 0) { used.add(best); pairs.push({host:h, listener:ls[best], delta:ls[best] - h}); }
  }
  const ds = pairs.map(p => p.delta), abs = ds.map(Math.abs);
  return { from, to, expected:hs.length, matched:pairs.length, missing:hs.length - pairs.length,
    extra:ls.filter((l, i) => l >= from && l <= to && !used.has(i)).length,
    signedMedianMs:quantile(ds, .5), signedP95Ms:quantile(ds, .95), median:quantile(abs, .5), p95:quantile(abs, .95), max:quantile(abs, 1), pairs };
}

export function realignment(stats, wake) {
  let streak = 0, previous = -1;
  for (const p of stats.pairs) {
    const index = stats.hostOnsets.indexOf(p.host);
    streak = Math.abs(p.delta) <= 50 ? (index === previous + 1 ? streak + 1 : 1) : 0;
    previous = index;
    if (streak === 3) return p.listener - wake;
  }
  return null;
}

export function beatRealignment(stats, wake, { bpm, origin, expectedKicks }) {
  assert.ok(Number.isFinite(bpm) && bpm > 0 && Number.isFinite(origin) && Number.isFinite(wake), 'Finite recovery grid required');
  const beatMs = 60000 / bpm, stepMs = beatMs / 4;
  if (!expectedKicks.length) return {timeToRealignMs:null, beatMs, gridOrigin:null, phaseMs:null, beats:[], attackConfirmationMs:realignment(stats, wake)};
  const offsets = stats.hostOnsets.map(h => {
    const nearest = expectedKicks.reduce((a, b) => Math.abs(origin + a - h) <= Math.abs(origin + b - h) ? a : b);
    return h - origin - nearest;
  });
  const phaseMs = quantile(offsets, .5) ?? 0, gridOrigin = origin + phaseMs;
  const slot = time => Math.floor((time + stepMs / 2) / beatMs);
  const planned = new Set(expectedKicks.map(slot));
  const played = new Map(), paired = new Map(stats.pairs.map(p => [p.host, p]));
  for (const h of stats.hostOnsets.filter(h => h >= wake && h <= stats.to)) {
    const index = slot(h - gridOrigin);
    if (!played.has(index)) played.set(index, []);
    played.get(index).push(h);
  }
  const beats = []; let streak = 0, timeToRealignMs = null;
  for (let index = Math.max(0, slot(wake - gridOrigin)); gridOrigin + index * beatMs <= stats.to; index++) {
    const host = played.get(index) || [], pairs = host.map(h => paired.get(h));
    if (!host.length && gridOrigin + index * beatMs < wake) continue;
    const rest = !host.length && !planned.has(index);
    const aligned = host.length > 0 && pairs.every(p => p && Math.abs(p.delta) <= 50);
    const status = rest ? 'planned-rest' : !host.length ? 'missing-host' : pairs.some(p => !p) ? 'missing-listener' : aligned ? 'aligned' : 'misaligned';
    streak = aligned ? streak + 1 : rest ? (streak ? streak + 1 : 0) : 0;
    const at = aligned ? Math.max(...pairs.map(p => p.listener)) : gridOrigin + index * beatMs;
    beats.push({ index, at, status, streak, host, pairs:pairs.filter(Boolean) });
    if (streak >= 3) { timeToRealignMs = at - wake; break; }
  }
  return { timeToRealignMs, beatMs, gridOrigin, phaseMs, beats,
    attackConfirmationMs:realignment(stats, wake) };
}

export function realignmentEvidence(stats, wake) {
  const confirmationMs = realignment(stats, wake);
  const first = stats.pairs.find(p => Math.abs(p.delta) <= 50);
  const end = confirmationMs === null ? -1 : stats.pairs.findIndex(p => p.listener - wake === confirmationMs);
  const pairs = end < 2 ? [] : stats.pairs.slice(end - 2, end + 1);
  return {
    firstAlignedMs: first ? first.listener - wake : null,
    confirmationMs,
    confirmationSpanMs: pairs.length ? pairs.at(-1).listener - pairs[0].listener : null,
    confirmingPairs: pairs.map(p => ({hostMs:p.host - wake, listenerMs:p.listener - wake, deltaMs:p.delta})),
    hostGapsMs: pairs.slice(1).map((p, i) => p.host - pairs[i].host),
  };
}

export function phraseOnsets(rows, threshold) {
  const out = []; let active = false, last = -Infinity;
  for (const [t, e] of rows) {
    if (!active && e >= threshold && t - last > 500) { out.push(t); last = t; }
    active = e >= threshold * (active ? .65 : 1);
  }
  return out;
}

export function channelEnvelope(capture, name, after = false) {
  const channel = capture.channels?.[name];
  assert.ok(channel?.ready && channel.edge, `Missing rendered ${name} graph tap`);
  const data = {...capture, samples:channel.samples};
  return after ? postResumeEnvelope(data) : envelope(data);
}

export function forcedVocalEvidence(start, corrections) {
  const f = start?.forced;
  if (start?.reason !== 'forced' || !f || !Number.isInteger(f.correctionId) || f.correctionId < 1 ||
      !Number.isInteger(f.step) || f.step % 16 || !Number.isFinite(f.stepDur) || !(f.stepDur > 0) ||
      !Number.isFinite(f.vocalMs) || !Number.isFinite(f.gridTime) || !Number.isFinite(start.when) ||
      !Number.isFinite(start.offset)) return false;
  const from = f.rubatoFrom ?? null;
  if (from !== null && (!Number.isInteger(from) || from < 0 || from > f.step)) return false;
  const advance = f.spliceAdvance ?? 0;
  if (!Number.isFinite(advance) || advance < 0 || advance > (from === null ? 0 : .35 + 1e-9) ||
      Math.abs(start.when - (f.gridTime - advance)) > .002 ||
      Math.abs(start.offset - (f.step * f.stepDur - f.vocalMs / 1000 - advance)) > .002) return false;
  const threshold = from === null ? 60 : f.step - from >= 32 ? 30 : 100 + 1e-6;
  const exceedsThreshold = ms => Number.isFinite(ms) && Math.abs(ms) > threshold;
  if (!exceedsThreshold(f.errorMs)) return false;
  if (!corrections.some(c => c.correctionId === f.correctionId && c.forced &&
      (c.rubatoFrom ?? null) === from && exceedsThreshold(c.appliedErrorMs ?? c.errorMs) &&
      Math.abs(c.appliedTime - start.when) < .002)) return false;
  const a = f.fadeOut, b = f.fadeIn;
  if (!a || !b || !Array.isArray(a.values) || !Array.isArray(b.values) || a.values.length < 3 ||
      a.values.length !== b.values.length || !Number.isFinite(a.duration) || !Number.isFinite(b.duration) ||
      a.duration < .02 || a.duration > .04 || Math.abs(a.duration - b.duration) > .00001 ||
      !Number.isFinite(a.when) || !Number.isFinite(b.when) ||
      Math.abs(a.when - start.when) > .002 || Math.abs(b.when - start.when) > .002) return false;
  if (Math.abs(a.values[0] - 1) > .0001 || Math.abs(a.values.at(-1)) > .0001 ||
      Math.abs(b.values[0]) > .0001 || Math.abs(b.values.at(-1) - 1) > .0001) return false;
  return a.values.every((v, i) => Number.isFinite(v) && Number.isFinite(b.values[i]) &&
    v >= 0 && v <= 1 && b.values[i] >= 0 && b.values[i] <= 1 && Math.abs(v * v + b.values[i] ** 2 - 1) < .001);
}

export function vocalSourceEvidence(capture, wakes = 0) {
  const corrections = (Array.isArray(capture.vocalCorrections) ? capture.vocalCorrections : []).filter(c => Math.abs(c.errorMs) > 30);
  const expected = 1 + wakes;
  let remainingWakes = wakes;
  const steady = Array.isArray(capture.vocalStarts) ? capture.vocalStarts.filter((s, i) => {
    if (i === 0) return false;
    if (s?.reason === 'wake' && remainingWakes > 0) { remainingWakes--; return false; }
    return true;
  }) : null;
  const forced = steady?.filter(s => forcedVocalEvidence(s, corrections));
  const ordinary = steady?.filter(s => !forced.includes(s));
  const forcedIds = new Set(forced?.map(s => s.forced.correctionId));
  return {count:Array.isArray(capture.vocalStarts) ? capture.vocalStarts.length : null,
    nonZeroOffsets:Array.isArray(capture.vocalStarts) ? capture.vocalStarts.filter(s => s?.offset > 0).length : null,
    midPhraseRestarts:ordinary ? ordinary.filter(s => s?.startSinging === true).length : null,
    forcedReanchors:forced ? forced.length : null,
    invalidForcedReanchors:steady ? steady.filter(s => s?.reason === 'forced' && !forced.includes(s)).length : null,
    duplicateForcedReanchors:forced ? forced.length - forcedIds.size : null,
    gapRealigns:ordinary ? ordinary.filter(s => s?.startSinging === false).length : null,
    unclassifiedStarts:steady ? steady.filter(s => typeof s?.startSinging !== 'boolean').length : null,
    expected, corrections, allowed:expected + corrections.filter(c => !c.forced && c.appliedTime != null).length + forcedIds.size};
}

export function boundaryMetric(host, listener, boundary) {
  const slice = (rows, a, b) => rows.filter(([t]) => t >= a && t <= b);
  const around = correlate(slice(host, boundary - 1200, boundary + 2000), slice(listener, boundary - 1600, boundary + 2400), 400);
  const after = correlate(slice(host, boundary + 100, boundary + 2800), slice(listener, boundary - 300, boundary + 3200), 400);
  return { deltaMs:around.lagMs, correlation:around.score, localLagMs:after.lagMs, localCorrelation:after.score,
    correctSection:after.lagMs !== null && Math.abs(after.lagMs) <= 50 && after.score >= .8 };
}

export function underrunEvidence(capture, from, to) {
  const samples = (capture.playbackStats || []).filter(s => (s.context ?? 0) === 0 &&
    Number.isFinite(s.at) && Number.isFinite(s.underrunEvents) && Number.isFinite(s.underrunDuration));
  const intervals = [];
  let prior = samples[0], since = prior?.at;
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    if (s.totalDuration === prior.totalDuration && s.underrunEvents === prior.underrunEvents &&
      s.underrunDuration === prior.underrunDuration) continue;
    const count = s.underrunEvents - prior.underrunEvents, durationMs = (s.underrunDuration - prior.underrunDuration) * 1000;
    if (count >= 0 && durationMs >= 0 && (count || durationMs)) intervals.push({ from: since, to: s.at, count, durationMs });
    since = samples[i - 1].at;
    prior = s;
  }
  const window = samples.filter(s => s.at >= from && s.at <= to), first = window[0], last = window.at(-1);
  const reset = window.some((s, i) => i && (s.underrunEvents < window[i - 1].underrunEvents || s.underrunDuration < window[i - 1].underrunDuration));
  const measured = window.length >= 2 && !reset;
  return { available: samples.length > 0, sampledFrom: first?.at ?? null, sampledTo: last?.at ?? null,
    countDelta: measured ? last.underrunEvents - first.underrunEvents : null,
    durationDeltaMs: measured ? (last.underrunDuration - first.underrunDuration) * 1000 : null,
    intervals: intervals.filter(i => i.to >= from && i.from <= to) };
}

export function kickAttribution(raw, kicks) {
  const clients = raw.map(c => underrunEvidence(c, kicks.from, kicks.to));
  const channels = raw.map(c => {
    const samples = c.channels.kick.samples;
    const mapped = envelope({ ...c, samples });
    const starts = (c.sources || []).filter(s => s.tag === 'kick').map(s => ({ when: s.when,
      submitContextTime: s.clock.contextTime, submitAt: s.at, leadMs: (s.when - s.clock.contextTime) * 1000,
      projectedOutputAt: s.clock.outputEpochMs + (s.when - s.clock.outputContextTime) * 1000 }));
    return { samples, mapped, starts, underruns: underrunEvidence(c, -Infinity, Infinity) };
  });
  const describe = (client, onset, referenceAt = onset) => {
    const c = channels[client];
    const index = onset === null ? -1 : c.mapped.findIndex(r => r[0] === onset);
    const nativeTime = index < 0 ? null : c.samples[index][0];
    const distance = s => Math.abs(nativeTime === null ? s.projectedOutputAt - referenceAt : (s.when - nativeTime) * 1000);
    const nearest = c.starts.reduce((best, s) => !best || distance(s) < distance(best) ? s : best, null);
    const intervals = c.underruns.intervals.filter(i => i.from <= referenceAt && i.to >= referenceAt);
    const covered = c.underruns.sampledFrom !== null && referenceAt >= c.underruns.sampledFrom && referenceAt <= c.underruns.sampledTo;
    return { onset, referenceAt, nativeTime, nearestStart: nearest && { ...nearest,
      nativeAttackDelayMs: nativeTime === null ? null : (nativeTime - nearest.when) * 1000 },
      underrunOverlap: covered ? intervals.length > 0 : null, underrunIntervals: intervals };
  };
  const pairs = kicks.pairs.filter(p => Math.abs(p.delta) > 50)
    .map(p => ({ kind: 'displaced', deltaMs: p.delta, host: describe(0, p.host), listener: describe(1, p.listener) }));
  const pairedHost = new Set(kicks.pairs.map(p => p.host)), pairedListener = new Set(kicks.pairs.map(p => p.listener));
  for (const t of kicks.hostOnsets.filter(t => t >= kicks.from && t <= kicks.to && !pairedHost.has(t)))
    pairs.push({ kind: 'unmatched-host', deltaMs: null, host: describe(0, t), listener: describe(1, null, t) });
  for (const t of kicks.listenerOnsets.filter(t => t >= kicks.from && t <= kicks.to && !pairedListener.has(t)))
    pairs.push({ kind: 'unmatched-listener', deltaMs: null, host: describe(0, null, t), listener: describe(1, t) });
  return { displacedThresholdMs: 50, clients, pairs };
}

export function firstMixDownbeat(host, listener, origin, bpm) {
  // These fixtures start with a kick and have no second kick within half a beat.
  const halfBeat = 30000 / bpm;
  const first = onsets => onsets.find(at => Math.abs(at - origin) < halfBeat) ?? null;
  const hostAt = first(host), listenerAt = first(listener);
  const deltaMs = hostAt === null || listenerAt === null ? null : listenerAt - hostAt;
  return { hostAt, listenerAt, deltaMs };
}

export const missedFirstMixDownbeat = ({deltaMs}) => deltaMs === null || Math.abs(deltaMs) > 50;

export function analyzeMix(raw, s, events, origin, { resume = true, checkFirstDownbeat = false } = {}) {
  const [he, le] = raw.map(r => envelope(r));
  const [hb, lb] = raw.map(r => envelope(r, 2));
  const start = Math.max(Math.max(he[0][0], le[0][0]) + 500, events.baselineAt ?? -Infinity);
  const end = Math.min(he.at(-1)[0], le.at(-1)[0]) - 200;
  const phases = {};
  // The host keeps rendering: match its continuous onsets by output time,
  // not by the (possibly delayed) resume marker for the frozen listener.
  const host = onsets(channelEnvelope(raw[0], 'kick'), s.bpm);
  const windows = [['before', start, events.interruptAt], ...(!resume && events.recoverAt > events.interruptAt ? [['during', events.interruptAt, events.recoverAt]] : []), ['after', events.recoverAt, end]];
  for (const [name, from, to] of windows) {
    const rows = channel => raw.map(r => channelEnvelope(r, channel, resume && name === 'after'));
    const listener = onsets(channelEnvelope(raw[1], 'kick', resume && name === 'after'), s.bpm);
    const [vh, vl] = rows('vocal');
    const kicks = matchEvents(host, listener, from + (name === 'before' ? 150 : 0), to - 150, 150);
    kicks.hostOnsets = host; kicks.listenerOnsets = listener;
    const threshold = Math.max(...vh.filter(([t]) => t >= from && t <= to).map(r => r[1]), 0) * .25;
    const hp = phraseOnsets(vh, threshold), lp = phraseOnsets(vl, threshold);
    const vocal = matchEvents(hp, lp, from + 150, to - 150, 400);
    const vlag = correlate(vh.filter(([t]) => t >= from && t <= to), vl.filter(([t]) => t >= from && t <= to), 400);
    vocal.lagMs = vlag.lagMs; vocal.correlation = vlag.score;
    vocal.relativeToKickMs = vlag.lagMs === null || kicks.signedMedianMs === null ? null : vlag.lagMs - kicks.signedMedianMs;
    vocal.expectedPhraseOnsets = Array.from({length:Math.ceil(s.chain.length / 2)}, (_, i) => origin + i * 480000 / s.bpm)
      .filter(t => t >= from && t <= to);
    vocal.returnMs = vl.find(([t, e]) => t >= from && t <= to && e > threshold)?.[0] - from;
    if (!Number.isFinite(vocal.returnMs)) vocal.returnMs = null;
    phases[name] = { kicks, vocal, attribution: kickAttribution(raw, kicks) };
  }
  const boundaries = mixBoundaries(s, origin).filter(b => b.at >= events.interruptAt && b.at + 3200 < end)
    .map(b => {
      const rows = resume && b.at >= events.recoverAt ? raw.map(r => postResumeEnvelope(r, 2)) : [hb, lb];
      return {...b, duringFreeze:resume && b.at < events.recoverAt, ...boundaryMetric(...rows, b.at)};
    });
  const recoveryEvidence = beatRealignment(phases.after.kicks, events.recoverAt, {
    bpm:s.bpm, origin, expectedKicks:gridKicks(s),
  });
  const timeToRealignMs = recoveryEvidence.timeToRealignMs;
  const budgetMs = 3 * 60000 / s.bpm;
  const baselineFailures = [];
  if (!resume && !boundaries.length) baselineFailures.push('no section boundaries measured');
  const bk = phases.before.kicks, bv = phases.before.vocal;
  if (!bk.matched || bk.median === null || bk.median > 25 || bk.p95 > 50 || bk.missing || bk.extra) baselineFailures.push('kicks BEFORE');
  if (bv.lagMs === null || Math.abs(bv.lagMs) > 50 || bv.relativeToKickMs === null || Math.abs(bv.relativeToKickMs) > 10) baselineFailures.push('vocal BEFORE');
  const firstDownbeat = checkFirstDownbeat ? firstMixDownbeat(host, bk.listenerOnsets, origin, s.bpm) : null;
  if (firstDownbeat && missedFirstMixDownbeat(firstDownbeat)) baselineFailures.push('first downbeat');
  for (const [i, capture] of raw.entries()) {
    if (!capture.stemWarm || capture.sources.some(source => source.at < capture.stemWarm.end)) baselineFailures.push(`client ${i} stem not warmed before audio graph`);
  }
  return { phases, boundaries, timeToRealignMs, recoveryEvidence, budgetMs, baselineFailures, firstDownbeat,
    stemWarm:raw.map(r => r.stemWarm),
    realStems:raw.map(r => r.realStem),
    graphEdges:raw.map(r => Object.fromEntries(Object.entries(r.channels).map(([name, c]) => [name, c.edge]))),
    stemInjected:raw.map(r => r.stemInjected || []) };
}

export function mixFailures(mix, real = false) {
  const { kicks:k, vocal:v } = mix.phases.after, failures = [...(mix.baselineFailures || [])];
  if (!k.matched || k.median === null || k.median > 25 || k.p95 > 50 || k.missing) failures.push('kicks AFTER');
  if (mix.timeToRealignMs === null || mix.timeToRealignMs > mix.budgetMs) failures.push('kick realignment budget');
  for (const b of mix.boundaries.filter(b => !b.duringFreeze))
    if (b.deltaMs === null || Math.abs(b.deltaMs) > 50 || !b.correctSection) failures.push(`boundary ${b.bar}`);
  if (v.lagMs === null || Math.abs(v.lagMs) > 50 || v.returnMs === null || v.returnMs > mix.budgetMs || v.missing || v.extra) failures.push('vocal AFTER');
  if (real) {
    if (mix.realStems?.length !== 2 || !mix.realStems.every(s => s?.resolved && s.plays.length && s.apiResponses.some(r => r.status === 200 && r.type?.startsWith('audio/')))) failures.push('real stem not loaded/played through API');
  } else if (!mix.stemInjected.every(a => a.length)) failures.push('stem cache injection');
  return failures;
}
