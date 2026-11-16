import assert from 'node:assert/strict';
import { compareComposition, compareAudio, audioMismatch, verdict, nextTarget, readLedger, LEDGER } from '../scripts/quality-ratchet.mjs';
import { dailyDrop } from '../js/daily.js';

// Gains and losses respect each metric's direction and tolerance.
const before = { folk: { motifRecall: 0.6, voiceMove: 1.5, chords: 4, peakAt: 0.3 }, rock: { motifRecall: 0.7, voiceMove: 1 } };
const after = { folk: { motifRecall: 0.7, voiceMove: 1.2, chords: 4, peakAt: 0.9 }, rock: { motifRecall: 0.66, voiceMove: 1.2 } };
const comp = compareComposition(before, after);
assert.deepEqual(comp.gains.map((g) => `${g.style} ${g.metric}`).sort(), ['folk motifRecall', 'folk voiceMove']);
assert.deepEqual(comp.losses.map((g) => `${g.style} ${g.metric}`), ['rock voiceMove'], 'within-tolerance moves (rock motifRecall) and NEAR metrics (peakAt) are not judged');
assert.equal(verdict(comp, null, 'folk').ok, false, 'a regression anywhere blocks the day');
assert.equal(verdict(compareComposition(before, { ...after, rock: before.rock }), null, 'folk').ok, true);
assert.equal(verdict(compareComposition(before, { ...after, rock: before.rock }), null, 'rock').ok, false, 'gains must land in the target genre');

// Audio: reasons keyed by style + check; WARN->FAIL counts as new, FAIL->WARN as cleared.
const rep = (styles, warn, fail) => ({ counts: { WARN: warn, FAIL: fail }, styles });
const a = rep({ folk: { reasons: [{ check: 'crest', level: 'WARN' }, { check: 'mud', level: 'FAIL' }] }, rock: { reasons: [] } }, 1, 1);
const b = rep({ folk: { reasons: [{ check: 'mud', level: 'WARN' }] }, rock: { reasons: [{ check: 'clipper', level: 'WARN' }] } }, 2, 0);
const audio = compareAudio(a, b);
assert.deepEqual(audio.cleared.map((r) => `${r.style} ${r.check}`).sort(), ['folk crest', 'folk mud']);
assert.deepEqual(audio.appeared.map((r) => `${r.style} ${r.check}`), ['rock clipper']);
assert.equal(verdict({ gains: [], losses: [] }, audio, 'folk').ok, false, 'a new audio WARN blocks the day');
assert.equal(verdict({ gains: [], losses: [] }, compareAudio(a, rep({ folk: { reasons: [] } }, 0, 0)), 'folk').ok, true, 'clearing a target WARN is a gain');

assert.deepEqual(compareAudio(a, rep({ rock: { reasons: [] } }, 0, 0)).cleared, [], 'a style the after report never measured is not cleared');
assert.deepEqual(audioMismatch(a, rep({ rock: { reasons: [] } }, 0, 0)), ['styles missing after: folk']);
assert.deepEqual(audioMismatch({ ...a, tier: 'fast' }, { ...b, tier: 'deep' }), ['tier fast vs deep']);
assert.deepEqual(audioMismatch(a, b), []);

// The target is tomorrow's Daily Drop genre.
const t = nextTarget(Date.parse('2026-11-15T13:00:00Z'));
assert.equal(t.style, dailyDrop('2026-11-16').style);
assert.equal(t.date, '2026-11-16');

// The ledger is valid JSON entries with a date, target and summary.
for (const e of readLedger(LEDGER)) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.target && typeof e.summary === 'string', JSON.stringify(e));
console.log('quality ratchet ok');
