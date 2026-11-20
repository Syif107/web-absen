# Migrasi database ke PC server Linux kantor

Paket ini memindahkan database dari **Supabase cloud** ke **PC Linux kantor**
tanpa mengubah logika aplikasi. Web absen tetap di **GitHub Pages**; yang
berpindah adalah database, Auth, dan REST API.

```
HP/PC kantor (Tailscale)
        │  https://<pc-server>.<tailnet>.ts.net
        ▼
   Caddy (127.0.0.1:8080)
        ├── /auth/v1/*  → GoTrue
        └── /rest/v1/*  → PostgREST → PostgreSQL
                                            ▲
GitHub Pages (web absen) ──── fetch ────────┘
```

Yang dipakai hanya komponen yang benar-benar dibutuhkan aplikasi:
PostgreSQL, GoTrue (Auth), PostgREST, dan Caddy. Storage/Realtime/Studio tidak
diaktifkan supaya ringan.

> Semua perintah di bawah dijalankan dari **root repo** (`web-absen`),
> kecuali ditulis lain. Buka satu terminal dan definisikan helper:

```bash
dc() { docker compose --env-file deploy/.env -f deploy/docker-compose.yml "$@"; }
```

Jika terminal ditutup, definisikan ulang `dc` sebelum memakai perintah Compose.

---

## 0. Prasyarat

**PC server**
- Ubuntu 22.04/24.04 atau Debian 12 (atau distro Linux lain dengan Docker).
- Docker Engine + plugin Compose v2.
- RAM minimal 2 GB (disarankan 4 GB), disk kosong minimal 3x ukuran database.
- Tailscale sudah login dan **HTTPS certificate** diaktifkan di admin console
  Tailscale (menu DNS → HTTPS Certificates).
- Di admin console Tailscale, **nonaktifkan key expiry** untuk node server agar
  koneksi tidak putus setelah masa berlaku key habis.
- PC tidak boleh sleep/hibernate karena menjadi server 24 jam.

**Perangkat pengguna**
- Setiap HP/PC yang membuka web absen harus terpasang Tailscale dan login ke
  tailnet yang sama. Tanpa Tailscale, alamat `*.ts.net` tidak bisa dibuka.

**Akun Supabase**
- Connection string database (Session pooler) dari Dashboard → Connect.
- Password database. Jangan pakai port 6543 (transaction pooler) untuk dump.

**Komputer penyiapan**
- Node.js 20+ untuk `generate-keys.mjs` dan `set-frontend-endpoint.mjs`
  (boleh dijalankan di PC dev, tidak harus di server).
- `python3` di server untuk skrip `buat-akun.sh` (Ubuntu sudah menyediakan).

---

## 1. Siapkan server

Matikan sleep agar server selalu hidup:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

Pastikan Docker hidup otomatis setelah reboot:

```bash
sudo systemctl enable --now docker
```

Cek Tailscale:

```bash
tailscale status
```

Aktifkan HTTPS untuk node ini (butuh HTTPS certificate aktif di admin console).
`tailscale serve` umumnya butuh root:

```bash
sudo tailscale serve --bg http://127.0.0.1:8080
sudo tailscale serve status
```

Alamat yang dipakai frontend adalah hostname Tailscale node, misalnya
`https://relawansync.tailxxxx.ts.net`. Tailscale yang memasang sertifikat TLS;
Caddy hanya mendengarkan HTTP di localhost.

> `tailscale serve` hanya bisa diakses anggota tailnet. Ini disengaja agar
> database tidak terbuka ke internet. Pada Tailscale versi lama, sintaksnya:
> `sudo tailscale serve https / http://127.0.0.1:8080`.

---

## 2. Konfigurasi `.env`

Dari root repo:

```bash
cp deploy/.env.example deploy/.env
node deploy/scripts/generate-keys.mjs --write
chmod 600 deploy/.env
nano deploy/.env
```

Isi minimal:

| Variabel | Contoh | Keterangan |
|---|---|---|
| `POSTGRES_PASSWORD` | (otomatis) | jangan diganti setelah database dibuat |
| `JWT_SECRET` | (otomatis) | harus sama untuk Auth & PostgREST |
| `ANON_KEY` | (otomatis) | dipasang di frontend |
| `SERVICE_ROLE_KEY` | (otomatis) | rahasia, jangan masuk frontend |
| `API_EXTERNAL_URL` | `https://relawansync.tailxxxx.ts.net` | URL Tailscale, tanpa `/` di akhir |
| `SITE_URL` | `https://nama-akun.github.io/web-absen` | URL lengkap web absen |
| `CORS_ORIGIN` | `https://nama-akun.github.io` | origin saja, tanpa path/`/` di akhir |
| `DISABLE_SIGNUP` | `true` | cegah pendaftaran publik |

Catatan:

- `CORS_ORIGIN=*` boleh untuk uji awal, tetapi untuk produksi isi origin
  GitHub Pages yang persis.
- Origin berbeda dengan URL lengkap: `CORS_ORIGIN` tidak boleh berisi
  `/web-absen`.
- Password database sebaiknya hanya huruf/angka karena dipakai di URL koneksi.
- Samakan `POSTGRES_IMAGE` dengan major version Supabase sumber
  (`select version();` di SQL Editor Supabase). Default sudah PG 17.

---

## 3. Jalankan stack

```bash
dc up -d
dc ps
```

Tunggu sampai `relawansync-db` dan `relawansync-auth` berstatus healthy, lalu:

```bash
curl http://127.0.0.1:8080/auth/v1/health
curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/rest/v1/
```

Keduanya harus merespons sukses (REST biasanya `200`).

Cek dari perangkat lain yang ada di tailnet:

```bash
curl https://relawansync.tailxxxx.ts.net/auth/v1/health
```

---

## 4. Dump dari Supabase

Jalankan di server (butuh internet):

```bash
export SUPABASE_DB_URL='postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
bash deploy/scripts/dump-supabase.sh
```

> Lakukan dump final di jam sepi dan hentikan input sementara. Setelah dump,
> jangan ada penulisan ke Supabase lama sampai frontend diarahkan ke server baru.
> Tulisan yang masuk setelah dump tidak akan ikut ke server baru.

Hasil tersimpan di `deploy/backup/supabase-YYYYmmdd-HHMMSS/`:

- `public.dump` — skema + data `public`
- `auth_users.sql` — akun login (`auth.users`, `auth.identities`)
- `extensions.txt`, `counts.txt`, `versi.txt`, `manifest.txt`

Jika `pg_dump` lokal tidak ada, skrip otomatis memakai container
`postgres:17`. Jika `pg_dump` lokal ada tetapi versinya lebih lama dari server
Supabase, paksa container dengan `PG_DUMP_MODE=docker`. Jika database Supabase
sudah PostgreSQL 18, jalankan dengan `PG_CLIENT_IMAGE=postgres:18`. Jangan lupa
membandingkan `counts.txt` dengan hasil verifikasi nanti.

---

## 5. Restore ke server

```bash
bash deploy/scripts/restore-server.sh deploy/backup/supabase-YYYYmmdd-HHMMSS
```

Urutan yang dilakukan skrip:

1. menyalakan Postgres + GoTrue agar skema `auth` dibuat;
2. restore `auth.users` + `auth.identities`;
3. restore schema `public` (FK `public.profil → auth.users` sudah aman);
4. menerapkan grant/revoke;
5. menjalankan `verifikasi.sql`.

Jika ingin mengulang dari database kosong:

```bash
dc down
docker volume rm relawansync_db_data relawansync_db_config
dc up -d db auth
bash deploy/scripts/restore-server.sh deploy/backup/supabase-YYYYmmdd-HHMMSS
```

> `docker volume rm` menghapus seluruh data di server. Hanya lakukan pada
> database yang memang belum dipakai. `dc down` tanpa `-v` tidak menghapus
> volume.

Setelah restore, **jangan menjalankan file `db/*.sql`** di server baru. Dump
sudah membawa skema, view, fungsi, RLS, dan data. Menjalankan migrasi ulang bisa
memicu bootstrap Fase 15 dan gagal karena jumlah akun tidak lagi satu.

---

## 6. Verifikasi

```bash
dc exec -T db psql -U postgres -d postgres < deploy/scripts/verifikasi.sql
```

Semua bagian berikut **harus bernilai 0 / kosong**:

- tabel `public` tanpa RLS;
- policy `anon` terbuka;
- profil tanpa auth user;
- `tidak_konsisten` pada audit personel v3.

Periksa juga:

- jumlah `master_relawan` dan `log_absensi` sama dengan `counts.txt`;
- view, fungsi, dan fungsi bantuan `auth.uid/role/jwt` berstatus `OK`;
- `anon_select` dan `anon_bisa` bernilai `false`;
- `service_role` punya `rolbypassrls = true`;
- ada akun admin di `public.profil`;
- FK `public.profil → auth.users` ada.

Jika ada yang gagal, jangan lanjut ke cutover.

---

## 6b. Membuat akun koordinator/admin baru

Akun hasil migrasi tidak perlu dibuat ulang. Untuk petugas baru:

```bash
bash deploy/scripts/buat-akun.sh \
  --email koordinator@contoh.org \
  --password 'kata-sandi-kuat' \
  --nama 'Nama Koordinator' \
  --role koordinator \
  --lokasi 'Proyek A'
```

Admin cukup `--role admin` tanpa `--lokasi`. Skrip memakai GoTrue Admin API
dan langsung mengisi `public.profil`. Jika dijalankan dari mesin lain yang ada
di tailnet, tambahkan `--base https://relawansync.tailxxxx.ts.net`.

> `DISABLE_SIGNUP=true` hanya mematikan pendaftaran publik. Pembuatan akun
> lewat Admin API dengan `SERVICE_ROLE_KEY` tetap boleh.

---

## 7. Uji login dan API

Ambil `ANON_KEY` dari `deploy/.env`, lalu:

```bash
BASE=https://relawansync.tailxxxx.ts.net
ANON_KEY='eyJ...'

curl -s "$BASE/auth/v1/health"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/rest/v1/" -H "apikey: $ANON_KEY"

read -rsp 'Password: ' PW
curl -s -X POST "$BASE/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@contoh.org\",\"password\":\"$PW\"}"
```

Salin `access_token`, lalu uji baca profil:

```bash
TOKEN='...'
curl -s "$BASE/rest/v1/profil?select=role,lokasi_proyek&limit=1" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $TOKEN"
```

Hasilnya harus memuat `role: admin`. Uji juga satu RPC, misalnya
`proses_mutasi_stok_terjadwal`.

---

## 8. Cutover frontend

Frontend tetap di GitHub Pages. Lakukan cutover di jam sepi. Hanya dua
konstanta yang berubah, plus versi cache service worker agar browser mengambil
config baru:

```bash
node deploy/scripts/set-frontend-endpoint.mjs \
  --url https://relawansync.tailxxxx.ts.net \
  --anon-key 'eyJ...'

npm test
git add js/supabase-config.js sw.js tests/hardening.test.mjs
git commit -m "Arahkan frontend ke database server kantor"
git push
```

Setelah GitHub Pages selesai deploy:

0. minta semua pengguna **login ulang** dan **tutup tab lama** — token lama
   ditandatangani JWT_SECRET Supabase, bukan server baru, dan tab lama masih
   menulis ke Supabase cloud;
1. buka web dua kali;
2. pastikan service worker baru aktif (DevTools → Application → Service Workers);
3. login, buka Dashboard, Input, Riwayat, Kalender, Statistik, Peringkat,
   Master, dan Seragam;
4. uji input absensi, edit, hapus, import, ekspor, dan satu transaksi seragam.

Selama masa uji, **jangan menulis data baru ke Supabase lama** agar rollback
tetap bersih.

---

## 9. Backup harian

```bash
sudo cp deploy/systemd/absensi-backup.service /etc/systemd/system/
sudo cp deploy/systemd/absensi-backup.timer /etc/systemd/system/
sudo nano /etc/systemd/system/absensi-backup.service   # sesuaikan path repo
sudo systemctl daemon-reload
sudo systemctl enable --now absensi-backup.timer
```

Uji sekali:

```bash
sudo systemctl start absensi-backup.service
sudo journalctl -u absensi-backup.service -n 50 --no-pager
ls -lh deploy/backup/harian/
```

Default retensi 14 hari. Sangat disarankan menyalin backup ke disk/NAS lain
dengan menambahkan `Environment=BACKUP_SALINAN=/mnt/nas/relawansync` pada unit
systemd.

---

## 10. Rollback

Frontend dan database lama masih bisa dipakai kembali:

```bash
node deploy/scripts/set-frontend-endpoint.mjs \
  --url https://PROJECT_REF.supabase.co \
  --anon-key 'SUPABASE_ANON_KEY'

npm test
git add js/supabase-config.js sw.js tests/hardening.test.mjs
git commit -m "Rollback ke Supabase cloud"
git push
```

Jangan hapus atau pause project Supabase sebelum sistem baru stabil minimal
2–4 minggu. Free tier dapat pause otomatis karena tidak ada aktivitas; siapkan
langkah unpause bila rollback sewaktu-waktu dibutuhkan. Jika sudah ada tulisan
baru di server selama uji, ekspor data tersebut dulu sebelum rollback agar tidak
hilang.

---

## 11. Troubleshooting

**CORS error di browser**
`CORS_ORIGIN` harus origin persis (`https://nama-akun.github.io`), tanpa path
dan tanpa `/` di akhir. Setelah mengubah `.env`:

```bash
dc up -d --force-recreate caddy
```

**Mixed content / request diblokir**
Frontend GitHub Pages berjalan di HTTPS. `SUPABASE_URL` wajib
`https://...ts.net`, bukan `http://IP-LAN`.

**Tailscale serve gagal / sertifikat tidak terbit**
Aktifkan HTTPS Certificates di admin console Tailscale, lalu:

```bash
sudo tailscale serve reset
sudo tailscale serve --bg http://127.0.0.1:8080
sudo tailscale serve status
```

**`relation "auth.users" does not exist`**
GoTrue belum selesai migrasi. Cek:

```bash
dc logs auth
dc restart auth
```

**`password authentication failed for user "authenticator"`**
`POSTGRES_PASSWORD` berubah setelah volume database dibuat. `db/roles.sql` hanya
berjalan saat inisialisasi pertama. Jika data belum penting, hapus volume lalu
restore ulang (lihat bagian 5). Jika data sudah ada, samakan password role:

```bash
dc exec db psql -U postgres -c "ALTER USER authenticator WITH PASSWORD 'PASSWORD_BARU';"
dc exec db psql -U postgres -c "ALTER USER supabase_auth_admin WITH PASSWORD 'PASSWORD_BARU';"
dc restart auth rest
```

**`pg_restore: role "..." does not exist`**
Dump tidak dibuat dengan `--no-owner`. Gunakan `dump-supabase.sh`, jangan
`pg_dump` manual tanpa flag tersebut.

**Restore `auth.users` gagal: kolom tidak ada**
Versi GoTrue self-host berbeda dengan Supabase cloud. Samakan `AUTH_IMAGE` di
`.env` dengan versi cloud, atau buat ulang akun memakai `buat-akun.sh` lalu
sesuaikan `public.profil`. Jangan hapus dump sebelum berhasil.

**Login 401 setelah restore**
Pastikan `JWT_SECRET` tidak berubah setelah `generate-keys.mjs --write`. Kalau
berubah, jalankan ulang `generate-keys.mjs --write`, lalu:

```bash
dc up -d --force-recreate auth rest
```

**Data kosong padahal login berhasil**
Request harus memakai access token user, bukan anon key. RLS memblokir `anon`
dengan sengaja.

**Frontend masih memakai URL lama**
Cache service worker belum berganti. Pastikan `sw.js` sudah versi baru setelah
cutover, buka aplikasi dua kali, atau Clear Site Data di DevTools.

**`pg_dump: server version ... pg_dump version ...`**
Versi client lokal lebih lama dari server. Paksa container:

```bash
PG_DUMP_MODE=docker bash deploy/scripts/dump-supabase.sh
```

atau instal `postgresql-client-17`.

---

## 12. Keamanan dan operasional

- `.env` berisi rahasia; izin `600`, jangan pernah di-commit.
- Port database (5432), Auth (9999), dan PostgREST (3000) **tidak** dipublish
  ke host. Hanya Caddy di `127.0.0.1:8080`.
- Batasi akses tailnet dengan ACL, misalnya hanya grup petugas yang boleh
  mengakses port 443 node server.
- `DISABLE_SIGNUP=true`; akun baru dibuat lewat `buat-akun.sh`.
- `ANON_KEY` memang publik (dipakai browser). Keamanan data bergantung pada RLS,
  bukan pada kerahasiaan anon key. `SERVICE_ROLE_KEY` wajib dirahasiakan.
- Sebelum update image, jalankan backup dan uji di jam sepi:

```bash
mkdir -p deploy/backup
dc exec -T db pg_dump -U postgres -d postgres --schema=public \
  --format=custom --no-owner --no-privileges \
  --no-publications --no-subscriptions > deploy/backup/sebelum-update.dump
dc pull
dc up -d
```

- Pantau disk dan log:

```bash
df -h
dc logs --tail=100
docker stats --no-stream
```

---

## 13. Yang berubah di frontend

Hanya saat cutover:

| File | Perubahan |
|---|---|
| `js/supabase-config.js` | `SUPABASE_URL` dan `SUPABASE_ANON_KEY` |
| `sw.js` | nama cache dinaikkan agar config baru dipakai |
| `tests/hardening.test.mjs` | assertion nama cache disesuaikan |

Skrip `set-frontend-endpoint.mjs` mengerjakan ketiganya sekaligus. Logika
aplikasi, nama tabel, RPC, dan tampilan tidak berubah.
