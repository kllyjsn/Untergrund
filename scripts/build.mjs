import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { writeSite as writeResearch } from './research.mjs';

// Browser bundle of the Vercel Blob upload client, used to publish recorded sets
await build({ entryPoints: ['scripts/blob-client-entry.js'], bundle: true, format: 'esm', platform: 'browser', minify: true, outfile: 'js/vendor/blob-client.js', logLevel: 'warning' });

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const path of ['index.html', 'embed.html', 'lab.html', 'sc-callback.html', 'stats.html', 'social-card.png', 'manifest.webmanifest', 'sw.js', 'icons', 'css', 'js', 'samples', 'data']) {
  cpSync(path, `dist/${path}`, { recursive: true });
}

// Service worker: precache every shell file and version the cache by their content, so each deploy that changes
// the app ships a byte-different sw.js (browsers then install it and drop the previous shell cache).
const shell = ['index.html', 'manifest.webmanifest', ...['js', 'css', 'icons'].flatMap((dir) =>
  readdirSync(`dist/${dir}`, { recursive: true }).filter((f) => /\.(js|css|png)$/.test(f)).map((f) => `${dir}/${f}`))].sort();
const hash = createHash('sha256');
for (const f of shell) hash.update(f).update(readFileSync(`dist/${f}`));
const sw = readFileSync('dist/sw.js', 'utf8');
const built = sw.replace(/^const VERSION = .*$/m, `const VERSION = '${hash.update(sw).digest('hex').slice(0, 12)}';`)
  .replace(/^const SHELL = .*$/m, `const SHELL = ${JSON.stringify(['/', ...shell.map((f) => `/${f}`)])};`);
if (built === sw) throw new Error('sw.js: VERSION/SHELL placeholders not found');
writeFileSync('dist/sw.js', built);

// /research: static posts and social cards rendered from the checked-in benchmark snapshots (scripts/research.mjs).
writeResearch('dist');
