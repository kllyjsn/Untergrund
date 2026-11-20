---
title: Every genre, every seed, under −1 dBTP: a true-peak gate
date: 2026-11-20
summary: We now render {{v truePeak.songs}} whole songs across {{v truePeak.genres}} genres on every change and block any that peaks over −1 dBTP. The first sweep found {{v truePeak.over}} songs over the ceiling on main.
card: THE TRUE-PEAK GATE
---
Every UNTERGRUND master ends in a limiter set to −1 dBTP, the ceiling streaming services ask for so a song survives lossy encoding and cheap DACs without clipping. A ceiling on the limiter is a promise, not a measurement: the limiter works on samples, and a waveform can swing higher between two samples than at either one. This week a festival TRAP song, seed 20, measured −0.93 dBTP during review, over the ceiling, and it reached a human listener before any check caught it. Our audio benchmark only renders three seeds per genre, and seed 20 was not one of them.

So we built a gate. Every change to UNTERGRUND now renders {{v truePeak.songs}} complete songs, every one of our {{v truePeak.genres}} genres at seeds 11, 42 and 1234 plus whichever seeds it takes to reach every instrument ensemble a genre can pick, through the same audio graph the app plays through, and meters each one's 4×-oversampled true peak. If any song goes over −1 dBTP, the change is blocked. This post reports the first sweep. Only test files had changed, so the audio is main's sound at snapshot commit `{{v commit}}`.

## What it found

Two songs on main already cross the ceiling.

- **TRAP, seed 20: {{v truePeak.styles.trap.seeds.20.tp|2}} dBTP.** Built the way the app's NEW SET builds a song, seed 20 peaks in its G section at bar {{v truePeak.worst.bar}}, {{v truePeak.worst.at|0}} seconds in. That is louder than the −0.93 dBTP seen in review, which rendered a shorter chain without the song plan. The overshoot is not new to the change under review; it is on main.
- **EUPHORIC, seed 11: {{v truePeak.styles.euphoric.seeds.11.tp|2}} dBTP**, at bar 98 of 116.

The gate records both as known breaches. They may not get louder, and once one is fixed the gate insists it is taken off the list, so the list can only shrink. Any other song that crosses the ceiling fails the build.

{{chart sweep}}

## Most songs live just under the ceiling

The median song peaks at {{v truePeak.median|2}} dBTP, but {{v truePeak.within}} of the {{v truePeak.songs}} sit in the last half decibel under the ceiling. MINIMAL is the tightest genre: all four seeds land between −1.05 and −1.03 dBTP, at the same bar (84). POP, DRILL and HARD TECHNO are within 0.15 dB on their worst seed. The classical styles and REPERTOIRE have the most room, at −2.3 dBTP or lower.

That cluster is what a limiter looks like from outside: it holds samples at its threshold, and the true peak overshoots by however much the waveform swings between them. Why TRAP and EUPHORIC overshoot by more than the rest is not measured yet; one untested guess is more high-frequency energy at the limiter in their hottest sections.

For comparison, the deep audio benchmark's true peaks, from three seeds per genre:

{{chart truepeak}}

{{chart peakwhere}}

Hot songs do not peak in one place. Of the 50 songs within half a decibel of the ceiling or over it, 28 peak in the back half of the song and 22 in the front half, 19 of those between 20% and 50% of the way in. A fix has to cover whole arrangements, not just the final chorus.

## How the gate works

- **Whole songs.** Each song is generated as NEW SET generates it, rendered offline from its first bar to an 8-second tail, and metered with the same 4×-oversampled true-peak meter our loudness calibration uses.
- **Every ensemble.** Each genre picks its instruments from a list of ensembles by seed. The gate adds the smallest seeds that reach every ensemble, so a new or retuned instrument is always rendered.
- **Sharded.** The full sweep took 36 minutes on 8 parallel renderers, so CI splits it across six machines, each rendering every sixth song in about 20 minutes.
- **Repeatable.** Rendering six of the hottest songs a second time gave the same peaks to 0.001 dB, so a song just under the line does not flicker in and out of failing on the same machine.

## What it can't tell us

A song under −1 dBTP can still sound harsh, and a limiter working hard to stay there can make a genre sound squashed. True peak is a safety check, not a quality score. It also only covers the seeds we render: the gate is a sample of what NEW SET can make, chosen to reach every ensemble, not a proof about every seed.
