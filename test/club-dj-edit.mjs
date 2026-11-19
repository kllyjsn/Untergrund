import assert from 'node:assert/strict';
import { envelope, onsets, BPM, PERIOD_MS } from './club-sync-audio.mjs';

// The listener's untouched kick marks each opportunity, even when the DJ's kick is muted.
const LEADS_MS = [215, 295, 375];

export async function measureDJEdits(host, listener, origin, { until, pause }) {
  // Closing Club before the DJ starts can cancel pending playback.
  await until(() => host.run('__clubAudio.samples.some(r => r[1] > .001)'), 'DJ has rendered a kick before closing Club');
  await host.click('.club-close');
  await host.click('.studio-toggle');
  const period = PERIOD_MS / 16;
  const calibration = await until(async () => {
    const sample = await listener.run('__clubAudio');
    if (sample.anchors.length < 10 || !sample.samples.length) return null;
    const hits = onsets(envelope(sample), BPM);
    return hits.length < 6 ? null : hits.slice(-6).map(t => t - origin - Math.round((t - origin) / period) * period);
  }, 'listener output phase');
  const phase = calibration.sort((a, b) => a - b)[3];
  const targets = [];
  let i = Math.ceil((Date.now() + 2000 - origin - phase) / period);
  for (const kind of ['mute', 'step']) {
    for (const lead of LEADS_MS) {
      for (const enabled of [false, true]) {
        targets.push({ kind, lead, enabled, target: origin + phase + i * period });
        i += 2;
      }
    }
  }
  const selectors = { mute: '.row[data-id="kick"] .m', step: '.row[data-id="kick"] .step[data-i="0"]' };
  const toggle = `(targets => new Promise((resolve, reject) => {
    const epoch = () => performance.timeOrigin + performance.now();
    const actions = [];
    try {
      for (const s of Object.values(${JSON.stringify(selectors)})) {
        if (!document.querySelector(s)?.getBoundingClientRect().width) throw new Error('Studio control is not visible: ' + s);
      }
      for (const x of targets) setTimeout(() => {
        try {
          const e = document.querySelector(${JSON.stringify(selectors)}[x.kind]);
          const at = epoch(), before = e.getAttribute('aria-pressed');
          if (x.kind === 'mute') e.click();
          else e.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true }));
          const expected = String(x.kind === 'mute' ? !x.enabled : x.enabled);
          if (before === expected || e.getAttribute('aria-pressed') !== expected) throw new Error('Control did not toggle: ' + x.kind);
          if (document.visibilityState !== 'visible') throw new Error('DJ tab was hidden');
          actions.push({ ...x, at, syncError: at - (x.target - x.lead) });
          if (actions.length === targets.length) resolve(actions);
        } catch (error) { reject(error); }
      }, Math.max(0, x.target - x.lead - epoch()));
    } catch (error) { reject(error); }
  }))`;
  // Schedule each browser action without holding an open CDP request during the sweep.
  await host.run(`void (${toggle})(${JSON.stringify(targets)}).then(a => globalThis.__djActions = a, e => globalThis.__djError = e.message)`);
  await until(() => host.run('globalThis.__djActions ?? globalThis.__djError ?? null'), 'DJ edit sweep', targets.at(-1).target - Date.now() + 5000);
  await pause(Math.max(0, targets.at(-1).target + period + 1000 - Date.now()));
  const actions = await host.run('globalThis.__djActions ?? globalThis.__djError ?? null');
  assert.ok(Array.isArray(actions) && actions.length === targets.length, JSON.stringify(actions));
  const raw = await Promise.all([host, listener].map(c => c.run('__clubAudio')));
  const onsetTimes = raw.map(r => onsets(envelope(r), BPM));
  const near = (k, t) => onsetTimes[k].find(x => Math.abs(x - t) < 100);

  const rows = actions.map(x => {
    const reference = near(1, x.target), sameDownbeat = near(0, x.target);
    const opportunities = [0, period];
    if (reference === undefined) return { ...x, error: 'Missing reference beat' };
    const counts = opportunities.map(d => near(0, x.target + d));
    const effectIndex = counts.findIndex(t => x.enabled === (t !== undefined));
    if (effectIndex < 0) return { ...x, error: 'Rendered edit not detected', hits: counts.filter(t => t !== undefined).map(t => t - x.at) };
    const renderedEffectAt = x.enabled ? counts[effectIndex] : reference + opportunities[effectIndex];
    return { ...x, referenceLeadMs: reference - x.at, renderedEffectMs: renderedEffectAt - x.at,
      firstOpportunityApplied: x.enabled === (sameDownbeat !== undefined),
      staleKickMs: x.enabled ? [] : counts.filter((t, i) => i < effectIndex && t !== undefined).map(t => t - x.at) };
  });
  console.table(rows.map(x => ({ kind:x.kind, enabled:x.enabled, lead:Math.round(x.referenceLeadMs ?? x.lead),
    effect:Math.round(x.renderedEffectMs), first:x.firstOpportunityApplied, stale:(x.staleKickMs ?? x.hits ?? []).map(Math.round).join(','), error:x.error })));
  return { rows, onsetTimes, missed: rows.filter(row => !row.firstOpportunityApplied).length };
}
