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
`relawansync-v24-master-linking-cache` aktif.

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
`relawansync-v24-master-linking-cache`.

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

## Mode frontend saja (Supabase dilewati)

`FASE5_ENABLED` dan `FASE4_ENABLED` di `js/supabase-config.js` dibiarkan
`false`. Dengan konfigurasi ini frontend tetap kompatibel dengan fungsi
database lama. Perbaikan tampilan, escaping data, pagination, parser CSV,
pelaporan error, dan service worker dapat digunakan.

Batasannya: penyimpanan relawan baru bersama absensi dan import CSV belum
atomik, unique constraint baru belum aktif, dan pembatasan admin/koordinator
belum tersedia. Jangan mengubah kedua flag menjadi `true` tanpa menjalankan
migrasi SQL yang sesuai.

## Fase 11: Perapian aman Master dan kehadiran yatim

`db/fase11_perapian_aman_master.sql` dapat dijalankan setelah Fase 9 dan tidak
bergantung pada kolom Fase 10. Migrasi membuat backup baru, membakukan huruf,
spasi, alias organisasi yang tidak ambigu, serta istilah `PJ / Admin`.

Kehadiran dengan NIP yang sudah tidak ada hanya ditautkan kembali ketika nama
dan organisasinya menghasilkan tepat satu profil. Jika target
sudah mempunyai tanggal, sesi, dan lokasi yang sama, baris yatim tidak dihapus
dan tetap menunggu tinjauan manual. Migrasi ini tidak menggabungkan nama yang
hanya mirip, tidak menghapus profil, dan tidak menghapus riwayat absensi.

## Urutan rilis

1. Pastikan branch dan commit yang akan dirilis sudah ditetapkan.
2. Unduh backup `master_relawan` dan `log_absensi` dari Supabase.
3. Di Supabase Authentication, nonaktifkan pendaftaran akun publik.
4. Jalankan `db/audit_duplikat.sql` (read-only).
5. Bila hasil audit mempunyai baris, tinjau dan gabungkan data secara manual.
6. Jalankan `db/fase5_integritas_transaksi.sql`.
7. Jalankan `db/fase6_ranking_seragam.sql`, `db/fase7_operasional_optimasi.sql`, `db/fase8_master_data_rapi.sql`, `db/fase9_merge_manual_terpilih.sql`, `db/fase10_koreksi_stok_dan_deduplikasi.sql`, lalu `db/fase11_perapian_aman_master.sql`.
8. Uji input relawan lama, relawan baru, filter proyek, direktori, perapian duplikat, merge dari checkbox, edit wilayah, koreksi kehadiran, kredit historis, dan mutasi stok atasan–bawahan menggunakan akun admin.
9. Jika multi-user akan digunakan:
   - ganti `GANTI_EMAIL_ADMIN` di `db/fase4_multi_user.sql`;
   - jalankan migrasi tersebut;
   - buat profil koordinator dengan lokasi yang benar;
   - verifikasi akun tanpa profil ditolak;
   - ubah `FASE4_ENABLED` di `js/supabase-config.js` menjadi `true`.
10. Deploy frontend.
11. Buka ulang aplikasi dua kali agar service worker versi baru mengambil alih,
    kemudian pastikan cache lama sebelum `relawansync-v24-master-linking-cache` sudah terhapus.

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
- POST/PATCH/DELETE menampilkan hasil yang sesuai kondisi database.
- Logout tidak menampilkan data API dari cache saat perangkat offline.

## Batas verifikasi lokal

`npm test` memeriksa sintaks JavaScript, kontrak frontend/RPC, parser CSV,
service worker, dan pagar keamanan migrasi. Keberhasilan test lokal bukan bukti
migrasi Supabase produksi sudah diterapkan atau alur terautentikasi sudah lulus.
