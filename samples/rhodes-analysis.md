# Fender Rhodes Mark II preparation

All 53 originals matched the supplied SHA256SUMS (its `orig/` paths were resolved to the input directory) and the pinned metadata hashes. Source: tim.kahn, Freesound pack 3957, CC BY 4.0; see live/LICENSE.md.

## Coverage correction and classification

The supplied metadata's coverage note is inaccurate: measured coverage is **E1–E4 (MIDI 28–64)** and **D6–E7 (86–100)**, with no recordings at **F4–C#6 (65–85)**. In particular, 61828 has a 41.22 Hz E1 fundamental; 61829 has a 46.18 Hz F#1 fundamental even though its strongest partial is 92.36 Hz. 65657 has a 1174.23 Hz D6 fundamental. The octave correction was checked against spectral peaks, not just inferred from labels.

| ID group | True register | Interpretation |
| --- | --- | --- |
| 61821–61832 | E1–D#2, MIDI 28–39 | Low register, a slightly different recording/normalization batch |
| 65650–65664 | D6–E7, MIDI 86–100 | Upper register, almost sinusoidal bell-like notes |
| 65714–65730 | C3–E4, MIDI 48–64 | Middle register |
| 65754–65762 | D#2–B2, MIDI 39–47 | Lower-middle register; D#2 overlaps first group |

**No defensible hard/soft pair.** The names have no velocity/articulation labels, and the groups are almost entirely disjoint registers. Their already-normalized attack peaks cluster around -2.0 and -1.6 dBFS, so peak differences cannot establish playing velocity. There is one same-pitch comparison: 61826 versus 65757 (D#2), with attack RMS -7.65/-7.08 dBFS and power centroids 129.6/90.3 Hz. The first is brighter and has a stronger second partial, but is not louder; this supports a different take/timbre, not two complete velocity layers. Absolute brightness in the upper group follows the much higher fundamentals. Original playing dynamics cannot be recovered conclusively from these normalized, register-confounded recordings.

## Selection and processing

One `rhodes` layer: **28 31 34 37 40 43 46 49 52 55 58 61 64 86 89 93 96 100**. No `rhodessoft` files. Every 3 semitones through the continuous low/mid range; 3–4 semitones in the high island. Endpoints retained to minimize extrapolation. G5-labelled 65664 (+8.05 cents), G#5-labelled 65663 (-7.96 cents), and D#6-labelled 65656 (-9.21 cents) were not selected; selected offsets are all within 8 cents and are preserved for a future tune table. Other omissions primarily avoid redundant chromatic samples, not a claim that those takes are defective.

The retained sections have no digital clipping. Long low-register tails are continuing pitched decay, not evidence of a high stationary noise floor (one-second RMS decreases smoothly). No denoising or retuning was applied. **Not auditioned by ear**: noise, key/mechanical sounds and musical consistency remain listening-review items rather than guaranteed absent.

Mono sum/downmix, 44.1 kHz PCM16, threshold at 0.003 of source peak, 32-frame preroll (~0.73 ms), 0.5 ms fade in, natural decay to -48 dB from the loudest 50 ms or maximum 9 s, final 0.6 s cosine-squared fade, peak 0.5 (-6.02 dBFS). Existing `piano_*` files are 4.85–9.0 s and use that same decay rule/cap/peak. High Rhodes notes decay faster: selected outputs are 1.45–9.0 s.

Reproduce: `python3 scripts/fetch-rhodes.py --originals ~/mk2` (ffmpeg and numpy).
Validate: `python3 test/rhodes-preparation.py`.
Per-file provenance is in `rhodes-sources.json`; numerical measurements and the ready-to-use cents map are in `rhodes-analysis.json`.

## Gap handling

There are no new samples filling the 21 missing semitones. An unrestricted nearest-measured-center mapping would send **MIDI 65–75 (F4–D#5)** to **rhodes_64 / E4** pitched up 1–11 semitones, and **76–85 (E5–C#6)** to **rhodes_86 / D6** pitched down 10–1 semitones. MIDI 86/D6 itself has a real sample. Those large stretches would change attack and decay noticeably; they are not native mid/high-register coverage. The widest split falls just above MIDI 75 because the corrected centers are 64.0515 and 85.9937.

The engine instead transposes whole chord voicings into MIDI 40–68, dropping low roots/doublings to leave at most one note below MIDI 48; individual chord notes are never octave-folded. Single lines are octave-transposed as phrases to avoid MIDI 69–81 and may use the high sample island. See [rhodes-integration.md](rhodes-integration.md) for runtime checks and measurements.

## All originals

Source-label column abbreviates the exact filename note; full names are in the JSON. MIDI center is measured, not rounded. Peak/RMS are dBFS over the first 100 ms after attack trim; brightness is the power spectral centroid in Hz over the same window. Cents are weighted partial estimates in the settled 0.15–0.70 s window, matching sampletune.py with partials below 1% of the strongest spectral peak excluded. * marks selected files.

| ID | Source label | True note | Measured MIDI | Cents | Peak | RMS | Brightness Hz | Pick |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |
| 61821 | A#0 | A#1 | 34.0323 | +3.23 | -1.99 | -7.23 | 111.9 | * |
| 61822 | A0 | A1 | 33.0333 | +3.33 | -1.99 | -7.01 | 82.0 |  |
| 61823 | B0 | B1 | 35.0002 | +0.02 | -3.26 | -8.35 | 86.9 |  |
| 61824 | C#1 | C#2 | 37.0293 | +2.93 | -1.99 | -7.00 | 119.4 | * |
| 61825 | C1 | C2 | 36.0175 | +1.75 | -1.99 | -6.67 | 82.3 |  |
| 61826 | D#1 | D#2 | 39.0105 | +1.05 | -1.99 | -7.65 | 129.6 |  |
| 61827 | D1 | D2 | 38.0156 | +1.56 | -2.43 | -7.13 | 77.5 |  |
| 61828 | E0 | E1 | 28.0023 | +0.23 | -1.99 | -9.84 | 93.5 | * |
| 61829 | F#0 | F#1 | 29.9733 | -2.67 | -1.99 | -10.62 | 103.3 |  |
| 61830 | F0 | F1 | 29.0108 | +1.08 | -2.06 | -8.57 | 69.0 |  |
| 61831 | G#0 | G#1 | 32.0170 | +1.70 | -1.99 | -7.95 | 104.5 |  |
| 61832 | G0 | G1 | 31.0249 | +2.49 | -2.26 | -8.23 | 94.1 | * |
| 65650 | A#5 | A#6 | 93.9776 | -2.24 | -1.58 | -6.99 | 1862.3 |  |
| 65651 | A5 | A6 | 92.9316 | -6.84 | -1.58 | -6.59 | 1753.1 | * |
| 65652 | B5 | B6 | 94.9728 | -2.72 | -1.58 | -7.76 | 1973.1 |  |
| 65653 | C#6 | C#7 | 96.9625 | -3.75 | -1.58 | -8.80 | 2211.9 |  |
| 65654 | C6 | C7 | 95.9562 | -4.38 | -1.58 | -8.26 | 2086.5 | * |
| 65655 | D#5 | D#6 | 87.0082 | +0.82 | -1.58 | -8.66 | 1246.3 |  |
| 65656 | D#6 | D#7 | 98.9079 | -9.21 | -1.58 | -12.97 | 2455.0 |  |
| 65657 | D5 | D6 | 85.9937 | -0.63 | -1.58 | -7.01 | 1174.1 | * |
| 65658 | D6 | D7 | 98.0640 | +6.39 | -1.58 | -11.02 | 2356.0 |  |
| 65659 | E5 | E6 | 88.0019 | +0.19 | -1.58 | -11.09 | 1328.2 |  |
| 65660 | E6 | E7 | 100.0788 | +7.88 | -1.58 | -11.23 | 2636.1 | * |
| 65661 | F#5 | F#6 | 90.0379 | +3.80 | -1.58 | -8.53 | 1482.8 |  |
| 65662 | F5 | F6 | 88.9928 | -0.72 | -1.58 | -7.91 | 1394.6 | * |
| 65663 | G#5 | G#6 | 91.9204 | -7.96 | -1.58 | -6.42 | 1653.7 |  |
| 65664 | G5 | G6 | 91.0805 | +8.05 | -1.58 | -6.19 | 1577.5 |  |
| 65714 | A#2 | A#3 | 57.9718 | -2.82 | -1.58 | -6.11 | 242.0 | * |
| 65715 | A2 | A3 | 57.0198 | +1.98 | -1.58 | -5.55 | 222.5 |  |
| 65716 | B2 | B3 | 59.0160 | +1.60 | -1.58 | -7.15 | 251.4 |  |
| 65717 | C#2 | C#3 | 49.0139 | +1.39 | -1.58 | -6.39 | 148.6 | * |
| 65718 | C#3 | C#4 | 61.0167 | +1.67 | -1.58 | -9.24 | 309.2 | * |
| 65719 | C2 | C3 | 48.0313 | +3.13 | -1.58 | -6.13 | 139.0 |  |
| 65720 | C3 | C4 | 59.9673 | -3.27 | -1.58 | -8.24 | 272.5 |  |
| 65721 | D#2 | D#3 | 51.0188 | +1.88 | -1.58 | -7.94 | 211.4 |  |
| 65722 | D#3 | D#4 | 63.0543 | +5.43 | -1.58 | -9.27 | 320.5 |  |
| 65723 | D2 | D3 | 50.0134 | +1.34 | -1.58 | -5.81 | 148.2 |  |
| 65724 | D3 | D4 | 62.0408 | +4.07 | -1.58 | -13.76 | 298.0 |  |
| 65725 | E2 | E3 | 51.9876 | -1.24 | -1.58 | -6.16 | 170.0 | * |
| 65726 | E3 | E4 | 64.0515 | +5.15 | -1.58 | -9.00 | 341.4 | * |
| 65727 | F#2 | F#3 | 54.0090 | +0.90 | -1.58 | -5.65 | 191.0 |  |
| 65728 | F2 | F3 | 53.0424 | +4.24 | -1.58 | -7.43 | 187.6 |  |
| 65729 | G#2 | G#3 | 56.0682 | +6.82 | -1.58 | -9.60 | 305.6 |  |
| 65730 | G2 | G3 | 55.0138 | +1.37 | -1.58 | -5.89 | 198.1 | * |
| 65754 | A#1 | A#2 | 46.0044 | +0.44 | -1.58 | -5.83 | 119.9 | * |
| 65755 | A1 | A2 | 45.0049 | +0.49 | -1.58 | -6.83 | 133.0 |  |
| 65756 | B1 | B2 | 47.0483 | +4.83 | -1.58 | -6.99 | 156.9 |  |
| 65757 | D#1 | D#2 | 39.0057 | +0.57 | -1.58 | -7.08 | 90.3 |  |
| 65758 | E1 | E2 | 40.0284 | +2.83 | -1.60 | -7.27 | 118.9 | * |
| 65759 | F#1 | F#2 | 42.0208 | +2.08 | -1.58 | -7.71 | 149.6 |  |
| 65760 | F1 | F2 | 41.0085 | +0.85 | -1.83 | -7.54 | 109.7 |  |
| 65761 | G#1 | G#2 | 44.0116 | +1.16 | -1.58 | -7.53 | 144.0 |  |
| 65762 | G1 | G2 | 43.0251 | +2.51 | -1.58 | -6.23 | 102.6 | * |

Total FLAC size: **3,004,417 bytes (2.87 MiB)**, 18 files.
