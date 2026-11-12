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

No genre clipped. Every one of the {{v audio.deep.counts.songs}} songs stayed under the limiter's −1 dBTP ceiling; the closest was MINIMAL at {{v audio.deep.styles.minimal.metrics.truePeak.worst|1}} dBTP. The peaks group is clean.

### The warnings

The seven warnings are smaller, and they fall into three groups.

- **Drops that don't land.** In NEO-SOUL, BREAKS, DRILL and HYPERPOP, the peak sections of at least one song are no louder than the breakdown before them, so the drop arrives without a lift. ELECTRO is the flattest arrangement we measured: its bar-to-bar loudness moves by less than 1 LU across a whole song.
- **Loudness off target.** AMBIENT and DRILL, above.
- **Endings.** AMBIENT takes {{v audio.deep.styles.ambient.metrics.ringOut.worst|1}} s to ring out to −40 dB and has a wide loudness range; some of that is the style, but 18 seconds is longer than we want. NOCTURNE leaves {{v audio.deep.styles.nocturne.metrics.deadAir.worst|1}} s of dead air after its last note before the next song can start. That one is simply a bug.

We record warnings rather than tune the thresholds to hide them, so they keep showing up until the music changes.

And these are the near misses: checks that passed, but by the smallest margin.

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
