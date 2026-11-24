import assert from 'node:assert/strict';
import { withChrome } from './chrome.mjs';

const measure = process.argv.includes('--levels');
assert(!measure || !process.argv.includes('--main'), 'run --levels separately from --main');
const probe = async () => withChrome((run) => run(`(async () => {
  const { stableAudioSums } = await import('/test/stable-audio-sums.js');
  if (!${measure}) stableAudioSums();
  const { song } = await import('/test/audio-quality-page.js');
  const { renderBars } = await import('/js/render.js');
  const digest = async (b) => Promise.all(Array.from({length:b.numberOfChannels}, async (_, c) => {
    const h = await crypto.subtle.digest('SHA-256', b.getChannelData(c));
    return [...new Uint8Array(h)].map(n => n.toString(16).padStart(2,'0')).join('');
  }));
  const s = song('trap', 42); s.chain = 'CC';
  const hashes = ${measure} ? [] : await digest(await renderBars(s, 2, { tail: 4 }));
  const levels = [];
  if (${measure}) for (const style of ['neosoul','rnb','lofihiphop','jazzfunk']) {
    let count = 0;
    for (let seed = 1; seed <= 40 && count < 2; seed++) {
      const state = song(style, seed);
      if (style !== 'jazzfunk' && Math.round(state.params.stab.voice) !== 1) continue;
      count++;
      state.chain = 'CCCCCCCC';
      state.solos = { stab: true };
      for (const id of Object.keys(state.mutes)) state.mutes[id] = id !== 'stab';
      const row = { style, seed };
      for (const fm of [true, false]) {
        const b = await renderBars(state, 8, { tail: 1, onEngine(e) {
          e.hook = () => {}; e.lick = () => {};
          e.out.disconnect(); e.ch.stab.level.connect(e.ctx.destination);
          if (fm) e.rhodesKeys = () => false;
        }});
        let sq = 0, peak = 0, n = 0;
        const end = Math.floor((b.duration - 1) * b.sampleRate);
        for (let c = 0; c < b.numberOfChannels; c++) {
          const a = b.getChannelData(c);
          for (let i = 0; i < end; i++) {sq += a[i]*a[i]; peak = Math.max(peak, Math.abs(a[i])); n++;}
        }
        row[fm ? 'fm' : 'rhodes'] = { rms: 10*Math.log10(sq/n), peak: 20*Math.log10(peak) };
      }
      row.delta = row.rhodes.rms - row.fm.rms; levels.push(row);
    }
  }
  return { hashes, levels };
})()`));

const current = await probe();
assert(current, 'Chrome required for recorded audio verification');
console.log(JSON.stringify({ current }, null, 2));
const main = process.argv.indexOf('--main');
if (main >= 0) {
  process.chdir(process.argv[main + 1]);
  const base = await probe();
  console.log(JSON.stringify({ main: base.hashes }, null, 2));
  assert.deepEqual(current.hashes, base.hashes, 'trap PCM null versus main');
  console.log('trap seed 42, 2 bars + 4 s tail: PCM null versus main (both channels)');
}
