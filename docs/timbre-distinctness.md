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

The evaluator comes from the invoking checkout; `--ref` creates/removes a detached target worktree. `--root` serves an existing worktree, including uncommitted changes. Chrome is required; absence is an error. JSON defaults to ignored `test/out/`. No listening-pack audio, keys or clip identifiers are read or emitted.

## Method (schema v2)

All target `STYLES`, **six seeds: 11, 42, 1234, 73, 211, 997**, eight densest bars per song, 24 kHz and one second of tail. Reuses `song`, `plan`, `render` from `test/audio-quality-page.js` and actual pre-master stereo stem routing from `js/stems.js`, not a substitute synthesizer or full mix. FX returns and vocals are excluded.

Five disjoint role groups:
- **bass:** acid, contrabass;
- **chords:** stab, piano, harp;
- **lead:** hook, flute, oboe, clarinet, horn, trumpet;
- **pad:** orchestral violin/viola/cello strings (a sustained-texture proxy);
- **drums:** kick, snare, clap, hats, ride, percussion, timpani.

Electronic pad voices routed through `stab` remain **chords**: there is no independent electronic pad stem, and counting the same sound twice would inflate melodic coverage. Grouping orchestral parts by musical function is approximate. JSON retains source stem IDs and note counts, so absence can be distinguished from failed measurement.

RMS-normalize each summed role (a loudness proxy, **not** BS.1770); Hann-window FFT using the lab's FFT, approximately 160 windows; 24 equal-mel-width log time-mean power bands plus centroid, flatness and 85% rolloff. These are log mean spectra, not means of framewise log spectra. Register/voicing affect them as well as instrument identity.

Measure 5 ms RMS envelopes at recorded note onsets: time to 90% peak, early post-peak decay/late sustain ratio, and note-off to 10% peak. Require two distinct uncensored onset events; overlapping notes, short gates and long tails can prevent this. Reject both a following onset inside the note/release window and an earlier note whose end plus the same 0.1 s release margin extends past this onset. Deduplicate simultaneous chord tones rather than treating them as independent envelopes. These are played-envelope proxies, not recovered synth ADSR. Recorder timing only approximately follows humanization.

**A censored envelope does not discard a valid spectrum.** Its envelope and envelope vector remain null with `envelopeStatus: UNMEASURED` and a reason; its role still supports a clearly identified spectral-only comparison. No fake attack/release values are imputed. JSON `envelopePairs` counts cross-seed comparisons with both envelopes available.

Standardize spectral and envelope coordinates separately within each role over the rendered population (SD floor 0.05). Distance is RMS standardized Euclidean: 75% spectral squared distance / 25% envelope squared distance when both envelopes exist; spectral-only otherwise. Seed-pair similarity is `1/(1+distance)`; the role estimate averages all cross-genre seed pairs. Within-genre mean off-diagonal distance is context only, **never a separability gate**. Identical instruments can score 1.0.

### Presence, uncertainty and combination

- A silent role (< -120 dBFS RMS) is `ABSENT`, not a measurement failure. Absent in both genres across the seeds: **skip**. Absent in one genre only: **similarity 0**, maximal difference. If both genres sometimes play it, seed-pair presence mismatches score 0 and simultaneous absences score 1.
- Missing/invalid render data are **UNMEASURED**, never treated as absence.
- Bootstrap **500 times over seeds**, independently resampling each genre's complete seed rows with replacement. Use the same sampled indices across every role to retain cross-role dependence. Compute role, combined and melodic-only percentile **95% similarity CIs**.
- A role/pair with CI width **> 0.25** on the 0–1 similarity scale is **UNMEASURED**. This preselected advisory threshold rejects uncertainty spanning more than one quarter of the scale; it is not human-calibrated. Overlapping narrower CIs still mean the exact ordering is uncertain. Unavailable role scores stay null and are listed in `excludedRoles`; the CI, when available, remains visible.
- A pair requires **at least two shared measurable melodic roles** (bass/chords/lead/pad), each present in both genres and passing the CI-width rule. Intermittent roles are included with their seed-presence variability, not rejected by a separate coverage gate. Drums alone, or one melodic role plus drums, cannot qualify.
- Combine all remaining measured shared roles and one-sided presence differences: **weight 3 per melodic role, 1 for drums**. With two shared melodic roles drums have at most 1/7 of the total weight. Both-absent roles do not enter the denominator. Wide-CI roles are explicitly excluded, not silently passed.
- Also rank **melodic-only** scores, excluding drums entirely. Driver is the largest weighted positive contribution to the corresponding similarity. Per-genre summaries contain three nearest measured neighbours, scores, CIs and drivers.

## Why v1 lost chords and leads

The original main JSON (34 styles × three seeds) identifies two different problems, **not a general inability to isolate stems**:

| Original role | Measured seed observations | Envelope-rejected (but nonsilent spectrum retained) | Silent observations | Measured genre pairs | Pair rejections: envelopes / separability / silence |
|---|---:|---:|---:|---:|---|
| chords | 57/102 | 32 | 13 | 7/561 | 416 / 59 / 79 |
| lead | 88/102 | 2 | 12 | 78/561 | 33 / 328 / 122 |
| bass | 74/102 | 19 | 9 | 182/561 | 229 / 71 / 79 |

V1 required usable envelopes in **every seed** to construct a role vector. A single busy/sustained chord excerpt therefore removed every pair involving its genre (only 12/34 genres had all three chord seeds accepted). All 32 envelope-rejected chord observations had nonempty spectra; e.g. industrial seed 1234 had centroid 1079 Hz. This disproves missing/silent stems as their explanation. Lead extraction itself was mostly healthy (29/34 genres had all three seeds accepted), but the backwards between-distance-minus-noise gate rejected **328** lead comparisons precisely because they were not separable. Finally, requiring all seven old role groups made electronic pairs fail for absent orchestral instruments. V2 removes all three decision-rule failures while preserving explicit unknown envelope fields.

Some silence is real excerpt/role coverage: old lead silence was the four classical styles, whose winds were in a separate role; old chord silence included classical piano/strings in other roles and one electro seed. V2's functional groups fix that taxonomy mismatch without inventing stems. The rerun reports below disclose any remaining absent/uncertain roles.

## Limits

This is a seed-sampled arranged-passage descriptor, not an isolated preset audition or a human quality judgement. Pitch, harmony, articulation, processing and sample decoding all matter. Envelope availability changes which feature components are comparable; inspect per-role coverage. Population standardization is per ref, so small cross-ref scalar changes are not proof of improvement. Presence decisions and CIs are conditional on the sampled seeds; six seeds do not exhaust every palette. No perceptual calibration, multiple-comparison correction or claim of statistically unique ordering. Listen to assess aesthetic value and whether apparently similar timbres matter musically.

## Six-seed results after envelope-isolation fix

All runs were fully rerendered with the corrected feature extractor: **204 renders (34 styles × six seeds), zero render errors; 494 measured / 67 UNMEASURED pairs of 561** per ref. Of the 67 failures, 65 involve piano-only nocturne/repertoire; industrial/electro and ambient/afrobeats also lack two shared melodic roles passing the CI-width rule. Combined and melodic-only rankings include bootstrap 95% CIs; overlapping CIs do not establish a strict ordering.

Main advanced since the prior evaluation and now has the same synthesis/sample files as PR 243 (their tree diff contains only main UI and club-sync tests). The evaluated main is ac53fb5; the subsequently merged fe8986d adds playback analytics, not renderer changes. Therefore main versus PR 243 is no longer a before/after comparison of its voices.

### Main — `ac53fb55ef439abbbc5cc8ee5ed71419b756ce7b`

JSON: `test/out/timbre-main.json`.

**Combined:**

| Rank | Pair | Similarity [95% CI] | Driver |
|---|---|---|---|
| 1 | industrial / peak | 0.651 [0.618, 0.691] | lead |
| 2 | industrial / acid | 0.643 [0.612, 0.675] | lead |
| 3 | acid / peak | 0.635 [0.600, 0.676] | lead |
| 4 | hypnotic / electro | 0.613 [0.580, 0.651] | lead |
| 5 | reggaeton / trap | 0.600 [0.559, 0.656] | bass |
| 6 | acid / electro | 0.596 [0.550, 0.637] | lead |
| 7 | hypnotic / trance | 0.594 [0.559, 0.631] | bass |
| 8 | neosoul / boombap | 0.591 [0.549, 0.635] | bass |
| 9 | trap / jerseyclub | 0.582 [0.559, 0.609] | bass |
| 10 | afrobeats / trap | 0.580 [0.538, 0.627] | bass |

**Melodic only (no drums):**

| Rank | Pair | Similarity [95% CI] | Driver |
|---|---|---|---|
| 1 | industrial / peak | 0.662 [0.623, 0.710] | lead |
| 2 | acid / peak | 0.630 [0.591, 0.674] | lead |
| 3 | industrial / acid | 0.627 [0.588, 0.664] | lead |
| 4 | hypnotic / electro | 0.624 [0.585, 0.665] | lead |
| 5 | reggaeton / trap | 0.610 [0.563, 0.672] | bass |
| 6 | euphoric / ambient | 0.606 [0.564, 0.648] | bass |
| 7 | acid / electro | 0.603 [0.548, 0.652] | lead |
| 8 | hypnotic / trance | 0.598 [0.562, 0.637] | bass |
| 9 | neosoul / boombap | 0.593 [0.546, 0.641] | bass |
| 10 | deephouse / ambient | 0.587 [0.550, 0.626] | bass |

### PR 242 — `9cb33c5198902984b05774e6b04140bc6239571f`

JSON: `test/out/timbre-pr242.json`.

**Combined:**

| Rank | Pair | Similarity [95% CI] | Driver |
|---|---|---|---|
| 1 | industrial / acid | 0.640 [0.606, 0.674] | lead |
| 2 | acid / peak | 0.636 [0.597, 0.676] | lead |
| 3 | industrial / peak | 0.631 [0.592, 0.675] | lead |
| 4 | hypnotic / electro | 0.610 [0.573, 0.652] | lead |
| 5 | acid / electro | 0.599 [0.554, 0.640] | lead |
| 6 | hypnotic / trance | 0.597 [0.552, 0.633] | bass |
| 7 | neosoul / boombap | 0.590 [0.548, 0.634] | bass |
| 8 | euphoric / ambient | 0.589 [0.562, 0.625] | bass |
| 9 | trap / jerseyclub | 0.583 [0.559, 0.610] | bass |
| 10 | ukg / jerseyclub | 0.577 [0.541, 0.614] | lead |

**Melodic only (no drums):**

| Rank | Pair | Similarity [95% CI] | Driver |
|---|---|---|---|
| 1 | industrial / peak | 0.638 [0.591, 0.689] | lead |
| 2 | euphoric / ambient | 0.635 [0.604, 0.676] | bass |
| 3 | acid / peak | 0.631 [0.587, 0.674] | lead |
| 4 | industrial / acid | 0.623 [0.582, 0.665] | lead |
| 5 | hypnotic / electro | 0.620 [0.579, 0.667] | lead |
| 6 | acid / electro | 0.607 [0.553, 0.655] | lead |
| 7 | hypnotic / trance | 0.601 [0.553, 0.642] | bass |
| 8 | neosoul / boombap | 0.591 [0.544, 0.641] | bass |
| 9 | peak / electro | 0.591 [0.541, 0.641] | lead |
| 10 | deephouse / ambient | 0.589 [0.529, 0.640] | bass |

### PR 243 — `076603e972d26ab1007f785ad0fd11b6695cce3c`

JSON: `test/out/timbre-pr243.json`.

**Combined:**

| Rank | Pair | Similarity [95% CI] | Driver |
|---|---|---|---|
| 1 | industrial / peak | 0.651 [0.618, 0.691] | lead |
| 2 | industrial / acid | 0.643 [0.612, 0.675] | lead |
| 3 | acid / peak | 0.635 [0.600, 0.676] | lead |
| 4 | hypnotic / electro | 0.613 [0.580, 0.651] | lead |
| 5 | reggaeton / trap | 0.600 [0.559, 0.656] | bass |
| 6 | acid / electro | 0.596 [0.550, 0.637] | lead |
| 7 | hypnotic / trance | 0.594 [0.559, 0.631] | bass |
| 8 | neosoul / boombap | 0.591 [0.549, 0.635] | bass |
| 9 | trap / jerseyclub | 0.582 [0.559, 0.609] | bass |
| 10 | afrobeats / trap | 0.580 [0.538, 0.627] | bass |

**Melodic only (no drums):**

| Rank | Pair | Similarity [95% CI] | Driver |
|---|---|---|---|
| 1 | industrial / peak | 0.662 [0.623, 0.710] | lead |
| 2 | acid / peak | 0.630 [0.591, 0.674] | lead |
| 3 | industrial / acid | 0.627 [0.588, 0.664] | lead |
| 4 | hypnotic / electro | 0.624 [0.585, 0.665] | lead |
| 5 | reggaeton / trap | 0.610 [0.563, 0.672] | bass |
| 6 | euphoric / ambient | 0.606 [0.564, 0.648] | bass |
| 7 | acid / electro | 0.603 [0.548, 0.652] | lead |
| 8 | hypnotic / trance | 0.598 [0.562, 0.637] | bass |
| 9 | neosoul / boombap | 0.593 [0.546, 0.641] | bass |
| 10 | deephouse / ambient | 0.587 [0.550, 0.626] | bass |

### Drill nearest neighbours (combined)

| Ref | Rank | Neighbour | Similarity [95% CI] | Driver |
|---|---|---|---|---|
| main | 1 | afrobeats | 0.571 [0.548, 0.595] | bass |
| main | 2 | jerseyclub | 0.550 [0.532, 0.563] | bass |
| main | 3 | trap | 0.547 [0.528, 0.566] | bass |
| pr243 | 1 | afrobeats | 0.571 [0.548, 0.595] | bass |
| pr243 | 2 | jerseyclub | 0.550 [0.532, 0.563] | bass |
| pr243 | 3 | trap | 0.547 [0.528, 0.566] | bass |

### Remaining coverage and PR interpretation

On main, spectra are measurable for bass 187/204, chords 196/204, lead 192/204, pad 36/204 and drums 192/204; every other observation is explicitly absent, with no render/feature failures. Complete envelopes are available for bass 132, chords 72, lead 148, pad 0 and drums 51 observations. Pads therefore use spectra only, not invented envelopes. Role CIs wider than 0.25 exclude 22 bass and 56 chord comparisons on main (PR 242: 21/57; PR 243: 22/56); none of the lead CIs is too wide.

The earlier-note overlap guard reduces envelope coverage without discarding spectra. Compared with the preceding report, main industrial/peak moves from 0.656 to 0.651 and ambient/afrobeats becomes UNMEASURED. Main also advanced to include PR 243, so changes from the preceding main report cannot all be attributed to envelope isolation.

PR 242 changes electronic seed-selected instrument ensembles across 13 styles, assigns recorded drum kits to breaks/DnB and trims one deep-house organ ensemble. Its high-similarity techno cluster remains; palette changes alter the ordering and bring euphoric/ambient into the combined top ten. These are descriptive changes, not proof of audible improvement.

PR 243 gives Drill recorded cello/clarinet chords and oboe/airy-flute leads alongside harp, calibrates/preloads samples, separates body-EQ caches by tone, and updates MIDI instrument labels. Because the new main already includes these changes, its global top ten and Drill neighbours now match PR 243 to three decimals. Drill neighbours are afrobeats/jerseyclub/trap, all bass-driven. Broad overlapping CIs prevent a firm perceptual-improvement conclusion.
