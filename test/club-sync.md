# Club rendered-audio sync harness

Run `npm run test:club-sync` with Node 22 and Chrome installed (`CHROME_PATH`
overrides discovery). Add `-- --assert` for exit-status thresholds, or
`-- --scenario late-join` (also `listener-skew`, `host-skew`, `cold-invite`,
`injected-offset`, `reconnect`, `reconnect-expired`, `background-wake`).
Detector tests: `node test/club-sync-detector.mjs`.

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
Host missing counts compare the known fixture against the server's transport
origin with a fitted constant output/detector latency. Large gaps are retained.
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

`reconnect` and `reconnect-expired` record 7s of baseline, then 10s/20s offline,
then 12s after recovery. Both CDP Network.emulateNetworkConditions(offline) and
Network.setBlockedURLs on the room API are used. A fetch probe must fail; actual
room fetch errors are counted. Independent server snapshots record whether the
listener is present before/during/after, including the 15s membership cutoff.
Only the listener is blocked, not the DJ or the server's availability to others.

`background-wake` uses Page.setWebLifecycleState frozen → active for 15s.
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
