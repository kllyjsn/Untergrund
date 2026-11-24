const RAMP = 0.004;

export class VowelDuck {
  constructor(engine, out) {
    this.filters = Array.from({ length: 4 }, () => engine.filter('highshelf', 1600));
    this.filters.reduce((a, b) => a.connect(b)).connect(out);
    this.input = this.filters[0];
  }

  schedule(windows, now) {
    for (const f of this.filters) {
      const p = f.gain;
      let value = 0;
      for (const [a, b, release = b - RAMP] of windows) if (a <= now && now < b) {
        const ramp = Math.min(RAMP, (b - a) / 2);
        const tail = Math.max(ramp, b - release);
        value = -6 * Math.min(1, (now - a) / ramp, (b - now) / tail);
      }
      p.cancelScheduledValues(now);
      p.setValueAtTime(value, now);
      for (const [a, b, release = b - RAMP] of windows) {
        if (b <= now) continue;
        const ramp = Math.min(RAMP, (b - a) / 2);
        if (a > now) p.setValueAtTime(0, a);
        if (a + ramp > now) p.linearRampToValueAtTime(-6, a + ramp);
        const releaseAt = Math.max(a + ramp, Math.min(release, b - ramp));
        if (releaseAt > now) p.setValueAtTime(-6, releaseAt);
        p.linearRampToValueAtTime(0, b);
      }
    }
  }
}

export function vowelWindows(windows, start, end, now, release = end - RAMP) {
  const sorted = [...windows.filter((w) => w[1] > now), [start, end, release]].sort((a, b) => a[0] - b[0]), merged = [];
  for (const [a, b, r = b - RAMP] of sorted) {
    const last = merged.at(-1);
    if (last && a <= last[1]) { last[1] = Math.max(last[1], b); last[2] = Math.max(last[2], r); }
    else merged.push([a, b, r]);
  }
  return merged;
}
