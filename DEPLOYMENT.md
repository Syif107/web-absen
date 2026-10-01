# Deployment hardening RelawanSync V2

## Fase 6: Peringkat dan kontrol seragam

Fitur `peringkat.html`, `seragam.html`, kolom wilayah pada Master Data, sesi
Pagi/Malam, stok ukuran, dan pengingat penitipan membutuhkan migrasi
`db/fase6_ranking_seragam.sql`. Migrasi ini:

- membuat backup tabel produksi sebelum normalisasi;
- mempertahankan NIP sebagai identitas personel;
- mengubah sesi lama `Siang` menjadi `Pagi`;
- menormalkan tiga nama proyek lama;
- menambah view peringkat, status seragam, stok, dan riwayat audit;
- tidak menghapus personel maupun absensi lama.

Urutan rilis Fase 6: jalankan migrasi database, pastikan query verifikasi di
bagian akhir berhasil, kemudian commit dan push frontend. Setelah GitHub Pages
selesai membangun, buka ulang web dua kali agar service worker
`relawansync-v19-ranking-seragam-cache` aktif.

Perubahan hardening di repository ini belum mengubah Supabase produksi. Terapkan
database lebih dahulu, kemudian frontend, agar kontrak RPC tetap cocok.

## Mode frontend saja (Supabase dilewati)

`FASE5_ENABLED` dan `FASE4_ENABLED` di `js/supabase-config.js` dibiarkan
`false`. Dengan konfigurasi ini frontend tetap kompatibel dengan fungsi
database lama. Perbaikan tampilan, escaping data, pagination, parser CSV,
pelaporan error, dan service worker dapat digunakan.

Batasannya: penyimpanan relawan baru bersama absensi dan import CSV belum
atomik, unique constraint baru belum aktif, dan pembatasan admin/koordinator
belum tersedia. Jangan mengubah kedua flag menjadi `true` tanpa menjalankan
migrasi SQL yang sesuai.

## Urutan rilis

1. Pastikan branch dan commit yang akan dirilis sudah ditetapkan.
2. Unduh backup `master_relawan` dan `log_absensi` dari Supabase.
3. Di Supabase Authentication, nonaktifkan pendaftaran akun publik.
4. Jalankan `db/audit_duplikat.sql` (read-only).
5. Bila hasil audit mempunyai baris, tinjau dan gabungkan data secara manual.
6. Jalankan `db/fase5_integritas_transaksi.sql`.
7. Uji input relawan lama, relawan baru, dan batch duplikat menggunakan akun admin.
8. Jika multi-user akan digunakan:
   - ganti `GANTI_EMAIL_ADMIN` di `db/fase4_multi_user.sql`;
   - jalankan migrasi tersebut;
   - buat profil koordinator dengan lokasi yang benar;
   - verifikasi akun tanpa profil ditolak;
   - ubah `FASE4_ENABLED` di `js/supabase-config.js` menjadi `true`.
9. Deploy frontend.
10. Buka ulang aplikasi dua kali agar service worker versi baru mengambil alih,
    kemudian pastikan cache lama sebelum `relawansync-v18-cache` sudah terhapus.

## Smoke test wajib

- Anonim tidak dapat membaca Master atau log.
- Akun tanpa profil tidak dapat masuk ketika Fase 4 aktif.
- Admin dapat input, edit, hapus, merge, import, dan export.
- Koordinator hanya melihat serta mengisi lokasi miliknya.
- Dua pengiriman batch yang sama hanya menghasilkan satu absensi.
- Relawan baru dan log-nya sama-sama tersimpan atau sama-sama batal.
- POST/PATCH/DELETE menampilkan hasil yang sesuai kondisi database.
- Logout tidak menampilkan data API dari cache saat perangkat offline.

## Batas verifikasi lokal

`npm test` memeriksa sintaks JavaScript, kontrak frontend/RPC, parser CSV,
service worker, dan pagar keamanan migrasi. Keberhasilan test lokal bukan bukti
migrasi Supabase produksi sudah diterapkan atau alur terautentikasi sudah lulus.
