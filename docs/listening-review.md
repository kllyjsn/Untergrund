# Expert listening review

Max can run this on music-affecting PRs before posting a review. It compares our own fixed-seed generated music at the PR base and current checkout. No copyrighted/reference recordings are used or fetched. Generated audio and review artifacts stay local in ignored `test/out/`; never add recordings to git.

```
npm run review:listen -- --base origin/main
npm run review:listen -- --base <PR-base-sha> --only deep-house,ambient --judge --pages 2
npm run review:listen -- --base <PR-base-sha> --judge --comment 123
```

Options: `--out DIR` (default `test/out/listen-review`), `--pages N` (3), `--only id,id` (six diverse prompts in `REVIEW_IDS`, `js/listen-review.js`), `--base REF` (`origin/main`), `--judge`, `--comment PR`. Node 22, Chrome and ffmpeg are required; commenting requires authenticated `gh`. Base must contain `scripts/suno-benchmark.mjs`. A detached base worktree is created beneath the output directory, shares installed node_modules (otherwise npm ci), and is removed even after render failure. Current checkout changes are included in head rendering; `review.json` records dirty status. Run from a clean PR checkout for reproducibility. There is no automatic CI or network call unless explicitly requested; `--judge` sends only our generated excerpts to OpenRouter, and `--comment` publishes only Markdown.

## Rubric

Measured differences ignore changes smaller than these inclusive thresholds. Findings describe proxies, not proof of musical taste:

| Dimension | Threshold / direction |
| --- | --- |
| Groove & timing | onset grid error 5 ms; lower preferred (intentional swing can confound it) |
| Arrangement & energy arc | active-window arc spread 1.5 dB; more contrast preferred |
| Harmony/songwriting | 1 distinct section; more form variety preferred, not a harmony-quality claim; full songwriting metrics attached |
| Tonal balance | genre target RMS deviation 1.5 dB; lower preferred; unsupported genre targets marked unmeasured |
| Dynamics & punch | crest 1.5 dB or LRA loss 1.5 LU; loss warns (more is not universally better) |
| Loudness & headroom | absolute target deviation 1 LU; lower preferred |
| Stereo / mono | fold-down loss 0.5 LU; less loss preferred; correlation also reported |

**Hold**: genre-balance deviation worsens by at least 1.5 dB, clipping increases, or true peak exceeds -1 dBTP and worsens by more than 0.05 dB. Existing unchanged safety breaches yield **Ship with notes**, as do other regressions; otherwise **Ship**. A single Hold holds the PR. Safety/genre regressions are critical, other regressions warning, remaining findings informational. Missing measurements infer no preference. Review notes include before/after numbers. `analyzeMix`, `targetBalance`, `analyzePcm` reuse the existing analyzers; songwriting comes from each render manifest.

## Optional model opinion

`--judge` uses `OPENROUTER_API_KEY`; missing key skips without failure. `LISTEN_JUDGE_MODEL` defaults to `google/gemini-2.5-flash`. The CLI verifies the OpenRouter model catalog advertises audio input before sending `input_audio` MP3 content. Each pair uses the same 30–54 second window, ffmpeg loudnorm at -18 LUFS/-2 dBTP, mono 24 kHz/64 kbit MP3, in both blind orders. These excerpts cannot establish full-song form or stereo quality. Strict JSON is validated; only consistent unblinded preferences count, otherwise inconclusive. Errors remain advisory notes. Prior pilot judgments were conclusive only for Minimal; do not let this override measured findings or human listening.

Outputs: `REVIEW.md`, `review.json` (measurements, manifest songwriting and both judge orders), `base/untergrund/` and `head/untergrund/` WAV/MP3 renders, plus generated judge excerpts. Markdown lists local listening paths; these will not become hosted audio when posted to GitHub. Delete local outputs when no longer needed. Unit checks: `node test/listen-review.mjs` (no rendering/network).
