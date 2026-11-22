# Recorded jazz palettes

Jazz-Funk KEYS use the existing synthesized Rhodes path. KEYS keep their saved
voice index; ENV controls strike bark and body articulation, and DETUNE controls
tone-bar beating. Electric-piano chords and leads do not require recorded banks.

## Narrow-band measurements

Native 48 kHz stereo, eight prescheduled G/head bars. Stereo-averaged Welch power
spectra use 8192-sample Hann windows, 131072 FFT interpolation, and a local median
within ±175 Hz excluding ±35 Hz. Frequency interpolation does not improve the
approximately 5.86 Hz physical resolution. A muted instrument provides a causal
control; raw-sample Welch16384 measurements identify the responsible recording.
Peak/median prominence is not a noise-floor or an automatic perceptual-defect score.

## VSCO jazz winds

`python3 scripts/fetch-jazz.py --winds` imports the pinned CC0 VSCO-2 CE recordings
at `440300901dfe9275fd84e0b7763af1f8443ae62e`: 11-root/two-dynamic vibrato trumpet,
11-root/three-dynamic/two-RR staccato, eight-root/two-dynamic Harmon mute, and ten-root
flute sustain/expressive-vibrato. Existing orchestral/non-jazz banks stay untouched.
Harmon appends a selectable hook voice, with GM muted-trumpet program59. Modal
defaults to the open recorded trumpet; explicit saved Harmon choices are retained.
The softer Harmon performance did not meet the joint presence/leadership target:
at +8 dB its presence was -3.5 dB and eight-bar lead-muted drop 1.14 LU; a 4 dB
trim reached -6.3 dB presence but reduced the lead-muted drop to 0.50 LU.

The per-file maps in `samples/jazz-winds-resonances.json` are remeasured from these
new FLACs with Welch16384/101-bin local median, not copied from the old imports.
Only the two strongest 2–4 kHz peaks above 14 dB prominence and above 1.1× the
played root fundamental are selected, Q40 (the highest flute's C7 is preserved),
with frequency shifted by the exact tuned playback rate. Context measurements use
the lead-muted native render described above. There is no new broad lead low-pass.

Staccato is selected for notes up to 260 ms; velocity picks one of three recorded
dynamics (before the engine's 1.3x hook gain) and the written take identity picks
RR1/RR2. Jazz dispatch explicitly supplies this identity for generated and placed
notes; it alternates repeated notes and subsequent bars without a seek-sensitive
counter. Longer notes use the two
recorded sustain dynamics. Flute keeps deterministic short-note expvib alternation.
Incomplete loading retains the existing recorded lead/fallback, never an empty part.

### Bossa flute body and named lines

Bossa alone keeps the sustain (`jfl`) takes through short and held notes, the
original nominal-root tie selection, and the original peaking stages
(2950 Hz/Q0.8/+6.2 dB and 780 Hz/Q1.2/-2.5 dB). Other styles retain their
expressive-take alternation and their recorded resonance maps.

The Bossa sustain path uses the legacy `jazzNotches('fl', root)` source bands,
scaled by the actual tuned playback rate, rather than cuts on its dominant
natural partials. The A4 take's 2644 Hz/Q40 band is recalibrated from -18 to
-3 dB; its 3088 Hz/Q60/-14 dB band and the other legacy source bands are retained.
Omitting the 2644 Hz band leaves the seed77/2481 Hz guard at +10.55 dB;
restoring its original depth loses 2.34 dB of seed42's 2–4 kHz body versus main.
The shallow correction retains both the named-line and body targets.

Validation distinguishes natural partials from the historical named defects:
the broader all-peaks screen must stay within main +1.5 dB for seeds5/11/42/77;
every historical fixed-bin line, including the legacy guards, stays below +10 dB
using whole-eight-bar Welch16384 spectra and a local median35–175 Hz either side.
Nylon retains its original 2335.327 Hz/9.12–9.32 s comp-muted acceptance window.
Body measurements compare raw production-level 1.6–6.3 and 2–4 kHz power and
2–4 kHz RMS peak/median on flute stems and full mixes for Bossa11/42.

The importer now normalizes expressive takes against their first1.4 seconds,
with a 0.98 full-file peak guard. Existing shared `jflb` files were not releveled,
so non-Bossa playback stays unchanged. `--winds-legacy-levels` reproduces the
shipped legacy-level files; `--winds` uses the corrected reference normalization
for future imports and records that reference in provenance.

## Bossa trumpet take balance

The soft F4 sustain recording (`jtv1_65`) is level-matched down 3.2 dB on
the Bossa trumpet path only. Bossa 7's largest 2–4 kHz RMS peaks repeatedly
come from that take, roughly 0.11 and 0.35 seconds into the note. Matching
the take brings the eight-bar peak/median from 16.69 to 14.16 dB, toward
main's 13.53 dB. This is a full-spectrum per-take gain correction: no new
filter, altered sample, onset delay or cut to another root/layer/style.
The 2–4 kHz to 1.6–6.3 kHz power ratio changes only +0.05 dB; loudness-matched
2–4 kHz power changes −0.58 dB. Source filenames, hashes and CC0 licence
remain in `samples/jazz-winds-provenance.json`.
