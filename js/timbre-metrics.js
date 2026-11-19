import { fft, seededRandom } from './lab-metrics.js';

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)];
export const ROLES = {
  bass: ['acid', 'cb'], chords: ['stab'], lead: ['hook'],
  drums: ['kick', 'snare', 'clap', 'ch', 'oh', 'ride', 'perc', 'timp'],
  strings: ['vln1', 'vln2', 'vla', 'vc'], winds: ['fl', 'ob', 'cl', 'hn', 'tpt'], keys: ['pno', 'harp'],
};

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
  if (rms < 1e-6) return missing('silent stem');
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
  for (const note of notes) {
    const start = Math.max(0, Math.round(note.t / 0.005)), end = Math.round((note.t + note.dur) / 0.005);
    const next = notes.find((x) => x.t > note.t + 0.01)?.t ?? n / fs;
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
  if (envelopes.length < 2) return { ...missing('fewer than two isolated, uncensored note envelopes'), spectrum, centroid, rolloff };
  const envelope = [0, 1, 2].map((i) => quantile(envelopes.map((v) => v[i]), 0.5));
  const flatness = Math.exp(logPower / (half - 1)) * (half - 1);
  return { status: 'MEASURED', spectrum, centroid, flatness, rolloff, envelope, envelopes: envelopes.length,
    vector: [...spectrum, Math.log1p(centroid), flatness, Math.log1p(rolloff), ...envelope.map(Math.log1p)] };
}

export function rankTimbres(rows, { bootstrap = 300 } = {}) {
  const styles = [...new Set(rows.map((r) => r.style))], roles = Object.keys(ROLES), random = seededRandom('timbre-bootstrap-v1');
  const scales = Object.fromEntries(roles.map((role) => {
    const vs = rows.map((r) => r.roles[role]?.vector).filter(Boolean);
    return [role, vs.length ? vs[0].map((_, k) => { const m = mean(vs.map((v) => v[k])); return Math.max(0.05, Math.sqrt(mean(vs.map((v) => (v[k] - m) ** 2)))); }) : []];
  }));
  const pairs = [];
  for (let i = 0; i < styles.length; i++) for (let j = i + 1; j < styles.length; j++) {
    const a = styles[i], b = styles[j], breakdown = {};
    for (const role of roles) {
      const ar = rows.filter((r) => r.style === a), br = rows.filter((r) => r.style === b);
      const A = ar.map((r) => r.roles[role]?.vector), B = br.map((r) => r.roles[role]?.vector);
      const unavailable = [...ar, ...br].map((r) => r.roles[role]).find((v) => !v?.vector);
      if (A.length < 3 || B.length < 3 || A.some((v) => !v) || B.some((v) => !v)) { breakdown[role] = { status: 'UNMEASURED', reason: unavailable?.reason || 'missing role or fewer than three seeds', distance: null, similarity: null }; continue; }
      const d = (x, y) => Math.sqrt(mean(x.map((v, k) => ((v - y[k]) / scales[role][k]) ** 2)));
      const between = mean(A.flatMap((x) => B.map((y) => d(x, y))));
      const within = [...A.flatMap((x, k) => A.slice(k + 1).map((y) => d(x, y))), ...B.flatMap((x, k) => B.slice(k + 1).map((y) => d(x, y)))];
      const gaps = [];
      for (let t = 0; t < bootstrap; t++) {
        const sa = A.map(() => A[Math.floor(random() * A.length)]), sb = B.map(() => B[Math.floor(random() * B.length)]);
        const noise = mean(within.map(() => within[Math.floor(random() * within.length)]));
        gaps.push(mean(sa.flatMap((x) => sb.map((y) => d(x, y)))) - noise);
      }
      const ci = [quantile(gaps, 0.025), quantile(gaps, 0.975)];
      breakdown[role] = ci[0] > 0 ? { status: 'MEASURED', distance: between, similarity: 1 / (1 + between), gapCI: ci, noise: mean(within) } : { status: 'UNMEASURED', reason: 'between-genre distance not separable from seed spread', distance: null, similarity: null, gapCI: ci };
    }
    const measured = Object.entries(breakdown).filter(([, v]) => v.status === 'MEASURED').sort((a, b) => b[1].similarity - a[1].similarity);
    const complete = measured.length === roles.length;
    pairs.push({ a, b, status: complete ? 'MEASURED' : 'UNMEASURED', similarity: complete ? mean(measured.map(([, v]) => v.similarity)) : null,
      partialSimilarity: measured.length ? mean(measured.map(([, v]) => v.similarity)) : null, measuredRoles: measured.length, drivingRole: measured[0]?.[0] ?? null, roles: breakdown });
  }
  pairs.sort((a, b) => (b.partialSimilarity ?? -1) - (a.partialSimilarity ?? -1));
  const nearest = styles.map((style) => ({ style, neighbour: pairs.find((p) => (p.a === style || p.b === style) && p.status === 'MEASURED') ?? null, status: pairs.some((p) => (p.a === style || p.b === style) && p.status === 'MEASURED') ? 'MEASURED' : 'UNMEASURED', partialCandidate: pairs.find((p) => (p.a === style || p.b === style) && p.partialSimilarity !== null) ?? null }));
  return { pairs, nearest };
}
