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
    const bars = Math.min(drop - start, drop - start < 8 ? 2 : 4);
    builds.push({ from: drop - bars, drop, bars, strength: 0.3 + 0.05 * r() });
  }
  return builds;
}

export function festivalBuildStep(builds, bar, step) {
  const build = builds.find((b) => bar >= b.from && bar <= b.drop);
  if (!build) return null;
  if (bar === build.drop) return step === 0 ? { drop: true } : null;
  const elapsed = (bar - build.from) * 16 + step, total = build.bars * 16;
  const progress = elapsed / (total - 4), last = bar === build.drop - 1;
  const gap = last && step >= 12;
  const divisions = last ? 2 : progress < 0.5 ? 0.5 : 1;
  const rolls = gap || (divisions === 0.5 && step % 2) ? [] :
    Array.from({ length: Math.ceil(divisions) }, (_, i) => ({ offset: i / divisions, velocity: 0.22 + 0.42 * ((elapsed + i / divisions) / (total - 4)) }));
  return { start: elapsed === 0, strength: build.strength, durationSteps: total - 4, lowOff: last, gap, gapStart: last && step === 12,
    thin: step % (last ? 8 : 4) !== 0, rolls };
}
