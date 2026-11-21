# Jazz polish

## Electric piano

No recorded electric-piano bank is present in `samples/`. Jazz FM playback uses
a velocity-dependent 1:1 tine excitation, a slightly detuned tone bar, and a
separate 7.03-ratio bell attack. The bell decays with a 28 ms time constant;
the body is at least 150 ms. Gentle 4.8 Hz stereo tremolo and a 420 Hz body
cut keep the sustained sound warm without emphasizing the low-mid box.
Non-jazz playback retains the original FM implementation.

Eight-bar combo measurements (full mix matched to -16 LUFS, identical gain
applied to isolated parts; not additive stems):

| Jazz-Funk seed | Lead LUFS | Comp LUFS | Low-mid bump | Centroid |
| --- | --- | --- | --- | --- |
| 11 | -18.21 | -23.42 | -0.1 dB | 508 Hz |
| 42 | -17.84 | -24.18 | +1.7 dB | 457 Hz |
| 77 | -18.37 | -22.83 | +0.2 dB | 506 Hz |

The added tone bar stays within the existing 15% audio-node guard without a
baseline increase. These are engineering checks, not a claim that synthesized
FM is indistinguishable from a recorded Rhodes; the blind pack is the listening
comparison.

## Bossa flute

Corrections follow the recording and its playback rate, not a global lead EQ.
The measured source partials are 2619 Hz (`fl_60`), 2636 Hz (`fl_64`),
2644/3088 Hz (`fl_69`) and 2623/3151 Hz (`fl_72`). The unusually strong
`fl_72` partials transpose to 2481/2982 Hz on MIDI 71 and 2786 Hz on MIDI 73.
Separate note-isolated renders identify those lines; they are not the `fl_69`
take's quieter 2.94 kHz cluster. Filters use Q 35–60, with no added low-pass.

Eight-bar full-mix peak above the local median (35–175 Hz either side), before
and after the flute-only correction; all identified lines disappear or fall
substantially with the lead muted:

| Seed | Frequency | Before | After |
| --- | --- | --- | --- |
| 11 | 2525 Hz | +9.66 dB | +5.30 dB |
| 11 | 2953 Hz | +8.36 dB | +5.00 dB |
| 42 | 2968 Hz | +11.38 dB | +6.80 dB |
| 42 | 2933 Hz | +6.33 dB | +3.68 dB |
| 77 | 2481 Hz | +21.23 dB | +1.86 dB |
| 77 | 2982 Hz | +15.79 dB | +3.80 dB |
| 77 | 2786 Hz | +29.45 dB | +7.81 dB |

Seed 5 uses trumpet rather than flute and is an unchanged control. Its 2502 Hz
maximum remains with the lead muted, so it is not treated as a flute problem.
Seed 11's remaining 2968 Hz maximum is likewise predominantly accompaniment
after treatment (only 1.09 dB lower with the lead muted). Seed 77's broad
2–5 kHz level changes by about -1.2 dB, while 3.5–5 kHz changes by about
-0.1 dB: the correction removes the narrow lines without discarding the air.
