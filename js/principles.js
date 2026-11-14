// Product principles the generator is held to. Each one comes from the research map (research/program.md, cited by
// key) and names how it is checked: a benchmark metric, a test, or a controlled experiment proposal below.
// Bump PRINCIPLES_VERSION when a rule changes meaning, so a read-out can say which rules a song was written under.
import { SCALES } from './params.js';
import { stepDeg } from './motif.js';

export const PRINCIPLES_VERSION = 1;

export const PRINCIPLES = [
  { id: 'form.roles', area: 'form', rule: 'Sections have jobs: the verse states, the pre-chorus withholds and climbs, the chorus arrives, the bridge leaves home before the last return.',
    refs: ['summach2011', 'declercq2011', 'spicer2004'], measure: 'test/longform.mjs P2; composition preLift, verseChorus' },
  { id: 'form.bridge', area: 'form', rule: 'The bridge spends contrast (new chords) after the chorus has been heard twice, so the final chorus is a return.',
    refs: ['summach2011', 'cheung2019', 'montecchio2020'], measure: 'composition bridgeAway', experiment: 'pop-no-bridge' },
  { id: 'form.fast-hook', area: 'form', rule: 'Get to the voice and the hook quickly; every boundary promises something new, because listeners skip at boundaries.',
    refs: ['leveillegauvin2018', 'montecchio2020'], measure: 'test/longform.mjs P1, P5' },
  { id: 'memory.repeat-vary', area: 'memory', rule: 'Repeat the hook literally enough to be learned, and vary everything around it; never pad with a literal copy.',
    refs: ['nunes2015', 'margulis2013', 'tan2006', 'jakubowski2017'], measure: 'composition motifRecall; test/longform.mjs P3, P6' },
  { id: 'memory.contour', area: 'memory', rule: 'Hooks have a common overall contour with one unusual interval or rhythm, sung at a moderate tempo.',
    refs: ['jakubowski2017', 'williamson2012', 'burgoyne2013'], measure: 'composition stepShare, peakAt' },
  { id: 'expect.lift', area: 'expectation', rule: 'The chorus arrives higher, fuller and more familiar than the verse: change register, density, harmony and level together, not gain alone.',
    refs: ['huron2006', 'salimpoor2011', 'grewe2007'], measure: 'composition chorusLift, chorusEnergy', experiment: 'pop-chorus-lift' },
  { id: 'expect.surprise-in-context', area: 'expectation', rule: 'Spend surprise where the context is predictable (after repeats) and stay predictable where the context is uncertain (new sections, new chords).',
    refs: ['cheung2019', 'gold2019', 'pearce2012', 'pearce2018'], measure: 'composition bridgeAway after two choruses; verseChorus' },
  { id: 'groove.medium-syncopation', area: 'groove', rule: 'Dance grooves sit at medium syncopation over a clear pulse; neither metronomic nor unreadable.',
    refs: ['witek2014', 'matthews2019', 'janata2012'], measure: 'audio-benchmark arrangement checks; proposed syncopation index' },
  { id: 'groove.systematic-feel', area: 'groove', rule: 'Feel comes from systematic, idiomatic timing (swing, laid-back parts), not random jitter.',
    refs: ['senn2016', 'davies2013', 'madison2006'], measure: 'style swing table', experiment: 'deephouse-swing' },
  { id: 'emotion.peak-last', area: 'emotion', rule: 'The biggest moment comes last: entries, a register rise and a loudness rise after an expected arrival.',
    refs: ['sloboda1991', 'grewe2007', 'guhn2007', 'salimpoor2011'], measure: 'test/longform.mjs P4; audio-benchmark section LUFS' },
  { id: 'vocal.singable', area: 'vocal', rule: 'Lines are written for a body: 3-4 bar phrases with breath, a peak inside the phrase, mostly steps, and expressive cues (tempo, level, timbre) that agree with the intended emotion.',
    refs: ['juslinlaukka2003', 'scherer2015', 'friberg2006', 'larrouymaestri2013'], measure: 'composition phraseBars, peakAt, stepShare (docs/melody.md)' },
  { id: 'listener.separate-signals', area: 'preference', rule: 'Read skips, downs, completions, replays and returns as separate implicit signals with confidence, never one taste score.',
    refs: ['hu2008', 'schedl2018', 'brost2019', 'kohavi2020'], measure: 'api/_lib/improve.js METRICS and two-proportion tests' },
  { id: 'listener.familiar-complex', area: 'preference', rule: 'Liking follows an inverted U over familiarity and complexity, and taste differs by listener: target by cohort before changing a style.',
    refs: ['chmiel2017', 'rentfrow2003', 'salganik2006'], measure: 'improvement engine split findings (targeting lever)' },
  { id: 'eval.listen-not-just-score', area: 'evaluation', rule: 'No single objective number certifies quality: audio metrics guard the floor, blind listening and enjoyment signals decide.',
    refs: ['kilgour2019', 'gui2024', 'vinay2022', 'yang2020', 'itu1534', 'cideron2024'], measure: 'audio-benchmark guardrails; lab.html blind A/B; listen signals' },
];

// Listens per arm for a two-sided two-proportion test (alpha .05, power .8) to detect `p` moving by `delta`.
export const perArm = (p, delta) => {
  const q = Math.min(1, Math.max(0, p + delta));
  return Math.ceil(((1.96 + 0.8416) ** 2 * (p * (1 - p) + q * (1 - q))) / delta ** 2);
};

const scaleOf = (s) => (SCALES[s.scale] || SCALES.minor).notes;
const BRIDGE = /E+F+D/;

// Controlled experiment proposals in the EXPERIMENTS format (js/experiments.js), not running: starting one is a
// reviewed PR that copies it into EXPERIMENTS with `from`/`until` dates. `apply` makes exactly one change to a
// freshly generated song; test/principles.mjs checks each change offline on the composition benchmark's seeds.
// Baselines behind minListensPerArm are assumptions until the improvement report has real rates for the scope.
export const PROPOSED = [
  {
    id: 'pop-no-bridge', lever: 'arrangement', principle: 'form.bridge', scope: { style: 'pop', src: 'generate' }, share: 0.1,
    hypothesis: 'Replacing the bridge with another verse of the same length lowers completion: the final chorus stops being a return.',
    primary: { metric: 'complete', goal: 'higher' }, guardrails: ['skip', 'down', 'replay'], minListensPerArm: perArm(0.45, -0.05),
    offline: { metric: 'bridgeAway', expect: 'zero' },
    apply(song) {
      const m = BRIDGE.exec(song.chain || '');
      if (m) song.chain = song.chain.slice(0, m.index) + 'C'.repeat(m[0].length - 1) + 'D' + song.chain.slice(m.index + m[0].length);
    },
  },
  {
    id: 'pop-chorus-lift', lever: 'generator', principle: 'expect.lift', scope: { style: 'pop', src: 'generate' }, share: 0.1,
    hypothesis: 'Singing the verse one scale step lower (a bigger chorus lift) raises replays without raising skips.',
    primary: { metric: 'replay', goal: 'higher' }, guardrails: ['skip', 'down', 'complete'], minListensPerArm: perArm(0.08, 0.03),
    offline: { metric: 'chorusLift', expect: 'higher' },
    apply(song) {
      const scale = scaleOf(song), down = (ns) => ns?.map((x) => [x[0], x[1], stepDeg(x[2], -1, scale), ...x.slice(3)]);
      for (const p of song.patterns || []) {
        const m = p.sec === 'verse' && p.hook?.m;
        if (m) p.hook = { ...p.hook, m: { ...m, n: down(m.n), v: down(m.v), b: down(m.b) } };
      }
    },
  },
  {
    id: 'deephouse-swing', lever: 'generator', principle: 'groove.systematic-feel', scope: { style: 'deephouse', src: 'generate' }, share: 0.1,
    hypothesis: 'Cutting swing from 0.30 to 0.20 makes no difference to completions or loves: feel is idiom, not more offset.',
    primary: { metric: 'complete', goal: 'higher' }, guardrails: ['skip', 'down', 'love'], minListensPerArm: perArm(0.45, -0.05),
    offline: { metric: 'swing', expect: 'lower' },
    apply(song) { if (Number.isFinite(song.swing) && song.swing > 0.2) song.swing = 0.2; },
  },
];
