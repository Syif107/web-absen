-- =====================================================================
-- RELAWANSYNC V2 - FASE 4: MULTI-USER ADMIN + KOORDINATOR
-- =====================================================================
-- PRASYARAT:
--   1. Jalankan db/fase0_keamanan.sql dan db/fase5_integritas_transaksi.sql.
--   2. Ganti GANTI_EMAIL_ADMIN pada bagian BOOTSTRAP di bawah.
--   3. Jalankan file ini di Supabase SQL Editor dan cek hasil verifikasi.
--   4. Baru ubah FASE4_ENABLED menjadi true di js/supabase-config.js.
--
-- Kebijakan bersifat FAIL CLOSED: akun tanpa profil memiliki role "blocked",
-- bukan admin. Public signup tetap harus dimatikan di Supabase Auth Settings.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.proyek (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nama        text NOT NULL UNIQUE,
    aktif       boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profil (
    id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nama            text,
    role            text NOT NULL DEFAULT 'koordinator'
                    CHECK (role IN ('admin', 'koordinator', 'blocked')),
    lokasi_proyek   text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profil_koordinator_wajib_lokasi CHECK (
        role <> 'koordinator' OR NULLIF(trim(lokasi_proyek), '') IS NOT NULL
    )
);

-- Membawa instalasi Fase 4 lama ke bentuk terbaru secara idempoten.
ALTER TABLE public.profil
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.profil DROP CONSTRAINT IF EXISTS profil_role_check;
ALTER TABLE public.profil DROP CONSTRAINT IF EXISTS profil_koordinator_wajib_lokasi;
ALTER TABLE public.profil
    ADD CONSTRAINT profil_role_check CHECK (role IN ('admin', 'koordinator', 'blocked'));
ALTER TABLE public.profil
    ADD CONSTRAINT profil_koordinator_wajib_lokasi CHECK (
        role <> 'koordinator' OR NULLIF(trim(lokasi_proyek), '') IS NOT NULL
    );

-- Fungsi akses harus tersedia sebelum policy yang memanggilnya.
CREATE OR REPLACE FUNCTION public.akun_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT p.role FROM public.profil p WHERE p.id = auth.uid()),
        'blocked'
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

-- Bootstrap admin pertama. Migrasi berhenti sebelum policy lama diganti bila
-- email belum disesuaikan atau akun belum ada di Supabase Auth.
DO $$
DECLARE
    v_admin_email constant text := 'GANTI_EMAIL_ADMIN';
    v_admin_id uuid;
BEGIN
    IF v_admin_email = 'GANTI_EMAIL_ADMIN' THEN
        RAISE EXCEPTION 'Ganti GANTI_EMAIL_ADMIN dengan email admin resmi sebelum menjalankan migrasi';
    END IF;

    SELECT id INTO v_admin_id FROM auth.users WHERE lower(email) = lower(v_admin_email);
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Akun admin % belum ditemukan di Supabase Auth', v_admin_email;
    END IF;

    INSERT INTO public.profil (id, nama, role, lokasi_proyek)
    SELECT id, COALESCE(raw_user_meta_data->>'full_name', email), 'admin', NULL
    FROM auth.users
    WHERE id = v_admin_id
    ON CONFLICT (id) DO UPDATE
        SET role = 'admin', lokasi_proyek = NULL, updated_at = now();
END;
$$;

ALTER TABLE public.profil ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proyek ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profil_owner_all" ON public.profil;
DROP POLICY IF EXISTS "profil_admin_manage" ON public.profil;
DROP POLICY IF EXISTS "profil_self_read" ON public.profil;
CREATE POLICY "profil_self_read" ON public.profil
    FOR SELECT TO authenticated
    USING (id = auth.uid());
CREATE POLICY "profil_admin_manage" ON public.profil
    FOR ALL TO authenticated
    USING (public.akun_role() = 'admin')
    WITH CHECK (public.akun_role() = 'admin');

DROP POLICY IF EXISTS "proyek_authenticated_read" ON public.proyek;
DROP POLICY IF EXISTS "proyek_admin_manage" ON public.proyek;
CREATE POLICY "proyek_authenticated_read" ON public.proyek
    FOR SELECT TO authenticated
    USING (public.akun_role() IN ('admin', 'koordinator') AND aktif = true);
CREATE POLICY "proyek_admin_manage" ON public.proyek
    FOR ALL TO authenticated
    USING (public.akun_role() = 'admin')
    WITH CHECK (public.akun_role() = 'admin');

ALTER TABLE public.master_relawan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.log_absensi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_master" ON public.master_relawan;
DROP POLICY IF EXISTS "authenticated_whitelist_master" ON public.master_relawan;
DROP POLICY IF EXISTS "akun_admin_master_full" ON public.master_relawan;
DROP POLICY IF EXISTS "akun_koordinator_master_read" ON public.master_relawan;
CREATE POLICY "akun_admin_master_full" ON public.master_relawan
    FOR ALL TO authenticated
    USING (public.akun_role() = 'admin')
    WITH CHECK (public.akun_role() = 'admin');
CREATE POLICY "akun_koordinator_master_read" ON public.master_relawan
    FOR SELECT TO authenticated
    USING (public.akun_role() = 'koordinator');

DROP POLICY IF EXISTS "authenticated_all_log" ON public.log_absensi;
DROP POLICY IF EXISTS "authenticated_whitelist_log" ON public.log_absensi;
DROP POLICY IF EXISTS "akun_admin_log_full" ON public.log_absensi;
DROP POLICY IF EXISTS "akun_koordinator_log_local" ON public.log_absensi;
DROP POLICY IF EXISTS "akun_koordinator_log_insert_local" ON public.log_absensi;
CREATE POLICY "akun_admin_log_full" ON public.log_absensi
    FOR ALL TO authenticated
    USING (public.akun_role() = 'admin')
    WITH CHECK (public.akun_role() = 'admin');
CREATE POLICY "akun_koordinator_log_local" ON public.log_absensi
    FOR SELECT TO authenticated
    USING (public.akun_role() = 'koordinator' AND lokasi = public.akun_lokasi());
CREATE POLICY "akun_koordinator_log_insert_local" ON public.log_absensi
    FOR INSERT TO authenticated
    WITH CHECK (public.akun_role() = 'koordinator' AND lokasi = public.akun_lokasi());

-- Audit append-only untuk perubahan penting. Tabel ini tidak mempunyai policy
-- INSERT/UPDATE/DELETE bagi client; penulisan hanya melalui trigger definer.
CREATE TABLE IF NOT EXISTS public.audit_perubahan (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    terjadi_pada    timestamptz NOT NULL DEFAULT now(),
    user_id         uuid,
    email           text,
    tabel           text NOT NULL,
    operasi         text NOT NULL CHECK (operasi IN ('INSERT', 'UPDATE', 'DELETE')),
    kunci           jsonb NOT NULL DEFAULT '{}'::jsonb,
    data_lama       jsonb,
    data_baru       jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_perubahan_waktu
    ON public.audit_perubahan (terjadi_pada DESC);
CREATE INDEX IF NOT EXISTS idx_audit_perubahan_tabel
    ON public.audit_perubahan (tabel, terjadi_pada DESC);

ALTER TABLE public.audit_perubahan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_admin_read" ON public.audit_perubahan;
CREATE POLICY "audit_admin_read" ON public.audit_perubahan
    FOR SELECT TO authenticated
    USING (public.akun_role() = 'admin');

REVOKE ALL ON TABLE public.audit_perubahan FROM anon, authenticated;
GRANT SELECT ON TABLE public.audit_perubahan TO authenticated;

CREATE OR REPLACE FUNCTION public.catat_audit_perubahan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old jsonb;
    v_new jsonb;
    v_key jsonb;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;

    IF TG_TABLE_NAME = 'profil' THEN
        v_key := jsonb_build_object('id', COALESCE(v_new->>'id', v_old->>'id'));
    ELSIF TG_TABLE_NAME = 'master_relawan' THEN
        v_key := jsonb_build_object('nip', COALESCE(v_new->>'nip', v_old->>'nip'));
    ELSE
        v_key := jsonb_build_object(
            'id', COALESCE(v_new->>'id', v_old->>'id'),
            'nip', COALESCE(v_new->>'nip', v_old->>'nip')
        );
    END IF;

    INSERT INTO public.audit_perubahan (
        user_id, email, tabel, operasi, kunci, data_lama, data_baru
    ) VALUES (
        auth.uid(), auth.jwt()->>'email', TG_TABLE_NAME, TG_OP,
        v_key, v_old, v_new
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.catat_audit_perubahan() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_master_relawan ON public.master_relawan;
CREATE TRIGGER trg_audit_master_relawan
AFTER INSERT OR UPDATE OR DELETE ON public.master_relawan
FOR EACH ROW EXECUTE FUNCTION public.catat_audit_perubahan();

DROP TRIGGER IF EXISTS trg_audit_log_absensi ON public.log_absensi;
CREATE TRIGGER trg_audit_log_absensi
AFTER INSERT OR UPDATE OR DELETE ON public.log_absensi
FOR EACH ROW EXECUTE FUNCTION public.catat_audit_perubahan();

DROP TRIGGER IF EXISTS trg_audit_profil ON public.profil;
CREATE TRIGGER trg_audit_profil
AFTER INSERT OR UPDATE OR DELETE ON public.profil
FOR EACH ROW EXECUTE FUNCTION public.catat_audit_perubahan();

-- RPC atomik dan role-aware. Unique index dari Fase 5 menjadi pagar terakhir
-- ketika dua perangkat mengirim batch yang sama secara bersamaan.
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
    v_role            text;
    v_tanggal         date;
    v_sesi            text;
    v_nama            text;
    v_lokasi          text;
    v_nip             text;
    v_existing_name   text;
BEGIN
    v_role := public.akun_role();
    IF v_role NOT IN ('admin', 'koordinator') THEN
        RAISE EXCEPTION 'Akun tidak memiliki akses operasional';
    END IF;

    IF p_logs IS NULL OR jsonb_typeof(p_logs) <> 'array' OR jsonb_array_length(p_logs) = 0 THEN
        RAISE EXCEPTION 'p_logs harus berupa array JSON yang tidak kosong';
    END IF;
    p_master_baru := COALESCE(p_master_baru, '[]'::jsonb);
    IF jsonb_typeof(p_master_baru) <> 'array' THEN
        RAISE EXCEPTION 'p_master_baru harus berupa array JSON';
    END IF;

    IF v_role = 'koordinator' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_logs) AS e
        WHERE COALESCE(e->>'lokasi', '') IS DISTINCT FROM public.akun_lokasi()
    ) THEN
        RAISE EXCEPTION 'Lokasi tidak sesuai dengan akun koordinator';
    END IF;

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
            v_nip, v_nama,
            COALESCE(NULLIF(trim(master_item->>'jabatan'), ''), 'Helper'),
            COALESCE(NULLIF(trim(master_item->>'asal_organisasi'), ''), 'Umum')
        )
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected = 1 THEN master_inserted := master_inserted + 1;
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
                v_tanggal, v_sesi, v_lokasi, v_nip, v_nama,
                COALESCE(NULLIF(trim(item->>'bidang'), ''), 'Helper'),
                COALESCE(NULLIF(trim(item->>'organisasi'), ''), 'Umum')
            )
            ON CONFLICT DO NOTHING;
            GET DIAGNOSTICS affected = ROW_COUNT;
            IF affected = 1 THEN inserted := inserted + 1;
            ELSE skipped := skipped + 1;
            END IF;
        ELSE
            INSERT INTO public.log_absensi (tanggal, sesi, lokasi, nip, nama, bidang, organisasi)
            VALUES (
                v_tanggal, v_sesi, v_lokasi, v_nip, v_nama,
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
    IF public.akun_role() <> 'admin' THEN
        RAISE EXCEPTION 'Hanya admin yang boleh mengimport Master Data';
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

-- SECURITY DEFINER wajib memeriksa role di dalam fungsi; RLS saja tidak cukup.
CREATE OR REPLACE FUNCTION public.merge_relawan(p_sumber_nip text, p_target_nip text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target  public.master_relawan%ROWTYPE;
    v_updated integer;
BEGIN
    IF public.akun_role() <> 'admin' THEN
        RAISE EXCEPTION 'Hanya admin yang boleh menggabungkan relawan';
    END IF;
    IF p_sumber_nip IS NULL OR p_target_nip IS NULL OR p_sumber_nip = p_target_nip THEN
        RAISE EXCEPTION 'NIP sumber dan target tidak valid';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.master_relawan WHERE nip = p_sumber_nip) THEN
        RAISE EXCEPTION 'NIP sumber % tidak ditemukan', p_sumber_nip;
    END IF;
    SELECT * INTO v_target FROM public.master_relawan WHERE nip = p_target_nip;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NIP target % tidak ditemukan', p_target_nip;
    END IF;

    UPDATE public.log_absensi
       SET nip = v_target.nip,
           nama = v_target.nama,
           bidang = v_target.jabatan,
           organisasi = v_target.asal_organisasi
     WHERE nip = p_sumber_nip;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
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

-- Seed contoh koordinator (jalankan terpisah setelah migrasi berhasil):
-- INSERT INTO public.profil (id, nama, role, lokasi_proyek)
-- SELECT id, COALESCE(raw_user_meta_data->>'full_name', email),
--        'koordinator', 'Pembesian'
-- FROM auth.users
-- WHERE lower(email) = lower('EMAIL_KOORDINATOR')
-- ON CONFLICT (id) DO UPDATE
-- SET role = 'koordinator', lokasi_proyek = 'Pembesian', updated_at = now();

SELECT p.nama, p.role, p.lokasi_proyek
FROM public.profil p
ORDER BY p.role, p.nama;
