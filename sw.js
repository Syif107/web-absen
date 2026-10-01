const CACHE_NAME = "relawansync-v19-ranking-seragam-cache";
const PRECACHE_URLS = [
    "manifest.json",
    "assets/icon.png",
    "assets/icon-192.png",
    "css/style.css",
    "js/theme.js"
];

// Install langsung aktifkan worker baru
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
    );
    self.skipWaiting();
});

// Hapus cache lama yang menumpuk saat ada update
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Hanya cache aset GET dari origin aplikasi.
// Request Supabase/CDN dan seluruh mutasi (POST/PATCH/DELETE) harus langsung ke
// jaringan. Ini mencegah respons write berubah menjadi network error setelah
// server sebenarnya sudah menerima perubahan, sekaligus mencegah data API
// terautentikasi tersimpan di Cache Storage.
self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== "GET" || url.origin !== self.location.origin) {
        return;
    }

    event.respondWith(
        fetch(request)
            .then((networkResponse) => {
                if (!networkResponse.ok || networkResponse.type !== "basic") {
                    return networkResponse;
                }

                return caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, networkResponse.clone());
                    return networkResponse;
                });
            })
            .catch(() => caches.match(request))
    );
});
