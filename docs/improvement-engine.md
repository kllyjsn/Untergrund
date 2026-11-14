# Improvement engine

Turns [listen signals](listen-signals.md) into **ranked findings** (what works, what doesn't, for whom, where in the song) and **controlled experiment proposals**. It never changes a generator default: a proposal becomes a change only through a reviewed PR that ships it as a small variant arm.

Code: `api/_lib/improve.js` (pure, deterministic). Read it via `GET /api/events?improve=1` (stats token), the FINDINGS panels in `stats.html`, or `node scripts/improve.mjs`.

## Listener effort: one tap

The down arrow next to the heart in Now Playing is the whole negative signal. After it, three optional one-tap reasons appear (`boring`, `sounds_bad`, `not_my_style`); ignoring them is fine. There is no text field anywhere. Everything else the engine needs is already on the listen: where in the song (`bar`, `sec`, `pct`), the song's structure (`arr`), what it is (`fp`, `seed`, `style`, `src`, `ph`/`pt`), where it was heard (`surf`), who's listening in coarse terms (`co`, `dev`, `lid`), and what happened next (complete/skip/partial, replay, rewind, keep, share/publish/live, love/down, coming back on a later day).

## How it reads the log

1. **One row per listen** (`lis`): its context, outcome, final love/down state, last reason, rewinds, keeps, spreads, and **return** (did the same `lid` listen again ≥ 1 day later; only judged once a day has passed).
2. **Metrics** stay separate (`skip`, `down`, `complete`, `love`, `keep`, `spread`, `replay`, `rewind`, `return`). There is deliberately **no global taste score**: each finding is one metric, in one scope, compared with comparable listens.
3. **Comparable listens**: a segment is compared with the rest of its parent: `style=techno · src=prompt` against other techno sources, `style=house · dev=phone` against house on other devices, a section against the other sections of that style, a song (`fp`) against other songs of its style.
4. **Finding types**
   - `segment`: a style/source/surface/device/cohort (or style × one of those) that differs from its comparables.
   - `split`: a style that one cohort (`dev`, `co`) takes differently from another. A targeting question, not a sound one.
   - `section`: where songs lose people. Exit and down rates among listens that reached a section kind (from `arr`), plus sections people rewind from.
   - `reason`: what the one-tap reasons say in a segment, against reasons elsewhere (or an even split).
   - `song`: single fingerprints that stand out from their style, with seed/prompt/structure for study.
5. **Bar to report** (defaults; `minListens` is overridable with `?min=` / `--min`): ≥ 20 listens (8 for a single song) from ≥ 3 distinct listeners, and |z| ≥ 1.96 on a two-proportion test. Below that, nothing is reported.
6. **Ranking**: `priority = metric weight × |lift| × (1 − p) × sample factor`. To keep review short, one finding per scope and direction (other metrics that moved ride along in `also`), the mirror side of a two-way split is dropped, and a broad finding is dropped when a narrower one in the same direction explains ≥ 80% of it. Top 25.

## Experiments

Each proposal (top 8, one per scope) comes from one finding and names a single **lever**:

| finding | lever | change |
| --- | --- | --- |
| downs mostly `boring`, exits/downs in a section | `arrangement` | shorten or vary that section; nothing else |
| downs mostly `sounds_bad` | `sound` | one master/mix or instrument-param change |
| downs mostly `not_my_style`, taste `split` | `targeting` | leave the style alone; change who hears it |
| sections people rewind to | `arrangement` | give that section more room |
| a song that's downed a lot / loved a lot | `rotation` / `seed` | hold it out of autoplay / seed new songs near it |
| low return, low keep/share | `next_song` / `lifecycle` | next-song choice / when the keep/share step shows |
| other segment problems | `generator` / `surface` | one variation, scoped to that segment only |

Every proposal has: `status: 'proposed'`, the `scope` it applies to (listens outside it are never assigned), `arms` (control 90% / variant 10%), `unit: 'lid'` with a deterministic hash assignment rule, a `primary` metric and goal, `guardrails` (skip/down/complete must not move > 2 points the wrong way), `minListensPerArm` (two-sided α = .05, power .8, to close half the gap) and a stop rule.

## Automating it

- `STATS_TOKEN=… node scripts/improve.mjs --url https://untergrund.sh --json report.json` prints the Markdown digest; schedule it (cron, a Devin automation) and post the digest or open an issue from it.
- The raw log keeps the newest 5000 listen records, so the report is a rolling window; archive `?signals=1` exports to analyze longer periods with `--file`.
- Not in this version: arm assignment in the client and an `exp` field on listen records. Those come with the first experiment that is actually run.
