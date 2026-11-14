// Run the improvement engine (api/_lib/improve.js) and print ranked findings + proposed experiments as Markdown.
//   STATS_TOKEN=… node scripts/improve.mjs --url https://untergrund.sh   # the live report (GET /api/events?improve=1)
//   node scripts/improve.mjs --file signals.json [--min 20]               # offline, on an export of ?signals=1
//   … --json out.json                                                     # also write the full report
// Proposals only: this never changes a generator default.
import { readFile, writeFile } from 'node:fs/promises';
import { analyze, toMarkdown } from '../api/_lib/improve.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const min = +opt('min') > 0 ? Math.round(+opt('min')) : undefined;
let report;
if (opt('file')) {
  const raw = JSON.parse(await readFile(opt('file'), 'utf8'));
  report = analyze(Array.isArray(raw) ? raw : raw.signals || [], min ? { minListens: min } : {});
} else if (opt('url')) {
  const token = process.env.STATS_TOKEN;
  if (!token) { console.error('Set STATS_TOKEN to read the live report.'); process.exit(2); }
  const res = await fetch(`${opt('url').replace(/\/$/, '')}/api/events?improve=1${min ? `&min=${min}` : ''}`, { headers: { 'x-stats-token': token } });
  if (!res.ok) { console.error(`improve report: HTTP ${res.status}`); process.exit(1); }
  report = await res.json();
} else {
  console.error('Usage: node scripts/improve.mjs (--url <origin> with STATS_TOKEN | --file signals.json) [--min N] [--json out.json]');
  process.exit(2);
}
if (opt('json')) await writeFile(opt('json'), JSON.stringify(report, null, 2));
process.stdout.write(toMarkdown(report));
