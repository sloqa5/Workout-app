/* Lift Log service worker.
   App files: network-first (so updates arrive as soon as you're online), cached copy when offline.
   Fonts: cache-first. Bump VERSION on every release so phones pick up the new build. */
const VERSION = "liftlog-3.1.0";
const CORE = ["./", "index.html", "styles.css", "app.js", "data.js", "coach.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "liftlog-fonts").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", e => { if(e.data === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request; if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){
    e.respondWith(caches.open("liftlog-fonts").then(async c => { const hit = await c.match(req); if(hit) return hit; try{ const res = await fetch(req); if(res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }catch(err){ return hit || Response.error(); } }));
    return;
  }
  if(url.origin !== location.origin) return;
  e.respondWith((async () => {
    try{
      const res = await fetch(req, {cache:"no-cache"});
      if(res.ok){ const c = await caches.open(VERSION); c.put(req, res.clone()); }
      return res;
    }catch(err){
      const hit = await caches.match(req, {ignoreSearch:true});
      if(hit) return hit;
      if(req.mode === "navigate") return caches.match("index.html");
      return Response.error();
    }
  })());
});
