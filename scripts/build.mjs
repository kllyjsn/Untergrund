import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

// Browser bundle of the Vercel Blob upload client, used to publish recorded sets
await build({ entryPoints: ['scripts/blob-client-entry.js'], bundle: true, format: 'esm', platform: 'browser', minify: true, outfile: 'js/vendor/blob-client.js', logLevel: 'warning' });

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const path of ['index.html', 'lab.html', 'sc-callback.html', 'social-card.png', 'css', 'js', 'samples']) {
  cpSync(path, `dist/${path}`, { recursive: true });
}
