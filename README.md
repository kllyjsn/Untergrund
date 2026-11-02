# UNTERGRUND — techno synthesis engine

[![CI](https://github.com/kllyjsn/Untergrund/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/kllyjsn/Untergrund/actions/workflows/ci.yml)

Browser music studio: Web Audio synthesis plus bundled CC0 recorded drums, bass, piano, guitar, horns and strings.

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

`npm test` (run in CI with `npm run build`, `node --check` and `scripts/smoke.sh` on every PR) verifies artist generation plus room presence, host controls, chat, DJ queue handoff, and native-set broadcast. `test/` also holds the offline render + WAV analysis harness (`python3 test/server.py`, `test/analyze.py`).

## Musician-first generation

UNTERGRUND generates performances, not collections of random notes. Every musical system should follow six rules:

1. **Listen:** important notes acknowledge the current harmony and the other instruments.
2. **Respond:** phrases answer each other instead of copying the same bar.
3. **Leave space:** silence is part of the groove; accompaniment gets out of a hook's way.
4. **Develop:** a song remembers one identity and changes it with purpose over time.
5. **Take risks:** tension, leaps and surprises are earned and saved for musical peaks.
6. **Remember:** variation must preserve enough of the motif for a listener to recognize it.

Sound quality is part of musicianship. Leads need expressive articulation and dynamics, bass belongs in a useful club register, and every genre needs its own timing feel rather than a globally quantized loop.

## Production backend

The site is a static build on Vercel project `untergrund-i2i9` (team kllyjsns-projects) with serverless functions in `api/`. Each backend piece is optional: when it is off, the app keeps working in the browser (IndexedDB/localStorage crate and jukebox, `BroadcastChannel` rooms for tabs on one browser) and never shows local participants as real remote listeners.

| Feature | Endpoint | Needs | When it is off |
| --- | --- | --- | --- |
| Public tracks | `/api/tracks` | `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash Redis) | 503 `enabled:false`, browser-only crate |
| Jukebox | `/api/jukebox` | same Redis env vars | 503 `enabled:false`, browser-only jukebox |
| Recorded set uploads | `/api/set-upload` | `BLOB_READ_WRITE_TOKEN` (Vercel Blob) | jukebox reports `uploads:false` |
| Multi-device Club rooms | `ROOMS_API_URL` → `rooms-server.mjs` | a persistent host (Fly.io) | rooms are per-browser |

### 1. Storage (Vercel dashboard)

1. Vercel → kllyjsns-projects → **Storage** → **Create Database** → **Upstash** → **Upstash for Redis** → Free plan, region `iad1` (Washington, D.C.) → Create. Connect it to project `untergrund-i2i9` (all environments) with no env var prefix, so it injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`. (`UPSTASH_REDIS_REST_URL`/`_TOKEN` also work.)
2. **Storage** → **Create Database** → **Blob** → name `untergrund-sets` → Create → connect to `untergrund-i2i9`. This injects `BLOB_READ_WRITE_TOKEN`.
3. **Deployments** → newest `main` deployment → ⋯ → **Redeploy**. Env vars only apply to new deployments.
4. Check: `curl https://www.untergrund.sh/api/tracks` and `/api/jukebox` return 200 with `"enabled":true`. `/api/jukebox` should also show `"uploads":true`.

### 2. Club rooms (Fly.io)

`rooms-server.mjs` is the production room service: only `/api/rooms/:room[/events]` and `/healthz`, no static files, no SoundCloud mock. `server.mjs` reuses the same logic (`api/_lib/rooms.js`) for local development. Rooms stay in memory in a single process. If the `KV_REST_API_*` secrets are set, changes (chat, sets, DJ queue, joins) are also written to Redis under `untergrund:room:<id>`, kept for 7 days and flushed on SIGTERM. Restarts, deploys and auto-stops then don't wipe rooms. Presence heartbeats are never written, so the Upstash free tier is plenty.

```sh
fly apps create untergrund-rooms            # once
fly secrets set -a untergrund-rooms KV_REST_API_URL=... KV_REST_API_TOKEN=...   # optional, same values as Vercel
fly deploy --ha=false                       # uses Dockerfile + fly.toml (one shared-cpu-1x/256MB machine, iad)
curl https://untergrund-rooms.fly.dev/healthz   # {"ok":true,...,"persistence":"redis"}
```

`fly.toml` sets `ROOMS_ALLOWED_ORIGIN=https://www.untergrund.sh,https://untergrund.sh` (a comma-separated CORS allow-list; `*` when unset) and an HTTP health check on `/healthz`. The machine auto-stops when idle and wakes on the next request. Then set `ROOMS_API_URL=https://untergrund-rooms.fly.dev` in Vercel (Production) and redeploy; `/api/room-config` should return it as `apiBase`.

Run the service locally with `npm run start:rooms` (port 8080) or `docker build -t untergrund-rooms . && docker run -p 8080:8080 untergrund-rooms`.

## SoundCloud setup

1. Register an app at https://soundcloud.com/you/apps.
2. Add `https://YOUR_HOST/sc-callback.html` as its redirect URI.
3. Set `SOUNDCLOUD_CLIENT_ID` and `SOUNDCLOUD_CLIENT_SECRET` in the deployment environment.

The secret is only used by `/api/sc-token`; audio uploads go directly from the browser to SoundCloud. Run `npm run dev` to use the local fake SoundCloud for end-to-end testing without credentials.
