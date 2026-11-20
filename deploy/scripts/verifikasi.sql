-- ============================================================
-- Verifikasi setelah restore.
-- Jalankan:
--   docker compose exec -T db psql -U postgres -d postgres \
--     < deploy/scripts/verifikasi.sql
--
-- Semua bagian "harus 0" wajib bernilai 0 sebelum cutover frontend.
-- ============================================================

\pset pager off
\echo '=== 1. Identitas database ==='
SELECT current_database() AS database, current_user AS pengguna, version();

\echo ''
\echo '=== 2. Jumlah data ==='
SELECT 'master_relawan' AS tabel, count(*) AS baris FROM public.master_relawan
UNION ALL SELECT 'log_absensi', count(*) FROM public.log_absensi
UNION ALL SELECT 'profil', count(*) FROM public.profil
UNION ALL SELECT 'seragam_penerima', count(*) FROM public.seragam_penerima
UNION ALL SELECT 'mutasi_stok_seragam', count(*) FROM public.mutasi_stok_seragam
UNION ALL SELECT 'auth_users', count(*) FROM auth.users
UNION ALL SELECT 'auth_identities', count(*) FROM auth.identities
ORDER BY 1;

\echo ''
\echo '=== 3. Tabel public tanpa RLS (harus 0 baris) ==='
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public' AND NOT rowsecurity
ORDER BY 1;

\echo ''
\echo '=== 4. Policy per tabel ==='
SELECT tablename,
       count(*) AS jumlah_policy,
       count(*) FILTER (WHERE 'anon'::name = ANY (roles)) AS policy_anon
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '=== 5. Policy anon terbuka (harus 0 baris) ==='
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND 'anon'::name = ANY (roles)
  AND coalesce(qual, 'true') = 'true'
  AND coalesce(with_check, 'true') = 'true'
ORDER BY 1, 2;

\echo ''
\echo '=== 6. View wajib ==='
WITH harap(nama) AS (
    VALUES
        ('v_personel_terpadu_v3'),
        ('v_log_absensi_operasional'),
        ('v_daftar_proyek_absensi'),
        ('v_organisasi_admin'),
        ('v_riwayat_merge_personel'),
        ('v_status_seragam_set_v2'),
        ('v_audit_konsistensi_personel_v3'),
        ('v_audit_kualitas_absensi')
)
SELECT h.nama,
       CASE WHEN c.relkind = 'v' THEN 'OK' ELSE 'HILANG' END AS status
FROM harap h
LEFT JOIN pg_class c
       ON c.relname = h.nama
      AND c.relnamespace = 'public'::regnamespace
ORDER BY 1;

\echo ''
\echo '=== 7. Fungsi wajib ==='
WITH harap(nama) AS (
    VALUES
        ('insert_absensi_batch'),
        ('merge_relawan'),
        ('merge_relawan_terpadu_v3'),
        ('gabungkan_semua_kandidat_mirip'),
        ('pratinjau_hapus_personel'),
        ('hapus_personel_permanen'),
        ('simpan_personel_v3'),
        ('sinkronkan_zona_otomatis'),
        ('simpan_organisasi'),
        ('hapus_organisasi'),
        ('merge_organisasi'),
        ('pisahkan_merge_personel'),
        ('import_master_batch'),
        ('detail_personel_v3'),
        ('daftar_peringkat_v3'),
        ('daftar_peringkat_v2'),
        ('daftar_seragam_v3'),
        ('daftar_seragam_v2'),
        ('simpan_koreksi_kehadiran'),
        ('simpan_kehadiran_historis'),
        ('simpan_status_seragam_set_v2'),
        ('tambah_jenis_ukuran_seragam'),
        ('catat_mutasi_stok_batch_v2'),
        ('ubah_tanggal_mutasi_stok'),
        ('hapus_mutasi_stok_permanen'),
        ('proses_mutasi_stok_terjadwal'),
        ('akun_role'),
        ('akun_lokasi')
)
SELECT h.nama,
       count(p.oid) AS varian,
       CASE WHEN count(p.oid) > 0 THEN 'OK' ELSE 'HILANG' END AS status
FROM harap h
LEFT JOIN pg_proc p
       ON p.proname = h.nama
      AND p.pronamespace = 'public'::regnamespace
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '=== 8. Hak tabel: anon_select harus false semua ==='
SELECT c.relname,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind = 'r'
ORDER BY 1;

\echo ''
\echo '=== 9. Hak fungsi: anon_bisa harus false semua ==='
SELECT p.oid::regprocedure::text AS fungsi,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_bisa,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_bisa
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN (
      'insert_absensi_batch',
      'daftar_peringkat_v3',
      'daftar_peringkat_v2',
      'daftar_seragam_v3',
      'daftar_seragam_v2',
      'simpan_personel_v3',
      'merge_relawan_terpadu_v3',
      'detail_personel_v3',
      'simpan_koreksi_kehadiran',
      'catat_mutasi_stok_batch_v2'
  )
ORDER BY 1;

\echo ''
\echo '=== 10. Fungsi bantuan auth (harus 3 OK) ==='
WITH harap(nama) AS (VALUES ('uid'), ('role'), ('jwt'))
SELECT h.nama,
       CASE WHEN p.oid IS NULL THEN 'HILANG' ELSE 'OK' END AS status
FROM harap h
LEFT JOIN pg_proc p
       ON p.proname = h.nama
      AND p.pronamespace = 'auth'::regnamespace
ORDER BY 1;

\echo ''
\echo '=== 11. Akun auth dan profil ==='
SELECT count(*) AS auth_users FROM auth.users;

SELECT u.email,
       u.email_confirmed_at IS NOT NULL AS terkonfirmasi,
       p.role,
       p.lokasi_proyek
FROM auth.users u
LEFT JOIN public.profil p ON p.id = u.id
ORDER BY u.created_at;

\echo ''
\echo '=== 12. Profil tanpa auth user (harus 0) ==='
SELECT count(*) AS profil_yatim
FROM public.profil p
LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL;

\echo ''
\echo '=== 13. FK public.profil -> auth.users ==='
SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.profil'::regclass
  AND contype = 'f';

\echo ''
\echo '=== 14. Status role keamanan ==='
SELECT rolname, rolcanlogin, rolbypassrls
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')
ORDER BY 1;

\echo ''
\echo '=== 15. Konsistensi personel v3 ==='
SELECT count(*) FILTER (WHERE NOT konsisten) AS tidak_konsisten,
       count(*) AS total
FROM public.v_audit_konsistensi_personel_v3;

\echo ''
\echo '=== 16. Ringkasan: semua harus 0 ==='
SELECT
    (SELECT count(*) FROM pg_tables
      WHERE schemaname = 'public' AND NOT rowsecurity) AS tabel_tanpa_rls,
    (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND 'anon'::name = ANY (roles)
        AND coalesce(qual, 'true') = 'true'
        AND coalesce(with_check, 'true') = 'true') AS policy_anon_terbuka,
    (SELECT count(*) FROM public.profil p
      LEFT JOIN auth.users u ON u.id = p.id
      WHERE u.id IS NULL) AS profil_yatim;
