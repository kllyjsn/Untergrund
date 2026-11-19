# Club rendered-audio sync harness

Run `npm run test:club-sync` with Node 22 and Chrome installed (`CHROME_PATH`
overrides discovery). Add `-- --assert` for exit-status thresholds, or
`-- --scenario late-join` (also `listener-skew`, `host-skew`, `cold-invite`).
Detector tests: `node test/club-sync-detector.mjs`.

Each client owns an OS Chrome process/profile, not just a tab. The server has
Redis/remote room environment variables removed and uses the in-memory rooms
backend. Profiles are deleted even on scenario errors. JSON under ignored
`test/out/club-sync.json` includes envelopes, output-clock anchors, onsets and
signed deltas for independent reanalysis. The project fixture is the app's
seed-1337 default, kick-soloed at 123 BPM, a four-on-the-floor repeating bar.
This isolates synchronization from arrangement rests and sample download races.
Add scenario descriptors in `SCENARIOS` and driving options in `scenario()`.

The pass-through AudioWorklet replaces only connections to the real destination,
before the app loads. Its sample-frame positions map to true epoch milliseconds
using nearby `getOutputTimestamp()` anchors and unmodified `performance.timeOrigin`.
This measures browser-rendered audio, **not acoustic speaker/device latency**.
The Linux desktop app uses AudioContext.destination; the iOS-only media-element
route is explicitly rejected, not silently measured at its recording input.
MediaRecorder's parallel MediaStreamDestination is not the rendered output.

Detection uses 180Hz low-pass RMS, smoothed positive energy flux and nonmaximum
suppression. Statistics use the stable overlapping onset interval (500ms startup
guard). Missing counts are internal beat gaps, not pre-join silence or capture
boundaries. Entry latency separately reports first kick and first kick within
50ms of the host. Cross-correlation searches ±100ms at 4ms resolution.

**Periodic ambiguity:** nearest-host matching measures beat phase modulo one
beat. A whole-beat or whole-bar displacement is not detectable with this fixture;
in particular +2000ms at 123 BPM aliases to about +49ms, not +2000ms. The detector
tests verify +2000ms with a sparse nonaliasing reference and +80ms with the actual
regular envelope. Do not claim this fixture verifies absolute song position.
Later scenarios can use a distinctive kick pattern and sequence-aware matching.

Autoplay is enabled as required for headless audio. Invite entry sometimes joins
automatically after unlock; otherwise the harness clicks LISTEN LIVE using CDP
pointer input. The JSON records which path executed. Cold invite still uses a
brand-new profile and starts its entry timer immediately before navigation;
it does not emulate mobile gesture restrictions.
