export function createRoomClock({ wall = () => Date.now(), monotonic = () => performance.now() } = {}) {
  let best;
  return {
    observe(clock, from, to) {
      if (!Array.isArray(clock)) return;
      const [received, sent] = clock;
      if (![received, sent, from, to].every(Number.isFinite) || sent < received || to < from) return;
      // Subtract time spent on the server; keep the lowest-latency observation from recent heartbeats.
      const latency = Math.max(0, to - from - (sent - received));
      if (!best || (to >= best.at && (to - best.at >= 30000 || latency < best.latency))) {
        best = { offset: (received - from + sent - to) / 2, at: to, latency };
      }
      return latency;
    },
    shift() {
      return best ? monotonic() + best.offset - wall() : 0;
    },
  };
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

export function audioClockOffset(contextTime, wallTime, performanceTime, output) {
  const offset = wallTime / 1000 - contextTime;
  const age = performanceTime - output?.performanceTime;
  if (Number.isFinite(output?.contextTime) && output.contextTime > 0 &&
      Number.isFinite(output.performanceTime) && output.performanceTime > 0 && age >= -5 && age <= 100)
    return Math.min(offset, (wallTime - age) / 1000 - output.contextTime);
  return offset;
}

export function syncAudioClock(previous, measured) {
  // A frozen audio clock can fall seconds behind wall time. Don't sweep the
  // playhead through that gap; only smooth ordinary timing jitter.
  const jumped = previous !== null && Math.abs(measured - previous) > 0.15;
  const offset = previous === null || jumped ? measured : previous + (measured - previous) * 0.05;
  return { offset, jumped };
}

// Re-anchor the audio schedule to the shared transport when it drifts or stalls.
export function transportResync(target, nextTime, now, stepSec, jumped = false, minSkip = -Infinity) {
  if (!jumped && Math.abs(target - nextTime) <= 0.03 && nextTime >= now) return null;
  const ready = now + 0.005;
  // Recover one step near the render deadline without moving the grid or
  // squeezing the gap to its following step below half a step.
  const earliest = jumped ? ready - Math.min(0.055, stepSec / 2) : ready;
  let skip = jumped ? Math.max(minSkip, Math.ceil((earliest - target) / stepSec)) : 0;
  target += skip * stepSec;
  while (target < earliest) { target += stepSec; skip++; }
  return { skip, nextTime: target, discard: jumped, ...(target < ready && { firstTime: ready }) };
}
