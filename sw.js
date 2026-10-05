const CACHE_NAME = "relawansync-v31-kontrak-terpadu-cache";
const PRECACHE_URLS = [
    "./",
    "index.html",
    "login.html",
    "input.html",
    "riwayat.html",
    "kalender.html",
    "statistik.html",
    "master.html",
    "peringkat.html",
    "seragam.html",
    "panduan.html",
    "manifest.json",
    "assets/icon.png",
    "assets/icon-192.png",
    "css/tailwind.min.css",
    "css/style.css",
    "js/theme.js",
    "js/supabase-config.js",
    "js/domain.js",
    "js/app.js",
    "js/dashboard.js",
    "js/input.js",
    "js/riwayat.js",
    "js/export-rekap.js",
    "js/kalender.js",
    "js/statistik.js",
    "js/master.js",
    "js/peringkat.js",
    "js/seragam.js"
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
