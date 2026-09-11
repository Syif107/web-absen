-- =====================================================
-- RELAWANSYNC V2 - FASE 0: FONDASI KEAMANAN
-- =====================================================
-- CARA MENJALANKAN:
--   1. Buka https://supabase.com/dashboard > pilih proyek.
--   2. Klik menu "SQL Editor" di kiri.
--   3. Paste SEMUA isi file ini (dari atas sampai bawah), lalu klik "Run".
--   4. Salin teks yang tampil di output "Cek Hasil", kirimkan ke tim developer
--      untuk konfirmasi migrasi sukses.
--
-- ISI SKRIP INI:
--   A. Mengaktifkan Row Level Security (RLS) pada tabel data
--   B. Kebijakan akses untuk user yang sudah login (role authenticated)
--   C. Index kolom yang sering dipakai query (percepat dashboard/riwayat/kalender)
--   D. Fungsi server: insert_absensi_batch (insert massal + cegah duplikat)
--   E. Fungsi server: merge_relawan (gabung data secara atomik)
--
-- CATATAN PENTING:
--   - Skrip ini TIDAK menghapus atau mengubah data apa pun.
--   - Aman dijalankan ulang (semua pakai IF NOT EXISTS / OR REPLACE / DROP IF EXISTS).
--   - Sebelum dijalankan, pastikan setting Auth "Allow new users to sign up"
--     NONAKTIF di Dashboard > Authentication > Providers > Email.
--     (Kalau masih aktif, siapa pun bisa daftar akun lalu mengakses data.)
-- =====================================================


-- =====================================================
-- A. AKTIFKAN ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE public.master_relawan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.log_absensi ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- B. KEBIJAKAN AKSES (POLICY)
--    User yang sudah login (role authenticated) boleh
--    baca/tulis penuh kedua tabel. Sama seperti perilaku
--    aplikasi sekarang, TAPI kini diblokir untuk yang
--    belum login (anonim).
-- =====================================================
DROP POLICY IF EXISTS "authenticated_all_master" ON public.master_relawan;
CREATE POLICY "authenticated_all_master"
  ON public.master_relawan
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_all_log" ON public.log_absensi;
CREATE POLICY "authenticated_all_log"
  ON public.log_absensi
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- -----------------------------------------------------
-- VARIANT KEBIJAKAN "KETAT" (OPSIONAL, dijalankan NANTI)
-- -----------------------------------------------------
-- Jika kelak ingin membatasi hanya akun-akun tertentu saja
-- (misal saat multi-user koordinator diaktifkan), jalankan blok di
-- bawah ini SETELAH tabel admin panel dibuat:
--
--   CREATE TABLE IF NOT EXISTS public.admin_panel_users (
--     email text PRIMARY KEY,
--     nama  text,
--     role  text NOT NULL DEFAULT 'admin'
--   );
--   -- isi email admin yang sah, contoh:
--   -- INSERT INTO public.admin_panel_users (email, nama, role)
--   -- VALUES ('admin@pengurus.org', 'Admin Pusat', 'admin')
--   -- ON CONFLICT (email) DO NOTHING;
--
--   DROP POLICY IF EXISTS "authenticated_whitelist_master" ON public.master_relawan;
--   CREATE POLICY "authenticated_whitelist_master"
--     ON public.master_relawan FOR ALL TO authenticated
--     USING (auth.jwt()->>'email' IN (SELECT email FROM public.admin_panel_users))
--     WITH CHECK (auth.jwt()->>'email' IN (SELECT email FROM public.admin_panel_users));
--
--   DROP POLICY IF EXISTS "authenticated_whitelist_log" ON public.log_absensi;
--   CREATE POLICY "authenticated_whitelist_log"
--     ON public.log_absensi FOR ALL TO authenticated
--     USING (auth.jwt()->>'email' IN (SELECT email FROM public.admin_panel_users))
--     WITH CHECK (auth.jwt()->>'email' IN (SELECT email FROM public.admin_panel_users));
-- =====================================================


-- =====================================================
-- C. INDEX PERCEPATAN QUERY
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_log_absensi_tanggal ON public.log_absensi (tanggal);
CREATE INDEX IF NOT EXISTS idx_log_absensi_nip     ON public.log_absensi (nip);
CREATE INDEX IF NOT EXISTS idx_log_absensi_nama    ON public.log_absensi (nama);
CREATE INDEX IF NOT EXISTS idx_log_absensi_lokasi  ON public.log_absensi (lokasi);
CREATE INDEX IF NOT EXISTS idx_master_relawan_nip  ON public.master_relawan (nip);
CREATE INDEX IF NOT EXISTS idx_master_relawan_nama ON public.master_relawan (nama);


-- =====================================================
-- D. FUNGSI SERVER: INSERT_ABSENSI_BATCH
--    Insert banyak baris absensi sekaligus dari sisi
--    server. Opsi p_skip_duplikat = true (default)
--    akan melewati baris yang tanggal+sesi+nama+lokasi
--    sudah pernah ada, supaya tidak dobel.
-- =====================================================
CREATE OR REPLACE FUNCTION public.insert_absensi_batch(
    p_logs jsonb,
    p_skip_duplikat boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    item      jsonb;
    inserted  int := 0;
    skipped   int := 0;
    v_tanggal text;
    v_sesi    text;
    v_nama    text;
    v_lokasi  text;
BEGIN
    IF p_logs IS NULL OR jsonb_typeof(p_logs) <> 'array' THEN
        RAISE EXCEPTION 'p_logs harus berupa array JSON';
    END IF;

    FOR item IN SELECT * FROM jsonb_array_elements(p_logs) LOOP
        v_tanggal := item->>'tanggal';
        v_sesi    := item->>'sesi';
        v_nama    := item->>'nama';
        v_lokasi  := item->>'lokasi';

        IF v_nama IS NULL OR trim(v_nama) = '' THEN
            skipped := skipped + 1;
            CONTINUE;
        END IF;

        IF p_skip_duplikat AND EXISTS (
            SELECT 1 FROM public.log_absensi
            WHERE tanggal = v_tanggal::date
              AND sesi    = v_sesi
              AND nama    = v_nama
              AND lokasi IS NOT DISTINCT FROM v_lokasi
        ) THEN
            skipped := skipped + 1;
            CONTINUE;
        END IF;

        INSERT INTO public.log_absensi (tanggal, sesi, lokasi, nip, nama, bidang, organisasi)
        VALUES (
            v_tanggal::date,
            v_sesi,
            v_lokasi,
            item->>'nip',
            v_nama,
            COALESCE(item->>'bidang', 'Helper'),
            COALESCE(item->>'organisasi', 'Umum')
        );
        inserted := inserted + 1;
    END LOOP;

    RETURN jsonb_build_object('inserted', inserted, 'skipped', skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.insert_absensi_batch(jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_absensi_batch(jsonb, boolean) TO authenticated;


-- =====================================================
-- E. FUNGSI SERVER: MERGE_RELAWAN
--    Gabungkan profil relawan secara ATOMIK (satu
--    transaksi): pindahkan seluruh absen dari NIP sumber
--    ke NIP target, perbarui identitas, lalu hapus profil
--    sumber. Jika salah satu NIP tidak ada, semua dibatalkan.
-- =====================================================
CREATE OR REPLACE FUNCTION public.merge_relawan(
    p_sumber_nip text,
    p_target_nip text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target  public.master_relawan%ROWTYPE;
    v_updated int;
BEGIN
    IF p_sumber_nip IS NULL OR p_target_nip IS NULL THEN
        RAISE EXCEPTION 'NIP sumber dan target wajib diisi';
    END IF;

    IF p_sumber_nip = p_target_nip THEN
        RAISE EXCEPTION 'NIP sumber dan target tidak boleh sama';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.master_relawan WHERE nip = p_sumber_nip) THEN
        RAISE EXCEPTION 'NIP sumber % tidak ditemukan', p_sumber_nip;
    END IF;

    SELECT * INTO v_target FROM public.master_relawan WHERE nip = p_target_nip;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NIP target % tidak ditemukan', p_target_nip;
    END IF;

    UPDATE public.log_absensi
       SET nip         = v_target.nip,
           nama        = v_target.nama,
           bidang      = v_target.jabatan,
           organisasi  = v_target.asal_organisasi
     WHERE nip = p_sumber_nip;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    DELETE FROM public.master_relawan WHERE nip = p_sumber_nip;

    RETURN jsonb_build_object(
        'log_dipindah', v_updated,
        'target',       v_target.nama,
        'sumber_dihapus', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_relawan(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_relawan(text, text) TO authenticated;


-- =====================================================
-- CEK HASIL
-- =====================================================
SELECT
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'master_relawan') AS policy_master,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'log_absensi')    AS policy_log,
    (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('master_relawan','log_absensi') AND indexname LIKE 'idx_%') AS total_index,
    (SELECT proargnames FROM pg_proc WHERE proname = 'insert_absensi_batch' LIMIT 1)                 AS fn_insert,
    (SELECT proargnames FROM pg_proc WHERE proname = 'merge_relawan' LIMIT 1)                        AS fn_merge;