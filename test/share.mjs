import assert from 'node:assert/strict';
import { defaultState, generate, songChain, sanitize, STYLES } from '../js/state.js';
import { encodeSong, decodeSong, readShareParams, songLink, remixState, creditLine, embedCode, normalizeSong } from '../js/share-code.js';
import { peakWindow } from '../js/video.js';
import { handleCrate, handleRemix, memoryStore } from '../api/_lib/crate.js';

// Round trip: every style survives encode → URL → decode and equals its sanitized self.
for (const style of Object.keys(STYLES)) {
  const state = defaultState();
  state.patterns = state.patterns.map((_, i) => generate(style, 1000 + i));
  Object.assign(state, { chainOn: true, chain: songChain(style, 7) });
  const song = { state, title: `Null Signal ${style}`, artist: 'Nova', style };
  const code = await encodeSong(song);
  assert.match(code, /^z[A-Za-z0-9_-]+$/, 'url safe');
  assert(code.length < 4000, `${style} link is short (${code.length})`);
  const { code: parsed } = readShareParams(new URL(songLink('https://www.untergrund.sh', { code })));
  const back = await decodeSong(parsed);
  assert.equal(back.title, song.title);
  assert.equal(back.artist, 'Nova');
  assert.equal(back.style, style);
  assert.deepEqual(back.state, sanitize(state), `${style} state round-trips`);
  assert.deepEqual(sanitize(back.state), back.state, 'decoded state is already sanitized');
}

// Hash links and short ids parse too; junk never throws.
assert.deepEqual(readShareParams(new URL('https://x.sh/#s=zAbc')), { code: 'zAbc' });
assert.deepEqual(readShareParams(new URL('https://x.sh/?t=abc-123<script>')), { id: 'abc-123script' });
assert.equal(songLink('https://x.sh', { id: 'abc-123' }), 'https://x.sh/t/abc-123', 'stored tracks share their release page');
assert.equal(songLink('https://x.sh', { id: 'abc-123' }, '/embed.html'), 'https://x.sh/embed.html?t=abc-123');
assert.equal(readShareParams(new URL('https://x.sh/?jukebox')), null);
for (const junk of ['', 'z', 'z!!!', 'zAAAA', 'j' + btoa('{"s":1}'), 'x' + 'A'.repeat(10), 'z' + 'A'.repeat(70_000)]) assert.equal(await decodeSong(junk), null);

// Hostile payload is clamped by the existing sanitizer.
const evil = defaultState();
evil.bpm = 9999; evil.params.kick.level = 99;
const evilCode = 'j' + Buffer.from(JSON.stringify({ v: 1, t: 'A\u0007'.repeat(100), a: '<b>x</b>', y: 'nope', s: evil })).toString('base64url');
const clamped = await decodeSong(evilCode);
assert.equal(clamped.state.bpm, 240);
assert.equal(clamped.state.params.kick.level, 1.2);
assert.equal(clamped.title.length, 80);
assert(!clamped.title.includes('\u0007'));
assert.equal(clamped.style, 'hypnotic');

// Remix attribution: forked into the remixer's name, credit kept through sanitize and a re-share.
const original = { state: defaultState(), title: 'Velvet Tunnel', artist: 'Nova', style: 'deep', trackId: 'abc123' };
const remix = remixState(original, { name: 'Jason' });
assert.deepEqual(remix.remixOf, { id: 'abc123', title: 'Velvet Tunnel', artist: 'Nova' });
assert.equal(remix.artist.name, 'Jason');
assert.equal(remix.artist.title, 'Velvet Tunnel (Remix)');
assert.deepEqual(sanitize(remix).remixOf, remix.remixOf);
assert.equal(creditLine(remix.remixOf), 'Remix of Velvet Tunnel by Nova');
const reshared = await decodeSong(await encodeSong({ state: remix, title: remix.artist.title, artist: 'Jason', style: 'deep' }));
assert.equal(creditLine(reshared.remixOf), 'Remix of Velvet Tunnel by Nova');
assert.equal(sanitize({ ...defaultState(), remixOf: { title: '' } }).remixOf, undefined);
const songCredit = await decodeSong(await encodeSong({ state: defaultState(), title: 'Velvet Tunnel', artist: 'Nova', remixOf: { title: 'Low Choir', artist: 'Night Listener' } }));
assert.equal(creditLine(songCredit.remixOf), 'Remix of Low Choir by Night Listener');
assert.equal(normalizeSong({ state: { patterns: 'x' } }), null);
assert.match(embedCode('https://www.untergrund.sh/embed.html?t=abc', 'A "quoted" song'), /title="A &quot;quoted&quot; song on UNTERGRUND"/);

// Peak window: the clip starts at the fullest stretch of the chain, entered from its fill.
const peakState = { ...defaultState(), chainOn: true, chain: 'AABDCCCCHH' };
peakState.patterns = peakState.patterns.map((p, i) => ({ ...p, steps: Object.fromEntries(Object.entries(p.steps).map(([k, v]) => [k, k === 'acid' ? v : v.map(() => (i === 2 || i === 6 ? 1 : 0))])) }));
assert.equal(peakWindow(peakState, 4), 3, 'starts on the D fill right before the C drop');
assert.equal(peakWindow({ ...peakState, chain: 'AABBCCCCHH' }, 4), 4);
assert.equal(peakWindow({ ...peakState, chainOn: false }, 8), 0);

// Remix counts with the backend on; 503 when storage is off.
const store = memoryStore();
assert.equal((await handleRemix('POST', 'x', null)).status, 503);
const created = await handleCrate('POST', { title: 'Velvet Tunnel', artist: 'Nova', style: 'deep', state: remix }, store);
const id = created.json.track.id;
assert.equal(created.json.track.remixOf.title, 'Velvet Tunnel');
assert.equal((await handleRemix('GET', id, store)).status, 405);
assert.equal((await handleRemix('POST', 'missing', store)).status, 404);
assert.equal((await handleRemix('POST', id, store, 'a')).json.remixes, 1);
assert.equal((await handleRemix('POST', id, store, 'b')).json.remixes, 2);
assert.equal((await handleCrate('GET', null, store, id)).json.track.remixes, 2);
console.log('share links and remix attribution passed');
