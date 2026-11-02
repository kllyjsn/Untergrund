const db = (value) => 20 * Math.log10(Math.max(value, 1e-9));
const round = (value, places = 3) => +value.toFixed(places);

export function validateBenchmark(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Benchmark must be a JSON object');
  if (!manifest.id || !Array.isArray(manifest.pairs) || !manifest.pairs.length) throw new Error('Benchmark needs an id and at least one pair');
  const pairIds = new Set();
  for (const pair of manifest.pairs) {
    if (!pair.id || pairIds.has(pair.id)) throw new Error('Every pair needs a unique id');
    pairIds.add(pair.id);
    for (const side of ['a', 'b']) {
      const candidate = pair[side];
      if (!candidate?.id || (!candidate.url && !candidate.file)) throw new Error(`${pair.id}.${side} needs id plus url or file`);
    }
  }
  return manifest;
}

export function analyzePcm(channels, sampleRate, { bpm = 0, renderMs = 0 } = {}) {
  const length = Math.min(...channels.map((channel) => channel.length));
  let peak = 0, sum = 0, dc = 0, clips = 0, crossings = 0;
  let low = 0, lowMid = 0, lowEnergy = 0, midEnergy = 0, highEnergy = 0;
  let prev = 0;
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate);
  const midAlpha = 1 - Math.exp((-2 * Math.PI * 2500) / sampleRate);
  const window = Math.max(1, Math.round(sampleRate * 0.01));
  const envelope = [];
  let windowEnergy = 0;
  for (let i = 0; i < length; i++) {
    let sample = 0;
    for (const channel of channels) sample += channel[i] / channels.length;
    const abs = Math.abs(sample);
    peak = Math.max(peak, abs);
    sum += sample * sample;
    dc += sample;
    if (abs >= 0.999) clips++;
    if (i && (sample >= 0) !== (prev >= 0)) crossings++;
    prev = sample;
    low += lowAlpha * (sample - low);
    lowMid += midAlpha * (sample - lowMid);
    const mid = lowMid - low;
    const high = sample - lowMid;
    lowEnergy += low * low;
    midEnergy += mid * mid;
    highEnergy += high * high;
    windowEnergy += sample * sample;
    if ((i + 1) % window === 0) {
      envelope.push(Math.sqrt(windowEnergy / window));
      windowEnergy = 0;
    }
  }
  const rms = Math.sqrt(sum / length);
  const sortedEnv = [...envelope].sort((a, b) => a - b);
  const floor = sortedEnv[Math.floor(sortedEnv.length * 0.55)] || 0;
  const onsets = [];
  for (let i = 2; i < envelope.length - 1; i++) {
    const rise = envelope[i] - envelope[i - 2];
    if (envelope[i] > floor * 1.8 && rise > Math.max(0.006, floor * 0.45) && i - (onsets.at(-1) ?? -10) > 4) onsets.push(i);
  }
  let gridErrorMs = null;
  if (bpm > 0 && onsets.length) {
    const step = 60 / bpm / 4;
    const errors = onsets.map((index) => {
      const time = index * 0.01;
      return Math.abs(time - Math.round(time / step) * step);
    });
    gridErrorMs = round(errors.reduce((a, b) => a + b, 0) / errors.length * 1000, 1);
  }
  const totalBand = Math.max(1e-12, lowEnergy + midEnergy + highEnergy);
  const duration = length / sampleRate;
  return {
    duration: round(duration, 2),
    peakDb: round(db(peak), 2),
    rmsDb: round(db(rms), 2),
    crestDb: round(db(peak) - db(rms), 2),
    clips,
    dc: round(dc / length, 6),
    lowShare: round(lowEnergy / totalBand),
    midShare: round(midEnergy / totalBand),
    highShare: round(highEnergy / totalBand),
    zeroCrossingsPerSecond: round(crossings / duration, 1),
    onsets: onsets.length,
    gridErrorMs,
    renderRatio: renderMs ? round(renderMs / 1000 / duration) : null,
    flags: [
      clips ? 'clipping' : null,
      Math.abs(dc / length) > 0.005 ? 'dc-offset' : null,
      db(peak) > -0.1 ? 'low-headroom' : null,
      renderMs && renderMs / 1000 > duration ? 'slower-than-realtime' : null,
    ].filter(Boolean),
  };
}

export function summarizeRatings(results) {
  const candidates = {};
  for (const result of results) {
    for (const side of ['left', 'right']) {
      const id = result.identity[side];
      const bucket = candidates[id] ||= { ratings: [], replay: 0, release: 0, appearances: 0, flags: 0 };
      bucket.appearances++;
      bucket.ratings.push(...Object.values(result.ratings[side]).map(Number));
      if (result.replay === side) bucket.replay++;
      if (result.release === side) bucket.release++;
      bucket.flags += result.metrics[side]?.flags?.length || 0;
    }
  }
  return Object.fromEntries(Object.entries(candidates).map(([id, value]) => [id, {
    appearances: value.appearances,
    meanRating: round(value.ratings.reduce((a, b) => a + b, 0) / Math.max(1, value.ratings.length), 2),
    replayWins: value.replay,
    releaseWins: value.release,
    technicalFlags: value.flags,
  }]));
}
