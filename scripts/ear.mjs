#!/usr/bin/env node
// The digital ear's label log. ear.html exports picks from the phone; this merges them into the checked-in log and
// reports how far each measured feature already agrees with them (docs/taste.md).
//   node scripts/ear.mjs ingest ~/Downloads/ear-*.json   merge exports into research/taste/judgments.json
//   node scripts/ear.mjs signals [--device <hash>…]     pull hearts/downs from production into research/taste/reactions.json
//   node scripts/ear.mjs report [--json]                 counts, top reasons, feature agreement, past critiques
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SCHEMA, TAG_IDS, featureAgreement, mergeJudgments, mergeReactions, reactionsOf, summarize, summarizeReactions, validJudgment } from '../js/ear-data.js';

const LOG = new URL('../research/taste/judgments.json', import.meta.url);
const REACTIONS = new URL('../research/taste/reactions.json', import.meta.url);
const CRITIQUES = new URL('../research/taste/critiques.json', import.meta.url);
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const loadFile = () => (existsSync(LOG) ? read(LOG) : {});
export const loadLog = () => loadFile().judgments || [];
// Device hashes (ear.html exports) whose player hearts/downs count as Jason's.
export const loadDevices = () => loadFile().devices || [];
export const loadReactions = () => (existsSync(REACTIONS) ? read(REACTIONS).reactions : []);
const save = (judgments, devices) => writeFileSync(LOG, JSON.stringify({ schema: SCHEMA, devices: [...new Set(devices)].sort(), judgments }, null, 1) + '\n');

export function ingest(files) {
  const before = loadLog(), incoming = [], devices = loadDevices();
  for (const f of files) {
    const data = read(f), list = Array.isArray(data) ? data : data.judgments || [];
    if (/^[0-9a-f]{8}$/.test(data.device || '')) devices.push(data.device);
    const bad = list.filter((j) => !validJudgment(j)).length;
    if (bad) console.warn(`${f}: skipped ${bad} malformed pick(s)`);
    incoming.push(...list);
  }
  const judgments = mergeJudgments(before, incoming);
  save(judgments, devices);
  return { added: judgments.length - before.length, total: judgments.length };
}

// Production listen signals (stats token) → this device's latest heart/down per song. Without known devices it only
// lists who reacted, so the right phone can be picked with --device.
export async function signals({ token, devices = [], base = 'https://www.untergrund.sh', fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${base}/api/events?signals=1&limit=1000`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`signals: HTTP ${res.status} ${(await res.text()).slice(0, 80)}`);
  const { signals: raw = [] } = await res.json();
  const all = reactionsOf(raw, { cleared: true }), byDevice = {};
  for (const r of all.filter((x) => x.reaction)) { const d = (byDevice[r.dev] ||= { love: 0, down: 0, last: '' }); d[r.reaction]++; if (r.at > d.last) d.last = r.at; }
  const mine = new Set([...loadDevices(), ...devices]);
  if (!mine.size) return { records: raw.length, devices: byDevice, added: 0, total: loadReactions().length };
  if (devices.length) save(loadLog(), [...mine]);
  const before = loadReactions(), reactions = mergeReactions(before, all.filter((r) => mine.has(r.dev)));
  writeFileSync(REACTIONS, JSON.stringify({ schema: 'untergrund.reactions/1', reactions }, null, 1) + '\n');
  return { records: raw.length, devices: byDevice, added: reactions.length - before.length, total: reactions.length };
}

export function report(judgments = loadLog()) {
  const critiques = read(CRITIQUES).critiques, pastTags = Object.fromEntries(TAG_IDS.map((t) => [t, 0]));
  for (const c of critiques) for (const t of c.tags) pastTags[t]++;
  return { ...summarize(judgments), features: featureAgreement(judgments).slice(0, 12), critiques: critiques.length, pastTags, reactions: summarizeReactions(loadReactions()) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'ingest' && args.length) {
    const { added, total } = ingest(args);
    console.log(`ear: +${added} picks, ${total} total → research/taste/judgments.json`);
  } else if (cmd === 'signals') {
    const token = process.env.STATS_TOKEN || process.env.UNTERGRUND_STATS_TOKEN;
    if (!token) { console.error('signals: set STATS_TOKEN (the production stats token)'); process.exit(1); }
    const devices = args.filter((a, i) => args[i - 1] === '--device');
    const r = await signals({ token, devices });
    console.log(`ear: ${r.records} recent listen records`);
    for (const [d, n] of Object.entries(r.devices)) console.log(`  device ${d}: ${n.love} love · ${n.down} down · last ${n.last.slice(0, 16)}`);
    console.log(`ear: +${r.added} reactions, ${r.total} total → research/taste/reactions.json${r.total || r.added ? '' : ' (no device chosen: rerun with --device <hash>)'}`);
  } else if (cmd === 'report') {
    const r = report();
    if (args.includes('--json')) console.log(JSON.stringify(r, null, 1));
    else {
      console.log(`ear: ${r.judgments} picks (A ${r.picks.a} · B ${r.picks.b} · same ${r.picks.same}), ${r.critiques} past critiques`);
      console.log('styles:', Object.entries(r.styles).map(([s, n]) => `${s} ${n}`).join(' · ') || '—');
      console.log('reasons now:', Object.entries(r.tags).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(' · ') || '—');
      const x = r.reactions;
      console.log(`player: ${x.love} love · ${x.down} down (${Object.entries(x.why).filter(([, n]) => n).map(([w, n]) => `${w} ${n}`).join(' · ') || 'no reasons'})`);
      console.log('reasons past:', Object.entries(r.pastTags).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(' · '));
      for (const f of r.features) console.log(`  ${f.feature.padEnd(22)} ${f.direction} wins ${(Math.max(f.agreement, 1 - f.agreement) * 100).toFixed(0)}% of ${f.n}`);
      if (!r.features.length) console.log('  (feature agreement appears after 5 decisive picks)');
    }
  } else {
    console.error('usage: node scripts/ear.mjs ingest <export.json…> | signals [--device <hash>…] | report [--json]');
    process.exit(1);
  }
}
