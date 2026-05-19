const CACHE_NAME = 'marine-intelligence-web-v2'
const STATIC_ASSETS = [
  './',
  './manifest.webmanifest',
  './data/manifest.json',
  './data/forecasts.json',
  './data/forecast-grid.json',
  './data/rules.json',
  './data/warnings.geojson',
  './data/pfma.geojson',
  './data/albacore.geojson',
  './data/bluewater.json',
  './data/task-status.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        return response
      })
      .catch(() => caches.match(event.request)),
  )
})
