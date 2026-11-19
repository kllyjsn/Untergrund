# Judge order stability

Model: `google/gemini-2.5-flash`. Repetitions: 2. Requests attempted: 639. Fixed seeds 42/43. Audio is generated locally, not committed.

Stable: three 20-second mono loudness-matched windows centered at 20/50/80%, absolute anchored scores, margin 0.75, both orders. Legacy: exact PR #182 prompt and 30–54s window. Flip means unblinded order decisions differ (including same vs preference); controls require success in both orders. Errors excluded from rates, but force uncalibrated. These small samples are diagnostics, not proof of generalization. Calibration is specific to this model/protocol and genre.

Human anchor (corrected key, pair-level ratings): Trap halfway decent; Minimal, Drill and Hard Techno terrible (not smooth, jarring sounds, toy-like instruments). These seed-42/43 renders are proxies, not independently human-rated recordings. The supplied metadata (2026-11-19, b712b9c vs 5d64e97) again ranks Trap first; the other three remain bad in both halves with no preference. Exact pack audio returned HTTP 401 and its head revision was unavailable locally, so the optional exact-pack reproduction was skipped; no claims about its base/head decision are made. Acceptable means mean absolute overall score ≥6/10 for either version across windows, orders and repetitions. Either version acceptable in a terrible genre fails calibration. Trap is a soft anchor; report ordering against each terrible genre, failing only if below all three. Legacy has no absolute score and cannot detect this failure. Human expectations are never revealed in the scoring prompt.

Position-bias audit: [seed-42 blind pilot](judge-position-bias-audit.md) found legacy chose A on 27/28 identical-audio presentations, including Minimal; A/A unblinds to base/head and counts as both a flip and false preference, never agreement. Its 350 Hz lowpass comparisons agreed in 6/6 pairs. The present benchmark measures both mild 7 kHz lowpass and severe 350 Hz lowpass controls; combined degraded accuracy must pass the gate.

| Genre | Protocol | Same flips | Mild flips | Severe flips | Seed flips | Overall flips | Same false preference | Mild accuracy | Severe accuracy | Either acceptable | Agrees with human listener | Calibration | Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hypnotic-techno | legacy | 100.0% | 100.0% | 0.0% | 100.0% | 71.4% | 100.0% | 0.0% | 100.0% | n/a | cannot detect | uncalibrated | 1 |
| hypnotic-techno | stable | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | true | not rated | uncalibrated | 0 |
| deep-house | legacy | 100.0% | 100.0% | 0.0% | 100.0% | 75.0% | 100.0% | 0.0% | 100.0% | n/a | cannot detect | uncalibrated | 0 |
| deep-house | stable | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | true | not rated | uncalibrated | 0 |
| neo-soul | legacy | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.0% | n/a | cannot detect | uncalibrated | 0 |
| neo-soul | stable | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | true | not rated | uncalibrated | 0 |
| ambient | legacy | 100.0% | 100.0% | 0.0% | 100.0% | 75.0% | 100.0% | 0.0% | 100.0% | n/a | cannot detect | uncalibrated | 0 |
| ambient | stable | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | true | not rated | uncalibrated | 0 |
| liquid-dnb | legacy | 100.0% | 100.0% | 0.0% | 100.0% | 75.0% | 100.0% | 0.0% | 100.0% | n/a | cannot detect | uncalibrated | 0 |
| liquid-dnb | stable | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | true | not rated | uncalibrated | 0 |
| boom-bap | legacy | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.0% | n/a | cannot detect | uncalibrated | 0 |
| boom-bap | stable | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | true | not rated | uncalibrated | 0 |
| minimal | legacy | 100.0% | 100.0% | 0.0% | 100.0% | 75.0% | 100.0% | 0.0% | 100.0% | n/a | cannot detect | uncalibrated | 0 |
| minimal | stable | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | true | false | uncalibrated | 0 |
| uk-drill | legacy | 100.0% | 100.0% | 0.0% | 100.0% | 75.0% | 100.0% | 0.0% | 100.0% | n/a | cannot detect | uncalibrated | 0 |
| uk-drill | stable | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | true | false | uncalibrated | 0 |
| hard-techno | legacy | 100.0% | 100.0% | 0.0% | 100.0% | 75.0% | 100.0% | 0.0% | 100.0% | n/a | cannot detect | uncalibrated | 0 |
| hard-techno | stable | 0.0% | 0.0% | 100.0% | 0.0% | 25.0% | 0.0% | 0.0% | 0.0% | true | false | uncalibrated | 0 |
| trap | legacy | 100.0% | 100.0% | 0.0% | 100.0% | 75.0% | 100.0% | 0.0% | 100.0% | n/a | cannot detect | uncalibrated | 0 |
| trap | stable | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | true | false | uncalibrated | 0 |

Trap pair mean: 7.00; near acceptable (≥5.5): true; exceeds Minimal/Drill/Hard Techno respectively: false/false/false. Soft-anchor gate fails only when below all three.

## Offline margin sensitivity

Re-aggregated the same raw scores (no extra API calls), rather than changing prompts mid-sample. A larger deadband can remove flips through abstention without improving detection; retain 0.75 rather than tune away failed controls.

| Margin | Stable flips overall | Degraded accuracy |
| --- | --- | --- |
| 0.5 | 12.5% | 0.0% |
| 0.75 | 2.5% | 0.0% |
| 1 | 2.5% | 0.0% |
| 1.5 | 0.0% | 0.0% |

Interpretation: read flips together with controls. Constant or near-constant scores can yield zero flips while failing every degraded control; that is not a useful calibrated judge. A low flip rate alone is not evidence of listening accuracy, and failed genres remain uncalibrated. Acceptability on these proxy renders is not a re-rating of the original human pack.

Raw responses, order decisions, sample counts and errors: [judge-stability-results.json](judge-stability-results.json).

## Model screening comparison

Stable scoring only; one repetition, both orders across three windows, four genres, same/mild/severe controls plus the actual private human-rated pack. Private per-half scores and identifiers are stored outside this repository. The pack labels are not disclosed in the scoring prompt. Degraded accuracy requires the clean candidate in both orders. A pass requires control calibration, Trap strictly above each bad genre, no bad genre acceptable, no false preference on its human-rated halves, and a calibrated full benchmark. Error rows contain partial controls only; missing tests are not passes.

| Model | Controls /12; pack genres /4 | Requests | Null false preference | Mild accuracy | Severe accuracy | Flips | Trap above all three | Any bad genre acceptable | Passes everything | Error / full run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| google/gemini-2.5-pro | 2; 0 | 18 | 0.0% | 0.0% | n/a | 0.0% | n/a | n/a | false | Audio response unavailable or invalid after one retry |
| google/gemini-3.1-pro-preview | 12; 4 | 111 | 0.0% | 0.0% | 100.0% | 0.0% | false | false | false | not eligible |
| google/gemini-3.8-flash | 12; 4 | 101 | 0.0% | 0.0% | 25.0% | 25.0% | false | true | false | not eligible |
| google/gemini-4-hydrogen | 8; 0 | 68 | 0.0% | 0.0% | 66.7% | 12.5% | n/a | n/a | false | Audio response unavailable or invalid after one retry |
| openai/gpt-audio-mini | 0; 0 | 2 | n/a | n/a | n/a | n/a | n/a | n/a | false | OpenRouter HTTP 400 |
| qwen/qwen3.8-omni-flash | 12; 4 | 107 | 0.0% | 0.0% | 25.0% | 8.3% | false | true | false | not eligible |

Requests: 407; reported/estimated API cost: $3.3945; conservative charge including failed/missing-usage requests: $3.6590 (budget $18). No private half-level scores or pair identifiers are published. Per-genre aggregates: [judge-model-comparison.json](judge-model-comparison.json).

Models eligible for the full ten-genre, two-repetition benchmark: 0. Models completing it: 0.

To repeat, first create the ignored audio fixtures with the stability benchmark, then run `node scripts/judge-models.mjs --private-manifest /private/manifest.json --private-audio-root /private/audio --private-out /private/judge-models --budget 18`. The private output directory must exist outside this repository; its checkpoint resumes completed trials without rescoring them. Model selection in the ordinary stability benchmark also honors `LISTEN_JUDGE_MODEL`.
