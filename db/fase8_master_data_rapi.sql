-- FASE 8: perapian Master Data dengan aturan gabung yang aman
-- Jalankan setelah fondasi Fase 0/Fase 4 bila digunakan.
-- Migrasi ini tidak menggabungkan profil secara otomatis. Ia menormalkan
-- klasifikasi PUSAT dan istilah PJ/Admin, lalu memperketat RPC merge_relawan
-- agar penggabungan harus memakai nama + asal organisasi yang sama.

BEGIN;

-- Hanya organisasi yang persis PUSAT dianggap Jombang. DPD JOMBANG atau
-- tulisan Jombang tidak diubah karena belum tentu berarti Pusat.
UPDATE public.master_relawan
   SET kategori_wilayah = 'jombang'
 WHERE regexp_replace(upper(trim(coalesce(asal_organisasi, ''))), '\s+', ' ', 'g') = 'PUSAT'
   AND coalesce(kategori_wilayah, '') <> 'jombang';

-- PJ dan Admin adalah satu istilah operasional.
UPDATE public.master_relawan
   SET jabatan = 'PJ / Admin'
 WHERE regexp_replace(upper(trim(coalesce(jabatan, ''))), '\s*/\s*', '/', 'g')
       IN ('PJ', 'ADMIN', 'PJ/ADMIN', 'ADMIN/PJ');

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
    v_source public.master_relawan%ROWTYPE;
    v_target public.master_relawan%ROWTYPE;
    v_updated integer;
    v_role text;
BEGIN
    -- Bila Fase 4 aktif, hanya admin yang boleh menggabungkan.
    IF to_regprocedure('public.akun_role()') IS NOT NULL THEN
        EXECUTE 'SELECT public.akun_role()' INTO v_role;
        IF coalesce(v_role, '') <> 'admin' THEN
            RAISE EXCEPTION 'Hanya admin yang boleh menggabungkan relawan';
        END IF;
    END IF;

    IF p_sumber_nip IS NULL OR p_target_nip IS NULL OR p_sumber_nip = p_target_nip THEN
        RAISE EXCEPTION 'NIP sumber dan target tidak valid';
    END IF;

    SELECT * INTO v_source FROM public.master_relawan WHERE nip = p_sumber_nip;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NIP sumber % tidak ditemukan', p_sumber_nip;
    END IF;

    SELECT * INTO v_target FROM public.master_relawan WHERE nip = p_target_nip;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NIP target % tidak ditemukan', p_target_nip;
    END IF;

    IF NULLIF(trim(v_source.nama), '') IS NULL
       OR NULLIF(trim(v_source.asal_organisasi), '') IS NULL
       OR NULLIF(trim(v_target.nama), '') IS NULL
       OR NULLIF(trim(v_target.asal_organisasi), '') IS NULL THEN
        RAISE EXCEPTION 'Merge ditolak: nama dan asal organisasi wajib terisi pada kedua profil';
    END IF;

    IF regexp_replace(upper(trim(v_source.nama)), '\s+', ' ', 'g')
           <> regexp_replace(upper(trim(v_target.nama)), '\s+', ' ', 'g')
       OR regexp_replace(upper(trim(v_source.asal_organisasi)), '\s+', ' ', 'g')
           <> regexp_replace(upper(trim(v_target.asal_organisasi)), '\s+', ' ', 'g') THEN
        RAISE EXCEPTION 'Merge ditolak: hanya nama dan asal organisasi yang sama yang boleh digabung';
    END IF;

    UPDATE public.log_absensi
       SET nip = v_target.nip,
           nama = v_target.nama,
           bidang = v_target.jabatan,
           organisasi = v_target.asal_organisasi
     WHERE nip = p_sumber_nip;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    -- Isi profil tujuan yang masih kosong memakai data sumber agar merge tidak
    -- membuang detail daerah, kategori, ukuran, atau catatan yang sudah ada.
    UPDATE public.master_relawan
       SET asal_daerah = coalesce(nullif(trim(v_target.asal_daerah), ''), nullif(trim(v_source.asal_daerah), '')),
           kategori_wilayah = CASE
               WHEN regexp_replace(upper(trim(v_target.asal_organisasi)), '\s+', ' ', 'g') = 'PUSAT' THEN 'jombang'
               WHEN coalesce(v_target.kategori_wilayah, 'belum_dilengkapi') = 'belum_dilengkapi'
                   THEN coalesce(v_source.kategori_wilayah, 'belum_dilengkapi')
               ELSE v_target.kategori_wilayah
           END,
           ukuran_seragam = coalesce(nullif(trim(v_target.ukuran_seragam), ''), nullif(trim(v_source.ukuran_seragam), '')),
           catatan_seragam = coalesce(nullif(trim(v_target.catatan_seragam), ''), nullif(trim(v_source.catatan_seragam), ''))
     WHERE nip = p_target_nip;

    DELETE FROM public.master_relawan WHERE nip = p_sumber_nip;

    RETURN jsonb_build_object(
        'log_dipindah', v_updated,
        'target', v_target.nama,
        'sumber_dihapus', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_relawan(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_relawan(text, text) TO authenticated;

COMMIT;

SELECT
    (SELECT count(*) FROM public.master_relawan) AS total_master,
    (SELECT proargnames FROM pg_proc WHERE proname = 'merge_relawan' LIMIT 1) AS fn_merge;
