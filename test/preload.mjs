// Live-kit preloading: which recordings a song needs, and the per-song lock that keeps a part on one sound.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { liveSets, setsReady, loadSets, STAB_BAND, LIVE_FILES } from '../js/livekit.js';
import { Engine } from '../js/engine.js';
import { generate, STYLES } from '../js/state.js';

const st = (kit, voice) => ({ master: { kit }, params: { stab: { voice } } });
assert.deepEqual(liveSets(st(0, 1)), []);
assert.deepEqual(liveSets(st(1, 1)), ['kit']);
assert.deepEqual(liveSets(st(2, 8)), ['kit', 'gtr', 'gtrsoft']);
assert.deepEqual(liveSets(st(1, 7)), ['kit', 'piano', 'pianosoft']);
assert.deepEqual(liveSets(st(0, 10)), ['str']);
assert.deepEqual(liveSets(st(1.2, 9.4)), ['kit', 'horn']);
assert.deepEqual(liveSets({}), []);

// Every generated song: live-kit genres always need the kit, and the chord instrument matches its stab voice.
for (const id of Object.keys(STYLES)) {
  if (STYLES[id].family === 'CLASSICAL') continue;
  for (let seed = 1; seed <= 12; seed++) {
    const g = generate(id, seed), sets = liveSets(g), band = STAB_BAND[Math.round(g.params.stab.voice)];
    if (['neosoul', 'boombap'].includes(id)) assert.ok(sets.includes('kit'), `${id}/${seed} needs the live kit`);
    assert.equal(sets.includes(band), !!band, `${id}/${seed} stab band`);
    assert.equal(sets.includes('pianosoft'), band === 'piano', `${id}/${seed} soft piano layer`);
    assert.equal(sets.includes('gtrsoft'), band === 'gtr', `${id}/${seed} soft guitar layer`);
    // Country's Telecaster lead and harmonica load whatever plays the chords.
    assert.equal(sets.includes('tele') && sets.includes('hca'), id === 'country', `${id}/${seed} country lead`);
  }
}

// Load the guitar for real (from disk, with a stub decoder) to exercise the lock.
const files = new Set();
globalThis.fetch = async (url) => { const u = new URL(url); u.search = ''; files.add(u.pathname.split('/').pop()); const b = await readFile(u); return { ok: true, arrayBuffer: async () => b.buffer }; };
globalThis.OfflineAudioContext = class { decodeAudioData(b) { return Promise.resolve({ length: b.byteLength }); } };

const rec = (lock, name) => Engine.prototype.rec.call({ recLock: lock }, name);
const song = new Map();
assert.equal(setsReady(['gtr']), false);
assert.equal(rec(song, 'gtr'), null, 'not loaded yet: the stand-in plays');
await loadSets(['gtr']);
assert.equal(setsReady(['gtr']), true);
assert.equal(rec(song, 'gtr'), null, 'arrived mid-song: the part keeps its stand-in');
assert.ok(rec(new Map(), 'gtr'), 'the next song plays the recording');
assert.ok(rec(null, 'gtr'), 'outside a song (renders, auditions) the recording plays');
const later = new Map();
assert.ok(rec(later, 'gtr'));
assert.ok(rec(later, 'gtr'), 'a recording used from the first note stays');
assert.equal(rec(later, 'kit'), null);
await loadSets(['kit']);
assert.equal(rec(later, 'kit'), null, 'each set is locked on its own');
assert.ok(files.has('gtr_40.flac') && files.has(`${LIVE_FILES[0]}.flac`));
assert.deepEqual(await loadSets([]), []);
console.log('live-kit preload + per-song lock passed');
