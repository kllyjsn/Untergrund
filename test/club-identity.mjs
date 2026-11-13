import assert from 'node:assert/strict';
import { SHAPES, COLORS, GEAR, LEGACY_NAME, MAX_NAME, seeded, generateName, randomLook, generateAvatar, migrateAvatar, chatGroups, GROUP_MS } from '../js/club-identity.js';

// Generated names: deterministic per seed, short, two words, varied.
assert.equal(generateName(seeded('client-a')), generateName(seeded('client-a')));
const names = new Set();
const random = seeded(7);
for (let i = 0; i < 400; i++) {
  const name = generateName(random);
  assert.ok(name.length <= MAX_NAME, `${name} fits one chat line`);
  assert.match(name, /^[A-Z][a-z]+ [A-Z][a-zA-Z-]+$/);
  assert.notEqual(name, LEGACY_NAME);
  names.add(name);
}
assert.ok(names.size > 150, `names vary (${names.size} distinct of 400)`);
const fresh = [...Array(6)].map((_, i) => generateAvatar(seeded(`visitor-${i}`)));
assert.ok(new Set(fresh.map((a) => a.name)).size >= 5, 'two visitors rarely share a name');

// Random looks stay inside the values the room accepts.
for (let i = 0; i < 200; i++) {
  const look = randomLook(seeded(i));
  assert.ok(SHAPES.includes(look.shape) && COLORS.includes(look.color) && GEAR.includes(look.gear));
}
assert.ok(new Set([...Array(60)].map((_, i) => JSON.stringify(randomLook(seeded(i))))).size > 30, 'looks vary');

// Migration: new visitors get generated, "Night Listener" is renamed once, chosen names and looks are kept.
let m = migrateAvatar(null, seeded(1));
assert.ok(m.changed && m.avatar.name && m.avatar.name !== LEGACY_NAME);
m = migrateAvatar({ name: LEGACY_NAME, shape: 'visor', color: 'blue', gear: 'antenna' }, seeded(2));
assert.ok(m.changed);
assert.notEqual(m.avatar.name, LEGACY_NAME);
assert.deepEqual({ ...m.avatar, name: 0 }, { name: 0, shape: 'visor', color: 'blue', gear: 'antenna' });
m = migrateAvatar({ name: LEGACY_NAME, shape: 'block', color: 'lime', gear: 'hood', v: 2 }, seeded(3));
assert.equal(m.avatar.name, LEGACY_NAME, 'a name typed after migration is kept');
assert.equal(m.changed, false);
m = migrateAvatar({ name: 'DJ Kel', shape: 'round', color: 'bone', gear: 'phones' }, seeded(4));
assert.equal(m.avatar.name, 'DJ Kel');
assert.equal(m.avatar.color, 'bone');
m = migrateAvatar({ name: 'DJ Kel', shape: 'square', color: 'mauve', gear: 'hat', v: 2 }, seeded(5));
assert.ok(m.changed && SHAPES.includes(m.avatar.shape) && COLORS.includes(m.avatar.color) && GEAR.includes(m.avatar.gear));

// Chat grouping.
const t0 = 1_700_000_000_000;
const a = { id: 'a', name: 'Acid Fader', avatar: { shape: 'round', color: 'red', gear: 'none' } };
const b = { id: 'b', name: 'Sub Wire', shape: 'visor', color: 'blue', gear: 'hood' };
const msg = (id, user, text, at, extra = {}) => ({ id, type: 'chat', user, payload: { text }, at, ...extra });
const groups = chatGroups([
  msg('1', a, 'yo', t0),
  msg('2', a, 'this kick', t0 + 1000),
  msg('3', b, 'hi', t0 + 2000),
  msg('4', b, '', t0 + 2500),
  { id: '5', type: 'jam', jam: true, user: b, payload: { text: 'took the BASS' }, at: t0 + 3000 },
  msg('6', b, 'nice', t0 + 4000),
  msg('7', b, 'later', t0 + 4000 + GROUP_MS + 1),
  msg('8', { id: 'c' }, 'anon', t0 + GROUP_MS * 2),
], { me: 'b', hostId: 'a' });
assert.deepEqual(groups.map((g) => g.system ? `sys:${g.text}` : `${g.id}:${g.lines.length}`), ['a:2', 'b:1', 'sys:took the BASS', 'b:1', 'b:1', 'c:1']);
assert.deepEqual([groups[0].color, groups[0].shape, groups[0].host, groups[0].mine], ['red', 'round', true, false]);
assert.deepEqual([groups[1].color, groups[1].shape, groups[1].host, groups[1].mine], ['blue', 'visor', false, true]);
assert.ok(groups[2].mine && groups[2].name === 'Sub Wire');
assert.deepEqual([groups[5].name, groups[5].color], ['Listener', 'lime']);
assert.deepEqual(chatGroups([]), []);

console.log('club identity ok');
