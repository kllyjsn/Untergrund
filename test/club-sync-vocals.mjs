import { gridKicks } from './club-sync-grid.mjs';
import { channelEnvelope } from './club-sync-mix.mjs';
import { onsets } from './club-sync-audio.mjs';

export const BIN_MS = 4;
const q = (xs, p) => xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil((xs.length - 1) * p)] : null;

export { gridKicks };

export function denseEnvelope(rows, from, to, bin = BIN_MS) {
  const out = new Float64Array(Math.ceil((to - from) / bin)), counts = new Uint16Array(out.length);
  for (const [t, e] of rows) {
    const i = Math.floor((t - from) / bin);
    if (i >= 0 && i < out.length) { out[i] += e * e; counts[i]++; }
  }
  for (let i = 0; i < out.length; i++) out[i] = counts[i] ? Math.sqrt(out[i] / counts[i]) : 0;
  return out;
}

function similarity(a, b, start, candidate, length) {
  let ab = 0, aa = 0, bb = 0, av = 0, bv = 0;
  for (let k = 0; k < length; k++) {
    const x = a[start + k] || 0, y = b[candidate + k] || 0;
    ab += x * y; aa += x * x; bb += y * y; av += x; bv += y;
  }
  if (aa < 1e-14 || bb < 1e-14) return null;
  const cosine = ab / Math.sqrt(aa * bb);
  const variance = (aa - av * av / length) * (bb - bv * bv / length);
  const pearson = variance > 1e-16 ? (ab - av * bv / length) / Math.sqrt(variance) : cosine;
  return { score: (cosine + pearson) / 2, ratio: Math.sqrt(bb / aa) };
}

export function windowOffset(expected, rendered, start, length, search = 500, bin = BIN_MS, preferred = null, kickMs = null) {
  let best = null;
  const hits = [];
  for (let d = -Math.floor(search / bin); d <= Math.floor(search / bin); d++) {
    const hit = similarity(expected, rendered, start, start + d, length);
    if (hit) {
      const value = { ...hit, lagMs: d * bin }; hits.push(value);
      if (!best || hit.score > best.score + 1e-7 || (Math.abs(hit.score - best.score) < 1e-7 && Math.abs(d) < Math.abs(best.lagMs / bin))) best = value;
    }
  }
  if (!best) return null;
  if (preferred !== null) {
    const local = hits.filter(h => Math.abs(h.lagMs - preferred) <= 40 && h.score >= best.score - .04).sort((a, b) => b.score - a.score)[0];
    if (local) return { ...local, ambiguous: false, anchored: true };
  }
  const peaks = hits.filter((h, i) => h.score >= best.score - .025 && h.score >= (hits[i - 1]?.score ?? -Infinity) && h.score >= (hits[i + 1]?.score ?? -Infinity));
  const kickAlternative = kickMs !== null && Math.abs(best.lagMs - kickMs) > 200 &&
    hits.some(h => Math.abs(h.lagMs - kickMs) <= 100 && h.score >= .65);
  return { ...best, ambiguous: kickAlternative || peaks.some(h => Math.abs(h.lagMs - best.lagMs) > 80), anchored: false };
}

export function activeIntervals(values, threshold, bin = BIN_MS, minMs = 40, bridgeMs = 0) {
  const segments = [];
  let start = null, last = null;
  for (let i = 0; i <= values.length; i++) {
    if (i < values.length && values[i] > threshold) {
      if (start === null) start = i;
      last = i;
    } else if (start !== null && (i === values.length || (i - last) * bin > bridgeMs)) {
      if ((last + 1 - start) * bin >= minMs) segments.push({ start: start * bin, end: (last + 1) * bin });
      start = last = null;
    }
  }
  return segments;
}

export function phraseMatches(expected, rendered, from, to, threshold, bin = BIN_MS) {
  const phrases = activeIntervals(expected, threshold, bin, 200, 120);
  const stride = Math.max(1, Math.round(20 / bin));
  const a = Float64Array.from(expected.filter((_, i) => i % stride === 0));
  const b = Float64Array.from(rendered.filter((_, i) => i % stride === 0));
  const coarse = bin * stride;
  const output = [];
  for (const [id, p] of phrases.entries()) {
    if (p.start < from || p.end > to) continue;
    const start = Math.max(0, Math.floor(p.start / coarse) - 5), length = Math.ceil((p.end - p.start) / coarse) + 10;
    const candidates = [];
    for (let j = Math.max(0, Math.floor(from / coarse) - 5); j + length <= Math.min(b.length, Math.ceil(to / coarse) + 5); j++) {
      const hit = similarity(a, b, start, j, length);
      if (hit?.score >= .85 && hit.ratio >= .35 && hit.ratio <= 3) candidates.push({ at: (j + 5) * coarse, ...hit });
    }
    const peaks = [];
    for (const hit of candidates.sort((x, y) => y.score - x.score))
      if (peaks.every(p => Math.abs(p.at - hit.at) > Math.max(300, (length - 10) * coarse * .65))) peaks.push(hit);
    const legitimateRepeats = [];
    const occurrences = peaks.filter(hit => {
      if (Math.abs(hit.at - p.start) <= 50) return true;
      const other = phrases.some((r, i) => {
        if (i === id || Math.abs(r.start - hit.at) > 100) return false;
        const source = Math.max(0, Math.floor(r.start / coarse) - 5), candidate = Math.round(hit.at / coarse) - 5;
        for (let d = -5; d <= 5; d++) {
          const own = similarity(a, b, source, candidate + d, length);
          if (own && own.score >= Math.max(.85, hit.score - .03)) return true;
        }
        return false;
      });
      if (other) legitimateRepeats.push(hit);
      return !other;
    });
    const present = occurrences.some(h => Math.abs(h.at - p.start) <= 50);
    output.push({ id, ...p, status: occurrences.length > 1 ? 'doubled' : present ? 'present' : occurrences.length ? 'displaced' : 'missing',
      present, occurrences, ambiguousRepeats: legitimateRepeats.length });
  }
  return output;
}

function replayWindows(expected, rendered, from, to, threshold, bin) {
  const replays = [], length = Math.round(800 / bin), hop = Math.round(200 / bin);
  for (let i = Math.ceil(from / bin); i + length < to / bin; i += hop) {
    const current = windowOffset(expected, rendered, i, length, 100, bin);
    if (current?.score >= .85) continue;
    let best = null;
    const candidates = [];
    for (let j = Math.max(0, i - Math.round(8000 / bin)); j + Math.round(300 / bin) < i; j += Math.round(40 / bin)) {
      if (!expected.subarray(j, j + length).some(v => v > threshold)) continue;
      const hit = similarity(expected, rendered, j, i, length);
      if (hit?.score >= .92 && hit.score > (current?.score || 0) + .15 && hit.ratio > .35 && hit.ratio < 3) {
        const candidate = { ...hit, sourceMs: j * bin }; candidates.push(candidate);
        if (!best || hit.score > best.score) best = candidate;
      }
    }
    if (best && candidates.some(c => Math.abs(c.sourceMs - best.sourceMs) > 160 && c.score >= best.score - .025)) best = null;
    if (best) {
      const last = replays.at(-1), offset = i * bin - best.sourceMs;
      if (last && i * bin <= last.end && Math.abs(last.replayedOffsetMs - offset) < 80) last.end = (i + length) * bin;
      else replays.push({ start: i * bin, end: (i + length) * bin, replayedOffsetMs: offset, score: best.score });
    }
  }
  return replays.filter(r => r.end - r.start >= 1000);
}

export function sustainedRecovery(windows, gaps, baselineMs, marker) {
  if (baselineMs === null) return null;
  let streak = 0;
  for (const w of windows) {
    const gap = gaps.some(g => g.startMs + marker < w.end && g.startMs + marker + g.durationMs > w.start);
    const aligned = w.activeMs >= 250 && w.vocalVsKickMs !== null && Math.abs(w.vocalVsKickMs - baselineMs) <= 25 && !gap;
    streak = aligned ? streak + 1 : 0;
    if (streak === 3) return w.end - marker;
  }
  return null;
}

export function vocalMetrics({ expected, rendered, kickOffsets = [], from = 0, to, marker = 0, bin = BIN_MS, baselineMs = null }) {
  if (!(to > from) || !expected.length || !rendered.length) return { measured: false, reason: 'empty vocal comparison', windows: [], recoveryMs: null };
  const peak = Math.max(...expected), activeThreshold = peak * 10 ** (-30 / 20), silenceThreshold = peak * .01;
  if (!peak) return { measured: false, reason: 'silent ground truth', windows: [], recoveryMs: null };
  const transitions = values => activeIntervals(values, activeThreshold, bin, 120, 120).flatMap(p => [p.start, p.end]);
  const expectedTransitions = transitions(expected), renderedTransitions = transitions(rendered);
  const windows = [];
  let previous = null;
  for (let at = from; at + 2000 <= to; at += 1000) {
    const start = Math.round(at / bin), length = Math.round(2000 / bin);
    const activeMs = expected.subarray(start, start + length).filter(v => v > activeThreshold).length * bin;
    const anchors = expectedTransitions.filter(t => t >= at && t < at + 2000).flatMap(t => {
      const closest = renderedTransitions.filter(r => Math.abs(r - t) <= 200).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
      return closest === undefined ? [] : [closest - t];
    });
    const preferred = q(anchors, .5) ?? previous;
    const offsets = kickOffsets.filter(k => k.at >= at && k.at < at + 2000).map(k => k.offsetMs);
    const kickMs = q(offsets, .5);
    const hit = activeMs >= 100 ? windowOffset(expected, rendered, start, length, 500, bin, preferred, kickMs) : null;
    const offsetMs = hit && hit.score >= .65 && !hit.ambiguous ? hit.lagMs : null;
    if (offsetMs !== null) previous = offsetMs;
    else if (activeMs >= 100) previous = null;
    windows.push({ start: at, end: at + 2000, activeMs, offsetMs, score: hit?.score ?? null, ambiguous: hit?.ambiguous ?? false, anchored: hit?.anchored ?? false, kickMs,
      vocalVsKickMs: offsetMs !== null && kickMs !== null ? offsetMs - kickMs : null });
  }
  const absent = Float64Array.from(expected, (e, i) => e > activeThreshold && (rendered[i] || 0) < silenceThreshold ? 1 : 0);
  const gaps = activeIntervals(absent, .5, bin, 40).map(g => ({ start: Math.max(g.start, from), end: Math.min(g.end, to) }))
    .filter(g => g.end - g.start >= 40).map(g => ({ startMs: g.start - marker, durationMs: g.end - g.start }));
  const phrases = phraseMatches(expected, rendered, from, to, activeThreshold, bin);
  const replays = replayWindows(expected, rendered, from, to, activeThreshold, bin);
  let streak = 0, absoluteGridRecoveryMs = null;
  for (const w of windows.filter(w => w.start >= marker)) {
    if (w.activeMs < 100) continue;
    streak = w.offsetMs !== null && Math.abs(w.offsetMs) <= 25 ? streak + 1 : 0;
    if (streak === 3) { absoluteGridRecoveryMs = w.end - marker; break; }
  }
  const recoveryWindows = [];
  for (let at = Math.max(from, marker); at + 500 <= to; at += 100) {
    const start = Math.round(at / bin), length = Math.round(500 / bin);
    const activeMs = expected.subarray(start, start + length).filter(v => v > activeThreshold).length * bin;
    const anchor = windows.filter(w => w.offsetMs !== null && w.start <= at + 250 && w.end >= at + 250)
      .sort((a, b) => Math.abs(a.start + 1000 - at - 250) - Math.abs(b.start + 1000 - at - 250))[0];
    const kickMs = q(kickOffsets.filter(k => k.at >= at && k.at < at + 500).map(k => k.offsetMs), .5);
    const hit = activeMs >= 250 ? windowOffset(expected, rendered, start, length, 500, bin, anchor?.offsetMs ?? null, kickMs) : null;
    const offsetMs = hit && hit.score >= .65 && !hit.ambiguous ? hit.lagMs : null;
    recoveryWindows.push({ start: at, end: at + 500, activeMs, offsetMs, kickMs,
      vocalVsKickMs: offsetMs !== null && kickMs !== null ? offsetMs - kickMs : null });
  }
  const recoveryMs = sustainedRecovery(recoveryWindows, gaps, baselineMs, marker);
  const offsets = windows.map(w => w.vocalVsKickMs).filter(v => v !== null);
  const gridOffsets = windows.map(w => w.offsetMs).filter(v => v !== null);
  return { measured: windows.some(w => w.offsetMs !== null), binMs: bin, windowMs: 2000, hopMs: 1000,
    thresholds: { active: activeThreshold, silent: silenceThreshold, correlation: .65, phraseCorrelation: .85 },
    vocalVsKick: { medianMs: q(offsets, .5), medianAbsMs: q(offsets.map(Math.abs), .5), p95AbsMs: q(offsets.map(Math.abs), .95), measuredWindows: offsets.length },
    vocalGrid: { medianMs: q(gridOffsets, .5), p95AbsMs: q(gridOffsets.map(Math.abs), .95) },
    gaps: { intervals: gaps, count: gaps.length, totalMs: gaps.reduce((s, g) => s + g.durationMs, 0), longestMs: Math.max(0, ...gaps.map(g => g.durationMs)) },
    phrases: { events: phrases, expected: phrases.length, missing: phrases.filter(p => p.status === 'missing').length,
      displaced: phrases.filter(p => p.status === 'displaced').length, doubled: phrases.filter(p => p.status === 'doubled').length, replays },
    windows, recoveryMs, absoluteGridRecoveryMs, recovery: { baselineMs, toleranceMs:25, consecutive:3, windowMs:500, hopMs:100, minimumActiveMs:250, windows:recoveryWindows } };
}

export function analyzeVocalGrid(raw, song, reference, events, origin, resume) {
  const end = Math.min(...raw.map(r => channelEnvelope(r, 'vocal').at(-1)[0]));
  const start = Math.max(origin, ...raw.map(r => channelEnvelope(r, 'vocal')[0][0])) + 500;
  const updateAt = events.broadcastAt ?? Infinity, updatedOrigin = events.newSet?.startsAt ?? origin;
  const place = rows => [...rows.map(([t, e]) => [origin + t, e]).filter(([t]) => t < updateAt),
    ...rows.map(([t, e]) => [updatedOrigin + t, e]).filter(([t]) => t >= updateAt)];
  const expected = denseEnvelope(place(reference), origin, end + 1000);
  const expectedKicks = place(gridKicks(song).map(t => [t, 1])).map(([t]) => t);
  return raw.map(capture => {
    const phases = {};
    for (const [name, from, to] of [['before', start, events.interruptAt], ['after', events.recoverAt, end - 200]]) {
      const rows = channelEnvelope(capture, 'vocal', resume && name === 'after');
      const rendered = denseEnvelope(rows, origin, end + 1000);
      const kicks = onsets(channelEnvelope(capture, 'kick', resume && name === 'after'), song.bpm);
      const used = new Set();
      const kickOffsets = expectedKicks.flatMap(t => {
        let nearest = -1, distance = 200;
        kicks.forEach((k, i) => { if (!used.has(i) && Math.abs(k - t) < distance) { distance = Math.abs(k - t); nearest = i; } });
        if (nearest < 0) return [];
        used.add(nearest); return [{ at: t - origin, offsetMs: kicks[nearest] - t }];
      });
      phases[name] = vocalMetrics({ expected, rendered, kickOffsets, from: from - origin, to: to - origin, marker: events.recoverAt - origin,
        baselineMs: name === 'after' ? phases.before.vocalVsKick?.medianMs ?? null : null });
    }
    return phases;
  });
}

export function vocalFindings(clients) {
  return clients.flatMap((client, i) => {
    const a = client.after, role = i ? 'listener' : 'host';
    return [!a.measured && `${role} vocal grid unmeasured`, a.gaps?.count && `${role} vocal gaps`,
      (a.vocalVsKick?.medianAbsMs > 25 || a.vocalVsKick?.p95AbsMs > 50) && `${role} vocal offset`,
      a.measured && a.recoveryMs === null && `${role} vocal recovery unproven`,
      (a.phrases?.missing || a.phrases?.displaced || a.phrases?.doubled || a.phrases?.replays.length) && `${role} vocal phrase anomalies`].filter(Boolean);
  });
}

export function referenceEnvelope(song, gain) {
  const buf = __clubExpectedStem, x = buf.getChannelData(0), bin = 4, step = Math.round(buf.sampleRate * bin / 1000);
  const rows = [];
  for (let i = 0; i < x.length; i += step) {
    let energy = 0; const n = Math.min(step, x.length - i);
    for (let k = 0; k < n; k++) energy += x[i + k] ** 2;
    rows.push([i * 1000 / buf.sampleRate + (song.sing?.ms || 0), Math.sqrt(energy / n) * gain]);
  }
  return rows;
}

export function clipRange(marker, afterEnd) {
  if (!Number.isFinite(marker) || !Number.isFinite(afterEnd) || afterEnd <= marker) throw new RangeError('Invalid AFTER clip bounds');
  return { from: marker - 4000, to: afterEnd };
}

export async function extractPCM({ from, to, origin, gain, updatedOrigin = origin, updateAt = Infinity, sampleRate = 24000 }) {
  const length = Math.round((to - from) * sampleRate / 1000);
  const resample = async (data, rate) => {
    const ctx = new OfflineAudioContext(1, length, sampleRate), buffer = ctx.createBuffer(1, data.length, rate);
    buffer.copyToChannel(data, 0);
    const src = ctx.createBufferSource(); src.buffer = buffer;
    __clubNativeConnect.call(src, ctx.destination); src.start();
    return (await ctx.startRendering()).getChannelData(0);
  };
  const encode = data => {
    const bytes = new Uint8Array(data.buffer); let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(s);
  };
  const output = {};
  const anchors = __clubAudio.anchors.filter((a, i, all) => !i || a[0] > all[i - 1][0]);
  for (const name of ['vocal', 'mix']) {
    const rate = __clubPCM[name][0]?.sampleRate;
    if (!rate || !anchors.length) throw new Error('Missing captured PCM or output anchors: ' + name);
    const count = Math.round((to - from) * rate / 1000), data = new Float32Array(count), covered = new Uint8Array(count);
    let j = 0;
    for (const block of __clubPCM[name]) {
      for (let i = 0; i < block.pcm.length; i++) {
        const t = (block.frame + i) / block.sampleRate;
        while (j + 1 < anchors.length && Math.abs(anchors[j + 1][0] - t) < Math.abs(anchors[j][0] - t)) j++;
        const at = anchors[j][1] + (t - anchors[j][0]) * 1000;
        const k = Math.round((at - from) * rate / 1000);
        if (k >= 0 && k < count) { data[k] = block.pcm[i]; covered[k] = 1; }
      }
    }
    output[name] = { pcm: encode(await resample(data, rate)), nativeSampleRate: rate, coverage: covered.reduce((s, n) => s + n, 0) / count };
  }
  const buf = __clubExpectedStem, x = buf.getChannelData(0), expected = new Float32Array(Math.round((to - from) * buf.sampleRate / 1000));
  for (let i = 0; i < expected.length; i++) {
    const epoch = from + i * 1000 / buf.sampleRate;
    const at = (epoch - (epoch >= updateAt ? updatedOrigin : origin)) / 1000, k = Math.floor(at * buf.sampleRate);
    expected[i] = (x[k] || 0) * gain;
  }
  output.expected = { pcm: encode(await resample(expected, buf.sampleRate)), coverage: 1 };
  return { sampleRate, ...output };
}

export function floatWav(samples, sampleRate, channels = 1) {
  const out = Buffer.alloc(44 + samples.length * 4);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(3, 20); out.writeUInt16LE(channels, 22); out.writeUInt32LE(sampleRate, 24); out.writeUInt32LE(sampleRate * channels * 4, 28);
  out.writeUInt16LE(channels * 4, 32); out.writeUInt16LE(32, 34); out.write('data', 36); out.writeUInt32LE(samples.length * 4, 40);
  for (let i = 0; i < samples.length; i++) out.writeFloatLE(samples[i], 44 + i * 4);
  return out;
}

export function levelMatchClips(clips, sampleRate) {
  const expected = clips.expected, width = Math.round(sampleRate / 100), mask = new Uint8Array(expected.length);
  const energies = [];
  for (let i = 0; i < expected.length; i += width) {
    let energy = 0; for (let j = i; j < Math.min(i + width, expected.length); j++) energy += expected[j] ** 2;
    energies.push(energy / width);
  }
  const threshold = Math.max(...energies) * .001;
  for (let i = 0; i < mask.length; i++) mask[i] = energies[Math.floor(i / width)] > threshold ? 1 : 0;
  const count = mask.reduce((s, n) => s + n, 0), stats = {};
  let targetRms = .1;
  for (const [name, samples] of Object.entries(clips)) {
    let energy = 0, peak = 0;
    for (let i = 0; i < samples.length; i++) { if (mask[i]) energy += samples[i] ** 2; peak = Math.max(peak, Math.abs(samples[i])); }
    const rms = count ? Math.sqrt(energy / count) : 0;
    stats[name] = { rms, peak };
    if (peak && rms) targetRms = Math.min(targetRms, .95 * rms / peak);
  }
  for (const [name, samples] of Object.entries(clips)) {
    const gain = stats[name].rms ? targetRms / stats[name].rms : 1;
    stats[name].gain = gain;
    for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  }
  return { targetRms, activeSamples: count, stats, channel: 'mono channel 0', format: 'float32 WAV; divide by gain to recover captured PCM' };
}
