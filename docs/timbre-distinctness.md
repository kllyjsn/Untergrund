# Timbre distinctness (advisory, not a release gate)

```
npm run benchmark:timbre
npm run benchmark:timbre -- --ref origin/main --json test/out/timbre-main.json
git fetch origin pull/242/head:refs/remotes/origin/pr242 pull/243/head:refs/remotes/origin/pr243
npm run benchmark:timbre -- --ref origin/pr242 --json test/out/timbre-pr242.json
npm run benchmark:timbre -- --ref origin/pr243 --json test/out/timbre-pr243.json
# Alternatively: --root /absolute/path/to/an/existing/worktree
node test/timbre.mjs
```

The evaluator comes from the invoking checkout; `--ref` creates and removes a detached worktree of the target. No evaluator files are copied into that tree. `--root` serves an existing worktree, including its uncommitted changes. Chrome is required; its absence is an error, not a passing measurement. JSON is written under `test/out/` by default (ignored by git). No listening-pack audio, keys or clip identifiers are consumed or emitted.

## Method

All `STYLES` in the target's `js/state.js`, three fixed seeds (11, 42, 1234), eight densest bars per song. Uses `song`, `plan`, and `render` from `test/audio-quality-page.js`, the same offline sequencer used by the audio benchmark and listening packs. Captures the actual pre-master stereo stems with `js/stems.js` routing in one render per seed, 24 kHz plus one second of tail. Returns and vocals are excluded rather than mistaken for instruments. There is no full-mix substitution: the renderer can isolate stems.

Role groups are bass (acid/contrabass), chords (stab), lead (hook), drums, strings, winds, keys. Orchestral groups are kept separate, not falsely called electronic chords or lead. A missing role remains explicitly missing, even if its absence is intentional.

For each summed role, RMS-normalize the waveform (a loudness proxy, **not** BS.1770 perceptual loudness), Hann-window FFT using the lab's existing FFT, at most approximately 160 windows. Compute 24 equal-mel-width power bands; log the normalized time-mean band energies. Also retain centroid, geometric/arithmetic spectral flatness, and 85% rolloff. This is a log mean spectrum, not a mean of framewise log spectra. Spectra describe the played register as well as the instrument.

At recorded note onsets, measure a 5 ms RMS envelope: time to 90% peak, early post-peak decay/late sustain ratio, and time after note-off to 10% peak. Aggregate with medians. Require two isolated envelopes with observable releases per seed; overlapping notes, busy drum patterns, held pads and tails beyond the excerpt can be **UNMEASURED**. These are played-envelope proxies, not recovered synth ADSR parameters. Alignment comes from the sequencer recorder, not transient detection; humanization is approximate.

Standardize each feature across the rendered style/seed population within its role (SD floor 0.05); distance is RMS standardized Euclidean distance, with each coordinate equally weighted. The 24 spectral coordinates consequently have more weight than the envelope coordinates. Between distance is the mean of all cross-genre seed distances; noise is all off-diagonal within-genre seed distances. For 300 deterministic bootstrap replicates, resample each genre's seeds with replacement for the between estimate and resample within distances for the noise estimate. Require the lower 95% percentile bound of between-minus-noise to exceed zero. Three seeds give only a coarse, exploratory uncertainty estimate, not calibrated statistical significance; pairwise multiple comparisons are not corrected.

Only separable roles receive similarity `1/(1+distance)` (higher is more alike). Identical signals have the smallest raw feature distance, but identical genres cannot be statistically separated: they correctly become **UNMEASURED**, not a fake 1.0 pass. Missing, silent (< -120 dBFS RMS), invalid or envelope-censored roles have null scores and reasons.

A full pair score requires all seven roles to be measured. This conservative rule means a normal electronic pair, lacking orchestral roles, is **UNMEASURED** overall. `partialSimilarity` is an explicitly incomplete screening aid averaging only measured roles; its highest-scoring role is the driver. The CLI ranks these partial candidates, **not** asserted whole-genre nearest neighbours. JSON provides every pair's per-role results and a per-genre summary with a null verified neighbour and an optional partial candidate. Compare coverage before comparing partial scores; different role subsets are not directly comparable. Human ears must resolve the unknowns.

## Limits and interpretation

This measures a few arranged passages, not every available voice or the whole song. Pitch, voicing, articulation, velocity, EQ, sidechain and arrangement affect results. Silence and overlapping sustained instruments deliberately reduce coverage. Per-run standardization makes cross-ref scalar differences descriptive only: inspect role distances/coverage and listen, rather than treating a tiny ranking change as improvement. Browser DSP and sample decoding can vary slightly. No aesthetic quality, genre correctness, complexity or human preference is inferred. Increasing independent seeds and collecting human timbre judgements are the next calibration steps.

## Main-branch top ten

Main `d0d4a99131064089cfc5cf0127cfa31344d328d7`; PR 242 head `9cb33c5198902984b05774e6b04140bc6239571f`; PR 243 head `7c33580c201ffe990fca1b50620c03ab25cc9fec`. Each run rendered 102 excerpts (34 styles), zero render errors, 561 pairs. **All whole-pair scores and verified nearest neighbours are UNMEASURED**. Every candidate below has only one measured role; the displayed number is that role's similarity, not a whole-genre score. All other roles are UNMEASURED. Unrounded distances, noise estimates, confidence intervals, failure reasons and all per-genre partial candidates are in the JSON reports.

| Rank | Main pair | Measured role similarity | Driver |
|---|---|---:|---|
| 1 | trap / jerseyclub | 0.743 | drums |
| 2 | pop / rock | 0.738 | drums |
| 3 | breaks / jerseyclub | 0.728 | drums |
| 4 | ukg / trap | 0.727 | drums |
| 5 | minimal / trance | 0.717 | bass |
| 6 | ukg / breaks | 0.711 | drums |
| 7 | euphoric / trap | 0.708 | drums |
| 8 | ukg / euphoric | 0.696 | drums |
| 9 | boombap / rnb | 0.694 | drums |
| 10 | breaks / trap | 0.691 | drums |

Main has 314 measured role/seed observations of 714: 307 are silent and 93 lack two usable envelopes. The bootstrap further removes nonseparable pair/role comparisons. This is insufficient evidence for a global timbre-distinctness verdict.

### PR 242

| Rank | Pair (overall UNMEASURED) | Measured role similarity | Driver |
|---|---|---:|---|
| 1 | trap / jerseyclub | 0.742 | drums |
| 2 | pop / rock | 0.737 | drums |
| 3 | minimal / trance | 0.716 | bass |
| 4 | euphoric / trap | 0.702 | drums |
| 5 | dnb / trap | 0.693 | drums |
| 6 | boombap / rnb | 0.693 | drums |
| 7 | neosoul / rnb | 0.690 | drums |
| 8 | ukg / euphoric | 0.689 | drums |
| 9 | ukg / jerseyclub | 0.686 | drums |
| 10 | rnb / rock | 0.679 | drums |

Source diff against main: changes the seed-selected instrument ensembles for hypnotic, industrial, peak, deep house, UKG, euphoric, breaks, DnB, trance, ambient, afrobeats, reggaeton and hyperpop; chooses recorded kit 1 for breaks and kit 3 for DnB; trims one deep-house organ ensemble. Adds palette/preload tests and updates audio baselines. The old breaks candidates no longer appear in the top ten, but this is not a demonstrated perceptual improvement. Coverage is 316 measured role/seed observations. Standardization changes globally, so even untouched pairs' scores can move.

### PR 243

Top ten, drivers and role similarities are the same as main to three decimals (table above); every whole-pair score remains UNMEASURED. Coverage is 315 measured role/seed observations.

Source diff against main: Drill gains recorded cello/clarinet chords and oboe/airy-flute leads alongside its harp option. Adds wind tuning/lead-in/gain calibration, loads hook samples before playback, and separates body-EQ caches by destination **and tone**. Extends voice names/UI descriptions and tests. Drill seed 42 now has a measurable chord envelope; main did not. Drill still has no measurable bass envelope in any of these seeds, and the global top ten does not test the intended new voices directly. The eval does **not** establish that the PR sounds better or more distinct to humans.
