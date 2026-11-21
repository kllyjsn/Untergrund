# Daily blind rating pack

Use `--styles deephouse,phonk,bossa,jazzfunk,lofihiphop` for an exact list without
forced core genres. `--baselines style:COMMIT,style:COMMIT` overrides the global
base per style; both commits are recorded per pair. `--null-control` adds one
seed-selected detected style outside the real pairs using the same head render
twice, then shuffles it among
the real pairs. Its identity and commit appear only in the private key.
Use `--null-style electrohiphop` with `--null-control` to choose that unused
style explicitly. The command fails if no unused null style is available.
`--max-pairs` caps real styles, before adding this optional control.
`--min-difference 0.001` rejects real pairs with gain-matched relative PCM RMS
difference at or below that threshold, measured on raw same-window renders.
Existing dated pack directories and keys are never overwritten.

Use `--max-pairs 6` to retain the four core genres and cap additional styles.
Styles supplied with `--genres pop,hypnotic` take priority over detected additions.
The key records dropped styles. Every half receives 10 ms fade-in and fade-out
before two-pass normalization and decoded-MP3 loudness verification.

Daily packs take eight bars from head's first hook/drop/chorus section, not its
densest window. Song forms expose chorus spans; club arrangements use G/H drops.
Jazz HEAD patterns carry the chorus role, so their opening theme qualifies even
when it starts at bar zero. The peak (densest-note) window is used only when no
hook/drop/chorus exists. A first section shorter than eight bars fails clearly.
Base is forced to head's exact start bar. Each pair's `excerpt` records the
selection method, section role/label and full section bounds, or the peak fallback
reason; `barWindow` and `windows` still record the shared excerpt bounds.

Run `npm run blind-pack -- --date YYYY-MM-DD --key-dir /private/path/blind-packs`.
Requires Node 22+, Chrome, ffmpeg (libmp3lame), zip, and access to origin. The script fetches
main, renders both revisions in disposable worktrees, and removes those worktrees even on failure.
The default base is the newest key's recorded head commit, or the first-parent main
revision 24 hours ago when no key exists. Override with `--base <ref>` or `--since <ISO time>`;
`--head <ref>` overrides the fetched main head. `--genres a,b` adds style IDs or names.
`--seed N` fixes the shuffle and per-style render seeds (default: a hash of the UTC date).
The same seed and revisions reproduce the assignment; generation timestamps and measured
audio values can differ between runs. Reuse `--base` for a repeat after recording a key.

Share only `test/out/blind-packs/<date>/blind-rating-pack-<date>.zip` (or its
`blind-pilot` folder). The separate `<key-dir>/<date>.json` reveals the identities;
never include it in the listener pack. Rerunning an existing date is refused.
Levels in the key are measured using loudnorm JSON input_i on decoded MP3 halves, split at the known
inserted silence boundaries (also recorded in the key). A difference over 0.1 LU fails
the run. Style detection ignores diffs under test/, docs/, research/, and Markdown files.
The README requests a whole-pair rating plus first/second/tie and one short reason
(one line) in Why for every pair. It does not disclose controls.
Pure Chrome-free checks: `node test/blind-pack.mjs`.

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
gated (see `scripts/composition.mjs` for the note-level side, and listen to the pack). Thresholds are physical
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
For kick/bass collision, drift only flags increases: reducing bass overlap with the kick is intentional in offbeat grooves.

For swing, modal and bossa, the same low-frequency ratio is retained as the informational `acousticKickBass` measurement. Upright bass intentionally leads their feathered/surdo-style kick, so bass being louder in a kick window does not by itself establish masking. Missing-part and energetic-masking measurements still apply. Jazz-funk keeps the normal kick/bass guardrail because its kick is a foreground groove instrument.

| group | checks | can conclude | cannot conclude |
|---|---|---|---|
| peaks | true peak (4x oversampled), clipped runs, DC (floored at -80 dBFS), clipper input over full scale | the master exceeds the -1 dBTP ceiling, clips, or drives the clipper into its flat top | inter-codec overshoot of a specific encoder |
| loudness | integrated vs style target (deep), loudness range (deep; 15/20 LU club, 22/28 LU classical), limiter strain (>3 dB) / over 6 dB / deepest GR / GR jumps, clipper shaving >1 dB and its p99 depth, bus-saturator compression (drift only), crest factor p10 of bars, window loudness drift (fast) | a style is too loud/quiet or the limiter is doing the mixing | whether the dynamics feel right |
| spectrum | tilt (dark/bright), 200-500 Hz build-up over its louder neighbour, 2-5 kHz over the mids, sub-share drift | gross tonal imbalance and tonal regressions | that a style's tone is the right one |
| stereo | mono fold-down loss, 5th-percentile L/R correlation, side energy under 120 Hz (non-classical) | phase problems and wide lows | width as an aesthetic |
| balance | kick/bass low-end collision, silent parts that have notes, energetic masking of audible parts, per-stem level drift | a part is missing, buried, or fighting the kick | that the balance is the best one |
| silence | longest dropout, lead-in (deep) | phantom gaps | intentional breaks quieter than -35 LU |
| arrangement (deep) | bar-loudness spread, peak sections over breakdowns / intro (loudness; a denser drop is excused from WARN) | a flat loop, or a drop that lands neither louder nor denser | whether the form is interesting |
| ending | ring-out time to -40 dB (extrapolated past the tail; 8/30 s, or 30/60 s for the long-tail styles ambient, dub and nocturne, whose solo piano rings on the pedal), steepest 10 ms drop, dead air before playback stops | truncation, stuck tails, silence after the end | whether the ending is satisfying |

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
main sounds like today": the current WARNs (e.g. electro/hard techno crest, drill's clipper) are recorded,
not fixed here, and keep reporting until the music changes. The classical rows were re-recorded after REPERTOIRE's
whole-score loudness calibration (per-piece `PIECE_TRIM_DB`) and the score endings (no empty bars after the final
chord) landed. Re-record with `--write-baseline` when a change moves a
metric on purpose, and say why in the PR.

## Advisory listening scores

Both tiers also analyze the same stereo PCM for cues associated with the listener’s complaints. These are versioned
diagnostics under `perceptual`, deliberately outside `checks`, `--assert`, drift baselines and `--compare`. All scores
are 0–100 proxy units, higher meaning more of the measured cue, **not** a failure probability. There is no combined
quality score or cross-genre quality threshold.

| Score | Measures | Confounds |
| --- | --- | --- |
| `harshTransients` | p98 upper-mid attack energy relative to the recent background and current frame | Deliberately sharp percussion; not steady distortion or every kind of harshness |
| `transitionJolt` | p95 sustained level and band-balance change between adjacent 160 ms windows | Intentional drops or repeated gating |
| `sectionJolt` | Same change at known section boundaries (p90), with measured boundary count | No timeline, no audible signal on either side, or no boundary in the window means unmeasured or limited coverage |
| `lackOfSmoothness` | Average short-term change in level and normalized band balance at 20 ms intervals | Deliberate chops, articulation, or rhythmic pumping |
| `toyLikeTimbre` | p85 narrow 0.7–4.5 kHz resonance, weighted by prominence and spectral stability | Real bells can ring narrowly; bass, dense mixes, and complex cheap sounds can hide it. Not an instrument-realism model |

The master uses the densest two bars in fast and the full song in deep; stems use the densest two/eight bars
respectively. These scores exclude the separate ending window and post-song tail. Stereo band power avoids
mono cancellation. The relative activity gate ignores quiet frames and an absolute floor excludes near-silence.
Missing or insufficient measurements are `null`, not zero; `activeSec` and `sectionBoundaries` show coverage. The
timbre proxy is available for pitched/instrument stems; drums, vocals and FX are unmeasured for timbre only.
Compare like parts, windows and genres before inferring a change in quality.

`styles.<style>.perceptual.{mix,parts.<part>}.<metric>` aggregates measured seeds as `{n,p50,worst,worstSeed}`.
`styles.<style>.seeds.<seed>.perceptual` and `stems[].perceptual` hold raw scores. For a local excerpt, use
`node scripts/perceptual-clip.mjs FILE [START_SECONDS [END_SECONDS]]` (ffmpeg); this has no stems or section times.
See the [original blind-pack results and their limits](perceptual-audio-pilot.md).

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
  "perceptual": { "version": 1, "gating": false, "worseWhen": "high", "metrics": { "<metric>": "label" } },
  "global": { "<checkId>": { "n", "p10", "p50", "p90", "worst", "worstStyle", "worstSeed", "levels": { "PASS", "WARN", "FAIL" } } },
  "reasons": [ { "style", "check", "level", "kind": "threshold"|"drift", "seed", "value", "threshold", "baseline"?, "delta"?, "message" } ],
  "closest": [ { "style", "seed", "check", "value", "margin" } ],   // passing checks nearest a guardrail, margin in drift units
  "families": { "TECHNO": { "styles": [...], "verdict" } },
  "styles": {
    "<style>": {
      "name", "family", "verdict", "reasons": [...],
      "metrics": { "<checkId>": { "worst", "worstSeed", "p50", "values": { "<seed>": v }, "level", "margin"?, "baseline"?, "delta"?, "excused"?: { "<seed>": why } } },
      "perceptual": { "mix": { "<metric>": { "n", "p50", "worst", "worstSeed" } }, "parts": { "<part>": { "<metric>": { "n", "p50", "worst", "worstSeed" } } } },
      "seeds": { "<seed>": {                          // chart data
        "bars", "secs", "bpm", "chain", "windows": { "peak": [fromBar, toBar], "stems": [...], "ending"?: [...] },
        "octaves": [[hz, dB rel. total], ...], "shares": { "sub", "bass", "lowMid", "mid", "presence", "brilliance", "air" }, "centroidHz",
        "loudness": { "integrated", "deltaTarget", "lra" }, "stereo": {...}, "limiter": { "grMean", "grP1", "strainShare", "over6Share", "grJumpP99" },
        "clipper"/"saturator": { "share1Db", "share3Db", "shaveP50Db", "shaveP99Db", "shaveMaxDb", "hardShare", "inPeakDb" } | null,
        "crest": { "p10Db", "p50Db", "n" } | null, "kickBass": {...} | null,
        "perceptual": { "<metric>": v, "activeSec", "sectionBoundaries" },
        "stems": [ { "id", "notes", "relLu", "buriedShare", "perceptual": {...} } ],
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
