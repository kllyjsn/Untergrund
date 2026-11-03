// DAILY DROP: one seed + genre per UTC day, the same for everyone, computed locally (no server).
import { STYLES } from './state.js';

// Fixed order so the schedule never depends on how STYLES happens to be sorted. Classical scores are left out.
const POOL = ['hypnotic', 'deephouse', 'neosoul', 'breaks', 'amapiano', 'trance', 'ukg', 'boombap', 'acid', 'afrobeats', 'dnb', 'minimal',
  'trap', 'dub', 'reggaeton', 'euphoric', 'electro', 'industrial', 'drill', 'ambient', 'bailefunk', 'peak', 'jerseyclub', 'hardtechno', 'hyperpop'];
const FIRST = ['Morning', 'Copper', 'Soft', 'Paper', 'Silver', 'Midnight', 'Lucid', 'Sunday', 'Velvet', 'Stray', 'Distant', 'Warm', 'Quiet', 'Rising'];
const SECOND = ['Light', 'Current', 'Weather', 'Signal', 'Garden', 'Motion', 'Static', 'Harbor', 'Orbit', 'Bloom', 'Transit', 'Mirror', 'Fever', 'Thread'];
const DAY = 86400e3, FIRST_DROP = Date.UTC(2026, 10, 3);

export const DROP_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const dropDate = (date = new Date()) => new Date(date).toISOString().slice(0, 10);
export const isDropDate = (v) => typeof v === 'string' && DROP_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && dropDate(`${v}T00:00:00Z`) === v;

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// Each cycle plays every genre once in a seeded order, so a genre never repeats two days running.
function styleForDay(day, pool) {
  const n = pool.length, cycle = Math.floor(day / n), order = [...pool];
  for (let i = n - 1; i > 0; i--) {
    const j = hash(`cycle:${cycle}:${i}`) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (cycle > 0 && day % n === 0) {
    const prev = styleForDay(day - 1, pool);
    if (order[0] === prev) [order[0], order[1]] = [order[1], order[0]];
  }
  return order[((day % n) + n) % n];
}

export function dailyDrop(date = new Date()) {
  const iso = isDropDate(date) ? date : dropDate(date);
  const day = Math.round((Date.parse(`${iso}T00:00:00Z`) - FIRST_DROP) / DAY);
  const pool = POOL.filter((id) => STYLES[id]);
  const style = styleForDay(day, pool);
  const seed = hash(`drop:${iso}`) % 1e9;
  const t = hash(`title:${iso}`);
  return { date: iso, no: day + 1, seed, style, genre: STYLES[style].name, title: `${FIRST[t % FIRST.length]} ${SECOND[Math.floor(t / FIRST.length) % SECOND.length]}` };
}

export const msToNextDrop = (now = Date.now()) => DAY - (((+new Date(now)) % DAY) + DAY) % DAY;
export function countdown(ms) {
  const m = Math.max(0, Math.ceil(ms / 60e3));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
