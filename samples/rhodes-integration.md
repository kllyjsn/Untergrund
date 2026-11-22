# Recorded Rhodes integration

The 18-note tim.kahn CC BY 4.0 set replaces FM electric piano only in `neosoul`, `rnb`, `lofihiphop` and `jazzfunk`. Minimal's felt keys and other styles retain their previous voices. Both `keys` and `jazzKeys` enter the recorded player; Jazz-Funk's existing `stab` dispatch reaches `keys`. Cold/unavailable recordings fall through to the existing FM implementation without recursion. The existing per-song recording lock is retained.

Chords have deterministic 2–8 ms hammer offsets, velocity-dependent low-pass/high-shelf tone, natural recorded decay while held, and a 30 ms release time constant (40 dB attenuation in 138 ms). Neo Soul, R&B and Lo-Fi use shallow 1.1 Hz stereo motion; Jazz-Funk is dry. Jazz-Funk recorded comp alone has a −8 dB low shelf at 255 Hz, before its existing channel strip, with 1.58 dB source make-up gain to retain its comp level. Other instruments and the shared bus are unchanged. Existing comp trims remain in place.

ENV scales the recorded hold exponentially; DETUNE adds a small alternating pitch offset; TINE adjusts the velocity shelf and low-pass. Controls are centered on their generated palette values, so untouched controls retain the default sound. `node test/rhodes-controls.mjs --base /path/to/de91a94-worktree` checks that each knob changes recorded PCM in all four styles and that Neo Soul/R&B default PCM still nulls against de91a94 (including their electric-piano ensembles).

## Register policy

Neo Soul, R&B and Jazz-Funk retain de91a94's whole-chord downward transposition to MIDI 68 or below. Exact duplicates and notes below 40 are removed, and at most one voice remains below 48. Lo-Fi instead retains the requested chord register (or raises the whole chord to at least 48); if all voices cannot fit 48–68, the original FM chord plays instead. It never lowers or thins a Lo-Fi chord to fit the recordings. Chords never use the high sample island.

Lo-Fi lead, harmony, counterline and lick players choose one register per phrase, including snapped pitches, anticipated harmony and key lifts. Recorded phrases move up to 60–68, or retain an already-high phrase wholly in 82–104. Otherwise FM plays the phrase, preserving its register except for raising any phrase that would go below 48. No phrase is dropped for a range mismatch. Other styles retain their previous phrase policy. Polymetric lick planning uses the same absolute-step chord-row gate as playback, including 13-step rows.

`node test/preload.mjs` measures generated seeds 1–40 over their full arrangements, including chords, tapekeys, counterlines and licks. It asserts that no recorded pitch falls in 69–81, no duplicate voicing pitches survive, and corrected sample stretch is at most four semitones. FM fallback pitches need not avoid the recording gap.

| Style | Requested chords | Played chords | Requested lines | Played lines | Chord / line notes |
| --- | --- | --- | --- | --- | ---: |
| neosoul | 44–91 | 40–68 | 60–85 | 48–67 | 6,530 / 46 |
| rnb | 56–98 | 40–68 | 76–97 | 48–68 | 10,120 / 67 |
| lofihiphop (recorded) | 48–68 | 48–68 | 39–96 | 60–96 | 731 / 2,142 |
| lofihiphop (FM fallback) | — | 45–102 | — | 48–81 | 13,388 / 2,925 |
| jazzfunk | 48–76 | 43–68 | none | none | 38,040 / 0 |

Maximum corrected stretch is 3.9485 semitones for chords and R&B lines, 3.9937 for Lo-Fi lines, and 2.9485 for Neo Soul lines. All 5,067 Lo-Fi line notes play, recorded or FM, and the test verifies a constant octave shift for each player's bar phrase.

## Loudness

`node test/rhodes-render.mjs --levels` measures eight bars of the same generated comp, hooks and licks disabled, tapping the stab channel after its existing strip and fader, before master processing. RMS excludes the final one-second tail. The table below records the initial integration, before the Jazz-Funk shelf and higher-register Lo-Fi/FM fallback revision; it is not a measurement of the revised player.

| Style / seed | FM | Recorded | Difference |
| --- | ---: | ---: | ---: |
| neosoul / 5 | -27.44 | -27.94 | -0.50 dB |
| neosoul / 11 | -25.97 | -27.24 | -1.26 dB |
| rnb / 3 | -23.48 | -22.31 | +1.16 dB |
| rnb / 4 | -25.50 | -25.61 | -0.11 dB |
| lofihiphop / 1 | -26.98 | -26.80 | +0.18 dB |
| lofihiphop / 2 | -28.13 | -27.82 | +0.31 dB |
| jazzfunk / 1 | -27.46 | -27.42 | +0.04 dB |
| jazzfunk / 2 | -27.44 | -27.40 | +0.04 dB |

## Unaffected render and shipping

`node test/rhodes-render.mjs --main /path/to/main-worktree` compares SHA-256 hashes of both Float32 PCM channels for trap seed 42, two active bars plus four seconds of tail, against main. It uses the existing test-only stable summation helper to eliminate Chromium's node-address-dependent summation rounding. Production audio code is not patched by this check.

`BAND_FILES` derives automatically from `BAND`; all 18 files are therefore included. `scripts/build.mjs` copies `samples` and all JS modules, hashes the shell, and precaches the new module automatically. `sw.js` already handles every `/samples/` URL. No cache revision bump is needed for new filenames (the revision is for replacing existing recordings).

Attribution is in `live/LICENSE.md`, `rhodes-sources.json`, and `/legal/`, with the main footer updated to include CC BY instruments. No listening-by-ear or visual UI verification was performed.

## Test result

The preload regression covers recording availability, tone, release, controls, style gating, full-arrangement ranges, FM fallbacks and the 13-step lick gate. The separate control renderer performs PCM checks; the full project gate remains `npm test`. No reference baselines or thresholds are relaxed for the revised player.
