-- =====================================================================
-- FASE 4: MULTI-USER (ADMIN + KOORDINATOR PER PROYEK)
-- ---------------------------------------------------------------------
-- ⚠️ FILE INI BELUM DIJALANKAN. Hanya dijalankan SETELAH diputuskan
--    bahwa fitur multi-user benar-benar dipakai.
--
-- Cara mengaktifkan:
--   1. Jalankan SQL ini di Supabase > SQL Editor.
--   2. Seed akun admin Anda (lihat "SEED CONTOH" di bawah).
--   3. Di js/supabase-config.js ubah:  const FASE4_ENABLED = false;  -> true.
--
-- Peran:
--   - 'admin'       : akses penuh semua data (seperti sekarang).
--   - 'koordinator' : hanya bisa membaca & mengisi absensi untuk
--                     lokasi_proyek miliknya (log_absensi), serta
--                     membaca master_relawan (tidak bisa ubah).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABEL PROYEK (daftar lokasi proyek)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proyek (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nama    text NOT NULL UNIQUE,
    aktif   boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. TABEL PROFIL (peta akun auth -> peran & lokasi)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profil (
    id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nama          text,
    role          text NOT NULL DEFAULT 'koordinator' CHECK (role IN ('admin','koordinator')),
    lokasi_proyek text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profil ENABLE ROW LEVEL SECURITY;

-- Pemilik hanya kelola barisnya sendiri (membuat saat pendaftaran, edit sendiri)
CREATE POLICY "profil_owner_all" ON public.profil
    FOR ALL TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Admin dapat melihat & mengatur semua profil
CREATE POLICY "profil_admin_manage" ON public.profil
    FOR ALL TO authenticated
    USING (public.akun_role() = 'admin')
    WITH CHECK (public.akun_role() = 'admin');

-- ---------------------------------------------------------------------
-- 3. FUNGSI BANTU (dipanggil dari policy; SECURITY DEFINER agar bebas RLS)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.akun_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT p.role FROM public.profil p WHERE p.id = auth.uid()),
        'admin'  -- belum dibuatkan profil => perilaku lama (full akses)
    );
$$;

CREATE OR REPLACE FUNCTION public.akun_lokasi()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT (SELECT p.lokasi_proyek FROM public.profil p WHERE p.id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.akun_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.akun_role() TO authenticated;
REVOKE ALL ON FUNCTION public.akun_lokasi() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.akun_lokasi() TO authenticated;

-- ---------------------------------------------------------------------
-- 4. GANTI POLICY LAMA -> BARU (role-aware)
--    (menghapus policy "authenticated_all_*" dari Fase 0)
-- ---------------------------------------------------------------------

-- MASTER RELAWAN
ALTER TABLE public.master_relawan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_master" ON public.master_relawan;

-- Admin: full
CREATE POLICY "akun_admin_master_full" ON public.master_relawan
    FOR ALL TO authenticated
    USING (public.akun_role() = 'admin')
    WITH CHECK (public.akun_role() = 'admin');

-- Koordinator: baca saja
CREATE POLICY "akun_koordinator_master_read" ON public.master_relawan
    FOR SELECT TO authenticated
    USING (public.akun_role() = 'koordinator');

-- LOG ABSENSI
ALTER TABLE public.log_absensi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_log" ON public.log_absensi;

-- Admin: full
CREATE POLICY "akun_admin_log_full" ON public.log_absensi
    FOR ALL TO authenticated
    USING (public.akun_role() = 'admin')
    WITH CHECK (public.akun_role() = 'admin');

-- Koordinator: baca + isi, hanya untuk lokasi proyeknya
CREATE POLICY "akun_koordinator_log_local" ON public.log_absensi
    FOR SELECT TO authenticated
    USING (public.akun_role() = 'koordinator' AND lokasi = public.akun_lokasi());

CREATE POLICY "akun_koordinator_log_insert_local" ON public.log_absensi
    FOR INSERT TO authenticated
    WITH CHECK (public.akun_role() = 'koordinator' AND lokasi = public.akun_lokasi());

-- ---------------------------------------------------------------------
-- 5. PERKUAT RPC insert_absensi_batch (koordinator tak boleh isi lokasi lain)
-- ---------------------------------------------------------------------
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

    -- Koordinator hanya boleh memasukkan data lokasi miliknya
    IF public.akun_role() = 'koordinator' THEN
        IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_logs) AS e
            WHERE COALESCE(e->>'lokasi','') IS DISTINCT FROM public.akun_lokasi()
        ) THEN
            RAISE EXCEPTION 'Lokasi tidak sesuai dengan akun koordinator';
        END IF;
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

-- ---------------------------------------------------------------------
-- 6. SEED CONTOH (jalankan manual setelah SQL ini berhasil)
-- ---------------------------------------------------------------------
-- (a) Isi tabel proyek dari lokasi yang pernah tercatat:
--     INSERT INTO public.proyek (nama)
--     SELECT DISTINCT lokasi FROM public.log_absensi
--     WHERE lokasi IS NOT NULL AND trim(lokasi) <> '';
--
-- (b) Jadikan akun Anda sebagai admin (ganti email):
--     INSERT INTO public.profil (id, nama, role, lokasi_proyek)
--     SELECT id, COALESCE(raw_user_meta_data->>'full_name', email)::text, 'admin', NULL
--     FROM auth.users
--     WHERE email = 'email.admin.pemakai@gmail.com';
--
-- (c) Koordinator per proyek (satu baris per koordinator):
--     INSERT INTO public.profil (id, nama, role, lokasi_proyek)
--     SELECT id, COALESCE(raw_user_meta_data->>'full_name', email)::text, 'koordinator', 'Pembesian'
--     FROM auth.users
--     WHERE email = 'koord.pembesian@gmail.com';
--
-- (d) Verifikasi:
--     SELECT p.nama, p.role, p.lokasi_proyek FROM public.profil p;
--     SELECT p.nama, p.role FROM public.profil p
--     JOIN public.log_absensi l ON p.role='koordinator' AND l.lokasi=p.lokasi_proyek LIMIT 5;
-- =====================================================================