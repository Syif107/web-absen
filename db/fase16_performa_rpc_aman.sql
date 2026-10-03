-- =====================================================================
-- RELAWANSYNC V2 - FASE 16: JALUR CEPAT RPC ADMIN TANPA MELEMAHKAN RLS
-- =====================================================================
-- Jalankan setelah Fase 15.
--
-- RPC agregat sebelumnya cepat sebagai pemilik basis data, tetapi dapat
-- timeout sebagai admin karena planner memilih rencana RLS yang buruk.
-- Migrasi ini menyimpan implementasi Fase 14 sebagai fungsi operator lalu:
--   * admin melewati RLS hanya setelah akun_role() diverifikasi = admin;
--   * koordinator tetap menjalankan implementasi SECURITY INVOKER sehingga
--     batas lokasi proyek dari Fase 15 tidak berubah;
--   * akun blocked/tanpa profil ditolak oleh fungsi publik.
-- =====================================================================

BEGIN;

-- Salin implementasi Fase 14 satu kali sebelum fungsi publik diubah menjadi
-- router. Pemeriksaan keberadaan membuat migrasi aman dijalankan ulang.
DO $$
DECLARE v_def text;
BEGIN
    IF to_regprocedure('public.daftar_peringkat_operator_v2(text,text,text,integer,integer)') IS NULL THEN
        SELECT pg_get_functiondef('public.daftar_peringkat_v2(text,text,text,integer,integer)'::regprocedure)
        INTO v_def;
        v_def := replace(
            v_def,
            'FUNCTION public.daftar_peringkat_v2(',
            'FUNCTION public.daftar_peringkat_operator_v2('
        );
        EXECUTE v_def;
    END IF;

    IF to_regprocedure('public.daftar_seragam_operator_v2(text,text,text,text,integer,integer)') IS NULL THEN
        SELECT pg_get_functiondef('public.daftar_seragam_v2(text,text,text,text,integer,integer)'::regprocedure)
        INTO v_def;
        v_def := replace(
            v_def,
            'FUNCTION public.daftar_seragam_v2(',
            'FUNCTION public.daftar_seragam_operator_v2('
        );
        EXECUTE v_def;
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

CREATE OR REPLACE FUNCTION public.daftar_seragam_admin_v2(
    p_proyek text DEFAULT 'semua',
    p_proses text DEFAULT 'semua',
    p_penguasaan text DEFAULT 'semua',
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
    RETURN public.daftar_seragam_operator_v2(
        p_proyek, p_proses, p_penguasaan, p_cari, p_limit, p_offset
    );
END;
$$;

-- Fungsi publik tetap SECURITY INVOKER: ia hanya memilih jalur berdasarkan
-- profil pengguna. Tidak ada data yang dikembalikan sebelum peran tervalidasi.
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

CREATE OR REPLACE FUNCTION public.daftar_seragam_v2(
    p_proyek text DEFAULT 'semua',
    p_proses text DEFAULT 'semua',
    p_penguasaan text DEFAULT 'semua',
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
        RETURN public.daftar_seragam_admin_v2(
            p_proyek, p_proses, p_penguasaan, p_cari, p_limit, p_offset
        );
    ELSIF v_role = 'koordinator' THEN
        RETURN public.daftar_seragam_operator_v2(
            p_proyek, p_proses, p_penguasaan, p_cari, p_limit, p_offset
        );
    END IF;
    RAISE EXCEPTION 'Akun tidak memiliki akses';
END;
$$;

REVOKE ALL ON FUNCTION public.daftar_peringkat_operator_v2(text,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.daftar_peringkat_admin_v2(text,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.daftar_peringkat_v2(text,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.daftar_seragam_operator_v2(text,text,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.daftar_seragam_admin_v2(text,text,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.daftar_seragam_v2(text,text,text,text,integer,integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.daftar_peringkat_operator_v2(text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daftar_peringkat_admin_v2(text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daftar_peringkat_v2(text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daftar_seragam_operator_v2(text,text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daftar_seragam_admin_v2(text,text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daftar_seragam_v2(text,text,text,text,integer,integer) TO authenticated;

-- Supabase dapat memberi role anon hak EXECUTE langsung melalui default
-- privilege. Aplikasi ini wajib login, jadi tutup seluruh RPC public untuk
-- anon dan cegah fungsi baru mewarisi hak tersebut.
DO $$
DECLARE p record;
BEGIN
    FOR p IN
        SELECT proc.oid::regprocedure AS signature
        FROM pg_proc proc
        JOIN pg_namespace ns ON ns.oid = proc.pronamespace
        WHERE ns.nspname = 'public'
    LOOP
        -- authenticated sebelumnya sudah dapat EXECUTE melalui default
        -- Supabase; jadikan grant tersebut eksplisit sebelum PUBLIC dicabut.
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', p.signature);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', p.signature);
    END LOOP;
END;
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

COMMIT;

SELECT
    to_regprocedure('public.daftar_peringkat_operator_v2(text,text,text,integer,integer)') IS NOT NULL AS operator_peringkat,
    to_regprocedure('public.daftar_seragam_operator_v2(text,text,text,text,integer,integer)') IS NOT NULL AS operator_seragam,
    (SELECT prosecdef FROM pg_proc WHERE oid = 'public.daftar_peringkat_admin_v2(text,text,text,integer,integer)'::regprocedure) AS admin_security_definer,
    (SELECT NOT prosecdef FROM pg_proc WHERE oid = 'public.daftar_peringkat_v2(text,text,text,integer,integer)'::regprocedure) AS publik_security_invoker,
    NOT EXISTS (
        SELECT 1 FROM pg_proc proc
        JOIN pg_namespace ns ON ns.oid = proc.pronamespace
        WHERE ns.nspname = 'public'
          AND has_function_privilege('anon', proc.oid, 'EXECUTE')
    ) AS anon_tanpa_rpc;
