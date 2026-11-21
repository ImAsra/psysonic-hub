// Service worker for the installed web app: keeps the page shell available so the
// app opens (and shows "Reconnecting…") while the hub is unreachable.
// Shell files are network-first, so a hub update is picked up on the next load.
// Sign-in, the API and the WebSocket are never cached.
const CACHE = 'psysonic-hub-shell-v3';
const SHELL = ['/', '/app.js', '/library.js', '/app.css', '/manifest.webmanifest', '/icon.png', '/icon-maskable.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const cacheable = (url) => SHELL.includes(url.pathname) || /^\/locales\/[a-zA-Z-]+\.json$/.test(url.pathname);

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || !cacheable(url)) return;
  const cached = () => caches.match(e.request);
  e.respondWith(
    fetch(e.request)
      .then(async (res) => {
        if (res.ok) {
          // Keep the worker alive until the copy is stored, or it may be stopped first.
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}));
          return res;
        }
        // A proxy in front of a stopped hub answers 502/503: show the saved page instead of its error page.
        if (res.status >= 500) return (await cached()) || res;
        return res;
      })
      .catch(() => cached().then((hit) => hit || Response.error())),
  );
});
