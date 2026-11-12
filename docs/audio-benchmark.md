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
| peaks | true peak (4x oversampled), clipped runs, DC (floored at -80 dBFS) | the master exceeds the -1 dBTP ceiling or clips | inter-codec overshoot of a specific encoder |
| loudness | integrated vs style target (deep), loudness range (deep; 15/20 LU club, 22/28 LU classical), limiter strain / deepest GR / GR jumps, window loudness drift (fast) | a style is too loud/quiet or the limiter is doing the mixing | whether the dynamics feel right |
| spectrum | tilt (dark/bright), 200-500 Hz build-up over its louder neighbour, 2-5 kHz over the mids, sub-share drift | gross tonal imbalance and tonal regressions | that a style's tone is the right one |
| stereo | mono fold-down loss, 5th-percentile L/R correlation, side energy under 120 Hz (non-classical) | phase problems and wide lows | width as an aesthetic |
| balance | kick/bass low-end collision, silent parts that have notes, energetic masking of audible parts, per-stem level drift | a part is missing, buried, or fighting the kick | that the balance is the best one |
| silence | longest dropout, lead-in (deep) | phantom gaps | intentional breaks quieter than -35 LU |
| arrangement (deep) | bar-loudness spread, peak sections over breakdowns / intro | a flat loop, or a drop that doesn't land harder | whether the form is interesting |
| ending | ring-out time to -40 dB (extrapolated past the tail), steepest 10 ms drop, dead air before playback stops | truncation, stuck tails, silence after the end | whether the ending is satisfying |

## Baselines

`test/audio-baseline/{fast,deep}.json` record the commit they were taken at. They are *known-good* in the sense of "what
main sounds like today": the current WARNs (e.g. ambient's 17 s ring-out, nocturne's silent last bars) are recorded,
not fixed here, and keep reporting until the music changes. The deep baseline also records one FAIL: REPERTOIRE plays
2-4 LU over its -16 LUFS target (seed 1234, Chopin Op. 10 No. 1: -11.96 LUFS through `renderBars` too).
`scripts/loudness.mjs` sizes the render with `songBars()` before the score is fetched, so it meters one bar of each
piece and calibrated `MAKEUP_DB.repertoire` on that; `npm run benchmark:audio:deep` fails until that is fixed. Re-record with `--write-baseline` when a change moves a
metric on purpose, and say why in the PR.

## Report schema (`untergrund.audio-benchmark/1`)

Written to `test/out/audio-benchmark-<tier>.json`; the checked-in baselines `test/audio-baseline/<tier>.json` are
reports trimmed by `baselineOf()` to what drift needs (verdicts, `metrics.*.worst`/`values`, `seeds.*.stems[].relLu`;
one line per style). Key order and rounding are stable; only `run` differs between identical runs.

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
      "metrics": { "<checkId>": { "worst", "worstSeed", "p50", "values": { "<seed>": v }, "level", "margin"?, "baseline"?, "delta"? } },
      "seeds": { "<seed>": {                          // chart data
        "bars", "secs", "bpm", "chain", "windows": { "peak": [fromBar, toBar], "stems": [...], "ending"?: [...] },
        "octaves": [[hz, dB rel. total], ...], "shares": { "sub", "bass", "lowMid", "mid", "presence", "brilliance", "air" }, "centroidHz",
        "loudness": { "integrated", "deltaTarget", "lra" }, "stereo": {...}, "limiter": {...}, "kickBass": {...} | null,
        "stems": [ { "id", "notes", "relLu", "buriedShare" } ],
        "barLufs"?: [...], "sections"?: [ { "label", "from", "to", "lufs" } ],                     // deep only
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

## Research posts (`/research`)

The public write-ups at [untergrund.sh/research](https://www.untergrund.sh/research/) are generated at build time by
`scripts/research.mjs` from checked-in snapshots, so every chart is real benchmark output and nothing runs in the browser.

- `research/posts/<slug>.md`: front matter (`title`, `date`, `summary`, optional `card` for the social image and `data` for the
  snapshot name) and a body of paragraphs, `##` headings, `- ` lists, `> ` notes, inline values `{{v path.to.value|digits}}` and
  blocks `{{kpis}}`, `{{findings}}`, `{{closest}}`, `{{chart scoreboard|loudness|truepeak|energy|endings|composition|trend [styles]}}`.
- `research/data/<slug>.json` (`untergrund.research/1`): the compacted deep and fast reports (per-seed bar loudness,
  sections and ending envelopes for the charts), the composition scorecard, the music benchmark's determinism/diversity
  summary, and the history of the checked-in baselines read from git for the trend chart.

Publishing fresh numbers is one command, then a build:

```
node scripts/research.mjs new <slug> --title "..." --run   # runs deep + fast (~25 min on 8 cores), snapshots, writes a post template
npm run build                                               # renders dist/research/** (pages, og.png cards, feed.xml)
```

Without `--run` it snapshots the reports already in `test/out/` (or `--deep file --fast file`); `snapshot <slug>` refreshes the
data of an existing post. `npm test` (`test/research.mjs`) checks every post renders with labelled, described charts.
