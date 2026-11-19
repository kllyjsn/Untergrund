# Club rendered-audio sync harness

Run `npm run test:club-sync` with Node 22 and Chrome installed (`CHROME_PATH`
overrides discovery). Add `-- --assert` for exit-status thresholds, or
`-- --scenario late-join` (also `listener-skew`, `host-skew`, `cold-invite`,
`injected-offset`, `reconnect`, `reconnect-expired`, `foreground-stall`, `background-wake`,
`dj-handoff`, `replay`). Detector tests: `node test/club-sync-detector.mjs`.
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
`short-wake` uses the same lifecycle transition for 800ms. Freeze recovery
assertions require zero extra as well as zero missing kicks. Recovery analysis
uses the per-client PCM resume-boundary detector from PR #198 (631a571)
when measuring wakes: without it, pre-freeze PCM can map across the output-clock
jump and contaminate the post-wake window. It is now bundled in the harness
for both dry and full-mix wakes (the application remains unchanged).
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
mode uses false CDP conditional breakpoints to read module locals without
pausing or editing application files. Source markers are looked up rather than
hard-coded line numbers; missing markers/captures fail explicitly. It records
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
