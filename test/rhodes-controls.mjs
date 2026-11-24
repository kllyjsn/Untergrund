import assert from 'node:assert/strict';
import { withChrome } from './chrome.mjs';

const baseAt = process.argv.indexOf('--base'), unchangedAt = process.argv.indexOf('--unchanged');
const unchanged = unchangedAt < 0 ? ['neosoul', 'rnb'] : process.argv[unchangedAt + 1].split(',');
const probe = async (controls) => withChrome((run) => run(`(async () => {
  (await import('/test/stable-audio-sums.js')).stableAudioSums();
  const {song, render} = await import('/test/audio-quality-page.js');
  const {Engine} = await import('/js/engine.js');
  const {loadSets, liveSets} = await import('/js/livekit.js');
  const digest = async (b) => Promise.all(Array.from({length:b.numberOfChannels}, async (_, c) => {
    const h = await crypto.subtle.digest('SHA-256', b.getChannelData(c));
    return [...new Uint8Array(h)].map(n => n.toString(16).padStart(2,'0')).join('');
  }));
  const defaults = {}, changes = [];
  for (const style of ${JSON.stringify(unchanged)}) for (const seed of [1,2,...(style === 'neosoul' ? [5,11] : style === 'rnb' ? [3,4] : [])]) {
    defaults[style + '/' + seed] = await digest(await render(song(style, seed), 16, 24, {tail:4}));
  }
  if (${controls}) for (const [style, seed] of [['neosoul',5],['rnb',3],['lofihiphop',1],['jazzfunk',1]]) {
    const s = song(style,seed); await loadSets(liveSets(s));
    const hashes = {};
    for (const knob of ['default','env','detune','tine']) {
      const state = structuredClone(s);
      if (knob !== 'default') state.params.stab[knob] = {env:.9, detune:38, tine:style === 'lofihiphop' ? 1 : .1}[knob];
      const ctx = new OfflineAudioContext(2, 48000*6, 48000), e = new Engine(ctx,state,{realtime:false});
      e.out.disconnect(); e.ch.stab.level.connect(ctx.destination);
      e.keys(.05,.7,[0,4,7],60,state.params.stab,e.ch.stab.input);
      hashes[knob] = await digest(await ctx.startRendering());
    }
    changes.push({style, hashes});
  }
  return {defaults,changes};
})()`));

const current = await probe(true);
assert(current, 'Chrome required for Rhodes control verification');
for (const { style, hashes } of current.changes) for (const knob of ['env', 'detune', 'tine']) {
  assert.notDeepEqual(hashes[knob], hashes.default, `${style}: ${knob} must change recorded PCM`);
}
console.log('Rhodes controls: ENV, DETUNE and TINE each change recorded PCM in all four styles');
if (baseAt >= 0) {
  process.chdir(process.argv[baseAt + 1]);
  const base = await probe(false);
  assert(base, 'Chrome required for the default control null');
  assert.deepEqual(current.defaults, base.defaults, 'default Rhodes PCM versus baseline');
  console.log('Rhodes default PCM null versus baseline: ' + Object.keys(current.defaults).join(', '));
}
