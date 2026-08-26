const CACHE_NAME = "moneymoney-v50";
const STATIC_ASSETS = ["/", "/manifest.json"];

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
        .catch(() => Response.new(
          '<!doctype html><meta charset="utf-8"><title>MoneyMoney 正在连接</title><meta http-equiv="refresh" content="2">' +
          '<div style="font:16px system-ui,sans-serif;padding:28px;text-align:center;color:#333">MoneyMoney 正在连接本地服务，请稍候……</div>',
          { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
        ))
    );
    return;
  }

  if (event.request.url.includes("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((res) => res.ok ? res : Promise.reject(new Error("API unavailable")))
        .catch(() => Response.new(
          JSON.stringify({ success: false, error: "本地服务暂时不可用" }),
          { status: 503, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }
        ))
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
