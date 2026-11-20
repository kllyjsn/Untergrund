---
title: Scoring Club vocals on real singing
date: 2026-11-20
summary: Synthetic vocal fixtures said our rubato re-anchoring was clean; real sung stems showed mid-note cuts. We turned Music's real-stem review into a repeatable eval and checked it against Music's last four verdicts.
card: REAL-STEM VOCAL TIMING
---
In a Club Room the band breathes: the grid stretches and shrinks bar by bar (rubato), and the sung vocal has to follow it. When the vocal drifts too far from the kick, the engine re-anchors it, ideally in a quiet gap between phrases and, when there is none, with a short forced crossfade.

Our tests checked this with synthetic formant voices. They made the re-anchoring look clean. Music, listening to real neural vocals (UKG and Euphoric stems from our singer), heard what the fixtures could not: crossfades landing in the middle of sung notes. A synthetic voice has neat gaps; a real one is about 70 % voiced, so the gap search often finds nothing and falls through to a forced cut.

## The eval

We packaged Music's review kit as `scripts/vocal-timing-eval.mjs` (method in `docs/vocal-timing-eval.md`). It renders three real sung inputs (UKG, Euphoric and a 22 s looped Euphoric stress excerpt) through the production vocal scheduler, at 123 BPM under rubato, with the room grid 0, 28 ms early or 28 ms late. Any two commits render on identical input in about four seconds. It scores three things a listener hears:

- **Time over 50 ms**: how long the vocal sits more than 50 ms off the grid.
- **Voiced cuts**: re-anchors that splice while someone is singing.
- **Midpoint pitch separation**: at each voiced crossfade, the pitch of the outgoing and incoming voice at the same instant. Two notes a semitone apart sounding at once is a clash.

The stems stay private: the repo holds only their hashes, and the eval loads them from a private source.

## Does it agree with Music?

We ran it on the four Club vocal revisions Music reviewed by ear.

| Change | Music | Eval |
|---|---|---|
| PR 297, first version | Hold: four Euphoric voiced cuts | Hold: four Euphoric voiced cuts, one 154 cents wide |
| PR 301 | Ship with notes: fades up to about half a semitone apart | Notes: two voiced cuts, at most 68 cents |
| PR 302 | Hold: fade about a semitone apart | Hold: fades widened from 68 to 97 cents |
| PR 297, merged version | Ship | Hold: the stress loop spends 6.7 s longer over 50 ms |

Three of four agree. The fourth is the useful disagreement: the stress loop did not exist when Music reviewed PR 297, and the eval shows that version made it worse (9.1 s to 15.8 s over 50 ms in one case). PR 301 later brought it back to 11.2 s. A check that ran before Music's review would have flagged it a PR earlier.

It also scores work in flight. PR 302's revised head now passes: its stress-loop fades come in at 14 and 3 cents, down from 68 on main, with no extra time off the grid.

Where Music measured the same case, the eval reproduces its numbers: 15.79, 11.15 and 10.83 s over 50 ms across the three revisions, the same fade times, and fade pitch to within about a cent.

## Short transitions

Music's note-boundary detector needs pitch steady within 40 cents on both sides of a change, so it misses short moving transitions, such as one at 21.44 to 21.46 s on the stress loop. PR 302 snapped fades toward that detector's boundaries and still clashed. The eval does not trust detected boundaries: it measures the pitch actually sounding on both sides of each fade, and how fast that pitch is moving within 40 ms. Of the three voiced cuts that remain on main, two sit inside moving pitch (over 40 cents per 10 ms); those are the two that clash most.

## Limits

The gate is advisory and calibrated on four verdicts from one listener. It covers two singer seeds and one voice, a dry vocal with no band, and timing only. It ranks which vocal PRs need Music's ear first; it does not replace it.
