# Recorded Rhodes integration

The 18-note tim.kahn CC BY 4.0 set replaces FM electric piano only in `neosoul`, `rnb`, `lofihiphop` and `jazzfunk`. Minimal's felt keys and other styles retain their previous voices. Both `keys` and `jazzKeys` enter the recorded player; Jazz-Funk's existing `stab` dispatch reaches `keys`. Cold/unavailable recordings fall through to the existing FM implementation without recursion. The existing per-song recording lock is retained.

Chords have deterministic 2–8 ms hammer offsets, velocity-dependent low-pass/high-shelf tone, natural recorded decay while held, and a 30 ms release time constant (40 dB attenuation in 138 ms). Neo Soul, R&B and Lo-Fi use shallow 1.1 Hz stereo motion; Jazz-Funk is dry. Existing channel strips and comp trims remain in place. Recorded gains were matched against isolated FM comp, rather than against the full mix.

## Register policy

`js/rhodes.js` drops a whole voicing by an octave if its top is in MIDI 69–81, folds remaining gap voices, merges unisons, and octave-respaces crowded lower notes while retaining the top. Low voices are kept at or above MIDI 28. Lo-Fi tapekeys uses a song-level octave decision covering the written hook and its answer/development headroom. Its guide-tone counterline has a separate bar-phrase octave decision, shared by both notes. Licks choose one octave for the six-note chord-tone phrase, not separately for each note.

`node test/preload.mjs` measures generated seeds 1–40 over 32 arranged bars per style, including chords, tapekeys, counterlines and licks. It asserts that no recorded pitch falls in 69–81, no duplicate voicing pitches survive, and corrected sample stretch is at most four semitones.

| Style | Requested MIDI | Played MIDI | Notes measured | Max nominal / tuned stretch |
| --- | --- | --- | ---: | ---: |
| neosoul | 44–91 | 28–91 | 9,161 | 4 / 3.9937 semitones |
| rnb | 56–98 | 36–98 | 12,501 | 4 / 3.9937 semitones |
| lofihiphop | 34–102 | 28–102 | 19,083 | 4 / 3.9937 semitones |
| jazzfunk | 48–76 | 40–68 | 38,400 | 4 / 3.9485 semitones |

The bounds include the two disjoint safe regions, not continuous coverage of the gap. Maxima are measured against the actual loaded cents-corrected centers as well as the nominal MIDI filenames in the test output.

## Loudness

Reproduce with `node test/rhodes-render.mjs --levels` (headless Chrome required). Each pair renders eight bars of the same generated comp, hooks and licks disabled, tapping the stab channel after its existing strip and fader, before master processing. The FM control bypasses only the new recorded dispatch, leaving the original FM implementation intact. RMS excludes the final one-second tail; values below are stereo dBFS RMS, not LUFS or full-mix loudness.

| Style / seed | FM | Recorded | Difference |
| --- | ---: | ---: | ---: |
| neosoul / 5 | -27.44 | -27.09 | +0.35 dB |
| neosoul / 11 | -25.97 | -26.83 | -0.85 dB |
| rnb / 3 | -23.48 | -22.67 | +0.81 dB |
| rnb / 4 | -25.50 | -26.15 | -0.65 dB |
| lofihiphop / 1 | -26.98 | -26.45 | +0.53 dB |
| lofihiphop / 2 | -28.13 | -27.54 | +0.59 dB |
| jazzfunk / 1 | -27.46 | -27.42 | +0.04 dB |
| jazzfunk / 2 | -27.44 | -27.40 | +0.04 dB |

## Unaffected render and shipping

`node test/rhodes-render.mjs --main /path/to/main-worktree` compares SHA-256 hashes of both Float32 PCM channels for trap seed 42, two active bars plus four seconds of tail, against main. It uses the existing test-only stable summation helper to eliminate Chromium's node-address-dependent summation rounding. Production audio code is not patched by this check.

`BAND_FILES` derives automatically from `BAND`; all 18 files are therefore included. `scripts/build.mjs` copies `samples` and all JS modules, hashes the shell, and precaches the new module automatically. `sw.js` already handles every `/samples/` URL. No cache revision bump is needed for new filenames (the revision is for replacing existing recordings).

Attribution is in `live/LICENSE.md`, `rhodes-sources.json`, and `/legal/`, with the main footer updated to include CC BY instruments. No listening-by-ear or visual UI verification was performed.

## Test result

Full `npm test` exited 0. Audio-node, timbre, composition and quality-ratchet checks passed without baseline changes. The final fast audio benchmark reported 30 PASS / 12 WARN / 0 FAIL. Its Jazz-Funk warning is a 5 dB reduction (improvement) in side energy below 120 Hz relative to the old baseline, consistent with the required dry Rhodes; no thresholds or reference baselines were relaxed.
