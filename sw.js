const CACHE_NAME = "relawansync-v4-cache";

// Install langsung aktifkan worker baru
self.addEventListener("install", (event) => {
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

// Strategi: Network First (Coba ambil dari internet dulu, fallback ke cache jika offline)
self.addEventListener("fetch", (event) => {
    event.respondId = true;
    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Jika berhasil ambil dari internet, simpan salinan terbarunya ke cache
                return caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            })
            .catch(() => {
                // Jika internet mati/gagal, baru ambil dari cache
                return caches.match(event.request);
            })
    );
});