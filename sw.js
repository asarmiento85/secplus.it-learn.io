// sw.js — Network+ N10-009 Study Site Service Worker
// Strategy:
//   • On install  → pre-cache all app shell files (HTML, CSS, JS, JSON)
//   • On activate → delete any old cache versions
//   • On fetch    → cache-first for cached assets; network-only for everything else

const CACHE_NAME = 'netplus-v4';

// All files to pre-cache at install time
const APP_SHELL = [
  // Root
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',

  // App JS modules
  './app.js',
  './app-dashboard.js',
  './app-domain.js',
  './app-flashcards.js',
  './app-objective.js',
  './app-quiz.js',
  './app-search.js',
  './progress.js',
  './sidebar.js',

  // Pages
  './pages/dashboard.html',
  './pages/quiz.html',
  './pages/flashcards.html',
  './pages/objective.html',
  './pages/10-networking-concepts.html',
  './pages/20-network-implementation.html',
  './pages/30-network-operations.html',
  './pages/40-network-security.html',
  './pages/50-network-troubleshooting.html',

  // Toolbox pages
  './pages/tools.html',
  './pages/subnet-calculator.html',
  './pages/port-lookup.html',
  './pages/binary-converter.html',
  './pages/ipv6-expander.html',
  './pages/osi-reference.html',
  './pages/cidr-cheatsheet.html',

  // Data files (the big ones — cached so quizzes/flashcards work offline)
  './data/n10-009-outline.json',
  './data/flashcards.json',
  './data/questions.json',
];

// ── Install: pre-cache app shell ─────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching app shell…');
      // addAll fails if any request fails — use individual adds so one 404
      // doesn't break everything
      return Promise.allSettled(
        APP_SHELL.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err))
        )
      );
    }).then(() => {
      console.log('[SW] Install complete');
      // Force this SW to become active immediately (don't wait for old tabs)
      return self.skipWaiting();
    })
  );
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => {
      console.log('[SW] Activate complete — claiming clients');
      return self.clients.claim();
    })
  );
});

// ── Fetch: cache-first for app files, network fallback ───────────────────────
self.addEventListener('fetch', event => {
  // Only handle GET requests for our own origin
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip cross-origin requests (CDNs, external APIs, etc.)
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Serve from cache; revalidate in background (stale-while-revalidate)
        const networkRefresh = fetch(event.request)
          .then(response => {
            if (response && response.ok) {
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
            }
            return response;
          })
          .catch(() => {/* offline — cache already served */});

        return cached;
      }

      // Not in cache → fetch from network and cache for next time
      return fetch(event.request).then(response => {
        if (!response || !response.ok) return response;

        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
        return response;
      }).catch(() => {
        // Offline and not cached — return a simple offline page for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});
