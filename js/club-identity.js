// Club identity: generated names and looks for new visitors, and the chat feed's grouping.
// Pure (no DOM) so it runs in node tests and in the room service.

export const SHAPES = ['block', 'round', 'visor'];
export const COLORS = ['lime', 'red', 'orange', 'blue', 'violet', 'pink', 'bone'];
export const GEAR = ['none', 'hood', 'goggles', 'antenna', 'phones'];
export const LEGACY_NAME = 'Night Listener';
export const FALLBACK_NAME = 'Listener';

// Two words, club and machine flavoured, always short enough for one chat line.
const FIRST = ['Acid', 'Analog', 'Chrome', 'Delta', 'Dub', 'Echo', 'Low', 'Neon', 'Night', 'Static', 'Sub', 'Velvet',
  'Hollow', 'Iron', 'Lunar', 'Mono', 'Pulse', 'Copper', 'Silver', 'Strobe', 'Tape', 'Warm', 'Deep', 'Basement'];
const SECOND = ['Fader', 'Filter', 'Kick', 'Patch', 'Cable', 'Vinyl', 'Circuit', 'Signal', 'Reverb', 'Sampler', 'Bassline',
  'Hi-Hat', 'Crate', 'Delay', 'Knob', 'Loop', 'Stylus', 'Oscillator', 'Rack', 'Shaker', 'Strobe', 'Synth', 'Tone', 'Wire'];
export const MAX_NAME = 14;

const rand = (random) => (n) => Math.floor(random() * n) % n;

// mulberry32: a seed always gives the same name and look (tests, and one client across reloads).
export function seeded(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateName(random = Math.random) {
  const r = rand(random);
  for (let tries = 0; tries < 40; tries++) {
    const first = FIRST[r(FIRST.length)], second = SECOND[r(SECOND.length)];
    const name = `${first} ${second}`;
    if (first !== second && name.length <= MAX_NAME) return name;
  }
  return 'Acid Fader';
}

export function randomLook(random = Math.random) {
  const r = rand(random);
  return { shape: SHAPES[r(SHAPES.length)], color: COLORS[r(COLORS.length)], gear: GEAR[r(GEAR.length)] };
}

export const generateAvatar = (random = Math.random) => ({ name: generateName(random), ...randomLook(random) });

// Saved avatars keep their look; a never-renamed "Night Listener" gets a generated name once (v: 2 marks it done).
export function migrateAvatar(saved, random = Math.random) {
  if (!saved || typeof saved !== 'object') return { avatar: generateAvatar(random), changed: true };
  const pick = (value, values, fallback) => values.includes(value) ? value : fallback;
  const look = randomLook(random);
  const name = String(saved.name ?? '').trim().slice(0, 28);
  const rename = saved.v !== 2 && (!name || name === LEGACY_NAME);
  const avatar = {
    name: rename ? generateName(random) : (name || FALLBACK_NAME),
    shape: pick(saved.shape, SHAPES, look.shape),
    color: pick(saved.color, COLORS, look.color),
    gear: pick(saved.gear, GEAR, look.gear),
  };
  return { avatar, changed: rename || saved.v !== 2 || ['name', 'shape', 'color', 'gear'].some((k) => avatar[k] !== saved[k]) };
}

const lookOf = (user = {}) => ({ ...user, ...(user.avatar || {}) });

// Chat feed: consecutive lines from one person (within GROUP_MS) share one name row; jam moves stay as quiet system lines.
export const GROUP_MS = 3 * 60 * 1000;
export function chatGroups(messages = [], { me = '', hostId = '' } = {}) {
  const groups = [];
  for (const message of messages) {
    const text = String(message.payload?.text || '');
    if (!text) continue;
    const user = lookOf(message.user);
    const id = user.id || '';
    if (message.jam) {
      groups.push({ system: true, key: message.id, name: user.name || FALLBACK_NAME, mine: !!id && id === me, text, at: message.at });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && !last.system && last.id === id && (message.at || 0) - (last.lastAt || 0) < GROUP_MS) {
      last.lines.push({ key: message.id, text });
      last.lastAt = message.at || last.lastAt;
      continue;
    }
    groups.push({
      key: message.id, id, name: String(user.name || FALLBACK_NAME), mine: !!id && id === me, host: !!id && id === hostId,
      color: COLORS.includes(user.color) ? user.color : 'lime', shape: SHAPES.includes(user.shape) ? user.shape : 'block',
      at: message.at, lastAt: message.at, lines: [{ key: message.id, text }],
    });
  }
  return groups;
}
