// UNTERGRUND service worker: offline app shell + cache-first recorded samples.
// scripts/build.mjs rewrites VERSION (a hash of the shell) and SHELL (every js/css file) in dist/sw.js,
// so each deploy that changes the app installs a fresh shell cache and drops the old one.
const VERSION = 'dev';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/css/style.css', '/js/main.js'];
const SHELL_CACHE = `untergrund-shell-${VERSION}`;
// Sample URLs carry their own ?v= revision (js/livekit.js), so this cache survives app deploys.
const SAMPLE_CACHE = 'untergrund-samples-1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'no-cache' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, SAMPLE_CACHE]);
    for (const key of await caches.keys()) if (key.startsWith('untergrund-') && !keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

const cacheable = (res) => res && res.ok && res.type === 'basic';

// Shell files are not content-hashed, so the network wins whenever it answers: a new deploy reaches users on
// their next load, and the cache is only the offline fallback.
async function networkFirst(request, key = request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (cacheable(res)) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key, { ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}

async function sample(request) {
  const cache = await caches.open(SAMPLE_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res)) {
    const path = new URL(request.url).pathname;
    for (const old of await cache.keys()) if (new URL(old.url).pathname === path && old.url !== request.url) cache.delete(old);
    cache.put(request, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    // Only the app itself; /a/* and /t/* are server-rendered pages behind /api.
    if (url.pathname === '/' || url.pathname === '/index.html') event.respondWith(networkFirst(request, '/index.html'));
    return;
  }
  if (url.pathname.startsWith('/samples/')) return event.respondWith(sample(request));
  if (/^\/(js|css|data|icons)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(networkFirst(request, url.pathname));
  }
});
