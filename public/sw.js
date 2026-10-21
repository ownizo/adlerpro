/*
 * Service worker for the client portal PWA (MillionGuard).
 *
 * Strategy is intentionally conservative because the app is authenticated and
 * data-heavy: we never cache API/auth traffic, and for everything else we go to
 * the network first and only fall back to the cache when the device is offline.
 * This keeps the portal installable without ever serving stale account data.
 */
// v3: earlier versions also cached server-function responses (client data);
// bumping the name deletes those caches on activate.
const CACHE = 'oms-cache-v3'

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

  // Never cache server endpoints, server functions (they return the client's
  // policies, claims and profile) or auth callbacks: always live, never kept
  // on the device.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/.netlify/') ||
    url.pathname.startsWith('/_serverFn') ||
    url.search.includes('code=') ||
    request.headers.has('authorization')
  ) {
    return
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const noStore = /no-store|private/.test(response?.headers.get('cache-control') || '')
        if (response && response.ok && response.type === 'basic' && !noStore) {
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
