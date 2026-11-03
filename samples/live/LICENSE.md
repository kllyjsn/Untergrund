# Recorded instrument samples: licenses

Every audio file in this folder is derived from one of the two sources below. Both are released under the
**Creative Commons CC0 1.0 Universal** public-domain dedication (full legal text in each source repo's `LICENSE`;
the two files are byte-identical, sha256 `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499`).
CC0 waives copyright and related rights, so the files can be redistributed in this app and used in commercial
music without attribution. We credit the authors anyway.

Processing applied to every file: summed to mono, resampled to 44.1 kHz 16-bit PCM, trimmed, 80 ms fade out.
Stored as lossless FLAC (bit-identical PCM to the original 16-bit WAVs). Drum files mix the close mic with the overhead mic of the same hit.

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

## D. Smolken double bass (1958 Otto Rubner, played by D. Smolken)

- Source: https://github.com/sfzinstruments/dsmolken.double-bass @ `c2985eb647109d2a8f30a70071e3e163339d7396`
- License: CC0 1.0 Universal (`LICENSE` in that repo; readme: "Royalty-free for all commercial and non-commercial use.")

| File | Source sample | Key center (MIDI) |
| --- | --- | --- |
| `bass_{c1,eb1,g1,bb1,d2,f2,a2,c3}_{a,b}.flac` | `pizz/pizz_{note}_m{a,b}.wav` (mezzo-forte pizzicato, round robins a/b) | 24, 27, 31, 34, 38, 41, 45, 48 |

## Rejected

- jlearman jRhodes3d electric piano: its samples are CC-BY-NC 4.0 (non-commercial), so it is not bundled.
  The Rhodes stays synthesized until a CC0 electric piano is found.

## Recorded chord instruments (PIANO, GUITAR, HORNS, STRINGS)

Every file below is derived from a CC0 1.0 Universal source (license file checked in each repository at the
commit listed). Files are named by the MIDI note they sound at. Processing: leading silence removed, summed to
mono, resampled to 44.1 kHz 16-bit PCM, trimmed, 80 ms fade out, peak-normalised to -6 dBFS, stored as lossless FLAC.

| Files | Source | Commit | Samples used |
| --- | --- | --- | --- |
| `piano_48.flac` … `piano_88.flac` (12) | [sfzinstruments/Osiris_Piano](https://github.com/sfzinstruments/Osiris_Piano), CC0 1.0 Universal | `18c6afccb60cff458edbf7c394571783e074e1e9` | `UC-Sus/A/Piano_UC-Sus_MicA_{C2,E2,A2,C3,E3,G3,B3,D4,F4,A4,C5,E5}_vl2.flac` |
| `pianosoft_48.flac` … `pianosoft_88.flac` (12), the soft velocity layer | same | same | `UC-Sus/A/Piano_UC-Sus_MicA_{C2,E2,A2,C3,E3,G3,B3,D4,F4,A4,C5,E5}_vl1.flac` |
| `gtr_40.flac` … `gtr_72.flac` (12) | [sfzinstruments/karoryfer.black-and-green-guitars](https://github.com/sfzinstruments/karoryfer.black-and-green-guitars) (Hofner Club hollow-body electric, recorded by Brian Wood), CC0 1.0 Universal | `b3b3249d37dc977a1a297bd2dc053e6d9b6b805c` | `Samples/black/ord/twang_{e3,gb3,a3,c4,eb4,gb4,a4,c5,eb5,gb5,a5,c6}_mf_rr1.wav` (Karoryfer names sit an octave above MIDI: `e3` is MIDI 40) |
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
| `cl_50.flac` … `cl_74.flac` (7) | VSCO-2-CE | `Woodwinds/Clarinet/susLong/DCClar_susLong_{D2,F2,A#2,D3,F3,A#3,D4}_v2_rr1_sum.wav` |
| `fh_43.flac` … `fh_60.flac` (6) | VSCO-2-CE | `Brass/F Horn/sus/MOHorn_sus_{G1,A#1,D2,F2,A2,C3}_v2_1.wav` |
| `tpt_57.flac` … `tpt_81.flac` (8) | VSCO-2-CE | `Brass/Trumpet/susvib/Sum_SHTrumpet_susvib_{A2,C3,D#3,G3,A#3,D4,F4,A4}_v1_rr1.wav` |
| `harp_47.flac` … `harp_91.flac` (9) | VSCO-2-CE | `Strings/Harp/KSHarp_{B1,F2,C3,E3,B3,F4,A4,C5,G5}_mf.wav` |
| `timp_42.flac`, `timp_47.flac`, `timp_50.flac`, `timp_52.flac`, `timp_55.flac` | VSCO-2-CE | `Percussion/Timpani/Timpani{1,2,3,4,5}_Hit_v3_rr1_Sum.wav` |
| `timproll_47.flac`, `timproll_52.flac` | VSCO-2-CE | `Percussion/Timpani/Rolls/Timpani{2,4}_Roll_v3_rr1_Sum.wav` |
