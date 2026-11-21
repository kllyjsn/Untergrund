# Straight-ahead jazz

`swing` and `modal` use the isolated grammar in `js/jazz.js`, rather than the
neo-soul or sung-pop generators. Its progression, upright walking line and
instrumental lead are resolved against the actual current/next bar at playback.
The eight arrangement slots retain editable drum/comp rows and progressions;
G/C/H mean HEAD/SOLOS/HEAD OUT. Solos vary deterministically by absolute bar and
thin the comping; the head recalls its eight-bar phrasing.

Swing's four progression families cover ii–V–I, rhythm-changes turnaround,
minor ii–V–i and dominant blues. Piano plays middle-register rootless guides;
alternate ensembles use recorded archtop guitar. Modal uses four-bar harmony
slots, quartal stacks and half-step or i–IV7 vamps. Repeated quartal roots last
eight bars, with a held left-hand piano pedal under offbeat fourth stabs. Both
use the sampled upright, ride, closed hats and trumpet/flute
leads (swing also allows the recorded piano lead). The `vocal` hook name on that
last ensemble routes through its recorded PIANO chord voice, not a singer.

Jazz has no clap/percussion/VOX row, kick ducking, electronic drops or risers.
The dedicated JAZZ pocket preserves the ride-led feel. Eighth swing eases from
0.85 to 0.65 over swing's tempo range; modal uses 0.7. The ride has broad cuts
at 5 and 7.8 kHz. Makeup into the existing safety limiter is +8.5 dB for swing
and +7.5 dB for modal.

Checks and reproducible WAV/measurement delivery:

```sh
node test/jazz.mjs
node scripts/true-peak.mjs --styles swing,modal --assert
node scripts/jazz-report.mjs --write-baseline
node test/loudness.mjs
```

The report uses the benchmark's bounded-look-ahead offline renderer, writes
four full 24-bit stereo WAVs at 44.1 kHz under `test/out/jazz/`, audits actual
sequencer/MIDI-dispatched bass/lead notes, and compares full-song spectra with
neo-soul/42. Seed 77 is additionally metered for the three-seed loudness mean;
`--write-baseline` extends only swing/modal loudness entries. It does not certify
subjective listening quality.
