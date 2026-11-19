# Club rendered-audio sync harness

## Real neural vocals (local CPU)

`npm run test:club-sync -- --vocal real --scenario short-wake-mix --diagnostics`
uses a fixed seed-7 lyric-bearing pop fixture. The default remains synthetic.
Install `singer/requirements.txt` in a venv first; set `SINGER_PYTHON` to its Python
executable (default `~/singer-investigation-venv/bin/python`). The harness starts
`test/club-sync-singer.py`, wrapping the production `Singer.render` with LiteRT,
using the normal authenticated submit/result protocol and local `server.mjs`
proxy. A model/request-pinned disk cache in `test/out/singer-cache` reuses the
first neural render across invocations as well as the API's per-process cache.
Weights download on first use.
Allow up to 15 minutes for startup and another 15 minutes for the one prewarm render.

Before Chrome starts, the harness prewarms `/api/sing` with the exact Opus request
the browser will send. The server's memory cache is shared across clients and
repeats. Each new page pauses only the main app module request while the real
browser `singSong()` fetches, decodes and processes the cached API audio. No stem
cache injection runs in real mode. Results require successful API audio responses,
resolved `singSong()`, and starts of the processed vocal AudioBuffer on both clients.

Alongside the output JSON, `*-stem.ogg` preserves the API response and `*-stem.wav`
is its decoded PCM16 copy. `vocalGroundTruth` records the request, hash, BPM and
sample-zero placement at bar 0 (zero timing trim); each result's `vocalTimeline`
records the corresponding room epoch. `realStems` records per-page load/playback
evidence. Existing synthetic-oriented analysis/thresholds are unchanged: these
legacy thresholds still run unchanged.

## Ground-truth metrics and clips

`--vocal synthetic-pop` uses exactly the real-mode pop song but injects the
original synthetic stem. `synthetic` retains the hypnotic fixture. Use a comma
list of `--scenario` names and `--repeat 3` for sequential trials in one process.
For `dj-handoff-mix`, both pop modes queue before PASS DECK and pass at the
same score position (13⅜ beats from the initial room origin, within 100ms).
Otherwise navigation and queue timing can move PASS across a kick into the
sparse build: even uninterrupted audio then takes over three beats to produce
three post-pass kicks. JSON records the target as `events.passTargetAt` and
still measures recovery from the actual click.
Add `--clips` to always save clips; otherwise existing threshold failures or new
vocal findings trigger them. New measurements are diagnostic, not new CI gates.
AFTER findings include gaps/phrase anomalies, vocal-to-kick absolute median
above 25 ms or p95 above 50 ms, unresolved grid measurement or sustained recovery.

`vocalGrid[0/1]` contains host/listener BEFORE and AFTER measurements. Reference
audio is the actual decoded/processed stem at the isolated vocalBus tap's gain,
placed at bar 0 (updated broadcast origins are honored on handoff). The reference
envelope is saved in each result. Rendered RMS is binned at 4 ms; two-second
windows hop one second, searching ±500 ms with mean-centered/cosine correlation.
Competing periodic peaks are unresolved unless a silence transition or prior
unambiguous window anchors their lag; ambiguous windows report null. Replay
matching first compensates ±100 ms local timing drift and requires a unique
earlier-content match sustained across at least two overlapping windows.
Positive offsets mean late. `vocalVsKick` subtracts that client's median rendered
kick onset offset from its Sequencer/Recorder grid over the same window; missing
kicks or unvoiced/uncorrelated windows yield null, not zero. Signed median and
absolute median/p95 are reported. This includes native kick attack delay.

Gaps require expected >−30 dB relative to reference peak, rendered <−40 dB,
for ≥40 ms. Intervals are relative to wake/handoff (`recoverAt`). Phrases are
≥200 ms activity regions with ≤120 ms internal silence bridged; only fully
observed phrases in each phase are scored. Envelope template matches ≥0.85
classify present (±50 ms), missing, displaced or doubled. Known identical
scheduled repeats, or occurrences better explained by their own on-grid phrase,
are excluded from extra occurrences and counted as ambiguous.
An additional 800 ms template scan flags earlier-content replays (up to 8 s back,
≥0.92 similarity and ≥0.15 improvement over on-grid content). These are acoustic
envelope findings, not semantic/lyric recognition; repeated or low-information
content can remain ambiguous. Primary recovery is the end of three consecutive
500 ms windows (100 ms hop), each with at least 250 ms expected singing, a
measured same-client kick-relative offset within ±25 ms of that client's BEFORE
median, and no ≥40 ms vocal gap. Unvoiced, unmeasured or gapped windows reset
the streak; the minimum is 700 ms. Missing BEFORE baselines yield null.
`recovery` records the baseline, parameters and fine windows;
`absoluteGridRecoveryMs` retains the original two-second-window absolute-grid
criterion as secondary. Null means not demonstrated, not instantaneous recovery.

`test/out/clips/<scenario>-<mode>-<run>-{host,listener,expected}.wav` contains the
isolated processed vocal; `*-{host,listener}-mix.wav` contains full destination
audio, each spanning marker−4 s through the full measured AFTER window (the
common captured vocal-envelope end minus the analyzer's 200 ms guard). This
retains late gap/displaced-phrase evidence rather than stopping at +8 s.
Capture is raw channel-0 PCM (mono),
mapped with output-clock anchors at the native rate and band-limited to 24 kHz
using OfflineAudioContext. A shared expected-active
mask normalizes each clip to the same RMS (target −20 dBFS, reduced jointly if
needed for headroom). Float WAV preserves samples; divide by the recorded gain
to recover unscaled PCM. JSON records gains, target RMS, coverage and marker.
Unobserved output-time regions are zero-filled and coverage is explicit.
Clips with zero energy under the reference-active mask cannot be RMS-matched;
their recorded RMS is zero and gain stays one (for example, frozen listeners
when the only expected singing in the clip precedes wake).

To recompute these metrics without repeating browser/audio trials:
`node test/club-sync-vocal-report.mjs test/out/<capture>.json [...]`.
This updates the input JSON from saved envelopes/reference, records the analyzer
version/time, and prints listener summaries and all clip paths. Original legacy
threshold results and audio clips are preserved.

## Network impairment (Linux, opt-in)

```
npm run test:club-sync -- --scenario reconnect-mix --diagnostics --assert \
  --net 'delay=150,jitter=50,loss=3,rate=1mbit' --net-target listener \
  --net-label L2 --output club-sync-l2.json
```

`--net` accepts any subset of delay/jitter (milliseconds), loss/reorder
(percent), and rate (kbit/mbit/gbit). Jitter/reorder require delay.
`--net-target listener|both` defaults to listener. Omit `--net` for the control;
`--net-label` still labels its evidence. Run sequentially, never in parallel.

Each impaired client navigates through its own TCP proxy port, including static
assets and room traffic. Passwordless `sudo -n tc` is required. A four-band lo
prio qdisc leaves default traffic in band 1; IPv4/IPv6 TCP source/destination
proxy-port filters select netem in band 4. CDP and direct server snapshots are
not selected. Delay is **per packet per direction**, not a desired HTTP RTT;
TCP retransmission and multiple exchanges can amplify transaction latency.
Existing lo qdiscs are refused, never replaced. Owned qdiscs are removed on
normal exit, failure, SIGINT/SIGTERM/SIGHUP and process exit (not SIGKILL or an
OS crash). After a hard kill inspect `sudo tc qdisc show dev lo` and remove only
the harness's `prio 7f00:` root if left behind.

JSON `network` records the profile, ports, direct/proxied fresh-connection HTTP
probes, request failures and qdisc/drop counters. A finite probe is not an
estimate of configured packet loss: TCP normally retransmits dropped packets.
Each result repeats its profile, records unfiltered CDP control round trips,
and reports output-epoch-minus-context-time spread, separately before/after
resume so the expected frozen-clock jump is not mistaken for runner jitter.

Failed runs automatically invoke `python3 test/club-sync-plot.py <json>`
(requires matplotlib), writing rendered-envelope/kick/vocal PNG evidence under
`test/out/net/<label>/`. These are PCM-derived envelopes, not saved raw PCM or
WAV files. JSON remains the reanalysis source. Plotting can be repeated offline.
Network helper tests: `node test/club-sync-network-test.mjs`.
Plot tests: `python3 test/club-sync-plot-test.py`.

Run `npm run test:club-sync` with Node 22 and Chrome installed (`CHROME_PATH`
overrides discovery). Add `-- --assert` for exit-status thresholds, or
`-- --scenario late-join` (also `listener-skew`, `host-skew`, `cold-invite`,
`injected-offset`, `reconnect`, `reconnect-expired`, `foreground-stall`,
`background-wake`, `downbeat-wake`, `short-wake`, `dj-handoff`, `replay`,
`reconnect-mix`, `reconnect-expired-mix`, `dj-handoff-mix`).
Detector tests: `node test/club-sync-detector.mjs`.
Transition/diagnostic metric tests: `node test/club-sync-metrics.mjs`.

Each client owns an OS Chrome process/profile, not just a tab. The server has
Redis/remote room environment variables removed and uses the in-memory rooms
backend. Profiles are deleted even on scenario errors. JSON under ignored
`test/out/club-sync.json` includes envelopes, output-clock anchors, onsets and
signed deltas for independent reanalysis. The project fixture is kick-soloed at
123 BPM, with four distinct irregular 16-step patterns chained ABCD (7805ms).
It uses dry machine kicks with 120ms decay, no variation/humanize/pocket/dust,
and no arrangement mutations. Kicks and accents differ between all four bars.
The state is stored on the host before navigation and broadcast by the app.
Add scenario descriptors in `SCENARIOS` and driving options in `scenario()`.

The pass-through AudioWorklet replaces only connections to the real destination,
before the app loads. Its sample-frame positions map to true epoch milliseconds
using nearby `getOutputTimestamp()` anchors and unmodified `performance.timeOrigin`.
This measures browser-rendered audio, **not acoustic speaker/device latency**.
The Linux desktop app uses AudioContext.destination; the iOS-only media-element
route is explicitly rejected, not silently measured at its recording input.
MediaRecorder's parallel MediaStreamDestination is not the rendered output.

Detection uses 180Hz low-pass RMS, smoothed positive energy flux and nonmaximum
suppression. Cross-correlation first resolves signed pattern lag across ±3900ms
at 4ms resolution. Only then are individual onsets assigned to host(t − lag),
one-to-one, within 0.48 steps of the resolved lag. Raw deltas retain the full
signed displacement, not its beat-phase remainder. Positive means listener late.
Normalized correlation uses at least 2s and 60% of the common envelope window.
There is no lag estimate when either envelope is silent/empty.

Statistics use a 500ms startup guard and end at the common captured envelope
boundary, **not** the final audible kick (so dropouts cannot shorten the window).
Listener missing counts are unmatched host onsets, respecting irregular rests.
Matching uses full onset lists before counting only host-window events: a
counterpart across either analysis guard is still matched. Only true capture
boundaries censor events whose lagged counterpart cannot have been captured.
Host missing counts compare the known fixture against the server's transport
origin with a fitted constant output/detector latency. Fixture bounds apply to
the latency-shifted expected render times too, not nominal transport times;
otherwise a final expected kick can be counted outside the actual capture.
JSON includes exact missing fixture timestamps. Large gaps are retained.
Entry latency reports first kick and first globally pattern-aligned kick.

The period bounds the unambiguous range: whole steps, beats, bars and ±2000ms
are resolved; multiples of the entire 7805ms fixture still alias. The harness
does not claim arbitrary absolute song-position detection beyond ±3900ms.
Detector tests synthesize this same irregular pattern and assert all those
offsets plus missing kicks, intentional rests, silence and clock conversion.
`injected-offset` inserts a real 2000ms AudioContext DelayNode on the listener's
destination path **before** the PCM tap, leaving Date/performance untouched.
It asserts measured signed lag is within 50ms of 2000ms, not near zero.

## Recovery scenarios

`foreground-stall` blocks the visible listener's main thread for 320ms
across a fixture downbeat. The audio clock must keep running and playback must
stay aligned without missing or extra kicks.

`reconnect` and `reconnect-expired` record 7s of baseline, then 10s/20s offline,
then 12s after recovery. Both CDP Network.emulateNetworkConditions(offline) and
Network.setBlockedURLs on the room API are used. A fetch probe must fail; actual
room fetch errors are counted. Independent server snapshots record whether the
listener is present before/during/after, including the 15s membership cutoff.
Only the listener is blocked, not the DJ or the server's availability to others.

`background-wake` uses Page.setWebLifecycleState frozen → active for 15s.
`downbeat-wake` uses the same freeze but times resume at a fixture downbeat
and requires the listener to render that specific kick within 50ms of the host.
`short-wake` uses the same lifecycle transition for 800ms. Freeze recovery
assertions require zero extra as well as zero missing kicks. Recovery analysis
uses the per-client PCM resume-boundary detector from PR #198 (631a571)
when measuring wakes: without it, pre-freeze PCM can map across the output-clock
jump and contaminate the post-wake window. It is now bundled in the harness
for both dry and full-mix wakes (the application remains unchanged).
In full-mix wakes, detect kicks on the continuous host envelope and match them
by output time: cropping there can turn a pre-recovery kick tail into a false
attack, and a delayed marker can hide a real one. Only the frozen listener's
kick PCM is cropped before detection.
The harness records freeze/resume/visibility events and AudioContext clocks.
It also calls Page.bringToFront after activation and reports actual visibility
(Chrome can remain hidden after this lifecycle transition). This is desktop
Chrome lifecycle suspension, **not a phone lock-screen
emulation**: audio-thread continuation, device suspension, OS throttling and
mobile gesture policies may differ. The original no-background-throttling
flags remain, so this isolates explicit freeze rather than timer throttling.

All interrupted scenarios print separate before/during/after stats, missing
counts and longest missing runs. JSON includes every unmatched-expected-kick
run with timestamps; these are not claims of complete silence (wrong kicks can
sound during a run). Realignment time is wake/online → the third consecutive host-matched
kick within ±50ms (not just the first coincident beat). Assertions apply the
original median ≤25ms/p95 ≤50ms/no-missing thresholds to the AFTER window;
during-interruption gaps are reported, not asserted absent. The deliberate
offset scenario instead asserts successful detection of its known displacement.

## Step-1 max-outlier investigation

The archived step-1 host-skew trace's −115.463ms outlier selected listener
1795066246272.372 versus host 1795066246387.835. The listener's positive-flux
maximum in that neighborhood was 0.079 at −115.5ms, narrowly above the
attack-region flux 0.0721 at −12.5ms. The old detector chose a fluctuation in the
long, wet kick tail instead of the next attack. Independent 420ms local raw
envelope correlation peaks at −20ms (Pearson 0.588), not −115ms (0.325).
Output-clock anchor-offset spreads in that region were 0.224ms host/18.483ms
listener, not a 115ms timestamp jump. Adjacent host intervals were 487.47 and
481.79ms; the selected listener point produced a spurious 402.75/600.86ms pair.
This is a detector artifact, not evidence of an actual 115ms early kick. The
precise acoustic onset cannot be recovered from a 128-frame RMS envelope;
the trace supports an approximately 20ms lead, not sample-accurate attribution.
Archived input and derived local envelopes remain in ignored
`test/out/club-sync-step1.json` and `test/out/club-sync-outlier.json` locally.
The original seed-1337 kick had 723ms decay (longer than its 488ms beat), rumble
0.45 and drive 0.35. The new dry, short-decay fixture prevents those sustained
tail fluctuations from winning.

## Step-2 observations (no application changes)

The complete eight-scenario run detected the real +2000ms output displacement
as +1996ms; synthetic checks resolved +121.951/+487.805/+1951.220/±2000ms.
The original thresholds were retained. Cold invite (30.56ms median), reconnect
(39.74ms AFTER median) and background wake (six AFTER missing expected kicks)
failed them. Reconnect was already about 45ms early BEFORE the interruption,
so its threshold failure is not evidence that reconnect introduced drift.

Both offline lengths played continuously with zero missing kicks during/after.
Both lost server membership: the listener's persisted `seen` was already about
7.2s old before the interruption. Server presence writes coalesce for 6s
(`BEAT_WRITE_MS` in api/_lib/rooms.js); the 10s interruption therefore crossed
the 15s cutoff too. Presence returned in both variants. The 20s case produced
97 failed room requests in its last 5s, versus two in the 10s case's last 5s.
The reachable poll path in js/club.js subtracts time since last successful sync
from the capped 15s retry delay, falling back to 50ms once overdue. This is an
observed retry burst, not an audio dropout; it is not fixed here.

The freeze case exposed a real desktop lifecycle recovery glitch, independently
of onset timestamp assignment: AudioContext.currentTime was exactly
7.421678004535147 at both freeze and resume, while true wall time advanced
15006.6ms. The listener invoked OscillatorNode.start 32 times in the first second
after resume (the fixture averages about two kicks/sec). For example, calls at
185ms and 200ms after resume scheduled oscillators at context times
8.85882198519823 and 8.85881757736206, only 0.0044ms apart; the fixture's minimum
kick spacing is 365.85ms. The PCM capture independently showed nine extra
onsets and six unmatched expected kicks in the AFTER window, with a longest
missing-expected-kick run of 1947ms. Three consecutive aligned kicks were not
confirmed until 4330ms after activation. The host missed zero fixture kicks.

This disproves a purely RMS-detector explanation for the wake glitch: the app
actually schedules near-coincident kick oscillators. Likely mechanism (not
directly instrumented): js/main.js `schedule()` exponentially smooths wall-time
minus context-time with factor 0.05; the frozen audio clock creates a ~15s jump,
and repeated resync plus the hidden-page 1.5s lookahead queues stale/extra notes
while the smoothed offset converges. The scheduling error is observed; this
internal-variable causal explanation remains an inference. Desktop Chrome
remained hidden after activation/bringToFront; no claim is made about iOS or
Android behavior. No app code was modified.

Autoplay is enabled as required for headless audio. Invite entry sometimes joins
automatically after unlock; otherwise the harness clicks LISTEN LIVE using CDP
pointer input. The JSON records which path executed. Cold invite still uses a
brand-new profile and starts its entry timer immediately before navigation;
it does not emulate mobile gesture restrictions.

## Deck handoff and replay

`reconnect-mix` and `reconnect-expired-mix` use the same 10s/20s network
interruption as their dry counterparts, with 20s recovery. The expired scenario
measures at least seven seconds of baseline after the first bar, asserts the
listener expires and rejoins, and restores the network a quarter beat before a
DROP so the fixture provides three consecutive kicks inside the recovery window.
It caps headless animation callbacks at 12 Hz and skips painting after the UI
join to leave CPU for both realtime audio threads, without changing app audio,
room polling, or timing limits.
`dj-handoff-mix` uses the same queue/pass/update UI flow as `dj-handoff`.
All three use the existing full-mix fixture, processedStem prewarm and isolated
rendered kick/vocal taps. Continuous audio is not cropped by a freeze/resume
marker. Reconnect also reports a DURING window; section boundaries during the
network interruption are checked, not exempted as frozen audio. Handoff uses
PASS DECK as the recovery origin and retains at least one subsequent section
boundary in the capture. Each summary reports AFTER missing/extra kicks,
median/max alignment, three-kick realignment time, vocal lag minus signed kick
median, boundary results and assertion failures. Diagnostic mode retains both
clients' clock/origin/scheduler decomposition in JSON for these mix scenarios.

`dj-handoff` records 7s, clicks JOIN DJ QUEUE on the listener, verifies the
server queue, clicks PASS DECK on the host and verifies the new host ID. The
new DJ taps UPDATE ROOM. This real rebroadcast flow preserves the running
transport origin; it does not restart the song at bar 1. The downbeat comparison
therefore uses the first ABCD-cycle downbeat after rebroadcast. Neither deck
assignment nor broadcasting is performed through a direct room API call.

`replay` seeds a 30s saved timeline using the real createTimelineRecorder and
publishReplay modules (the memory server saves to the browser's IndexedDB),
then clicks REPLAYS → REPLAY TO ROOM. It verifies the server's replay flag and
new broadcast ID. Seeding avoids a recording/save-dialog prerequisite, but
replay dispatch, timeline playback and listener delivery are the real UI path.

Both capture 22s after the measured downbeat. Main statistics and host fixture
checks apply only after rebroadcast/replay starts, not a correlation across two origins.
JSON records each original client's first downbeat in true epoch milliseconds,
its signed listener-minus-host delta, action-to-first-aligned-kick latency,
the inter-kick gap straddling the action, and rendered near-silence gaps around
the transition. Near-silence is envelope below 2.5% of that client's peak
(minimum 0.0001), with active segments joined across ≤20ms holes. This is not
digital-zero silence; normal fixture rests are included, not mislabeled as
dropouts. The first downbeat must be detected within ±200ms of the new origin;
missing either downbeat, |delta| >50ms or no aligned kick also fails --assert.
For handoff the role names remain **original** host/listener after the swap.

## Repeated join diagnostics

```
npm run test:club-sync -- --scenario cold-invite --repeat 5 --diagnostics --output club-sync-cold-invites.json
```

Each repeat uses a new room and two new Chrome processes/profiles. Diagnostic
startup experiments can add `--cpu-throttle 4` (CDP CPU slowdown, 1..20) and
`--mute-audio`. `--no-audio-device` points only the listener at a nonexistent
PulseAudio server and an empty ALSA config; it does not stop shared audio services.
`--startup-contention` starts one 12s busy Node process per available CPU plus
a bounded 16MiB fsync/write workload just before listener navigation. These
options apply to every repeat and are not enabled by default. Captures include
actual anchor-poll callback times in `anchorPolls`; `profileClock` maps the CPU
profile's monotonic seconds to epoch milliseconds (two sequential CDP reads,
so the mapping has control-channel latency uncertainty).
Diagnostic
mode uses false CDP conditional breakpoints to read module locals without
pausing or editing application files. Source markers are looked up rather than
hard-coded line numbers; missing markers/captures fail explicitly. It records
every scheduler invocation in `schedulerCalls` and a CDP sampling CPU profile
in each capture's `cpuProfile` (Chrome DevTools Performance can import this
profile after saving that object as a `.cpuprofile` file). All runs also retain
PerformanceObserver long tasks as epoch `at` and `duration` in milliseconds.
Profiling and debugger overhead can affect timing; these are diagnostic runs,
not an uninstrumented performance baseline.
It also records
the room clock estimate at join and later, transport starts, and one scheduler
sample/second: transport origin, nextTime, wall/audio clock offset, smoothing
residual, 30ms tolerance residual and getOutputTimestamp mapping. These separate
a wrong room origin from the mapping of a correctly anchored schedule to
rendered output. Debugger attachment can itself affect scheduling; compare
these diagnostic runs with the uninstrumented full run, not as pristine timing.
The reported output offset predicts rendered sample position, not acoustic
device delay. Raw snapshots are preserved for checking the decomposition.

### Five cold invites: first clock samples are frozen into the origin

All five diagnostic repeats took LISTEN LIVE, with zero missing kicks. Signed
lag varied from -56 to +8ms (median -24ms); three failed unchanged thresholds.
The signed onset medians in the first/last five seconds did not converge to zero.

| Run | Signed lag | Median signed delta | p95 absolute | First clock RTT host/listener | First clock shift host/listener | True origin minus server host/listener | Predicted rendered lag |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: |
| 1 | +8 | +8.49 | 14.47 | 47.40 / 19.10 | +19.60 / +8.55 | -18.80 / -7.55 | +8.60 |
| 2 | -28 | -25.94 | 31.46 | 47.20 / 13.80 | -22.40 / +6.10 | +29.30 / -5.70 | -27.54 |
| 3 | -56 | -54.62 | 60.71 | 83.40 / 14.60 | -40.30 / +6.60 | +41.70 / -5.90 | -56.36 |
| 4 | +8 | +8.97 | 14.29 | 22.30 / 12.80 | +10.95 / +5.30 | -8.35 / -3.90 | +7.61 |
| 5 | -24 | -25.36 | 29.95 | 40.30 / 13.60 | -18.65 / +5.80 | +19.45 / -5.40 | -25.67 |

Times are milliseconds. Prediction = listener-minus-host transport origin error
plus listener-minus-host scheduled output offset from getOutputTimestamp.
It agrees with signed onset medians within 1.8ms in all five runs.

The dominant variable is the initial presence clock estimate, not schedule()
clockOffset smoothing. In run 3 the first host sample had 83.4ms RTT and
-41.10ms error against the unskewed performance.timeOrigin; its shift was
-40.30ms (Date's integer rounding differs slightly). RoomBus.send shifts the
outgoing startsAt with that estimate; the local host remains +41.70ms relative
to the server origin. The listener's initial +6.60ms shift gives a -5.90ms
origin error. Origin difference alone is -47.60ms. The measured audio scheduling
offset difference contributes -8.76ms, predicting -56.36ms versus measured
-54.62ms. Later host/listener samples have 2.3/2.4ms RTT and -0.15/+0.10ms
clock errors, yet the existing origins stay unchanged. Every run has one
start() invocation per client: there is no subsequent rejoin correcting it.

The checked causal path is RoomBus's initial presence observe → send('set')
shiftRoomSet(payload, roomClock.shift()) → server stores the shifted origin →
listener applySnapshot shifts it back using its initial estimate → joinRoomSet
starts playback. applySnapshot explicitly preserves an existing broadcast's
startsAt, and applySet deduplicates it; later improved clock samples therefore
do not re-anchor that set. schedule() targets the already-fixed local
transportOrigin. Module-local snapshots confirm these paths actually ran.

Checks against alternatives: both clients report the same 10ms baseLatency and
40ms outputLatency in all five runs. Median clockOffset smoothing residuals
are only -1.55..+4.30ms, versus a -47.60ms origin difference in run 3. The
30ms transportResync tolerance does preserve additional small phase residuals
(-14.52..+2.19ms in these samples), but cannot correct a transport origin that
is already wrong. Thus this distribution supports asymmetric initial clock
samples being frozen into startsAt as the principal source of the intermittent
large constant offsets. It does not claim every millisecond of rendered delta
comes from the estimator. No application code was changed.

Evidence is in ignored test/out/club-sync-cold-invites.json. Debugger overhead
can affect the distribution; these are five fresh desktop headless joins, not
a population estimate or a mobile-network measurement. The ordinary cold-invite
scenario remains in the default suite without diagnostics.

## Full-mix wake scenarios

`short-wake-mix` and `background-wake-mix` are also in the default suite.
They use `freshSong('hypnotic', 7, {length:'sketch', bpm:123, swing:0})`:
the app's generated instruments, arrangement, normal FX and unsoloed mix,
stored on the host before navigation. The unmodified generated sketch chain
is `AAAABBBBCCCCCCCDGGGGGGGHEEEDGGGGGGGHAAAA`.
Freeze begins 400ms before the first DROP (bar 8); the 15s freeze also crosses
the bar-15 FILL. Capture continues for 20s after wake. Boundary rows include
crossed boundaries as diagnostic evidence, but only boundaries after wake are
asserted. This is desktop lifecycle freeze, not a phone background test.

No local neural singer runs. Existing singer unit tests mock HTTP responses,
not a playable stem. A harness-only false CDP conditional breakpoint in
`vocalStem` populates its private cache before the cache gate. No module source
or app hook is changed. Both clients receive the same deterministic 10.5kHz
synthetic stem, with two-bar phrases lasting 1.85 bars and a changing 5–8Hz AM
signature. Wake lands inside a phrase for both durations. `sing.on` is true;
the real Engine.vocal, processing, ducking, FX and resume-offset path play it.
JSON records cache injections; a missing injection fails assertions.
The init script also prewarms `processedStem`, as real `singSong` does before
caching a decoded stem. Skipping that prewarm would run a full-song vocal
processing pass synchronously on the first scheduled downbeat and can make
the synthetic vocal start late. JSON records prewarm start/end; assertions
require completion before either client's first oscillator start call.

The full-mix destination tap remains the section-boundary measurement. Kick
and vocal timing instead use parallel rendered-PCM taps on `ch.kick.level`
(post-strip/channel level, before pan/FX sends) and `vocalBus` (including its
gain automation, before vocalOut/FX returns and the shared master chain).
The init script wraps AudioNode.connect and identifies the construction edges
by their unique Engine source lines and GainNode values: the kick level's
connection to its initially-zero rumble send, and the initially-zero vocalBus
connection to vocalOut. Line numbers are resolved from the current source,
not hard-coded. Missing/duplicate edges fail; the JSON records both edges.
The normal connections remain untouched. Each parallel worklet passes the
samples through to its own zero-gain destination branch, so it is pulled by
the same audio graph without changing the song or adding audible output.

The connect/start probes also tag kick oscillators by their path to the kick
level, recording requested `when` and submit-time `clock.contextTime`. The
existing 100ms clock sampler records `playbackStats` counters when supported;
older Chrome leaves the array empty. BEFORE/AFTER reports include each client's
underrun count/duration delta between the first and last samples inside the
window (`sampledFrom`/`sampledTo` in JSON). Missing, insufficient or reset stats
report unavailable, not zero. No assertions depend on this telemetry.

`mix.phases.*.attribution` lists unmatched onsets and pairs displaced by more
than 50ms, with nearest tagged starts and observed underrun overlap. Detected
onsets select starts by native context time; a missing counterpart uses the
other client's onset as its reference and selects by projected output time.
Unmatched onsets are not re-paired. Counter-update brackets merge unchanged
cached snapshots (using `totalDuration`), because Chrome can refresh stats
less often than they are sampled. Overlap is coarse evidence, not a precise
underrun timestamp or proof of causation; `no` means no observed bracket,
and `unknown` means absent/out-of-range stats. Tagged starts may have been
cancelled; nearest-start attribution alone does not prove a source played.

Each isolated tap reports full-range RMS; no spectral separation, score gating
or host-template acceptance threshold is needed. The existing smoothed flux
detector finds isolated kick onsets, matched one-to-one within ±150ms with
missing/extra counts. A 150ms window-edge guard prevents onset counterparts
falling just outside the BEFORE capture window from being counted as absent.
There is no lag calibration or subtraction: true client clock/transport
offsets remain in both isolated channels. BEFORE assertions require kick
median ≤25ms/p95 ≤50ms/no missing or extra, vocal |lag| ≤50ms and
|vocal.relativeToKickMs| ≤10ms. This permits a shared join-origin offset
while still checking vocal alignment to the kick channel.
`vocal.relativeToKickMs` reports vocal lag minus the same
window's signed kick median, to distinguish a vocal-only shift from a common
client offset. AFTER retains its absolute vocal lag threshold unchanged.
Unlike kicks-only fixture validation, the mix
does not claim host score completeness (`hostFixture.measured` is false).

All taps use the context's getOutputTimestamp clock mapping and each client's
own PCM resume boundary: the host is marked just before activation and the
listener on its resume event. Pre-boundary PCM is excluded from every AFTER
channel, including section correlation. Isolated taps measure rendered
source-channel timing, not the final audible onset after downstream master
processing/FX tails; the destination capture still contains the full mix.

JSON `mix.phases.before/after` contains kicks (signed median/p95, absolute
median/p95, missing/extra and timestamped pairs) and vocal phrase matching,
band lag and wake-to-energy-return. The vocal threshold is 25% of the host's
peak in the window; phrases crossing the window edge are not counted as new
onsets. Broad-band envelope correlation around each expected section change
estimates listener-minus-host boundary delta; a separate following window
must correlate at ≥0.8 with lag within ±50ms to identify the correct section.
This measures local acoustic similarity, not a semantic classifier: repeated
or similar sections can be ambiguous, and normal random instrument detail
can lower correlation. Raw envelopes remain in JSON for inspection.

`--assert` requires AFTER kick median absolute delta ≤25ms, p95 ≤50ms,
no missing kicks; wake→third consecutive matched kick within ±50ms and
vocal energy return both within three beats (1463ms). Vocal lag must be
within ±50ms with no missing/extra phrase onsets. Every post-wake boundary
must have |delta| ≤50ms and the correct following section. Threshold failures
are reported without loosening them. Run the synthetic analysis tests with
`node test/club-sync-mix-detector.mjs` (known signed offsets, missing phrase,
wrong section, isolated channel selection, missing graph taps, empty capture).

The separate advisory GitHub Actions `club-sync` job runs the complete harness
with --assert on PRs, main pushes and manual dispatch. It uses Node 22 and the
Ubuntu runner's Chrome, and uploads JSON with `if: always()`. Known threshold
failures return a nonzero process status but the job is continue-on-error.
The harness remains outside npm test.
