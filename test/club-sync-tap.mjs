import { onsets, fixtureMissing, BPM, KICK_STEPS, STEP_MS, PERIOD_MS } from './club-sync-audio.mjs';
import { firstMixDownbeat, missedFirstMixDownbeat } from './club-sync-mix.mjs';

function schedulerTapOffset(capture, origin, since = -Infinity, resumed = false) {
  if (!Number.isFinite(origin)) throw new Error('Missing server transport origin');
  if (capture.errors?.length) throw new Error(capture.errors.join('; '));
  const skew = capture.clockSkew ?? 0;
  const mappings = capture.scheduler?.filter(s => Number.isFinite(s.clockOffset) &&
    Math.abs(s.transportOrigin - skew - origin) <= 50);
  const firstKick = capture.sources?.find(s => s.tag === 'kick' && s.at >= Math.max(since, mappings?.[0]?.at));
  const anchor = firstKick ? mappings.filter(s => s.at <= firstKick.at).at(-1) :
    mappings?.filter(s => s.at <= since).at(-1) ?? mappings?.[0];
  if (!anchor || (resumed && !(anchor.at >= since))) throw new Error('Missing scheduler context/wall mapping for transport');
  return anchor.clockOffset * 1000 - skew;
}

export function schedulerTapEnvelope(capture, origin, channel, { segmented = false, after = false, since = -Infinity } = {}) {
  const offset = schedulerTapOffset(capture, origin, since);
  const tap = channel ? capture.channels?.[channel] : capture;
  if (channel && !(tap?.ready && tap.edge)) throw new Error(`Missing rendered ${channel} graph tap`);
  if (!tap?.samples?.length) throw new Error('No rendered tap samples');
  const segments = [{contextTime:-Infinity, offset}];
  if (segmented) for (const event of capture.lifecycle || []) {
    if (event.name !== 'resume' || event.at < since) continue;
    const contextTime = event.clocks?.[0]?.contextTime;
    if (!Number.isFinite(contextTime)) throw new Error('Missing resume context boundary');
    segments.push({contextTime, offset:schedulerTapOffset(capture, origin, event.at, true)});
  }
  const boundary = capture.resumeBoundary;
  if (after && (!Number.isFinite(boundary?.frame) || !(boundary.sampleRate > 0)))
    throw new Error('Missing resume PCM boundary');
  // Pins come from scheduling telemetry, never from fitting rendered onsets or Chrome output clocks.
  return tap.samples.filter(([t]) => !after || Math.round(t * boundary.sampleRate) >= boundary.frame)
    .map(([t, energy]) => {
      const segment = segments.findLast(s => t >= s.contextTime);
      return [t * 1000 + segment.offset, energy];
    });
}

export function tapFirstDownbeat(captures, origin, bpm) {
  const result = firstMixDownbeat(...captures.map(c => onsets(schedulerTapEnvelope(c, origin, 'kick'), bpm)), origin, bpm);
  return { ...result, status: result.deltaMs === null ? 'absent' : missedFirstMixDownbeat(result) ? 'displaced' : 'aligned' };
}

export function tapFixtureEvidence(rows, origin, from, to) {
  const fitted = fixtureMissing(rows, origin, from, to);
  const expected = [];
  for (let n = Math.floor((from - origin - 200) / PERIOD_MS) - 1; origin + n * PERIOD_MS <= to + 200; n++)
    for (const [bar, steps] of KICK_STEPS.entries()) for (const step of steps) {
      const t = origin + n * PERIOD_MS + (bar * 16 + step) * STEP_MS + fitted.outputOffsetMs;
      if (t >= from && t <= to) expected.push(t);
    }
  const kicks = onsets(rows, BPM);
  const candidates = expected.flatMap((t, i) => kicks.map((at, j) => ({ i, j, at, expectedAt: t, deltaMs: at - t })))
    .filter(p => Math.abs(p.deltaMs) <= 250).sort((a, b) => Math.abs(a.deltaMs) - Math.abs(b.deltaMs));
  const usedExpected = new Set(), usedKicks = new Set(), displaced = [];
  for (const p of candidates) {
    if (usedExpected.has(p.i) || usedKicks.has(p.j)) continue;
    usedExpected.add(p.i); usedKicks.add(p.j);
    if (Math.abs(p.deltaMs) > 60) displaced.push({ expectedAt: p.expectedAt, at: p.at, deltaMs: p.deltaMs });
  }
  const absentAt = expected.filter((_, i) => !usedExpected.has(i));
  return { ...fitted, missing: absentAt.length + displaced.length,
    missingAt: [...absentAt, ...displaced.map(p => p.expectedAt)].sort((a, b) => a - b),
    absentAt, displaced };
}
