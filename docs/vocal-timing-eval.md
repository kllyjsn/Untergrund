# Real-stem vocal timing eval

Club Rooms vocal PRs change how the sung stem is re-anchored to a breathing (rubato) grid. Synthetic formant fixtures
(`test/rubato-vocal-fixture.mjs`) overstated those gains: Music's real UKG and Euphoric stems showed mid-note cuts the
fixtures never had. This eval scores a revision on Music's real sung input before the PR reaches Music.

```
node scripts/vocal-timing-eval.mjs --stems <private dir> --base origin/main --head HEAD [--json out.json] [--assert]
```

## Inputs stay private

Audio never enters this repo. `test/vocal-timing-inputs.json` pins the three stems by sha256 (UKG seed 1329387711,
Euphoric seed 1320111611, and the 22 s looped Euphoric stress input from the PR 301 review), with the excerpt offsets
(13.5 s, 44.5 s, 0 s). The eval reads them from `--stems` or `VOCAL_STEMS_DIR`, or fetches them from a private base URL
in `VOCAL_STEMS_URL` (optional `VOCAL_STEMS_TOKEN` bearer) into `test/out/vocal-timing/stems/`. A file whose hash differs
is refused. With no source configured it prints `UNMEASURED` and exits 0 (`--require` makes that exit 1). Ask Music, via
Max, for the stems.

## What it renders

Music's PR 297 review harness, made repeatable: Chromium `OfflineAudioContext`, 48 kHz, 123 BPM,
`rubatoMap(2048, 16, [], 1)`, an established transport with residual 0, +28 and −28 ms, dry vocal only. The production
post-tick vocal block is cut out of `js/main.js` and run against the real `Engine` methods (quiet-gap search, forced
crossfade, slews), with `variableScoreTempo` set as `Sequencer.scoreStep` sets it for a stretched score; the pre-tick
transport resync is mirrored. Each `--base` / `--head` ref renders from a detached git
worktree under `test/out/vocal-timing/`, so any two commits compare on identical input. Nine cases (3 stems × 3
residuals) render in about 4 s.

## What it scores (`test/vocal-timing-metrics.mjs`)

- **Time over 50 ms**: the vocal's lateness against the scheduled grid, sampled every 1 ms from T0+50 ms to T0+21.7 s
  through the integrated source playhead (Music's an6.py method, unvoiced regions included), with the longest stretch,
  peak and end drift.
- **Voiced cuts**: every source replacement where YIN (1024-sample comparison) finds pitch on both sides of the splice
  in the render (−40/−20 ms and 0/+20 ms).
- **Midpoint pitch separation**: at each voiced cut's crossfade midpoint (start + 15 ms) the outgoing and incoming
  playheads are measured at once on the dry stem with centred 2048- and 4096-sample YIN, including playbackRate
  (pitch.py's corrected method). The larger magnitude is the cut's separation.
- **Moving cuts**: the largest pitch movement per 10 ms within ±40 ms of either playhead. Music's boundary detector
  (`detector.py`) needs pitch steady within 40 c on both sides, so it misses short transitions such as 21.44–21.46 s on
  the stress loop. This eval never uses detector boundaries as ground truth: it measures the pitch that is actually
  sounding at the fade, so a cut inside a short transition still scores.

## Gate (advisory, calibrated on Music's verdicts)

`compare(base, head)` returns **hold** when a voiced forced fade separates by 90 c (about a semitone) or more and more
than base, or time over 50 ms grows by more than 0.25 s in any case; **notes** when voiced cuts are added but stay under
a semitone, or peak drift rises; otherwise **pass**. `--assert` exits 1 on hold.

| PR (base → head) | Music's verdict | Eval |
|---|---|---|
| 297 first head (01b34f5 → b3d6b2c) | Hold: 4 Euphoric voiced cuts | hold: 4 Euphoric voiced cuts, one at 154 c |
| 297 merged head (01b34f5 → 5fe8024) | Ship (stress loop not yet in the kit) | hold: stress −28 ms time over 50 ms 9.1 → 15.8 s |
| 301 (46311e0 → 07c8726) | Ship with notes: fade −48/−68 c | notes: stress −28 ms fades −12/−4 c and −49/−68 c |
| 302 (cd8f1db → fff5dca) | Hold: fades +68/+91 c, +97/+78 c | hold: stress −28 ms fades +68/+91 c and +97/+78 c |

It reproduces Music's stress −28 ms tables: time over 50 ms 15.79 s (46311e0), 11.15 s (07c8726) and 10.83 s
(fff5dca), the same fade times, and fade pitch within about 1 c (PR 301b's corrected −217/−164 c at 21.357 s measures
−218/−164 c here). It ranks timing defects; it does not replace Music's listen.
