const CACHE_NAME = "moneymoney-v58-trusted-research";
const STATIC_ASSETS = ["/", "/manifest.json"];
const OFFLINE_SAFE_API_PATHS = ["/api/evidence", "/api/scenarios", "/api/signals/quality"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", clone));
          return res;
        })
        .catch(async () => (await caches.match("/")) || new Response(
          '<!doctype html><meta charset="utf-8"><title>MoneyMoney 正在连接</title><meta http-equiv="refresh" content="2">' +
          '<div style="font:16px system-ui,sans-serif;padding:28px;text-align:center;color:#333">MoneyMoney 正在连接本地服务，请稍候……</div>',
          { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
        ))
    );
    return;
  }

  if (event.request.url.includes("/api/")) {
    const url = new URL(event.request.url);
    const offlineSafe = OFFLINE_SAFE_API_PATHS.some((path) => url.pathname === path);
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (!res.ok) throw new Error("API unavailable");
          if (offlineSafe) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(async () => {
          if (offlineSafe) {
            const cached = await caches.match(event.request);
            if (cached) return cached;
          }
          return new Response(
            JSON.stringify({ success: false, dataStatus: "cached", error: "网络不可用且没有最近的公开快照", reason: "离线状态，仅可查看已缓存的公开证据快照" }),
            { status: 503, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }
          );
        })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
