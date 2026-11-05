// GENERATE while a song plays: the next song waits for a downbeat of the running clock
// instead of stopping the transport. Pure, so the timing rules are testable in Node.

// The outgoing music needs about a beat to audibly sweep out; less than this and the
// transition is a click-length whoosh, so the switch moves to the bar after.
export const MIN_LEAD = 0.5;
// A phrase end (every PHRASE_BARS bars of the playing song) is the most natural place to
// change songs: its fill has just played. Worth waiting for only if it is this close.
export const PHRASE_WAIT = 2;
export const PHRASE_BARS = 4;

// abs: the next step not yet scheduled; lead: seconds until it sounds; stepSec: one 16th;
// origin: the step the playing song started on (always a downbeat).
// Returns the switch step (a downbeat), how far away it is, and the step the transition starts on.
export function handoffStep({ abs, lead = 0, stepSec, origin = 0, minLead = MIN_LEAD, phraseWait = PHRASE_WAIT, phraseBars = PHRASE_BARS }) {
  const at = (s) => lead + (s - abs) * stepSec;
  let bar = origin + Math.ceil((abs - origin) / 16) * 16;
  while (at(bar) < minLead) bar += 16;
  let phrase = bar;
  while (((phrase - origin) / 16) % phraseBars) phrase += 16;
  const step = at(phrase) <= phraseWait ? phrase : bar;
  return { step, at: at(step), from: Math.max(abs, step - 16) };
}

// transportOrigin (ms of step 0 at the playing tempo) for a tempo change exactly on `step`,
// so that step keeps its time and the steps after it follow the new tempo.
export function reanchor(origin, step, fromBpm, toBpm) {
  return origin + step * (15000 / fromBpm - 15000 / toBpm);
}
