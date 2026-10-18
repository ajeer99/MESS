/*
 * Partners — passthrough service worker.
 *
 * Its only job is to make the app installable (PWA) on Android/desktop and to
 * keep that install working when the device is briefly offline. It never caches
 * responses: every request goes straight to the network, so users always see
 * the freshly published version and there is no stale-cache risk.
 *
 * The app already handles offline state in the UI; this worker intentionally
 * adds no offline data layer.
 */

self.addEventListener("install", () => {
  // Take over as soon as possible — nothing is precached, so this is instant.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Only plain GET navigations/resources pass through; everything else
  // (POST/PUT/DELETE to the API, etc.) is left to the browser as-is.
  if (request.method !== "GET") return;

  // Network-first passthrough: identical behaviour to having no worker, but
  // it satisfies the installability requirement of a fetch handler.
  event.respondWith(
    fetch(request).catch(() =>
      request.mode === "navigate"
        ? new Response(
            "<!doctype html><meta charset=\"utf-8\"><title>Offline</title><p style=\"font-family:system-ui;padding:2rem\">You're offline. Reconnect and try again — your data is safe on the server.</p>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        : Response.error(),
    ),
  );
});
