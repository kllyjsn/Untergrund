// Rendered-audio quality benchmark: renders fixed seeds of every style through the real offline engine in headless
// Chrome (test/audio-quality-page.js), measures the master and the pre-master stems (js/audio-quality.js), gates the
// worst seed of every style against absolute guardrails and the checked-in baseline, and writes one JSON report.
// A regression guard, not a taste score: see docs/audio-benchmark.md for what each check can and cannot tell you.
//   node scripts/audio-benchmark.mjs [--tier fast|deep] [--assert] [--quiet] [--styles a,b] [--seeds 1,2] [--pages 4]
//                                    [--json out.json] [--write-baseline] [--pack dir [--pack-from report.json]] [--compare a.json b.json]
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { withChrome } from '../test/chrome.mjs';
import { STYLES } from '../js/state.js';
import { targetFor, LOUDNESS_TARGET } from '../js/loudness.js';

export const SCHEMA = 'untergrund.audio-benchmark/1';
export const SEEDS = { fast: [42], deep: [11, 42, 1234] };
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselineFile = (tier) => join(ROOT, `test/audio-baseline/${tier}.json`);
const LEVEL = { PASS: 0, WARN: 1, FAIL: 2 }, worse = (a, b) => (LEVEL[b] > LEVEL[a] ? b : a);
// Styles that end on a long pad, reverb or delay fade by design.
export const LONG_TAIL = ['ambient', 'dub'];
const classical = (style) => targetFor(style) === LOUDNESS_TARGET.classical;
const r = (v, p = 2) => (Number.isFinite(v) ? +v.toFixed(p) : null);
const pct = (xs, q) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.round((a.length - 1) * q))] : null; };
const stem = (x, id) => x.stems.stems.find((s) => s.id === id);

// Every check: what it reads from one seed's measurement (null = not applicable), which way is worse ('high' / 'low'),
// absolute guardrails (warn / fail, null = none), the baseline drift that is worth a WARN (3x drift = FAIL), and the
// repeat tolerance (two runs of the same commit must agree within it; Chrome renders aren't bit-identical).
// peakOverBreak's excuse: the drop lands by density rather than level.
function denseDrop(x) {
  const a = x.mix.arrangement, n = a?.peakOverBreakdownNotes, v = a?.peakOverBreakdownVoices;
  return n >= 1.25 && v >= 1 ? `drop plays ${n}x the onsets per bar and ${v >= 0 ? '+' : ''}${v} parts per bar of the breakdowns` : null;
}

// [warn, fail, drift, repeat] for the over-limiting checks; calibrated on main (docs/audio-benchmark.md).
// On main every club style's clipper shaves at most ~2 dB off its loudest peaks; DEEP HOUSE / AMAPIANO (clean by ear)
// reach 2% of frames over 1 dB, 11% over full scale and a 6.3 dB crest.
const CAL = { clipperShare: [0.05, 0.25, 0.03, 0.01], clipperDepth: [3, 6, 0.75, 0.2], hardClip: [0.25, 0.5, 0.06, 0.02], limiterOver6: [0.05, 0.2, 0.03, 0.01], crest: [6, 3.5, 1, 0.3] };

export const CHECKS = [
  { id: 'truePeak', group: 'peaks', label: 'True peak', unit: 'dBTP', bad: 'high', warn: -0.9, fail: 0, drift: 0.5, repeat: 0.3, get: (x) => x.mix.peak.truePeakDb, why: '4x-oversampled peak (BS.1770); the master limiter ceiling is -1 dBTP, above 0 dBTP a lossy encode or DAC clips.' },
  { id: 'clipRuns', group: 'peaks', label: 'Clipped runs', unit: 'count', bad: 'high', warn: null, fail: 0.5, drift: null, repeat: 0, get: (x) => x.mix.peak.clipRuns, why: 'Runs of 2+ consecutive samples at or above 0.999 full scale.' },
  { id: 'dcOffset', group: 'peaks', label: 'DC offset', unit: 'dBFS', bad: 'high', warn: -40, fail: -30, drift: null, repeat: 3, get: (x) => Math.max(-80, x.mix.peak.dcDb), why: 'Mean sample value, floored at -80 dBFS (below that it is rounding noise, not DC); DC wastes headroom and thumps on start/stop.' },
  { id: 'loudnessTarget', group: 'loudness', label: 'Integrated loudness vs target', unit: 'LU', bad: 'high', warn: 1.5, fail: 3, drift: 0.75, repeat: 0.1, tiers: ['deep'], get: (x) => Math.abs(x.mix.loudness.deltaTarget), why: 'Whole-song BS.1770 integrated loudness against the style target in js/loudness.js (-10 club / -14 quiet / -16 classical).' },
  { id: 'windowLufs', group: 'loudness', label: 'Densest-window loudness', unit: 'LUFS', bad: 'high', warn: null, fail: null, drift: 1, repeat: 0.1, tiers: ['fast'], get: (x) => x.mix.loudness.integrated, why: 'Loudness of the two densest bars; only gated as drift from baseline (the integrated target is a deep-tier check).' },
  { id: 'lra', group: 'loudness', label: 'Loudness range', unit: 'LU', bad: 'high', warn: 15, fail: 20, drift: 2, repeat: 0.3, tiers: ['deep'], applies: (s) => !classical(s), get: (x) => x.mix.loudness.lra, why: 'EBU Tech 3342 LRA of the whole song; very large values mean sections a listener has to ride the volume for. Club/pop styles only.' },
  { id: 'lraClassical', group: 'loudness', label: 'Loudness range (classical)', unit: 'LU', bad: 'high', warn: 22, fail: 28, drift: 2, repeat: 0.3, tiers: ['deep'], applies: classical, get: (x) => x.mix.loudness.lra, why: 'The same LRA for the classical styles, where 15-25 LU is normal for concert recordings (EBU R128 s1); only beyond that is the piece unlistenable without riding the volume.' },
  { id: 'limiterStrain', group: 'loudness', label: 'Limiter strain', unit: 'share', bad: 'high', warn: 0.05, fail: 0.2, drift: 0.03, repeat: 0.01, get: (x) => x.mix.limiter.strainShare, why: 'Share of 10 ms frames where the master limiter takes more than 3 dB (squashed transients, pumping).' },
  { id: 'limiterDeep', group: 'loudness', label: 'Deepest gain reduction (1st pct)', unit: 'dB', bad: 'low', warn: -6, fail: -10, drift: 1.5, repeat: 0.4, get: (x) => x.mix.limiter.grP1, why: 'Gain reduction exceeded in 1% of frames.' },
  { id: 'limiterJump', group: 'loudness', label: 'Gain-reduction jump (p99)', unit: 'dB/10ms', bad: 'high', warn: 3, fail: 6, drift: 1, repeat: 0.3, get: (x) => x.mix.limiter.grJumpP99, why: 'Frame-to-frame change in limiter gain; fast big swings are audible as distortion or pumping.' },
  { id: 'clipperShare', group: 'loudness', label: 'Clipper shaving > 1 dB', unit: 'share', bad: 'high', warn: CAL.clipperShare[0], fail: CAL.clipperShare[1], drift: CAL.clipperShare[2], repeat: CAL.clipperShare[3], get: (x) => x.mix.clipper?.share1Db ?? null, why: 'Share of 10 ms frames of music where the master clipper (soft knee at 0.88, ceiling 0.98, after the limiter) takes more than 1 dB off a peak, measured on its input from the raw render (before any normalization). Occasional shaved transients are inaudible; sustained shaving is audible distortion.' },
  { id: 'clipperDepth', group: 'loudness', label: 'Clipper peak shave (p99 of frames)', unit: 'dB', bad: 'high', warn: CAL.clipperDepth[0], fail: CAL.clipperDepth[1], drift: CAL.clipperDepth[2], repeat: CAL.clipperDepth[3], get: (x) => x.mix.clipper?.shaveP99Db ?? null, why: 'How far the clipper cuts the loudest 1% of frames, in dB off the peak.' },
  { id: 'hardClip', group: 'peaks', label: 'Clipper input over full scale', unit: 'share', bad: 'high', warn: CAL.hardClip[0], fail: CAL.hardClip[1], drift: CAL.hardClip[2], repeat: CAL.hardClip[3], get: (x) => x.mix.clipper?.hardShare ?? null, why: 'Share of 10 ms frames where the clipper input reaches full scale, past the end of its curve: the WaveShaper clamps there, a flat-topped hard clip regardless of the soft knee.' },
  { id: 'saturatorDepth', group: 'loudness', label: 'Bus saturator peak compression (p99 of frames)', unit: 'dB', bad: 'high', warn: null, fail: null, drift: 1, repeat: 0.3, get: (x) => x.mix.saturator?.shaveP99Db ?? null, why: 'How much the master bus saturator (tanh, the style\'s DRIVE) compresses the loudest 1% of frames below its small-signal gain. Drive is a sound-design choice, so this is gated only as drift from baseline; the clipper checks catch overs.' },
  { id: 'limiterOver6', group: 'loudness', label: 'Limiter over 6 dB', unit: 'share', bad: 'high', warn: CAL.limiterOver6[0], fail: CAL.limiterOver6[1], drift: CAL.limiterOver6[2], repeat: CAL.limiterOver6[3], get: (x) => x.mix.limiter?.over6Share ?? null, why: 'Share of 10 ms frames where the master limiter takes more than 6 dB (absolute, its fixed make-up gain removed).' },
  { id: 'crest', group: 'loudness', label: 'Crest factor (p10 of bars)', unit: 'dB', bad: 'low', warn: CAL.crest[0], fail: CAL.crest[1], drift: CAL.crest[2], repeat: CAL.crest[3], get: (x) => x.mix.crest?.p10Db ?? null, why: 'Sample peak over RMS per bar (bars within 10 LU of the loudest), 10th percentile: the most squashed bars. Mastered club music sits around 8-12 dB; under ~6 dB the transients are flattened.' },
  { id: 'tiltBright', group: 'spectrum', label: 'Spectral tilt (too bright)', unit: 'dB/oct', bad: 'high', warn: -0.5, fail: 1.5, drift: 1, repeat: 0.15, get: (x) => x.mix.spectrum.tilt, why: 'Slope of octave-band energy 63 Hz-16 kHz (pink noise = 0). Mixed music sits well below 0; near or above 0 reads as thin and bright.' },
  { id: 'tiltDark', group: 'spectrum', label: 'Spectral tilt (too dark)', unit: 'dB/oct', bad: 'low', warn: -10, fail: -13, drift: 1, repeat: 0.15, get: (x) => x.mix.spectrum.tilt, why: 'Same slope from the other side: steeper than -10 dB/oct is a muffled, blanket-over-the-speaker mix.' },
  { id: 'mud', group: 'spectrum', label: 'Low-mid build-up (200-500 Hz)', unit: 'dB', bad: 'high', warn: 6, fail: 9, drift: 2, repeat: 0.5, get: (x) => x.mix.spectrum.mudBumpDb, why: 'Per-octave energy of 200-500 Hz over the louder of its neighbours (60-200 Hz, 500 Hz-2 kHz). Low mids standing well above both the bass and the mids sound boxy and muddy.' },
  { id: 'harsh', group: 'spectrum', label: 'Presence vs mids (2-5 kHz)', unit: 'dB', bad: 'high', warn: 2, fail: 5, drift: 2, repeat: 0.5, get: (x) => x.mix.spectrum.harshBumpDb, why: 'Per-octave energy of 2-5 kHz over 500 Hz-2 kHz. The ear is most sensitive at 2-5 kHz; when it carries more energy per octave than the mids the mix is harsh and fatiguing.' },
  { id: 'subShare', group: 'spectrum', label: 'Sub share (20-60 Hz)', unit: 'share', bad: 'low', warn: null, fail: null, drift: 0.08, repeat: 0.02, get: (x) => x.mix.spectrum.shares.sub, why: 'Share of energy below 60 Hz; style-dependent, so only gated as drift from baseline.' },
  { id: 'monoLoss', group: 'stereo', label: 'Mono fold-down loss', unit: 'LU', bad: 'low', warn: -1.5, fail: -3, drift: 0.5, repeat: 0.1, get: (x) => x.mix.stereo.monoLossLu, why: 'Loudness change when L and R are summed to mono (phone speakers, club mono-sum); big losses mean phase cancellation.' },
  { id: 'correlation', group: 'stereo', label: 'L/R correlation (5th pct of 400 ms blocks)', unit: 'r', bad: 'low', warn: -0.4, fail: -0.7, drift: 0.2, repeat: 0.03, get: (x) => x.mix.stereo.correlationP5, why: 'Phase correlation of loud blocks. Wide reverb and pads sit near 0 (fine: -3 dB in mono); strongly negative blocks lose 6+ dB or vanish when summed to mono.' },
  { id: 'lowSide', group: 'stereo', label: 'Side energy under 120 Hz', unit: 'dB', bad: 'high', warn: -15, fail: -8, drift: 4, repeat: 1, applies: (s) => !classical(s), get: (x) => x.mix.stereo.lowSideDb, why: 'Bass width relative to bass mono; club rigs and vinyl want mono lows. Not applied to orchestral seating.' },
  { id: 'kickBass', group: 'balance', label: 'Bass under the kick (p90)', unit: 'dB', bad: 'high', warn: 0, fail: 6, drift: 3, repeat: 1, get: (x) => x.stems.kickBass?.collisionP90Db ?? null, why: 'Bass-stem energy under 120 Hz in the 60 ms after each kick, relative to the kick: high means the two fight instead of ducking or interlocking.' },
  { id: 'missingParts', group: 'balance', label: 'Silent parts that have notes', unit: 'count', bad: 'high', warn: null, fail: 0.5, drift: null, repeat: 0, get: (x) => x.stems.missing.length, why: 'A part the sequencer played at least twice in the window whose stem stayed below -70 dBFS.' },
  { id: 'masking', group: 'balance', label: 'Most-masked part', unit: 'share', bad: 'high', warn: 0.6, fail: 0.85, drift: 0.15, repeat: 0.04, get: (x) => Math.max(0, ...x.stems.stems.filter((s) => s.id !== 'fx' && (s.notes ?? 0) >= 4 && s.relLu != null && s.relLu > -20).map((s) => s.buriedShare ?? 0)), why: 'Share of a part\'s energy in time/third-octave cells where the rest of the mix is 10 dB louder (energetic masking), for parts within 20 LU of the mix.' },
  { id: 'stemDrift', group: 'balance', label: 'Largest stem level change', unit: 'LU', bad: 'high', warn: null, fail: null, drift: 3, repeat: 0.5, baselineOnly: true, get: () => null, why: 'Per-stem loudness relative to the mix vs baseline; catches one part getting much louder or quieter.' },
  { id: 'gap', group: 'silence', label: 'Longest dropout', unit: 's', bad: 'high', warn: 2, fail: 6, drift: 1, repeat: 0.2, get: (x) => x.mix.silence?.maxGapSec ?? null, why: '400 ms loudness more than 35 LU under the song between the first bar and the final hit (a phantom gap); breakdowns are quieter but not silent. Silence after the final hit is dead air.' },
  { id: 'leadIn', group: 'silence', label: 'Silence before the music', unit: 's', bad: 'high', warn: 1, fail: 4, drift: 0.5, repeat: 0.1, tiers: ['deep'], get: (x) => x.mix.silence?.leadSec ?? null, why: 'Time from play to the first audible note.' },
  { id: 'contrast', group: 'arrangement', label: 'Bar loudness spread (p90-p10)', unit: 'LU', bad: 'low', warn: 1, fail: 0.3, drift: 1.5, repeat: 0.2, tiers: ['deep'], get: (x) => x.mix.arrangement?.contrastLu ?? null, why: 'How much bar-by-bar loudness moves across the song; near zero is a flat loop with no arrangement.' },
  { id: 'peakOverBreak', group: 'arrangement', label: 'Peak sections over breakdowns', unit: 'LU', bad: 'low', warn: 0, fail: -2, drift: 1.5, repeat: 0.2, tiers: ['deep'], get: (x) => x.mix.arrangement?.peakOverBreakdownLu ?? null, excuse: denseDrop, why: 'Loudness of the peak sections (C/G) over the breakdowns (E/F); a drop should land harder than the breakdown before it. Loudness only: a seed whose drop is no louder but plays clearly more (>= 1.25x the onsets per bar and >= 1 more part per bar) is excused from WARN (see excused); FAIL still applies.' },
  { id: 'peakOverIntro', group: 'arrangement', label: 'Peak sections over the intro', unit: 'LU', bad: 'low', warn: null, fail: -3, drift: 1.5, repeat: 0.2, tiers: ['deep'], get: (x) => x.mix.arrangement?.peakOverIntroLu ?? null, why: 'Loudness of the peak sections over the intro (A). Club intros are often full-level for DJs, so only an intro 3 LU louder than the peaks fails.' },
  { id: 'ringOut', group: 'ending', label: 'Final ring-out (to -40 dB)', unit: 's', bad: 'high', warn: 8, fail: 30, drift: 1.5, repeat: 0.3, applies: (s) => !LONG_TAIL.includes(s), get: (x) => x.mix.ending?.t40 ?? null, why: 'Time for the final hit to decay 40 dB (extrapolated from the decay rate when it outlasts the rendered tail; 999 = not decaying, a stuck note or runaway feedback). A long hall reverb is ~2-5 s.' },
  { id: 'ringOutLongTail', group: 'ending', label: 'Final ring-out (to -40 dB, long-tail styles)', unit: 's', bad: 'high', warn: 30, fail: 60, drift: 4, repeat: 1, applies: (s) => LONG_TAIL.includes(s), get: (x) => x.mix.ending?.t40 ?? null, why: 'The same decay for styles whose endings are pad/reverb/delay fades by design (ambient, dub): 10-20 s is the intended fade; only a tail past 30 s or one that never decays (999) is flagged.' },
  { id: 'cutoff', group: 'ending', label: 'Steepest drop in the ending', unit: 'dB/10ms', bad: 'high', warn: 20, fail: 35, drift: 6, repeat: 2, get: (x) => x.mix.ending?.cliffDb ?? null, why: 'Largest 10 ms fall of the ending envelope while still audible; an abrupt truncation shows as a cliff.' },
  { id: 'deadAir', group: 'ending', label: 'Dead air after the ending', unit: 's', bad: 'high', warn: 5, fail: 20, drift: 1.5, repeat: 0.2, get: (x) => x.mix.ending?.deadAirSec ?? null, why: 'Time the song keeps running (and the next one waits) after its ring-out has died.' },
];

// Per-seed measurement -> { value, level, reason } per check, then the worst seed per style.
export function evaluate(tier, results, baseline) {
  const styles = {}, checks = CHECKS.filter((c) => !c.tiers || c.tiers.includes(tier));
  for (const id of [...new Set(results.map((x) => x.style))]) {
    const rs = results.filter((x) => x.style === id).sort((a, b) => a.seed - b.seed), base = baseline?.styles?.[id];
    const row = { name: STYLES[id]?.name || id, family: STYLES[id]?.family || 'OTHER', verdict: 'PASS', reasons: [], metrics: {}, seeds: {} };
    for (const c of checks) {
      if (c.applies && !c.applies(id)) continue;
      const vals = Object.fromEntries(rs.map((x) => [x.seed, c.baselineOnly ? null : r(c.get(x))]).filter(([, v]) => v != null));
      if (c.baselineOnly) {
        if (!base) continue;
        let worst = 0, at = null;
        for (const x of rs) for (const s of x.stems.stems) { const b = base.seeds?.[x.seed]?.stems?.find((t) => t.id === s.id); if (b && s.relLu != null && b.relLu != null && Math.abs(s.relLu - b.relLu) > Math.abs(worst)) { worst = r(s.relLu - b.relLu, 1); at = `${x.seed}:${s.id}`; } }
        const m = { worst: Math.abs(worst), worstSeed: at, delta: worst, level: 'PASS' };
        if (Math.abs(worst) > 3 * c.drift) m.level = 'FAIL'; else if (Math.abs(worst) > c.drift) m.level = 'WARN';
        if (m.level !== 'PASS') row.reasons.push({ check: c.id, level: m.level, kind: 'drift', seed: +at.split(':')[0], value: m.worst, threshold: m.level === 'FAIL' ? 3 * c.drift : c.drift, message: `${STEM_LABEL(at)} moved ${worst > 0 ? '+' : ''}${worst} LU vs baseline (> ${m.level === 'FAIL' ? 3 * c.drift : c.drift})` });
        row.metrics[c.id] = m; row.verdict = worse(row.verdict, m.level);
        continue;
      }
      const seeds = Object.keys(vals);
      if (!seeds.length) continue;
      const hi = c.bad === 'high', worstSeed = seeds.reduce((a, s) => ((hi ? vals[s] > vals[a] : vals[s] < vals[a]) ? s : a)), worst = vals[worstSeed];
      const over = (v, t) => t != null && (hi ? v > t : v < t);
      const m = { worst, worstSeed: +worstSeed, p50: r(pct(Object.values(vals), 0.5)), values: vals, level: 'PASS' };
      // A seed the check's excuse() clears (e.g. a drop no louder than the breakdown but clearly denser) keeps its
      // value and is still held to the FAIL guardrail, but not to WARN.
      const excused = c.excuse ? Object.fromEntries(rs.filter((x) => x.seed in vals).map((x) => [x.seed, c.excuse(x)]).filter(([, v]) => v)) : {};
      if (Object.keys(excused).length) m.excused = excused;
      const held = seeds.filter((sd) => !(sd in excused)), ts = held.length ? held.reduce((a, sd) => ((hi ? vals[sd] > vals[a] : vals[sd] < vals[a]) ? sd : a)) : null, tv = ts == null ? null : vals[ts];
      let at = worstSeed;
      if (over(worst, c.fail)) m.level = 'FAIL'; else if (ts != null && over(tv, c.warn)) { m.level = 'WARN'; at = ts; }
      if (m.level !== 'PASS') row.reasons.push({ check: c.id, level: m.level, kind: 'threshold', seed: +at, value: vals[at], threshold: m.level === 'FAIL' ? c.fail : c.warn, message: `${c.label} ${vals[at]} ${c.unit} (seed ${at}) ${hi ? '>' : '<'} ${m.level === 'FAIL' ? c.fail : c.warn}` });
      // Margin to the WARN guardrail in units of the drift tolerance: the "closest to threshold" ranking.
      const t = c.warn ?? c.fail;
      if (t != null && c.drift) m.margin = r((hi ? t - worst : worst - t) / c.drift);
      const b = base?.metrics?.[c.id]?.worst;
      if (b != null && c.drift) {
        m.baseline = b; m.delta = r(worst - b);
        const away = hi ? m.delta : -m.delta, drift = Math.abs(m.delta);
        let lvl = 'PASS';
        if (drift > 3 * c.drift) lvl = 'FAIL'; else if (drift > c.drift) lvl = 'WARN';
        if (lvl !== 'PASS') {
          m.level = worse(m.level, lvl);
          row.reasons.push({ check: c.id, level: lvl, kind: 'drift', seed: +worstSeed, value: worst, baseline: b, delta: m.delta, threshold: lvl === 'FAIL' ? 3 * c.drift : c.drift, message: `${c.label} ${away > 0 ? 'worsened' : 'changed'} ${m.delta > 0 ? '+' : ''}${m.delta} ${c.unit} vs baseline ${b} (tolerance ±${c.drift}${lvl === 'FAIL' ? ' x3' : ''})` });
        }
      }
      row.metrics[c.id] = m; row.verdict = worse(row.verdict, m.level);
    }
    for (const x of rs) row.seeds[x.seed] = detail(x);
    styles[id] = row;
  }
  return styles;
}
const STEM_LABEL = (at) => { const [seed, id] = String(at).split(':'); return `${id} stem (seed ${seed})`; };

// What a chart needs per seed, kept small: spectrum, stems, the arrangement curve and the ending envelope.
function detail(x) {
  const m = x.mix, d = { bars: x.bars, secs: x.secs, bpm: x.bpm, chain: x.chain, windows: x.windows, octaves: m.spectrum.octaves, shares: m.spectrum.shares, centroidHz: m.spectrum.centroid,
    loudness: m.loudness, stereo: m.stereo, limiter: m.limiter, clipper: m.clipper ?? null, saturator: m.saturator ?? null, crest: m.crest ?? null, kickBass: x.stems.kickBass ?? null,
    stems: x.stems.stems.map(({ id, notes, relLu, buriedShare }) => ({ id, notes, relLu, buriedShare })) };
  if (m.arrangement) Object.assign(d, { barLufs: m.arrangement.barLufs, sections: m.arrangement.sections ?? [] });
  if (m.ending) d.ending = { t40: m.ending.t40, cliffDb: m.ending.cliffDb, deadAirSec: m.ending.deadAirSec, tailLu: m.ending.tailLu, envelopeDb: m.ending.envelope, envelopeStepSec: 0.05 };
  return d;
}

export function report(tier, seeds, results, baseline, run) {
  const styles = evaluate(tier, results, baseline), list = Object.entries(styles), checks = CHECKS.filter((c) => !c.tiers || c.tiers.includes(tier));
  const verdict = list.reduce((a, [, s]) => worse(a, s.verdict), 'PASS'), families = {};
  for (const [id, s] of list) { const f = (families[s.family] ||= { styles: [], verdict: 'PASS' }); f.styles.push(id); f.verdict = worse(f.verdict, s.verdict); }
  const global = {};
  for (const c of checks) {
    const all = list.flatMap(([id, s]) => Object.entries(s.metrics[c.id]?.values || {}).map(([seed, v]) => ({ style: id, seed: +seed, v })));
    if (!all.length) continue;
    const hi = c.bad === 'high', w = all.reduce((a, b) => ((hi ? b.v > a.v : b.v < a.v) ? b : a));
    global[c.id] = { n: all.length, p10: r(pct(all.map((a) => a.v), 0.1)), p50: r(pct(all.map((a) => a.v), 0.5)), p90: r(pct(all.map((a) => a.v), 0.9)), worst: w.v, worstStyle: w.style, worstSeed: w.seed,
      levels: { PASS: list.filter(([, s]) => s.metrics[c.id]?.level === 'PASS').length, WARN: list.filter(([, s]) => s.metrics[c.id]?.level === 'WARN').length, FAIL: list.filter(([, s]) => s.metrics[c.id]?.level === 'FAIL').length } };
  }
  const reasons = list.flatMap(([id, s]) => s.reasons.map((x) => ({ style: id, ...x }))).sort((a, b) => LEVEL[b.level] - LEVEL[a.level]);
  const closest = list.flatMap(([id, s]) => Object.entries(s.metrics).filter(([, m]) => m.margin != null && m.level === 'PASS').map(([check, m]) => ({ style: id, seed: m.worstSeed, check, value: m.worst, margin: m.margin }))).sort((a, b) => a.margin - b.margin).slice(0, 12);
  return {
    schema: SCHEMA, tier, verdict, run,
    seeds, counts: { styles: list.length, songs: results.length, PASS: list.filter(([, s]) => s.verdict === 'PASS').length, WARN: list.filter(([, s]) => s.verdict === 'WARN').length, FAIL: list.filter(([, s]) => s.verdict === 'FAIL').length },
    baseline: baseline ? { file: `test/audio-baseline/${tier}.json`, commit: baseline.run?.commit ?? null } : null,
    checks: Object.fromEntries(checks.map(({ id, group, label, unit, bad, warn, fail, drift, repeat, why, applies }) => [id, { group, label, unit, worseWhen: bad, warn, fail, drift, repeat, appliesTo: applies ? Object.keys(STYLES).filter(applies) : 'all', why }])),
    global, reasons, closest, families, styles,
  };
}

// Repeat-run agreement: every per-seed value of every check within its repeat tolerance.
// The checked-in baseline: the report minus chart data, one line per style so a re-record diffs per style. Drift
// gating reads styles.*.metrics.*.worst and styles.*.seeds.*.stems[].relLu.
export function baselineOf(rep) {
  const styles = Object.entries(rep.styles).map(([id, s]) => JSON.stringify(id) + ':' + JSON.stringify({ verdict: s.verdict,
    metrics: Object.fromEntries(Object.entries(s.metrics).map(([k, m]) => [k, m.values ? { worst: m.worst, values: m.values } : { worst: m.worst }])),
    seeds: Object.fromEntries(Object.entries(s.seeds).map(([seed, d]) => [seed, { stems: d.stems.map(({ id, relLu }) => ({ id, relLu })) }])) }));
  const head = { schema: rep.schema, tier: rep.tier, verdict: rep.verdict, run: { commit: rep.run.commit, generated: rep.run.generated }, seeds: rep.seeds, counts: rep.counts };
  return JSON.stringify(head).slice(0, -1) + ',"styles":{\n' + styles.join(',\n') + '\n}}\n';
}

export function compare(a, b) {
  const bad = [], worst = {};
  const sameSeeds = JSON.stringify(a.seeds) === JSON.stringify(b.seeds);
  for (const [id, s] of Object.entries(a.styles)) if (sameSeeds && b.styles[id] && s.verdict !== b.styles[id].verdict) bad.push(`${id} verdict: ${s.verdict} vs ${b.styles[id].verdict}`);
  for (const [id, s] of Object.entries(a.styles)) for (const [check, m] of Object.entries(s.metrics)) {
    const tol = a.checks[check]?.repeat ?? 0;
    for (const [seed, v] of Object.entries(m.values || {})) {
      const w = b.styles[id]?.metrics[check]?.values?.[seed], d = Math.abs(v - w);
      if (!(d <= tol + 1e-9)) bad.push(`${id}/${seed} ${check}: ${v} vs ${w} (±${tol})`);
      if (Number.isFinite(d)) worst[check] = Math.max(worst[check] ?? 0, r(d, 3));
    }
  }
  return { ok: !bad.length, bad, worst, verdicts: [a.verdict, b.verdict] };
}

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const fmt = (v) => (v == null ? '-' : String(v));

async function main() {
  if (flag('compare')) {
    const i = process.argv.indexOf('--compare'), [a, b] = [process.argv[i + 1], process.argv[i + 2]].map((f) => JSON.parse(readFileSync(f, 'utf8')));
    const c = compare(a, b);
    console.log(`audio benchmark repeat check (${a.tier}): ${c.ok ? 'agree' : 'DISAGREE'} · verdicts ${c.verdicts.join(' / ')}`);
    console.log('largest per-check difference:', Object.entries(c.worst).map(([k, v]) => `${k} ${v}`).join(', '));
    if (!c.ok) { console.log(c.bad.slice(0, 30).join('\n')); process.exit(1); }
    return;
  }
  if (flag('pack-from')) { await pack(JSON.parse(readFileSync(arg('pack-from'), 'utf8')), arg('pack'), +arg('pack-size', 8)); return; }
  const tier = arg('tier', 'fast'), quiet = flag('quiet'), pages = +arg('pages', Math.max(1, Math.min(tier === 'deep' ? 8 : 4, cpus().length)));
  const styles = arg('styles') ? arg('styles').split(',') : Object.keys(STYLES), seeds = arg('seeds') ? arg('seeds').split(',').map(Number) : SEEDS[tier];
  const jobs = seeds.flatMap((seed) => styles.map((style) => [style, seed])), t0 = Date.now(), timing = {};
  const results = await withChrome(async (runs) => {
    const out = [];
    let next = 0;
    await Promise.all((Array.isArray(runs) ? runs : [runs]).map(async (run) => {
      await run(`import('/test/audio-quality-page.js').then((m) => { window.__q = m; })`);
      while (next < jobs.length) {
        const [style, seed] = jobs[next++], x = await run(`window.__q.measure(${JSON.stringify(style)}, ${seed}, { tier: '${tier}' })`);
        timing[`${style}/${seed}`] = x.renderMs;
        out.push(x);
        if (!quiet) process.stderr.write(`${style}/${seed}: ${x.mix.loudness.integrated} LUFS ${x.mix.peak.truePeakDb} dBTP (${(x.renderMs / 1000).toFixed(1)} s ${JSON.stringify(x.ms)}, ${out.length}/${jobs.length})\n`);
      }
    }));
    return out;
  }, { pages });
  if (!results) { console.log('audio benchmark: no Chrome found, skipped'); return; }
  results.sort((a, b) => styles.indexOf(a.style) - styles.indexOf(b.style) || a.seed - b.seed);
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch {}
  const run = { commit, generated: new Date().toISOString(), wallSec: Math.round((Date.now() - t0) / 1000), pages, sampleRate: 48000, renderSecBySong: timing };
  const subset = arg('styles') || arg('seeds');
  const baseline = flag('write-baseline') || flag('no-baseline') ? null : existsSync(baselineFile(tier)) ? JSON.parse(readFileSync(baselineFile(tier), 'utf8')) : null;
  const rep = report(tier, seeds, results, baseline && !(subset && JSON.stringify(baseline.seeds) !== JSON.stringify(seeds)) ? baseline : null, run);
  const json = arg('json', join(ROOT, `test/out/audio-benchmark-${tier}.json`));
  mkdirSync(dirname(json), { recursive: true });
  writeFileSync(json, JSON.stringify(rep, null, 1) + '\n');
  if (flag('write-baseline')) {
    if (subset) throw new Error('--write-baseline needs every style at the default seeds');
    mkdirSync(dirname(baselineFile(tier)), { recursive: true });
    writeFileSync(baselineFile(tier), baselineOf(rep));
  }
  if (!quiet) {
    console.log(`style          verdict  reasons`);
    for (const [id, s] of Object.entries(rep.styles)) console.log(`${id.padEnd(14)} ${s.verdict.padEnd(8)} ${s.reasons.map((x) => `${x.level} ${x.message}`).join('; ') || '-'}`);
    console.log('closest to a guardrail:', rep.closest.slice(0, 6).map((c) => `${c.style}/${c.seed} ${c.check}=${fmt(c.value)} (margin ${c.margin})`).join(', '));
  }
  console.log(`audio benchmark (${tier}): ${rep.verdict} · ${rep.counts.styles} styles x ${seeds.length} seeds · ${rep.counts.PASS} pass / ${rep.counts.WARN} warn / ${rep.counts.FAIL} fail${baseline ? '' : ' · no baseline'} · ${run.wallSec} s · ${json.replace(ROOT + '/', '')}${flag('write-baseline') ? ` · wrote test/audio-baseline/${tier}.json` : ''}`);
  if (quiet && rep.verdict !== 'PASS') for (const x of rep.reasons) console.log(`  ${x.level} ${x.style}: ${x.message}`);
  if (flag('pack')) await pack(rep, arg('pack'), +arg('pack-size', 8));
  if (flag('assert') && rep.verdict === 'FAIL') process.exit(1);
}

// Listening pack for auditing the metrics by ear (never committed): every WARN/FAIL, then the cases closest to a
// guardrail, spread over families; loudness-normalized MP3 excerpts and a manifest.
async function pack(rep, dir, size) {
  const want = [];
  const add = (style, seed, why, check) => {
    const g = rep.checks[check]?.group, kind = g === 'ending' ? 'ending' : 'peak', w = want.find((x) => x.style === style && x.seed === seed && x.kind === kind);
    if (w) { if (!w.why.includes(why)) w.why.push(why); return; }
    want.push({ style, seed, kind, why: [why], family: rep.styles[style].family });
  };
  for (const x of rep.reasons) add(x.style, x.seed, `${x.level}: ${x.message}`, x.check);
  for (const [k, c] of rep.closest.entries()) if (k < 4 || want.length < size) add(c.style, c.seed, `closest to ${c.check} guardrail: ${c.value} (margin ${c.margin} drift units)`, c.check);
  for (const f of Object.keys(rep.families)) if (want.filter((w) => w.family === f).length === 0) { const id = rep.families[f].styles[0]; add(id, rep.seeds[0], 'family coverage (all checks pass)', 'truePeak'); }
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const files = await withChrome(async (run) => {
    await run(`import('/test/audio-quality-page.js').then((m) => { window.__q = m; })`);
    const out = [];
    for (const w of want) {
      const x = await run(`window.__q.excerpt(${JSON.stringify(w.style)}, ${w.seed}, { kind: '${w.kind}', bars: 8 })`), base = `${String(out.length + 1).padStart(2, '0')}-${w.style}-${w.seed}-${w.kind}`;
      writeFileSync(join(dir, `${base}.wav`), Buffer.from(x.wav, 'base64'));
      let file = `${base}.wav`;
      try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(dir, file), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=20', '-ar', '48000', '-b:a', '192k', join(dir, `${base}.mp3`)]); rmSync(join(dir, file)); file = `${base}.mp3`; } catch {}
      const s = rep.styles[w.style];
      out.push({ file, style: w.style, name: s.name, family: w.family, seed: w.seed, excerpt: w.kind, bars: x.bars, secs: r(x.secs, 1), styleVerdict: s.verdict, why: w.why,
        metrics: Object.fromEntries(Object.entries(s.metrics).map(([k, m]) => [k, m.values?.[w.seed] ?? m.worst])) });
    }
    return out;
  });
  const manifest = { schema: `${SCHEMA}#listening-pack`, tier: rep.tier, commit: rep.run.commit, verdict: rep.verdict, normalized: 'ffmpeg loudnorm I=-16 LUFS, TP=-1.5 dBTP (excerpts are level-matched; judge balance and tone, not loudness)', files };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  const md = [`# UNTERGRUND listening pack (${rep.tier} tier, ${rep.run.commit ?? 'working tree'}, verdict ${rep.verdict})`, '', manifest.normalized, '',
    '| file | style | family | seed | excerpt | style verdict | why it is here |', '|---|---|---|---|---|---|---|',
    ...files.map((f) => `| ${f.file} | ${f.name} | ${f.family} | ${f.seed} | ${f.excerpt} bars ${f.bars.join('-')} | ${f.styleVerdict} | ${f.why.join('<br>')} |`)];
  writeFileSync(join(dir, 'manifest.md'), md.join('\n') + '\n');
  console.log(`listening pack: ${files.length} excerpts across ${new Set(files.map((f) => f.family)).size} families in ${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
