# Jazz-funk

`jazzfunk`: JAZZ & HIP-HOP, 96–110 BPM, light sixteenth swing (0.15), no eighth swing, no ducking or EDM drops. Aliases: jazz funk, jazz-funk, fusion, Headhunters, Herbie, Donald Byrd, Roy Ayers.

The LIVE kit has alternating syncopated kick bars, center-hit snare backbeats on 2/4 with quieter ghosts, sixteenth closed hats and offbeat open hats. The recorded E.BASS plays short syncopated root/octave figures with low-velocity, short-duration dead-note gestures; no 808 or synthesized sub layer. FM KEYS always supplies the Rhodes comping. Sparse recorded HORNS answer the trumpet during its head's fourth-bar breath.

Two-bar chord holds make i11–IV13, I7#9 and bVII9–IV13 vamps, with a contrasting bridge inside each sixteen-bar cycle. The head–solos–head form retains the full groove. Trumpet riffs use chord tones on quarter-note landings, dorian/pentatonic motion and weak-beat blue notes. The projected A4–Ab5 trumpet register avoids a large level jump between lower and upper sample regions as keys change.

Rhodes uses the existing 1:1 FM carrier/modulator, low articulation, register-dependent bark damping, and a low-pass ceiling of 2.6 kHz. The separate 14× tine modulator is silent for this style only. Both ensembles keep Rhodes and electric bass; small seeded release variations provide different articulations. Mixolydian was appended to the scale table because no such persisted mode existed.

## Reproduce

```
node scripts/jazz-report.mjs --styles jazzfunk --write-baseline
node scripts/jazz-balance.mjs test/out/jazz/jazzfunk-balance-final.json --styles jazzfunk --seeds 11,42,77
node scripts/true-peak.mjs --styles jazzfunk --assert
```

The balance method matches an eight-bar head's full mix to −16 LUFS, then applies identical gain to each isolated render. These are not additive pre-master stems. The `piano` diagnostic column includes the Rhodes and occasional supporting horn hit, not a sampled piano.

| Seed | Trumpet | Rhodes/hits | E.BASS | Kick | Snare | Closed hat | Open hat |
|---|---:|---:|---:|---:|---:|---:|---:|
| 11 | −18.17 | −23.06 | −21.15 | −24.96 | −26.11 | −34.86 | −34.93 |
| 42 | −17.78 | −23.66 | −21.60 | −25.25 | −26.41 | −35.15 | −35.23 |
| 77 | −18.33 | −22.46 | −21.25 | −25.06 | −26.22 | −34.96 | −35.03 |

LUFS. Relative to lead: comp 4.13–5.88 LU below, bass 2.92–3.82, kick 6.73–7.47, snare 7.89–8.63. Quiet-tier makeup is +6.5 dB. Full songs 11/42: −14.10/−13.94 LUFS, −2.66/−2.69 dBTP; three-seed true-peak sweep worst −2.89 dBTP. Each requested full-song lead/bass audit has 0/252 outside-chord strong-beat notes.

### Rhodes limitation

Measured comp centroids are 497/443 Hz at seeds 11/42, with 90.4/89.3% energy in 200 Hz–2 kHz and reported 4–8 kHz energy below 0.01%. Repository harsh-bump metrics are −34.3/−27.8 dB. This is a warm, deliberately dark spectrum, not an upper metallic hump. Seed 42's isolated low-mid bump is +2.9 dB: the residual risk is a muted/boxy FM character, not a bright ringing tine. The full mix does not have a positive low-mid bump.

FM remains the least acoustically authentic instrument in this palette. These engineering measurements cannot establish whether it sounds toy-like or convincingly like a Rhodes. No subjective listening or visual verification was performed. WAVs and JSON diagnostics remain ignored artifacts under `test/out/jazz/`.
