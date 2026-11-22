# Jazz infrastructure

No existing style opts into these features.

- `master.swing8` is saved and sanitized in the range 0–1 (default 0). At 1,
  quarter-beat phases 0, 1/4, 1/2, 3/4 become 0, 1/3, 2/3, 5/6: the inner
  sixteenths bisect the long and short eighths. Intermediate values interpolate
  and blend out legacy sixteenth swing. At zero, legacy onset and gate timing
  is unchanged. `swingLate` is shared by scheduling, inter-hit instrumental
  timing and slide endpoints; `swingDuration` maps lead and bass gates onto it.
  This is a master setting, not a new pattern override or UI control.
  Legacy generated payloads omit the opt-in zero field to retain their
  fingerprints; new and sanitized states default it to zero.
- Chord indices 0–12 are unchanged. Indices 13–20 add DOM9, DOM13, 7ALT
  (#9/b13), MIN11, QUARTAL (So What), MAJ6/9, MIN6/9 and HALF-DIM.
  Extended stacks move together in octaves above MIDI 48 (C3), preserving
  their intervals instead of folding extensions into low clusters. DOM13
  omits the fifth, but does not automatically omit the root.
  Guitar grips may omit an extension to fit the hand while retaining third
  and seventh; keyboard voicings retain the full stack.
  Describe's harmony/scale edits retain these explicit chord types rather
  than replacing them with a legacy major/minor quality.
- Hook `tpt` preloads the existing trumpet recordings independently of the
  chord voice. It uses a soft attack, conservative gain, natural sample
  decay/release and 6-cent delayed vibrato on held notes. Missing recordings
  retain the existing synth-reed fallback and per-song sample lock.
  `airflute` remains the sampled flute hook; a PIANO chord voice can already
  play the recorded melody through the normal band-hook route.
