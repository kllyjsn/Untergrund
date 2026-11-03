// Installable app: register the service worker on the main page only (not in embeds/iframes, not on plain http).
const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
let framed = true;
try { framed = window.top !== window.self; } catch { /* cross-origin parent */ }
if ('serviceWorker' in navigator && secure && !framed) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Installed home-screen apps can stay open for days: look for a new deploy when they come back.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch((err) => console.warn('service worker unavailable', err));
  });
}
