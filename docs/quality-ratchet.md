# Daily quality ratchet

A scheduled Devin run improves one genre a day and proves it with measurements, so the songs GENERATE and the Daily Drop make are never worse than the day before.

Code: `scripts/quality-ratchet.mjs` (tested by `test/quality-ratchet.mjs`). Ledger: `test/quality-ledger.json`.

## The loop

1. **Target**: `node scripts/quality-ratchet.mjs --plan` names tomorrow's Daily Drop genre (every genre gets a turn per cycle, and each fix can ship before that genre's drop), where it trails the best genre of its family on the composition scorecard, and what earlier days already tried.
2. **Change**: one musically motivated change to that genre (generator, arrangement, voicing, mix). Live listen findings (`scripts/improve.mjs`, when `STATS_TOKEN` is available) outrank the scorecard.
3. **Check**: `node scripts/quality-ratchet.mjs --check --target <style> --audio-before main.json --audio-after branch.json --require-gain` passes only when the target gained (a composition metric past its tolerance in the good direction, or an audio-benchmark WARN/FAIL cleared) and no genre regressed anywhere.
4. **Record**: `--record --summary "…" --lever <lever>` raises the composition floor (`test/composition-baseline.json`) only for the metrics that gained, and appends the day to the ledger. CI's `composition.mjs --assert` then keeps that floor.

Directions and tolerances come from `HIGHER`/`LOWER`/`TOL` in `scripts/composition.mjs` (including `feelFit`: how well tempo, mode, lead register, velocity range, legato and section contrast agree with the song's `FEELS[feel]`, 0..1); `NEAR` metrics (phrase peak, rests, verse span) are shape targets and never ratchet. A metric is a proxy: a change that only games a number (more chords for their own sake) doesn't count, so each PR also carries before/after renders of the target's next Daily Drop.
