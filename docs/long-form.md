# Long-form composition

GENERATE writes a full song of 3-4 minutes at the style's tempo. **SKETCH** writes the idea in about a minute and a
half. The extra length has to come from development, not from looping. Code: `js/longform.js` (plans and
development), `songPlan` / `applySongPlan` in `js/state.js`. Benchmark: `test/longform.mjs` checks the principles
below on every style with fixed seeds.

## Before
Measured with fixed seeds: hyperpop 1:54-2:08, drill/trap about 2:18, UK garage 2:13-2:28, euphoric and deep house
2:17-2:40, rock 2:25-2:43, D&B 2:38, ambient 2:00-2:26. A second verse played the first verse's pattern unchanged,
and nothing separated the last chorus from the first except the key lift, which only some styles get.

## Principles (each one is tested)

| # | Principle | What the generator does | Evidence |
|---|---|---|---|
| P1 | **Length follows tempo and genre.** Hit-song durations have been getting shorter, but the norm is still about 3-4 minutes. Get to the hook quickly and earn the rest. | Song styles grow from a compact base toward 3:30 at the style's tempo and stay under 4:00 unless the base form is already longer (slow ballads reach about 4:15). Club forms switch to a 128-bar form when 112 bars would run under 3 minutes. Ambient drifts for about 3:30. Intros stay at 4-8 bars, except house, which gets DJ-length intros. Sketch runs 40-120 s. | Léveillé Gauvin 2018; Klimmt et al. 2024 |
| P2 | **Keep the genre's section roles.** Verse, pre-chorus and chorus are a cycle of statement, build and arrival. Club music builds and drops. | Every song has an intro, at least 2 verses, at least 3 choruses, one bridge leading back into a final chorus, and an outro. Pop and soul keep their pre-choruses, rap goes verse to hook, and house keeps long grooves. Club forms keep intro, breakdown, at least 2 drops and an outro. | Summach 2011; Solberg 2014 |
| P3 | **Repeat for memory, vary for interest.** Exact repetition makes a hook familiar and catchy. Liking follows an inverted U across familiarity and complexity. | Choruses 1 and 2 keep the same hook and chords. Verse 2 brings in the chorus's held-back parts (open hats, claps, percussion). A later pre-chorus ends on a drum roll. | Nunes et al. 2015; Margulis 2013; Jakubowski et al. 2017; Chmiel & Schubert 2017 |
| P4 | **Build to the biggest moment last.** Pleasure peaks when an expected arrival comes with some new intensity. Chills follow new sections, entries and rises in loudness. | The last chorus is the longest. It adds a ride, then a shaker in its second half, on top of the existing key lift, and is measured as the densest chorus. The bridge brings new chords. | Salimpoor et al. 2011; Grewe et al. 2007; Sloboda 1991; Cheung et al. 2019 |
| P5 | **Give the listener space.** Contrast between sections keeps attention. Listeners skip at structural boundaries, so every boundary should promise something new. | An 8-bar instrumental after chorus 2 hands the lead to the riff and drops the vocal chops. Slow songs already near 3:30 may skip it. | Montecchio et al. 2020; Spicer 2004 |
| P6 | **No padding.** Listeners hear local continuity more than large-scale thematic unity, so time spent on a literal copy is lost. | No stretch of 4-32 bars is an identical copy of the stretch before it, and no bar repeats unchanged for more than 16 bars. | Tan et al. 2006 |

## Product decisions
- `MAX_BARS` stays at 128, so the fastest styles (D&B) land near 3:00 rather than 3:30.
- The FULL SONG / SKETCH choice is a per-device preference, not saved with the project. Daily Drops are always full songs.
- "sketch", "demo" or "snippet" in a Describe prompt gives a sketch form. "short" and "radio edit" still cut repeated sections.

## References
- Cheung, V. K. M., et al. (2019). Uncertainty and surprise jointly predict musical pleasure and amygdala, hippocampus, and auditory cortex activity. *Current Biology*, 29(23), 4084-4092. doi:10.1016/j.cub.2019.09.067
- Chmiel, A., & Schubert, E. (2017). Back to the inverted-U for music preference: A review of the literature. *Psychology of Music*, 45(6), 886-909. doi:10.1177/0305735617697507
- Grewe, O., Nagel, F., Kopiez, R., & Altenmüller, E. (2007). Listening to music as a re-creative process. *Music Perception*, 24(3), 297-314. doi:10.1525/mp.2007.24.3.297
- Jakubowski, K., Finkel, S., Stewart, L., & Müllensiefen, D. (2017). Dissecting an earworm. *Psychology of Aesthetics, Creativity, and the Arts*, 11(2), 122-135. doi:10.1037/aca0000090
- Klimmt, C., Sperzel, M., Straßburger, J., Winkler, V., Schneeweiß, Y., & Léveillé Gauvin, H. (2024). Catering to the impatient digital listener: Accelerated composition patterns in popular music, 1986-2020. *Convergence*, 30(3), 1219-1235. doi:10.1177/13548565231208918
- Léveillé Gauvin, H. (2018). Drawing listener attention in popular music. *Musicae Scientiae*, 22(3), 291-304. doi:10.1177/1029864917698010
- Margulis, E. H. (2013). Aesthetic responses to repetition in unfamiliar music. *Empirical Studies of the Arts*, 31(1), 45-57. doi:10.2190/EM.31.1.c
- Montecchio, N., Roy, P., & Pachet, F. (2020). The skipping behavior of users of music streaming services and its relation to musical structure. *PLOS ONE*, 15(9), e0239418. doi:10.1371/journal.pone.0239418
- Nunes, J. C., Ordanini, A., & Valsesia, F. (2015). The power of repetition. *Journal of Consumer Psychology*, 25(2), 187-199. doi:10.1016/j.jcps.2014.12.004
- Salimpoor, V. N., et al. (2011). Anatomically distinct dopamine release during anticipation and experience of peak emotion to music. *Nature Neuroscience*, 14(2), 257-262. doi:10.1038/nn.2726
- Sloboda, J. A. (1991). Music structure and emotional response. *Psychology of Music*, 19(2), 110-120. doi:10.1177/0305735691192002
- Solberg, R. T. (2014). "Waiting for the bass to drop". *Dancecult*, 6(1), 61-82. doi:10.12801/1947-5403.2014.06.01.04
- Spicer, M. (2004). (Ac)cumulative form in pop-rock music. *Twentieth-Century Music*, 1(1), 29-64. doi:10.1017/S1478572204000052
- Summach, J. (2011). The structure, function, and genesis of the prechorus. *Music Theory Online*, 17(3). doi:10.30535/mto.17.3.2
- Tan, S.-L., Spackman, M. P., & Peaslee, C. L. (2006). The effects of repeated exposure on liking and judgments of musical unity of intact and patchwork compositions. *Music Perception*, 23(5), 407-421. doi:10.1525/mp.2006.23.5.407
