export function createRoomClock({ wall = () => Date.now(), monotonic = () => performance.now() } = {}) {
  let best;
  let samples = [];
  return {
    observe(clock, from, to) {
      if (!Array.isArray(clock)) return;
      const [received, sent] = clock;
      if (![received, sent, from, to].every(Number.isFinite) || sent < received || to < from) return;
      // Subtract time spent on the server; keep the lowest-latency observation from recent heartbeats.
      const latency = Math.max(0, to - from - (sent - received));
      const latest = Math.max(to, samples.at(-1)?.at ?? to);
      samples.push({ offset: (received - from + sent - to) / 2, at: to, latency });
      samples = samples.filter(s => latest - s.at <= 60000).sort((a, b) => a.at - b.at).slice(-16);
      best = samples.reduce((a, b) => a.latency <= b.latency ? a : b);
      return latency;
    },
    shift() {
      return best ? monotonic() + best.offset - wall() : 0;
    },
  };
}

export async function calibrateRoomClock(initial, sample, monotonic = () => performance.now()) {
  let latest = initial;
  const deadline = monotonic() + 1500;
  for (let i = 0; i < 4 && latest.latency > 20; i++) {
    const remaining = deadline - monotonic();
    if (remaining < 50) break;
    try {
      const warm = await sample(latest.snapshot.sessionToken, Math.min(remaining, Math.max(250, latest.latency * 2 + 50)));
      if (warm) latest = warm;
    } catch {}
  }
  return latest.snapshot;
}

export function shiftRoomSet(set, by) {
  if (!by) return set;
  return {
    ...set,
    ...(Number.isFinite(set.startsAt) && { startsAt: set.startsAt + by }),
    ...(Number.isFinite(set.orderAt) && { orderAt: set.orderAt + by }),
  };
}

export function roomTransportPosition(startsAt, bpm, now = Date.now()) {
  const origin = Number.isFinite(+startsAt) ? +startsAt : now;
  const tempo = Math.max(40, Math.min(240, Number.isFinite(+bpm) ? +bpm : 132));
  const untilStart = origin - now;
  if (untilStart > 0) return { step: 0, delay: untilStart / 1000 };

  const stepMs = 15000 / tempo;
  const elapsed = Math.max(0, now - origin);
  const step = Math.floor(elapsed / stepMs) + 1;
  return { step, delay: (origin + step * stepMs - now) / 1000 };
}

export function syncAudioClock(previous, measured, sample = null) {
  // A frozen audio clock can fall seconds behind wall time. Don't sweep the
  // playhead through that gap; only smooth ordinary timing jitter.
  const jumped = previous !== null && Math.abs(measured - previous) > 0.15;
  if (sample) {
    const prior = sample.state;
    const wake = jumped && prior && sample.at - prior.at > 0.15 &&
      sample.at - prior.at - (sample.contextTime - prior.contextTime) > 0.15;
    const state = {at:sample.at, contextTime:sample.contextTime, pending:null};
    if (previous === null || wake) return {offset:measured, jumped:!!wake, state};
    if (Math.abs(measured - previous) <= 0.008) return {offset:previous, jumped:false, state};
    const values = [...(prior?.pending?.values ?? []), measured];
    state.pending = {since:prior?.pending?.since ?? sample.at, values};
    if (sample.at - state.pending.since < 2 || values.length < 3) return {offset:previous, jumped:false, state};
    const sorted = values.slice().sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    const offset = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return {offset:Math.abs(offset - previous) > 0.008 ? offset : previous, jumped:false, state:{...state, pending:null}};
  }
  const offset = previous === null || jumped ? measured : previous + (measured - previous) * 0.05;
  return { offset, jumped };
}

// Re-anchor the audio schedule to the shared transport when it drifts or stalls.
export function transportResync(target, nextTime, now, stepSec, jumped = false, minSkip = -Infinity, room = false, rate = null) {
  if (typeof room === 'number') { rate = room; room = false; }
  if (!room && rate !== null && !jumped && Math.abs(target - nextTime) <= 0.03 && nextTime >= now) {
    const error = target - nextTime;
    if (rate === null || (Math.abs(error) <= 0.002 && rate === 1) || nextTime - stepSec < now + 0.005) return null;
    const desired = Math.abs(error) <= 0.002 ? 1 : 1 - Math.max(-0.008, Math.min(0.008, error * 2.5));
    const limit = stepSec * 0.016;
    const endRate = Math.abs(desired - rate) <= limit ? desired : rate + Math.sign(desired - rate) * limit;
    // Integrating the linear rate ramp consumes one source step in this wall interval.
    const duration = 2 * stepSec / (rate + endRate);
    return { skip: 0, nextTime: nextTime + duration - stepSec, discard: false, slew: true, rate, endRate };
  }
  const error = Math.abs(target - nextTime);
  if (!jumped && (error <= 0.03 || (room && (error <= 0.05 || error < stepSec || (target >= now && target <= nextTime)))) && nextTime >= now) return null;
  const ready = now + 0.005;
  // Recover one step near the render deadline without moving the grid or
  // squeezing the gap to its following step below half a step.
  const earliest = jumped ? ready - Math.min(0.055, stepSec / 2) : room ? now : ready;
  let skip = jumped ? Math.max(minSkip, Math.ceil((earliest - target) / stepSec)) : 0;
  target += skip * stepSec;
  while (target < earliest) { target += stepSec; skip++; }
  if (room && !jumped) target = Math.max(target, nextTime);
  return { skip, nextTime: target, discard: jumped, ...(target < ready && { firstTime: ready }) };
}

export function slewTransport(target, nextTime, limit = 0.03) {
  const error = target - nextTime;
  return Math.abs(error) <= limit ? nextTime + Math.max(-0.0015, Math.min(0.0015, error)) : nextTime;
}

export function roomTransportCorrection(target, nextTime, now, stepSec, drainUntil = null) {
  if (drainUntil === null) {
    if (Math.abs(target - nextTime) <= 0.05) return null;
    drainUntil = nextTime;
  }
  if (now < drainUntil) return {drainUntil};
  const skip = Math.max(0, Math.ceil((now - target) / stepSec));
  return {skip, nextTime:target + skip * stepSec, discard:false, adopted:true};
}
