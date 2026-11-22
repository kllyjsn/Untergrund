import { Sequencer } from '../js/engine.js';
import { Recorder } from '../js/midi.js';
import { onsets } from './club-sync-audio.mjs';
import { channelEnvelope, matchEvents } from './club-sync-mix.mjs';

export function stepFixture(song) {
  song.master.arr = 0; song.master.vary = 0; song.master.humanize = 0;
  song.params.ch.decay = 0.03;
  for (const p of song.patterns) {
    p.steps.kick = Array.from({length:16}, (_, i) => i % 4 === 0 ? 1 : 0);
    p.steps.ch = Array.from({length:16}, (_, i) => [2, 4, 5, 9, 12, 14].includes(i) ? 1 : 0);
    p.len.kick = p.len.ch = 16;
  }
  return song;
}

export function correctionGrid(song, force, track, adoption) {
  const e = new Recorder(song), seq = new Sequencer(e, song), base = 60 / song.bpm / 4;
  for (let step = 0; step < song.chain.length * 16 && !seq.finished; step++) seq.tick(step, step * base);
  const epoch = time => force.clock.outputEpochMs + (time - force.clock.outputContextTime) * 1000;
  const corrected = (force.target ?? force.nextTime) + force.deltaMs / 1000;
  const first = Math.max(force.step, force.step + Math.ceil((adoption.contextTime - corrected) / force.base));
  const at = step => step < force.step ? force.nextTime + (step - force.step) * force.base : corrected + (step - force.step) * force.base;
  const notes = (e.notes[track] || []).map(n => ({step:Math.round(n.t / base), offset:n.t - Math.round(n.t / base) * base}));
  const select = (from, to) => notes.filter(n => n.step >= from && n.step < to).map(n => ({step:n.step, at:epoch(at(n.step) + n.offset)}));
  return {first, before:select(force.step - 16, force.step), after:select(first, first + 16),
    from:epoch(at(first)) - 50, to:epoch(at(first + 16)) - 50};
}

export function forcedStepEvidence(capture, song) {
  const force = capture.forcedWholeStep, channels = {}, failures = [];
  if (!force || ![force.at, force.step, force.nextTime, force.base, force.deltaMs, force.clock?.outputEpochMs,
    force.clock?.outputContextTime].every(Number.isFinite) || force.base <= 0)
    return {channels, failures:['whole-step correction marker']};
  const adoption = capture.gridAdoptions?.find(a => a.at >= force.at);
  if (!adoption || !Number.isFinite(adoption.contextTime)) return {channels, failures:['grid adoption marker']};
  const budgetMs = 3 * 60000 / song.bpm, adoptionMs = adoption.at - force.at;
  if (adoptionMs > budgetMs) failures.push('grid adoption budget');
  for (const [name, track] of [['kick', 'kick'], ['hat', 'ch']]) {
    const grid = correctionGrid(song, force, track, adoption);
    let rows;
    try { rows = channelEnvelope(capture, name); }
    catch { failures.push(`${name} capture`); continue; }
    const attacks = onsets(rows.filter(([t]) => t >= grid.before[0]?.at - 200 && t <= grid.to + 200), song.bpm * (name === 'hat' ? 2 : 1));
    const baseline = matchEvents(grid.before.map(n => n.at), attacks, grid.before[0]?.at - 50, grid.from, 50);
    const offset = baseline.signedMedianMs;
    const stats = matchEvents(grid.after.map(n => n.at + (offset ?? 0)), attacks, grid.from, grid.to, 50);
    channels[name] = {...stats, attackOffsetMs:offset, expectedSteps:grid.after.map(n => n.step), firstFutureStep:grid.first};
    if (offset === null || !stats.expected || stats.missing || stats.extra || stats.p95 === null || stats.p95 > 50)
      failures.push(`${name} dropped/displaced steps`);
  }
  const firstAlignedMs = channels.kick?.pairs[0] ? channels.kick.pairs[0].listener - force.at : null;
  if (firstAlignedMs === null || firstAlignedMs > budgetMs) failures.push('first rendered alignment budget');
  return {force, adoption, budgetMs, adoptionMs, firstAlignedMs, channels, failures};
}
