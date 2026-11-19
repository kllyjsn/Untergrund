# Model judge position-bias check

Audit of the optional model opinion in `npm run review:listen -- --judge` ([docs/listening-review.md](listening-review.md)),
run against the review harness at commit `60a99db` (PR #182 head; merged to main as `b000faf`). Generated audio only;
no reference recordings.

## Method

- Seed 42 full songs rendered by the same full-song renderer the review uses (`test/suno-benchmark-page.js`).
- Judge: `google/gemini-2.5-flash` via OpenRouter (provider reported: Google AI Studio), temperature 0, JSON output,
  the review's own system prompt and A/B block order. Excerpts 30–54 s, ffmpeg loudnorm −18 LUFS / −2 dBTP, mono
  24 kHz / 64 kbit MP3. 40 independent requests, no retries.
- **Identical-audio control:** the same MP3 byte buffer sent as both A and B (SHA-256 equality checked on all 28
  requests), 7 genres × 2 repeats × 2 orders.
- **Real-difference control:** the comparison version is two cascaded 350 Hz low-pass filters applied before loudness
  normalization (no note, seed or timing change), 3 genres × 2 repeats × 2 orders.

## Results

Each cell is repeat 1 / repeat 2.

| Genre | Test | Order 1 | Order 2 | Unblinded agreement |
|---|---|---|---|---|
| Minimal | Identical audio | A / A | A / A | Inconclusive / Inconclusive |
| Hypnotic techno | Identical audio | A / A | A / A | Inconclusive / Inconclusive |
| Deep house | Identical audio | A / A | A / A | Inconclusive / Inconclusive |
| Neo-soul | Identical audio | A / A | A / A | Inconclusive / Inconclusive |
| Boom-bap | Identical audio | A / A | A / A | Inconclusive / Inconclusive |
| Liquid DnB | Identical audio | A / A | A / A | Inconclusive / Inconclusive |
| Ambient | Identical audio | A / A | A / same | Inconclusive / Inconclusive |
| Minimal | Low-pass | A / A | B / B | Original / Original |
| Deep house | Low-pass | A / A | B / B | Original / Original |
| Liquid DnB | Low-pass | A / A | B / B | Original / Original |

| Genre | Overall A preference (identical audio) | Dimension A preference |
|---|---:|---:|
| Minimal | 4/4 | 12/28 |
| Hypnotic techno | 4/4 | 18/28 |
| Deep house | 4/4 | 20/28 |
| Neo-soul | 4/4 | 20/28 |
| Boom-bap | 4/4 | 18/28 |
| Liquid DnB | 4/4 | 20/28 |
| Ambient | 3/4 | 9/28 |
| **Total** | **27/28** | **137/196** |

- On identical audio the judge preferred position A in 27 of 28 calls and answered `same` once. No dimension ever
  preferred B; the rest were `same`.
- The two-order rule turned all 14 identical pairs into *inconclusive*, so no false winner was reported.
- With the low-pass difference, the original won 12/12 calls: 6/6 order-stable preferences.
- Temperature 0 was not fully repeatable: overall verdicts matched in 19/20 repeat pairs, dimension verdicts in
  89/98 on identical audio, and full response text in 6/20.

## What it means

The judge's "order-stable" verdict is reliable only for large differences like the low-pass. On subtle differences it
is position bias, so the earlier pilot result that it was conclusive only for Minimal is not a property of Minimal.
Its verdicts stay advisory and never override measured findings or human listening.
