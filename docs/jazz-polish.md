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
