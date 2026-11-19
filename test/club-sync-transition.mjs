import { BPM, onsets } from './club-sync-audio.mjs';

export function transitionAudio(rows, actionAt, startsAt) {
  if (![actionAt, startsAt].every(Number.isFinite)) throw new Error('Missing transition times');
  const kicks = onsets(rows, BPM);
  const firstDownbeat = kicks.filter(t => Math.abs(t - startsAt) <= 200)
    .sort((a, b) => Math.abs(a - startsAt) - Math.abs(b - startsAt))[0] ?? null;
  const lastKickBeforeAction = kicks.filter(t => t < actionAt).at(-1) ?? null;
  const firstKickAfterAction = kicks.find(t => t >= actionAt) ?? null;
  const threshold = Math.max(.0001, Math.max(0, ...rows.map(r => r[1])) * .025);
  const active = [];
  for (const [t, energy] of rows) {
    if (energy <= threshold) continue;
    const prior = active.at(-1);
    if (prior && t - prior.to <= 20) prior.to = t;
    else active.push({ from: t, to: t });
  }
  const gaps = active.slice(1).map((s, i) => ({ from: active[i].to, to: s.from, durationMs: s.from - active[i].to }))
    .filter(g => g.to >= actionAt && g.from <= startsAt + 500);
  const preceding = firstDownbeat === null ? null : gaps.filter(g => g.to <= firstDownbeat).at(-1) ?? null;
  return { firstDownbeat, lastKickBeforeAction, firstKickAfterAction,
    actionToFirstKickMs: firstKickAfterAction === null ? null : firstKickAfterAction - actionAt,
    actionToFirstDownbeatMs: firstDownbeat === null ? null : firstDownbeat - actionAt,
    interKickGapAcrossActionMs: lastKickBeforeAction === null || firstKickAfterAction === null ? null : firstKickAfterAction - lastKickBeforeAction,
    silenceBeforeFirstDownbeatMs: preceding?.durationMs ?? null,
    longestSilenceAroundTransitionMs: gaps.length ? Math.max(...gaps.map(g => g.durationMs)) : null,
    silenceThreshold: threshold, gaps };
}
