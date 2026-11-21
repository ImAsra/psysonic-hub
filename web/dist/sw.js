// Service worker for the installed web app: keeps the page available so the app opens
// (and shows "Reconnecting…") while the hub is unreachable.
// The page and icons are network-first, so a hub update is picked up on the next load.
// Built files under /assets/ have a content hash in their name, so a cached copy is always right.
// Sign-in, the API and the WebSocket are never cached.
const CACHE = 'psysonic-hub-shell-v3';
const SHELL = ['/', '/manifest.webmanifest', '/icon.png', '/icon-maskable.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const remember = (req, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => remember(e.request, res))),
    );
    return;
  }
  if (!SHELL.includes(url.pathname)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => remember(e.request, res))
      .catch(() => caches.match(e.request).then((hit) => hit || Response.error())),
  );
});
