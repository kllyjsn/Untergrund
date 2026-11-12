# Rendered-audio benchmark

`scripts/audio-benchmark.mjs` renders fixed seeds of every style through the real offline engine (headless Chrome,
`test/audio-quality-page.js`), measures the master output and the pre-master stems (`js/audio-quality.js`), and gates
each style's **worst seed** against absolute guardrails and a checked-in baseline. It writes one JSON report.

```
npm run benchmark:audio          # fast tier, same as npm test (densest bars + ending of seed 42, all 29 styles)
npm run benchmark:audio:deep     # deep tier: whole songs, seeds 11/42/1234 (~19 min on 8 cores)
node scripts/audio-benchmark.mjs --tier deep --write-baseline      # re-record test/audio-baseline/deep.json
node scripts/audio-benchmark.mjs --pack test/out/listening-pack    # + loudness-matched MP3 excerpts and a manifest
node scripts/audio-benchmark.mjs --pack-from test/out/audio-benchmark-deep.json --pack test/out/listening-pack   # pack from an existing report
node scripts/audio-benchmark.mjs --compare a.json b.json           # repeat run a (may be a subset of b) agrees: per-style verdicts, values within each check's `repeat`
```

`--assert` exits non-zero on FAIL only; WARN is reported, never blocks. Without Chrome the benchmark is skipped.

## What it is (and isn't)

A **regression guard**. It catches a change that makes a mix clip, squash, go muddy or harsh, collapse in mono, lose a
part, stop building, cut off, ring forever, or leave dead air, and it catches any measured value moving away from the
known-good baseline. Passing says nothing about whether a song is *good*: melody, groove, sound choice and taste are not
measured (see `scripts/composition.mjs` for the note-level side, and listen to the pack). Thresholds are physical
guardrails (headroom, phase, decay times, per-octave balance), not genre ideals; style-dependent quantities such as sub
weight and window loudness are gated only as drift from each style's own baseline.

## Tiers

| tier | renders per song | seeds | where |
|---|---|---|---|
| fast | 2 densest bars (master with limiter taps + stems), the ending from the bar before the final hit + 6 s tail | 42 | `npm test`, ~42 s with 4 pages |
| deep | whole song + 8 s tail (master with limiter taps), 8 densest bars of stems | 11, 42, 1234 | `npm run benchmark:audio:deep` |

Renders schedule two bars ahead through `OfflineAudioContext.suspend()` (as live playback does) instead of queuing a
whole song at once, which renders ~7x slower. Against `js/render.js` `renderBars`, whole-song integrated loudness
agrees within 0.01 LU (REPERTOIRE seeds 11/42/1234); sample-level waveforms agree for deephouse/trap (relative
difference 3e-4, the same as two `renderBars` runs) but not for hypnotic/acid (0.23-0.29), so treat the renders as
the same music, not the same samples.

## Checks

Each check reads one value per seed; a style's value is its worst seed, and the report also carries every seed and the
p10/p50/p90 over all songs. `warn`/`fail` are absolute guardrails; `drift` is the baseline change worth a WARN (3x is a
FAIL); `repeat` is the agreement two runs of one commit must reach (Chrome renders aren't bit-identical, so there are no
waveform hashes). The authoritative list with every threshold and its rationale is `CHECKS` in the script, copied into
each report under `checks`.

| group | checks | can conclude | cannot conclude |
|---|---|---|---|
| peaks | true peak (4x oversampled), clipped runs, DC (floored at -80 dBFS), clipper input over full scale | the master exceeds the -1 dBTP ceiling, clips, or drives the clipper into its flat top | inter-codec overshoot of a specific encoder |
| loudness | integrated vs style target (deep), loudness range (deep; 15/20 LU club, 22/28 LU classical), limiter strain (>3 dB) / over 6 dB / deepest GR / GR jumps, clipper shaving >1 dB and its p99 depth, bus-saturator compression (drift only), crest factor p10 of bars, window loudness drift (fast) | a style is too loud/quiet or the limiter is doing the mixing | whether the dynamics feel right |
| spectrum | tilt (dark/bright), 200-500 Hz build-up over its louder neighbour, 2-5 kHz over the mids, sub-share drift | gross tonal imbalance and tonal regressions | that a style's tone is the right one |
| stereo | mono fold-down loss, 5th-percentile L/R correlation, side energy under 120 Hz (non-classical) | phase problems and wide lows | width as an aesthetic |
| balance | kick/bass low-end collision, silent parts that have notes, energetic masking of audible parts, per-stem level drift | a part is missing, buried, or fighting the kick | that the balance is the best one |
| silence | longest dropout, lead-in (deep) | phantom gaps | intentional breaks quieter than -35 LU |
| arrangement (deep) | bar-loudness spread, peak sections over breakdowns / intro (loudness; a denser drop is excused from WARN) | a flat loop, or a drop that lands neither louder nor denser | whether the form is interesting |
| ending | ring-out time to -40 dB (extrapolated past the tail; 8/30 s, or 30/60 s for the long-tail styles ambient and dub), steepest 10 ms drop, dead air before playback stops | truncation, stuck tails, silence after the end | whether the ending is satisfying |

### Over-limiting and clipping

All measured on the raw render, before any normalization (the listening pack's `loudnorm` never touches the numbers).
The master chain ends `limIn -> limiter (DynamicsCompressor, -6 dB, 12:1) -> limTrim x1.4 -> clip (WaveShaper: linear to
0.88, tanh to a 0.98 ceiling, input clamped at full scale) -> out x0.78`, and the bus saturator (`sat`, tanh, the style's
DRIVE) sits earlier. Taps on `limIn`, `limiter` and `satIn` give each stage's input; the clipper and saturator outputs
are computed from their curves exactly as the WaveShaper looks them up.

- **Limiter** gain reduction is absolute: the compressor's fixed make-up gain is measured on a tone 40 dB under its
  threshold and removed (earlier reports normalized to the least-reduced frames instead, which hid constant reduction).
- **Clipper**: per 10 ms frame of music, how much it takes off the peak (`clipperShare` = share of frames over 1 dB,
  `clipperDepth` = p99 dB) and whether its input reached full scale (`hardClip`), where the curve is flat. Sample points
  only; the node oversamples 4x, so inter-sample peaks are shaved slightly more than reported.
- **Crest factor**: sample peak over RMS per bar, 10th percentile of bars within 10 LU of the loudest. It drops for any
  flattened transient, including saturation that is part of the sound: HARD TECHNO and INDUSTRIAL have an idle clipper and
  limiter but a bus saturator (DRIVE) compressing their peaks by 4-6 dB, which `saturatorDepth` reports.
- Calibration: on main the limiter never exceeds ~2 dB and the clipper takes at most ~2 dB off the loudest peaks
  (`shaveMaxDb`) in every style; DEEP HOUSE and AMAPIANO, clean by ear, reach 2% of frames over 1 dB, 11% over full scale
  and a 6.3 dB crest, so the WARN lines sit at 5% / 25% / 6 dB. FAIL (25% / 50% / 3.5 dB) is reserved for egregious cases.

### Peak sections vs breakdowns is loudness-only

`peakOverBreak` compares BS.1770 loudness of the C/G sections with the E/F breakdowns. A drop that adds parts at the same
level (the limiter and clipper hold club styles near one loudness) reads as "not louder" though it lands by ear. Each
seed therefore also reports `sections[].notesPerBar` / `voices` and `peakOverBreakdownNotes` (onset ratio) /
`peakOverBreakdownVoices` (parts per bar difference); a seed with >= 1.25x the onsets and >= 1 more part per bar is
listed under `metrics.peakOverBreak.excused` and held only to the FAIL line (-2 LU). It still can't hear whether the drop
is *exciting*.

## Baselines

`test/audio-baseline/{fast,deep}.json` record the commit they were taken at. They are *known-good* in the sense of "what
main sounds like today": the current WARNs (e.g. nocturne's silent last bars, electro/hard techno crest, drill's clipper) are recorded,
not fixed here, and keep reporting until the music changes. The deep baseline also records one FAIL: REPERTOIRE plays
2-4 LU over its -16 LUFS target (seed 1234, Chopin Op. 10 No. 1: -11.96 LUFS through `renderBars` too).
`scripts/loudness.mjs` sizes the render with `songBars()` before the score is fetched, so it meters one bar of each
piece and calibrated `MAKEUP_DB.repertoire` on that; `npm run benchmark:audio:deep` fails until that is fixed. Re-record with `--write-baseline` when a change moves a
metric on purpose, and say why in the PR.

## Report schema (`untergrund.audio-benchmark/1`)

Written to `test/out/audio-benchmark-<tier>.json`; the checked-in baselines `test/audio-baseline/<tier>.json` are
reports trimmed by `baselineOf()` to what drift needs (verdicts, `metrics.*.worst`/`values`, `seeds.*.stems[].relLu`;
one line per style). Key order and rounding are stable; only `run` differs between identical runs.

Changes within `/1` are additive (a consumer that ignores unknown keys keeps working): new checks `clipperShare`,
`clipperDepth`, `hardClip`, `limiterOver6`, `saturatorDepth`, `crest`, `ringOutLongTail` (ambient and dub moved from
`ringOut` to it); `metrics.<id>.excused`; per-seed `clipper`, `saturator`, `crest`, `limiter.over6Share`,
`sections[].notesPerBar`/`voices`. Limiter values are now absolute (see above), so they read lower than the first run.

```jsonc
{
  "schema": "untergrund.audio-benchmark/1",
  "tier": "fast" | "deep",
  "verdict": "PASS" | "WARN" | "FAIL",               // worst style verdict
  "run": { "commit", "generated", "wallSec", "pages", "sampleRate", "renderSecBySong": { "style/seed": ms } },
  "seeds": [42],
  "counts": { "styles", "songs", "PASS", "WARN", "FAIL" },
  "baseline": { "file", "commit" } | null,          // null: compared against nothing (first run / --no-baseline)
  "checks": { "<checkId>": { "group", "label", "unit", "worseWhen": "high"|"low", "warn", "fail", "drift", "repeat", "appliesTo": "all"|[styles], "why" } },
  "global": { "<checkId>": { "n", "p10", "p50", "p90", "worst", "worstStyle", "worstSeed", "levels": { "PASS", "WARN", "FAIL" } } },
  "reasons": [ { "style", "check", "level", "kind": "threshold"|"drift", "seed", "value", "threshold", "baseline"?, "delta"?, "message" } ],
  "closest": [ { "style", "seed", "check", "value", "margin" } ],   // passing checks nearest a guardrail, margin in drift units
  "families": { "TECHNO": { "styles": [...], "verdict" } },
  "styles": {
    "<style>": {
      "name", "family", "verdict", "reasons": [...],
      "metrics": { "<checkId>": { "worst", "worstSeed", "p50", "values": { "<seed>": v }, "level", "margin"?, "baseline"?, "delta"?, "excused"?: { "<seed>": why } } },
      "seeds": { "<seed>": {                          // chart data
        "bars", "secs", "bpm", "chain", "windows": { "peak": [fromBar, toBar], "stems": [...], "ending"?: [...] },
        "octaves": [[hz, dB rel. total], ...], "shares": { "sub", "bass", "lowMid", "mid", "presence", "brilliance", "air" }, "centroidHz",
        "loudness": { "integrated", "deltaTarget", "lra" }, "stereo": {...}, "limiter": { "grMean", "grP1", "strainShare", "over6Share", "grJumpP99" },
        "clipper"/"saturator": { "share1Db", "share3Db", "shaveP50Db", "shaveP99Db", "shaveMaxDb", "hardShare", "inPeakDb" } | null,
        "crest": { "p10Db", "p50Db", "n" } | null, "kickBass": {...} | null,
        "stems": [ { "id", "notes", "relLu", "buriedShare" } ],
        "barLufs"?: [...], "sections"?: [ { "label", "from", "to", "lufs", "notesPerBar", "voices" } ],   // deep only
        "ending"?: { "t40", "cliffDb", "deadAirSec", "tailLu", "envelopeDb": [...], "envelopeStepSec": 0.05 }
      } }
    }
  }
}
```

Visual hooks for the Research page: `global` (distribution strip per check with guardrails from `checks`), `families`
and per-style `verdict` (scoreboard), `seeds.*.octaves` (spectrum curves), `barLufs` + `sections` (energy trajectory),
`ending.envelopeDb` (decay plots), `stems` (balance/masking bars), and `reasons`/`closest` (call-outs).

## Listening pack

`--pack <dir>` renders 8-bar excerpts (or the ending with its ring-out) of every WARN/FAIL and the 4 passing cases closest
to a guardrail, covering every family, loudness-matched with ffmpeg `loudnorm` to -16 LUFS, plus `manifest.json`/`.md`
mapping each file to style, seed, why it was picked and its metrics. Audio stays out of git (`test/out/`). The pack
exists to audit whether the numbers track what you hear; the gate never needs it.
