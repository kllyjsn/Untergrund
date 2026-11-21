# Acoustic jazz balance

`node scripts/jazz-balance.mjs` compares eight-bar head excerpts at -16 LUFS.
It uses the repository's acoustic LTAS engineering curve, not a measured jazz
recording. Its deviations are diagnostic, not an acceptance certificate.

Bands (Hz): sub 20–60, bass 60–200, low-mid 200–500, mid 500–2000,
presence 2000–5000, brilliance 5000–10000, air 10000–20000. Additional
diagnostics isolate 20–40, upright fundamentals 40–200 and ride 4000–8000.
Ride bump compares 4–8 kHz with the stronger neighboring 2–4 or 8–12 kHz
band, normalized for octave width. Negative values indicate no presence bump.
Energy shares are level-independent; the script explicitly matches -16 LUFS
before measuring so audition excerpts can use the same gain reference.

The live upright previously inherited a synthesized sine fundamental from
`Engine.sampledBass`. Swing/modal select bass voice 1 with the live kit, so
that reinforcement was active on every walking note. Acoustic jazz now uses
the recording alone; existing non-jazz styles retain the reinforcement.
The removed sine was the dominant source of the excessive sub share, rather
than broad subsonic rumble. A high-pass was therefore not added blindly:
the recorded upright retains its low E fundamental and natural pluck.

The part readings are isolated renders at the full mix's matching gain, not
pre-master stems: nonlinear master processing can differ when isolated.
They cannot certify perceived lead prominence or replace listening.
Full-song WAVs from the previous revision are not refreshed by this script.

The initial corrected eight-bar measurements reduce swing's 20–60 Hz share
from 28.04/35.43% (seeds 11/42) to 5.08/7.94%, and modal/42 from 22.24%
to 7.45%. Remaining 20–40 Hz energy is 0.01–0.02%.

The combo rebalance uses jazz-only source trims (`JAZZ_MIX`) without changing
sample velocity layers: trumpet +6/+8 dB, comp -1.5/-2 dB, upright -4/-2 dB,
ride +15.5/+17.5 dB and foot chick +16 dB (swing/modal). Kick/snare stay quiet.
The ride's 5 ms fade and reduced first 30 ms soften the stick transient;
the original level returns by 60 ms, retaining the full recorded ring.
Raising the unshaped ride initially breached the true-peak ceiling. Jazz now
also leaves 2 dB post-clipper headroom, with measured makeup refitted to
+11.5/+9.5 dB before the limiter. Legacy styles retain their original path.

`node scripts/jazz-report.mjs --styles swing,modal --write-baseline` refreshes
the full-song WAVs and the two jazz loudness entries (three seeds per style).
The balance report covers both seeds 11/42 and records isolated true peaks as
well as LUFS. Brief foot chicks have low integrated loudness despite audible
transient peaks; they are not a sustained instrument. These objective checks
still do not replace listening against a genuine acoustic-jazz reference.

Final matched isolated LUFS (eight bars; columns: trumpet, piano, upright, ride):

| Style/seed | Trumpet | Piano | Upright | Ride |
| --- | ---: | ---: | ---: | ---: |
| swing/11 | -18.19 | -23.32 | -21.72 | -27.78 |
| swing/42 | -18.34 | -23.57 | -21.42 | -27.34 |
| modal/11 | -17.98 | -22.28 | -20.52 | -27.68 |
| modal/42 | -18.17 | -23.02 | -20.95 | -27.92 |

Ride bump is -4.27/-4.37 dB (swing/modal); matched ride transient peaks range
from -10.88 to -9.48 dBTP. Full-song LUFS for seeds 11/42 are -14.12/-14.58
(swing) and -14.18/-14.41 (modal), all below -2.84 dBTP.
