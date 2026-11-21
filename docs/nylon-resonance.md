# Bossa nylon attack line

The Meta Nylon v1.0.0 archive contains one HighE A4 finger take and two picked
velocities, not another finger round robin. Measured over 42–292 ms, their fifth
partials remain near 2183 Hz: raw peak/local-median prominence is 61.63 dB for
Vel01Finger, 58.21 dB for Vel02Pick and 61.87 dB for Vel03Pick. The picked takes
therefore do not remove the line and change the articulation of the finger bank.

Keep the existing CC0 recording and its hashes/tuning. Only Bossa playback of
nylon_69 receives a 2183 Hz/Q60/-30 dB peaking correction, scaled by playback rate.
At requested MIDI70 with root68.83, the rate is 1.0699178 and the center 2335.63 Hz.
No new low-pass is added, no source audio is changed, and other styles/nylon notes
retain their original processing. `samples/nylon-provenance.json` records the
runtime correction separately from the unchanged import processing and hashes.

Context evaluation uses native 48 kHz stereo seed11, 9.12–9.32 s, stereo-averaged
Welch/Hann8192 with 131072-point interpolation. Local median is ±175 Hz excluding
±35 Hz. Comp-muted and isolated-comp renders distinguish the source and check
that the upper air is preserved. Nominal spectral resolution is about 5.86 Hz.
