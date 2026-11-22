# Recorded analog chord voices

Only the style/voice pairs below use the modularsamples recordings. `analogSet()` in
`js/livekit.js` is shared by preloading and engine dispatch. Ensemble tuples and
Acid are unchanged. Missing recordings retain the original synthesizers; loading
is locked per song in the same way as the other recorded instruments.

`recordedNote()` selects the closest measured center, including `BAND_TUNE`.
The chord envelopes retain the synth attack/hold/release timing. Hard Techno also
retains its 240-cent attack settling with a 14 ms time constant. Recordings are
not passed through the old saw-wave lowpasses: their own spectral character is
retained, with a low-cut before the existing STAB effects.

Dub changes only the sound sources inside `dubPad()`. Its filters, amplitude
envelope, output routing, two stereo seats, detune motion and 48-step trigger
spacing remain intact. `dubChord()` is unchanged. Per-color recording gains
compensate for the recordings' different response through the existing filters.

## Sustain

The measured maximum source lifetimes in the tuple checks below were:

| Voice | Maximum scheduled lifetime |
|---|---:|
| Hypnotic pad | 3.463 s |
| Ambient pad | 8.976 s |
| Peak pad / brass | 3.654 / 0.674 s |
| Hard Techno pad, tuples 3 / 4 | 2.542 / 3.069 s |
| Trance pad / brass | 4.613 / 1.549 s |
| Industrial brass | 0.679 s |
| Electro brass | 0.653 s |
| Electro Hip-Hop brass, tuples 1 / 3 | 0.616 / 0.611 s |
| Dub pad, all four tuples | 7.951 s |

Playback-rate shifts shorten the effective file duration too. All analog sources
therefore support sustain loops, including brass when DECAY is increased. A
cached copy of each buffer uses a 40 ms linear crossfade before the loop end.
The loop starts at 55% of the recording; its end is selected within 84–92% by
minimum squared difference across the crossfade windows of **all** channels.
The final crossfade sample equals the original sample immediately before the
loop start. This avoids the trimmed files' final fades without modifying the
decoded originals or collapsing stereo. The amplitude envelope releases over
the looping source, rather than allowing the file to end mid-chord.

## Brass mono compatibility

Recorded brass sums its detuned layers and chord seats before a cached M/S bus.
The mid is unchanged; an eighth-order Butterworth high-pass at 350 Hz removes
low side energy while retaining the upper-band stereo. A fourth-order 200 Hz
side cut still lost up to 1.53 dB in the 62–250 Hz mono comparison, so the higher,
steeper crossover protects that entire band. The per-style brass gains compensate
for the removed side energy; pads and synth fallbacks bypass this bus.

The stereo `jxbr_48` source has −0.364 L/R correlation at 62–150 Hz. `jbr` is
already mono, but its chord seats and detuned layers also create low stereo
energy, so both brass sets use the same post-voice path. No FLAC, hash or sample
cache revision changes are needed. `test/analog.mjs` checks native stereo renders
of all five mapped styles: 62–250 Hz correlation above 0.98, mono loss below
0.05 dB, nonzero low-band energy, retained upper-band stereo and bus reuse.
This side cut does not reconstruct bass already canceled in the mid signal.

## Tuple seeds and level comparison

Reference: `origin/main` at `7678aa3`. Chrome offline rendering, 48 kHz stereo,
four repetitions of the generated pattern with the most STAB events, six-second
tail, STAB solo with hook/lick disabled. Dub measurements isolate `dubPad()` by
disabling `dubChord()` in both versions. Full style processing remains enabled.
Tuple numbers are **one-based**. RMS is stereo mean-square over the whole render;
LUFS is the repository's BS.1770 integrated meter. Gains are style/voice scoped,
not seed-specific.

| Style | Tuple | Seed | Set | Main LUFS | Recorded LUFS | Δ LU | Δ RMS dB |
|---|---:|---:|---|---:|---:|---:|---:|
| Hypnotic | 3 | 20 | juno | -17.00 | -16.74 | +0.25 | -0.77 |
| Ambient | 1 | 1 | juno | -10.79 | -10.83 | -0.04 | -0.86 |
| Peak | 1 | 1 | jxbr | -18.71 | -19.58 | -0.87 | -0.36 |
| Peak | 4 | 3 | jpad | -14.28 | -13.65 | +0.63 | -0.95 |
| Hard Techno | 3 | 20 | jpad | -18.87 | -18.39 | +0.48 | -0.34 |
| Hard Techno | 4 | 3 | jpad | -18.43 | -17.50 | +0.93 | -0.03 |
| Trance | 3 | 20 | jxstr | -8.77 | -8.23 | +0.54 | +0.95 |
| Trance | 4 | 3 | jbr | -8.94 | -9.89 | -0.95 | -0.38 |
| Industrial | 2 | 5 | jxbr | -20.55 | -21.35 | -0.79 | -0.44 |
| Electro | 4 | 3 | jxbr | -19.64 | -20.46 | -0.82 | -0.56 |
| Electro Hip-Hop | 1 | 1 | jxbr | -16.36 | -17.23 | -0.87 | -0.25 |
| Electro Hip-Hop | 3 | 20 | jxbr | -15.47 | -16.47 | -1.00 | -0.31 |
| Dub | 1 | 1 | dpad | -29.17 | -28.78 | +0.40 | +0.18 |
| Dub | 2 | 5 | dpad | -30.40 | -30.37 | +0.02 | +0.01 |
| Dub | 3 | 20 | dpad | -27.68 | -27.14 | +0.54 | +0.10 |
| Dub | 4 | 3 | dpad | -32.29 | -32.46 | -0.17 | -0.12 |

### Brassy harmony proxy

Chroma cosine similarity against the corresponding synth render: Peak/1 **0.896**,
Industrial/5 **0.908**, Electro/3 **0.958**, Electro Hip-Hop/1 **0.903**,
Electro Hip-Hop/20 **0.935**. Method: sum FFT magnitudes into pitch classes,
100–2200 Hz, ±35 cents around the closest semitone; 16384-sample Hann windows,
4096-sample hop, stereo folded to mono.

This is a reasonably high similarity, **not harmonic identity or a listening
sign-off**. The recorded upper fifth adds ninths/elevenths: minor seventh stacks
become minor-eleventh colors, power chords acquire an added ninth. Electro/3 also
plays C major add9; the upper fifth of its D introduces **F# (#11)**. This is a
potential harmonic-color change, not something the cosine score can rule out.
Across that Electro render, F# chroma share was 6.91% synth versus approximately
7.50% recorded (including harmonic energy); the render contains both D minor and
C-add9 chords, so this aggregate does not isolate that note during C-add9.
No correction of the recording's internal fifth or alteration of chord notes
was made. Listening remains necessary to approve this color.

### Unchanged-style nulls

Same 48 kHz four-bar-plus-tail procedure, **full mixes**, seed 42:

| Style | Main vs recorded-code residual RMS | Main vs repeated-main residual RMS |
|---|---:|---:|
| Trap | -85.13 dBFS | -84.98 dBFS |
| Deep House | -85.98 dBFS | -87.04 dBFS |
| Acid | -85.38 dBFS | -83.94 dBFS |

The differences are at the observed browser render-repeat floor, not bit-zero.
The style gates also have exhaustive mapping/preload assertions in
`node test/analog.mjs`.

## Baselines

Only two style lines in `test/audio-baseline/fast.json` were re-recorded:

- Ambient: removing the saw's lowpasses changes presence/mids from -15.2 to
  -7.5 dB, spectral tilt from -3.30 to -2.07 dB/oct, and low-mid build-up from
  4.6 to 1.4 dB. This is the intended recorded timbre, not an absolute guardrail
  failure.
- Electro Hip-Hop: stereo Brassy changes low-side energy from -61.9 to -45.8 dB;
  this is still very low in absolute terms. Preserving its stereo recording
  intentionally differs from the old oscillator stack.

No loudness baseline, unrelated style line, absolute limit or ensemble was
changed. Industrial's existing crest-factor warning remains visible.

`test/hardtechno.mjs` has an unrelated pre-existing assertion at line 194:
it expects output gain `0.98`, while both the reference engine and this branch
set `0.89`. The identical failure was reproduced on `7678aa3`; it was not hidden
by changing the test or the mastering gain. The new recorded-source pitch-attack
assertions in `test/analog.mjs` pass.
