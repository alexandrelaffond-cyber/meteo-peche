// Service worker : l'application s'ouvre même sans réseau.
// Les données météo/hydro sont gardées en cache par l'application elle-même (localStorage).
const VERSION = 'v2';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/api.js',
  'js/store.js',
  'js/analysis.js',
  'js/astro.js',
  'js/charts.js',
  'js/ui.js',
  'vendor/chart.umd.min.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) return; // fichiers de vigilance : toujours le réseau
  // Réseau d'abord (pour recevoir les mises à jour), cache en secours.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
