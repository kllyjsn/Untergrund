import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { BAND, liveSets } from '../js/livekit.js';
import { STAB_VOICES } from '../js/engine.js';
import { freshSong, sanitize, HOOK_VOICES } from '../js/state.js';

const sampledEp = (name) => /^jep[1-4](?:_|$)/.test(name);
assert(!Object.keys(BAND).some(sampledEp), 'electric piano is not a recorded bank');
assert(!readdirSync(new URL('../samples/live/', import.meta.url)).some(sampledEp), 'retired electric-piano samples are not shipped');
for (const name of ['WURLITZER-LICENSE.txt', 'wurlitzer-provenance.json']) {
  assert(!existsSync(new URL('../samples/' + name, import.meta.url)));
}
for (const file of ['../samples/live/LICENSE.md', '../legal/index.html']) {
  assert(!/Greg Sullivan|GregSullivan|Wurlitzer EP200/.test(readFileSync(new URL(file, import.meta.url), 'utf8')), 'retired-bank credits are not published');
}
assert.equal(STAB_VOICES[1], 'keys', 'saved electric-piano choice remains KEYS');
assert.equal(HOOK_VOICES.indexOf('harmon'), 25);
assert.equal(HOOK_VOICES.indexOf('marimba'), 26);
for (const style of ['swing', 'modal', 'bossa', 'jazzfunk']) {
  for (const seed of [42, 77]) {
    const song = freshSong(style, seed);
    song.params.stab.voice = 1;
    assert.equal(sanitize(JSON.parse(JSON.stringify(song))).params.stab.voice, 1, 'saved KEYS selects the synthesized Rhodes without migration');
    assert(!liveSets(song).some(sampledEp));
    song.patterns[6].hook.v = 'tapekeys';
    assert(!liveSets(song).some(sampledEp), 'electric-piano lead also uses synthesis');
    song.params.stab.voice = 18;
    for (const p of song.patterns) if (p.hook) p.hook.v = 'airflute';
    assert(!liveSets(song).some(sampledEp));
  }
}
assert(!liveSets({}).some(sampledEp));
console.log('jazz Rhodes: stable saved KEYS, synthesized comp/lead, no sampled EP banks/assets/metadata/credits passed');
