# UNTERGRUND — techno synthesis engine

[![CI](https://github.com/kllyjsn/Untergrund/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/kllyjsn/Untergrund/actions/workflows/ci.yml)

Browser music studio: Web Audio synthesis plus bundled CC0 recorded drums, bass, piano, guitar, horns and strings.

The native iPhone app lives in [`ios/`](ios/README.md). It wraps the same engine in SwiftUI with native lock-screen controls, background audio, sharing, exports, haptics, deep links, and microphone permission.

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

`npm test` (run in CI with `npm run build`, `node --check` and `scripts/smoke.sh` on every PR) verifies artist generation plus room presence, host controls, chat, DJ queue handoff, and native-set broadcast. `test/` also holds the offline render + WAV analysis harness (`python3 test/server.py`, `test/analyze.py`). `test/listen.sh <style> <seed>` renders a song's stems with the engine's note log and writes a listening report (tuning per note, half-step rubs, notes ringing into the wrong chord, strum timing and rhythm, plus a spectrogram with the scheduled notes); `python3 test/sampletune.py` measures every recorded sample's pitch.

## Musician-first generation

UNTERGRUND generates performances, not collections of random notes. Every musical system should follow six rules:

1. **Listen:** important notes acknowledge the current harmony and the other instruments.
2. **Respond:** phrases answer each other instead of copying the same bar.
3. **Leave space:** silence is part of the groove; accompaniment gets out of a hook's way.
4. **Develop:** a song remembers one identity and changes it with purpose over time.
5. **Take risks:** tension, leaps and surprises are earned and saved for musical peaks.
6. **Remember:** variation must preserve enough of the motif for a listener to recognize it.

`npm run composition` plays every genre's full song through the real `Sequencer` with a note-logging engine and scores how it develops: distinct melody windows, motif recall, chords per song, chord voice movement, arrangement contrast and distinct drum bars (median of 8 fixed seeds). `npm test` fails if a genre regresses against `test/composition-baseline.json`; refresh it with `node scripts/composition.mjs --update` after a deliberate improvement.

Sound quality is part of musicianship. Leads need expressive articulation and dynamics, bass belongs in a useful club register, and every genre needs its own timing feel rather than a globally quantized loop.

## Production backend

The site is a static build on Vercel project `untergrund-i2i9` (team kllyjsns-projects) with serverless functions in `api/`. Each backend piece is optional: when it is off, the app keeps working in the browser (IndexedDB/localStorage crate and jukebox, `BroadcastChannel` rooms for tabs on one browser) and never shows local participants as real remote listeners.

| Feature | Endpoint | Needs | When it is off |
| --- | --- | --- | --- |
| Public tracks | `/api/tracks` | `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash Redis) | 503 `enabled:false`, browser-only crate |
| Jukebox | `/api/jukebox` | same Redis env vars | 503 `enabled:false`, browser-only jukebox |
| Recorded set uploads | `/api/set-upload` | `BLOB_READ_WRITE_TOKEN` (Vercel Blob) | jukebox reports `uploads:false` |
| Multi-device Club rooms + live directory | `/api/rooms`, `/api/rooms/:room[/events]` | the same `KV_REST_API_*` Redis (optional override: `ROOMS_API_URL`) | rooms 503 and stay per-browser; directory 200 `enabled:false` |

### 1. Storage (Vercel dashboard)

1. Vercel → kllyjsns-projects → **Storage** → **Create Database** → **Upstash** → **Upstash for Redis** → Free plan, region `iad1` (Washington, D.C.) → Create. Connect it to project `untergrund-i2i9` (all environments) with no env var prefix, so it injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`. (`UPSTASH_REDIS_REST_URL`/`_TOKEN` also work.)
2. **Storage** → **Create Database** → **Blob** → name `untergrund-sets` → Create → connect to `untergrund-i2i9`. This injects `BLOB_READ_WRITE_TOKEN`.
3. **Deployments** → newest `main` deployment → ⋯ → **Redeploy**. Env vars only apply to new deployments.
4. Check: `curl https://www.untergrund.sh/api/tracks` and `/api/jukebox` return 200 with `"enabled":true`. `/api/jukebox` should also show `"uploads":true`.

### 2. Club rooms (Vercel + Upstash)

`api/rooms.js` serves every room route on Vercel (vercel.json rewrites `/api/rooms/:room[/events]` and `/api/room-config` to it); `server.mjs` and `rooms-server.mjs` run the same logic from `api/_lib/rooms.js` against an in-memory KV (or Redis when `KV_REST_API_*` is set). Functions are stateless and concurrent, so nothing lives in process memory:

| Key | Type | Holds |
|---|---|---|
| `untergrund:room:<id>` | hash | `rev`, `seq`, `core` (host, queue, set card, jam parts) and one `m:<clientId>` field per member |
| `untergrund:room:<id>:auth` | hash | `sha256(secret) sessionToken` per client, claimed with `HSETNX` |
| `untergrund:room:<id>:events` | list | last 120 events |
| `untergrund:room:<id>:set` / `:jam` | string / hash | current set body, jam layers (sent only when the client's version is stale) |
| `untergrund:rooms:live` | zset | room ids by last activity: the index behind `GET /api/rooms` |

Members are written as independent fields, so heartbeats never race. Host/queue/set/jam changes and event appends go through one Lua script (`COMMIT` in `api/_lib/rooms.js`) that compare-and-sets `rev` and assigns `seq` atomically; a conflicting writer re-reads and retries. Everything expires after 7 days idle. `test/rooms-concurrency.mjs` fires ~110 parallel POSTs at four service instances, both on the in-memory twin and on a real `redis-server` through an Upstash-style REST shim.

Cost: an idle listener's heartbeat (every 4 s) is one `HGETALL`, plus one `HSET` every other beat; the client polls every 2 s when idle, every 0.7 s for 12 s after any chat/reaction/deck/jam activity or while holding a jam part, and not at all while the tab is hidden. Heartbeat replies count as polls. That is about 1,800 function invocations and 2,250 Redis commands per idle listener-hour (about 5,100 / 5,600 when active, 900 / 1,350 hidden). Room GETs are CDN-cacheable for 1 s, so listeners at the same `seq` share replies.

`GET /api/rooms` lists public live rooms (a current set, someone seen in the last 15 s, set not `public: false`), most listeners first, max 24: `{ enabled, rooms: [{ id, title, artist, style, bpm, key, listeners, dj: { name, shape, color, gear }, startsAt, replay }] }`. Check after a deploy: `curl https://www.untergrund.sh/api/rooms`.

### 2b. Optional: standalone room service (Fly.io)

`rooms-server.mjs` serves only the room routes and `/healthz` (no static files, no SoundCloud mock). Point the app at it with `ROOMS_API_URL` in Vercel; `/api/room-config` returns it as `apiBase` and RoomBus calls it instead of same-origin `/api/rooms`.

Prerequisites: a Fly org with billing enabled (trial orgs can't run machines) and an org-scoped token (`fly tokens create org -o personal`). App deploy tokens can't create apps.

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

## Analytics and error tracking

`js/analytics.js` sends anonymous funnel events (`app_open`, `generate`, `play_start`, `play_30s`, `save_track`, `publish`, `share_link_copied`, `room_join`, `room_go_live`, `export_wav`, `return_visit`) and client errors (window errors, unhandled rejections, AudioContext/render failures) in batches to `/api/events`, using `sendBeacon` on page hide. There's no PII: just event names, a few whitelisted short props (genre, kind…) and a random per-tab session id. Do Not Track, Global Privacy Control and automated browsers turn it off completely. Every listen also sends small enjoyment signals (start, complete, skip, replay, rewind, keep, publish, share, live, plus one-tap love or down in Now Playing, with optional one-tap reasons after a down) with a song fingerprint, seed, style, source and structure, documented in [docs/listen-signals.md](docs/listen-signals.md). The improvement engine turns them into ranked findings and proposed experiments (never applied automatically): [docs/improvement-engine.md](docs/improvement-engine.md).

- Storage: `api/events.js` writes daily Redis counters and HyperLogLog unique sessions when `KV_REST_API_URL`/`KV_REST_API_TOKEN` are set, and no-ops otherwise. `server.mjs` uses an in-memory store locally.
- Stats: set `STATS_TOKEN` in Vercel, then open `/stats.html?token=<STATS_TOKEN>` (the token moves into session storage and leaves the URL). Locally with `SC_MOCK=1` the token is `dev`.
- Page views: the free Vercel Web Analytics script loads on untergrund.sh once Web Analytics is enabled for the project in the Vercel dashboard. Custom events there need a paid plan, which is why the funnel is first-party.

## Legal requests

`/legal/` publishes the current terms, privacy notice, music-rights rules, provenance policy and contributor terms. Its private request form posts to `/api/legal`; requests are capped at 500 and expire after 180 days. Read them with `GET /api/legal?limit=50` and `Authorization: Bearer $STATS_TOKEN`. The rate limiter stores only a short hash of the requester's network address.

## Daily Drop notifications

Opt-in Web Push for the Daily Drop: "Today's drop: Paper Mirror" with the listener's streak, deep-linking to `/?drop=<date>`. Standard Web Push with VAPID, no paid provider or npm dependency (`api/_lib/webpush.js`). iOS allows it only from the installed home-screen app (iOS 16.4+), and the prompt only appears from a tap, so the app asks after someone has played a drop for 30 seconds (once, at most twice ever), and the Daily Drop card offers **Notify me** / **Turn off** after their first drop.

- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`: run `node scripts/vapid-keys.mjs` once and paste both. Rotating them silently re-subscribes open apps.
- `VAPID_SUBJECT` (optional): `mailto:you@example.com` or a URL, sent to push services as a contact. Defaults to `https://www.untergrund.sh`.
- `CRON_SECRET`: random string (`openssl rand -hex 32`). Vercel Cron sends it as `Authorization: Bearer …` to `GET /api/push` (`vercel.json` `crons`, daily at 16:00 UTC), which sends that day's drop once. Test by hand with `curl -H "Authorization: Bearer $CRON_SECRET" https://www.untergrund.sh/api/push` (add `?force=1` to send again the same day).
- Needs the same `KV_REST_API_URL` / `KV_REST_API_TOKEN` Redis (one hash, `untergrund:push:subs`). Subscriptions the push service reports gone (404/410) and ones whose app hasn't opened in 60 days are deleted during the send; listeners who already played today's drop aren't pinged.

Without the VAPID keys `/api/push` reports `enabled:false` and no notification UI appears.

## Creator accounts and public pages

Every published song gets a permanent page at `/t/<id>` that replays its stored state in the browser, and every creator can claim `/a/<handle>`. `vercel.json` rewrites both to `api/page.js`, which renders per-page Open Graph/Twitter tags and a generated cover PNG for link unfurls.

- `AUTH_SECRET`: 32+ random characters (`openssl rand -base64 48`). Signs the `ug_session` httpOnly cookie. Without it, accounts stay off and the app works as before.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Upstash Redis free tier): stores accounts, handles, follows and published track state.
- Sign in with SoundCloud reuses the SoundCloud setup above.

Locally, `server.mjs` uses an in-memory store saved to `.data/kv.json` and a generated dev secret, so everything works without env vars.
