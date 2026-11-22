# Festival trap references for TRAP

Jason's quality anchor is Trap, and his Spotify "EDM Trap Mix" (2026-11-20) shows that the Trap he means is **festival/EDM trap**, not rap trap. This note compares the playlist's references with what `STYLES.trap` generates today and ranks the changes that would close the gap. The trait list comes from genre knowledge of these artists, not from streaming or analysing the tracks, so treat it as hypotheses for blind A/B packs.

## References (from the screenshot)

| Track | Artist | What it represents |
|---|---|---|
| High You Are (Branchez Remix) | What So Not, Branchez | Festival/future-bass trap: pitched vocal-chop hook, saw chords, big build → drop |
| Running Miles | Hippie Sabotage | Chill/melodic trap: mellow guitar/keys, laid-back half-time drums, vocal at the centre |
| Swag Surfin' | Whethan | Future-bass trap: bouncy chopped vocals, plucky synths, pitch-bent chords |
| Smoke & Retribution | Flume, Vince Staples, KUČKA | Wonky Flume sound design: warped detuned chords, glitchy chops, heavy sidechain |
| LIGHTS GO OUT | John Summit | **Tech house** (four-on-the-floor, around 125 BPM), not trap: playlist crossover, keep out of TRAP |
| Neck And Neck (DNMO Remix) | Zeds Dead, Dragonette, DNMO | Melodic bass: female topline, supersaw chords, distorted mid-bass drop |

Spotify also tags the mix "electronic, bass music, dubstep, dance, moombahton".

## Shared traits of festival trap

1. **EDM form, not rap form**: intro → build (riser, filter sweep, snare roll 8ths → 16ths → 32nds) → short gap or vocal "hey" → drop → breakdown → second build → varied drop → outro. The drop is the chorus.
2. **The drop lead is a synth or a vocal chop**: pitched/formant vocal chops, supersaw chords, brass stabs, detuned square leads or plucks. Not mallets or reeds.
3. **Wide, pumping harmony**: stacked detuned saw chords/pads with strong sidechain to the kick, a wide stereo image above a mono low end, long reverb in breakdowns.
4. **Two-layer low end**: an 808 or sine sub plus a distorted mid-bass/growl/wobble layer in the drop (Zeds Dead/DNMO, What So Not).
5. **Drums**: half-time kick/snare at 140–150 BPM (70–75 felt), a layered clap+snare on 3, triplet and 32nd hat rolls, crashes and reverse cymbals into drops, tom/snare fills.
6. **Chill branch (Hippie Sabotage)**: the same drums with organic guitar/keys and a vocal focus. Today's piano/guitar Trap ensembles are closest to this.

## Today's TRAP vs the references

| Area | TRAP today (code) | Festival trap | Gap |
|---|---|---|---|
| Tempo | 138–148 BPM half-time (`js/state.js` `STYLES.trap`) | 140–150 half-time | OK |
| Form | Rap form `i v c v c b c o`, no build or drop section (`js/longform.js`) | build → drop ×2 | **Large** |
| Pre-drop | Noise sweep and snare 16th/32nd roll exist; kick muted only for the last two 16ths (`js/engine.js`) | Riser, roll, ~1 beat of silence or a vocal hit | Small: the machinery exists |
| Chords | Piano / bells / strings / guitar (`INSTRUMENTS.trap`) | Supersaw/saw stacks, pads, plucks | **Large** for drops |
| Hook | Mallet / reed instrument melody | Vocal chop / saw lead / brass | **Large** |
| VOX chops | Empty Trap VOX pattern; `vox()` and `chopNote()` exist | Chops carry the drop | Medium: wiring only |
| Bass | 808 only (voice 2), no mid layer | 808 plus a distorted mid-bass in drops | Medium: Reese exists, no wobble LFO or growl |
| Hats | 16ths at 88% density; no triplet roll writer | Triplet/32nd rolls | Medium |
| Width/pump | No `MASTER_TONE` width for Trap; pump 0.2 | Wide chords, deep pump in the drop | Small to medium |
| Steering | "festival" → `mainstage` (energy only); "supersaw" → SAW; no Flume/What So Not/Whethan/Zeds Dead or "future bass" aliases (`js/describe.js`) | — | Small |

## Ranked plan (one blind pack per step, Music reviewer gate)

1. **Festival Trap ensembles**: add `INSTRUMENTS.trap` tuples with SAW chords (voice 0) plus a pad bed, and a synth/brass hook option, keeping the piano/guitar tuples as the chill branch. Fix timbre first (supersaws must sound produced, not toy-like: detune spread, lowpass, and stereo spread; check the 2–4 kHz narrow-peak rules).
2. **Build → drop form for those ensembles**: reuse the existing intro → build → drop template and drop detection with a full-beat pre-drop gap; the drop gets the chorus material, deeper pump and wider chords.
3. **Vocal-chop drop hook**: drive the drop hook through `vox()`/`chopNote()` pitched to the chord tones, on seeded VOX.
4. **Triplet hat-roll writer** at phrase ends and into drops.
5. **Mid-bass layer** in drops: Reese first, then a tempo-synced wobble filter LFO.
6. **Steering**: "festival trap", "future bass", "melodic bass" and the artist aliases above map to the festival branch.

Keep John Summit-style tech house out of TRAP; if Jason wants it, it is a house/tech-house style.
