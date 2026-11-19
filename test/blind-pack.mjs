import assert from 'node:assert/strict';
import { detectStyles, hash, random, shuffle, main } from '../scripts/blind-pack.mjs';

const input = ['minimal', 'drill', 'hardtechno', 'trap'];
assert.deepEqual(shuffle(input, random(42)), shuffle(input, random(42)));
assert.deepEqual(input, ['minimal', 'drill', 'hardtechno', 'trap']);
assert.deepEqual(shuffle([], random(42)), []);
assert.notEqual(hash('42:drill'), hash('42:trap'));
assert.deepEqual(detectStyles('Fix Hard Techno transients /devin/minimal-balance'), ['hardtechno', 'minimal']);
assert.deepEqual(detectStyles('Balance', "+ if (style === 'drill') gain = 1;\n- if ('trap' === style) gain = 2;"), ['trap', 'drill']);
assert.deepEqual(detectStyles('Housekeeping', " context style === 'drill'\n+const unrelated = 1;"), []);
assert.deepEqual(detectStyles(''), []);
assert.deepEqual(detectStyles('Maintenance', "+const mode = 'acid';\n+const style = config.style;"), []);
await assert.rejects(main(['--seed', 'NaN']), /Seed must/);
await assert.rejects(main(['--unknown', 'x']), /Invalid option/);
console.log('blind-pack: pure tests passed');
