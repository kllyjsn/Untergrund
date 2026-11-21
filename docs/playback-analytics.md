# First-party playback analytics

The team readout is in [Untergrund Stats](https://www.untergrund.sh/stats.html) under **Listening · Genres and Published Songs**. Use the stats token. Expand a genre for published-song rows, or select Public, Embeds or Club Rooms to filter the report.

The same aggregate JSON is available for the Release Tracker:

```sh
curl --fail-with-body -H "Authorization: Bearer $STATS_TOKEN" 'https://www.untergrund.sh/api/events?playback=1&days=7'
```

`days` is 1–90, including today (UTC); `surface` is optional (`public`, `embed`, or `club`). Each genre has aggregate metrics and a `songs` array with the same metrics keyed by public release ID. Some plays count toward the genre only: for example, an inline-code embed or a public Club performance with no release on deck. Use `from` and `through` to label the date range. Completion and exit shares use starts as the denominator; `unfinished` counts attempts whose last recorded update was a start or checkpoint.

- **Start**: the audio clock passed the first scheduled beat. A resumed or restarted transport is a new attempt from that position.
- **Completion**: heard from near the beginning and reached the end of the arrangement. A late Club join reaching the finale is not a whole play. Unarranged live loops do not have a completion point.
- **Skip**: explicitly move to another song or restart. **Stop**: stop, pause or leave the page. A new Club broadcast replacing the listener’s set is a skip.
- **Listen time** is measured by the audio clock in 5-second buckets. **Progress** is the furthest song/set position reached, not the share heard; exit positions use 10-percentage-point ranges. Unarranged live loops contribute listen time but no position.
- Sends are best effort. Checkpoints (every 15 seconds) retain some progress when the final event is lost. Results start at rollout.

Playback requests omit cookies and referrers, honor Do Not Track and Global Privacy Control, and do not use a third-party tracker. They don't store member, room, device or tab IDs, IPs, user agents, URLs, prompt text or other personal data. A random play ID used to replace checkpoints expires within 12 hours. Only daily aggregate histograms and public release IDs carry forward. This report is separate from the existing product/experiment listening signals. Production needs the site's Upstash Redis configuration and `STATS_TOKEN`; the local server uses in-memory storage unless Redis is configured.

Private Club sets and DJ preview/hosting playback are not tracked. Without `STATS_TOKEN`, the report route is disabled, even if playback aggregates exist.
