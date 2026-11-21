# Acoustic jazz balance

`node scripts/jazz-balance.mjs` compares eight-bar head excerpts at -16 LUFS.
It uses the repository's acoustic LTAS engineering curve, not a measured jazz
recording. Its deviations are diagnostic, not an acceptance certificate.

Bands (Hz): sub 20–60, bass 60–200, low-mid 200–500, mid 500–2000,
presence 2000–5000, brilliance 5000–10000, air 10000–20000. Additional
diagnostics isolate 20–40, upright fundamentals 40–200 and ride 4000–8000.
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
However, isolated trumpet readings remain below piano, and the ride is very
quiet. Removing the synthetic sub is not a completed foreground mix rebalance;
that still needs adjustment and listening against a genuine acoustic reference.
