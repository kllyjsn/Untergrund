# Recorded instrument samples: licenses

Every audio file in this folder is derived from one of the sources below. All are released under the
**Creative Commons CC0 1.0 Universal** public-domain dedication (full legal text linked below or in each source repo's `LICENSE`;
the Virtuosity Drums and double-bass files are byte-identical, sha256 `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499`).
CC0 waives copyright and related rights, so the files can be redistributed in this app and used in commercial
music without attribution. We credit the authors anyway.

Processing unless otherwise noted below: summed to mono, resampled to 44.1 kHz 16-bit PCM, trimmed, 80 ms fade out.
Stored as lossless FLAC (bit-identical to the processed 16-bit PCM). Drum files mix the close mic with the overhead mic of the same hit.

## Modularsamples analog synthesizers (Freesound)

- Author: [modularsamples](https://freesound.org/people/modularsamples/).
- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) for every source below, verified in Freesound API metadata.
- Packs: [Juno 6 Open Pad](https://freesound.org/people/modularsamples/packs/17475/) (`juno`), [Jupiter 4 Unison Pad](https://freesound.org/people/modularsamples/packs/17534/) (`jpad`), [JX-8P Dark Pad Chorus](https://freesound.org/people/modularsamples/packs/17573/) (`dpad`), [JX-3P On Off Strings](https://freesound.org/people/modularsamples/packs/17554/) (`jxstr`), [JX-3P Brassy](https://freesound.org/people/modularsamples/packs/17540/) (`jxbr`), [Jupiter 4 Baby Brass](https://freesound.org/people/modularsamples/packs/17484/) (`jbr`).

The [per-file manifest](../../scripts/analog-samples.json) pins original AIFF, output FLAC and decoded PCM SHA-256 hashes, source format and credits, measured centers/cents, and exact processing parameters. The [fetch/conversion script](../../scripts/fetch-analog.py) verifies both source and output hashes, preserving the recorded channel layouts. Downloads use `FREESOUND_ACCESS_TOKEN` as a Bearer token with rate-limit backoff; the script never refreshes tokens. Encoder and numpy versions used for byte-identical reproduction are recorded in the manifest.

From the repository root, reproduce into a separate directory using cached originals, or hash only the shipped FLACs:
```sh
python3 scripts/fetch-analog.py --source-dir ~/s2-raw --offline --output-dir ~/analog-reproduced
python3 scripts/fetch-analog.py --verify
```

Processing: decoded original AIFF at 44.1 kHz, trimmed leading silence below -60 dB relative to peak (with 5 ms preroll), retained the first 4 s for pads/strings or 3 s for brass, peak-normalized each retained recording to -1 dBFS, applied an 80 ms linear fade-out, quantized to 16-bit PCM and encoded losslessly as FLAC. No pitch shifting. Original mono/stereo channel layouts are preserved: Juno/Jupiter/JX-8P are mono, both JX-3P sets are stereo (the strings are nearly dual-mono). Original recordings remain outside the repository. The original natural releases fall beyond the retained window; these files fade the sustained tone instead.

Pitch centers: YIN autocorrelation over four sustain windows, independently refined with harmonic FFT peaks; the median measured center determines the MIDI filename and the cents offset in `BAND_TUNE`. Pads/strings use windows starting at 0.5, 1.5, 2.5 and 3.5 s; brass at 0.3, 0.9, 1.5 and 2.1 s (700 ms per window). Analog drift/chorus means these are average centers, not constant-frequency claims. Juno/Unison Pad/Dark Pad/On Off Strings measure an octave below the source MIDI/display label. Brassy has a lower audible oscillator seven semitones below its display label plus an upper fifth; filenames reference the lower audible oscillator, not the absent virtual fundamental an octave beneath it. Baby Brass follows source MIDI with positive tuning offsets. On Off Strings consistently uses the lowest Freesound sound ID available for each pitch.

The end-level column is RMS over the last 0.5 s **before** the added fade, relative to 0.5–1.5 s after trimming; all retained samples still sustain (less than 12 dB attenuation). All are 44.1 kHz / 16-bit FLAC. Total: **14,818,976 bytes**.

| File | Source sound | Original Freesound filename | Measured center (MIDI + cents) | Source / retained duration (s) | Channels | End level (dB) |
| --- | --- | --- | --- | --- | --- | --- |
| `juno_48.flac` | [302576](https://freesound.org/s/302576/) | `Roland Juno 6 - Open Pad - C4 (Open Pad-60-127-H3F5.aif)` | 48 +1.3 c | 11.245 / 4.000 | mono | -0.3 |
| `juno_52.flac` | [302580](https://freesound.org/s/302580/) | `Roland Juno 6 - Open Pad - E4 (Open Pad-64-127-OXV7.aif)` | 52 +1.7 c | 11.696 / 4.000 | mono | 0.4 |
| `juno_56.flac` | [302584](https://freesound.org/s/302584/) | `Roland Juno 6 - Open Pad - G4 (Open Pad-68-127-6Z4N.aif)` | 56 +2.1 c | 11.238 / 4.000 | mono | 0.2 |
| `juno_60.flac` | [302588](https://freesound.org/s/302588/) | `Roland Juno 6 - Open Pad - C5 (Open Pad-72-127-BT3P.aif)` | 60 +1.7 c | 11.615 / 4.000 | mono | -0.3 |
| `juno_64.flac` | [302592](https://freesound.org/s/302592/) | `Roland Juno 6 - Open Pad - E5 (Open Pad-76-127-S7Y0.aif)` | 64 +2.9 c | 11.352 / 4.000 | mono | -0.1 |
| `juno_68.flac` | [302596](https://freesound.org/s/302596/) | `Roland Juno 6 - Open Pad - G5 (Open Pad-80-127-NQN2.aif)` | 68 +2.5 c | 11.432 / 4.000 | mono | 0.1 |
| `juno_72.flac` | [302600](https://freesound.org/s/302600/) | `Roland Juno 6 - Open Pad - C6 (Open Pad-84-127-I8Q7.aif)` | 72 +2.2 c | 11.182 / 4.000 | mono | 0.0 |
| `juno_76.flac` | [302604](https://freesound.org/s/302604/) | `Roland Juno 6 - Open Pad - E6 (Open Pad-88-127-CU3I.aif)` | 76 +2.4 c | 11.189 / 4.000 | mono | -0.2 |
| `juno_80.flac` | [302608](https://freesound.org/s/302608/) | `Roland Juno 6 - Open Pad - G6 (Open Pad-92-127-8G1X.aif)` | 80 +2.7 c | 11.097 / 4.000 | mono | 0.2 |
| `juno_84.flac` | [302612](https://freesound.org/s/302612/) | `Roland Juno 6 - Open Pad - C7 (Open Pad-96-127-V4LI.aif)` | 84 +2.0 c | 11.400 / 4.000 | mono | -0.3 |
| `jpad_48.flac` | [305768](https://freesound.org/s/305768/) | `Roland Jupiter 4 - Unison Pad - C4 (JP4 - Unison Pad-60-127.aif)` | 48 +7.5 c | 12.481 / 4.000 | mono | -1.2 |
| `jpad_52.flac` | [305772](https://freesound.org/s/305772/) | `Roland Jupiter 4 - Unison Pad - E4 (JP4 - Unison Pad-64-127.aif)` | 52 +4.8 c | 12.504 / 4.000 | mono | 1.1 |
| `jpad_56.flac` | [305776](https://freesound.org/s/305776/) | `Roland Jupiter 4 - Unison Pad - G4 (JP4 - Unison Pad-68-127.aif)` | 56 +4.4 c | 12.527 / 4.000 | mono | -1.0 |
| `jpad_60.flac` | [305780](https://freesound.org/s/305780/) | `Roland Jupiter 4 - Unison Pad - C5 (JP4 - Unison Pad-72-127.aif)` | 60 +4.0 c | 12.481 / 4.000 | mono | -3.6 |
| `jpad_64.flac` | [305784](https://freesound.org/s/305784/) | `Roland Jupiter 4 - Unison Pad - E5 (JP4 - Unison Pad-76-127.aif)` | 64 +2.8 c | 12.469 / 4.000 | mono | -3.5 |
| `jpad_68.flac` | [305788](https://freesound.org/s/305788/) | `Roland Jupiter 4 - Unison Pad - G5 (JP4 - Unison Pad-80-127.aif)` | 68 +3.3 c | 12.736 / 4.000 | mono | 0.3 |
| `jpad_72.flac` | [305792](https://freesound.org/s/305792/) | `Roland Jupiter 4 - Unison Pad - C6 (JP4 - Unison Pad-84-127.aif)` | 72 +3.6 c | 12.481 / 4.000 | mono | -2.7 |
| `jpad_76.flac` | [305796](https://freesound.org/s/305796/) | `Roland Jupiter 4 - Unison Pad - E6 (JP4 - Unison Pad-88-127.aif)` | 76 +4.9 c | 12.458 / 4.000 | mono | -2.5 |
| `jpad_80.flac` | [305800](https://freesound.org/s/305800/) | `Roland Jupiter 4 - Unison Pad - G6 (JP4 - Unison Pad-92-127.aif)` | 80 +4.7 c | 12.527 / 4.000 | mono | -0.6 |
| `jpad_84.flac` | [305804](https://freesound.org/s/305804/) | `Roland Jupiter 4 - Unison Pad - C7 (JP4 - Unison Pad-96-127.aif)` | 84 +4.1 c | 12.574 / 4.000 | mono | -0.7 |
| `dpad_48.flac` | [307942](https://freesound.org/s/307942/) | `Roland JX-8P - Dark Pad Chorus - C4 (60C3-CLE6.aif)` | 48 -0.5 c | 12.252 / 4.000 | mono | 8.4 |
| `dpad_52.flac` | [307946](https://freesound.org/s/307946/) | `Roland JX-8P - Dark Pad Chorus - E4 (64E3-GJR3.aif)` | 52 -0.9 c | 12.244 / 4.000 | mono | 9.5 |
| `dpad_56.flac` | [307950](https://freesound.org/s/307950/) | `Roland JX-8P - Dark Pad Chorus - G4 (68G#3-G6CQ.aif)` | 56 +1.7 c | 12.112 / 4.000 | mono | 8.2 |
| `dpad_60.flac` | [307954](https://freesound.org/s/307954/) | `Roland JX-8P - Dark Pad Chorus - C5 (72C4-J2TB.aif)` | 60 +2.0 c | 12.224 / 4.000 | mono | 10.2 |
| `dpad_64.flac` | [307958](https://freesound.org/s/307958/) | `Roland JX-8P - Dark Pad Chorus - E5 (76E4-6RNS.aif)` | 64 +1.8 c | 12.225 / 4.000 | mono | 8.6 |
| `dpad_68.flac` | [307962](https://freesound.org/s/307962/) | `Roland JX-8P - Dark Pad Chorus - G5 (80G#4-CNPN.aif)` | 68 +1.4 c | 12.081 / 4.000 | mono | 8.7 |
| `dpad_72.flac` | [307966](https://freesound.org/s/307966/) | `Roland JX-8P - Dark Pad Chorus - C6 (84C5-E92B.aif)` | 72 +0.8 c | 11.879 / 4.000 | mono | 8.0 |
| `dpad_76.flac` | [307970](https://freesound.org/s/307970/) | `Roland JX-8P - Dark Pad Chorus - E6 (88E5-5HJ0.aif)` | 76 -2.0 c | 11.908 / 4.000 | mono | 9.3 |
| `dpad_80.flac` | [307974](https://freesound.org/s/307974/) | `Roland JX-8P - Dark Pad Chorus - G6 (92G#5-WPI0.aif)` | 80 +3.0 c | 11.793 / 4.000 | mono | 7.5 |
| `dpad_84.flac` | [307978](https://freesound.org/s/307978/) | `Roland JX-8P - Dark Pad Chorus - C7 (96C6-YF7W.aif)` | 84 +4.3 c | 11.601 / 4.000 | mono | 8.3 |
| `jxstr_48.flac` | [306938](https://freesound.org/s/306938/) | `Roland JX-3P - On Off Strings - C4 (0-GSKD.aif)` | 48 -14.8 c | 12.260 / 4.000 | stereo | 0.5 |
| `jxstr_52.flac` | [306945](https://freesound.org/s/306945/) | `Roland JX-3P - On Off Strings - E4 (0-XNAU.aif)` | 52 -16.9 c | 13.560 / 4.000 | stereo | -0.2 |
| `jxstr_56.flac` | [306952](https://freesound.org/s/306952/) | `Roland JX-3P - On Off Strings - G4 (0-XXYS.aif)` | 56 -17.1 c | 13.909 / 4.000 | stereo | -0.2 |
| `jxstr_60.flac` | [306960](https://freesound.org/s/306960/) | `Roland JX-3P - On Off Strings - C5 (0-XL6I.aif)` | 60 -15.1 c | 12.283 / 4.000 | stereo | -0.5 |
| `jxstr_64.flac` | [306968](https://freesound.org/s/306968/) | `Roland JX-3P - On Off Strings - E5 (0-I9Z7.aif)` | 64 -16.0 c | 12.202 / 4.000 | stereo | -0.6 |
| `jxstr_68.flac` | [306976](https://freesound.org/s/306976/) | `Roland JX-3P - On Off Strings - G5 (0-0GXN.aif)` | 68 -14.2 c | 13.247 / 4.000 | stereo | -0.5 |
| `jxstr_72.flac` | [306984](https://freesound.org/s/306984/) | `Roland JX-3P - On Off Strings - C6 (0-B5L8.aif)` | 72 -16.9 c | 12.423 / 4.000 | stereo | -1.1 |
| `jxstr_76.flac` | [306992](https://freesound.org/s/306992/) | `Roland JX-3P - On Off Strings - E6 (0-U0MY.aif)` | 76 -8.5 c | 14.013 / 4.000 | stereo | -0.9 |
| `jxstr_80.flac` | [307000](https://freesound.org/s/307000/) | `Roland JX-3P - On Off Strings - G6 (0-O1XW.aif)` | 80 -5.3 c | 14.571 / 4.000 | stereo | -0.3 |
| `jxstr_84.flac` | [307008](https://freesound.org/s/307008/) | `Roland JX-3P - On Off Strings - C7 (0-TSM7.aif)` | 84 -4.2 c | 12.365 / 4.000 | stereo | -0.3 |
| `jxbr_48.flac` | [306094](https://freesound.org/s/306094/) | `Roland JX-3P - Brassy - F#3 (0-W2Y0.aif)` | 48 -23.6 c | 10.520 / 3.000 | stereo | 0.2 |
| `jxbr_51.flac` | [306097](https://freesound.org/s/306097/) | `Roland JX-3P - Brassy - A#3 (0-98PU.aif)` | 51 -20.2 c | 10.318 / 3.000 | stereo | 0.7 |
| `jxbr_54.flac` | [306100](https://freesound.org/s/306100/) | `Roland JX-3P - Brassy - C#4 (0-5435.aif)` | 54 -22.3 c | 10.312 / 3.000 | stereo | 0.4 |
| `jxbr_57.flac` | [306103](https://freesound.org/s/306103/) | `Roland JX-3P - Brassy - E4 (0-UZQH.aif)` | 57 -22.4 c | 10.285 / 3.000 | stereo | -0.2 |
| `jxbr_60.flac` | [306106](https://freesound.org/s/306106/) | `Roland JX-3P - Brassy - F#4 (0-9QOB.aif)` | 60 -21.1 c | 10.297 / 3.000 | stereo | 0.4 |
| `jxbr_63.flac` | [306109](https://freesound.org/s/306109/) | `Roland JX-3P - Brassy - A#4 (0-Q2XC.aif)` | 63 -20.6 c | 10.647 / 3.000 | stereo | -0.4 |
| `jxbr_66.flac` | [306112](https://freesound.org/s/306112/) | `Roland JX-3P - Brassy - C#5 (0-8V1R.aif)` | 66 -22.7 c | 10.295 / 3.000 | stereo | 0.0 |
| `jxbr_69.flac` | [306115](https://freesound.org/s/306115/) | `Roland JX-3P - Brassy - E5 (0-8AZB.aif)` | 69 -20.5 c | 10.296 / 3.000 | stereo | 0.9 |
| `jxbr_72.flac` | [306118](https://freesound.org/s/306118/) | `Roland JX-3P - Brassy - F#5 (0-HK82.aif)` | 72 -20.3 c | 10.295 / 3.000 | stereo | 0.3 |
| `jbr_48.flac` | [303202](https://freesound.org/s/303202/) | `Roland Jupiter 4 - Baby brass - C3 (Baby brass-48-127.aif)` | 48 +20.0 c | 10.681 / 3.000 | mono | -0.3 |
| `jbr_51.flac` | [303205](https://freesound.org/s/303205/) | `Roland Jupiter 4 - Baby brass - D#3 (Baby brass-51-127.aif)` | 51 +34.1 c | 10.693 / 3.000 | mono | -0.4 |
| `jbr_54.flac` | [303208](https://freesound.org/s/303208/) | `Roland Jupiter 4 - Baby brass - F3 (Baby brass-54-127.aif)` | 54 +24.3 c | 10.728 / 3.000 | mono | -0.4 |
| `jbr_57.flac` | [303211](https://freesound.org/s/303211/) | `Roland Jupiter 4 - Baby brass - A3 (Baby brass-57-127.aif)` | 57 +21.9 c | 10.716 / 3.000 | mono | -0.3 |
| `jbr_60.flac` | [303214](https://freesound.org/s/303214/) | `Roland Jupiter 4 - Baby brass - C4 (Baby brass-60-127.aif)` | 60 +18.8 c | 10.681 / 3.000 | mono | -0.3 |
| `jbr_63.flac` | [303217](https://freesound.org/s/303217/) | `Roland Jupiter 4 - Baby brass - D#4 (Baby brass-63-127.aif)` | 63 +31.1 c | 10.681 / 3.000 | mono | -0.3 |
| `jbr_66.flac` | [303220](https://freesound.org/s/303220/) | `Roland Jupiter 4 - Baby brass - F4 (Baby brass-66-127.aif)` | 66 +24.3 c | 10.704 / 3.000 | mono | -0.4 |
| `jbr_69.flac` | [303223](https://freesound.org/s/303223/) | `Roland Jupiter 4 - Baby brass - A4 (Baby brass-69-127.aif)` | 69 +21.3 c | 10.716 / 3.000 | mono | -0.4 |
| `jbr_72.flac` | [303226](https://freesound.org/s/303226/) | `Roland Jupiter 4 - Baby brass - C5 (Baby brass-72-127.aif)` | 72 +19.7 c | 10.693 / 3.000 | mono | -0.3 |


## Virtuosity Drums (Versilian Studios / Karoryfer, drummer Austin McMahon)

- Source: https://github.com/sfzinstruments/virtuosity_drums @ `9f04cf9a734527edfbb0a4eee1f674e45bbf71bc`
- License: CC0 1.0 Universal (`LICENSE` in that repo)

| File | Source sample(s) under `Samples/` |
| --- | --- |
| `kick_v{2,4}_{1,2}.flac` | `kickmic/kick/kickmic_kick_snoff_vl{2,4}_rr{1,2}.flac` + `oh/kick/oh_kick_snoff_vl{2,4}_rr{1,2}.flac` |
| `snare_v{6,14,24,34}.flac` | `snaremic/snare/snaremic_snare_center_vl{N}.flac` + `oh/snare/oh_snare_center_vl{N}.flac` |
| `snare_rim.flac` | `snaremic/snare/snaremic_snare_rimshot_vl10.flac` + `oh/snare/oh_snare_rimshot_vl10.flac` |
| `hh_v{1-4}_{1,2}.flac` | `oh/hh/oh_hh_closed_vl{1-4}_rr{1,2}.flac` |
| `hh_half.flac` | `oh/hh/oh_hh_half_vl2_rr1.flac` |
| `hh_open.flac` | `oh/hh/oh_hh_open_vl3_rr1.flac` |
| `ride_v{1,2,3}_1.flac`, `ride_v2_2.flac` | `oh/ride/oh_ride_ride_vl{1,2,3}_rr1.flac`, `oh/ride/oh_ride_ride_vl2_rr2.flac` |
| `crash_v2.flac` | `oh/crash/oh_crash_crash_vl2_rr1.flac` + `mid/crash/mid_crash_crash_vl2_rr1.flac` |
| `crash_v3.flac` | `oh/crash/oh_crash_crash_vl3_rr1.flac` + `mid/crash/mid_crash_crash_vl3_rr1.flac` |
| `htom_v8.flac` | `mid/htom/mid_htom_center_vl8.flac` + `oh/htom/oh_htom_center_vl8.flac` |
| `htom_v14.flac` | `mid/htom/mid_htom_center_vl14.flac` + `oh/htom/oh_htom_center_vl14.flac` |
| `ltom_v8.flac` | `mid/ltom/mid_ltom_center_vl8.flac` + `oh/ltom/oh_ltom_center_vl8.flac` |
| `ltom_v14.flac` | `mid/ltom/mid_ltom_center_vl14.flac` + `oh/ltom/oh_ltom_center_vl14.flac` |

Extra kit takes (round robins and in-between velocity layers, CC0 1.0 from the same commit; fetched by
`scripts/fetch-band.py --kit`, attack aligned to the shipped take they alternate with, peak -1 dBFS like the rest of the kit):

| File | Source sample(s) under `Samples/` |
| --- | --- |
| `kick_v2_3.flac` | `kickmic/kick/kickmic_kick_snoff_vl2_rr3.flac` + `oh/kick/oh_kick_snoff_vl2_rr3.flac` |
| `kick_v2_4.flac` | `kickmic/kick/kickmic_kick_snoff_vl2_rr4.flac` + `oh/kick/oh_kick_snoff_vl2_rr4.flac` |
| `kick_v4_3.flac` | `kickmic/kick/kickmic_kick_snoff_vl4_rr3.flac` + `oh/kick/oh_kick_snoff_vl4_rr3.flac` |
| `kick_v4_4.flac` | `kickmic/kick/kickmic_kick_snoff_vl4_rr4.flac` + `oh/kick/oh_kick_snoff_vl4_rr4.flac` |
| `kick_v3_1.flac` | `kickmic/kick/kickmic_kick_snoff_vl3_rr1.flac` + `oh/kick/oh_kick_snoff_vl3_rr1.flac` |
| `kick_v3_2.flac` | `kickmic/kick/kickmic_kick_snoff_vl3_rr2.flac` + `oh/kick/oh_kick_snoff_vl3_rr2.flac` |
| `snare_v2.flac` | `snaremic/snare/snaremic_snare_center_vl2.flac` + `oh/snare/oh_snare_center_vl2.flac` |
| `snare_v5.flac` | `snaremic/snare/snaremic_snare_center_vl5.flac` + `oh/snare/oh_snare_center_vl5.flac` |
| `snare_v13.flac` | `snaremic/snare/snaremic_snare_center_vl13.flac` + `oh/snare/oh_snare_center_vl13.flac` |
| `snare_v23.flac` | `snaremic/snare/snaremic_snare_center_vl23.flac` + `oh/snare/oh_snare_center_vl23.flac` |
| `snare_v33.flac` | `snaremic/snare/snaremic_snare_center_vl33.flac` + `oh/snare/oh_snare_center_vl33.flac` |
| `hh_v1_3.flac` | `oh/hh/oh_hh_closed_vl1_rr3.flac` |
| `hh_v1_4.flac` | `oh/hh/oh_hh_closed_vl1_rr4.flac` |
| `hh_v2_3.flac` | `oh/hh/oh_hh_closed_vl2_rr3.flac` |
| `hh_v2_4.flac` | `oh/hh/oh_hh_closed_vl2_rr4.flac` |
| `hh_v3_3.flac` | `oh/hh/oh_hh_closed_vl3_rr3.flac` |
| `hh_v3_4.flac` | `oh/hh/oh_hh_closed_vl3_rr4.flac` |
| `hh_v4_3.flac` | `oh/hh/oh_hh_closed_vl4_rr3.flac` |
| `hh_v4_4.flac` | `oh/hh/oh_hh_closed_vl4_rr4.flac` |
| `hh_half_2.flac` | `oh/hh/oh_hh_half_vl2_rr2.flac` |
| `hh_open_2.flac` | `oh/hh/oh_hh_open_vl3_rr2.flac` |

## D. Smolken double bass (1958 Otto Rubner, played by D. Smolken)

- Source: https://github.com/sfzinstruments/dsmolken.double-bass @ `c2985eb647109d2a8f30a70071e3e163339d7396`
- License: CC0 1.0 Universal (`LICENSE` in that repo; readme: "Royalty-free for all commercial and non-commercial use.")

| File | Source sample | Key center (MIDI) |
| --- | --- | --- |
| `bass_{c1,eb1,g1,bb1,d2,f2,a2,c3}_{a,b}.flac` | `pizz/pizz_{note}_m{a,b}.wav` (mezzo-forte pizzicato, round robins a/b) | 24, 27, 31, 34, 38, 41, 45, 48 |

## Karoryfer Shiny Guitar, acoustic (steel-string acoustic guitar; the SONGS genres' ACOUSTIC voice)

- Source: https://github.com/sfzinstruments/karoryfer.shinyguitar @ `57243cca85277dbcc120ce17c6178032f93c80f3`
- License: CC0 1.0 Universal (`LICENSE` in that repo)
- Fetched and processed by `scripts/fetch-band.py`.

| File | Source sample under `Samples/` | Key center (MIDI) |
| --- | --- | --- |
| `agtr_40.flac` | `acoustic/e2_vl3_rr1_1.wav` | 40 |
| `agtr_42.flac` | `acoustic/gb2_vl3_rr1_1.wav` | 42 |
| `agtr_45.flac` | `acoustic/a2_vl3_rr1_1.wav` | 45 |
| `agtr_48.flac` | `acoustic/c3_vl3_rr1_1.wav` | 48 |
| `agtr_51.flac` | `acoustic/eb3_vl3_rr1_1.wav` | 51 |
| `agtr_54.flac` | `acoustic/gb3_vl3_rr1_1.wav` | 54 |
| `agtr_57.flac` | `acoustic/a3_vl3_rr1_1.wav` | 57 |
| `agtr_60.flac` | `acoustic/c4_vl3_rr1_1.wav` | 60 |
| `agtr_63.flac` | `acoustic/eb4_vl3_rr1_1.wav` | 63 |
| `agtr_66.flac` | `acoustic/gb4_vl3_rr1_1.wav` | 66 |
| `agtr_69.flac` | `acoustic/a4_vl3_rr1_1.wav` | 69 |
| `agtr_72.flac` | `acoustic/c5_vl3_rr1_1.wav` | 72 |

## Guitar takes: round robins and staccato mutes

Same sources, commits and processing as the guitar rows above (`scripts/fetch-band.py --takes`). Each take is
level-matched to the take it alternates with (RMS over the first second; staccato over its first 150 ms against
`gtr_*`). Key centers are the MIDI notes of `gtr_*` / `agtr_*`.

| Files | Source | Samples used |
| --- | --- | --- |
| `gtrb_40.flac` … `gtrb_72.flac` (12), second take of `gtr_*` | karoryfer.black-and-green-guitars, CC0 1.0 Universal | `Samples/black/ord/twang_{e3,gb3,a3,c4,eb4,gb4,a4,c5,eb5,gb5,a5,c6}_mf_rr2.wav` |
| `gtrsoftb_40.flac` … `gtrsoftb_72.flac` (12), second take of `gtrsoft_*` | same | `Samples/black/ord/twang_{…}_p_rr2.wav` |
| `gtrmute_40.flac` … `gtrmute_72.flac` (12), staccato (palm-mute chug) | same | `Samples/black/stac/staccato_{e3,gb3,a3,c4,eb4,gb4,a4,c5,eb5,gb5,a5,c6}_rr1.wav` |
| `gtrmuteb_40.flac` … `gtrmuteb_72.flac` (12) | same | `Samples/black/stac/staccato_{…}_rr2.wav` |
| `agtrb_40.flac` … `agtrb_72.flac` (12), second take of `agtr_*` | karoryfer.shinyguitar, CC0 1.0 Universal | `Samples/acoustic/{e2,gb2,a2,c3,eb3,gb3,a3,c4,eb4,gb4,a4,c5}_vl3_rr2_1.wav` |

## More guitars: JAZZ GTR, TWANG GTR, BANJO

Fetched and processed by `scripts/fetch-band.py --guitars` (same processing as the rows above: mono, trimmed, 80 ms
fade, peak -6 dBFS). The `*b_` second takes are level-matched to the first take (RMS over the first second). Each
recording's measured pitch (`python3 test/sampletune.py`) is corrected in `js/livekit.js`.

| Files | Source | Samples used |
| --- | --- | --- |
| `jazz_40.flac` … `jazz_72.flac` (12), archtop magnetic pickup (JAZZ GTR) | https://github.com/sfzinstruments/karoryfer.shinyguitar @ `57243cca85277dbcc120ce17c6178032f93c80f3`, CC0 1.0 Universal | `Samples/electric/{e2,gb2,a2,c3,eb3,gb3,a3,c4,eb4,gb4,a4,c5}_vl3_rr1_2.wav` |
| `jazzb_40.flac` … `jazzb_72.flac` (12), second take | same | `Samples/electric/{…}_vl3_rr2_2.wav` |
| `gretsch_40.flac` … `gretsch_72.flac` (12), green Gretsch Anniversary (TWANG GTR) | https://github.com/sfzinstruments/karoryfer.black-and-green-guitars @ `b3b3249d37dc977a1a297bd2dc053e6d9b6b805c`, CC0 1.0 Universal | `Samples/green/ord/twang_{e3,gb3,a3,c4,eb4,gb4,a4,c5,eb5,gb5,a5,c6}_mf_rr1.wav` (named an octave above MIDI) |
| `gretschb_40.flac` … `gretschb_72.flac` (12), second take | same | `Samples/green/ord/twang_{…}_mf_rr2.wav` |
| `banjo_40.flac` … `banjo_71.flac` (11: 40 42 45 49 51 54 57 60 63 68 71), SX six-string guitar banjo (BANJO) | https://github.com/sfzinstruments/ganjo @ `ccff5cd5cd3b513873a48994c07724d9d3c39e1c`, CC0 1.0 Universal (`LICENSE.md`) | `Common/Banjo_Common - {E3,F#3,A3,C#4,D#4,F#4,A4,C5,D#5,G#5,B5}.wav` (`ganjo.sfz` maps each an octave below its name) |

## Karoryfer Black And Blue Basses, Dark Black (fingered electric bass guitar; the E.BASS voice)

- Source: https://github.com/sfzinstruments/karoryfer.black-and-blue-basses @ `6e7d674cdb41be7a54dbccb15472401ad01099b9`
- License: CC0 1.0 Universal (the `license` file in that repo is the CC0 1.0 legal code)
- Fetched and processed by `scripts/fetch-band.py`. The library names its notes an octave above concert pitch
  (`darkblack_e2` sounds E1, MIDI 28, verified by pitch detection).

| File | Source sample under `Samples/` | Key center (MIDI) |
| --- | --- | --- |
| `ebass_28.flac` | `darkblack/reg/darkblack_e2_mf_rr1.wav` | 28 |
| `ebass_31.flac` | `darkblack/reg/darkblack_g2_mf_rr1.wav` | 31 |
| `ebass_34.flac` | `darkblack/reg/darkblack_bb2_mf_rr1.wav` | 34 |
| `ebass_37.flac` | `darkblack/reg/darkblack_db3_mf_rr1.wav` | 37 |
| `ebass_40.flac` | `darkblack/reg/darkblack_e3_mf_rr1.wav` | 40 |
| `ebass_43.flac` | `darkblack/reg/darkblack_g3_mf_rr1.wav` | 43 |
| `ebass_46.flac` | `darkblack/reg/darkblack_bb3_mf_rr1.wav` | 46 |
| `ebass_49.flac` | `darkblack/reg/darkblack_db4_mf_rr1.wav` | 49 |
| `ebass_52.flac` | `darkblack/reg/darkblack_e4_mf_rr1.wav` | 52 |
| `ebass_55.flac` | `darkblack/reg/darkblack_g4_mf_rr1.wav` | 55 |

## Rejected

- jlearman jRhodes3d electric piano: its samples are CC-BY-NC 4.0 (non-commercial), so it is not bundled.
  The Rhodes stays synthesized until a CC0 electric piano is found.

## Recorded chord instruments (PIANO, GUITAR, HORNS, STRINGS)

Every file below is derived from a CC0 1.0 Universal source (license file checked in each repository at the
commit listed). Files are named by the MIDI note they sound at. Processing: leading silence removed, summed to
mono, resampled to 44.1 kHz 16-bit PCM, trimmed, 80 ms fade out, peak-normalised to -6 dBFS, stored as lossless FLAC.
The piano files (`piano_*`, `pianosoft_*`, `pianoext_*`, `pianoextsoft_*`) instead keep each note's natural ring
until it has decayed 48 dB below its loudest 50 ms (at most 9 s), then fade over the last 0.6 s
(`scripts/fetch-orchestra.py --piano`).

| Files | Source | Commit | Samples used |
| --- | --- | --- | --- |
| `piano_48.flac` … `piano_88.flac` (12) | [sfzinstruments/Osiris_Piano](https://github.com/sfzinstruments/Osiris_Piano), CC0 1.0 Universal | `18c6afccb60cff458edbf7c394571783e074e1e9` | `UC-Sus/A/Piano_UC-Sus_MicA_{C2,E2,A2,C3,E3,G3,B3,D4,F4,A4,C5,E5}_vl2.flac` |
| `pianosoft_48.flac` … `pianosoft_88.flac` (12), the soft velocity layer | same | same | `UC-Sus/A/Piano_UC-Sus_MicA_{C2,E2,A2,C3,E3,G3,B3,D4,F4,A4,C5,E5}_vl1.flac` |
| `gtr_40.flac` … `gtr_72.flac` (12) | [sfzinstruments/karoryfer.black-and-green-guitars](https://github.com/sfzinstruments/karoryfer.black-and-green-guitars) (Hofner Club hollow-body electric, recorded by Brian Wood), CC0 1.0 Universal | `b3b3249d37dc977a1a297bd2dc053e6d9b6b805c` | `Samples/black/ord/twang_{e3,gb3,a3,c4,eb4,gb4,a4,c5,eb5,gb5,a5,c6}_mf_rr1.wav` (Karoryfer names sit an octave above MIDI: `e3` is MIDI 40) |
| `gtrsoft_40.flac` … `gtrsoft_72.flac` (12), the softly plucked layer | same | same | `Samples/black/ord/twang_{e3,gb3,a3,c4,eb4,gb4,a4,c5,eb5,gb5,a5,c6}_p_rr1.wav` (2.0 s, `scripts/fetch-orchestra.py`) |
| `horn_53.flac`, `horn_58.flac`, `horn_62.flac` | [sgossner/VSCO-2-CE](https://github.com/sgossner/VSCO-2-CE) (Versilian Studios), CC0 1.0 Universal | `440300901dfe9275fd84e0b7763af1f8443ae62e` | `Brass/Tenor Trombone/stac/tenortbn_stac_{F2,A#2,D3}_v2_rr1.wav` |
| `horn_65.flac` … `horn_84.flac` (7) | same | same | `Brass/Trumpet/stac/Sum_SHTrumpet_stac_{F3,G3,A#3,D4,F4,A4,C5}_v2_rr1.wav` |
| `str_55.flac` … `str_86.flac` (11) | same | same | `Strings/Violin Section/susVib/VlnEns_susVib_{G2,A2,B2,D3,F#3,A3,C4,E4,G4,B4,D5}_v2.wav` |

## CLASSICAL orchestra and full-range piano

Same sources, commits, naming and processing as the table above (reproducible with `scripts/fetch-orchestra.py`).
Both sources name notes one octave above scientific pitch, so their C3 is MIDI 60. Timpani files are named by the
principal pitch read from each drum's 1 : 1.5 : 2 partial series.

| Files | Source | Samples used |
| --- | --- | --- |
| `pianoext_24.flac` … `pianoext_96.flac` (8) | Osiris_Piano | `UC-Sus/A/Piano_UC-Sus_MicA_{C0,E0,A0,C1,E1,G1,A5,C6}_vl2.flac` |
| `pianoextsoft_24.flac` … `pianoextsoft_96.flac` (8) | Osiris_Piano | `UC-Sus/A/Piano_UC-Sus_MicA_{C0,E0,A0,C1,E1,G1,A5,C6}_vl1.flac` |
| `cello_36.flac` … `cello_67.flac` (10) | VSCO-2-CE | `Strings/Cello Section/susvib/susvib_{C1,E1,G1,B1,D2,F2,A2,C3,E3,G3}_v3_1.wav` |
| `cb_31.flac` … `cb_45.flac` (5) | VSCO-2-CE | `Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_{G0,A#0,D1,F#1,A1}_v3_rr1.wav` |
| `fl_60.flac` … `fl_84.flac` (7) | VSCO-2-CE | `Woodwinds/Flute/susvib/LDFlute_susvib_{C3,E3,A3,C4,E4,A4,C5}_v1_1.wav` |
| `ob_58.flac` … `ob_82.flac` (7) | VSCO-2-CE | `Woodwinds/Oboe/Vib/Oboe_Vib_{A#2,D3,F3,A#3,D4,F4,A#4}_v1_Main.wav` |
| `flb_60.flac` … `flb_84.flac` (7) | VSCO-2-CE | `Woodwinds/Flute/expvib/LDFlute_expvib_{C3,E3,A3,C4,E4,A4,C5}_v1_1.wav` (alternate hook takes, 1.4 s) |
| `obb_58.flac` … `obb_82.flac` (7) | VSCO-2-CE | `Woodwinds/Oboe/Vib/Oboe_Vib_{A#2,D3,F3,A#3,D4,F4,A#4}_v3_Main.wav` (alternate hook takes, 1.4 s) |
| `cl_50.flac` … `cl_74.flac` (7) | VSCO-2-CE | `Woodwinds/Clarinet/susLong/DCClar_susLong_{D2,F2,A#2,D3,F3,A#3,D4}_v2_rr1_sum.wav` |
| `fh_43.flac` … `fh_60.flac` (6) | VSCO-2-CE | `Brass/F Horn/sus/MOHorn_sus_{G1,A#1,D2,F2,A2,C3}_v2_1.wav` |
| `tpt_57.flac` … `tpt_81.flac` (8) | VSCO-2-CE | `Brass/Trumpet/susvib/Sum_SHTrumpet_susvib_{A2,C3,D#3,G3,A#3,D4,F4,A4}_v1_rr1.wav` |
| `harp_47.flac` … `harp_91.flac` (9) | VSCO-2-CE | `Strings/Harp/KSHarp_{B1,F2,C3,E3,B3,F4,A4,C5,G5}_mf.wav` |
| `timp_42.flac`, `timp_47.flac`, `timp_50.flac`, `timp_52.flac`, `timp_55.flac` | VSCO-2-CE | `Percussion/Timpani/Timpani{1,2,3,4,5}_Hit_v3_rr1_Sum.wav` |
| `timproll_47.flac`, `timproll_52.flac` | VSCO-2-CE | `Percussion/Timpani/Rolls/Timpani{2,4}_Roll_v3_rr1_Sum.wav` |

## Nylon guitar

`nylon_{40,45,48,52,55,59,64,67,69}.flac` are nine fingerstyle notes from
[Meta Nylon Guitar v1.0.0](https://github.com/facebookincubator/Meta-open-sound/releases/tag/meta-nylon-guitar-v1.0.0),
released under **CC0 1.0 Universal**. The release includes that dedication and
the collection's manifest explicitly identifies `CC0-1.0`. The complete legal
text is in [NYLON-LICENSE.txt](../NYLON-LICENSE.txt); original filenames,
SHA-256 hashes, measured pitch centers and processing are recorded in
[nylon-provenance.json](../nylon-provenance.json). Original WAVs were converted
to mono 48 kHz / 24-bit FLAC, gain-normalized with headroom and shortened to at
most four seconds with short edge fades. No synthesis or denoising was used.

## Marimba and hand percussion

Original WAVs were downmixed to mono, resampled to 44.1 kHz, high-pass filtered,
trimmed to their attacks, faded at the edges, and peak-normalized to −6 dBFS before
encoding as 16-bit FLAC. The cuíca files are individual strokes cut from an acoustic
performance, not the keyboard sample in Freesound pack 34867.

| Bundled files | Source, credits and license | Original takes |
| --- | --- | --- |
| `marimba_{48,55,59,65,72,79,83}.flac` | [VSCO-2-CE, Versilian Studios](https://github.com/sgossner/VSCO-2-CE/tree/440300901dfe9275fd84e0b7763af1f8443ae62e), CC0 1.0 Universal | `Percussion/Marimba/Marimba_hit_Outrigger_{C2,G2,B2,F3,C4,G4,B4}_loud_01.wav` |
| `shaker_{1,2,4,7}.flac` | VSCO-2-CE at the same commit, CC0 1.0 Universal | `VSCO 1 Percussion/varWood/Camo's Shaker/shake{1,2,4,7}.wav` |
| `conga_{tap,open}_{1,2}.flac` | VSCO-2-CE at the same commit, CC0 1.0 Universal | `Percussion/Conga-{Tap1_v1,HitN_v2}_rr{1,2}_Sum.wav` |
| `cowbell_{1,2}.flac` | [swirly-drums, Karoryfer Samples](https://github.com/sfzinstruments/karoryfer.swirly-drums/tree/c40dafe0011cb2e54c0c220ff0fa308a11fc60f5), CC0 1.0 Universal | `Samples/cowbell/cowbell_vl3_rr{1,2}.wav` |
| `timbale_closed_{1,2}.flac` | [Metal Timbales, Suicidity](https://freesound.org/people/Suicidity/packs/5890/), CC0 1.0 Universal | [90524](https://freesound.org/s/90524/), [90529](https://freesound.org/s/90529/) |
| `timbale_low_{1,2}.flac` | Metal Timbales, Suicidity, CC0 1.0 Universal | [90471](https://freesound.org/s/90471/), [90474](https://freesound.org/s/90474/) |
| `timbale_high_{1,2}.flac` | Metal Timbales, Suicidity, CC0 1.0 Universal | [90506](https://freesound.org/s/90506/), [90509](https://freesound.org/s/90509/) |
| `cuica_{1,2}.flac` | [“cuica (1).wav” by reinsamba](https://freesound.org/s/21715/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Two edited strokes from source windows 0.550–0.770 s and 1.415–1.615 s |

## Sung vocals

The optional SING vocal track is not a sample: it is generated by a self-hosted neural singer (Scylla's Band v4,
Apache-2.0, built-in voices only) from the song's own melody and lyrics. Its model, runtime, voice and third-party
licenses are in [`singer/LICENSE.md`](../../singer/LICENSE.md); no weights are bundled in the app.
