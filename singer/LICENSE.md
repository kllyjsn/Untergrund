# Neural singer: model, runtime and voice licenses

Untergrund's optional vocal track is sung by **Scylla's Band v4**, run on Untergrund's own server (`singer/`, a Modal GPU
function or a local CPU process). Nothing here ships with the web app: the browser only receives the sung stem of its own
song, and only from Untergrund's own `/api/sing` (stems cached in Untergrund's own Vercel Blob store). No third-party
audio is fetched, no reference recording is ever sent, and no voice is cloned.

| Component | Source (pinned) | License |
| --- | --- | --- |
| Model weights, 14 built-in voices, phonemizer data | Hugging Face `spybyscript/scyllasband`, revision `de0d1d9dd9ddb23ba8c7cd8b3ec6ea842f250868` (tag `v4-20261106`) | Apache License 2.0 |
| Runtime (`scyllasband` Python package) | GitHub `lowkeytea/scyllasband`, commit `57271a01f793ec0ed0baa1fd47eb2383518b9e79` (release `v4-20261106`) | Apache License 2.0 |
| Vocoder code derived from Vocos | via Scylla's Band (`THIRD_PARTY_NOTICES.md`) | MIT |
| Vocoder code derived from BigVGAN v2 | via Scylla's Band (`THIRD_PARTY_NOTICES.md`) | MIT |
| Grapheme-to-phoneme tooling derived from DeepPhonemizer | via Scylla's Band (`THIRD_PARTY_NOTICES.md`) | MIT |

The `LICENSE` files of the Hugging Face repo and the GitHub repo were compared byte for byte at these pins: both are the
unmodified Apache License 2.0 text (sha256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`). The
model's `SHA256SUMS.json` is checked against every downloaded file before first use (`fetch_model` in `singer/singer.py`).

**Voices.** Only the built-in voices are allowed: `ariadne`, `felix`, `gwen`, `ink`, `kincade`, `max`, `orpheus`,
`poppy`, `priya`, `rex`, `scylla`, `stone`, `thistle`, `tuesday`. They are part of the Apache-2.0 model release; the
request format has no field for a reference voice, and both `js/sing-score.js` and `singer/singer.py` reject any other
voice id.

**Sung output.** The vocal is generated from the song's own melody and lyrics, which belong to the song's author, as
the rest of an Untergrund song does (see `samples/live/LICENSE.md` for the instrument samples).

**Later backend.** SoulX-Singer (Apache-2.0, zero-shot) is a reserved slot only (`BACKENDS` in `singer/singer.py`): it
needs a voice clip the owner has the rights to, and is not implemented.

Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0. MIT notices: see the model's `THIRD_PARTY_NOTICES.md`
at the pinned revision (downloaded next to the weights).
