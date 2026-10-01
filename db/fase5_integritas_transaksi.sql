-- =====================================================================
-- RELAWANSYNC V2 - FASE 5: INTEGRITAS TRANSAKSI & ANTI-DUPLIKAT
-- =====================================================================
-- URUTAN RILIS WAJIB:
--   1. Backup tabel master_relawan dan log_absensi.
--   2. Jalankan file ini di Supabase SQL Editor.
--   3. Pastikan bagian VERIFIKASI menghasilkan dua unique index dan fungsi
--      insert_absensi_batch dengan tiga parameter.
--   4. Baru deploy js/input.js yang mengirim p_master_baru.
--
-- Migrasi sengaja BERHENTI bila data duplikat lama masih ditemukan. Tidak ada
-- data lama yang dihapus otomatis. Tinjau dan gabungkan duplikat terlebih dulu,
-- lalu jalankan ulang migrasi ini.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. PREFLIGHT: JANGAN MEMILIH PEMENANG DUPLIKAT SECARA OTOMATIS
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.log_absensi
        WHERE nip IS NOT NULL AND trim(nip) <> ''
        GROUP BY tanggal, sesi, COALESCE(lokasi, ''), nip
        HAVING count(*) > 1
    ) OR EXISTS (
        SELECT 1
        FROM public.log_absensi
        WHERE nip IS NULL OR trim(nip) = ''
        GROUP BY tanggal, sesi, COALESCE(lokasi, ''), upper(trim(nama))
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Migrasi dihentikan: masih ada absensi duplikat.',
            HINT = 'Audit dan gabungkan duplikat berdasarkan tanggal+sesi+lokasi+NIP/nama, lalu jalankan ulang.';
    END IF;
END;
$$;

-- NIP adalah identitas utama. Nama ternormalisasi hanya menjadi fallback untuk
-- data lama yang belum mempunyai NIP.
CREATE UNIQUE INDEX IF NOT EXISTS uq_log_absensi_identitas
    ON public.log_absensi (tanggal, sesi, COALESCE(lokasi, ''), nip)
    WHERE nip IS NOT NULL AND trim(nip) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_log_absensi_nama_fallback
    ON public.log_absensi (tanggal, sesi, COALESCE(lokasi, ''), upper(trim(nama)))
    WHERE nip IS NULL OR trim(nip) = '';

-- ---------------------------------------------------------------------
-- 2. SATU TRANSAKSI: MASTER BARU + LOG ABSENSI
-- ---------------------------------------------------------------------
-- Drop signature lama agar PostgREST tidak memiliki overload ambigu. Seluruh
-- perubahan berada di satu transaction; bila CREATE gagal, fungsi lama kembali.
DROP FUNCTION IF EXISTS public.insert_absensi_batch(jsonb, boolean);

CREATE OR REPLACE FUNCTION public.insert_absensi_batch(
    p_logs jsonb,
    p_skip_duplikat boolean DEFAULT true,
    p_master_baru jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    item              jsonb;
    master_item       jsonb;
    inserted          integer := 0;
    skipped           integer := 0;
    master_inserted   integer := 0;
    master_skipped    integer := 0;
    affected          integer := 0;
    v_tanggal         date;
    v_sesi            text;
    v_nama            text;
    v_lokasi          text;
    v_nip             text;
    v_existing_name   text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesi pengguna tidak valid';
    END IF;

    IF p_logs IS NULL OR jsonb_typeof(p_logs) <> 'array' OR jsonb_array_length(p_logs) = 0 THEN
        RAISE EXCEPTION 'p_logs harus berupa array JSON yang tidak kosong';
    END IF;

    IF p_master_baru IS NULL THEN
        p_master_baru := '[]'::jsonb;
    END IF;

    IF jsonb_typeof(p_master_baru) <> 'array' THEN
        RAISE EXCEPTION 'p_master_baru harus berupa array JSON';
    END IF;

    -- Master baru disimpan di transaksi yang sama dengan absensi.
    FOR master_item IN SELECT value FROM jsonb_array_elements(p_master_baru) LOOP
        v_nip  := trim(COALESCE(master_item->>'nip', ''));
        v_nama := upper(trim(COALESCE(master_item->>'nama', '')));

        IF v_nip = '' OR v_nama = '' THEN
            RAISE EXCEPTION 'NIP dan nama relawan baru wajib diisi';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_logs) AS e
            WHERE trim(COALESCE(e->>'nip', '')) = v_nip
        ) THEN
            RAISE EXCEPTION 'Master baru % tidak mempunyai log absensi pada batch ini', v_nip;
        END IF;

        INSERT INTO public.master_relawan (nip, nama, jabatan, asal_organisasi)
        VALUES (
            v_nip,
            v_nama,
            COALESCE(NULLIF(trim(master_item->>'jabatan'), ''), 'Helper'),
            COALESCE(NULLIF(trim(master_item->>'asal_organisasi'), ''), 'Umum')
        )
        ON CONFLICT DO NOTHING;

        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected = 1 THEN
            master_inserted := master_inserted + 1;
        ELSE
            SELECT upper(trim(nama)) INTO v_existing_name
            FROM public.master_relawan WHERE nip = v_nip;
            IF v_existing_name IS DISTINCT FROM v_nama THEN
                RAISE EXCEPTION 'Benturan NIP %: sudah dipakai oleh relawan lain', v_nip;
            END IF;
            master_skipped := master_skipped + 1;
        END IF;
    END LOOP;

    FOR item IN SELECT value FROM jsonb_array_elements(p_logs) LOOP
        BEGIN
            v_tanggal := (item->>'tanggal')::date;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Tanggal absensi tidak valid: %', item->>'tanggal';
        END;

        v_sesi   := trim(COALESCE(item->>'sesi', ''));
        v_nama   := upper(trim(COALESCE(item->>'nama', '')));
        v_lokasi := trim(COALESCE(item->>'lokasi', ''));
        v_nip    := trim(COALESCE(item->>'nip', ''));

        IF v_sesi = '' OR v_nama = '' OR v_lokasi = '' OR v_nip = '' THEN
            RAISE EXCEPTION 'Tanggal, sesi, lokasi, NIP, dan nama wajib diisi';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM public.master_relawan WHERE nip = v_nip) THEN
            RAISE EXCEPTION 'Master relawan dengan NIP % tidak ditemukan', v_nip;
        END IF;

        IF p_skip_duplikat THEN
            INSERT INTO public.log_absensi (tanggal, sesi, lokasi, nip, nama, bidang, organisasi)
            VALUES (
                v_tanggal,
                v_sesi,
                v_lokasi,
                v_nip,
                v_nama,
                COALESCE(NULLIF(trim(item->>'bidang'), ''), 'Helper'),
                COALESCE(NULLIF(trim(item->>'organisasi'), ''), 'Umum')
            )
            ON CONFLICT DO NOTHING;

            GET DIAGNOSTICS affected = ROW_COUNT;
            IF affected = 1 THEN
                inserted := inserted + 1;
            ELSE
                skipped := skipped + 1;
            END IF;
        ELSE
            INSERT INTO public.log_absensi (tanggal, sesi, lokasi, nip, nama, bidang, organisasi)
            VALUES (
                v_tanggal,
                v_sesi,
                v_lokasi,
                v_nip,
                v_nama,
                COALESCE(NULLIF(trim(item->>'bidang'), ''), 'Helper'),
                COALESCE(NULLIF(trim(item->>'organisasi'), ''), 'Umum')
            );
            inserted := inserted + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'inserted', inserted,
        'skipped', skipped,
        'master_inserted', master_inserted,
        'master_skipped', master_skipped
    );
END;
$$;

REVOKE ALL ON FUNCTION public.insert_absensi_batch(jsonb, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_absensi_batch(jsonb, boolean, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_master_batch(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    item            jsonb;
    inserted        integer := 0;
    skipped         integer := 0;
    affected        integer := 0;
    v_nip           text;
    v_nama          text;
    v_existing_name text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesi pengguna tidak valid';
    END IF;
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
        RAISE EXCEPTION 'p_rows harus berupa array JSON yang tidak kosong';
    END IF;

    FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
        v_nip := trim(COALESCE(item->>'nip', ''));
        v_nama := upper(trim(COALESCE(item->>'nama', '')));
        IF v_nip = '' OR v_nama = '' THEN
            RAISE EXCEPTION 'Setiap baris import wajib memiliki NIP dan nama';
        END IF;

        INSERT INTO public.master_relawan (nip, nama, jabatan, asal_organisasi)
        VALUES (
            v_nip,
            v_nama,
            COALESCE(NULLIF(trim(item->>'jabatan'), ''), 'Helper'),
            COALESCE(NULLIF(trim(item->>'asal_organisasi'), ''), 'Umum')
        )
        ON CONFLICT DO NOTHING;

        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected = 1 THEN
            inserted := inserted + 1;
        ELSE
            SELECT upper(trim(nama)) INTO v_existing_name
            FROM public.master_relawan WHERE nip = v_nip;
            IF v_existing_name IS DISTINCT FROM v_nama THEN
                RAISE EXCEPTION 'Benturan NIP % saat import Master', v_nip;
            END IF;
            skipped := skipped + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('inserted', inserted, 'skipped', skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.import_master_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_master_batch(jsonb) TO authenticated;

-- Master yang sudah memiliki riwayat tidak boleh dihapus langsung karena akan
-- meninggalkan log yatim. Gunakan merge_relawan atau koreksi log terlebih dulu.
CREATE OR REPLACE FUNCTION public.cegah_hapus_master_berlog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.log_absensi WHERE nip = OLD.nip) THEN
        RAISE EXCEPTION 'Relawan % masih memiliki riwayat absensi; gunakan fitur Gabung', OLD.nama;
    END IF;
    RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.cegah_hapus_master_berlog() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_cegah_hapus_master_berlog ON public.master_relawan;
CREATE TRIGGER trg_cegah_hapus_master_berlog
BEFORE DELETE ON public.master_relawan
FOR EACH ROW EXECUTE FUNCTION public.cegah_hapus_master_berlog();

COMMIT;

-- ---------------------------------------------------------------------
-- 3. VERIFIKASI (READ-ONLY)
-- ---------------------------------------------------------------------
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'log_absensi'
  AND indexname IN ('uq_log_absensi_identitas', 'uq_log_absensi_nama_fallback')
ORDER BY indexname;

SELECT proname, proargnames
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'insert_absensi_batch';
