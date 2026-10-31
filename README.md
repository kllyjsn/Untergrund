# UNTERGRUND — techno synthesis engine

Browser groovebox, 100% synthesized (Web Audio, no samples, no build step).

- 9 voices: 909-style kick (pitch env, click, drive, rumble bus), clap, snare, metallic hats/ride, perc, 303-style acid (accent/slide/drive, piano roll), poly chord stabs
- 8 patterns (A–H), per-track length (polymeter), swing, chain/arrangement mode
- Generators: hypnotic, industrial, acid, dub, peak-time; NEW SET builds an 8-pattern arrangement
- Master: DJ filter, sidechain duck, saturation, glue compressor, limiter, reverb, ping-pong delay, ROLL / THROW / RISER performance FX
- EXPORT WAV (offline, 48 kHz / 24-bit) and REC (live capture)

Run: `python3 -m http.server` in this folder and open http://localhost:8000. Press `?` for shortcuts.

`test/` holds the offline render + WAV analysis harness (`python3 test/server.py`, `test/analyze.py`).
