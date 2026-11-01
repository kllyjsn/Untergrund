# Recorded instrument samples: licenses

Every audio file in this folder is derived from one of the two sources below. Both are released under the
**Creative Commons CC0 1.0 Universal** public-domain dedication (full legal text in each source repo's `LICENSE`;
the two files are byte-identical, sha256 `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499`).
CC0 waives copyright and related rights, so the files can be redistributed in this app and used in commercial
music without attribution. We credit the authors anyway.

Processing applied to every file: summed to mono, resampled to 44.1 kHz 16-bit PCM WAV, trimmed, 80 ms fade out.
Drum files mix the close mic with the overhead mic of the same hit.

## Virtuosity Drums (Versilian Studios / Karoryfer, drummer Austin McMahon)

- Source: https://github.com/sfzinstruments/virtuosity_drums @ `9f04cf9a734527edfbb0a4eee1f674e45bbf71bc`
- License: CC0 1.0 Universal (`LICENSE` in that repo)

| File | Source sample(s) under `Samples/` |
| --- | --- |
| `kick_v{2,4}_{1,2}.wav` | `kickmic/kick/kickmic_kick_snoff_vl{2,4}_rr{1,2}.flac` + `oh/kick/oh_kick_snoff_vl{2,4}_rr{1,2}.flac` |
| `snare_v{6,14,24,34}.wav` | `snaremic/snare/snaremic_snare_center_vl{N}.flac` + `oh/snare/oh_snare_center_vl{N}.flac` |
| `snare_rim.wav` | `snaremic/snare/snaremic_snare_rimshot_vl10.flac` + `oh/snare/oh_snare_rimshot_vl10.flac` |
| `hh_v{1-4}_{1,2}.wav` | `oh/hh/oh_hh_closed_vl{1-4}_rr{1,2}.flac` |
| `hh_half.wav` | `oh/hh/oh_hh_half_vl2_rr1.flac` |
| `hh_open.wav` | `oh/hh/oh_hh_open_vl3_rr1.flac` |
| `ride_v{1,2,3}_1.wav`, `ride_v2_2.wav` | `oh/ride/oh_ride_ride_vl{1,2,3}_rr1.flac`, `oh/ride/oh_ride_ride_vl2_rr2.flac` |

## D. Smolken double bass (1958 Otto Rubner, played by D. Smolken)

- Source: https://github.com/sfzinstruments/dsmolken.double-bass @ `c2985eb647109d2a8f30a70071e3e163339d7396`
- License: CC0 1.0 Universal (`LICENSE` in that repo; readme: "Royalty-free for all commercial and non-commercial use.")

| File | Source sample | Key center (MIDI) |
| --- | --- | --- |
| `bass_{c1,eb1,g1,bb1,d2,f2,a2,c3}_{a,b}.wav` | `pizz/pizz_{note}_m{a,b}.wav` (mezzo-forte pizzicato, round robins a/b) | 24, 27, 31, 34, 38, 41, 45, 48 |

## Rejected

- jlearman jRhodes3d electric piano: its samples are CC-BY-NC 4.0 (non-commercial), so it is not bundled.
  The Rhodes stays synthesized until a CC0 electric piano is found.
