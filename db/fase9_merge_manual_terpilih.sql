-- FASE 9: merge manual beberapa profil dari checkbox Master Data
-- Jalankan setelah Fase 8. Fungsi ini tidak mengubah data saat migrasi dibuat;
-- data hanya berubah ketika admin mengonfirmasi Merge dari aplikasi.

BEGIN;

CREATE OR REPLACE FUNCTION public.merge_relawan_manual(
    p_nips text[],
    p_target_nip text,
    p_profile jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_nips text[];
    v_found integer := 0;
    v_deleted_logs integer := 0;
    v_updated_logs integer := 0;
    v_deleted_profiles integer := 0;
    v_uniform_count integer := 0;
    v_role text;
    v_nama text;
    v_organisasi text;
    v_jabatan text;
    v_asal_daerah text;
    v_kategori_wilayah text;
    v_ukuran text;
    v_catatan text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesi pengguna tidak valid';
    END IF;

    IF to_regprocedure('public.akun_role()') IS NOT NULL THEN
        EXECUTE 'SELECT public.akun_role()' INTO v_role;
        IF coalesce(v_role, '') <> 'admin' THEN
            RAISE EXCEPTION 'Hanya admin yang boleh melakukan merge manual';
        END IF;
    END IF;

    SELECT array_agg(nip ORDER BY nip)
      INTO v_nips
      FROM (
          SELECT DISTINCT trim(value) AS nip
          FROM unnest(coalesce(p_nips, ARRAY[]::text[])) AS item(value)
          WHERE value IS NOT NULL AND trim(value) <> ''
      ) pilihan;

    IF coalesce(array_length(v_nips, 1), 0) < 2 THEN
        RAISE EXCEPTION 'Pilih sedikitnya dua profil untuk digabung';
    END IF;

    IF p_target_nip IS NULL OR NOT (p_target_nip = ANY(v_nips)) THEN
        RAISE EXCEPTION 'ID utama harus termasuk dalam profil yang dipilih';
    END IF;

    PERFORM 1
    FROM public.master_relawan
    WHERE nip = ANY(v_nips)
    FOR UPDATE;
    GET DIAGNOSTICS v_found = ROW_COUNT;

    IF v_found <> array_length(v_nips, 1) THEN
        RAISE EXCEPTION 'Sebagian profil tidak ditemukan. Muat ulang Master Data lalu pilih kembali';
    END IF;

    v_nama := upper(trim(coalesce(p_profile->>'nama', '')));
    v_organisasi := trim(coalesce(p_profile->>'asal_organisasi', ''));
    v_jabatan := trim(coalesce(p_profile->>'jabatan', ''));
    v_asal_daerah := nullif(trim(coalesce(p_profile->>'asal_daerah', '')), '');
    v_kategori_wilayah := coalesce(nullif(trim(p_profile->>'kategori_wilayah'), ''), 'belum_dilengkapi');
    v_ukuran := nullif(trim(coalesce(p_profile->>'ukuran_seragam', '')), '');
    v_catatan := nullif(trim(coalesce(p_profile->>'catatan_seragam', '')), '');

    IF v_nama = '' OR v_organisasi = '' THEN
        RAISE EXCEPTION 'Nama akhir dan asal organisasi wajib diisi';
    END IF;

    IF regexp_replace(upper(v_organisasi), '\s+', ' ', 'g') = 'PUSAT' THEN
        v_kategori_wilayah := 'jombang';
    END IF;

    IF regexp_replace(upper(v_jabatan), '\s*/\s*', '/', 'g') IN ('PJ', 'ADMIN', 'PJ/ADMIN', 'ADMIN/PJ') THEN
        v_jabatan := 'PJ / Admin';
    END IF;

    IF v_kategori_wilayah NOT IN ('belum_dilengkapi', 'jombang', 'luar_jombang', 'zona_4') THEN
        RAISE EXCEPTION 'Kategori wilayah tidak valid';
    END IF;

    IF v_ukuran IS NOT NULL AND v_ukuran NOT IN ('S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Khusus') THEN
        RAISE EXCEPTION 'Ukuran seragam tidak valid';
    END IF;

    -- Bila profil yang dipilih memiliki lebih dari satu kontrol seragam, admin
    -- harus menyelesaikannya dahulu agar status/kode seragam tidak tertimpa.
    SELECT count(*) INTO v_uniform_count
    FROM public.seragam_penerima
    WHERE nip = ANY(v_nips);

    IF v_uniform_count > 1 THEN
        RAISE EXCEPTION 'Merge dihentikan: lebih dari satu profil memiliki data Kontrol Seragam. Rapikan status seragam terlebih dahulu';
    END IF;

    -- Satu orang dapat tercatat dua kali pada tanggal, sesi, dan proyek yang
    -- sama. Pertahankan satu baris, utamakan riwayat milik ID target.
    WITH ranked AS (
        SELECT
            id,
            row_number() OVER (
                PARTITION BY tanggal, sesi, coalesce(lokasi, '')
                ORDER BY CASE WHEN nip = p_target_nip THEN 0 ELSE 1 END, id
            ) AS urutan
        FROM public.log_absensi
        WHERE nip = ANY(v_nips)
    )
    DELETE FROM public.log_absensi log
    USING ranked
    WHERE log.id = ranked.id
      AND ranked.urutan > 1;
    GET DIAGNOSTICS v_deleted_logs = ROW_COUNT;

    UPDATE public.log_absensi
       SET nip = p_target_nip,
           nama = v_nama,
           bidang = v_jabatan,
           organisasi = v_organisasi
     WHERE nip = ANY(v_nips);
    GET DIAGNOSTICS v_updated_logs = ROW_COUNT;

    -- Pindahkan satu-satunya data seragam (bila ada) dan seluruh riwayatnya.
    UPDATE public.seragam_penerima
       SET nip = p_target_nip
     WHERE nip = ANY(v_nips)
       AND nip <> p_target_nip;

    UPDATE public.seragam_riwayat
       SET nip = p_target_nip
     WHERE nip = ANY(v_nips)
       AND nip <> p_target_nip;

    UPDATE public.master_relawan
       SET nama = v_nama,
           asal_organisasi = v_organisasi,
           jabatan = v_jabatan,
           asal_daerah = v_asal_daerah,
           kategori_wilayah = v_kategori_wilayah,
           ukuran_seragam = v_ukuran,
           catatan_seragam = v_catatan
     WHERE nip = p_target_nip;

    DELETE FROM public.master_relawan
     WHERE nip = ANY(v_nips)
       AND nip <> p_target_nip;
    GET DIAGNOSTICS v_deleted_profiles = ROW_COUNT;

    RETURN jsonb_build_object(
        'target_nip', p_target_nip,
        'target_nama', v_nama,
        'profil_digabung', v_deleted_profiles,
        'log_dipindah', v_updated_logs,
        'log_duplikat_dihapus', v_deleted_logs
    );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_relawan_manual(text[], text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_relawan_manual(text[], text, jsonb) TO authenticated;

COMMIT;

SELECT proargnames
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'merge_relawan_manual';
