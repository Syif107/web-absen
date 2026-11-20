-- ============================================================
-- Menyamakan hak akses setelah restore.
-- ------------------------------------------------------------
-- Dump dibuat dengan --no-privileges, jadi GRANT/REVOKE harus
-- diterapkan ulang. Skrip ini mengikuti aturan aplikasi:
--   * anon tidak boleh membaca tabel/fungsi apa pun
--   * authenticated boleh membaca/menulis sesuai RLS
--   * service_role penuh (hanya dipakai server)
-- Aman dijalankan berulang.
-- ============================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
        RAISE EXCEPTION 'Role Supabase (anon/authenticated/service_role/authenticator) tidak lengkap. Pastikan memakai image supabase/postgres.';
    END IF;

    EXECUTE 'GRANT anon, authenticated, service_role TO authenticator';
    -- Image Supabase modern menandai service_role sebagai reserved dan sudah
    -- memberi BYPASSRLS sejak awal. Hanya ubah role pada image lama yang belum
    -- memilikinya agar skrip tetap kompatibel lintas versi.
    IF NOT EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'service_role' AND rolbypassrls
    ) THEN
        EXECUTE 'ALTER ROLE service_role BYPASSRLS';
    END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role';
    END IF;
END;
$$;

-- Tabel dan view
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Sequence untuk kolom identity/serial
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Fungsi: anon ditutup, authenticated sesuai kontrak frontend
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- Objek baru mengikuti aturan yang sama
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- Kadang FK lintas schema tidak ikut ter-dump saat memakai --schema=public.
-- Pastikan public.profil tetap terhubung ke auth.users.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f'
          AND c.conrelid = 'public.profil'::regclass
          AND c.confrelid = 'auth.users'::regclass
          AND a.attname = 'id'
    ) THEN
        ALTER TABLE public.profil
            ADD CONSTRAINT profil_id_fkey
            FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
END;
$$;

-- Beri tahu PostgREST agar cache skema dimuat ulang.
NOTIFY pgrst, 'reload schema';

COMMIT;
