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

export function roomBoundary(startsAt, bpm, earliest, beats) {
  const span = 60000 * beats / bpm;
  return startsAt + Math.ceil((earliest - startsAt) / span) * span;
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
    const gap = prior && sample.at - prior.at - (sample.contextTime - prior.contextTime);
    const recentLifecycle = Number.isFinite(sample.lifecycleAt) && sample.at >= sample.lifecycleAt && sample.at - sample.lifecycleAt <= 2;
    const wake = jumped && prior && sample.at - prior.at > 0.15 &&
      gap > 0.15 && (gap > 0.5 || recentLifecycle);
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
export function transportResync(target, nextTime, now, stepSec, jumped = false, minSkip = -Infinity, roomOrRate = false, exact = false, profile = null) {
  const room = roomOrRate === true, rate = typeof roomOrRate === 'number' ? roomOrRate : null;
  if (rate !== null && !jumped && Math.abs(target - nextTime) <= (exact ? 0.05 : 0.03) && nextTime >= now) {
    const error = target - nextTime;
    if (exact) return roomSlew(target, nextTime, now, stepSec, rate, profile);
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
  const recoverableLead = room ? stepSec / 2 : Math.min(0.055, stepSec / 2);
  const earliest = jumped ? ready - recoverableLead : room ? now : ready;
  let skip = jumped ? Math.max(minSkip, Math.ceil((earliest - target) / stepSec)) : 0;
  target += skip * stepSec;
  while (target < earliest) { target += stepSec; skip++; }
  if (room && !jumped) target = Math.max(target, nextTime);
  return { skip, nextTime: target, discard: jumped, ...(target < ready && { firstTime: ready }) };
}

function roomSlew(target, nextTime, now, stepSec, rate, profile) {
  const error = target - nextTime;
  if ((Math.abs(error) < 1e-10 && rate === 1) || nextTime - stepSec < now + 0.005) return null;
  if (!profile || Math.abs(profile.error - error) > 1e-6 ||
      profile.rates[profile.index] !== rate) profile = roomSlewProfile(error, stepSec, rate, profile);
  else if (profile.stepSec !== stepSec) profile = roomSlewVariableProfile(error, stepSec, rate);
  const index = profile.index + 1, endRate = profile.rates[index];
  let next = nextTime + 2 * stepSec / (rate + endRate) - stepSec;
  if (endRate === 1 && Math.abs(target - next) < 1e-10) next = target;
  return {skip:0, nextTime:next, discard:false, slew:true, rate, endRate,
    profile:index < profile.rates.length - 1 ? {...profile, index, error:target - next} : null};
}

function roomSlewProfile(error, stepSec, rate, previous = null) {
  if (rate !== 1) return roomSlewRetarget(error, stepSec, rate, previous);
  const low = Math.min(rate, Math.max(0.992, 1 / (1 + 0.0015 / stepSec)));
  const high = Math.max(rate, Math.min(1.008, 1 / (1 - 0.0015 / stepSec)));
  const capacity = Math.min(1 - low, high - 1);
  const coastSteps = Math.max(2, Math.ceil(0.5 / stepSec));
  let steps = Math.max(2, Math.ceil((3.5 + Math.abs(error) * 2.5 / 0.03) * .008 / capacity / stepSec));
  for (let attempt = 0; attempt < 64; attempt++, steps++) {
    const shape = [], coast = [];
    let lo = -Infinity, hi = Infinity;
    for (let i = 1; i < steps; i++) {
      const u = i / steps;
      // Zero endpoint slopes, a rounded peak, and mean velocity 5/8.
      const pulse = 1 - Math.cos(Math.PI * u) ** 4;
      const base = (rate - 1) * (1 + Math.cos(Math.PI * Math.min(i / coastSteps, 1))) / 2;
      shape[i] = pulse; coast[i] = base;
      lo = Math.max(lo, (low - 1 - base) / pulse);
      hi = Math.min(hi, (high - 1 - base) / pulse);
    }
    const rates = amplitude => Array.from({length:steps + 1}, (_, i) =>
      i === 0 ? rate : i === steps ? 1 : 1 + coast[i] + amplitude * shape[i]);
    const phase = values => values.slice(1).reduce((sum, value, i) =>
      sum + 2 * stepSec / (values[i] + value) - stepSec, 0);
    if (phase(rates(lo)) >= error && phase(rates(hi)) <= error) {
      for (let i = 0; i < 48; i++) {
        const middle = (lo + hi) / 2;
        if (phase(rates(middle)) > error) lo = middle;
        else hi = middle;
      }
      return {rates:rates((lo + hi) / 2), index:0, stepSec, error};
    }
  }
  return {rates:Array.from({length:coastSteps + 1}, (_, i) =>
    i === 0 ? rate : i === coastSteps ? 1 : 1 + (rate - 1) * (1 + Math.cos(Math.PI * i / coastSteps)) / 2),
    index:0, stepSec, error};
}

const roomSlewLimits = new Map();
const roomSlewChange = rates => Math.max(...rates.slice(1).map((rate, i) => Math.abs(1200 * Math.log2(rate / rates[i]))));
const roomSlewPhase = (rates, stepSec) => rates.slice(1).reduce((sum, rate, i) => sum + 2 * stepSec / (rates[i] + rate) - stepSec, 0);

function roomSlewLimit(stepSec) {
  let limit = roomSlewLimits.get(stepSec);
  if (limit === undefined) {
    limit = Math.max(...[-.030, .030].map(error => roomSlewChange(roomSlewProfile(error, stepSec, 1).rates)));
    if (roomSlewLimits.size === 32) roomSlewLimits.delete(roomSlewLimits.keys().next().value);
    roomSlewLimits.set(stepSec, limit);
  }
  return limit;
}

function roomSlewVariableProfile(error, stepSec, rate) {
  const ratio = 2 ** (roomSlewLimit(stepSec) / 1200), rates = [rate];
  let remaining = error;
  for (let i = 0; i < 4096; i++) {
    if (Math.abs(remaining) < 1e-11 && Math.abs(rate - 1) < 1e-11) {
      rates.push(1);
      break;
    }
    const velocity = 1 - rate;
    const omega = Math.min(1 / stepSec, Math.sqrt(.75 * (ratio - 1) / (stepSec * Math.max(Math.abs(remaining), 1e-12))));
    let endRate = rate;
    for (let j = 0; j < 8; j++) {
      const wall = 2 * stepSec / (rate + endRate), z = omega * wall / 2;
      endRate = 1 - ((1 - 2 * z - z * z) * velocity + omega * omega * wall * remaining) / (1 + z) ** 2;
    }
    const low = Math.min(rate, Math.max(.992, 1 / (1 + .0015 / stepSec)));
    const high = Math.max(rate, Math.min(1.008, 1 / (1 - .0015 / stepSec)));
    endRate = Math.max(low, rate / ratio, Math.min(high, rate * ratio, endRate));
    remaining -= 2 * stepSec / (rate + endRate) - stepSec;
    rates.push(endRate);
    rate = endRate;
  }
  return {rates, index:0, stepSec, error, variable:true};
}

function roomSlewRetarget(error, stepSec, rate, previous) {
  const limit = roomSlewLimit(stepSec);
  const prior = previous?.rates[previous.index - 1];
  const slope = prior !== undefined && previous.rates[previous.index] === rate
    ? (rate - prior) * (rate + prior) / (2 * previous.stepSec) : 0;
  const endRate = Math.max(.992, Math.min(1.008, Math.sqrt(rate * rate + 2 * stepSec * slope)));
  const cents = 1200 * Math.log2(endRate), coastSteps = Math.max(2, Math.ceil(Math.PI * Math.abs(cents) / (2 * limit)));
  const low = Math.min(rate, endRate, Math.max(.992, 1 / (1 + .0015 / stepSec)));
  const high = Math.max(rate, endRate, Math.min(1.008, 1 / (1 - .0015 / stepSec)));
  const ratio = 2 ** (limit / 1200);
  let steps = Math.max(coastSteps * 2, Math.ceil((3.5 + Math.abs(error) * 2.5 / .03) / stepSec));
  for (let attempt = 0; attempt < 64 && steps <= 4096; attempt++, steps = Math.ceil(steps * 1.12)) {
    const base = [endRate], shape = [0];
    let lo = -Infinity, hi = Infinity;
    const bound = (coefficient, value) => {
      if (coefficient > 0) hi = Math.min(hi, value / coefficient);
      else if (coefficient < 0) lo = Math.max(lo, value / coefficient);
    };
    for (let i = 1; i <= steps; i++) {
      base[i] = i >= coastSteps * 1.5 ? 1 : 2 ** (cents * (1 + Math.cos(Math.PI * i / (coastSteps * 1.5))) / 2400);
      shape[i] = i === steps ? 0 : 1 - Math.cos(Math.PI * i / steps) ** 4;
      bound(shape[i], high - base[i]);
      bound(-shape[i], base[i] - low);
      bound(shape[i] - ratio * shape[i - 1], ratio * base[i - 1] - base[i]);
      bound(shape[i - 1] / ratio - shape[i], base[i] - base[i - 1] / ratio);
    }
    const rates = amplitude => [rate, ...base.map((value, i) => value + amplitude * shape[i])];
    if (lo <= hi && roomSlewPhase(rates(lo), stepSec) >= error && roomSlewPhase(rates(hi), stepSec) <= error) {
      for (let i = 0; i < 48; i++) {
        const middle = (lo + hi) / 2;
        if (roomSlewPhase(rates(middle), stepSec) > error) lo = middle;
        else hi = middle;
      }
      return {rates:rates((lo + hi) / 2), index:0, stepSec, error};
    }
  }
  const rates = [rate, endRate];
  for (let i = 1; i <= coastSteps; i++)
    rates.push(i === coastSteps ? 1 : 2 ** (cents * (1 + Math.cos(Math.PI * i / coastSteps)) / 2400));
  return {rates, index:0, stepSec, error};
}

export function slewTransport(target, nextTime, limit = 0.03) {
  const error = target - nextTime;
  return Math.abs(error) <= limit ? nextTime + Math.max(-0.0015, Math.min(0.0015, error)) : nextTime;
}

export function roomTransportCorrection(target, nextTime, now, stepSec, drainUntil = null, lead = 0) {
  if (drainUntil === null) {
    if (Math.abs(target - nextTime) <= 0.05) return null;
    drainUntil = nextTime;
  }
  if (target < drainUntil) {
    const lastTime = drainUntil - stepSec;
    const skip = Math.max(0, Math.floor((lastTime - target) / stepSec) + 1);
    const corrected = target + skip * stepSec;
    const firstTime = Math.max(corrected, lastTime + stepSec / 2, now + 0.005);
    if (firstTime >= now + Math.max(lead, 0.02)) return {drainUntil};
    return {skip, nextTime:corrected, firstTime, discard:false, adopted:true};
  }
  if (now < drainUntil) return {drainUntil};
  const skip = Math.max(0, Math.ceil((now - target) / stepSec));
  return {skip, nextTime:target + skip * stepSec, discard:false, adopted:true};
}
