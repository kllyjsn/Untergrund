# Composer style models

`js/composer-models.js` holds style statistics learned from the 21 public-domain / CC0 scores in
`data/repertoire/` (see `data/repertoire/LICENSE.md`). It is written by `node scripts/study-corpus.mjs`
(Node only, no dependencies, deterministic) and checked by `npm test`. It is not a neural network and
it has not seen any other music: every number comes from counting things in those 21 scores.

What is counted, per composer:

- **Harmony.** Each half-bar (or beat, in fast 3/4 and 6/8) is matched to the best roman-numeral chord
  template from its duration-weighted pitch classes, relative to the piece's `key` (with a simple
  local-key pass so modulating passages read in their own key). That gives chord-to-chord
  `transitions` (each row sums to 1), how often the chord changes mid-bar, inversions, and
  `cadences`: the last two chords of each phrase or section, sorted into perfect, half and deceptive.
- **Melody.** The top voice of the melody part: interval sizes in scale steps and semitones, the
  step share, how often the line changes direction, how often a leap is followed by a step back
  (leap recovery), and the share of notes outside the key (chromatic).
- **Rhythm.** Onset masks per beat (`1010` = onsets on the 1st and 3rd sixteenth of the beat).
- **Phrases.** Bars between cadence points where they can be found.
- **Texture.** Each bar of the accompaniment (left hand or lower parts) is labelled block chords,
  Alberti, broken arpeggio, sustained, or a single line.
- **Voicing.** Typical chord span and how far an arpeggio climbs, in semitones.

Composers with fewer than 2 pieces or 200 bars (Bach, Haydn, Satie) get no model of their own; their
pieces go into the `Classical era` / `Romantic era` models with the others from that era. Each model
lists the piece ids it came from.

`compose({form, seed, mode, composer})` in `js/classical.js` uses a model to choose period chord
progressions (a walk through the transition matrix that closes on learned cadences), to weight the
melody's intervals, contour and rhythm cells, to add chromatic approach notes, and to pick each
theme's accompaniment (Alberti, nocturne arpeggio, pulse/block chords, sustain). The form itself
(sonata, nocturne) is still UNTERGRUND's. With no `composer` the output is unchanged.
