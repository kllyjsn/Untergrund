#!/usr/bin/env node
// The digital ear's label log. ear.html exports picks from the phone; this merges them into the checked-in log and
// reports how far each measured feature already agrees with them (docs/taste.md).
//   node scripts/ear.mjs ingest ~/Downloads/ear-*.json   merge exports into research/taste/judgments.json
//   node scripts/ear.mjs report [--json]                 counts, top reasons, feature agreement, past critiques
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SCHEMA, TAG_IDS, featureAgreement, mergeJudgments, summarize, validJudgment } from '../js/ear-data.js';

const LOG = new URL('../research/taste/judgments.json', import.meta.url);
const CRITIQUES = new URL('../research/taste/critiques.json', import.meta.url);
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
export const loadLog = () => (existsSync(LOG) ? read(LOG).judgments : []);

export function ingest(files) {
  const before = loadLog(), incoming = [];
  for (const f of files) {
    const data = read(f), list = Array.isArray(data) ? data : data.judgments || [];
    const bad = list.filter((j) => !validJudgment(j)).length;
    if (bad) console.warn(`${f}: skipped ${bad} malformed pick(s)`);
    incoming.push(...list);
  }
  const judgments = mergeJudgments(before, incoming);
  writeFileSync(LOG, JSON.stringify({ schema: SCHEMA, judgments }, null, 1) + '\n');
  return { added: judgments.length - before.length, total: judgments.length };
}

export function report(judgments = loadLog()) {
  const critiques = read(CRITIQUES).critiques, pastTags = Object.fromEntries(TAG_IDS.map((t) => [t, 0]));
  for (const c of critiques) for (const t of c.tags) pastTags[t]++;
  return { ...summarize(judgments), features: featureAgreement(judgments).slice(0, 12), critiques: critiques.length, pastTags };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'ingest' && args.length) {
    const { added, total } = ingest(args);
    console.log(`ear: +${added} picks, ${total} total → research/taste/judgments.json`);
  } else if (cmd === 'report') {
    const r = report();
    if (args.includes('--json')) console.log(JSON.stringify(r, null, 1));
    else {
      console.log(`ear: ${r.judgments} picks (A ${r.picks.a} · B ${r.picks.b} · same ${r.picks.same}), ${r.critiques} past critiques`);
      console.log('styles:', Object.entries(r.styles).map(([s, n]) => `${s} ${n}`).join(' · ') || '—');
      console.log('reasons now:', Object.entries(r.tags).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(' · ') || '—');
      console.log('reasons past:', Object.entries(r.pastTags).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(' · '));
      for (const f of r.features) console.log(`  ${f.feature.padEnd(22)} ${f.direction} wins ${(Math.max(f.agreement, 1 - f.agreement) * 100).toFixed(0)}% of ${f.n}`);
      if (!r.features.length) console.log('  (feature agreement appears after 5 decisive picks)');
    }
  } else {
    console.error('usage: node scripts/ear.mjs ingest <export.json…> | report [--json]');
    process.exit(1);
  }
}
