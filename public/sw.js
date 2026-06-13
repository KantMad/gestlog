// Service worker GestLog — stratégie NETWORK-FIRST.
// Objectif : rester installable (PWA) tout en servant TOUJOURS des données fraîches
// (outil B2B temps réel). Le cache ne sert que de repli hors-ligne.
const CACHE = "gestlog-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // purge les anciens caches d'une version précédente
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // on ne gère que le même domaine

  event.respondWith(
    fetch(req)
      .then((res) => {
        // met en cache les réponses OK (repli hors-ligne), sauf l'API (données volatiles)
        if (res.ok && !url.pathname.startsWith("/api/")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req)) // hors-ligne : on tente le cache
  );
});
