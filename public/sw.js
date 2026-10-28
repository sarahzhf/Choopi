// Service worker : fonctionnement hors ligne de base + notifications push.
const CACHE = "nous-deux-v5";
const SHELL = ["./", "index.html", "backend.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Supabase : toujours en direct
  // Pages et scripts : réseau d'abord (pour être à jour), cache si hors ligne.
  if (e.request.mode === "navigate" || /\.(js|html|webmanifest)$/.test(url.pathname) || url.pathname.endsWith("/")) {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
    return;
  }
  // Images et stickers : cache d'abord.
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
  })));
});

self.addEventListener("push", (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (err) { p = { title: "Nous Deux", body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(p.title || "Nous Deux", {
      body: p.body || "",
      tag: p.tag || undefined,
      renotify: !!p.tag,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { tab: p.tab || "home" },
    });
    try { if (self.navigator.setAppBadge) await self.navigator.setAppBadge(); } catch (err) {}
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const tab = (e.notification.data && e.notification.data.tab) || "home";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { c.postMessage({ tab }); return c.focus(); }
    }
    return self.clients.openWindow("./#" + tab);
  })());
});
