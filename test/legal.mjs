import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryKv } from '../api/_lib/kv.js';
import { cleanLegalRequest, handleLegal } from '../api/_lib/legal.js';

const html = readFileSync(new URL('../legal/index.html', import.meta.url), 'utf8');
for (const id of ['terms', 'privacy', 'music-rights', 'provenance', 'contributors', 'requests']) {
  assert(html.includes(`id="${id}"`), `legal page includes ${id}`);
}
assert(html.includes('Do Not Track') && html.includes('Global Privacy Control'));
assert(html.includes('/api/legal'));
assert(!/\b(?:TODO|TBD|INSERT|PLACEHOLDER)\b/.test(html));

const now = Date.parse('2026-11-13T20:00:00Z');
const valid = { type: 'copyright', name: 'Rights Owner', email: 'owner@example.com', work: '/t/abc', details: 'I own this work and request review of the identified track.', attest: true };
assert(cleanLegalRequest(valid, { now })?.id.startsWith('lr_'));
assert.equal(cleanLegalRequest({ ...valid, email: 'bad' }, { now }), null);
assert.equal(cleanLegalRequest({ ...valid, attest: false }, { now }), null);

const kv = memoryKv();
let out = await handleLegal({ method: 'POST', body: valid, kv, client: '1.2.3.4', now });
assert.equal(out.status, 201);
assert(out.json.id);

out = await handleLegal({ method: 'GET', kv, headers: {}, statsToken: 'secret' });
assert.equal(out.status, 401);
out = await handleLegal({ method: 'GET', kv, headers: { authorization: 'Bearer secret' }, statsToken: 'secret' });
assert.equal(out.status, 200);
assert.equal(out.json.requests.length, 1);
assert.equal(out.json.requests[0].email, valid.email);
assert(!JSON.stringify([...kv.dump().keys()]).includes('1.2.3.4'), 'raw client address is not stored');

out = await handleLegal({
  method: 'GET',
  kv,
  headers: { authorization: 'Bearer secret' },
  statsToken: 'secret',
  now: now + 180 * 86400e3 + 1,
});
assert.equal(out.status, 200);
assert.equal(out.json.requests.length, 0, 'requests expire individually after 180 days');

const capped = memoryKv();
for (let i = 0; i < 251; i++) await capped.cmd(['ZADD', 'z', i, `m${i}`]);
assert.equal(await capped.cmd(['ZREMRANGEBYRANK', 'z', 0, -501]), 0, 'rank trim keeps sets under the cap');
const file = new URL('./out/legal-kv.json', import.meta.url).pathname;
const disk = memoryKv({ file });
await handleLegal({ method: 'POST', body: valid, kv: disk, client: 'disk', now });
await new Promise((ok) => setTimeout(ok, 300));
out = await handleLegal({ method: 'GET', kv: memoryKv({ file }), headers: { authorization: 'Bearer secret' }, statsToken: 'secret', now });
assert.equal(out.json.requests.length, 1, 'file-backed requests survive restart');

console.log('legal policy and request intake passed');
