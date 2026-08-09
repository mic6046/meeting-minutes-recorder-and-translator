/*
 * MinutesFlow AI service worker.
 * Goal: make the app installable (PWA) and give it a basic offline shell,
 * WITHOUT interfering with the app's own version-based auto-reload or its
 * network calls to Firebase / Stripe / Gemini.
 *
 * Rules:
 *  - Never touch cross-origin requests (auth iframe, Google, Stripe, Gemini APIs).
 *  - Never cache /api/* or /version.json (the app relies on these being fresh).
 *  - Navigations are network-first with a cached "/" fallback when offline.
 *  - Only runtime-cache immutable build output (/assets/) and app icons, so the
 *    Vite dev server's live modules are never cached.
 */
const CACHE = "minutesflow-v2";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon.png",
  "/icons/icon-maskable.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

function isCacheableAsset(pathname) {
  return pathname.startsWith("/assets/") || pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin alone
  if (url.pathname.startsWith("/api/") || url.pathname === "/version.json") return; // always network

  // App navigations: fresh HTML when online, cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/", { ignoreSearch: true }).then((cached) => cached || Response.error())
      )
    );
    return;
  }

  // Immutable build output + icons: stale-while-revalidate.
  if (isCacheableAsset(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok && res.type === "basic") {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
