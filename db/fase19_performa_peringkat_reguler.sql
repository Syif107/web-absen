-- =====================================================================
-- RELAWANSYNC V2 - FASE 19: PULIHKAN JALUR CEPAT PERINGKAT REGULER
-- =====================================================================
-- Jalankan setelah Fase 17/18.
--
-- Fase 17 menambahkan filter personel reguler, tetapi tanpa sengaja
-- mengganti router Fase 16 dengan implementasi SECURITY INVOKER penuh.
-- Pada akun admin, agregasi kemudian terkena evaluasi RLS dan melewati
-- batas waktu PostgREST. Migrasi ini menyimpan implementasi reguler sebagai
-- fungsi operator dan memulihkan router aman Fase 16.
-- =====================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_master_relawan_kategori_personel_nip
    ON public.master_relawan (kategori_personel, nip);

-- Ambil implementasi reguler Fase 17 sebelum fungsi publik diubah kembali
-- menjadi router. Pemeriksaan isi membuat migrasi aman dijalankan ulang.
DO $$
DECLARE v_def text;
BEGIN
    SELECT pg_get_functiondef(
        'public.daftar_peringkat_v2(text,text,text,integer,integer)'::regprocedure
    ) INTO v_def;

    IF position('kategori_personel' IN v_def) > 0 THEN
        v_def := replace(
            v_def,
            'FUNCTION public.daftar_peringkat_v2(',
            'FUNCTION public.daftar_peringkat_operator_v2('
        );
        EXECUTE v_def;
    END IF;

    IF to_regprocedure(
        'public.daftar_peringkat_operator_v2(text,text,text,integer,integer)'
    ) IS NULL THEN
        RAISE EXCEPTION 'Implementasi operator peringkat tidak tersedia';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.daftar_peringkat_admin_v2(
    p_proyek text DEFAULT 'semua',
    p_status text DEFAULT 'semua',
    p_cari text DEFAULT '',
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR public.akun_role() <> 'admin' THEN
        RAISE EXCEPTION 'Akses admin diperlukan';
    END IF;
    RETURN public.daftar_peringkat_operator_v2(
        p_proyek, p_status, p_cari, p_limit, p_offset
    );
END;
$$;

-- Fungsi publik tetap invoker dan hanya memilih jalur setelah role akun
-- tervalidasi. Koordinator tetap dibatasi RLS; hanya admin memakai jalur cepat.
CREATE OR REPLACE FUNCTION public.daftar_peringkat_v2(
    p_proyek text DEFAULT 'semua',
    p_status text DEFAULT 'semua',
    p_cari text DEFAULT '',
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
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
        RETURN public.daftar_peringkat_admin_v2(
            p_proyek, p_status, p_cari, p_limit, p_offset
        );
    ELSIF v_role = 'koordinator' THEN
        RETURN public.daftar_peringkat_operator_v2(
            p_proyek, p_status, p_cari, p_limit, p_offset
        );
    END IF;
    RAISE EXCEPTION 'Akun tidak memiliki akses';
END;
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';

SELECT
    (SELECT prosecdef FROM pg_proc
      WHERE oid = 'public.daftar_peringkat_admin_v2(text,text,text,integer,integer)'::regprocedure)
        AS admin_security_definer,
    (SELECT NOT prosecdef FROM pg_proc
      WHERE oid = 'public.daftar_peringkat_v2(text,text,text,integer,integer)'::regprocedure)
        AS router_security_invoker,
    position(
        'kategori_personel' IN pg_get_functiondef(
            'public.daftar_peringkat_operator_v2(text,text,text,integer,integer)'::regprocedure
        )
    ) > 0 AS operator_hanya_reguler,
    has_function_privilege(
        'authenticated',
        'public.daftar_peringkat_v2(text,text,text,integer,integer)',
        'EXECUTE'
    ) AS authenticated_execute,
    has_function_privilege(
        'anon',
        'public.daftar_peringkat_v2(text,text,text,integer,integer)',
        'EXECUTE'
    ) AS anon_execute;
