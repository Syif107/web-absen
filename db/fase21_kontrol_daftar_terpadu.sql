-- =====================================================================
-- RELAWANSYNC V2 - FASE 21: KONTROL DAFTAR TERPADU
-- =====================================================================
-- Jalankan setelah Fase 20.
-- Menambahkan pengurutan server-side dan batas 200 baris untuk daftar
-- Peringkat serta Kontrol Seragam. Router admin/koordinator tetap mengikuti
-- pola keamanan Fase 16/19; anon tidak memperoleh akses.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.daftar_peringkat_operator_v3(
    p_proyek text DEFAULT 'semua',
    p_status text DEFAULT 'semua',
    p_cari text DEFAULT '',
    p_urut text DEFAULT 'prioritas',
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_rows jsonb;
    v_total integer;
    v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
    v_offset integer := greatest(0, coalesce(p_offset, 0));
    v_project text := coalesce(nullif(trim(p_proyek), ''), 'semua');
    v_search text := trim(coalesce(p_cari, ''));
    v_sort text := CASE
        WHEN p_urut IN ('prioritas', 'nama_asc', 'nama_desc', 'hari_desc', 'hari_asc', 'indeks_desc', 'konsistensi_desc')
            THEN p_urut
        ELSE 'prioritas'
    END;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;

    IF v_project = 'semua' THEN
        WITH filtered AS (
            SELECT r.*
            FROM public.v_peringkat_personel_umum_v2 r
            JOIN public.master_relawan m ON m.nip = r.nip AND m.kategori_personel = 'reguler'
            WHERE (v_search = '' OR r.nama ILIKE '%' || v_search || '%' OR r.nip ILIKE '%' || v_search || '%'
                   OR r.asal_organisasi ILIKE '%' || v_search || '%' OR coalesce(r.asal_daerah, '') ILIKE '%' || v_search || '%')
              AND (p_status = 'semua'
                   OR (p_status = 'memenuhi' AND r.memenuhi_syarat)
                   OR (p_status = 'belum' AND NOT r.memenuhi_syarat)
                   OR (p_status = 'mendekati' AND NOT r.memenuhi_syarat AND r.target_hari = 40 AND r.hari_menuju_syarat BETWEEN 30 AND 39))
        ), paged AS (
            SELECT * FROM filtered
            ORDER BY
                CASE WHEN v_sort = 'prioritas' THEN memenuhi_syarat END DESC,
                CASE WHEN v_sort = 'prioritas' THEN peringkat END ASC NULLS LAST,
                CASE WHEN v_sort = 'prioritas' THEN hari_menuju_syarat END DESC,
                CASE WHEN v_sort = 'nama_asc' THEN lower(nama) END ASC,
                CASE WHEN v_sort = 'nama_desc' THEN lower(nama) END DESC,
                CASE WHEN v_sort = 'hari_desc' THEN hari_menuju_syarat END DESC,
                CASE WHEN v_sort = 'hari_asc' THEN hari_menuju_syarat END ASC,
                CASE WHEN v_sort = 'indeks_desc' THEN indeks_keaktifan END DESC NULLS LAST,
                CASE WHEN v_sort = 'konsistensi_desc' THEN streak_terpanjang END DESC NULLS LAST,
                indeks_keaktifan DESC NULLS LAST, lower(nama) ASC, nip ASC
            LIMIT v_limit OFFSET v_offset
        )
        SELECT (SELECT count(*)::integer FROM filtered),
               coalesce((SELECT jsonb_agg(to_jsonb(paged)) FROM paged), '[]'::jsonb)
        INTO v_total, v_rows;
    ELSE
        WITH filtered AS (
            SELECT r.*
            FROM public.v_peringkat_personel_operasional_v2 r
            JOIN public.master_relawan m ON m.nip = r.nip AND m.kategori_personel = 'reguler'
            WHERE ((v_project IN ('khususul_khusus', 'lainnya') AND r.kategori = v_project)
                   OR (v_project LIKE 'proyek:%' AND EXISTS (
                       SELECT 1 FROM public.v_kehadiran_proyek_personel kp
                       WHERE kp.nip = r.nip AND kp.kategori = r.kategori
                         AND kp.nama_proyek = substring(v_project FROM 8)
                   )))
              AND (v_search = '' OR r.nama ILIKE '%' || v_search || '%' OR r.nip ILIKE '%' || v_search || '%'
                   OR r.asal_organisasi ILIKE '%' || v_search || '%' OR coalesce(r.asal_daerah, '') ILIKE '%' || v_search || '%')
              AND (p_status = 'semua'
                   OR (p_status = 'memenuhi' AND r.memenuhi_syarat)
                   OR (p_status = 'belum' AND NOT r.memenuhi_syarat)
                   OR (p_status = 'mendekati' AND NOT r.memenuhi_syarat AND r.target_hari = 40 AND r.total_hari BETWEEN 30 AND 39))
        ), paged AS (
            SELECT * FROM filtered
            ORDER BY
                CASE WHEN v_sort = 'prioritas' THEN memenuhi_syarat END DESC,
                CASE WHEN v_sort = 'prioritas' THEN peringkat END ASC NULLS LAST,
                CASE WHEN v_sort = 'prioritas' THEN total_hari END DESC,
                CASE WHEN v_sort = 'nama_asc' THEN lower(nama) END ASC,
                CASE WHEN v_sort = 'nama_desc' THEN lower(nama) END DESC,
                CASE WHEN v_sort = 'hari_desc' THEN total_hari END DESC,
                CASE WHEN v_sort = 'hari_asc' THEN total_hari END ASC,
                CASE WHEN v_sort = 'indeks_desc' THEN indeks_keaktifan END DESC NULLS LAST,
                CASE WHEN v_sort = 'konsistensi_desc' THEN streak_terpanjang END DESC NULLS LAST,
                indeks_keaktifan DESC NULLS LAST, lower(nama) ASC, nip ASC
            LIMIT v_limit OFFSET v_offset
        )
        SELECT (SELECT count(*)::integer FROM filtered),
               coalesce((SELECT jsonb_agg(to_jsonb(paged)) FROM paged), '[]'::jsonb)
        INTO v_total, v_rows;
    END IF;

    RETURN jsonb_build_object(
        'rows', v_rows,
        'total', v_total,
        'kpi', (
            SELECT jsonb_build_object(
                'personel', count(*),
                'memenuhi', count(*) FILTER (WHERE r.memenuhi_syarat),
                'zona4', count(*) FILTER (WHERE r.zona_asal = 'zona_4'),
                'mendekati', count(*) FILTER (WHERE NOT r.memenuhi_syarat AND r.target_hari = 40 AND r.hari_menuju_syarat BETWEEN 30 AND 39),
                'zona_kosong', count(*) FILTER (WHERE r.zona_asal IS NULL)
            )
            FROM public.v_peringkat_personel_umum_v2 r
            JOIN public.master_relawan m ON m.nip = r.nip AND m.kategori_personel = 'reguler'
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.daftar_peringkat_admin_v3(
    p_proyek text DEFAULT 'semua', p_status text DEFAULT 'semua', p_cari text DEFAULT '',
    p_urut text DEFAULT 'prioritas', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR public.akun_role() <> 'admin' THEN RAISE EXCEPTION 'Akses admin diperlukan'; END IF;
    RETURN public.daftar_peringkat_operator_v3(p_proyek, p_status, p_cari, p_urut, p_limit, p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.daftar_peringkat_v3(
    p_proyek text DEFAULT 'semua', p_status text DEFAULT 'semua', p_cari text DEFAULT '',
    p_urut text DEFAULT 'prioritas', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_role text := public.akun_role();
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;
    IF v_role = 'admin' THEN
        RETURN public.daftar_peringkat_admin_v3(p_proyek, p_status, p_cari, p_urut, p_limit, p_offset);
    ELSIF v_role = 'koordinator' THEN
        RETURN public.daftar_peringkat_operator_v3(p_proyek, p_status, p_cari, p_urut, p_limit, p_offset);
    END IF;
    RAISE EXCEPTION 'Akun tidak memiliki akses';
END;
$$;

CREATE OR REPLACE FUNCTION public.daftar_seragam_operator_v3(
    p_proyek text DEFAULT 'semua',
    p_proses text DEFAULT 'semua',
    p_penguasaan text DEFAULT 'semua',
    p_cari text DEFAULT '',
    p_urut text DEFAULT 'prioritas',
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_rows jsonb;
    v_total integer;
    v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
    v_offset integer := greatest(0, coalesce(p_offset, 0));
    v_project text := coalesce(nullif(trim(p_proyek), ''), 'semua');
    v_search text := trim(coalesce(p_cari, ''));
    v_sort text := CASE
        WHEN p_urut IN ('prioritas', 'nama_asc', 'nama_desc', 'proses_asc', 'zona_asc', 'terakhir_hadir_desc', 'tidak_hadir_desc', 'tanggal_status_desc')
            THEN p_urut
        ELSE 'prioritas'
    END;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;

    WITH filtered AS (
        SELECT * FROM public.v_status_seragam_set_v2 r
        WHERE (v_project = 'semua'
               OR (v_project IN ('khususul_khusus', 'lainnya') AND (
                   r.jalur_kelayakan = v_project OR EXISTS (
                       SELECT 1 FROM public.v_kehadiran_proyek_personel kp
                       WHERE kp.nip = r.nip AND kp.kategori = v_project
                   )))
               OR (v_project LIKE 'proyek:%' AND EXISTS (
                   SELECT 1 FROM public.v_kehadiran_proyek_personel kp
                   WHERE kp.nip = r.nip AND kp.nama_proyek = substring(v_project FROM 8)
               )))
          AND (p_proses = 'semua' OR r.status_proses = p_proses)
          AND (p_penguasaan = 'semua' OR r.status_penguasaan = p_penguasaan)
          AND (v_search = '' OR r.nama ILIKE '%' || v_search || '%' OR r.nip ILIKE '%' || v_search || '%'
               OR r.asal_organisasi ILIKE '%' || v_search || '%' OR coalesce(r.asal_daerah, '') ILIKE '%' || v_search || '%'
               OR coalesce(r.ukuran_atasan, '') ILIKE '%' || v_search || '%' OR coalesce(r.ukuran_bawahan, '') ILIKE '%' || v_search || '%'
               OR coalesce(r.kode_atasan, '') ILIKE '%' || v_search || '%' OR coalesce(r.kode_bawahan, '') ILIKE '%' || v_search || '%')
    ), paged AS (
        SELECT * FROM filtered
        ORDER BY
            CASE WHEN v_sort = 'prioritas' THEN notifikasi_pengembalian END DESC,
            CASE WHEN v_sort = 'prioritas' THEN tidak_hadir_30_hari END DESC,
            CASE WHEN v_sort = 'prioritas' THEN memenuhi_syarat END DESC,
            CASE WHEN v_sort = 'prioritas' THEN peringkat END ASC NULLS LAST,
            CASE WHEN v_sort = 'nama_asc' THEN lower(nama) END ASC,
            CASE WHEN v_sort = 'nama_desc' THEN lower(nama) END DESC,
            CASE WHEN v_sort = 'proses_asc' THEN status_proses END ASC,
            CASE WHEN v_sort = 'zona_asc' THEN zona_asal END ASC NULLS LAST,
            CASE WHEN v_sort = 'terakhir_hadir_desc' THEN tanggal_hadir_terakhir END DESC NULLS LAST,
            CASE WHEN v_sort = 'tidak_hadir_desc' THEN hari_tidak_hadir END DESC NULLS LAST,
            CASE WHEN v_sort = 'tanggal_status_desc' THEN coalesce(tanggal_efektif_status, tanggal_status) END DESC NULLS LAST,
            lower(nama) ASC, nip ASC
        LIMIT v_limit OFFSET v_offset
    )
    SELECT (SELECT count(*)::integer FROM filtered),
           coalesce((SELECT jsonb_agg(to_jsonb(paged)) FROM paged), '[]'::jsonb)
    INTO v_total, v_rows;

    RETURN jsonb_build_object(
        'rows', v_rows,
        'total', v_total,
        'kpi', (
            SELECT jsonb_build_object(
                'memenuhi', count(*) FILTER (WHERE memenuhi_syarat),
                'direncanakan', count(*) FILTER (WHERE status_proses = 'direncanakan'),
                'menunggu', count(*) FILTER (WHERE status_proses = 'menunggu_stok'),
                'diserahkan', count(*) FILTER (WHERE status_proses = 'sudah_diserahkan'),
                'dititipkan', count(*) FILTER (WHERE status_penguasaan = 'dititipkan_kantor'),
                'perlu_kembali', count(*) FILTER (WHERE status_penguasaan = 'perlu_diserahkan_kembali'),
                'absen_lama', count(*) FILTER (WHERE tidak_hadir_30_hari)
            ) FROM public.v_status_seragam_set_v2
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.daftar_seragam_admin_v3(
    p_proyek text DEFAULT 'semua', p_proses text DEFAULT 'semua', p_penguasaan text DEFAULT 'semua',
    p_cari text DEFAULT '', p_urut text DEFAULT 'prioritas', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR public.akun_role() <> 'admin' THEN RAISE EXCEPTION 'Akses admin diperlukan'; END IF;
    RETURN public.daftar_seragam_operator_v3(p_proyek, p_proses, p_penguasaan, p_cari, p_urut, p_limit, p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.daftar_seragam_v3(
    p_proyek text DEFAULT 'semua', p_proses text DEFAULT 'semua', p_penguasaan text DEFAULT 'semua',
    p_cari text DEFAULT '', p_urut text DEFAULT 'prioritas', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_role text := public.akun_role();
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;
    IF v_role = 'admin' THEN
        RETURN public.daftar_seragam_admin_v3(p_proyek, p_proses, p_penguasaan, p_cari, p_urut, p_limit, p_offset);
    ELSIF v_role = 'koordinator' THEN
        RETURN public.daftar_seragam_operator_v3(p_proyek, p_proses, p_penguasaan, p_cari, p_urut, p_limit, p_offset);
    END IF;
    RAISE EXCEPTION 'Akun tidak memiliki akses';
END;
$$;

REVOKE ALL ON FUNCTION public.daftar_peringkat_operator_v3(text,text,text,text,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daftar_peringkat_admin_v3(text,text,text,text,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daftar_peringkat_v3(text,text,text,text,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daftar_seragam_operator_v3(text,text,text,text,text,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daftar_seragam_admin_v3(text,text,text,text,text,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daftar_seragam_v3(text,text,text,text,text,integer,integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.daftar_peringkat_operator_v3(text,text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daftar_peringkat_admin_v3(text,text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daftar_peringkat_v3(text,text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daftar_seragam_operator_v3(text,text,text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daftar_seragam_admin_v3(text,text,text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daftar_seragam_v3(text,text,text,text,text,integer,integer) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';

SELECT
    to_regprocedure('public.daftar_peringkat_v3(text,text,text,text,integer,integer)') IS NOT NULL AS peringkat_v3,
    to_regprocedure('public.daftar_seragam_v3(text,text,text,text,text,integer,integer)') IS NOT NULL AS seragam_v3,
    (SELECT NOT prosecdef FROM pg_proc WHERE oid = 'public.daftar_peringkat_v3(text,text,text,text,integer,integer)'::regprocedure) AS peringkat_router_invoker,
    (SELECT NOT prosecdef FROM pg_proc WHERE oid = 'public.daftar_seragam_v3(text,text,text,text,text,integer,integer)'::regprocedure) AS seragam_router_invoker,
    has_function_privilege('authenticated', 'public.daftar_peringkat_v3(text,text,text,text,integer,integer)', 'EXECUTE') AS authenticated_peringkat,
    has_function_privilege('authenticated', 'public.daftar_seragam_v3(text,text,text,text,text,integer,integer)', 'EXECUTE') AS authenticated_seragam,
    has_function_privilege('anon', 'public.daftar_peringkat_v3(text,text,text,text,integer,integer)', 'EXECUTE') AS anon_peringkat,
    has_function_privilege('anon', 'public.daftar_seragam_v3(text,text,text,text,text,integer,integer)', 'EXECUTE') AS anon_seragam;
