import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { freshSong } from '../js/state.js';
import { vocalFx } from '../js/sing.js';
import { envelope, postResumeEnvelope, onsets, correlate } from './club-sync-audio.mjs';

export function mixFixture() {
  const s = freshSong('hypnotic', 7, { length: 'sketch', bpm: 123, swing: 0 });
  s.artist = { name: 'Sync fixture', title: 'Seed 7', style: 'hypnotic', seed: 7 };
  s.fresh = 0;
  s.solos = {}; s.mutes = {};
  s.sing = { on: true, voice: 'gwen', db: 0, ms: 0 };
  return s;
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
      processedStem(buf, ${JSON.stringify(vocalFx(s))}, new OfflineAudioContext(1, 1, 48000));
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

export function boundaryMetric(host, listener, boundary) {
  const slice = (rows, a, b) => rows.filter(([t]) => t >= a && t <= b);
  const around = correlate(slice(host, boundary - 1200, boundary + 2000), slice(listener, boundary - 1600, boundary + 2400), 400);
  const after = correlate(slice(host, boundary + 100, boundary + 2800), slice(listener, boundary - 300, boundary + 3200), 400);
  return { deltaMs:around.lagMs, correlation:around.score, localLagMs:after.lagMs, localCorrelation:after.score,
    correctSection:after.lagMs !== null && Math.abs(after.lagMs) <= 50 && after.score >= .8 };
}

export function analyzeMix(raw, s, events, origin, { resume = true } = {}) {
  const [he, le] = raw.map(r => envelope(r));
  const [hb, lb] = raw.map(r => envelope(r, 2));
  const start = Math.max(he[0][0], le[0][0]) + 500, end = Math.min(he.at(-1)[0], le.at(-1)[0]) - 200;
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
    phases[name] = { kicks, vocal };
  }
  const boundaries = mixBoundaries(s, origin).filter(b => b.at >= events.interruptAt && b.at + 3200 < end)
    .map(b => {
      const rows = resume && b.at >= events.recoverAt ? raw.map(r => postResumeEnvelope(r, 2)) : [hb, lb];
      return {...b, duringFreeze:resume && b.at < events.recoverAt, ...boundaryMetric(...rows, b.at)};
    });
  const timeToRealignMs = realignment(phases.after.kicks, events.recoverAt);
  const budgetMs = 3 * 60000 / s.bpm;
  const baselineFailures = [];
  if (!resume && !boundaries.length) baselineFailures.push('no section boundaries measured');
  const bk = phases.before.kicks, bv = phases.before.vocal;
  if (!bk.matched || bk.median === null || bk.median > 25 || bk.p95 > 50 || bk.missing || bk.extra) baselineFailures.push('kicks BEFORE');
  if (bv.lagMs === null || Math.abs(bv.lagMs) > 50 || bv.relativeToKickMs === null || Math.abs(bv.relativeToKickMs) > 10) baselineFailures.push('vocal BEFORE');
  for (const [i, capture] of raw.entries()) {
    if (!capture.stemWarm || capture.sources.some(source => source.at < capture.stemWarm.end)) baselineFailures.push(`client ${i} stem not warmed before audio graph`);
  }
  return { phases, boundaries, timeToRealignMs, budgetMs, baselineFailures,
    stemWarm:raw.map(r => r.stemWarm),
    graphEdges:raw.map(r => Object.fromEntries(Object.entries(r.channels).map(([name, c]) => [name, c.edge]))),
    stemInjected:raw.map(r => r.stemInjected || []) };
}

export function mixFailures(mix) {
  const { kicks:k, vocal:v } = mix.phases.after, failures = [...(mix.baselineFailures || [])];
  if (!k.matched || k.median === null || k.median > 25 || k.p95 > 50 || k.missing) failures.push('kicks AFTER');
  if (mix.timeToRealignMs === null || mix.timeToRealignMs > mix.budgetMs) failures.push('kick realignment budget');
  for (const b of mix.boundaries.filter(b => !b.duringFreeze))
    if (b.deltaMs === null || Math.abs(b.deltaMs) > 50 || !b.correctSection) failures.push(`boundary ${b.bar}`);
  if (v.lagMs === null || Math.abs(v.lagMs) > 50 || v.returnMs === null || v.returnMs > mix.budgetMs || v.missing || v.extra) failures.push('vocal AFTER');
  if (!mix.stemInjected.every(a => a.length)) failures.push('stem cache injection');
  return failures;
}
