// /research: every post renders from its checked-in snapshot with accessible charts, social meta and a 1200x630 card.
import assert from 'node:assert/strict';
import { renderSite, loadPosts, parsePost } from '../scripts/research.mjs';

const files = renderSite(), posts = loadPosts();
assert(posts.length >= 1, 'at least one research post');
const index = files.get('/research/index.html').body;
const tag = (html, prop) => html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1];
assert.equal(tag(index, 'og:url'), 'https://www.untergrund.sh/research/');
assert.equal(tag(index, 'og:image'), 'https://www.untergrund.sh/research/og.png');
for (const p of posts) {
  assert(index.includes(`href="/research/${p.slug}"`), `index links ${p.slug}`);
  const html = files.get(`/research/${p.slug}/index.html`)?.body;
  assert(html, `${p.slug} renders`);
  assert.equal(tag(html, 'og:type'), 'article');
  assert.equal(tag(html, 'og:image'), `https://www.untergrund.sh/research/${p.slug}/og.png`);
  assert.equal(tag(html, 'twitter:card'), 'summary_large_image');
  assert(!/<script/i.test(html), 'posts ship no JavaScript');
  assert(!/\{\{/.test(html), 'every directive and value placeholder resolved');
  const svgs = html.slice(html.indexOf('<body')).match(/<svg[\s\S]*?<\/svg>/g) || [];
  assert(svgs.length >= 5, `${p.slug} has charts`);
  for (const s of svgs) {
    const ids = s.match(/aria-labelledby="(\w+) (\w+)"/);
    assert(/role="img"/.test(s) && ids, 'each chart is an image with a label');
    assert(s.includes(`<title id="${ids[1]}">`) && s.includes(`<desc id="${ids[2]}">`), 'each chart has a title and a text description');
    assert(!/NaN|undefined/.test(s), 'no NaN/undefined in chart output');
  }
  assert(/<details><summary>Show the numbers<\/summary>/.test(html), 'charts carry their data as tables');
  const png = files.get(`/research/${p.slug}/og.png`).body;
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
  assert(png.length < 300e3, 'social card stays small');
}
assert(files.get('/research/feed.xml').body.includes('<rss version="2.0">'));
assert.throws(() => parsePost('no front matter', 'x'), /front matter/);
console.log(`research pages passed: ${posts.length} post(s), ${files.size} files`);
