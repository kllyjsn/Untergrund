# Listen signals

Every listen in the player sends a few small, anonymous **enjoyment signals**, so we can learn which songs, styles, prompts and seeds people actually enjoy, and build automations on top. They ride the existing first-party analytics pipeline (`js/analytics.js` → `/api/events` → Redis). No vendor, no secret, no PII; Do Not Track, Global Privacy Control and automated browsers turn them off with everything else.

Code: `js/listen.js` (lifecycle + fingerprint), wired in `js/main.js`; validated and stored by `api/_lib/events.js`.

## Kinds

| kind | when |
| --- | --- |
| `start` | playback of a song begins (resuming a paused song is the same listen) |
| `complete` | the song plays to its end, or the listen stops at ≥ 90% of its bars |
| `skip` | the listen ends after < 30 s of actual listening (paused time doesn't count) |
| `partial` | the listen ends after ≥ 30 s but before 90% |
| `replay` | sent right after `start` when this device has heard the same fingerprint before |
| `keep` | saving to the crate, WAV/stems/MIDI export, or remixing the song |
| `publish` | publishing the song (crate publish, SoundCloud) |
| `share` | copying/sending a song link, embed, or making/sharing a video |
| `live` | going live in a room |
| `love` / `unlove` | the one explicit reaction: the heart in Now Playing (a toggle, remembered per device) |

Every listen ends with exactly one of `complete`, `skip` or `partial` (switching songs, stopping, or closing the page). `keep`/`publish`/`share`/`live` count at most once per listen, and still attach to the song that just ended for 10 minutes after it stops.

## Record

Sent as `{ n: 'listen', p: { kind, genre }, l: <record>, t }`. The server keeps `p` as a normal counted event (`listen:<kind>`) and the cleaned record in a capped log.

| field | meaning |
| --- | --- |
| `v` | contract version (1) |
| `kind` | one of the kinds above |
| `fp` | deterministic song fingerprint: two FNV-1a hashes of the musical state (patterns, chain, bpm, key, scale, params, master, ending, lyrics). Same music → same `fp`, across devices; titles don't change it. Required. |
| `tid` | published track id when the song came from the crate/feed/share, else `''` |
| `seed` | the generator seed (`state.artist.seed`), `-1` if unknown |
| `style` | style/genre id (`acid`, `techno`, …) |
| `src` | how the song came to be: `generate`, `prompt` (Describe), `hum`, `drop` (Daily Drop), `piece`, `remix`, `crate`, `shared`, `jukebox`, `room`, `restored` |
| `surf` | where it was heard: `home`, `studio`, `shared`, `jukebox`, `room` |
| `ph` | hash of the normalized Describe prompt, when `src` is `prompt` |
| `pt` | the prompt text itself, **only on `start`**, max 120 chars, dropped if it looks like an email, URL or phone number |
| `bar`, `bars`, `sec`, `pct` | position when the signal fired: bar, song length in bars, section name, percent (`-1` if length unknown) |
| `ms` | actual listening time so far in this listen (pauses excluded) |
| `lis` | random id of this listen (ties start → skip/complete → actions together) |
| `lid` | random per-device listener id (`localStorage['untergrund.lid']`), created only when analytics is on |
| `sid` | per-tab session id (added server-side from the batch) |
| `t`, `at` | client timestamp (ms) and server receive time (ISO) |

Anything else is dropped by `cleanListen()`; unknown kinds or a missing fingerprint drop the whole signal.

## Storage and reading

- `untergrund:d:<day>` — `listen` and `listen:<kind>` counts, like every event.
- `untergrund:ls:<day>` — `<style>:<kind>` counts per day.
- `untergrund:fp:<fp>` — `<kind>` counts per song fingerprint.
- `untergrund:listen` — raw records, newest first, capped at 5000. Max 300 records per client per hour.

`GET /api/events?summary=1` (stats token) adds `listening: { kinds, rates, styles }`, where rates are per `start`: `completion`, `skip`, `replay`, `love` (love − unlove), `keep`, `publish`, `share`, `live`. `stats.html` shows them.

`GET /api/events?signals=1&limit=500[&fp=<fp>]` (stats token) returns `{ version, signals, song? }`: the raw log for offline learning and automations, plus counts/rates for one song.

## Privacy

Nothing here identifies a person: ids are random, prompt text is short, filtered and only on `start`, client IPs are only used hashed for rate limits. Love/heard lists live in the listener's own `localStorage`.
