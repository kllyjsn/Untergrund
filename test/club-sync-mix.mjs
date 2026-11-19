import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { freshSong } from '../js/state.js';
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
    signedMedianMs:quantile(ds, .5), signedP95Ms:quantile(ds, .95), median:quantile(abs, .5), p95:quantile(abs, .95), pairs };
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

export function templateKicks(host, listener, times, from, to) {
  const smooth = rows => {
    let value = 0;
    return rows.map(([t, e]) => [t, value += .2 * (e - value)]);
  };
  host = smooth(host); listener = smooth(listener);
  const sample = (rows, t) => {
    let lo = 0, hi = rows.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m][0] < t) lo = m + 1; else hi = m; }
    const r = rows[lo];
    return r && Math.abs(r[0] - t) < 6 ? r[1] : 0;
  };
  const vector = (rows, t) => {
    const v = Array.from({length:45}, (_, i) => sample(rows, t - 36 + i * 4));
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    return v.map(x => x - mean);
  };
  const hs = times.filter(t => t >= from && t <= to), pairs = [], evidence = [];
  for (const h of hs) {
    const a = vector(host, h), aa = a.reduce((s, x) => s + x * x, 0);
    let best = -Infinity, delta = null;
    for (let d = -100; d <= 100; d += 4) {
      const b = vector(listener, h + d), bb = b.reduce((s, x) => s + x * x, 0);
      const score = aa && bb ? a.reduce((s, x, i) => s + x * b[i], 0) / Math.sqrt(aa * bb) : 0;
      if (score > best && bb > aa * .04) { best = score; delta = d; }
    }
    const accepted = delta !== null && best >= .8;
    evidence.push({host:h, deltaMs:delta, correlation:Number.isFinite(best) ? best : null, accepted});
    if (accepted) pairs.push({host:h, listener:h + delta, delta});
  }
  const ds = pairs.map(p => p.delta), abs = ds.map(Math.abs);
  return {from, to, expected:hs.length, matched:pairs.length, missing:hs.length - pairs.length,
    extra:0, signedMedianMs:quantile(ds, .5), signedP95Ms:quantile(ds, .95),
    median:quantile(abs, .5), p95:quantile(abs, .95), pairs, evidence};
}

export function boundaryMetric(host, listener, boundary) {
  const slice = (rows, a, b) => rows.filter(([t]) => t >= a && t <= b);
  const around = correlate(slice(host, boundary - 1200, boundary + 2000), slice(listener, boundary - 1600, boundary + 2400), 400);
  const after = correlate(slice(host, boundary + 100, boundary + 2800), slice(listener, boundary - 300, boundary + 3200), 400);
  return { deltaMs:around.lagMs, correlation:around.score, localLagMs:after.lagMs, localCorrelation:after.score,
    correctSection:after.lagMs !== null && Math.abs(after.lagMs) <= 50 && after.score >= .8 };
}

export function analyzeMix(raw, s, events, origin) {
  const [he, le] = raw.map(r => envelope(r));
  const [hb, lb] = raw.map(r => envelope(r, 2));
  const start = Math.max(he[0][0], le[0][0]) + 500, end = Math.min(he.at(-1)[0], le.at(-1)[0]) - 200;
  // Low-band transients are gated against the generated score, then compared to host audio, not the score clock.
  const candidates = onsets(he, s.bpm), listener = onsets(le, s.bpm);
  const score = [...s.chain].flatMap((ch, bar) => s.patterns[ch.charCodeAt(0) - 65].steps.kick.flatMap((v, step) => v ? [origin + (bar * 16 + step) * 15000 / s.bpm] : []));
  const offsets = score.map(t => candidates.reduce((a, b) => Math.abs(b - t) < Math.abs(a - t) ? b : a, Infinity) - t).filter(d => Math.abs(d) < 150);
  const offset = quantile(offsets, .5) ?? 0;
  const host = candidates.filter(t => score.some(k => Math.abs(t - k - offset) < 65));
  const phases = {};
  for (const [name, from, to] of [['before', start, events.interruptAt], ['after', events.recoverAt, end]]) {
    const rows = column => name === 'after' ? raw.map(r => postResumeEnvelope(r, column)) : raw.map(r => envelope(r, column));
    const [kh, kl] = rows(1), [vh, vl] = rows(3);
    const kicks = templateKicks(kh, kl, host, from, to);
    const listenerCandidates = onsets(kl, s.bpm).filter(t => score.some(k => Math.abs(t - k - offset) < 65));
    kicks.extra = listenerCandidates.filter(t => t >= from && t <= to && kicks.pairs.every(p => Math.abs(p.listener - t) > 100)).length;
    const threshold = Math.max(...vh.filter(([t]) => t >= from && t <= to).map(r => r[1]), 0) * .25;
    const hp = phraseOnsets(vh, threshold), lp = phraseOnsets(vl, threshold);
    const vocal = matchEvents(hp, lp, from + 150, to - 150, 400);
    const vlag = correlate(vh.filter(([t]) => t >= from && t <= to), vl.filter(([t]) => t >= from && t <= to), 400);
    vocal.lagMs = vlag.lagMs; vocal.correlation = vlag.score;
    vocal.expectedPhraseOnsets = Array.from({length:Math.ceil(s.chain.length / 2)}, (_, i) => origin + i * 480000 / s.bpm)
      .filter(t => t >= from && t <= to);
    vocal.returnMs = vl.find(([t, e]) => t >= from && t <= to && e > threshold)?.[0] - from;
    if (!Number.isFinite(vocal.returnMs)) vocal.returnMs = null;
    phases[name] = { kicks, vocal };
  }
  const boundaries = mixBoundaries(s, origin).filter(b => b.at >= events.interruptAt && b.at + 3200 < end)
    .map(b => {
      const rows = b.at >= events.recoverAt ? raw.map(r => postResumeEnvelope(r, 2)) : [hb, lb];
      return {...b, duringFreeze:b.at < events.recoverAt, ...boundaryMetric(...rows, b.at)};
    });
  const timeToRealignMs = realignment({...phases.after.kicks, hostOnsets:host}, events.recoverAt);
  const budgetMs = 3 * 60000 / s.bpm;
  return { phases, boundaries, timeToRealignMs, budgetMs, scoreOutputOffsetMs:offset,
    hostOnsets:host, listenerOnsets:listener, stemInjected:raw.map(r => r.stemInjected || []) };
}

export function mixFailures(mix) {
  const { kicks:k, vocal:v } = mix.phases.after, failures = [];
  if (!k.matched || k.median === null || k.median > 25 || k.p95 > 50 || k.missing) failures.push('kicks AFTER');
  if (mix.timeToRealignMs === null || mix.timeToRealignMs > mix.budgetMs) failures.push('kick realignment budget');
  for (const b of mix.boundaries.filter(b => !b.duringFreeze))
    if (b.deltaMs === null || Math.abs(b.deltaMs) > 50 || !b.correctSection) failures.push(`boundary ${b.bar}`);
  if (v.lagMs === null || Math.abs(v.lagMs) > 50 || v.returnMs === null || v.returnMs > mix.budgetMs || v.missing || v.extra) failures.push('vocal AFTER');
  if (!mix.stemInjected.every(a => a.length)) failures.push('stem cache injection');
  return failures;
}
