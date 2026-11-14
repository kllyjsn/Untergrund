---
title: The opportunity in structured synthetic music
date: 2026-11-13
summary: A research agenda for music systems that separate composition, performance and rendering, then improve through listener preference signals without giving up control, attribution or reproducibility.
card: STRUCTURED SYNTHETIC MUSIC
data: great-music
---
## Abstract

Generative music is often treated as one problem: turn a prompt into an audio file. That framing hides three distinct problems with different requirements: **composition** decides what happens, **performance** decides how it is expressed, and **rendering** decides how it becomes sound. Systems that collapse all three into an opaque waveform can achieve striking fidelity, but they make precise editing, attribution, reproducibility and causal improvement difficult.

UNTERGRUND explores a different architecture. A deterministic symbolic engine writes a complete, inspectable song; a real-time audio engine performs it with synthesis and commercially safe recorded instruments; learned renderers can later perform bounded roles such as singing the written melody and lyrics. The same song can be reproduced, edited by section, rendered on different instruments and measured before and after sound generation.

This paper argues that the larger opportunity is not another prompt-to-audio endpoint. It is a **closed-loop music system** whose songs remain structured enough to edit and analyze, expressive enough to matter, and observable enough to improve from real listening behavior.

## 1. The architectural opening

Text-to-audio research has rapidly improved fidelity and controllability. [AudioLM](https://arxiv.org/abs/2209.03143) models audio with discrete tokens chosen to preserve both acoustic detail and long-term structure. [MusicLM](https://arxiv.org/abs/2301.11325) extends this direction to text-conditioned music. [MusicGen](https://arxiv.org/abs/2306.05284) uses a single language model over compressed audio streams and supports both text and melody conditioning.

These systems establish that learned audio models can produce convincing sound. A parallel line of symbolic work, including [Music Transformer](https://arxiv.org/abs/1809.04281), shows why musical structure needs its own representation: repetition, relative timing and self-reference operate over thousands of events and multiple timescales.

The opportunity is to combine the strengths without requiring one representation to do everything.

- **Symbolic composition** provides section boundaries, notes, chords, rhythms, lyrics, instrument roles and deterministic versions.
- **Generative performance** adds timing nuance, articulation, timbre and vocal expression while remaining conditioned on the score.
- **Audio rendering** turns those decisions into a stream or file and enforces physical constraints such as peak level, stereo compatibility and clean endings.
- **Listener feedback** connects the result to human preference and creates a learning objective beyond text adherence or audio fidelity.

This separation creates a practical advantage: every layer can be improved, replaced or compared while the others stay fixed.

## 2. Evidence from the current system

The benchmark snapshot covers {{v music.projects}} deterministic projects across {{v music.genres}} genres. Every seeded project reproduces exactly, and the cross-genre benchmark records {{v music.genreDistance.exactCollisions}} exact collisions. The audio benchmark renders {{v audio.deep.counts.songs}} whole songs through the production graph; {{v audio.deep.counts.PASS}} genres pass every guardrail, {{v audio.deep.counts.WARN}} pass with warnings, and {{v audio.deep.counts.FAIL}} fail.

{{chart identity}}

Reproducibility does not require sameness. Each genre produces {{v music.seeds}} distinct projects and arrangements from {{v music.seeds}} seeds, while the median distance to the nearest other genre is {{v music.genreDistance.median|3}}. This makes controlled experimentation possible: the system can reproduce one song, change one musical decision and compare the outcome.

The composition scorecard measures full songs before audio rendering. It tracks motif recall, harmony, voice movement, section contrast, vocal phrase shape and the relationship among verses, pre-choruses, choruses and bridges.

{{chart songwriting pop,rnb,rock,folk,country,deephouse,neosoul,afrobeats,trap,drill}}

For styles with vocal-length melodies, phrases last a median {{v composition.summary.phraseBars|2}} bars, reach their peak {{v composition.summary.peakAt|2}} of the way through, and move stepwise {{v composition.summary.stepShare|2}} of the time. The median chorus sits {{v composition.summary.chorusLift|1}} semitones above the verse and carries {{v composition.summary.chorusEnergy|2}} times its event energy.

These metrics are not a definition of quality. They are inspectable hypotheses about why a section works. That distinction is essential for the improvement loop proposed below.

## 3. Opportunity one: editable generative music

Waveform generation is naturally good at creating a complete impression. Structured generation is naturally good at revision.

A song with an explicit score and section map can answer requests such as:

- keep the chorus melody, but rewrite the verse;
- make the second pre-chorus climb without changing the first;
- replace the bridge harmony while preserving the vocal rhythm;
- render the same song with a different singer, band or mix;
- export stems or MIDI that remain aligned with the heard result;
- explain which bars changed and undo them without reconstructing the whole song.

This turns generation into an instrument rather than a vending machine. The commercial opportunity spans creator tools, adaptive game and fitness music, personalized soundtracks, education, live performance and media workflows that require many controlled variants rather than one final file.

## 4. Opportunity two: hybrid performance

The next perceptual step is an expressive singer conditioned on the melody and lyrics already produced by the symbolic engine. The learned model should perform a constrained role: timing, articulation, timbre, dynamics, breaths and pronunciation. It should not silently replace the composition.

That boundary has four advantages.

1. **Control:** notes, words, sections and keys remain editable.
2. **Attribution:** the system can state which layer wrote, performed and rendered each part.
3. **Evaluation:** the same score can compare singers, and the same singer can compare scores.
4. **Portability:** a song can move among renderers without losing its musical identity.

The same pattern applies beyond vocals. A learned drummer can humanize a fixed groove; a guitarist can voice and articulate written harmony; a mix model can propose balance changes while physical audio checks protect the output.

## 5. Opportunity three: the listener as the benchmark

Automatic metrics can detect damage and describe behavior. They cannot decide whether a listener enjoyed the song. [MusicRL](https://arxiv.org/abs/2402.04229) directly addresses this gap: it fine-tunes a music model with reward functions and human feedback, including a reported dataset of 300,000 pairwise preferences, and finds that text adherence and audio quality explain only part of musical preference.

The core product opportunity is therefore an enjoyment signal attached to every listen. Explicit feedback should stay lightweight, but behavior already provides a richer sequence of evidence:

- the listener stops in the opening bars;
- the listener reaches the chorus;
- a section is rewound;
- the song is replayed;
- the song is kept, published, shared or taken live;
- the listener asks for a revision instead of abandoning it;
- a listener returns to the same version later.

The signal must include the exact song fingerprint, seed, prompt, genre, section map, playback surface, progress and anonymous listener or cohort identity. Without that context, feedback becomes an average rating detached from the musical decisions that caused it.

## 6. The automatic improvement engine

The improvement engine should treat each release as a set of testable musical hypotheses.

**Collect.** Record explicit enjoyment and implicit listening behavior against immutable song versions.

**Diagnose.** Join outcomes to structural features such as motif recurrence, phrase length, chorus lift, density, harmony, arrangement, mix warnings and render path.

**Rank.** Surface findings with enough support to matter: for example, early skips concentrated before the first hook, replays correlated with a shorter pre-chorus, or saves improving when the second chorus changes instrumentation.

**Propose.** Generate bounded changes that preserve most of the song while altering one or two suspected causes.

**Test.** Route variants into randomized blind comparisons or natural product experiments. Do not compare a changed melody, singer, arrangement and mix simultaneously when the goal is causal learning.

**Promote.** Update defaults only when an effect repeats across seeds and does not erase genre identity or harm another important cohort.

**Remember.** Store the result as a versioned musical principle with evidence, scope and rollback, not as an unexplained weight change.

This loop is especially valuable in a structured system because it can connect preference to musical causes. A waveform-only reward can say that one file won. A structured reward can ask whether the win came from the hook arriving earlier, the chorus moving higher, the bridge leaving home, the singer taking a breath, or the low mids clearing under the vocal.

## 7. Experimental design

The first experiments should optimize for learning quality rather than model sophistication.

### 7.1 Unit of analysis

The immutable song version is the experimental unit. A play belongs to one version, one listener session and one playback context. Derived variants receive new fingerprints even if they share a seed.

### 7.2 Outcomes

Use a hierarchy rather than one reward:

- immediate rejection: early skip;
- engagement: meaningful completion and chorus reach;
- active interest: rewind and replay;
- ownership: keep or save;
- advocacy: publish, share and go live;
- explicit preference: enjoyment reaction or blind pairwise choice.

### 7.3 Comparisons

Pairwise tests are useful for controlled variants. Natural listening behavior is useful for ecological validity. The strongest evidence is agreement between them: a variant wins blind and earns more replay in normal use.

### 7.4 Guardrails

Preference optimization needs constraints. Otherwise, the system may learn to front-load every hook, maximize loudness, collapse genre differences or overfit the most active listeners. The existing identity, composition and audio benchmarks should remain release guardrails while preference becomes the objective.

{{chart energy pop,rock,country,deephouse,trap,trance}}

The energy trajectories show why one global recipe would fail. POP, TRANCE and TRAP use different forms of payoff. A preference model should learn conditional taste, not force every style toward the same arc.

## 8. Opportunity map

### Creator instrument

The near-term opportunity is a music workstation that starts with a complete song but keeps every musical layer editable. Generation reduces blank-page cost; structure preserves authorship and craft.

### Personalized music

A listener model can adapt arrangement, duration, density, vocals and energy to a person or context while retaining a reproducible composition underneath. This supports workouts, focus, sleep, games and live social spaces.

### Adaptive media

Games and interactive video need music that can react without losing continuity. Section-aware compositions can extend, branch, intensify and resolve on an external clock more reliably than a sequence of unrelated audio clips.

### Learning and practice

An inspectable generator can explain harmony, isolate parts, create graded variations and respond to a student's performance. The same representation supports listening, notation, MIDI and analysis.

### Music research infrastructure

Deterministic generation plus whole-song rendering creates a laboratory for questions that are otherwise hard to isolate: how much motif recurrence supports memory, how chorus register affects replay, or how performance changes preference for the same score.

## 9. Risks and governance

### Preference is plural

There is no universal enjoyment function. Models should preserve cohort and individual variation, allow local personalization, and avoid turning the loudest group into the default listener.

### Feedback can be gamed

Public counters and explicit ratings invite manipulation. Behavioral signals need abuse resistance, rate limits and uncertainty estimates.

### Optimization can flatten culture

If the reward favors broad averages, genre-specific tension, restraint and difficulty may disappear. Identity metrics and community-specific evaluation should protect against convergence.

### Attribution must survive the pipeline

Licenses, source instruments, prompts, edits, models and human contributions should remain attached to the song version. A hybrid system has more provenance to track, not less.

### Consent and privacy

Listener feedback should be collected with clear purpose, minimal identity, retention limits and a way to opt out. Personalization should not require building a general behavioral profile.

## 10. Research agenda

The next phase should answer five questions.

1. **Preference representation:** Which combination of explicit reactions and behavioral signals best predicts replay and long-term return?
2. **Credit assignment:** Can section-level listening behavior identify the musical decision responsible for a whole-song preference?
3. **Conditional taste:** How should the model separate personal, cohort, contextual and genre-specific preferences?
4. **Hybrid performance:** How much of perceived quality comes from the score, the performer and the mix when each can be held fixed?
5. **Safe promotion:** What evidence is sufficient to turn an experiment into a new generator default without reducing diversity?

## 11. Conclusion

Synthetic music becomes more valuable when it remains music all the way through the system: a composition with memory and form, a performance with expression, a render with physical integrity, and a listening history that can teach the next version.

The opportunity is a controllable creative system that learns. Its advantage does not come from producing more audio. It comes from connecting what was written, what was heard, what was enjoyed and what should change next.

## References

- Agostinelli, A. et al. [MusicLM: Generating Music From Text](https://arxiv.org/abs/2301.11325), 2023.
- Borsos, Z. et al. [AudioLM: a Language Modeling Approach to Audio Generation](https://arxiv.org/abs/2209.03143), 2022.
- Copet, J. et al. [Simple and Controllable Music Generation](https://arxiv.org/abs/2306.05284), 2023.
- Huang, C. Z. A. et al. [Music Transformer](https://arxiv.org/abs/1809.04281), 2018.
- Cideron, G. et al. [MusicRL: Aligning Music Generation to Human Preferences](https://arxiv.org/abs/2402.04229), 2024.
