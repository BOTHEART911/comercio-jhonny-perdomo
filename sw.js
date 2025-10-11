/* PORTAL COMERCIAL - Service Worker
 * Estrategia híbrida:
 * - HTML (navegación): Network-First con fallback a caché
 * - Estáticos (mismo origen): Stale-While-Revalidate
 * - Externos (CDN/Cloudinary): Stale-While-Revalidate en caché de runtime
 */

const VERSION = 'v1.0.0-2025-10-11';
const STATIC_CACHE = `pc-static-${VERSION}`;
const RUNTIME_CACHE = `pc-runtime-${VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sw.js'
  // El resto (CDNs, imágenes) se cachea dinámicamente en runtime
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => Promise.resolve())
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => {
        if (k.startsWith('pc-') && k !== STATIC_CACHE && k !== RUNTIME_CACHE) {
          return caches.delete(k);
        }
      })
    );
    await self.clients.claim();
  })());
});

/* Helper: Stale-While-Revalidate genérico */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((res) => {
      // Evitar cachear respuestas no válidas
      if (res && res.ok) {
        cache.put(request, res.clone());
      }
      return res;
    })
    .catch(() => undefined);

  // Sirve rápido desde caché y actualiza en segundo plano
  return cached || networkFetch || Promise.reject('No response');
}

/* Helper: Network-First con fallback a caché */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      cache.put(request, res.clone());
    }
    return res;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Último recurso: entrega shell si aplica
    const fallback = await caches.match('./index.html');
    return fallback || new Response('Sin conexión', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Navegación/HTML
  const isNavigation = req.mode === 'navigate' ||
                       (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(networkFirst(req, STATIC_CACHE));
    return;
  }

  // Estáticos (mismo origen): CSS/JS/imagenes/fuentes -> SWR en STATIC
  if (sameOrigin && ['style', 'script', 'image', 'font'].includes(req.destination)) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // Externos (CDNs, Cloudinary, etc.) -> SWR en RUNTIME
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
