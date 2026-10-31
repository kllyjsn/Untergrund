import assert from 'node:assert/strict';
import { createArtistCatalog, defaultArtistProfile } from '../js/artist.js';
import { defaultState } from '../js/state.js';

const profile = defaultArtistProfile();
const catalog = createArtistCatalog(defaultState(), profile, 3, 123456, []);

assert.equal(catalog.length, 3);
assert.equal(new Set(catalog.map((x) => x.target)).size, 3);
assert.equal(new Set(catalog.map((x) => x.id)).size, 3);

for (const release of catalog) {
  assert.equal(release.artist, 'UNTERGRUND');
  assert.equal(release.state.patterns.length, 8);
  assert.equal(release.state.chainOn, true);
  assert.equal(release.state.artist.title, release.title);
  assert.ok(release.bpm >= 122 && release.bpm <= 150);
  assert.ok(release.state.chain.length >= 18);
}

catalog[0].state.patterns[0].steps.kick[0] = 0;
assert.notEqual(catalog[1].state.patterns[0].steps.kick[0], 0);

console.log('artist identity, catalog, project isolation and release calendar passed');
