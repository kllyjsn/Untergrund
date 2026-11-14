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
decodes the stem. `Engine.vocal()` plays it at every bar (restarting only when playback jumps) into the master chain,
past `Engine.bandDuck`: while it sings (`singingEnvelope()`: 40 ms before a phrase to 200 ms after it, 40 ms attack,
250 ms release) the band dips `VOCAL_DUCK_DB` (3.5 dB) and the vocal sits `VOCAL_OVER_BAND_DB` (+1 dB) over the ducked
band. Band plus vocal then carry the band's own power, so a sung song lands on its style's loudness target with no extra
limiting. `VOCAL_STYLE_DB` (pop 13.7, R&B 8.5, folk 3.5 dB, others 10) lifts the stem's −20 dBFS RMS to that balance through
the master chain; it was measured on the seed-7 songs below:

| Seed-7 song | Mix LUFS-I / true peak, before → after | Instrumental | Vocal vs band while singing, before → after |
|---|---|---|---|
| Pop (111 BPM, gwen) | −8.7 / −1.7 → −9.2 / −1.7 | −9.0 / −1.7 | −3.8 → +0.6 dB |
| R&B (79 BPM, felix) | −9.9 / −1.5 → −10.8 / −1.9 | −10.7 / −1.9 | −0.2 → +1.3 dB |
| Folk (90 BPM, gwen) | −13.5 / −1.9 → −15.0 / −2.0 | −14.8 / −2.0 | +2.2 → +1.4 dB |

Re-sung after the text-set melodies and written lyrics (#146), with the same settings:

| Seed-7 song | Mix LUFS-I / true peak | Instrumental | Vocal vs band while singing | Clipped samples |
|---|---|---|---|---|
| Pop | −9.4 / −1.8 | −9.2 / −1.7 | +0.2 dB | 0 |
| R&B | −11.3 / −1.9 | −11.2 / −1.9 | +1.5 dB | 0 |
| Folk | −14.9 / −1.9 | −14.7 / −1.9 | +1.4 dB | 0 |

The vocal level (−24…+6 dB around that base) and a timing trim (±250 ms) are saved in `state.sing` with the project;
the stem is not saved and is fetched again by hash. Offline renders, WAV export, video and EXPORT STEMS (`sung-vocal`)
all include it.

## Expression (`singer/expression.py`)

Scylla's Band v4 has no score fields for vibrato, scoops or breaths. It does take the two inputs its own `sing()` builds
per phrase: the per-frame melody (`note_phase_presence`: pitch, phase in the note, presence) and the per-phone frame
durations. `expression.sing()` is that same phrase loop with those inputs reshaped, so nothing reaches the model that it
wasn't trained on. With no knobs set it returns sample-for-sample what `runtime.sing()` returns. The request's `expr`
object (`SING_EXPR` / `cleanExpr()` in `js/sing-score.js`, `clean_expr()` in Python) is validated against fixed ranges.
Unknown names are dropped and values are clamped. `SING_STYLE` sends one set per genre:

| Knob | Range | What it does |
|---|---|---|
| `scoop` | 0–3 st | A phrase's first note, or a note leapt up to (≥ 3 st), starts this far below and curves up |
| `scoop_ms` | 20–250 ms | How long that approach takes |
| `glide_ms` | 0–150 ms | Portamento from the previous note inside a phrase (steps of up to a fifth) |
| `vib_cents` | 0–80 c | Vibrato depth (±) on held notes |
| `vib_rate` | 3.5–8 Hz | Vibrato rate |
| `vib_delay` | 0–1 s | Time into a note before the vibrato starts; shorter notes get none |
| `vib_ramp` | 0.05–1.5 s | Time the vibrato takes to grow to full depth (about 0.4 s) |
| `breath` | 0–40 dB | A short shaped-noise inhale before a phrase that follows ≥ 0.5 s of rest, this many dB under the phrase (0 = off) |
| `lead` | 0–1 | Share of a word's leading consonants moved ahead of its note, so the vowel starts on the beat |
| `stress_db` | 0–4 dB | Lift on stressed words (on beats 1 and 3, or a beat or longer) |
| `stress_vowel` | 0–0.6 | Share of a stressed word's consonant frames given to its vowel (a longer vowel) |
| `guidance` | 1–2 | × the bundle's melody/mode guidance |
| `align` | 0/1 | Moves each phrase (up to ±80 ms) so its sung onset sits on its first note, measured on the rendered audio the same way the report measures it |

Every phrase draws its noise from `seed + phrase`, the same as the runtime, and breaths from `seed + 7919 + phrase`,
so a request is deterministic.

## Voice defaults

`SING_STYLE` picks a voice per genre and vocal. `singer/voice_survey.py` sang the same 8-bar excerpt of each seed-7
song (seed 7, no expression) in all 14 voices, in the delivery mode that genre uses (pop: `pop`; R&B and folk:
`ballad`). It then scored the renders with `singer/vocal_metrics.py`:
score = −pitch error/5 − pitch wobble/5 + HNR/2 + 2 × onset clarity (cents, cents, dB, dB). Spectral centroid was
recorded as a brightness check but not scored. `voices.json` lists no voice gender, so the male slot uses the
best-scoring voice with a traditionally male name. Nobody has listened to confirm these picks.

| Genre (mode) | Ranking, best first | Female / default | Male |
|---|---|---|---|
| Pop (`pop`) | gwen 6.7, ariadne 6.2, priya 4.8, felix 4.5, thistle, orpheus, scylla, kincade, rex, poppy, stone, tuesday, max, ink | gwen | felix |
| R&B (`ballad`) | ariadne 6.6, rex 5.7, scylla 5.4, thistle 5.3, poppy 4.8, kincade, priya, tuesday, orpheus, stone, gwen, felix, max, ink | ariadne | rex |
| Folk (`ballad`) | ariadne 6.9, priya 5.4, thistle 5.1, gwen 4.5, scylla, poppy, rex 2.9, felix, kincade, tuesday, max, stone, ink, orpheus | ariadne | rex |

ink, orpheus and tuesday drift off pitch (36–82 c median error) in at least one genre or mode, and max has the most
wobble and the least HNR. They stay pickable but are never
defaults.

## Vocal chain and band carve

`js/vocal-chain.js` processes the decoded stem once per buffer and settings, and live playback, renders and exports
all play that copy. The chain runs high-pass → presence peak → de-esser (a sidechain above `deess.hz` pulls a high shelf down by up to
`deess.db` when it passes `deess.over` dB re the sung level) → RMS compressor (10/150 ms, 6 dB knee). The result is
then matched back to the stem's sung RMS, so the level calibration above still holds. `Engine.vocalSends()` adds a
plate (a convolver IR of `reverb.sec`) or the band's room, plus a filtered (280 Hz–4.8 kHz) tempo-synced delay. Both
return through `Engine.vocalOut`, so they follow the vocal's level and land in the `sung-vocal` stem. While the stem
sings, the CHORDS channel (keys, pads, guitars) gets a peaking cut of `carve.db` at `carve.hz` (Q 0.8). It follows
the same singing envelope as the band duck and rests at 0 dB.

| `VOCAL_FX` | HPF | Presence | De-ess | Comp | Reverb | Delay | Carve |
|---|---|---|---|---|---|---|---|
| Pop | 110 Hz | +2.5 dB @ 3.8 kHz | 6.5 kHz, ≤ 8 dB | −6 dB, 2.5:1 | plate 1.6 s, 0.14 | 1/8, fb 0.22, 0.10 | −3 dB @ 3 kHz |
| R&B | 90 Hz | +2 dB @ 3.2 kHz | 6 kHz, ≤ 8 dB | −7 dB, 2.5:1 | plate 2.4 s, 0.20 | dotted 1/8, fb 0.3, 0.12 | −3 dB @ 2.8 kHz |
| Folk | 85 Hz | +1.5 dB @ 3 kHz | 6.5 kHz, ≤ 6 dB | −5 dB, 2:1 | room, 0.35 | 1/16 slap, fb 0.08, 0.09 | −2.5 dB @ 3 kHz |

## `/api/sing` (Vercel)

Served by `api/describe.js` (`vercel.json` rewrite, no extra function); logic in `api/_lib/sing.js`.
`POST <request>` → `202 { hash, job }` (or `200` if cached); `POST { job, hash }` → `202` while singing, then `200`
with `{ url }` (Blob) or the audio itself. 6 new songs per client per hour, 8 s upstream timeout, 256 KB body limit,
only `audio/ogg|mpeg|wav` up to 21 MB (seven minutes of 24 kHz WAV) passed on.

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
