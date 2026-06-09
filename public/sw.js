/*
 * Service worker for the "Os Meus Seguros" PWA.
 *
 * Strategy is intentionally conservative because the app is authenticated and
 * data-heavy: we never cache API/auth traffic, and for everything else we go to
 * the network first and only fall back to the cache when the device is offline.
 * This keeps the portal installable without ever serving stale account data.
 */
const CACHE = 'oms-cache-v1'

// Precache the app shell so a previously visited install opens while offline.
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/pwa-192.png',
  '/pwa-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never cache server endpoints or auth callbacks — always live.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) {
    return
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        if (request.mode === 'navigate') {
          const shell = await caches.match('/')
          if (shell) return shell
        }
        return Response.error()
      }),
  )
})
