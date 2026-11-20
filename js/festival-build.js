import { rng } from './dsp.js';

export const festivalTrap = (style, voice) => style === 'trap' && [0, 2].includes(Math.round(voice));

export function festivalBuilds(chain, style, voice, seed = 0) {
  if (!festivalTrap(style, voice)) return [];
  if (typeof chain !== 'string' || /[^A-H]/.test(chain)) throw new Error('Expected an A-H song chain');
  const r = rng(Math.imul((seed | 0) ^ 0x739a4d21, 0x45d9f3b)), builds = [];
  for (let drop = 1; drop < chain.length; drop++) {
    if (!/[GH]/.test(chain[drop]) || /[GH]/.test(chain[drop - 1])) continue;
    let start = drop - 1;
    if (chain[start] === 'D' && start) start--;
    const kind = chain[start];
    while (start > 0 && chain[start - 1] === kind) start--;
    const limit = Math.min(drop - start, drop - start < 8 ? 2 : 4);
    const first = builds.length === 0, bars = first ? limit : Math.min(limit, 2 + Math.floor(3 * r()));
    const shape = ['straight', 'triplet', 'burst'][Math.floor(3 * r())];
    const roll = first ? 'full' : ['late', 'late', 'none'][Math.floor(3 * r())];
    builds.push({ from: drop - bars, drop, bars, strength: (first ? 0.3 : 0.22) + 0.04 * r(), roll, shape,
      rollCurve: 0.7 + 1.8 * r(), gapSteps: [2, 4, 8][Math.floor(3 * r())],
      sweepBars: first ? Math.max(1, bars - Math.floor(2 * r())) : 1 + Math.floor(Math.min(bars, builds[0].sweepBars) * r()),
      sweep: { tone: r() < 0.5, low: 300 + 500 * r(), high: 2600 + 4400 * r(), curve: 0.6 + 2 * r() } });
  }
  return builds;
}

export function festivalBuildStep(builds, bar, step) {
  const build = builds.find((b) => bar >= b.from && bar <= b.drop);
  if (!build) return null;
  if (bar === build.drop) return step === 0 ? { drop: true } : null;
  const elapsed = (bar - build.from) * 16 + step, total = build.bars * 16;
  const duration = total - build.gapSteps, progress = elapsed / duration, last = bar === build.drop - 1;
  const gap = elapsed >= duration;
  const divisions = last ? 2 : progress < 0.5 ? 0.5 : 1;
  const offsets = build.shape === 'triplet' ? (last ? (step % 2 ? [1 / 3] : [0, 2 / 3]) : (step % 4 === 0 ? [0] : step % 4 === 1 ? [1 / 3] : step % 4 === 2 ? [2 / 3] : [])) :
    build.shape === 'burst' && step % 8 >= 6 ? [] : Array.from({ length: Math.ceil(divisions) }, (_, i) => i / divisions);
  const rolls = gap || build.roll === 'none' || (build.roll === 'late' && elapsed < total / 2) || (build.shape === 'straight' && divisions === 0.5 && step % 2) ? [] :
    offsets.map(offset => ({ offset, velocity: 0.18 + 0.44 * ((elapsed + offset) / duration) ** build.rollCurve }));
  return { start: elapsed === 0, sweepStart: elapsed === total - build.sweepBars * 16, sweep: build.sweep,
    strength: build.strength, durationSteps: build.sweepBars * 16, gapSteps: build.gapSteps, lowOff: last, gap, gapStart: elapsed === duration,
    thin: step % (last ? 8 : 4) !== 0, rolls };
}
