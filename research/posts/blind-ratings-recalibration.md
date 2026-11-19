---
title: What the first blind ratings taught us
date: 2026-11-19
summary: Jason rated a blind pack of four genres. One came back halfway decent and three terrible, for reasons none of our benchmarks measured. Here is what we learned, what we found wrong with our model judge, and how we are recalibrating.
card: BLIND RATINGS
---
Our benchmarks say what a song does: how loud it is, where its peaks go, whether its sections move. They have never said whether it sounds good. The only way to find out is to ask people, without telling them what they are hearing. So we built a blind pack: four pairs of loudness-matched excerpts from four genres, MINIMAL, DRILL, HARD TECHNO and TRAP, with the genres hidden and the key kept back until the ratings were in. Jason, who owns UNTERGRUND, listened and rated it. This post is what that taught us and what we are changing. We do not publish which excerpt was which, so that the same clips can be used blind again.

## What he heard

He rated each pair as a whole rather than picking a version. TRAP was "halfway decent". MINIMAL, DRILL and HARD TECHNO were "terrible", and he said why:

> "They don't sound smooth, there are sounds that are jarring and the instruments sound like toy instruments."

That is one listener and four musical passages, so it is a direction, not a measurement. But it is a precise direction: three things a listener hears, none of which any of our benchmarks was asking about.

## What our benchmarks said about the same genres

Here is the audio benchmark at commit `{{v commit}}`, three whole songs per genre. It is today's main, which already includes fixes made after the pack was rated (listed at the end), so it is not the audio he heard; it shows what the benchmark can and cannot see.

{{chart scoreboard}}

{{chart squash}}

The audio benchmark is built from physical guardrails: true peak, loudness against target, crest factor, clipping, mono fold-down, gaps and endings. On today's main it does flag the three genres he called terrible and passes TRAP, but only with warnings, and for other reasons: MINIMAL's master clipper takes more than 1 dB off a peak in {{v audio.deep.styles.minimal.metrics.clipperShare.worst|2}} of its frames, DRILL is {{v audio.deep.styles.drill.metrics.loudnessTarget.worst|1}} LU over its loudness target and clips in {{v audio.deep.styles.drill.metrics.clipperShare.worst|2}} of its frames, and HARD TECHNO's crest factor is {{v audio.deep.styles.hardtechno.metrics.crest.worst|1}} dB. None of those is "not smooth", "jarring" or "toy-like". A sharp attack that stays under the ceiling is not a peak problem, and a toy-like synth is not a loudness problem. The guardrails tell us when a mix is broken; they cannot tell us when it is unpleasant. The first lesson is that a pass or a warning was being read as a verdict on how a genre sounds, and the ratings show it is not one.

{{chart truepeak}}

{{chart loudness}}

## Our model judge was guessing

We also had an automated listener: an audio-capable language model (`google/gemini-2.5-flash`) that hears two excerpts, A and B, and says which is better. To guard against order effects it is asked twice, in both orders, and a preference only counts if the same version wins both times. An earlier pilot had found its verdicts conclusive only for MINIMAL, which looked like a property of that genre.

We tested the judge with a control that should have no answer: the same audio file, byte for byte, sent as both A and B, in seven genres, two repeats and both orders. It preferred A in **27 of 28** calls and said the two were the same once. No dimension ever favoured B. The two-order rule did its job, turning all fourteen identical pairs into *inconclusive*, so the judge never reported a false winner. But it means the judge's answers on subtle differences are position bias. Position bias in model judges is known from text evaluation (Zheng et al., 2023, [arXiv:2306.05685](https://arxiv.org/abs/2306.05685)); we have now measured it on our own audio.

The judge does hear large differences. With two cascaded 350 Hz low-pass filters on one version, the original won 12 of 12 calls, six of six order-stable. And temperature 0 did not make it repeatable: the full response text matched between repeats in only 6 of 20 pairs. The full tables and method are in [docs/judge-position-bias.md](https://github.com/kllyjsn/Untergrund/blob/main/docs/judge-position-bias.md).

So the judge stays an advisory note. It never overrides a measurement or a person.

## Measuring what he heard

The ratings gave us three words to measure: jarring, not smooth, toy-like. A pull request in review, [#185](https://github.com/kllyjsn/Untergrund/pull/185), adds four listening cues computed from the rendered stereo audio: how sharply attacks stand out (harsh transients), how hard the sound jumps between moments (transition jolt), how much short-term level jitters (lack of smoothness), and how much energy piles into narrow upper-mid resonances (toy-like resonance). They are tracked per genre and per part and are kept out of every gate and baseline: they report, they do not fail anything.

Scored on the rated pack itself and averaged over each pair's two versions, the cues point the right way, but only partly. Of the three pairs rated terrible, one scores above the halfway-decent pair on all four cues, one on three, and one on only a single cue, and only on the pair average: one of its versions scores below both halfway-decent versions. No single cue separates all three terrible pairs from the halfway-decent one. We do not publish per-pair or per-genre scores, because anyone who rescored the clips could use them to recover the blind key.

This is partial separation, not calibration. With four passages and one listener, these numbers can show the cues are pointing the right way; they cannot set a threshold.

## How we are recalibrating

People are the ground truth; every automated measure now has to earn its place against blind human ratings. Concretely:

- **Rate the cues, not just the pair.** A single verdict per pair cannot tell us which of jarring, rough or toy-like is the problem, or which part causes it. Future packs ask for each cue separately and include isolated instruments.
- **Compare within a genre.** Pairs that differ inside one genre, including held-out ones the cues were not tuned on, so a cue that only learns "MINIMAL is different from TRAP" does not pass for a harshness meter.
- **Keep the counterexamples.** Hard techno is supposed to hit hard; a deliberate stop is not a jolt; a real bell has a narrow resonance. Those go in as cases the cues must not punish.
- **Treat the model judge as a check for large changes only**, with identical-audio controls in every run.

## In progress

None of this is finished, so none of it is a result yet:

- The cues in [#185](https://github.com/kllyjsn/Untergrund/pull/185) are being scored across whole songs at the benchmark's three fixed seeds, and the pull request is still in review.
- The automated listening review is being reworked to be order-stable across genres, using identical-audio controls and scores averaged over both orders.
- Fixes for these genres have landed or are in review: less master clipping in MINIMAL ([#174](https://github.com/kllyjsn/Untergrund/pull/174)), a lighter mallet lead in DRILL's bells ([#176](https://github.com/kllyjsn/Untergrund/pull/176)), restored punch in HARD TECHNO ([#178](https://github.com/kllyjsn/Untergrund/pull/178)), room for TRAP's backbeat ([#179](https://github.com/kllyjsn/Untergrund/pull/179)) and faded 808 tails ([#186](https://github.com/kllyjsn/Untergrund/pull/186)). Whether they sound better is for the next blind pack to say, not this post.
- New blind packs are being built from the latest main, so the ratings can follow the fixes.

## References

- Zheng, L., Chiang, W.-L., Sheng, Y., et al. (2023). Judging LLM-as-a-judge with MT-Bench and Chatbot Arena. *NeurIPS 2023 Datasets and Benchmarks*. [arXiv:2306.05685](https://arxiv.org/abs/2306.05685)
