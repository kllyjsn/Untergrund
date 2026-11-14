// Controlled experiments (docs/improvement-engine.md): a stable hash of the listener id picks the arm, and every
// listen in an experiment's scope is tagged with its id (`xp`) and arm (`arm`). Pure; shared by the app and the analyzer.
// No listener id (analytics off: Do Not Track, Global Privacy Control, automated browsers) means no arm: always the default.
import { fnv } from './listen.js';

export const ARMS = ['control', 'variant'];
export const XP_ID = /^[a-z0-9][a-z0-9_.-]{0,31}$/;
// Scope keys are the listen's own context; a listen outside the scope is never assigned or tagged.
export const SCOPE_KEYS = ['style', 'src', 'surf', 'dev', 'co'];
export const MAX_SHARE = 0.5;

// The running experiments, shipped (and ended) only by reviewed PRs, usually from a proposal in the improvement report:
// { id, lever, scope: { style: 'techno', src: 'prompt' }, share: 0.1, primary: { metric: 'down', goal: 'lower' },
//   guardrails: ['skip', 'complete'], minListensPerArm: 400, from: '2026-11-20', until: '2026-12-20',
//   apply(song, { seed }) { … one change to the generated song, variant arm only … } }
export const EXPERIMENTS = [];

// 0-99 for this listener in this experiment: the same every visit, independent across experiments.
export const bucket = (lid, id) => parseInt(fnv(`${lid}:${id}`), 36) % 100;
export const inScope = (exp, ctx = {}) => Object.entries(exp.scope || {}).every(([k, v]) => ctx[k] === v);
const day = (t) => new Date(t).toISOString().slice(0, 10);
export const isLive = (exp, now = Date.now()) => (!exp.from || day(now) >= exp.from) && (!exp.until || day(now) < exp.until);

// The first live experiment whose scope matches gets the listen, so a listen is in at most one experiment.
export function assign(lid, ctx = {}, list = EXPERIMENTS, now = Date.now()) {
  if (!lid) return null;
  for (const exp of list) {
    if (!XP_ID.test(exp?.id || '') || !isLive(exp, now) || !inScope(exp, ctx)) continue;
    const share = Math.max(0, Math.min(MAX_SHARE, exp.share ?? 0.1));
    return { xp: exp.id, arm: bucket(lid, exp.id) < Math.round(100 * share) ? 'variant' : 'control', exp };
  }
  return null;
}

// What a registry entry must look like; test/experiments.mjs checks EXPERIMENTS with it.
export function experimentErrors(exp, metrics = []) {
  const e = [];
  if (!XP_ID.test(exp?.id || '')) e.push('id');
  if (!exp?.scope || typeof exp.scope !== 'object' || !Object.keys(exp.scope).length || Object.keys(exp.scope).some((k) => !SCOPE_KEYS.includes(k))) e.push('scope');
  if (!(exp?.share > 0 && exp.share <= MAX_SHARE)) e.push('share');
  if (!metrics.includes(exp?.primary?.metric) || !['lower', 'higher'].includes(exp?.primary?.goal)) e.push('primary');
  if (!Array.isArray(exp?.guardrails) || exp.guardrails.some((m) => !metrics.includes(m))) e.push('guardrails');
  if (!(exp?.minListensPerArm >= 50)) e.push('minListensPerArm');
  if (exp?.apply != null && typeof exp.apply !== 'function') e.push('apply');
  for (const k of ['from', 'until']) if (exp?.[k] != null && !/^\d{4}-\d{2}-\d{2}$/.test(exp[k])) e.push(k);
  return e;
}
