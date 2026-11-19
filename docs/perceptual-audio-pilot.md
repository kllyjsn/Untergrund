# Advisory listening-score pilot

## Listener-rated pack

Scored the original level-matched `blind-genre-listening-pack.zip`, not regenerated audio. The pack ZIP SHA-256 is
`2bf0e9f7eb8663068e08ec947eeeedc2d29a2521b828456e5a70bb4ee51325b7`. The corrected unblinding key puts Trap
first. One listener rated each **pair as a whole**, with no version preference or separate labels for dimensions or
parts. “Halfway decent” is not a pass, and the eight excerpts are only four independent musical passages.

Each cell is first / second in original playback order. Higher means more of the cue, not worse music by definition.

| Pair | Genre / seed | Pair rating | Harsh transients | Transition jolt | Lack of smoothness | Toy-like resonance |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 01 | Trap / 42 | Halfway decent | 16.16 / 15.35 | 34.06 / 35.64 | 7.40 / 7.48 | 1.02 / 1.22 |
| 02 | Hard Techno / 42 | Terrible | 14.63 / 10.05 | 10.72 / 8.44 | 9.15 / 7.25 | 0.74 / 0.30 |
| 03 | Minimal / 1234 | Terrible | 27.15 / 31.37 | 92.15 / 90.66 | 14.29 / 14.66 | 10.72 / 9.92 |
| 04 | Drill / 1234 | Terrible | 43.63 / 41.02 | 36.28 / 36.00 | 6.05 / 5.67 | 56.92 / 66.96 |

On the mean of each pair’s two versions, **Minimal scores higher than Trap on all four cues**. **Drill** scores higher
on three, with the largest transient and resonance values, but is missed by the smoothness cue. **Hard Techno** scores
higher only on the smoothness cue, and only on the pair mean: one version is below both Trap versions. None of the
individual cues separates all three pairs. In particular, the resonance cue should not be used as a realism judgment,
and a low score in any column does not clear a track. The pack contains only masters and no section markers.

Reproduce against the unzipped `blind-pilot/` folder below. The end of version one and start of version two bracket the
separator silence (detected with ffmpeg `silencedetect=noise=-65dB:d=0.6`). Do not score the separator as a transition.

```sh
d=/path/to/blind-pilot
for spec in '01 21.42 22.98' '02 19.75 21.31' '03 16.03 17.59' '04 21.12 22.68'; do
  set -- $spec
  node scripts/perceptual-clip.mjs "$d/Pair-$1.mp3" 0 "$2"
  node scripts/perceptual-clip.mjs "$d/Pair-$1.mp3" "$3"
done
```

## Fixed-seed coverage

Run `npm run benchmark:audio:deep` for the full-song master and eight-bar stem scores at seeds 11, 42 and 1234.
These fresh renders are not substitutes for the historical rated excerpts. To calibrate the proxies, collect
held-out within-genre pairs and separate ratings for each cue, including ratings for isolated instruments. Keep
legitimate hard attacks, intentional stops, and realistic narrow resonances as counterexamples.
