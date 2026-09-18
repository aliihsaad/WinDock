/**
 * WinDock service worker.
 *
 * Purpose is installability and a fast, resilient shell — never stale control.
 *
 *  - Shell assets: cache-first, refreshed in the background.
 *  - Everything under /api/ and the WebSocket: network-only, never cached.
 *    Caching dock state would let a phone show a stale "running" badge or, far
 *    worse, replay a control action from cache. Neither is acceptable.
 */

const VERSION = "windock-v4-capture";
const SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/dock.js",
  "/tiles.js",
  "/icons.js",
  "/launcher.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // addAll is atomic: one missing asset must not leave a half-populated
      // cache that then serves a broken shell.
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live state and actions must always hit the host.
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
