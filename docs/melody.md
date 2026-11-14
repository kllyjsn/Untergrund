# Vocal-length melodies

Groove and pop genres (`SING_PROFILES` in `js/melody.js`: deephouse, ukg, euphoric, trance, neosoul, boombap,
amapiano, afrobeats, reggaeton, trap, drill, hyperpop, and the song genres pop, rnb, rock, folk, country) write their hook as a sung-style lead line instead of the
2-bar call/answer riff. A new song genre sings once it has an entry in `SING_PROFILES`. Techno and the other
riff genres, and every project saved before this, keep the 32-step `hook.s` path unchanged.

## How a melody is written

- An 8-bar cycle of two 4-bar phrases (the bridge sometimes sings one 8-bar phrase).
- Each phrase has a planned contour: it rises (verse and chorus: an arch, bridge: a climb) to one peak note,
  then resolves to a planned last note (open on the 5th/2nd mid-section, home on the tonic at the end).
- Rhythm is syllable-friendly: onsets on the 8th grid with an occasional 16th push, a pickup into most
  phrases, a held note at the end of each phrase and a breath of at least a beat before the next.
- Pitches come from a small dynamic program over scale degrees: steps are cheap, leaps cost more and must
  recover by a step the other way, notes on beats 1 and 3 (and held notes) land on chord tones of the bar's
  chord, and only the peak note reaches the peak.
- The chorus's first bar is the hook: every chorus phrase opens with it, note for note.

## Songs set to words (pop, rnb, rock, folk, country)

The song genres (`song: 1` in `SING_PROFILES`) text-set every part instead: each part is four 2-bar lines, two
to a phrase, and each line's rhythm is derived from its syllable stresses (`js/prosody.js`: spelling-based word
stress and rhyme keys, no dictionary).

- A small dynamic program places syllables on the 16th grid: stressed syllables on beats (the downbeat best),
  weak ones between, leading weak syllables as a pickup. The verse talks (8ths and 16ths, lines ending anywhere in
  bar 2); the chorus sings (quarters and held notes, every line landing on bar 2's downbeat).
- The chorus's first and third lines are the title (the hook). The title starts on the chorus downbeat, rises by
  the song's signature interval (a 3rd to a 5th, chosen once per song) to the chorus peak and holds it, and returns
  note for note in the second phrase. The verse is AABA: its first line returns exactly in the second and fourth.
- Stressed syllables prefer chord tones, weak ones may pass or lean on a non-chord tone, held notes on strong beats
  stay chord tones. Pickup genres (country) leap from the pickup onto the line's first beat.
- Without words (GENERATE) the parts are set to virtual meters of the same shape. With lyrics (`fitLyrics` in
  `js/state.js`: the prompt plan, a song spec with lyrics, edited lyrics) the first verse, chorus and bridge (or pre)
  are set to their actual lines, deterministically from the words and the song's seed. Other genres never change.
- Without a model key, `rulePlan` writes the words (`js/lyric-writer.js`): a story verse in concrete pictures, a
  chorus that states the feeling around the title, rhymed couplets, and the title twice in every chorus.

## Format (`pattern.hook.m`)

```js
hook = {
  v, o, x,          // voice (HOOK_VOICES), octave, expression: as before
  s: [...32],       // the chorus's first two bars in the old 32-step format (preview, MIDI, hum UI)
  m: {
    bars: 8,
    n: [[start, dur, semi, vel, phrase, slot], ...],   // chorus
    v: [...],                                          // verse
    b: [...],                                          // bridge
    c: 1,                                              // optional: keys comp through the line (neosoul)
  },
}
```

- `start`, `dur`: 16th-note steps inside the 8-bar cycle (128 steps). A pickup into the first phrase starts
  below 0, in the last bar of the section before.
- `semi`: semitones above the key root at octave 4 (MIDI `60 + key + 12 * o + semi`), as in `hook.s`.
- `vel`: 0..1, shaped along the phrase's contour.
- `c`: set for styles whose chords comp under the voice instead of leaving gaps at off-beat sung onsets.
  Under any sung line the stabs sit lower (chorus 0.84, verse 0.78, bridge 0.45, `STAB_UNDER_VOICE` in js/engine.js).
- Melisma (R&B): notes that share a `slot` are one syllable sung over several pitches, so a phrase has as many
  syllables as distinct slots; `melodyScore()` reports `syllables` that way.
- `phrase`: line number inside the part; `slot`: syllable number inside the phrase, one per sung note, so
  lyrics map one syllable per slot.

`melodyScore(hook, { key, bpm })` turns this into the singer's view:

```js
{ format: 'untergrund-melody/1', bpm, bars: 8, beatsPerBar: 4,
  parts: { hook: [{ phrase, start, end, syllables, notes: [{ slot, midi, start, dur, vel, strong }] }],
           verse: [...], bridge: [...] } }   // times in beats from the start of the cycle
```

## Playback

`Sequencer.sungBar()` picks the part from the scene (arrangement unchanged): breakdowns E/F sing the bridge,
scenes with `hm` 1 the verse, `hm` 2 the chorus, and a one-bar fill finishes the phrase of the section it
closes. The cycle position is the song bar mod 8, so phrases line up with the 8-bar sections and the chord
changes. Strong notes still go through `hookSnap`, so user-edited chords stay consonant (for generated songs
the written notes are already chord tones). Licks and bass answers wait for the singer's rests.

## Measures (`scripts/composition.mjs`)

From the played lead (doubled harmony and countermelody excluded), a rest of a beat or more ends a phrase:
`phraseBars` (mean phrase length), `peakAt` (where the highest note falls, 0 start to 1 end),
`restsPerPhrase` (silences inside a phrase plus the breath after it) and `stepShare` (moves of 1-2 semitones).

Songwriting (song genres, each seed sung to rule-written lyrics, syllables laid on notes in order the way the
singer does): `stressBeat` (stressed syllables on a beat or a note of a quarter or longer), `titleDownbeat` (the
title's first stressed syllable on the chorus downbeat), `titlePeak` (the title carries the chorus's highest or
longest note), `hookRepeats` (title lines sung per song), `hookRecall` (title returns with the same onsets and
pitches), `rhythmContrast` and `onsetContrast` (verse vs chorus note-length classes and onset positions, total
variation distance), `holdRatio` (mean chorus note length over verse), `vocalRange` (semitones over all parts) and
`rhymeRate` (rhymed couplets in the written lyrics).

