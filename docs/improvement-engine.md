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

## Running an experiment

A proposal runs only once a reviewed PR adds it to `EXPERIMENTS` in `js/experiments.js` (validated by `experimentErrors()` in `test/experiments.mjs`):

```js
{ id: 'techno-prompt-drop', lever: 'arrangement', scope: { style: 'techno', src: 'prompt' }, share: 0.1,
  primary: { metric: 'down', goal: 'lower' }, guardrails: ['skip', 'complete'], minListensPerArm: 400,
  from: '2026-11-20', until: '2026-12-20', apply(song, { seed }) { /* one change, variant arm only */ } }
```

Research-backed proposals that are ready to start live in `PROPOSED` in `js/principles.js`, each tied to a product principle in [research/program.md](../research/program.md) and checked offline by `test/principles.mjs`. Starting one is copying it here with dates.

- **Assignment** is deterministic: `fnv(lid + ':' + id) % 100 < share × 100` → `variant`, else `control`. The same device gets the same arm every visit, and arms of different experiments are independent. Scope keys are listen context (`style`, `src`, `surf`, `dev`, `co`); a listen outside the scope is never assigned. The first live experiment whose scope matches takes the listen, so a listen is in at most one. `share` is capped at 50%.
- **Privacy**: assignment needs the listener id, which exists only when analytics is on. Under Do Not Track, Global Privacy Control or an automated browser there is no id, so no arm, no tag, and the default song.
- **Applying**: `apply(song, { seed })` runs on new songs made by Generate/Describe/Hum/Daily Drop (`planSet` in `js/main.js`), for the variant arm only. Scope an experiment with an `apply` on fields known when a song is made (`style`, `src`, `dev`, `co`). Experiments without `apply` (targeting, rotation) act wherever their PR changes behavior, using `assign()`.
- **Tagging**: for an experiment with `apply`, only songs made under it are tagged, with the arm they were made in (a restored, crate, shared or room song was never treated). Otherwise every listen in scope is. Every signal of a tagged listen carries `xp` (experiment id) and `arm` (`control` / `variant`); the server keeps them only when both are valid.
- **Read-out** (`running` in the report): per experiment, control vs variant on its primary metric and guardrails, with `status`: `collecting` (below `minListensPerArm` per arm), `stop` (a guardrail moved > 2 points the wrong way at |z| ≥ 2: end it), `ready` (enough listens: `verdict` is `variant_better`, `variant_worse` or `no_difference`), or `ended` (tags whose entry was removed). Variant-arm listens are left out of the findings, so findings describe what everyone hears by default, and a scope with a running experiment gets no new proposal.
- Ending one is a PR too: remove the entry (or set `until`), and ship the variant as the default only if it won.

## History

Each listen record is also written to a day log, `untergrund:ev:listen:<YYYY-MM-DD>` (UTC, max 5000 records a day, kept 29 days). The report reads the last 28 days (`?days=1…28`, `--days`) in pages of 1000, four pages at a time, so it covers weeks rather than the newest 5000 records. Days written before day logs existed come from the old newest-5000 log. `coverage` in the report says which days were read, how many records, and which days hit the daily cap.

## Automating it

- **Daily digest**: a Vercel cron (`vercel.json`, daily at 15:00 UTC; Hobby allows daily at most) calls `/api/improve-digest`, rewritten to `/api/events?digest=run` (no new function). It needs `Authorization: Bearer <STATS_TOKEN>`, or Vercel's `CRON_SECRET`, which is what the scheduler sends. It runs once per UTC day (retries are no-ops; `&force=1` with the stats token reruns), stores the digest for `GET /api/events?digest=1` (stats token: the latest digest plus the last 30 run summaries), and posts the Markdown as `{ "text": … }` to `DIGEST_WEBHOOK_URL` when set (a Slack incoming webhook works). Nothing in it is applied.
- `STATS_TOKEN=… node scripts/improve.mjs --url https://untergrund.sh [--days 7] --json report.json` prints the same Markdown on demand; `--file` analyzes an exported `?signals=1` log offline.
