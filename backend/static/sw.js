// Garden Planner service worker — network-first with cache fallback.
// Fresh code/data always wins when online; when the Wi-Fi drops at the bottom
// of the garden, the last-seen version of pages/assets still loads.
const CACHE = 'garden-planner-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Drop old cache versions
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return  // never cache mutations
  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request)
      if (fresh.ok) {
        const cache = await caches.open(CACHE)
        cache.put(e.request, fresh.clone())
      }
      return fresh
    } catch (_) {
      const cached = await caches.match(e.request, { ignoreSearch: e.request.url.includes('?v=') })
      if (cached) return cached
      throw _
    }
  })())
})
