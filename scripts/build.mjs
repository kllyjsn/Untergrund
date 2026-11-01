import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const path of ['index.html', 'sc-callback.html', 'css', 'js', 'samples']) {
  cpSync(path, `dist/${path}`, { recursive: true });
}
