import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
for (const tag of ['og:title', 'og:description', 'og:image', 'twitter:card', 'twitter:image']) {
  assert(html.includes(tag), `${tag} metadata is required`);
}
assert(html.includes('https://www.untergrund.sh/social-card.png'), 'social image must use an absolute production URL');
assert(existsSync(new URL('../social-card.png', import.meta.url)), 'social preview artwork must be committed');
console.log('social preview metadata passed');
