import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildSong } from '../scripts/composition.mjs';

const baseline = process.argv.includes('--baseline');
const engineUrl = new URL('../js/engine.js', import.meta.url);
const source = baseline && execFileSync('git', ['show', 'origin/main:js/engine.js'], { encoding: 'utf8' })
  .replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${new URL(path, engineUrl).href}'`);
const { Sequencer, feelTempo, parseChain } = await import(baseline
  ? `data:text/javascript;base64,${Buffer.from(source).toString('base64')}` : engineUrl.href);

function measure(style, seed) {
  const s = buildSong(style, seed), chain = parseChain(s.chain), nominal = 60 / s.bpm / 4;
  s.artist = { style, seed };
  const scales = [], times = [], opens = [];
  const e = new Proxy({
    get stepDur() { return nominal * (this.stepScale || 1); },
    harm: null,
    playbackStyle: style,
    planHit(t, id, cur, plan) { return plan(); },
    breath(t, open) { if (open) opens.push(t); },
  }, {
    get: (o, k) => k in o ? o[k] : () => {},
  });
  const seq = new Sequencer(e, s);
  let t = 0, displacement = 0;
  for (let abs = 0; abs < chain.length * 16; abs++) {
    times.push(t);
    seq.tick(abs, t);
    scales.push(e.stepScale ?? 1);
    t += e.stepDur;
    displacement = Math.max(displacement, Math.abs(t - (abs + 1) * nominal));
  }
  assert.equal(opens.length, 1, `${style}/${seed}: one scheduled re-open`);
  const offset = (opens[0] - times[seq.liftFrom * 16]) * 1000;
  console.log(`${style}/${seed}: reopen ${offset.toFixed(1)} ms; max grid displacement ${(displacement * 1000).toFixed(3)} ms; step multiplier ${Math.min(...scales).toFixed(6)}–${Math.max(...scales).toFixed(6)}; sectioned=${s.patterns.some(p => p.sec)}`);
  if (!baseline) {
    assert.ok(Math.abs(offset + 12) < 0.5, `${style}: re-open before unswung downbeat`);
    if (style === 'deephouse') {
      assert.ok(displacement < 1e-9);
      assert.ok(scales.every(x => x === 1));
    }
    if (style === 'neosoul') assert.ok(scales.some(x => x !== 1));
  }
}

console.log(baseline ? 'origin/main' : 'working tree');
for (const [style, seed] of [['neosoul', 11], ['deephouse', 42], ['folk', 77], ['pop', 11], ['trance', 11], ['deephouse', 11]]) measure(style, seed);
if (!baseline) {
  for (const style of ['hypnotic', 'industrial', 'acid', 'dub', 'peak', 'hardtechno', 'deephouse', 'minimal', 'ukg', 'euphoric', 'trance', 'amapiano', 'bailefunk', 'jerseyclub', 'jazzfunk']) {
    const s = buildSong(style, 11), chain = parseChain(s.chain);
    s.artist = { style, seed: 11 };
    s.feel = 'tender';
    for (const p of s.patterns) p.sec = 'verse';
    for (let pos = 0; pos < chain.length; pos++) for (let i = 0; i < 16; i++) assert.equal(feelTempo(s, chain, pos, i), 1, `${style}: section labels never loosen grid`);
  }
  const s = buildSong('pop', 11);
  assert.equal(feelTempo(s, [], 0, 0), 1, 'empty chain');
  s.feel = 'unknown';
  assert.equal(feelTempo(s, parseChain(s.chain), 0, 0), 1, 'unknown feeling');
  console.log('breath-grid: ok');
}
