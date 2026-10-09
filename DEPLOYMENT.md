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
`relawansync-v27-integritas-operasional-cache` aktif.

Script migrasi disimpan di repository untuk audit dan pengulangan. Terapkan dan
verifikasi database lebih dahulu, kemudian frontend, agar kontrak view/RPC tetap
cocok.

## Fase 7: Rincian proyek dan perapian personel

Fase 7 menambahkan `db/fase7_operasional_optimasi.sql`. Jalankan setelah Fase 6
untuk membuat:

- rincian kehadiran per nama proyek (`v_kehadiran_proyek_personel`) sehingga
  filter dapat memilih gabungan 5 proyek, proyek individual, atau proyek lain;
- ringkasan satu baris per personel (`v_ringkasan_personel`) untuk jumlah global,
  jumlah per wilayah, urutan nama/kehadiran/persentase/tanggal pertama/ID;
- indikator penerima seragam yang tidak hadir lebih dari 30 hari
  (`v_status_seragam_operasional`).

Migrasi ini hanya menambah index/view dan hak baca terautentikasi. Tidak ada
riwayat absensi yang dihapus atau diubah.

Setelah Fase 7, cache frontend menggunakan
`relawansync-v27-integritas-operasional-cache`.

## Fase 8: Perapian Master Data

Fase 8 menambahkan `db/fase8_master_data_rapi.sql` dan alur Rapikan Master.
Sistem hanya menawarkan merge untuk pasangan dengan nama dan asal organisasi
yang sama setelah normalisasi huruf besar dan spasi. Nama sama dengan asal
berbeda, nama berbeda, atau asal kosong tetap dipisahkan.

Fase ini juga mengklasifikasikan hanya organisasi yang persis `PUSAT` sebagai
Jombang, serta menyatukan istilah jabatan `PJ` dan `Admin` menjadi
`PJ / Admin`. `DPD JOMBANG` atau `Jombang` tidak otomatis diperlakukan sebagai
Pusat.

## Fase 9: Merge Manual dari Checkbox

Fase 9 menambahkan `db/fase9_merge_manual_terpilih.sql`. Admin dapat memilih
minimal dua profil dari tabel Master Data, menentukan ID yang dipertahankan,
dan mengatur seluruh data akhir sebelum merge. Operasi berjalan dalam satu
transaksi; riwayat hadir yang sama pada tanggal, sesi, dan proyek yang sama
disatukan agar tidak menggandakan jumlah kehadiran.

RPC `merge_relawan` tetap menjadi jalur aman untuk Rapikan otomatis dan hanya
menerima nama + organisasi yang sama. Pengecualian lintas nama/organisasi hanya
tersedia lewat `merge_relawan_manual`, memerlukan akun admin, pilihan checkbox,
pengaturan data akhir, dan konfirmasi. Tidak ada merge otomatis saat halaman
dibuka.

## Fase 10: Koreksi kehadiran, identitas kabupaten, dan stok seragam set

Fase 10 menambahkan `db/fase10_koreksi_stok_dan_deduplikasi.sql`. Jalankan
setelah Fase 9. Migrasi ini membuat backup baru sebelum perubahan dan tidak
melakukan merge personel secara otomatis. Fitur yang diaktifkan:

- nama identik setelah normalisasi huruf/tanda baca dikelompokkan berdasarkan
  kabupaten; perbedaan satu huruf hanya menjadi kandidat tinjauan manual;
- `PUSAT` dipetakan ke Jombang tetapi tetap berbeda dari `DPD JOMBANG` sebagai
  organisasi; DPC/desa/kecamatan yang telah diverifikasi dipetakan ke kabupaten;
- koreksi kehadiran bulanan dapat menambah atau menghapus sesi Pagi/Malam dengan
  alasan audit wajib;
- kredit historis untuk kehadiran tanpa tanggal pasti menambah hari kumulatif,
  tetapi tidak memalsukan sesi, streak, atau persentase 90 hari;
- peringkat umum memakai satu baris per NIP sehingga orang yang sama tidak
  muncul dua kali pada tampilan “Semua Proyek”;
- stok dipisah menjadi atasan (S, M, L, dan seterusnya) dan bawahan (nomor),
  serta seluruh masuk/keluar/koreksi disimpan sebagai mutasi;
- penyerahan baru mengurangi satu atasan dan satu bawahan secara atomik.

Setelah migrasi, jalankan query verifikasi di bagian akhir file. Periksa hasil
pemetaan organisasi sebelum memakai tombol “Gabungkan Semua Aman”; kandidat
beda satu huruf harus tetap ditinjau satu per satu.

## Status flag frontend

`FASE5_ENABLED`, `FASE14_ENABLED`, dan `FASE4_ENABLED` aktif. Fase 14 tetap
menyediakan RPC dua-parameter sebagai jembatan agar frontend lama tidak rusak
selama jeda publikasi. Fase 15 telah diterapkan pada 4 Oktober 2026 dan satu
akun Auth yang ada berhasil diverifikasi sebagai admin.

## Fase 11: Perapian aman Master dan kehadiran yatim

`db/fase11_perapian_aman_master.sql` dapat dijalankan setelah Fase 9 dan tidak
bergantung pada kolom Fase 10. Migrasi membuat backup baru, membakukan huruf,
spasi, alias organisasi yang tidak ambigu, serta istilah `PJ / Admin`.

Kehadiran dengan NIP yang sudah tidak ada hanya ditautkan kembali ketika nama
dan organisasinya menghasilkan tepat satu profil. Jika target
sudah mempunyai tanggal, sesi, dan lokasi yang sama, baris yatim tidak dihapus
dan tetap menunggu tinjauan manual. Migrasi ini tidak menggabungkan nama yang
hanya mirip, tidak menghapus profil, dan tidak menghapus riwayat absensi.

## Fase 12–13: Merge terkontrol, riwayat pisah, organisasi, dan zona

Fase 12 menjalankan pilihan merge kandidat yang telah ditinjau. Fase 13
menyimpan snapshot setiap batch merge agar profil dapat dipisahkan kembali,
menambahkan pengelolaan organisasi, serta menjadikan `zona_asal` sebagai sumber
empat zona: Zona 1 Jawa Timur/Bali; Zona 2 Jawa Tengah/DIY; Zona 3 Jawa Barat,
Jakarta/Banten; dan Zona 4 Sumatera/Kalimantan.

## Fase 14: Integritas operasional dan performa

`db/fase14_integritas_operasional.sql` tidak menghapus arsip mentah. Migrasi
menambahkan view absensi kanonis (satu NIP/tanggal/sesi/lokasi), audit jumlah
duplikat dan log yatim, pagar duplikat baru, RPC input atomik yang tetap
kompatibel dengan frontend lama, zona tunggal untuk ranking/reward, serta
pagination server-side untuk Peringkat dan Kontrol Seragam.

Dashboard, Kalender, Statistik, Riwayat, dan export memakai view kanonis.
Peringkat dan seragam menarik maksimal 50 baris per halaman. CSS Tailwind
dibangun lokal dengan `npm run build:css`, bukan CDN runtime.

## Fase 15: Multi-user aman

`db/fase15_multi_user_aman.sql` telah diterapkan pada produksi. Bootstrap hanya
berjalan bila Supabase Auth tepat memiliki satu akun, lalu menjadikannya admin.
Akun tanpa profil menjadi `blocked` dan koordinator hanya dapat
membaca/mencatat absensi pada lokasi yang ditetapkan. Pemeriksaan pascamigrasi
menemukan 1 admin, 26 policy RLS aktif, dan 0 policy terbuka tanpa syarat.

## Fase 16: RPC admin cepat dan tetap tertutup

`db/fase16_performa_rpc_aman.sql` telah diterapkan pada produksi. Migrasi ini
memperbaiki timeout Peringkat dan Kontrol Seragam pada akun admin tanpa
mengendurkan RLS: jalur cepat hanya aktif setelah `akun_role()` terverifikasi
sebagai `admin`, koordinator tetap memakai jalur `SECURITY INVOKER`, dan akun
tanpa profil tetap ditolak. Uji produksi mengembalikan 1.660 data, tepat 50
baris pada tiap halaman pertama Peringkat dan Seragam, sedangkan akun uji tanpa
profil menerima penolakan `Akun tidak memiliki akses`. Hak `EXECUTE` anonim
pada seluruh fungsi schema `public` juga dicabut, termasuk default untuk fungsi
baru, karena aplikasi ini mewajibkan login.

## Fase 17–19: Personel khusus, stok bertanggal, zona, dan peringkat cepat

Jalankan berurutan `db/fase17_personel_khusus_stok_massal.sql`,
`db/fase18_penerapan_zona_otomatis.sql`, lalu
`db/fase19_performa_peringkat_reguler.sql`. Rangkaian ini menambahkan personel
khusus di luar aturan kehadiran/ranking, stok seragam massal dan bertanggal,
empat zona asal, detail profil, hapus permanen bertingkat, dan router peringkat
yang hanya menghitung personel reguler.

## Fase 20: Kontrak data terpadu lintas-menu

`db/fase20_penyeragaman_sistem.sql` wajib diterapkan sebelum frontend versi
cache 31 dipublikasikan. Migrasi ini membuat backup Fase 20, memakai satu
resolver kabupaten/provinsi/zona, menyatukan ukuran atasan dan bawahan antara
Master dan Kontrol Seragam, serta menyediakan sumber profil
`v_personel_terpadu_v3` untuk Master, Input, Dashboard, Statistik, Riwayat,
Peringkat, Seragam, detail, dan ekspor.

Personel khusus tetap terlihat di Master dan Kontrol Seragam, tetapi tidak
masuk pilihan absensi normal, statistik kehadiran, atau ranking. Transaksi stok
terjadwal diproses saat admin membuka menu mana pun. Ekspor Kontrol Seragam
mengambil seluruh hasil filter dari server, bukan hanya 50 baris yang sedang
terlihat. Gunakan `v_audit_konsistensi_personel_v3` setelah migrasi; hasil
`tidak_konsisten` harus nol sebelum rilis frontend.

## Fase 21: Kontrol daftar terpadu

`db/fase21_kontrol_daftar_terpadu.sql` telah diterapkan pada produksi tanggal
8 Oktober 2026 setelah Fase 20. Migrasi ini
menambahkan RPC Peringkat dan Kontrol Seragam versi 3 agar pencarian, filter,
pengurutan, jumlah baris 25/50/100/200, dan pagination dihitung terhadap
seluruh hasil di server—bukan hanya baris pada halaman aktif. Jalur admin tetap
memakai router cepat terverifikasi; koordinator tetap dibatasi RLS; anon tidak
mendapat hak eksekusi.

Verifikasi produksi mengembalikan `true` untuk keberadaan kedua RPC, router
invoker, serta hak `authenticated`; hak `anon` untuk keduanya mengembalikan
`false`.

Frontend cache 32 memakai pola kontrol daftar yang sama pada Master Data,
Peringkat, Kontrol Seragam, Statistik, dan Riwayat: **Cari → filter khusus →
urutkan → jumlah baris → Reset**. Ekspor dan cetak Riwayat memakai seluruh
hasil terfilter, meskipun tabel sedang menampilkan satu halaman saja.

## Urutan rilis

1. Pastikan branch dan commit yang akan dirilis sudah ditetapkan.
2. Unduh backup `master_relawan` dan `log_absensi` dari Supabase.
3. Di Supabase Authentication, nonaktifkan pendaftaran akun publik.
4. Jalankan `db/audit_duplikat.sql` (read-only).
5. Bila hasil audit mempunyai baris, tinjau dan gabungkan data secara manual.
6. Jalankan `db/fase5_integritas_transaksi.sql`.
7. Jalankan migrasi berurutan sampai Fase 21. Fase 21 harus selesai sebelum frontend versi cache 32 dipublikasikan.
8. Uji input relawan lama, relawan baru, filter proyek, direktori, perapian duplikat, merge dari checkbox, edit wilayah, koreksi kehadiran, kredit historis, dan mutasi stok atasan–bawahan menggunakan akun admin.
9. Jika multi-user akan digunakan:
   - jalankan `db/fase15_multi_user_aman.sql` hanya setelah mengonfirmasi perubahan hak akses;
   - jalankan `db/fase16_performa_rpc_aman.sql` setelah Fase 15;
   - buat profil koordinator dengan lokasi yang benar;
   - verifikasi akun tanpa profil ditolak;
   - ubah `FASE4_ENABLED` di `js/supabase-config.js` menjadi `true`.
10. Jalankan `npm install`, `npm run build:css`, dan `npm test`, lalu deploy frontend.
11. Buka ulang aplikasi dua kali agar service worker versi baru mengambil alih,
    kemudian pastikan `relawansync-v32-kontrol-daftar-cache` aktif dan cache lama sudah terhapus.

## Smoke test wajib

- Anonim tidak dapat membaca Master atau log.
- Akun tanpa profil tidak dapat masuk ketika Fase 4 aktif.
- Admin dapat input, edit, hapus, merge, import, dan export.
- Koreksi kehadiran menambah/menghapus hanya sesi yang dipilih dan tercatat
  dalam `koreksi_kehadiran_batch`.
- Kredit historis menaikkan total hari kelayakan tanpa menaikkan total sesi.
- Penyerahan seragam baru gagal seluruhnya bila stok atasan atau bawahan kosong.
- Setiap transaksi stok menghasilkan saldo dan baris mutasi yang sesuai.
- Koordinator hanya melihat serta mengisi lokasi miliknya.
- Dua pengiriman batch yang sama hanya menghasilkan satu absensi.
- Relawan baru dan log-nya sama-sama tersimpan atau sama-sama batal.
- Personel khusus terlihat di Master/Seragam tetapi tidak muncul di Input,
  Statistik, Dashboard kehadiran, atau Peringkat.
- Zona, kabupaten, kategori wilayah, ukuran atasan, dan ukuran bawahan konsisten
  pada Master, detail personel, Peringkat, dan Kontrol Seragam.
- Ekspor Kontrol Seragam memuat seluruh hasil filter meski jumlahnya lebih dari
  satu halaman.
- Master, Peringkat, Seragam, Statistik, dan Riwayat memiliki urutan kontrol
  Cari → filter → urutkan → jumlah baris → Reset; pindah halaman tidak mengubah
  hasil pengurutan.
- Ekspor CSV/XLSX dan cetak Riwayat memuat seluruh hasil filter, bukan hanya
  halaman yang sedang terlihat.
- POST/PATCH/DELETE menampilkan hasil yang sesuai kondisi database.
- Logout tidak menampilkan data API dari cache saat perangkat offline.

## Batas verifikasi lokal

`npm test` memeriksa sintaks JavaScript, kontrak frontend/RPC, sumber absensi
kanonis, CSS produksi, service worker, parser CSV, dan pagar keamanan migrasi.
Keberhasilan test lokal bukan bukti
migrasi Supabase produksi sudah diterapkan atau alur terautentikasi sudah lulus.
