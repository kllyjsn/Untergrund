# Recorded jazz palettes

Jazz KEYS retain their saved voice index and use Greg Sullivan's Wurlitzer EP200,
CC-BY-3.0, at `8c3e581acda3594b553948ff0222d4f84a698376`. Four dynamics have
independent nearest-root maps. The previous FM implementation remains the loading
fallback. ENV controls attack and key-release damping; DETUNE offsets the sampled
notes. Stored decays are not replaced with oscillator envelopes or looped.

Run `python3 scripts/fetch-jazz.py --wurli` to reproduce the 42 mono 48 kHz/24-bit
FLACs. `samples/wurlitzer-provenance.json` records original/imported SHA256 hashes,
URLs, measured tuning and exact processing. Credit and license links are also in
the app's legal/attribution page.

## Narrow-band measurements

Native 48 kHz stereo, eight prescheduled G/head bars. Stereo-averaged Welch power
spectra use 8192-sample Hann windows, 131072 FFT interpolation, and a local median
within ±175 Hz excluding ±35 Hz. Frequency interpolation does not improve the
approximately 5.86 Hz physical resolution. A muted instrument provides a causal
control; raw-sample Welch16384 measurements identify the responsible recording.
Peak/median prominence is not a noise-floor or an automatic perceptual-defect score.

Wurlitzer: Jazz-Funk seed77 at 5.35–5.60 s exposes 2095 Hz (+39.45 dB over median,
44.06 dB drop with comp muted); seed42 at 5.35–5.60 s exposes 2199 Hz (+42.13 dB,
30.35 dB muted drop). Playback-rate tracing maps these to jep3_68's 2489/2075 Hz
partials. jep3_73's 2214 Hz band contributes a secondary 2636 Hz line in seed77.
Only these recorded takes receive Q50 notches (-14 to -18 dB), scaled by their
actual playback rate, rather than a broad low-pass on the electric piano.
