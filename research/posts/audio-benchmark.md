---
title: What our audio benchmark measures, and what it found
date: 2026-11-12
summary: We render every genre as whole songs offline and meter them the way a mastering engineer would. {{v audio.deep.counts.PASS}} of {{v audio.deep.counts.styles}} genres pass; one fails, and the failure is ours.
card: THE AUDIO BENCHMARK
---
UNTERGRUND writes and plays its music live in your browser, so there is no finished file to listen back to before you hear it. To check the sound itself, not just the notes, we built a benchmark that renders every genre offline, as whole songs, and meters the result the way a mastering engineer would: peaks, loudness, tone, stereo, balance, gaps, arrangement and endings. This post is the first run we are publishing. Every number and chart below is generated from one checked-in snapshot of that run, taken at commit `{{v commit}}`.

{{kpis}}

The short version: {{v audio.deep.counts.PASS}} of {{v audio.deep.counts.styles}} genres pass every check, {{v audio.deep.counts.WARN}} pass with warnings, and {{v audio.deep.counts.FAIL}} fails. The failure is real, it is a bug in our loudness calibration, and it is not fixed yet.

## How it works

Each genre is rendered with the same audio graph the app plays through, using an `OfflineAudioContext` instead of the speakers. The deep tier renders {{v audio.deep.counts.songs}} complete songs, three seeds per genre, each with an 8-second tail so we can hear how it ends. The fast tier renders the two densest bars and the ending of one seed per genre and runs on every change we make.

Every check has a warn and a fail threshold. They are physical guardrails, not taste: the master must stay under its −1 dBTP true-peak ceiling, the low end must survive a phone speaker folding stereo to mono, a part with notes must actually be audible, a song must not end in a hard cut or ten seconds of dead air. A genre's verdict is its worst check across all three seeds.

## Scoreboard

{{chart scoreboard}}

## What it found

Everything the deep and fast tiers flagged, in their own words:

{{findings}}

### The failure: REPERTOIRE is too loud

REPERTOIRE, the classical piano and chamber repertoire mode, targets −16 LUFS like the other classical styles. All three test pieces came out loud: {{v audio.deep.styles.repertoire.metrics.loudnessTarget.values.11|1}}, {{v audio.deep.styles.repertoire.metrics.loudnessTarget.values.42|1}} and {{v audio.deep.styles.repertoire.metrics.loudnessTarget.values.1234|1}} LU over the target. The worst, Chopin's Étude Op. 10 No. 1, measured {{v audio.deep.styles.repertoire.seeds.1234.loudness.integrated|1}} LUFS, which is louder than the −14 LUFS we aim for in hip-hop and neo-soul. Next to the symphonic styles on the same playlist it jumps out, and you would reach for the volume.

The cause is in our calibration, not in the music. `scripts/loudness.mjs` sizes its test render before the piece's score has been fetched, so it metered roughly one bar of each piece and tuned REPERTOIRE's make-up gain on that. Whole pieces are much denser than one bar, so the gain is too high. The fix is to meter whole pieces and re-calibrate; until then the benchmark keeps reporting this as a FAIL rather than having its threshold relaxed.

{{chart loudness}}

The club genres aim at −10 LUFS, quieter genres at −14, classical at −16. 19 of 29 genres land within 1 LU of their target on every seed. Besides REPERTOIRE, two more drift far enough to warn: AMBIENT ({{v audio.deep.styles.ambient.metrics.loudnessTarget.worst|1}} LU over) and DRILL ({{v audio.deep.styles.drill.metrics.loudnessTarget.worst|1}} LU over). Several others sit between 1 and 1.5 LU, under the warning line but not on the mark.

{{chart truepeak}}

Nothing crossed the ceiling. Every one of the {{v audio.deep.counts.songs}} songs stayed under the limiter's −1 dBTP ceiling; the closest was MINIMAL at {{v audio.deep.styles.minimal.metrics.truePeak.worst|1}} dBTP. But staying under the ceiling is not the same as being clean: a mix can stay under it by having its peaks shaved off on the way. So the benchmark also taps the master chain itself and measures how hard each stage works.

### Where the peaks go

The master ends in a limiter and then a clipper, and earlier in the chain each genre has a bus saturator, its DRIVE. All three flatten peaks, so we measure each one separately on the raw render, plus the crest factor of the result: how far the peaks stand above the average level of the most squashed bars.

{{chart squash}}

- **The clipper is working too hard in three genres.** In MINIMAL it takes more than 1 dB off a peak in {{v audio.deep.styles.minimal.metrics.clipperShare.worst|2}} of the song's 10 ms frames (as a share; the warning starts at 0.05), and its input reaches full scale in {{v audio.deep.styles.minimal.metrics.hardClip.worst|2}} of them, where the soft curve runs out and the clip is hard. DRILL is close behind ({{v audio.deep.styles.drill.metrics.clipperShare.worst|2}} and {{v audio.deep.styles.drill.metrics.hardClip.worst|2}}) and is also {{v audio.deep.styles.drill.metrics.loudnessTarget.worst|1}} LU over its loudness target; the two are likely the same problem, a mix pushed too hot into the end of the chain. JERSEY CLUB just crosses the line at {{v audio.deep.styles.jerseyclub.metrics.clipperShare.worst|2}}. These are the clearest new problems this run found.
- **HARD TECHNO's squash is its sound, not clipping.** HARD TECHNO has the second-lowest crest factor we measured, {{v audio.deep.styles.hardtechno.metrics.crest.worst|1}} dB, so it warns. But its clipper and limiter are idle: the clipper never takes more than 1 dB off (in {{v audio.deep.styles.hardtechno.metrics.clipperShare.worst}} of its frames), never sees full scale, and the true peak sits at {{v audio.deep.styles.hardtechno.metrics.truePeak.worst|1}} dBTP, far under the ceiling. The flattening happens earlier, in the bus saturator, which presses its loudest peaks down by {{v audio.deep.styles.hardtechno.metrics.saturatorDepth.worst|1}} dB. That is the DRIVE knob doing what hard techno asks of it: distortion is the sound design. INDUSTRIAL is the same story ({{v audio.deep.styles.industrial.metrics.crest.worst|1}} dB crest, {{v audio.deep.styles.industrial.metrics.saturatorDepth.worst|1}} dB of saturation, idle clipper). We keep the warning because a crest number can't tell taste from damage, but we don't plan to "fix" it.
- **Low crest with little drive.** HYPNOTIC, ELECTRO, DUB and BAILE FUNK also dip under the 6 dB crest line ({{v audio.deep.styles.hypnotic.metrics.crest.worst|1}}, {{v audio.deep.styles.electro.metrics.crest.worst|1}}, {{v audio.deep.styles.dub.metrics.crest.worst|1}} and {{v audio.deep.styles.bailefunk.metrics.crest.worst|1}} dB) with only 1–2 dB of saturation and light clipping. Here the squash comes from the parts and the mix rather than from one stage, and we have not decided yet whether it is a problem. They need listening, not a threshold.

The limiter itself is relaxed everywhere: no genre spends any meaningful time with more than 3 dB of gain reduction, and the deepest moment anywhere is {{v audio.deep.styles.minimal.metrics.limiterDeep.worst|1}} dB, in MINIMAL again.

### The other warnings

- **Loudness off target.** AMBIENT and DRILL, above. AMBIENT also has a wide loudness range ({{v audio.deep.styles.ambient.metrics.lra.worst|0}} LU); some of that is the style.
- **A flat arrangement.** ELECTRO's bar-to-bar loudness moves by less than 1 LU across a whole song ({{v audio.deep.styles.electro.metrics.contrast.worst|1}} LU). The energy chart below shows the breakdown is there; the rest of the song is one level.
- **Dead air.** NOCTURNE leaves {{v audio.deep.styles.nocturne.metrics.deadAir.worst|1}} s of silence after its last note before the next song can start. That one is simply a bug.

We record warnings rather than tune the thresholds to hide them, so they keep showing up until the music changes.

And these are the near misses: checks that passed, but by the smallest margin. In HYPERPOP, DRILL, NEO-SOUL and BREAKS the drop is no louder than the breakdown before it. The benchmark excuses that when the drop is clearly denser (at least 1.25× the notes and one more part per bar), because the limiter holds club styles near one loudness and a drop can land by adding parts. Whether it lands *well* is a question for ears.

{{closest}}

## Arrangement and endings

The benchmark meters every bar of every song. Below is the loudness of each bar for one seed of a few genres, with the arrangement's sections shaded behind it. A song with an arrangement goes up and down; a flat line would be a loop.

{{chart energy hypnotic,deephouse,neosoul,electro,dnb,trance,hyperpop,symphony}}

And the last seconds of each song, measured from the final hit. Good endings fall away smoothly; a vertical drop would be a hard cut, and a long flat tail would be dead air.

{{chart endings hypnotic,deephouse,ambient,nocturne,trap}}

## The notes underneath

The audio benchmark listens to the mix. A separate scorecard looks at the notes the generator writes before any sound is made: whether melodies come back to their motifs, whether chords move, whether voices move smoothly, and whether drums vary from bar to bar.

{{chart composition}}

These numbers describe the writing, not its quality. A low motif-recall score in a genre built on improvisation can be exactly right.

## Over time

{{chart trend}}

The trend is read from the git history of the checked-in baselines, so it only has as many points as there are recorded baselines. This is the first published run; later posts will add to it.

## What it can't conclude

- **Passing is not the same as sounding good.** Melody, groove, sound choice and taste are not measured. A genre can pass every check and still be boring.
- **Thresholds are guardrails, not genre ideals.** They catch clipping, phase problems, missing parts, hard cuts and silence. They do not say what a techno kick or a string section should sound like.
- **Three seeds per genre is a sample, not the whole space.** Every song is different; a problem that shows up in one song in fifty may not be in this run.
- **These are offline renders.** They use the same audio graph as playback, but not every device, browser or speaker. Bluetooth headphones, phone speakers and club rigs will all sound different.
- **Loudness targets are our choice.** −10 LUFS for club genres is loud by design; a streaming service will turn it down. The benchmark checks that we hit our own targets, not that the targets are right.

We will publish the next run once the REPERTOIRE calibration is fixed, with the before and after.
