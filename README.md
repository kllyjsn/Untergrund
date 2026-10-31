# UNTERGRUND — techno synthesis engine

Browser groovebox, 100% synthesized (Web Audio, no samples, no build step).

- 9 voices: 909-style kick (pitch env, click, drive, rumble bus), clap, snare, metallic hats/ride, perc, 303-style acid (accent/slide/drive, piano roll), poly chord stabs
- 8 patterns (A–H), per-track length (polymeter), swing, chain/arrangement mode
- Generators: hypnotic, industrial, acid, dub, peak-time; NEW SET builds an 8-pattern arrangement
- Creation workflow: five musical scales, per-track locks, controlled mutation, and VAR → to evolve a loop into the next pattern without losing the parts you want to keep
- Autonomous Artist: persistent identity and musical DNA, generated release catalog, weekly release calendar, and Artist Live performances that evolve arrangements and perform transitions
- Master: DJ filter, sidechain duck, saturation, glue compressor, limiter, reverb, ping-pong delay, ROLL / THROW / RISER performance FX
- EXPORT WAV (offline, 48 kHz / 24-bit) and REC (live capture)
- SoundCloud publishing: OAuth 2.1/PKCE, direct WAV + generated cover-art upload, metadata/tags, share links, release streak, and track performance stats

Run: `npm start` and open http://localhost:8000. Press `?` for shortcuts.

Open **ARTIST** to shape the artist identity and generate release-ready projects. **LIVE** performs the current set autonomously while continuing to evolve future scenes; all patterns remain editable before, during, and after the performance.

`test/` holds the offline render + WAV analysis harness (`python3 test/server.py`, `test/analyze.py`).

## SoundCloud setup

1. Register an app at https://soundcloud.com/you/apps.
2. Add `https://YOUR_HOST/sc-callback.html` as its redirect URI.
3. Set `SOUNDCLOUD_CLIENT_ID` and `SOUNDCLOUD_CLIENT_SECRET` in the deployment environment.

The secret is only used by `/api/sc-token`; audio uploads go directly from the browser to SoundCloud. Run `npm run dev` to use the local fake SoundCloud for end-to-end testing without credentials.
