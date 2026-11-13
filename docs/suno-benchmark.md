# UNTERGRUND vs Suno: the blind A/B benchmark

"Suno-level" as a tracked number: the share of blind A/B ratings where UNTERGRUND's song beats a Suno song made from
the same prompt, per genre and per lab dimension (musicality, originality, genre accuracy, emotional pull), plus how
often listeners would replay or release ours. It runs on whatever `main` generates when you render, so re-running it
after a composition change shows whether the change moved the number.

| piece | where |
|---|---|
| 22 fixed prompts, each mapped onto our genres (`styles`, first match wins) and written out as a Suno prompt (`suno`) | `research/suno/prompts.json` |
| render our songs + write the lab manifest | `npm run benchmark:suno` (`scripts/suno-benchmark.mjs`) |
| blind rating, level-matched playback, scorecard export | `lab.html` (`js/lab.js`, `js/lab-metrics.js` `versusScorecard`) |
| checked-in scorecard, summarized on /research | `research/suno/results.json` (`scripts/research.mjs`) |

## Licensing rule

Suno audio is a **local, user-supplied reference only**. You generate it in your own Suno account and keep it in
`suno-lab/suno/` on your machine. It is never committed (`suno-lab/` and `/suno/` are in `.gitignore`), deployed
(`.vercelignore`), served (`server.mjs` refuses `/suno-lab/`), uploaded, or fetched by the app or CI. The lab plays
and analyzes the files you pick in the browser; nothing leaves the device. Only the *ratings* (numbers) get committed.

## 1. Render our side

```
npm run benchmark:suno                          # all prompts at seed 42, ~4 min with 4 Chrome pages
npm run benchmark:suno -- --only deep-house,trap   # re-render a few, keeping the rest of the manifest
npm run benchmark:suno -- --wav                 # keep the WAVs next to the MP3s
```

This writes, under `suno-lab/` (ignored by git):

- `untergrund/<id>-untergrund.mp3`: our whole song for each prompt at the fixed seed (the same song the app's
  GENERATE builds for that genre and seed, ending included, at the engine's own level);
- `manifest.json`: one lab pair per prompt, `a` = ours, `b` = the reference slot `suno/<id>.mp3`, with our
  reference-free songwriting metrics attached (shown after rating, never during);
- `SUNO.md`: the checklist of Suno prompts to generate, one per pair.

Synth-pop, R&B, indie rock and country render as POP (`pop`), R&B (`rnb`), ROCK (`rock`) and COUNTRY (`country`).
A prompt whose genre UNTERGRUND doesn't have yet is listed as `pending` and skipped, never substituted; it joins
automatically once a genre with a matching id or name lands on `main`.

## 2. Generate the Suno songs (Jason, by hand)

For every row of `suno-lab/SUNO.md`:

1. In Suno, open **Create** and switch to **Custom**.
2. Paste the row's **Style of Music** text and **Title**; leave lyrics empty and turn **Instrumental** on (UNTERGRUND
   has no sung vocals yet, so a vocal take would test a different thing).
3. Create, then download the **first** of the two clips Suno returns as MP3 (no cherry-picking; ours is a fixed seed).
4. Save it as `suno-lab/suno/<id>.mp3`, e.g. `suno-lab/suno/deep-house.mp3`.

`node scripts/suno-benchmark.mjs status` lists the files still missing. Note the Suno model version you used.

## 3. Rate blind

1. `PORT=8020 node server.mjs` (or the deployed site) and open `/lab.html`.
2. **BENCHMARK JSON**: `suno-lab/manifest.json`. **OR A FOLDER**: the `suno-lab` folder (or pick the MP3s from both
   subfolders with **AUDIO FILES**).
3. Each pair plays ours and Suno's as A/B in a random but fixed order, turned to the same loudness (`levelMatch`).
   Rate the four dimensions 1-5 for both and pick which you'd replay and release. Progress is kept in the browser.
4. At the end the lab shows the win rates and our songwriting metrics next to them. **EXPORT RESULTS** saves
   `untergrund-vs-suno-<commit>-results.json`. Several listeners can each rate and export.

## 4. Score and publish

```
node scripts/suno-benchmark.mjs score ~/Downloads/untergrund-vs-suno-*-results.json           # print the scorecard
node scripts/suno-benchmark.mjs score ~/Downloads/untergrund-vs-suno-*-results.json --write   # + research/suno/results.json
```

Commit `research/suno/results.json` (ratings only, no audio); `npm run build` puts the summary on `/research`, which
reads "No results yet" until that file exists.

## How to read it

- **Win rate** per dimension: the share of rated pairs where ours scored higher than Suno's, a tie counting half. 50%
  means indistinguishable on that dimension; the headline number is the mean of the four.
- **Replay / release picks**: how often ours (or Suno's, or neither) was picked.
- **By genre**: the same, split by the prompt's genre family.
- **Songwriting metrics** (reference-free, our renders only): song length, sections and distinct sections from the
  song chain; melody variants, motif recall, chords, voice movement and section contrast from the composition
  scorecard (`scripts/composition.mjs`); pitch classes, lead range and parts per bar from the note log; and the
  dynamic arc (p90 - p10 of 2-second loudness, `js/lab-metrics.js` `analyzePcm` `arcDb`). They are not compared to
  Suno: they say *what* changed when a win rate moves.
- One listener over 18 pairs is a noisy estimate (each pair is one sample); treat moves under ~15 points as noise
  unless more listeners agree.
