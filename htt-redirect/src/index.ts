/**
 * htt-redirect — the hackthetrack.net shutdown Worker.
 *
 * HackTheTrack moved to LapWing at lapwingdata.com; the old domain's announced
 * shutdown date (July 20, 2026) has passed. This Worker owns hackthetrack.net
 * (+ www) and permanently redirects every request to the same path on the new
 * domain, so deep links keep working.
 *
 * One exception: the old site was an offline-first PWA, so returning visitors
 * carry a service worker that serves the cached app shell without touching the
 * network — they would never see the redirect. Worse, a service-worker update
 * fetch that gets redirected simply fails and leaves the old worker installed
 * forever. So the two SW URLs the old app ever registered are answered with a
 * self-destructing kill-switch script instead of a redirect: it wipes every
 * cache, forces open tabs to reload (which then hit the redirect), and
 * unregisters itself.
 */

const TARGET_ORIGIN = "https://lapwingdata.com";

// The service-worker URLs the old app registered: the active vite-plugin-pwa
// worker and the legacy cleanup worker.
const SW_PATHS = new Set(["/service-worker.js", "/sw.js"]);

// Same script as the app's public/sw.js kill-switch: take over immediately,
// clear all caches, reload open tabs, then unregister.
const KILL_SWITCH_SW = `self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();

    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));

    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(clients.map((client) => {
      const url = new URL(client.url);
      url.searchParams.set("sw-cleanup", Date.now().toString());
      return client.navigate(url.toString());
    }));

    await self.registration.unregister();
  })());
});
`;

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);

    if (SW_PATHS.has(url.pathname)) {
      return new Response(KILL_SWITCH_SW, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          // Every SW update check must see the kill-switch fresh.
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }

    return Response.redirect(`${TARGET_ORIGIN}${url.pathname}${url.search}`, 301);
  },
} satisfies ExportedHandler;
