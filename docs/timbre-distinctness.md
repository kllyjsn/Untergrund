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

Measure 5 ms RMS envelopes at recorded note onsets: time to 90% peak, early post-peak decay/late sustain ratio, and note-off to 10% peak. Require two distinct uncensored onset events; overlapping notes, short gates and long tails can prevent this. Deduplicate simultaneous chord tones rather than treating them as independent envelopes. These are played-envelope proxies, not recovered synth ADSR. Recorder timing only approximately follows humanization.

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

## Six-seed results

All runs: **204 renders (34 styles × six seeds), zero render errors; 495 measured / 66 UNMEASURED pairs of 561**. Of the 66 failures, 65 involve piano-only nocturne/repertoire, with at most one shared melodic role; the other is industrial/electro, whose bass and chord CIs exceed the width limit, leaving only lead. These are not backwards separability failures. Combined and melodic-only rankings below include bootstrap 95% CIs; overlapping CIs do not establish a strict ordering.

### Main — `d0d4a99131064089cfc5cf0127cfa31344d328d7`

JSON: `test/out/timbre-main.json`.

| Rank | Combined pair | Similarity [95% CI] | Driver |
|---|---|---|---|
| 1 | industrial / peak | 0.656 [0.623, 0.695] | lead |
| 2 | industrial / acid | 0.647 [0.615, 0.681] | lead |
| 3 | acid / peak | 0.637 [0.604, 0.676] | lead |
| 4 | hypnotic / electro | 0.622 [0.585, 0.657] | lead |
| 5 | acid / electro | 0.605 [0.560, 0.647] | lead |
| 6 | reggaeton / trap | 0.600 [0.557, 0.656] | bass |
| 7 | neosoul / boombap | 0.595 [0.567, 0.629] | bass |
| 8 | afrobeats / trap | 0.578 [0.536, 0.624] | bass |
| 9 | trap / jerseyclub | 0.577 [0.553, 0.602] | bass |
| 10 | peak / electro | 0.575 [0.534, 0.617] | lead |

**Melodic only (no drums):**

| Rank | Pair | Similarity [95% CI] | Driver |
|---|---|---|---|
| 1 | industrial / peak | 0.667 [0.628, 0.714] | lead |
| 2 | hypnotic / electro | 0.634 [0.592, 0.675] | lead |
| 3 | industrial / acid | 0.632 [0.594, 0.673] | lead |
| 4 | acid / peak | 0.631 [0.595, 0.675] | lead |
| 5 | deephouse / ambient | 0.615 [0.572, 0.653] | bass |
| 6 | acid / electro | 0.614 [0.558, 0.664] | lead |
| 7 | reggaeton / trap | 0.613 [0.566, 0.677] | bass |
| 8 | euphoric / ambient | 0.599 [0.550, 0.642] | bass |
| 9 | peak / electro | 0.596 [0.547, 0.646] | lead |
| 10 | neosoul / boombap | 0.596 [0.563, 0.631] | bass |

### PR 242 head — `9cb33c5198902984b05774e6b04140bc6239571f`

JSON: `test/out/timbre-pr242.json`.

| Rank | Combined pair | Similarity [95% CI] | Driver |
|---|---|---|---|
| 1 | industrial / acid | 0.644 [0.610, 0.681] | lead |
| 2 | acid / peak | 0.637 [0.600, 0.677] | lead |
| 3 | industrial / peak | 0.635 [0.593, 0.680] | lead |
| 4 | hypnotic / electro | 0.620 [0.584, 0.661] | lead |
| 5 | acid / electro | 0.609 [0.563, 0.650] | lead |
| 6 | neosoul / boombap | 0.593 [0.564, 0.625] | bass |
| 7 | euphoric / ambient | 0.587 [0.562, 0.620] | bass |
| 8 | peak / electro | 0.580 [0.539, 0.623] | lead |
| 9 | trap / jerseyclub | 0.576 [0.553, 0.603] | bass |
| 10 | reggaeton / trap | 0.575 [0.539, 0.624] | bass |

**Melodic only (no drums):**

| Rank | Pair | Similarity [95% CI] | Driver |
|---|---|---|---|
| 1 | industrial / peak | 0.642 [0.592, 0.696] | lead |
| 2 | acid / peak | 0.632 [0.590, 0.676] | lead |
| 3 | hypnotic / electro | 0.631 [0.591, 0.678] | lead |
| 4 | euphoric / ambient | 0.628 [0.600, 0.667] | bass |
| 5 | industrial / acid | 0.628 [0.586, 0.673] | lead |
| 6 | acid / electro | 0.618 [0.562, 0.668] | lead |
| 7 | deephouse / ambient | 0.609 [0.566, 0.638] | bass |
| 8 | peak / electro | 0.602 [0.552, 0.653] | lead |
| 9 | neosoul / boombap | 0.592 [0.560, 0.627] | bass |
| 10 | reggaeton / trap | 0.586 [0.547, 0.639] | bass |

### PR 243 head — `076603e972d26ab1007f785ad0fd11b6695cce3c`

JSON: `test/out/timbre-pr243.json`.

| Rank | Combined pair | Similarity [95% CI] | Driver |
|---|---|---|---|
| 1 | industrial / peak | 0.655 [0.622, 0.695] | lead |
| 2 | industrial / acid | 0.647 [0.614, 0.681] | lead |
| 3 | acid / peak | 0.636 [0.604, 0.675] | lead |
| 4 | hypnotic / electro | 0.622 [0.585, 0.657] | lead |
| 5 | acid / electro | 0.605 [0.560, 0.647] | lead |
| 6 | reggaeton / trap | 0.599 [0.556, 0.655] | bass |
| 7 | neosoul / boombap | 0.595 [0.566, 0.628] | bass |
| 8 | afrobeats / trap | 0.577 [0.535, 0.622] | bass |
| 9 | trap / jerseyclub | 0.576 [0.553, 0.602] | bass |
| 10 | peak / electro | 0.575 [0.534, 0.617] | lead |

**Melodic only (no drums):**

| Rank | Pair | Similarity [95% CI] | Driver |
|---|---|---|---|
| 1 | industrial / peak | 0.666 [0.628, 0.713] | lead |
| 2 | hypnotic / electro | 0.634 [0.592, 0.675] | lead |
| 3 | acid / peak | 0.631 [0.594, 0.675] | lead |
| 4 | industrial / acid | 0.631 [0.593, 0.673] | lead |
| 5 | deephouse / ambient | 0.614 [0.572, 0.653] | bass |
| 6 | acid / electro | 0.614 [0.558, 0.664] | lead |
| 7 | reggaeton / trap | 0.612 [0.565, 0.676] | bass |
| 8 | euphoric / ambient | 0.598 [0.550, 0.641] | bass |
| 9 | peak / electro | 0.596 [0.547, 0.646] | lead |
| 10 | neosoul / boombap | 0.595 [0.563, 0.630] | bass |

### Drill nearest neighbours (combined)

| Ref | Rank | Neighbour | Similarity [95% CI] | Driver |
|---|---|---|---|---|
| main | 1 | afrobeats | 0.562 [0.538, 0.584] | bass |
| main | 2 | trap | 0.562 [0.528, 0.610] | bass |
| main | 3 | euphoric | 0.550 [0.513, 0.593] | bass |
| pr243 | 1 | afrobeats | 0.569 [0.546, 0.594] | bass |
| pr243 | 2 | jerseyclub | 0.560 [0.545, 0.573] | bass |
| pr243 | 3 | trap | 0.549 [0.529, 0.569] | bass |

### Remaining coverage and PR interpretation

On main, spectra are measurable for bass 187/204, chords 196/204, lead 192/204, pad 36/204 and drums 192/204; every other observation is explicitly absent, with no render/feature failures. Complete envelopes are available for bass 153, chords 88, lead 177, pad 0 and drums 116 observations. Pads therefore use spectra only, not invented envelopes. Role CIs wider than 0.25 exclude 21 bass and 58 chord pair comparisons on main (PR 242: 21/57; PR 243: 21/56); none of the lead CIs is too wide.

PR 242 changes electronic seed-selected instrument ensembles across 13 styles, assigns recorded drum kits to breaks/DnB and trims one deep-house organ ensemble. Its high-similarity techno cluster remains; palette changes alter the ordering and bring euphoric/ambient into the combined top ten. These are descriptive changes, not proof of audible improvement.

PR 243 gives Drill recorded cello/clarinet chords and oboe/airy-flute leads alongside harp, calibrates/preloads the new samples, separates body-EQ caches by tone, and updates MIDI instrument labels. Its fetched head advanced from the earlier 7c33580 to 076603e (the additional change is MIDI labels, not synthesis). Drill neighbours change from afrobeats/trap/euphoric to afrobeats/jerseyclub/trap. Bass still drives each, and broad overlapping CIs prevent a firm perceptual-improvement conclusion. The new melodic voices are now included in scored comparisons rather than suppressed by the old separability rule.

The final shared-role eligibility adjustment was applied to the saved six-seed feature rows without rerendering unchanged audio; reports use the checked-in ranking rules.
