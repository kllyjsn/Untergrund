const db = (value) => 20 * Math.log10(Math.max(value, 1e-9));
const round = (value, places = 3) => +value.toFixed(places);

export function seededRandom(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function planSession(manifest, listenerId) {
  validateBenchmark(manifest);
  const seed = `${manifest.id}:${listenerId}`, random = seededRandom(seed);
  const shuffle = (items) => {
    for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
    return items;
  };
  const trials = shuffle(manifest.pairs.map((pair) => ({
    pairId: pair.id, kind: pair.catch ? 'catch' : 'main', flipped: random() < 0.5,
    ...(pair.catch && { expect: pair.expect }),
  })));
  const mains = trials.filter((t) => t.kind === 'main');
  const repeats = shuffle([...mains]).slice(0, Math.max(1, Math.round(mains.length * (manifest.repeatShare ?? 0.25))));
  const catches = manifest.catchTrials ?? Math.max(1, Math.round(manifest.pairs.length * 0.1));
  for (let i = 0; i < catches; i++) {
    const pair = manifest.pairs[Math.floor(random() * manifest.pairs.length)];
    trials.push({ pairId: pair.id, kind: 'catch', generated: true, anchor: random() < 0.5 ? 'a' : 'b', expect: 'a', flipped: random() < 0.5 });
  }
  for (const original of repeats) {
    // A one-pair session uses its generated catch as the separating trial.
    if (trials.at(-1) === original) {
      if (trials.length === 1) throw new Error('A single pair needs a catch trial to separate its repeat');
      trials.unshift(trials.pop());
    }
    trials.push({ pairId: original.pairId, kind: 'repeat', repeatOf: original.pairId, flipped: !original.flipped });
  }
  trials.forEach((t, i) => { t.id = `trial-${i + 1}`; });
  return { seed, trials };
}
function preference(result) {
  return result.release === 'neither' ? 'tie' : result.identity[result.release];
}
export function raterQuality(results) {
  const catches = results.filter((r) => r.trial?.kind === 'catch');
  const passed = catches.filter((r) => {
    const expected = r.trial.expect === 'b' ? (r.trial.flipped ? 'left' : 'right') : (r.trial.flipped ? 'right' : 'left');
    const other = expected === 'left' ? 'right' : 'left';
    return DIMENSIONS.filter((d) => r.ratings[expected][d] > r.ratings[other][d]).length > DIMENSIONS.length / 2 && r.release !== other;
  }).length;
  const repeats = results.filter((r) => r.trial?.kind === 'repeat');
  const comparisons = repeats.flatMap((r) => {
    const original = results.find((o) => o.pairId === r.trial.repeatOf && o.trial?.kind === 'main');
    return original ? [preference(r) === preference(original)] : [];
  });
  const catchPassRate = catches.length ? passed / catches.length : null;
  const repeatConsistency = comparisons.length ? comparisons.filter(Boolean).length / comparisons.length : null;
  const reasons = [];
  // With fewer than three catches require all to pass; otherwise >=2/3. Repeats must agree >=50%.
  if (catches.length && (catches.length < 3 ? passed < catches.length : catchPassRate < 2 / 3)) reasons.push('failed catch threshold');
  if (repeatConsistency !== null && repeatConsistency < 0.5) reasons.push('repeat agreement below 0.5');
  return { catches: catches.length, passed, catchPassRate, repeats: comparisons.length, repeatConsistency, flagged: reasons.length > 0, reasons };
}
export function fitBradleyTerry(comparisons, ids = [...new Set(comparisons.flatMap((c) => [c.a, c.b]))]) {
  if (!ids.length) return {};
  let strengths = Object.fromEntries(ids.map((id) => [id, 1]));
  const wins = Object.fromEntries(ids.map((id) => [id, 0]));
  const games = Object.fromEntries(ids.map((id) => [id, {}]));
  // Symmetric half-win prior on every edge keeps undefeated and disconnected items finite.
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j]; wins[a] += 0.5; wins[b] += 0.5; games[a][b] = games[b][a] = 1;
  }
  for (const { a, b, outcome } of comparisons) {
    if (a === b) continue;
    wins[a] += outcome; wins[b] += 1 - outcome;
    games[a][b] = (games[a][b] || 0) + 1; games[b][a] = (games[b][a] || 0) + 1;
  }
  for (let iteration = 0; iteration < 1000 && ids.length > 1; iteration++) {
    const next = Object.fromEntries(ids.map((a) => [a, wins[a] / Object.entries(games[a]).reduce((sum, [b, n]) => sum + n / (strengths[a] + strengths[b]), 0)]));
    const total = Object.values(next).reduce((a, b) => a + b, 0);
    ids.forEach((id) => { next[id] = next[id] / total * ids.length; });
    const delta = Math.max(...ids.map((id) => Math.abs(next[id] - strengths[id])));
    strengths = next;
    if (delta < 1e-8) break;
  }
  const total = Object.values(strengths).reduce((a, b) => a + b, 0);
  return Object.fromEntries(ids.map((id) => [id, strengths[id] / total]));
}
export function aggregateRatings(exports, manifest = {}, { bootstrap = 200, seed = 'lab-bootstrap', excludeFlagged = true } = {}) {
  const grouped = new Map();
  for (const ex of exports) {
    if (!ex.listenerId) throw new Error('Every export needs a listenerId');
    if (manifest.id && ex.benchmarkId !== manifest.id) throw new Error('Benchmark id mismatch');
    const prior = grouped.get(ex.listenerId);
    if (!prior || ex.results.length >= prior.results.length) grouped.set(ex.listenerId, ex);
  }
  const raters = [...grouped.values()].map((ex) => ({ listenerId: ex.listenerId, quality: raterQuality(ex.results) }));
  const eligible = [...grouped.values()].filter((ex) => !excludeFlagged || !raters.find((r) => r.listenerId === ex.listenerId).quality.flagged);
  // The gate counts only raters who answered a catch and rated real pairs: an empty or partial export proves nothing.
  const qualified = (ex) => { const q = raters.find((r) => r.listenerId === ex.listenerId).quality; return !q.flagged && q.catches > 0 && ex.results.some((r) => r.trial?.kind !== 'catch'); };
  const unflagged = [...grouped.values()].filter(qualified).length;
  const rows = (listeners, dimension) => listeners.flatMap((ex) => ex.results.filter((r) => r.trial?.kind !== 'catch').map((r) => ({
    a: r.identity.left, b: r.identity.right,
    outcome: dimension === 'overall' ? (r.release === 'left' ? 1 : r.release === 'right' ? 0 : 0.5) : (Math.sign(r.ratings.left[dimension] - r.ratings.right[dimension]) + 1) / 2,
  })));
  const random = seededRandom(seed), dimensions = {};
  for (const dimension of [...DIMENSIONS, 'overall']) {
    const data = rows(eligible, dimension), ids = [...new Set(data.flatMap((r) => [r.a, r.b]))].sort();
    const fit = fitBradleyTerry(data, ids), samples = Object.fromEntries(ids.map((id) => [id, []]));
    for (let i = 0; i < bootstrap && eligible.length; i++) {
      const sample = Array.from({ length: eligible.length }, () => eligible[Math.floor(random() * eligible.length)]);
      const values = fitBradleyTerry(rows(sample, dimension), ids);
      ids.forEach((id) => samples[id].push(values[id]));
    }
    dimensions[dimension] = Object.fromEntries(ids.map((id) => {
      const values = samples[id].sort((a, b) => a - b);
      return [id, { strength: fit[id], ci: values.length ? [values[Math.floor(values.length * 0.025)], values[Math.min(values.length - 1, Math.floor(values.length * 0.975))]] : [fit[id], fit[id]] }];
    }));
  }
  const minRaters = manifest.minRaters ?? 5;
  return { status: unflagged >= minRaters ? 'sufficient' : 'insufficient', minRaters, unflaggedRaters: unflagged, includedRaters: eligible.length, bootstrap, seed, raters, dimensions };
}

export function validateBenchmark(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Benchmark must be a JSON object');
  if (!manifest.id || !Array.isArray(manifest.pairs) || !manifest.pairs.length) throw new Error('Benchmark needs an id and at least one pair');
  const pairIds = new Set();
  for (const pair of manifest.pairs) {
    if (!pair.id || pairIds.has(pair.id)) throw new Error('Every pair needs a unique id');
    pairIds.add(pair.id);
    if (pair.catch && !['a', 'b'].includes(pair.expect)) throw new Error('Catch pairs need expect: a or b');
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
  const envelope = [], bands = [];
  let windowEnergy = 0, bandEnergy = [0, 0, 0];
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
    bandEnergy[0] += low * low;
    bandEnergy[1] += mid * mid;
    bandEnergy[2] += high * high;
    if ((i + 1) % window === 0) {
      envelope.push(Math.sqrt(windowEnergy / window));
      bands.push(bandEnergy.map((e) => Math.sqrt(e / window)));
      bandEnergy = [0, 0, 0];
      windowEnergy = 0;
    }
  }
  const rms = Math.sqrt(sum / length);
  // Positive log-envelope flux in three bands detects attacks above sustained bass/pads.
  // A local 300 ms threshold follows density and level instead of requiring a kick to
  // exceed the whole song's median RMS (impossible for many limited dance mixes).
  const flux = bands.map((band, i) => i < 2 ? 0 : Math.max(0, ...band.map((v, k) =>
    Math.log((v + 1e-5) / (bands[i - 2][k] + 1e-5)))));
  const onsets = [];
  for (let i = 2; i < envelope.length - 1; i++) {
    const local = flux.slice(Math.max(0, i - 15), i + 16);
    const threshold = Math.max(0.15, local.reduce((a, b) => a + b, 0) / local.length * 1.5);
    if (flux[i] > threshold && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1] && i - (onsets.at(-1) ?? -10) > 4) onsets.push(i);
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
  // The song's dynamic arc: spread (p90 - p10) of 2-second loudness, over windows with sound in them. Sections that
  // build, drop and break down spread wide; a loop at one level all the way through sits near 0.
  const slow = [];
  for (let i = 0; i + 200 <= envelope.length; i += 200) {
    let e = 0; for (let k = i; k < i + 200; k++) e += envelope[k] * envelope[k];
    const level = db(Math.sqrt(e / 200));
    if (level > -60) slow.push(level);
  }
  slow.sort((a, b) => a - b);
  const arcDb = slow.length >= 3 ? round(slow[Math.floor((slow.length - 1) * 0.9)] - slow[Math.floor((slow.length - 1) * 0.1)], 1) : null;
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
    arcDb,
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
    if (result.trial?.kind === 'catch') continue;
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

// Where a mix's energy sits: the sub (30–60 Hz) a club system moves air with, low bass (60–120 Hz),
// low-mid mud (200–500 Hz) and the 2–5 kHz presence band where leads turn harsh. Levels are dBFS RMS
// of the content inside each band; shares are fractions of the 20 Hz–Nyquist energy.
export const BANDS = { sub: [30, 60], low: [60, 120], mud: [200, 500], harsh: [2000, 5000] };

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

export function spectralBands(channels, sampleRate, { size = 8192 } = {}) {
  const length = Math.min(...channels.map((channel) => channel.length));
  const half = size / 2, power = new Float64Array(half), win = new Float64Array(size);
  let winPower = 0;
  for (let i = 0; i < size; i++) { win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size); winPower += win[i] * win[i]; }
  const re = new Float64Array(size), im = new Float64Array(size);
  let frames = 0;
  for (let start = 0; start < length || !frames; start += half) {
    for (let i = 0; i < size; i++) {
      let s = 0;
      if (start + i < length) for (const channel of channels) s += channel[start + i] / channels.length;
      re[i] = s * win[i]; im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < half; k++) power[k] += (2 * (re[k] * re[k] + im[k] * im[k])) / (size * winPower);
    frames++;
    if (start + size >= length) break;
  }
  const hz = sampleRate / size, sum = (lo, hi) => {
    let e = 0;
    for (let k = Math.ceil(lo / hz); k < Math.min(half, Math.ceil(hi / hz)); k++) e += power[k];
    return e / frames;
  };
  const total = Math.max(1e-20, sum(20, sampleRate / 2)), out = { totalDb: round(10 * Math.log10(total), 1) };
  for (const [name, [lo, hi]] of Object.entries(BANDS)) {
    const e = sum(lo, hi);
    out[`${name}Db`] = round(10 * Math.log10(Math.max(e, 1e-20)), 1);
    out[`${name}Share`] = round(e / total);
  }
  return out;
}

// ITU-R BS.1770 K-weighting (high shelf + low cut), so levels compare the way ears hear them.
function biquad(x, b0, b1, b2, a0, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
export function kWeight(x, sampleRate) {
  let w = (2 * Math.PI * 1681.974450955533) / sampleRate, A = Math.pow(10, 3.999843853973347 / 40), al = Math.sin(w) / (2 * 0.7071752369554196), c = Math.cos(w), r = 2 * Math.sqrt(A) * al;
  const s = biquad(x, A * (A + 1 + (A - 1) * c + r), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - r), A + 1 - (A - 1) * c + r, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - r);
  w = (2 * Math.PI * 38.13547087602444) / sampleRate; al = Math.sin(w) / (2 * 0.5003270373238773); c = Math.cos(w);
  return biquad(s, (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
}
// Integrated loudness without gating (fine for comparing renders of the same length).
export function lufs(channels, sampleRate) {
  let e = 0, n = 0;
  for (const ch of channels) { const k = kWeight(ch, sampleRate); for (let i = 0; i < k.length; i++) e += k[i] * k[i]; n = k.length; }
  return -0.691 + 10 * Math.log10(e / Math.max(1, n) + 1e-20);
}

const fin = (v, p = 3) => (Number.isFinite(v) ? round(v, p) : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2 : null; };
export const DIMENSIONS = ['musicality', 'originality', 'genre accuracy', 'emotional pull'];
// Reference-free songwriting metrics a benchmark manifest can carry per pair: [key, label, unit, meaning].
export const SONGWRITING = [
  ['secs', 'Length', 's', 'Song length, ring-out trimmed.'],
  ['sections', 'Sections', '', 'Runs of one pattern letter in the song chain: intro, build, drop, breakdown...'],
  ['distinctSections', 'Distinct sections', '', 'How many different section patterns the song moves through.'],
  ['melodyWindows', 'Melody variants', '', 'Distinct two-bar hook windows (composition scorecard).'],
  ['motifRecall', 'Motif recall', 'share', 'Share of hook windows that still carry the main motif\'s rhythm (composition scorecard).'],
  ['chords', 'Chords', '', 'Distinct chords the song plays over (composition scorecard).'],
  ['voiceMove', 'Voice movement', 'st', 'Mean semitones each chord voice travels; lower is smoother (composition scorecard).'],
  ['contrast', 'Section contrast', 'cv', 'Coefficient of variation of events per bar across the song (composition scorecard).'],
  ['pitchClasses', 'Pitch classes', '', 'Distinct pitch classes across the melodic parts.'],
  ['leadRange', 'Lead range', 'st', 'Span of the highest melodic part, in semitones.'],
  ['partsPerBar', 'Parts per bar', '', 'Median number of parts playing in a bar.'],
  ['arcDb', 'Dynamic arc', 'dB', 'p90 - p10 of 2-second loudness: how far the song builds and drops (lab metrics).'],
];

// Lab exports of an OURS-vs-THEIRS benchmark (scripts/suno-benchmark.mjs) -> win rates. A dimension is a win for UNTERGRUND when it rates higher than Suno on that pair (a tie
// is half a win); replay/release picks count who was picked, with "neither" kept separate.
export function versusScorecard(exports, manifest = null, { ours: OURS, theirs: THEIRS }) {
  const meta = new Map((manifest?.pairs || []).map((p) => [p.id, p]));
  const rows = [];
  for (const ex of exports) for (const res of ex.results || []) {
    if (res.trial?.kind === 'catch') continue;
    const side = Object.entries(res.identity || {}).find(([, id]) => id === OURS)?.[0], other = side === 'left' ? 'right' : 'left';
    if (!side || res.identity[other] !== THEIRS) continue;
    const m = meta.get(res.pairId) || {};
    const pick = (v) => (v === side ? 'ours' : v === other ? 'theirs' : 'neither');
    rows.push({ id: res.pairId, genre: res.genre || m.genre || 'OTHER', style: res.style || m.style, seed: res.seed ?? m.seed, ours: res.ratings[side], theirs: res.ratings[other],
      replay: pick(res.replay), release: pick(res.release), audio: { ours: res.metrics?.[side] || null, theirs: res.metrics?.[other] || null } });
  }
  const tally = (rs) => {
    const dims = Object.fromEntries(DIMENSIONS.map((d) => {
      const w = rs.map((x) => Math.sign(x.ours[d] - x.theirs[d])).filter(Number.isFinite);
      return [d, { winRate: w.length ? fin(mean(w.map((v) => (v + 1) / 2))) : null, wins: w.filter((v) => v > 0).length, ties: w.filter((v) => v === 0).length, losses: w.filter((v) => v < 0).length,
        ours: fin(mean(rs.map((x) => x.ours[d]).filter(Number.isFinite)), 2), theirs: fin(mean(rs.map((x) => x.theirs[d]).filter(Number.isFinite)), 2) }];
    }));
    const picks = (k) => ({ ours: rs.filter((x) => x[k] === 'ours').length, theirs: rs.filter((x) => x[k] === 'theirs').length, neither: rs.filter((x) => x[k] === 'neither').length, oursRate: rs.length ? fin(rs.filter((x) => x[k] === 'ours').length / rs.length) : null });
    const rates = Object.values(dims).map((d) => d.winRate).filter(Number.isFinite);
    return { ratings: rs.length, winRate: rates.length ? fin(mean(rates)) : null, dimensions: dims, replay: picks('replay'), release: picks('release') };
  };
  const genres = {};
  for (const g of [...new Set(rows.map((x) => x.genre))]) genres[g] = tally(rows.filter((x) => x.genre === g));
  const prompts = [...new Set(rows.map((x) => x.id))].map((id) => {
    const rs = rows.filter((x) => x.id === id), t = tally(rs), m = meta.get(id) || {};
    const audio = (k) => { const xs = rs.map((x) => x.audio[k]).filter(Boolean); return xs.length ? Object.fromEntries(['lufs', 'rmsDb', 'crestDb', 'arcDb', 'duration'].map((f) => [f, fin(median(xs.map((a) => a[f])), 2)])) : null; };
    return { id, title: m.title || id, genre: rs[0].genre, style: rs[0].style, seed: rs[0].seed, ratings: rs.length, winRate: t.winRate,
      dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, { ours: t.dimensions[d].ours, theirs: t.dimensions[d].theirs }])), replay: t.replay, release: t.release,
      songwriting: m.songwriting || null, audio: { ours: audio('ours'), theirs: audio('theirs') } };
  });
  const sw = Object.fromEntries(SONGWRITING.map(([k]) => [k, fin(median(prompts.map((p) => p.songwriting?.[k])), 3)]));
  return { schema: 'untergrund.lab-versus/1', ours: OURS, theirs: THEIRS, generated: new Date().toISOString(), commit: manifest?.commit ?? null, listeners: exports.length, prompts: prompts.length, overall: tally(rows), genres, songwritingMedian: sw, songwritingKeys: SONGWRITING.map(([k, label, unit, why]) => ({ k, label, unit, why })), pairs: prompts };
}
