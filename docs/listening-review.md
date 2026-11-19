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

**Hold**: genre-balance deviation worsens by at least 1.5 dB, clipping increases, or true peak exceeds -1 dBTP and worsens by more than 0.05 dB. Existing unchanged safety breaches yield **Ship with notes**, as do other regressions, any **UNMEASURED** comparison, or an empty review; otherwise **Ship**. A single Hold holds the PR. Safety/genre regressions are critical, other regressions warning, remaining findings informational. Missing measurements infer no preference but never count as unchanged/passing evidence. Review notes include before/after numbers. `analyzeMix`, `targetBalance`, `analyzePcm` reuse the existing analyzers; songwriting comes from each render manifest.

### Measurement limits and target provenance

Groove uses positive log-RMS flux across low (<180 Hz), mid and high (>2.5 kHz) bands,
with 10 ms frames, a 20 ms rise, local 300 ms adaptive threshold and 50 ms refractory
period. This detects fresh attacks above sustained/limited dense kicks without a
genre switch or a whole-song absolute loudness gate. Grid error remains a timing
proxy, not a groove-quality or swing score. Silence, steady tones and missing BPM
do not imply perfect timing: missing grid error is UNMEASURED.

The original seven style mappings retain their commercial-LTAS-inspired curves
(Pestana et al., AES 135, 2013; see `TARGET_CURVES` in `js/audio-quality.js`). New
techno, hard-techno, minimal and trap/drill curves are **engineering priors**, not
published per-genre measurements or fitted render medians: house supplies the
baseline, with kick weight, distortion harmonics, sparse click percussion, and
deep 808/bright-hat characteristics respectively supplying the documented offsets.
Drill shares the trap prior; all six techno variants have explicit mappings.
These curves are provisional spectral references, not a claim of perceptual
acceptability. In particular, a stable bad render will not be improved simply by
comparing it with itself. Unsupported styles and spectra lacking any octave from
63 Hz through 8 kHz return no balance value and receive UNMEASURED; the optional
16 kHz octave is omitted by the spectrum analyzer at 44.1 kHz (Nyquist).

### Fixed-seed measurement audit

Full-song Chrome offline renders, seed 42, main `a875e32` versus this measurement
change. Each checkout was rendered independently using
`test/suno-benchmark-page.js:full`; WAVs were decoded by ffmpeg to stereo 44.1 kHz
and measured with that checkout's `analyzePcm`, `analyzeMix`, `targetBalance` and
`reviewTrack` (the same pipeline as `scripts/listen-review.mjs`). Techno here is
the HYPNOTIC style. No audio generator or mix settings were changed.

| Style | BPM | Onsets before → after | Grid error ms before → after | Balance RMS dB before → after | New target | Worst deviation after |
| --- | --- | --- | --- | --- | --- | --- |
| Techno | 130 | 0 → 1927 | unavailable → 38.5 | unavailable → 4.3 | techno | +8.9 dB at 63 Hz |
| Hard Techno | 150 | 0 → 1917 | unavailable → 27.6 | unavailable → 5.1 | hardtechno | +10.7 dB at 63 Hz |
| Minimal | 124 | 752 → 1596 | 41.2 → 40.9 | unavailable → 3.2 | minimal | +6.3 dB at 63 Hz |
| Drill | 140 | 228 → 2175 | 32.1 → 29.3 | unavailable → 2.9 | trap | +5.6 dB at 500 Hz |
| Trap | 138 | 124 → 2309 | 21.1 → 31.7 | unavailable → 7.1 | trap | +12.2 dB at 500 Hz |

Before, all five missing balance comparisons were misleadingly `same`; Techno
and Hard Techno's missing groove comparisons were also `same`. After, all five
have finite groove and balance measurements. Comparing a render with itself
still yields `same` (not an absolute quality pass). Comparing against the old,
missing measurements now yields **UNMEASURED / Ship with notes**, not Ship.
Balance is a deviation, not an absolute accept/reject gate: the review's 1.5 dB
threshold applies to *regression*. Onset counts cover all bands, not only kicks;
more onsets or lower grid error does not establish improved musical quality.
The high Trap balance error illustrates that these priors were not fitted to
the listener's relative preference for the current renders.

## Optional model opinion

`--judge` uses `OPENROUTER_API_KEY`; missing key skips without failure. `LISTEN_JUDGE_MODEL` defaults to `google/gemini-2.5-flash`. The CLI verifies the OpenRouter model catalog advertises audio input before sending `input_audio` MP3 content. Each pair uses the same 30–54 second window, ffmpeg loudnorm at -18 LUFS/-2 dBTP, mono 24 kHz/64 kbit MP3, in both blind orders. These excerpts cannot establish full-song form or stereo quality. Strict JSON is validated; only consistent unblinded preferences count, otherwise inconclusive. Errors remain advisory notes. Prior pilot judgments were conclusive only for Minimal; do not let this override measured findings or human listening.

Outputs: `REVIEW.md`, `review.json` (measurements, manifest songwriting and both judge orders), `base/untergrund/` and `head/untergrund/` WAV/MP3 renders, plus generated judge excerpts. Markdown lists local listening paths; these will not become hosted audio when posted to GitHub. Delete local outputs when no longer needed. Unit checks: `node test/listen-review.mjs` (no rendering/network).
