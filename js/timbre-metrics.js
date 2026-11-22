import { fft, seededRandom } from './lab-metrics.js';

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)];
export const ROLES = {
  bass: ['acid', 'cb'], chords: ['stab', 'pno', 'harp'], lead: ['hook', 'fl', 'ob', 'cl', 'hn', 'tpt'],
  drums: ['kick', 'snare', 'clap', 'ch', 'oh', 'ride', 'perc', 'timp'],
  pad: ['vln1', 'vln2', 'vla', 'vc'],
};
export const MELODIC = ['bass', 'chords', 'lead', 'pad'];
export const MAX_CI_WIDTH = 0.25;

export function timbreFeatures(channels, fs, notes = []) {
  const missing = (reason) => ({ status: 'UNMEASURED', reason, vector: null });
  if (!channels.length || !channels[0].length) return missing('missing stem');
  const n = Math.min(...channels.map((c) => c.length)), mono = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    for (const c of channels) mono[i] += c[i] / channels.length;
    if (!Number.isFinite(mono[i])) return missing('non-finite PCM');
    energy += mono[i] ** 2;
  }
  const rms = Math.sqrt(energy / n);
  if (rms < 1e-6) return { status: 'ABSENT', reason: 'silent stem', vector: null };
  const size = 2048, half = size / 2, power = new Float64Array(half), re = new Float64Array(size), im = new Float64Array(size);
  let frames = 0;
  for (let start = 0; start + size <= n; start += Math.max(half, Math.floor(n / 160 / half) * half)) {
    let e = 0;
    for (let i = 0; i < size; i++) { re[i] = mono[start + i] / rms * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / size)); im[i] = 0; e += re[i] ** 2; }
    if (e < 1e-8) continue;
    fft(re, im); frames++;
    for (let k = 1; k < half; k++) power[k] += re[k] ** 2 + im[k] ** 2;
  }
  if (!frames) return missing('no spectral frames');
  const total = power.reduce((a, b) => a + b, 0), mel = (hz) => 2595 * Math.log10(1 + hz / 700), bands = new Array(24).fill(0);
  let centroid = 0, logPower = 0, cumulative = 0, rolloff = 0;
  for (let k = 1; k < half; k++) {
    const p = power[k] / total, hz = k * fs / size;
    bands[Math.min(23, Math.floor(mel(hz) / mel(fs / 2) * 24))] += p;
    centroid += hz * p; logPower += Math.log(Math.max(1e-15, p)); cumulative += p;
    if (!rolloff && cumulative >= 0.85) rolloff = hz;
  }
  const spectrum = bands.map((p) => Math.log(Math.max(1e-8, p)));
  const hop = Math.max(1, Math.round(fs * 0.005)), env = [];
  for (let i = 0; i + hop <= n; i += hop) { let e = 0; for (let j = i; j < i + hop; j++) e += mono[j] ** 2; env.push(Math.sqrt(e / hop)); }
  const envelopes = [];
  const events = notes.filter((note, i) => !i || note.t - notes[i - 1].t > 0.01);
  for (const note of events) {
    if (notes.some((earlier) => earlier.t < note.t - 0.01 && earlier.t + earlier.dur + 0.1 > note.t)) continue;
    const start = Math.max(0, Math.round(note.t / 0.005)), end = Math.round((note.t + note.dur) / 0.005);
    const next = events.find((x) => x.t > note.t + 0.01)?.t ?? n / fs;
    if (next < note.t + note.dur + 0.1 || end + 20 >= env.length || end - start < 4) continue;
    const seg = env.slice(start, end), peak = Math.max(...seg);
    if (peak < rms * 0.05) continue;
    const peakAt = seg.indexOf(peak), attack = seg.findIndex((v) => v >= peak * 0.9);
    const sustain = mean(seg.slice(Math.floor(seg.length * 0.6))) / peak;
    const decay = mean(seg.slice(peakAt, Math.max(peakAt + 1, Math.floor(seg.length * 0.4)))) / peak;
    let release = null;
    for (let j = end; j < Math.min(env.length, Math.floor(next / 0.005)); j++) if (env[j] < peak * 0.1) { release = (j - end) * 0.005; break; }
    if (release !== null) envelopes.push([attack * 0.005, decay / Math.max(0.01, sustain), release]);
  }
  const envelope = envelopes.length >= 2 ? [0, 1, 2].map((i) => quantile(envelopes.map((v) => v[i]), 0.5)) : null;
  const flatness = Math.exp(logPower / (half - 1)) * (half - 1);
  return { status: 'MEASURED', spectrum, centroid, flatness, rolloff, envelope, envelopes: envelopes.length,
    envelopeStatus: envelope ? 'MEASURED' : 'UNMEASURED', envelopeReason: envelope ? null : 'fewer than two isolated, uncensored note envelopes',
    vector: [...spectrum, Math.log1p(centroid), flatness, Math.log1p(rolloff)], envelopeVector: envelope?.map(Math.log1p) ?? null };
}

export function rankTimbres(rows, { bootstrap = 500, maxCIWidth = MAX_CI_WIDTH } = {}) {
  if (bootstrap < 100 || !Number.isInteger(bootstrap) || !(maxCIWidth > 0 && maxCIWidth <= 1)) throw new Error('Need >=100 bootstrap replicates and CI width in (0,1]');
  const styles = [...new Set(rows.map((r) => r.style))], roles = Object.keys(ROLES);
  const scaleFor = (role, key) => {
    const vs = rows.map((r) => r.roles[role]?.[key]).filter(Boolean);
    return vs.length ? vs[0].map((_, k) => { const m = mean(vs.map((v) => v[k])); return Math.max(0.05, Math.sqrt(mean(vs.map((v) => (v[k] - m) ** 2)))); }) : [];
  };
  const scales = Object.fromEntries(roles.map((role) => [role, { spectrum: scaleFor(role, 'vector'), envelope: scaleFor(role, 'envelopeVector') }]));
  const interval = (xs) => [quantile(xs, 0.025), quantile(xs, 0.975)];
  const unavailable = (reason, extra = {}) => ({ status: 'UNMEASURED', reason, similarity: null, ci: null, ...extra });
  const absent = (v) => v?.status === 'ABSENT';
  const valid = (v) => absent(v) || v?.status === 'MEASURED' && v.vector?.every(Number.isFinite);
  const pairs = [];
  for (let i = 0; i < styles.length; i++) for (let j = i + 1; j < styles.length; j++) {
    const a = styles[i], b = styles[j], breakdown = {}, samples = {};
    const ar = rows.filter((r) => r.style === a), br = rows.filter((r) => r.style === b);
    const random = seededRandom(`timbre-bootstrap-v2:${[a, b].sort().join(':')}`);
    const draws = Array.from({ length: bootstrap }, () => [ar.map(() => Math.floor(random() * ar.length)), br.map(() => Math.floor(random() * br.length))]);
    for (const role of roles) {
      const A = ar.map((r) => r.roles[role]), B = br.map((r) => r.roles[role]);
      if (A.length < 3 || B.length < 3 || [...A, ...B].some((v) => !valid(v))) {
        breakdown[role] = unavailable('missing/invalid measurement or fewer than three seeds'); continue;
      }
      const active = [A.filter((v) => !absent(v)).length, B.filter((v) => !absent(v)).length];
      if (active.every((n) => !n)) { breakdown[role] = { status: 'SKIPPED', reason: 'absent in both genres', similarity: null, ci: null, activeSeeds: active }; continue; }
      if (active.some((n) => !n)) {
        breakdown[role] = { status: 'MEASURED', reason: 'present in one genre only: maximal difference', similarity: 0, ci: [0, 0], shared: false, activeSeeds: active };
        samples[role] = draws.map(() => 0); continue;
      }
      const d = (x, y) => {
        const dist = (v, w, scale) => mean(v.map((n, k) => ((n - w[k]) / scale[k]) ** 2));
        const spectrum = dist(x.vector, y.vector, scales[role].spectrum);
        return Math.sqrt(x.envelopeVector && y.envelopeVector ? 0.75 * spectrum + 0.25 * dist(x.envelopeVector, y.envelopeVector, scales[role].envelope) : spectrum);
      };
      const sim = (x, y) => absent(x) && absent(y) ? 1 : absent(x) || absent(y) ? 0 : 1 / (1 + d(x, y));
      const matrix = A.map((x) => B.map((y) => sim(x, y)));
      const estimates = draws.map(([sa, sb]) => mean(sa.flatMap((x) => sb.map((y) => matrix[x][y]))));
      const ci = interval(estimates), similarity = mean(matrix.flat());
      const within = [A, B].map((group) => {
        const vs = group.filter((v) => !absent(v));
        return vs.length >= 2 ? mean(vs.flatMap((x, k) => vs.slice(k + 1).map((y) => d(x, y)))) : null;
      });
      const metadata = { ci, activeSeeds: active, withinDistance: within, envelopePairs: A.reduce((s, x) => s + B.filter((y) => x.envelopeVector && y.envelopeVector).length, 0) };
      if (ci[1] - ci[0] > maxCIWidth) { breakdown[role] = unavailable('95% similarity CI too wide', metadata); continue; }
      breakdown[role] = { status: 'MEASURED', similarity, shared: true, ...metadata };
      samples[role] = estimates;
    }
    const measured = roles.filter((role) => breakdown[role].status === 'MEASURED');
    const sharedMelodic = MELODIC.filter((role) => breakdown[role].status === 'MEASURED' && breakdown[role].shared);
    const combine = (want) => {
      if (sharedMelodic.length < 2) return unavailable('fewer than two shared measurable melodic roles');
      const selected = measured.filter((r) => want.includes(r)), weight = (r) => r === 'drums' ? 1 : 3;
      const total = selected.reduce((s, r) => s + weight(r), 0);
      const average = (get) => selected.reduce((s, r) => s + weight(r) * get(r), 0) / total;
      const ci = interval(draws.map((_, t) => average((r) => samples[r][t])));
      if (ci[1] - ci[0] > maxCIWidth) return unavailable('95% similarity CI too wide', { ci });
      const driver = [...selected].sort((x, y) => weight(y) * breakdown[y].similarity - weight(x) * breakdown[x].similarity)[0];
      return { status: 'MEASURED', similarity: average((r) => breakdown[r].similarity), ci, drivingRole: driver, includedRoles: selected };
    };
    pairs.push({ a, b, ...combine(roles), sharedMelodic, measuredRoles: measured.length,
      excludedRoles: roles.filter((r) => breakdown[r].status === 'UNMEASURED'), melodic: combine(MELODIC), roles: breakdown });
  }
  pairs.sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1));
  const melodicRanking = pairs.filter((p) => p.melodic.status === 'MEASURED').map((p) => ({ a: p.a, b: p.b, ...p.melodic })).sort((a, b) => b.similarity - a.similarity);
  const nearest = styles.map((style) => ({ style, neighbours: pairs.filter((p) => (p.a === style || p.b === style) && p.status === 'MEASURED').slice(0, 3).map((p) => ({ style: p.a === style ? p.b : p.a, similarity: p.similarity, ci: p.ci, drivingRole: p.drivingRole })) }));
  return { pairs, melodicRanking, nearest };
}
