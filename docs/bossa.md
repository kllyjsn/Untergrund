# Bossa nova

`bossa` is an instrumental acoustic combo in JAZZ & HIP-HOP, 126–142 BPM. Describe accepts bossa, bossa nova, Jobim, Brazilian jazz and samba jazz. It uses straight eighths (`swing8 = 0`), a tiny sixteenth lilt, a dry intimate room and no ducking.

The two-bar rim pattern is `0,6,12 | 4,10` on the sixteen-step grid: 1, 2-and, 4 | 2, 3-and. It explicitly plays `snare_rim` (MIDI side-stick 37), not a backbeat snare. Soft eighth hats and low kick strokes at 0/3/8/11 support it; no ride, clap, electronic percussion or vocal interjections are generated.

Upright plays root on 1, fifth on 3, a short fifth pickup and an anticipated next root on step 14. It follows each bar's actual harmony and inherits the jazz-only recorded-upright path without synthesized sub reinforcement. The primary warm archtop plays syncopated batida, with thumb notes on 1/3. Alternatives are soft-take clean guitar and soft piano. There is no nylon-string sample: this is a softened recorded guitar palette, not a claim of a nylon recording.

Jobim-style changes include Imaj9–II9(#11 color)–ii9–bII9, I6/9–vi9–ii9–V13 and chromatic descending harmony. The airy sampled flute or soft-attack trumpet plays spacious instrumental phrases. Strong beats land on current chord tones, including the implied perfect fifth in rootless 6/9 and dominant voicings. The shared jazz arrangement is head–solos–head.

## Measurement

`node scripts/jazz-report.mjs --styles bossa --write-baseline` renders three full-song seeds (11/42/77), prints the full-song strong-beat audit and two-bar bass/guitar logs, and writes only bossa loudness entries. WAVs and diagnostic JSON are ignored artifacts under `test/out/jazz/`.

`node scripts/jazz-balance.mjs test/out/jazz/bossa-balance.json --styles bossa --seeds 11,42,77,5,20,25` renders eight-bar heads and isolated parts. Match the full mix to −16 LUFS and apply that identical gain to each isolated render; these are not additive pre-master stems. The `piano` diagnostic column is the comping part, including guitar. Both lead timbres and all three comp instruments have their own measured production trims.

| Seed | Lead | Comp | Upright | Hats | Kick | Rim |
|---|---:|---:|---:|---:|---:|---:|
| 11, archtop/flute | −17.72 | −22.72 | −20.55 | −41.55 | −37.94 | −36.08 |
| 42, archtop/flute | −17.33 | −22.41 | −20.99 | −41.48 | −37.86 | −36.35 |
| 77, piano/flute | −16.28 | −21.27 | −20.05 | −44.13 | −40.51 | −38.65 |
| 5, archtop/trumpet | −17.42 | −22.41 | −20.63 | −41.12 | −37.50 | −35.99 |
| 20, soft guitar/flute | −17.09 | −21.19 | −20.69 | −42.84 | −39.22 | −37.37 |
| 25, soft guitar/trumpet | −17.46 | −21.47 | −19.81 | −42.96 | −39.34 | −38.18 |

All values LUFS. Across these excerpts comping is 4.00–5.08 LU below lead, upright 2.35–3.77 LU below. Full songs 11/42 measure −13.76/−14.06 LUFS and −3.55/−3.54 dBTP. The quiet-tier makeup is +8.8 dB; the five-seed true-peak sweep reaches all four ensemble slots and both leads, worst −3.45 dBTP. Strong-beat lead/bass audit: 0/308 outside the chord at each requested seed.

These measurements are engineering checks, not subjective listening or visual verification.
