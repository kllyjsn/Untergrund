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

// Re-anchor the audio schedule to the shared transport when it drifts or stalls.
export function transportResync(target, nextTime, now, stepSec, tolerance = 0.03) {
  if (Math.abs(target - nextTime) <= tolerance && nextTime >= now) return null;
  let skip = 0;
  while (target < now + 0.005) { target += stepSec; skip++; }
  return { skip, nextTime: target };
}
