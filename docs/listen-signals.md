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
| `keep` | WAV/stems/MIDI export, or remixing the song (crate saves are automatic on every new song, so they don't count) |
| `publish` | publishing the song (crate publish, SoundCloud) |
| `share` | copying/sending a song link, embed, or making/sharing a video |
| `live` | going live in a room |
| `love` / `unlove` | explicit reaction: the heart in Now Playing (a toggle, remembered per device) |
| `down` / `undown` | explicit reaction: the down arrow next to the heart. One tap is the whole signal; love and down exclude each other (switching sends `unlove`/`undown` first) |
| `why` | optional, only after a down: one tap on `boring`, `sounds_bad` or `not_my_style` (field `why`). A closed set; there is never a text box. A later tap replaces the reason |
| `rewind` | jumping back inside the song you're hearing (previous-track / restart while playing): `bar` is where from, `to` the target bar |

Every listen ends with exactly one of `complete`, `skip` or `partial` (switching songs, stopping, or closing the page). `keep`/`publish`/`share`/`live` count at most once per listen, and still attach to the song that just ended for 10 minutes after it stops.

## Record

Sent as `{ n: 'listen', p: { kind, genre }, l: <record>, t }`. The server keeps `p` as a normal counted event (`listen:<kind>`) and the cleaned record in a capped log.

| field | meaning |
| --- | --- |
| `v` | contract version (1; the fields added since are optional, so v1 readers keep working) |
| `kind` | one of the kinds above |
| `fp` | deterministic song fingerprint: two FNV-1a hashes of the musical state (patterns, chain, bpm, key, scale, params, master, ending, lyrics, swing, mutes/solos, orchestra levels/mutes). Same music → same `fp`, across devices; titles don't change it. Required. |
| `tid` | published track id when the song came from the crate/feed/share, else `''` |
| `seed` | the generator seed (`state.artist.seed`), `-1` if unknown |
| `style` | style/genre id (`acid`, `techno`, …) |
| `src` | how the song came to be: `generate`, `prompt` (Describe), `hum`, `drop` (Daily Drop), `piece`, `remix`, `crate`, `shared`, `jukebox`, `room`, `restored`, `radio` (started by Radio when the last song ended or was turned down), `release` (played on a `/t/<id>` release page without a share ref) |
| `surf` | where it was heard: `home`, `studio`, `shared`, `jukebox`, `room`, `release` (the `/t/<id>` page) |
| `ph` | hash of the normalized Describe prompt, when `src` is `prompt` |
| `pt` | the prompt text itself, **only on `start`**, max 120 chars, dropped if it looks like an email, URL or phone number |
| `bar`, `bars`, `sec`, `pct` | position when the signal fired: bar, song length in bars, section name, percent (`-1` if length unknown) |
| `arr` | song structure, **only on `start`**: score sections with bar counts (`intro-8.verse-16.drop-8`) or the pattern chain (`aabbc`, one letter per bar); max 80 chars |
| `via` | the share ref (`r` in the link, 8 chars) of the shared link this listen arrived through; absent otherwise. A `start` with `via` is a share-origin start; later visits by the same `lid` are returns |
| `ref` | the share ref minted for the link, **only on `share`** (joins to `via` on the listens it brought) |
| `why` | the down reason, only on `why` |
| `to` | the rewind target bar, only on `rewind` |
| `xp`, `arm` | the running experiment this listen is in and its arm (`control` / `variant`), only when one applies ([improvement-engine.md](improvement-engine.md#running-an-experiment)) |
| `co` | listener cohort: days since this device first opened the app (`d0`, `d1_6`, `d7_29`, `d30_plus`) |
| `dev` | device class: `phone`, `tablet` or `desktop` (pointer type + width; nothing finer) |
| `ms` | actual listening time so far in this listen (pauses excluded) |
| `lis` | random id of this listen (ties start → skip/complete → actions together) |
| `lid` | random per-device listener id (`localStorage['untergrund.lid']`), created only when analytics is on |
| `sid` | per-tab session id (added server-side from the batch) |
| `t`, `at` | client timestamp (ms) and server receive time (ISO) |

With Radio on (the default, `localStorage['untergrund.radio']`), picking a down reason moves on to the next song on the bar, so a `why` is usually followed by a `skip`; `not_my_style` also switches to another style in the same family. Radio itself sends `radio` events (`kind`: `on`, `off`, `next`, `skip`) and the Library sends `library` (`open`, `play`).

Anything else is dropped by `cleanListen()`; unknown kinds or a missing fingerprint drop the whole signal.

## Storage and reading

- `untergrund:d:<day>` — `listen` and `listen:<kind>` counts, like every event.
- `untergrund:ls:<day>` — `<style>:<kind>` counts per day.
- `untergrund:fp:<fp>` — `<kind>` counts per song fingerprint.
- `untergrund:listen` — raw records, newest first, capped at 5000. Max 300 records per client per hour.
- `untergrund:ev:listen:<day>` — the same records per UTC day (max 5000 a day, kept 29 days), read in pages by the improvement report.

`GET /api/events?summary=1` (stats token) adds `listening: { kinds, rates, styles }`, where rates are per `start`: `completion`, `skip`, `replay`, `rewind`, `love` (love − unlove), `down` (down − undown), `keep`, `publish`, `share`, `live`. `stats.html` shows them.

`GET /api/events?signals=1&limit=500[&fp=<fp>]` (stats token) returns `{ version, signals, song? }`: the raw log for offline learning and automations, plus counts/rates for one song.

`GET /api/events?improve=1[&min=<listens>]` (stats token) runs the improvement engine over the last 28 days of day logs (`&days=` for fewer): ranked findings, proposed experiments and the read-out of running ones. `GET /api/events?digest=1` returns the latest daily digest. See [improvement-engine.md](improvement-engine.md).

## Privacy

Nothing here identifies a person: ids are random, prompt text is short, filtered and only on `start`, client IPs are only used hashed for rate limits. Love/down/heard lists live in the listener's own `localStorage`. Down reasons are categorical only. Cohort and device are coarse enums.
