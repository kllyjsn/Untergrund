# The digital ear

The audio benchmark ([audio-benchmark.md](audio-benchmark.md)) catches faults: clipping, mud, phase, silence. It
can't tell a render that sounds like a computer from one that sounds like a record. That takes taste, and the only
source of taste here is Jason's ear. The digital ear is a model trained to predict his picks.

## Labels: `/ear.html`

A phone page that renders two songs of the same style in the browser (different seeds, same build), 8 bars from the
first chorus or drop, level-matched to the quieter one so loudness can't win. Tap A or B to play; switching keeps the
playhead. Then tap **A IS BETTER**, **B IS BETTER** or **SAME**, plus any reasons for the worse one: computer-like,
metallic / clangy, out of tune, static / noisy, thin / toy, repetitive, no groove, no emotion. The reasons are
Jason's own words from past sessions; there is no text box. The next pair goes to the style with the fewest picks.

`?style=folk` rates one style; `?bars=16` lengthens the window.

Picks stay in `localStorage` until **SEND PICKS** (share sheet on a phone, download elsewhere). Each pick stores the
style, both seeds, the bar window and the deployed commit (`/build.json`), so it re-renders exactly offline, plus the
in-browser measurements of both sides (loudness, spectrum bands, onsets, grid error, arc…).

```
node scripts/ear.mjs ingest ~/Downloads/ear-*.json   # merge into research/taste/judgments.json
node scripts/ear.mjs report                          # counts, reasons, which measurements already agree
```

`report` shows, for every measured feature, how often the picked side had the higher value. A feature near 50% says
nothing about taste; one far from it is a candidate critic input (and a hint where the generator is losing him).

## Player reactions: `research/taste/reactions.json`

The heart, the down arrow and the down reasons in the player (boring / sounds bad / not my style) already reach
production as listen signals ([listen-signals.md](listen-signals.md)), with the song's fingerprint, style and seed.
They are absolute labels on whole songs, weaker than a blind A/B pick but free.

```
STATS_TOKEN=… node scripts/ear.mjs signals                    # lists devices that reacted recently
STATS_TOKEN=… node scripts/ear.mjs signals --device 1a2b3c4d  # pull that device's latest reaction per song
```

Only Jason's devices count. An ear.html export carries a hash of the phone's listener id (`untergrund.lid`), and
`ingest` remembers it, so after the first SEND PICKS the `signals` pull picks his phone automatically. The raw id
never leaves the phone. A heart or down taken back later drops out on the next pull. The server keeps the newest
1000 records for this pull, so pull at least weekly.

## Past verdicts: `research/taste/critiques.json`

Jason's listening verdicts from earlier build sessions, paraphrased and tagged with the same reasons. They aren't
tied to an exact render, so they seed the vocabulary and per-genre priors (metallic and no-emotion lead), not the
model's training pairs.

## Roadmap

1. **Labels** (this): the rating page, the log, the critique corpus.
2. **Critic**: embeddings from an open-weights music model (MERT/CLAP) plus the note-level and mix features we already
   measure, into a small pairwise model with per-reason heads. Trust bar: it must predict ≥75% of held-out picks.
3. **Taste delta**: same seeds rendered on main and the PR, scored by the critic. Warning only.
4. **Best-of-N** at generate time, and the critic choosing which pairs ear.html asks about next.
5. **Reference anchor**: tracks Jason supplies, kept on his machine like the [Suno lab](suno-benchmark.md); only
   numbers are committed. His picks outrank the anchor whenever they disagree.

Jason's picks stay the test set. The generator is never tuned against the critic alone.
