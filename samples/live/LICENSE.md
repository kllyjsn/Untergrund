# Recorded instrument samples: licenses

Every audio file in this folder is derived from one of the sources below. All are released under the
**Creative Commons CC0 1.0 Universal** public-domain dedication except the two cuíca files and the twenty MTG tenor
saxophone files (`tsax_*`, `tsaxb_*`), which are licensed **CC BY 4.0** and must keep the credits below wherever they
are redistributed (full CC0 legal text in each source repo's `LICENSE`; the Virtuosity Drums and double-bass files are
byte-identical, sha256 `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499`). CC0 waives copyright and
related rights, so those files can be redistributed in this app and used in commercial music without attribution; we
credit the authors anyway. CC BY 4.0 also allows commercial use and redistribution, provided the author, source,
license and changes are credited.

## CC BY credits

- `cuica_1.flac`, `cuica_2.flac`: ["cuica (1).wav"](https://freesound.org/s/21715/) by
  [reinsamba](https://freesound.org/people/reinsamba/), licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changed: two single strokes cut from the
  0.550–0.770 s and 1.415–1.615 s windows, high-pass filtered, faded, peak-normalized and encoded as 16-bit FLAC
  (`scripts/fetch-percussion.py`).
- `tsax_{47..74}.flac`, `tsaxb_{47..74}.flac`: "MTG Solo Saxophones" by the Music Technology Group (Universitat
  Pompeu Fabra), [sfzinstruments/MTG.SoloSax](https://github.com/sfzinstruments/MTG.SoloSax), licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changed: trimmed, converted to mono 16-bit FLAC and
  loudness matched (`scripts/fetch-band.py --sax`; details in the saxophone section).

Processing applied to every file unless its section says otherwise: summed to mono, resampled to 44.1 kHz 16-bit
PCM, trimmed (organ 2.2 s, bass 2.4 s), 80 ms fade out. Stored as lossless FLAC (bit-identical PCM to the original
16-bit WAVs). Drum files mix the close mic with the overhead mic of the same hit.


## S9 fiddle and upright piano — VSCO 2 Community Edition (CC0)

Solo violin: Sam Gossner / Versilian Studios. Upright piano: Simon Dalzell / Ivy Audio,
distributed by Sam Gossner / Versilian Studios. Source WAVs are pinned to
[`sgossner/VSCO-2-CE@440300901dfe9275fd84e0b7763af1f8443ae62e`](https://github.com/sgossner/VSCO-2-CE/tree/440300901dfe9275fd84e0b7763af1f8443ae62e).
All these WAVs are covered by that repository's
[CC0 1.0 Universal dedication](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/LICENSE):
“Affirmer hereby overtly, fully, permanently, irrevocably and unconditionally waives, abandons,
and surrenders all of Affirmer's Copyright and Related Rights”. The upright's `Info.txt` also
states: “Bearer is granted right to redistribute this sample set by Versilian Studios LLC.”

Sounding MIDI centers come from `SViolinVib.sfz`, `SViolinSpic.sfz` and `UprightPiano.sfz`, pinned to
the [SFZ branch commit `6dd651d55dde97fd4028699be9d4481f26917891`](https://github.com/sgossner/VSCO-2-CE/tree/6dd651d55dde97fd4028699be9d4481f26917891).
Spiccato filenames use an octave different from arco; piano filename numbers are sample indices, not MIDI.

| Bundled FLACs | Source directory / articulation | Dynamics and takes | Sounding MIDI centers |
| --- | --- | --- | --- |
| `fiddle_*.flac` | `Strings/Solo Violin/Arco Vib` | f | 55,57,60,64,67,69,72,76,79 |
| `fiddlesoft_*.flac` | `Strings/Solo Violin/Arco Vib` | p | same nine centers |
| `fiddlestac_*.flac` | `Strings/Solo Violin/spic` | v2, rr1 | same nine centers |
| `fiddlestacb_*.flac` | `Strings/Solo Violin/spic` | v2, rr2 | same nine centers |
| `fiddlestacsoft_*.flac` | `Strings/Solo Violin/spic` | v1, rr1 | same nine centers |
| `fiddlestacsoftb_*.flac` | `Strings/Solo Violin/spic` | v1, rr2 | same nine centers |
| `uprightsoft_*.flac` | `Keys/Upright Piano` | dyn1, rr1 | 41,45,49,53,57,61,65,69,73,77,81,85 |
| `upright_*.flac` | `Keys/Upright Piano` | dyn2, rr1 | same twelve centers |
| `uprighthard_*.flac` | `Keys/Upright Piano` | dyn3, rr1 | same twelve centers |

These 90 files use `scripts/fetch-roots.py`: mono 44.1 kHz/16-bit lossless FLAC, leading silence
removed to 2 ms before the sustained -35 dB onset, 1 ms attack fade, measured tuning corrected
by resampling and rechecked within 5 cents of the SFZ center. Per-note body RMS is matched to
the instrument reference (fiddle -16 dBFS, upright -13.6 dBFS over 20–350 ms), limited to a
-6 dBFS peak. Arco keeps up to 3 seconds with a 160 ms final fade, spiccato up to 1 second
with an 80 ms fade, upright up to 6 seconds with a 500 ms fade. No loops. Unlike the older
unretuned recordings, these PCM samples are resampled derivatives, not byte-identical source WAVs.
`scripts/roots-samples.json` records each source URL/hash, SFZ center, tuning measurements,
attack trim, normalization gain, duration and bundled FLAC hash.

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

## Saxophones: Karoryfer Weresax alto and MTG tenor (the recorded `reed` hook in Pop, Neo-Soul, Reggaeton, Breaks, Trap, Boom Bap and Afrobeats)

- Alto source: https://github.com/sfzinstruments/karoryfer.weresax @ `a4d756b21d2a573aca0d840cce7e71ba5effd4c6`
- Alto license: CC0 1.0 Universal (the `LICENSE` file in that repo)
- Tenor source: https://github.com/sfzinstruments/MTG.SoloSax @ `b494d256549b3d088fdec176ce82867f8a1f58b2`
  (sampled by the Music Technology Group, Universitat Pompeu Fabra, published on freesound.org; SFZ by kinwie)
- Tenor license: Creative Commons Attribution 4.0 International (CC BY 4.0). Attribution: "MTG Solo Saxophones" by
  the Music Technology Group (Universitat Pompeu Fabra), https://github.com/sfzinstruments/MTG.SoloSax, CC BY 4.0;
  trimmed, converted to mono 16-bit FLAC and loudness matched for Untergrund.
- Fetched and processed by `scripts/fetch-band.py --sax`: mono, 44.1 kHz, leading silence trimmed, cut at 3 s with an
  80 ms fade, and scaled so every note has the same sustain loudness (RMS over 0.15-0.9 s). Weresax names its notes an
  octave below MIDI (`a2` is MIDI 57, its SFZ key center); the MTG tenor numbers notes from MIDI 44 and plays 10-20
  cents sharp, which `WIND_HOOK` in `js/engine.js` corrects. The `b` files are the alternate take for repeated notes:
  the Weresax second round robin, and the MTG tenor's piano-dynamic take.

| File | Source sample under `Samples/` | Key center (MIDI) |
| --- | --- | --- |
| `asax_52.flac` / `asaxb_52.flac` | `alto/e2_f_rr1_cnd.wav` / `alto/e2_f_rr2_cnd.wav` | 52 |
| `asax_55.flac` / `asaxb_55.flac` | `alto/g2_f_rr1_cnd.wav` / `alto/g2_f_rr2_cnd.wav` | 55 |
| `asax_58.flac` / `asaxb_58.flac` | `alto/bb2_f_rr1_cnd.wav` / `alto/bb2_f_rr2_cnd.wav` | 58 |
| `asax_61.flac` / `asaxb_61.flac` | `alto/db3_f_rr1_cnd.wav` / `alto/db3_f_rr2_cnd.wav` | 61 |
| `asax_64.flac` / `asaxb_64.flac` | `alto/e3_f_rr1_cnd.wav` / `alto/e3_f_rr2_cnd.wav` | 64 |
| `asax_67.flac` / `asaxb_67.flac` | `alto/g3_f_rr1_cnd.wav` / `alto/g3_f_rr2_cnd.wav` | 67 |
| `asax_70.flac` / `asaxb_70.flac` | `alto/bb3_f_rr1_cnd.wav` / `alto/bb3_f_rr2_cnd.wav` | 70 |
| `asax_73.flac` / `asaxb_73.flac` | `alto/db4_f_rr1_cnd.wav` / `alto/db4_f_rr2_cnd.wav` | 73 |
| `asax_76.flac` / `asaxb_76.flac` | `alto/e4_f_rr1_cnd.wav` / `alto/e4_f_rr2_cnd.wav` | 76 |
| `asax_79.flac` / `asaxb_79.flac` | `alto/g4_f_rr1_cnd.wav` / `alto/g4_f_rr2_cnd.wav` | 79 |
| `tsax_47.flac` / `tsaxb_47.flac` | `ten_f_04.flac` / `ten_p_04.flac` | 47 |
| `tsax_50.flac` / `tsaxb_50.flac` | `ten_f_07.flac` / `ten_p_07.flac` | 50 |
| `tsax_53.flac` / `tsaxb_53.flac` | `ten_f_10.flac` / `ten_p_10.flac` | 53 |
| `tsax_56.flac` / `tsaxb_56.flac` | `ten_f_13.flac` / `ten_p_13.flac` | 56 |
| `tsax_59.flac` / `tsaxb_59.flac` | `ten_f_16.flac` / `ten_p_16.flac` | 59 |
| `tsax_62.flac` / `tsaxb_62.flac` | `ten_f_19.flac` / `ten_p_19.flac` | 62 |
| `tsax_65.flac` / `tsaxb_65.flac` | `ten_f_22.flac` / `ten_p_22.flac` | 65 |
| `tsax_68.flac` / `tsaxb_68.flac` | `ten_f_25.flac` / `ten_p_25.flac` | 68 |
| `tsax_71.flac` / `tsaxb_71.flac` | `ten_f_28.flac` / `ten_p_28.flac` | 71 |
| `tsax_74.flac` / `tsaxb_74.flac` | `ten_f_31.flac` / `ten_p_31.flac` | 74 |

## Rejected

- jlearman jRhodes3d electric piano: its samples are CC-BY-NC 4.0 (non-commercial), so it is not bundled.
  The Rhodes stays synthesized until a CC0 electric piano is found.
- MTG baritone sax and Karoryfer Bear Sax: the generated hooks sit in the alto and tenor ranges, so a baritone would
  only play transposed or an octave under the bass; not bundled until a part is written for it.

## Recorded chord instruments (PIANO, GUITAR, HORNS, STRINGS)

Every file below is derived from a CC0 1.0 Universal source (license file checked in each repository at the
commit listed). Files are named by the MIDI note they sound at. Processing: leading silence removed, summed to
mono, resampled to 44.1 kHz 16-bit PCM, trimmed (organ 2.2 s, bass 2.4 s), 80 ms fade out, peak-normalised to -6 dBFS, stored as lossless FLAC.
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

## COUNTRY lead guitar and harmonica

Reproducible with `scripts/fetch-band.py` (first 3.0 s of each note, same trim and fade as the other band samples).
Both sources name notes in scientific pitch (C4 = MIDI 60).

| Files | Source | Commit | Samples used |
| --- | --- | --- | --- |
| `tele_52.flac` … `tele_85.flac` (13) | [freepats/electric-guitar-FSBS-clean](https://github.com/freepats/electric-guitar-FSBS-clean) (FreePats, a Fender electric, clean, bridge pickup), CC0 1.0 Universal | `192cf0d9bf2c4ba6ead8e3524ba3f78818e4fe91` | `samples/bridge/{E3_s3,G3_s4,B3_s5,C#4_s5,E4_s6,G4_s6,B4_s6,C5_s6,D5_s6,F5_s6,G#5_s6,A#5_s6,C#6_s6}_01.flac` |
| `hca_48.flac` … `hca_84.flac` (10) | [sgossner/VCSL](https://github.com/sgossner/VCSL) (Versilian Community Sample Library, Hohner Special 20 in C), CC0 1.0 Universal | `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e` | `Aerophones/Free Aerophones/Harmonica-Hohner-Special20-C/Sustains/Vib/Hohner-Special20_Vib_{C3,E3,G3,C4,E4,G4,C5,E5,G5,C6}.wav` |

## Tonewheel organ and analog synth bass (Freesound, CC0)

Original uploads (never the lossy previews), fetched through the Freesound API by `scripts/fetch-freesound.py`,
which lists every sound id. Each sound page states **CC0 1.0 Universal**. Processing as above: leading silence
removed, mono, resampled to 44.1 kHz 16-bit, trimmed (organ 2.2 s, bass 2.4 s), 80 ms fade out, peak -6 dBFS, lossless FLAC. Measured pitch
is within 5 cents of each organ note's name.

| Files | Source | Samples used |
| --- | --- | --- |
| `org_43.flac` … `org_83.flac` (23), the ORGAN voice in UK GARAGE and the ROCK chorus organ | Freesound pack [18844 "tonewheel organ sound samples"](https://freesound.org/people/hammondman/packs/18844/) by hammondman (32 kHz 16-bit WAV, the only full CC0 tonewheel multisample found on Freesound (the others were a 22 kHz rotary pack and a single M1 note); its energy ends near the 5.9 kHz top tonewheel, every file is more than 74 dB down above 10 kHz, and the engine low-passes the organ at 5.2–5.6 kHz, so a 16 kHz Nyquist loses nothing), CC0 1.0 Universal | sounds 333747–333770 except 333757: one held note per white key, `g2.wav` … `b5.wav` (scientific pitch, `c4` = MIDI 60) |
| `abass_36.flac` … `abass_60.flac` (9), the REESE bass voice in UK GARAGE | Freesound pack [17593 "Roland SH-2 - Filter Vel Bass"](https://freesound.org/people/modularsamples/packs/17593/) by modularsamples (44.1 kHz 24-bit WAV), CC0 1.0 Universal | sounds 310235, 310247, 310259, 310271, 310282, 310294, 310306, 310318, 310330: the brightest of each note's velocity takes, every third semitone `36C1` … `60C3` (named by MIDI number); measured 5–9 cents flat, corrected in `js/livekit.js` |

Both sets are rebuilt by `scripts/fetch-freesound.py`, which pins every original upload by Freesound sound ID and SHA-256, refuses any file whose hash differs, and reproduces the committed FLACs byte for byte from those originals.

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
encoding as 16-bit FLAC. `scripts/fetch-percussion.py` downloads each original from its pinned commit or
Freesound sound ID, checks its SHA-256 and regenerates these files byte for byte (`--check` compares them with the
committed copies). The cuíca files are individual strokes cut from an acoustic
performance, not the keyboard sample in Freesound pack 34867.

| Bundled files | Source, credits and license | Original takes |
| --- | --- | --- |
| `marimba_{48,55,59,65,72,79,83}.flac` | [VSCO-2-CE, Versilian Studios](https://github.com/sgossner/VSCO-2-CE/tree/440300901dfe9275fd84e0b7763af1f8443ae62e), CC0 1.0 Universal | `Percussion/Marimba/Marimba_hit_Outrigger_{C2,G2,B2,F3,C4,G4,B4}_loud_01.wav` |
| `shaker_{1,2,4,7}.flac` | VSCO-2-CE at the same commit, CC0 1.0 Universal | `VSCO 1 Percussion/varWood/Camo's Shaker/shake{1,2,4,7}.wav` |
| `conga_{tap,open}_{1,2}.flac` | VSCO-2-CE at the same commit, CC0 1.0 Universal | `Percussion/Conga-{Tap1_v1,HitN_v2}_rr{1,2}_Sum.wav` |
| `cowbell_{1,2}.flac` | [swirly-drums, Karoryfer Samples](https://github.com/sfzinstruments/karoryfer.swirly-drums/tree/c40dafe0011cb2e54c0c220ff0fa308a11fc60f5), CC0 1.0 Universal | `Samples/cowbell/cowbell_vl3_rr{1,2}.wav` |
| `timbale_closed_{1,2}.flac` | ["Metal Timbale" takes by Suicidity, pack "Trash Conga"](https://freesound.org/people/Suicidity/packs/5890/), CC0 1.0 Universal | [90524](https://freesound.org/s/90524/), [90529](https://freesound.org/s/90529/) |
| `timbale_low_{1,2}.flac` | Suicidity, same pack, CC0 1.0 Universal | [90471](https://freesound.org/s/90471/), [90474](https://freesound.org/s/90474/) |
| `timbale_high_{1,2}.flac` | Suicidity, same pack, CC0 1.0 Universal | [90506](https://freesound.org/s/90506/), [90509](https://freesound.org/s/90509/) |
| `cuica_{1,2}.flac` | [“cuica (1).wav” by reinsamba](https://freesound.org/s/21715/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Two edited strokes from source windows 0.550–0.770 s and 1.415–1.615 s |

## Recorded S8 crowd vowels — CC0

Sustained playback derives a cached mono loop at runtime: a whole number of
F3 periods, a 60 ms or longer raised-cosine overlap, and circular one-period RMS
envelope flattening. Chops retain the unmodified FLAC. Bundled asset hashes
and tuning provenance below refer to those unchanged source FLACs.

Crowd sung near concert F at GameSoundCon2024, recorded by **ShangusBurger
(Shane Vincent)**. All three originals are lossless **96 kHz / 24-bit stereo WAV**,
released under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).

| Bundled file | Freesound original | Original filename |
| --- | --- | --- |
| `vox_ahh_53.flac` | [763909 — Ahh](https://freesound.org/people/ShangusBurger/sounds/763909/) | `CRWDSing_Ahh Vowel Sung Near F 01_ShaneVincent_GSC24_XY-AKG214-96k.wav` |
| `vox_eh_53.flac` | [763911 — Eh](https://freesound.org/people/ShangusBurger/sounds/763911/) | `CRWDSing_Eh Vowel Sung Near F 01_ShaneVincent_GSC24_XY-AKG214-96k.wav` |
| `vox_ooh_53.flac` | [763893 — Ooh](https://freesound.org/people/ShangusBurger/sounds/763893/) | `CRWDSing_U Ooh Vowel Sung Near F 01_ShaneVincent_GSC24_XY-AKG214-96k.wav` |

Original SHA-256s, APIv2 original-download endpoints and processing parameters are
pinned in [`vocal-samples.json`](../../scripts/vocal-samples.json). Rebuild with
`python3 scripts/fetch-vocals.py --from /path/to/originals --report samples/vocal-provenance.json`,
or omit `--from` and provide an OAuth access token in `FREESOUND_TOKEN` (Bearer).
Local files may use either the manifest's local filenames or the original names.
No lossy previews are used. Originals are hash-checked before processing.

Processing: downmix to mono 44.1 kHz; retain the steadiest half-second window
(Ahh 6.250–6.750 s, Eh 5.775–6.275 s, Ooh 4.575–5.075 s); constant polyphase
resampling to F3 (MIDI 53); 8 ms attack / 25 ms release fades; peak normalize to
−6 dBFS; encode 16-bit FLAC. Four spectral partials support F3, including the
fundamental and odd harmonics; suboctave energy is checked to reject octave errors.
Output hashes, before/after F0 and cents, spectral evidence and 300 ms sliding-window
pitch ranges are in [`vocal-provenance.json`](../vocal-provenance.json).
These are naturally spread crowd voices, not individually pitch-flattened singers.
Only these short windows met the few-cents stability criterion; no longer source
passage is claimed to be equally steady. Deep House, Euphoric and DnB hold notes by
looping the steady middle at rising zero crossings; UKG, Jersey and Baile use short
unlooped chops. User/mic audio overrides this built-in set.

## Sung vocals

The optional SING vocal track is not a sample: it is generated by a self-hosted neural singer (Scylla's Band v4,
Apache-2.0, built-in voices only) from the song's own melody and lyrics. Its model, runtime, voice and third-party
licenses are in [`singer/LICENSE.md`](../../singer/LICENSE.md); no weights are bundled in the app.
