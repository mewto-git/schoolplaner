/**
 * Service Worker für den Schulplaner.
 *
 * Zweck: Die App startet auch ohne Internet (Home-Bildschirm auf dem iPhone).
 * Alle Schuldaten liegen ohnehin im localStorage — hier wird nur die „Hülle"
 * (HTML, Icons, Manifest) zwischengespeichert.
 *
 * WICHTIG: /api/untis/* wird NIE gecacht — Login-Daten und Stundenpläne sollen
 * nicht auf dem Gerät im Cache landen.
 */
const VERSION = "schulplaner-v3";
const SHELL = [
  "./",
  "./index.html",
  "./privacy.html",
  "./manifest.webmanifest",
  "./apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;   // WebUntis-Sync nie cachen

  // Seitenaufrufe: erst Netz (frische Version), sonst der gespeicherte Stand.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Dateien (Icons, Manifest …): erst Cache, im Hintergrund auffrischen.
  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
