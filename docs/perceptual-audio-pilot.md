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
The pair-mean ordering against Trap was unchanged when moving both excerpt starts by 0, 4, 8, 12 or 16 ms
relative to the 20 ms analysis hop. This checks alignment sensitivity, not listener or genre generalization.

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

The recorded run used the fast tier (the densest two bars for each master and its pre-master stems) at the audio
implementation revision [`f9cc15e`](https://github.com/kllyjsn/Untergrund/commit/f9cc15ec8441384b88dfb0901f83ee74cd96160c).
It produced 102 master rows and 1,073 stem rows, including silent or otherwise unmeasurable parts. All masters
had all four excerpt cues; 37 also had a measurable section boundary in their two-bar window.

```sh
node scripts/audio-benchmark.mjs --tier fast --seeds 11,42,1234 --no-baseline --json test/out/listening-fast.json
```

Use `--tier deep` for full-song masters and eight-bar stem windows. The benchmark JSON contains the raw per-seed
part scores and across-seed summaries in both tiers. These fresh renders are not substitutes for the historical
rated excerpts.

### Master scores by style and seed

This `fast` run rendered 34 styles × 3 seeds. Each cell is in seed order **11 / 42 / 1234**.
A dash means unmeasured. The scores are not a cross-genre quality ranking.

| Style | Harsh transients | Transition jolt | Section jolt | Lack of smoothness | Toy-like resonance |
| --- | ---: | ---: | ---: | ---: | ---: |
| `hypnotic` | 30.04 / 18.97 / 21.56 | 22.26 / 17.45 / 33.08 | 5.01 / 5.97 / 26.38 | 8.66 / 8.65 / 11.54 | 9.01 / 1.93 / 18.42 |
| `industrial` | 17.84 / 9.11 / 8.44 | 9.15 / 13.93 / 8.32 | 3.99 / 4.85 / — | 6.29 / 4.21 / 6.14 | 1.13 / 0.86 / 0.79 |
| `acid` | 45.65 / 31.01 / 23.78 | 60.77 / 60.03 / 58.18 | 30.55 / 61.79 / 61.73 | 15.87 / 13.87 / 12.88 | 7.54 / 5.57 / 6.41 |
| `dub` | 16.14 / 29.19 / 34.33 | 24.20 / 32.09 / 18.58 | — / — / — | 9.85 / 9.54 / 9.20 | 1.10 / 0.87 / 4.64 |
| `peak` | 25.12 / 27.83 / 26.41 | 30.23 / 29.96 / 37.69 | 12.30 / 34.10 / 37.31 | 9.42 / 11.75 / 11.99 | 4.37 / 3.13 / 3.02 |
| `hardtechno` | 12.92 / 20.91 / 13.86 | 13.86 / 21.61 / 11.26 | 6.38 / 5.86 / 7.04 | 9.81 / 10.04 / 9.89 | 0.88 / 0.81 / 2.40 |
| `deephouse` | 18.57 / 12.45 / 29.78 | 63.14 / 50.10 / 72.31 | — / — / — | 9.60 / 8.85 / 7.99 | 17.23 / 0.23 / 1.58 |
| `minimal` | 39.18 / 43.57 / 22.10 | 98.62 / 86.54 / 81.51 | 67.92 / 78.35 / — | 19.01 / 16.07 / 12.93 | 11.78 / 32.05 / 3.92 |
| `ukg` | 12.31 / 17.83 / 9.37 | 45.45 / 40.91 / 25.29 | — / — / — | 8.99 / 9.18 / 7.08 | 0.07 / 7.26 / 6.12 |
| `euphoric` | 39.75 / 14.67 / 58.51 | 64.32 / 40.91 / 83.27 | — / 14.47 / — | 8.80 / 8.43 / 12.32 | 5.87 / 0.10 / 31.56 |
| `neosoul` | 27.14 / 24.16 / 35.76 | 50.34 / 55.37 / 36.46 | — / — / — | 8.87 / 8.70 / 8.28 | 14.67 / 7.89 / 5.36 |
| `boombap` | 21.84 / 31.78 / 39.08 | 51.52 / 59.44 / 55.46 | — / — / — | 9.16 / 9.59 / 7.91 | 1.07 / 6.71 / 4.86 |
| `breaks` | 32.48 / 17.03 / 15.10 | 86.90 / 48.77 / 55.24 | 3.61 / 39.66 / 38.13 | 13.57 / 6.74 / 10.28 | 10.37 / 7.96 / 3.78 |
| `electro` | 20.33 / 22.75 / 14.83 | 48.49 / 31.05 / 47.07 | 18.27 / 7.67 / 19.84 | 7.32 / 7.86 / 7.15 | 2.29 / 1.78 / 7.80 |
| `dnb` | 21.94 / 30.33 / 37.84 | 38.63 / 25.93 / 39.31 | 40.86 / 33.82 / 39.39 | 6.96 / 5.59 / 6.85 | 13.35 / 3.41 / 11.87 |
| `trance` | 35.20 / 17.94 / 25.18 | 20.07 / 25.87 / 23.25 | 3.59 / — / — | 12.29 / 12.05 / 12.42 | 2.21 / 4.00 / 2.04 |
| `ambient` | 27.14 / 12.98 / 8.37 | 60.07 / 52.18 / 45.44 | — / — / — | 7.63 / 5.36 / 6.67 | 5.17 / 2.63 / 2.13 |
| `amapiano` | 22.84 / 16.79 / 24.79 | 49.40 / 38.99 / 43.63 | — / — / — | 9.35 / 8.82 / 9.01 | 19.91 / 1.33 / 27.21 |
| `afrobeats` | 50.26 / 11.50 / 11.92 | 69.09 / 27.21 / 23.41 | — / — / — | 9.89 / 8.08 / 6.73 | 12.44 / 3.05 / 4.66 |
| `reggaeton` | 22.20 / 17.48 / 16.58 | 54.81 / 50.88 / 41.29 | — / — / — | 8.60 / 7.54 / 10.04 | 7.25 / 12.97 / 13.11 |
| `bailefunk` | 26.04 / 16.79 / 14.87 | 30.30 / 34.78 / 35.77 | 38.87 / 23.29 / 56.61 | 9.32 / 9.02 / 6.53 | 7.51 / 0.87 / 12.80 |
| `trap` | 26.55 / 14.06 / 14.16 | 32.05 / 33.70 / 30.57 | — / — / — | 7.01 / 8.95 / 6.50 | 20.40 / 1.26 / 13.50 |
| `drill` | 18.09 / 22.01 / 29.54 | 30.53 / 24.27 / 35.13 | — / — / — | 7.76 / 5.72 / 6.41 | 8.71 / 3.00 / 53.56 |
| `jerseyclub` | 53.37 / 48.06 / 52.79 | 74.98 / 61.92 / 59.86 | 63.44 / 68.33 / 51.99 | 13.01 / 12.62 / 9.19 | 2.66 / 35.70 / 63.06 |
| `hyperpop` | 40.15 / 22.41 / 17.38 | 58.06 / 37.79 / 32.07 | — / — / — | 8.63 / 7.27 / 8.62 | 32.52 / 8.87 / 8.92 |
| `pop` | 36.35 / 38.96 / 42.36 | 20.39 / 28.30 / 26.22 | — / — / — | 5.60 / 6.84 / 5.68 | 40.89 / 1.18 / 51.64 |
| `rnb` | 50.10 / 34.04 / 51.63 | 40.55 / 51.73 / 64.82 | — / 56.63 / 47.19 | 5.85 / 8.31 / 7.09 | 35.10 / 7.82 / 24.01 |
| `rock` | 38.79 / 42.39 / 37.62 | 24.47 / 29.46 / 39.82 | — / — / — | 9.17 / 9.29 / 8.19 | 1.62 / 1.69 / 3.48 |
| `folk` | 38.41 / 35.13 / 34.51 | 27.91 / 41.10 / 59.88 | — / 32.46 / 60.66 | 5.20 / 6.17 / 10.44 | 12.95 / 16.73 / 13.78 |
| `country` | 33.88 / 43.34 / 28.92 | 28.16 / 28.18 / 19.74 | — / — / — | 5.55 / 5.87 / 6.47 | 13.58 / 24.88 / 17.62 |
| `symphony` | 19.26 / 22.29 / 24.97 | 20.69 / 18.02 / 22.46 | — / — / — | 6.34 / 6.36 / 6.74 | 10.65 / 10.73 / 13.13 |
| `concerto` | 22.25 / 27.24 / 18.69 | 32.27 / 33.36 / 22.16 | — / — / — | 5.80 / 6.53 / 6.91 | 5.67 / 7.31 / 6.85 |
| `nocturne` | 2.85 / 4.33 / 0.77 | 56.66 / 51.25 / 51.88 | — / — / — | 7.94 / 9.72 / 6.67 | 65.74 / 55.96 / 0.24 |
| `repertoire` | 1.30 / 0.48 / 2.65 | 24.34 / 24.33 / 32.73 | — / — / — | 13.36 / 12.52 / 9.76 | 6.91 / 0.13 / 40.65 |

### Highest part scores in the four pilot genres

These are medians of the new fixed-seed stem renders, not stem measurements of the blind pack. Each column shows
the part with the highest measured p50 for that cue, with its measured seed count. Pre-master stem coloration,
level in the arrangement, and the mix result need not agree.

| Style | Harsh transients | Transition jolt | Section jolt | Lack of smoothness | Toy-like resonance |
| --- | ---: | ---: | ---: | ---: | ---: |
| `trap` | `clap` 67.04 (n=3) | `clap` 53.20 (n=3) | — | `ch` 40.74 (n=3) | `stab` 18.29 (n=3) |
| `hardtechno` | `ride` 68.21 (n=2) | `stab` 57.44 (n=3) | `kick` 50.00 (n=3) | `ch` 36.43 (n=3) | `hook` 51.10 (n=3) |
| `minimal` | `perc` 99.76 (n=3) | `snare` 60.26 (n=2) | `fx` 98.85 (n=2) | `snare` 41.61 (n=3) | `stab` 33.16 (n=3) |
| `drill` | `snare` 68.51 (n=3) | `clap` 52.41 (n=3) | — | `ch` 41.23 (n=3) | `hook` 22.72 (n=3) |

### Next calibration

Collect held-out within-genre pairs and separate ratings for each cue, including ratings for isolated
instruments. Keep legitimate hard attacks, intentional stops, and realistic narrow resonances as counterexamples.
