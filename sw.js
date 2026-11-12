// Offline copy of NoteMaker's own files (code, styles, icons). No patient data is ever cached:
// notes live in the team folder, which the browser reads directly and this worker never sees.
// Online: always fetch the newest file first. Offline or slow Wi-Fi: fall back to the saved copy.
const CACHE = "notemaker-v6";
const FILES = [
  "./", "index.html", "styles.css", "app.js", "boot-guard.js", "sw.js", "manifest.webmanifest",
  "engine/engine.js",
  "lib/demo.js", "lib/docx-in.js", "lib/docx-out.js", "lib/icons.js", "lib/layout.js", "lib/meds.js", "lib/pdf-out.js", "lib/board-pdf.js", "lib/merge.js", "lib/holidays.js", "lib/present.js", "lib/store.js",
  "vendor/docx.iife.js", "vendor/jspdf.umd.min.js", "vendor/jszip.min.js",
  "icons/favicon.svg", "icons/favicon-32.png", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("notemaker-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const net = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 4000))]);
      if (net.ok) cache.put(req, net.clone());
      return net;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? await cache.match("./") : undefined) || Response.error();
    }
  })());
});
