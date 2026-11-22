import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { BAND, bandKit, loadSets } from '../js/livekit.js';
import { Engine, paletteFor } from '../js/engine.js';
import { freshSong } from '../js/state.js';
import { jazzStyle } from '../js/jazz.js';
import { HARMON_BANKS, recordedJazzWind, windBanks } from '../js/jazz-winds.js';
import { rootsFor, hasRootsLead } from '../js/roots.js';

const originalFetch = globalThis.fetch, originalContext = globalThis.OfflineAudioContext, originalWarn = console.warn;
const fetched = [], warnings = [];
let failFetch = true, failDecode = true;
try {
  globalThis.fetch = async (url) => {
    const file = new URL(url).pathname.split('/').pop();
    fetched.push(file);
    if (file === `jhm1_${BAND.jhm1[0]}.flac` && failFetch) {
      failFetch = false;
      return { ok: false, status: 503 };
    }
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(file).buffer };
  };
  globalThis.OfflineAudioContext = class {
    async decodeAudioData(data) {
      const file = new TextDecoder().decode(data);
      if (file === `jhm3_${BAND.jhm3[0]}.flac` && failDecode) {
        failDecode = false;
        throw new Error('transient decode failure');
      }
      return { length: 48000, file };
    }
  };
  console.warn = (...args) => warnings.push(args);
  const state = freshSong('pop', 42);
  state.artist = { style: 'pop' };
  state.current = 6;
  for (const p of state.patterns) {
    if (p.hook) p.hook.v = 'harmon';
    for (const take of p.at || []) if (take.hook) take.hook.v = 'harmon';
  }
  const source = readFileSync(new URL('../js/hum-ui.js', import.meta.url), 'utf8');
  const panel = runInNewContext(source.match(/^const melodyHooks = .+;$/m)[0] + '\n' + source.slice(source.indexOf('export function melodyPanel'), source.indexOf('\nexport const humButton')).replace('export function', 'function') + '\nmelodyPanel', {
    h: (tag, attrs, ...children) => ({ tag, attrs, children: children.flat().filter(Boolean) }),
    getChops: () => null, loadSets, windBanks, paletteFor, jazzStyle, rootsFor, hasRootsLead,
  });
  const api = { state: () => state, edit: () => assert.fail('a checked Harmon retry must not create an undo entry') };
  const nodes = (node) => typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
  const select = () => nodes(panel(api)).find((n) => n.tag === 'button' && n.children.includes('HARMON')).attrs.onclick();
  const played = [], lock = new Map();
  const e = { state, ctx: {}, harm: { r: 0, c: 0 }, hookBus: {}, recLock: lock, rec: Engine.prototype.rec, trimOut: () => ({}), playBuf: (...args) => played.push(args) };
  const wind = () => recordedJazzWind(e, 0, .5, 72, .5, 'harmon', false, {}, 1);
  assert.equal(wind(), false, 'a cold Harmon uses the fallback');
  select();
  await loadSets(HARMON_BANKS);
  assert.equal(warnings.length, 2, 'one HTTP failure and one decode failure were exercised');
  assert.equal(wind(), false, 'failed recordings leave the fallback available');
  for (const name of HARMON_BANKS) assert.equal(bandKit(name), null);
  const firstRequests = fetched.length;
  select();
  await loadSets(HARMON_BANKS);
  assert.equal(fetched.length, firstRequests * 2, 'reselect retries both failed banks and deduplicates concurrent loads');
  for (const name of HARMON_BANKS) assert.ok(bandKit(name)?.length, name + ' is decoded after reselect');
  Engine.prototype.hook.call(e, 2, .5, 12, .5, 'harmon');
  assert.equal(e.recLock, lock, 'playback is not restarted or unlocked wholesale');
  assert.equal(played.length, 1, 'the same playing engine adopts the recorded Harmon');
  assert.match(played[0][0].file, /^jhm1_/);
  assert.equal(played[0][1], 2, 'the note keeps its scheduled playback time');
  select();
  await loadSets(HARMON_BANKS);
  assert.equal(fetched.length, firstRequests * 2, 'decoded banks remain cached');
  assert.deepEqual(await loadSets([]), []);
} finally {
  globalThis.fetch = originalFetch;
  globalThis.OfflineAudioContext = originalContext;
  console.warn = originalWarn;
}
console.log('Harmon retry: failed fetch/decode, checked reselect, deduplicated retry and mid-playback recorded adoption passed');
