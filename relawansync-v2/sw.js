const CACHE_NAME = "relawansync-v2-cache";
const urlsToCache = [
    "./",
    "./index.html",
    "./login.html",
    "./css/style.css",
    "./js/app.js",
    "./js/supabase-config.js",
    "./assets/icon.png"
];

// Menginstal Service Worker & Menyimpan Cache Dasar
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(urlsToCache);
        })
    );
});

// Mengambil file dari Cache agar loading lebih cepat
self.addEventListener("fetch", (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            // Kembalikan file dari cache jika ada, jika tidak ambil dari internet
            return response || fetch(event.request);
        })
    );
});