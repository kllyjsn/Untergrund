# Neural singer (SING)

An optional vocal track: Untergrund's own generated melody and lyrics, sung by a self-hosted neural singer
(Scylla's Band v4, built-in voices only), mixed in the app as a vocal stem. With no singer configured the app is exactly
as before: `/api/sing` answers `{ enabled: false }` and the SING controls never appear.

```
song state ──js/sing-score.js──▶ untergrund-sing/1 request ──/api/sing (Vercel)──▶ singer (Modal L4 or local CPU)
   ▲                                                         │ cache by content hash (Blob)        │ Scylla's Band v4
   └── Engine.vocal(): stem on the song's grid ◀── decoded stem (Opus 48 kHz, or WAV) ◀───────────────┘
```

## The score (`js/sing-score.js`)

- **Notes are the engine's.** `sungNotes()` runs the real `Sequencer` over the arrangement with a `Recorder` and keeps
  every note the lead melody actually plays: section registers (verse low, pre-chorus climbing, bridge under the chorus
  peak, chorus on top), pickups, chord snapping and key lifts are all already applied. Times are 16th steps from the
  first downbeat, swing included, so the stem lines up with the band.
- **Lyrics by section.** `lyricTimeline()` gives each bar its lyric section and line, exactly as the lyrics view shows
  them (chorus lyrics repeat; other sections stop when their lines run out). Each melody phrase sings one line.
- **Syllables to slots.** A phrase's notes are grouped by melody syllable slot (`[start, dur, semi, vel, phrase, slot]`,
  `docs/melody.md`); `lineSlots()` syllables fill them in order. Several notes on one slot, or spare slots at the end of
  a line, become a melisma (`word~1`, `word~2` …). Too many syllables: the longest notes split. A fragment that can't
  hold half its line is left to the instruments.
- **Rests and breaths.** Gaps become `['-', 'rest', beats]` (at most 32 beats each); a gap shorter than a 16th is held
  through (legato) so a line only breathes where the melody does.
- **Style, voice, seed.** `pop` delivery, or `ballad` for folk/country/acoustic and songs under 84 BPM. The voice
  follows the lyrics' vocal (female `gwen`, male `felix`, choir `priya`) or the user's pick of the 14 built-in voices.
  The seed is the song's, so the same song always sings the same way.
- `validateSing()` (JS) and `validate()` (Python) apply the same limits: 1500 notes, 1600 beats, 7 minutes, 4000
  characters, MIDI 36–91, 40–240 BPM, built-in voices only, text equal to the notes' words.

## The client

`js/sing.js` + the SING row in the lyrics view (`js/describe-ui.js`): SING asks `/api/sing`, polls while it sings, and
decodes the stem. `Engine.vocal()` plays it into the mix bus at every bar (restarting only when playback jumps), so the
glue compressor, limiter and per-genre loudness targets treat it like any other part. The vocal level (−24…+6 dB around a
base 4 dB under the stem's −20 dBFS RMS) and a timing trim (±250 ms) are saved in `state.sing` with the project;
the stem is not saved and is fetched again by hash. Offline renders, WAV export, video and EXPORT STEMS (`sung-vocal`)
all include it.

## `/api/sing` (Vercel)

Served by `api/describe.js` (`vercel.json` rewrite, no extra function); logic in `api/_lib/sing.js`.
`POST <request>` → `202 { hash, job }` (or `200` if cached); `POST { job, hash }` → `202` while singing, then `200`
with `{ url }` (Blob) or the audio itself. 6 new songs per client per hour, 8 s upstream timeout, 256 KB body limit,
only `audio/ogg|mpeg|wav` up to 12 MB passed on.

Env on the **untergrund-i2i9** Vercel project:

| Variable | Value |
| --- | --- |
| `SINGER_URL` | the `web` endpoint `modal deploy` prints, e.g. `https://<workspace>--untergrund-singer-web.modal.run` |
| `SINGER_SECRET` | the same long random string as the Modal secret |
| `BLOB_READ_WRITE_TOKEN`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` | already set; stems cache in Blob under `sing/<hash>` |

Unset `SINGER_URL` to turn singing off again.

## The singer service (`singer/`)

`singer/singer.py` is the single entry point: `validate()` → engine `sing()` → `master()` (stem on the song timeline,
−20 dBFS RMS, peaks ≤ −1 dBFS) → Opus/MP3/WAV. Engines sit behind `BACKENDS`: `scyllasband` (implemented) and
`soulx-singer` (reserved, raises `NotImplementedError`). The model downloads once at the pinned revision and every file
is checked against `SHA256SUMS.json`.

Local, CPU (the same code path; ~0.5× real time on 8 cores with LiteRT):

```bash
python3 -m venv ~/singer-venv && . ~/singer-venv/bin/activate
pip install -r singer/requirements.txt
python singer/singer.py render request.json -o vocal.wav          # one request (from singScore())
SINGER_SECRET=dev python singer/singer.py serve --port 8765       # the HTTP API Modal serves
SINGER_URL=http://127.0.0.1:8765 SINGER_SECRET=dev PORT=8020 SC_MOCK=1 node server.mjs
```

Deploy to Modal (L4 GPU, `min_containers=0`, 60 s `scaledown_window`, weights in the `untergrund-singer-models` Volume):

```bash
pip install modal==1.2.1
modal token new
modal secret create untergrund-singer SINGER_SECRET="$(openssl rand -hex 32)"   # keep the value for Vercel
modal deploy singer/modal_app.py
curl https://<workspace>--untergrund-singer-web.modal.run/health
```

The first request after idle cold-starts a GPU container (image pull plus a one-time ~1 GB model download into the
Volume); later ones only load the model. Pins and licenses: [`singer/LICENSE.md`](../singer/LICENSE.md).
