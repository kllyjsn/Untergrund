# UNTERGRUND — techno synthesis engine

Browser groovebox, 100% synthesized (Web Audio, no samples, no build step).

- 9 voices: 909-style kick (pitch env, click, drive, rumble bus), clap, snare, metallic hats/ride, perc, 303-style acid (accent/slide/drive, piano roll), poly chord stabs
- 8 patterns (A–H), per-track length (polymeter), swing, chain/arrangement mode
- Generators: hypnotic, industrial, acid, dub, peak-time; NEW SET builds an 8-pattern arrangement
- Creation workflow: five musical scales, per-track locks, controlled mutation, and VAR → to evolve a loop into the next pattern without losing the parts you want to keep
- Autonomous Artist: persistent identity and musical DNA, generated release catalog, weekly release calendar, and Artist Live performances that evolve arrangements and perform transitions
- Club Rooms: customizable avatars, a beat-reactive crowd, room chat and reactions, listener presence, DJ queue and deck handoff, shareable room links, and synchronized playback of UNTERGRUND-native sets
- Master: DJ filter, sidechain duck, saturation, glue compressor, limiter, reverb, ping-pong delay, ROLL / THROW / RISER performance FX
- EXPORT WAV (offline, 48 kHz / 24-bit) and REC (live capture)
- SoundCloud publishing: OAuth 2.1/PKCE, direct WAV + generated cover-art upload, metadata/tags, share links, release streak, and track performance stats

Run: `npm start` and open http://localhost:8000. Press `?` for shortcuts.

Open **ARTIST** to shape the artist identity and generate release-ready projects. **LIVE** performs the current set autonomously while continuing to evolve future scenes; all patterns remain editable before, during, and after the performance.

Open **CLUB** to enter an avatar listening room. Rooms only broadcast project state created inside UNTERGRUND: no third-party catalog, imported song, or sample stream is accepted. The current DJ can broadcast the open project, listeners synchronize the same synthesized arrangement locally, and queued creators can take the deck.

`npm test` verifies artist generation plus room presence, host controls, chat, DJ queue handoff, and native-set broadcast. `test/` also holds the offline render + WAV analysis harness (`python3 test/server.py`, `test/analyze.py`).

## Musician-first generation

UNTERGRUND generates performances, not collections of random notes. Every musical system should follow six rules:

1. **Listen:** important notes acknowledge the current harmony and the other instruments.
2. **Respond:** phrases answer each other instead of copying the same bar.
3. **Leave space:** silence is part of the groove; accompaniment gets out of a hook's way.
4. **Develop:** a song remembers one identity and changes it with purpose over time.
5. **Take risks:** tension, leaps and surprises are earned and saved for musical peaks.
6. **Remember:** variation must preserve enough of the motif for a listener to recognize it.

Sound quality is part of musicianship. Leads need expressive articulation and dynamics, bass belongs in a useful club register, and every genre needs its own timing feel rather than a globally quantized loop.

## Club Rooms deployment

`server.mjs` includes a credential-free in-memory room service for local development and self-hosted deployments. It exposes presence, chat, reactions, DJ queue state, and the current native set through `/api/rooms/:room`.

Vercel hosts the frontend and SoundCloud functions, but its stateless functions are not the long-lived room service. For production multi-device rooms:

1. Deploy `server.mjs` to a persistent Node host.
2. Set `ROOMS_ALLOWED_ORIGIN=https://untergrund.sh` on that service.
3. Set `ROOMS_API_URL=https://YOUR_ROOM_SERVICE` in Vercel.

Without `ROOMS_API_URL`, the room UI still works through `BroadcastChannel` for tabs on the same browser. The product never represents those local participants as real remote listeners.

## SoundCloud setup

1. Register an app at https://soundcloud.com/you/apps.
2. Add `https://YOUR_HOST/sc-callback.html` as its redirect URI.
3. Set `SOUNDCLOUD_CLIENT_ID` and `SOUNDCLOUD_CLIENT_SECRET` in the deployment environment.

The secret is only used by `/api/sc-token`; audio uploads go directly from the browser to SoundCloud. Run `npm run dev` to use the local fake SoundCloud for end-to-end testing without credentials.
