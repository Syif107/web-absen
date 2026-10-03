-- =====================================================================
-- RELAWANSYNC V2 - FASE 15: AKSES ADMIN / KOORDINATOR (FAIL CLOSED)
-- =====================================================================
-- Jalankan SETELAH Fase 14. Migrasi ini mengubah kebijakan akses/RLS.
-- Bootstrap hanya berhasil bila auth.users tepat berisi satu akun; akun itu
-- dijadikan admin tanpa menuliskan email atau kata sandi di berkas ini.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.proyek (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nama text NOT NULL UNIQUE,
    aktif boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profil (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nama text,
    role text NOT NULL DEFAULT 'koordinator',
    lokasi_proyek text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profil DROP CONSTRAINT IF EXISTS profil_role_check;
ALTER TABLE public.profil DROP CONSTRAINT IF EXISTS profil_koordinator_wajib_lokasi;
ALTER TABLE public.profil ADD CONSTRAINT profil_role_check
    CHECK (role IN ('admin', 'koordinator', 'blocked'));
ALTER TABLE public.profil ADD CONSTRAINT profil_koordinator_wajib_lokasi
    CHECK (role <> 'koordinator' OR NULLIF(trim(lokasi_proyek), '') IS NOT NULL);

CREATE OR REPLACE FUNCTION public.akun_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE((SELECT role FROM public.profil WHERE id = auth.uid()), 'blocked'); $$;

CREATE OR REPLACE FUNCTION public.akun_lokasi()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT (SELECT lokasi_proyek FROM public.profil WHERE id = auth.uid()); $$;

REVOKE ALL ON FUNCTION public.akun_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.akun_lokasi() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.akun_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.akun_lokasi() TO authenticated;

DO $$
DECLARE
    v_jumlah integer;
    v_admin auth.users%ROWTYPE;
BEGIN
    SELECT count(*)::integer INTO v_jumlah FROM auth.users;
    IF v_jumlah <> 1 THEN
        RAISE EXCEPTION 'Bootstrap aman membutuhkan tepat 1 akun Auth; ditemukan % akun', v_jumlah;
    END IF;
    SELECT * INTO v_admin FROM auth.users ORDER BY created_at ASC LIMIT 1;
    INSERT INTO public.profil (id, nama, role, lokasi_proyek)
    VALUES (
        v_admin.id,
        COALESCE(NULLIF(v_admin.raw_user_meta_data->>'full_name', ''), split_part(v_admin.email, '@', 1)),
        'admin', NULL
    )
    ON CONFLICT (id) DO UPDATE
       SET role = 'admin', lokasi_proyek = NULL, updated_at = now();
END;
$$;

ALTER TABLE public.profil ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proyek ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_relawan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.log_absensi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proyek_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisasi_kabupaten_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kehadiran_historis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.koreksi_kehadiran_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stok_seragam ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stok_item_seragam ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mutasi_stok_seragam ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seragam_penerima ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seragam_riwayat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riwayat_merge_personel ENABLE ROW LEVEL SECURITY;

-- Hilangkan policy lama yang memberikan seluruh akun authenticated hak penuh.
DO $$
DECLARE p record;
BEGIN
    FOR p IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
              'profil','proyek','master_relawan','log_absensi','proyek_ref',
              'organisasi_kabupaten_map','kehadiran_historis','koreksi_kehadiran_batch',
              'stok_seragam','stok_item_seragam','mutasi_stok_seragam',
              'seragam_penerima','seragam_riwayat','riwayat_merge_personel'
          )
    LOOP
        EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    END LOOP;
END;
$$;

CREATE POLICY profil_self_read ON public.profil FOR SELECT TO authenticated
    USING (id = auth.uid());
CREATE POLICY profil_admin_manage ON public.profil FOR ALL TO authenticated
    USING ((SELECT public.akun_role()) = 'admin') WITH CHECK ((SELECT public.akun_role()) = 'admin');

CREATE POLICY proyek_operator_read ON public.proyek FOR SELECT TO authenticated
    USING ((SELECT public.akun_role()) IN ('admin','koordinator'));
CREATE POLICY proyek_admin_manage ON public.proyek FOR ALL TO authenticated
    USING ((SELECT public.akun_role()) = 'admin') WITH CHECK ((SELECT public.akun_role()) = 'admin');

CREATE POLICY master_operator_read ON public.master_relawan FOR SELECT TO authenticated
    USING ((SELECT public.akun_role()) IN ('admin','koordinator'));
CREATE POLICY master_admin_write ON public.master_relawan FOR ALL TO authenticated
    USING ((SELECT public.akun_role()) = 'admin') WITH CHECK ((SELECT public.akun_role()) = 'admin');

CREATE POLICY log_admin_all ON public.log_absensi FOR ALL TO authenticated
    USING ((SELECT public.akun_role()) = 'admin') WITH CHECK ((SELECT public.akun_role()) = 'admin');
CREATE POLICY log_koordinator_read ON public.log_absensi FOR SELECT TO authenticated
    USING ((SELECT public.akun_role()) = 'koordinator' AND lokasi = (SELECT public.akun_lokasi()));
CREATE POLICY log_koordinator_insert ON public.log_absensi FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.akun_role()) = 'koordinator' AND lokasi = (SELECT public.akun_lokasi()));

CREATE POLICY proyek_ref_operator_read ON public.proyek_ref FOR SELECT TO authenticated
    USING ((SELECT public.akun_role()) IN ('admin','koordinator'));
CREATE POLICY proyek_ref_admin_write ON public.proyek_ref FOR ALL TO authenticated
    USING ((SELECT public.akun_role()) = 'admin') WITH CHECK ((SELECT public.akun_role()) = 'admin');

CREATE POLICY org_map_operator_read ON public.organisasi_kabupaten_map FOR SELECT TO authenticated
    USING ((SELECT public.akun_role()) IN ('admin','koordinator'));
CREATE POLICY org_map_admin_write ON public.organisasi_kabupaten_map FOR ALL TO authenticated
    USING ((SELECT public.akun_role()) = 'admin') WITH CHECK ((SELECT public.akun_role()) = 'admin');

CREATE POLICY historis_operator_read ON public.kehadiran_historis FOR SELECT TO authenticated
    USING ((SELECT public.akun_role()) IN ('admin','koordinator'));
CREATE POLICY historis_admin_write ON public.kehadiran_historis FOR ALL TO authenticated
    USING ((SELECT public.akun_role()) = 'admin') WITH CHECK ((SELECT public.akun_role()) = 'admin');

CREATE POLICY koreksi_admin_all ON public.koreksi_kehadiran_batch FOR ALL TO authenticated
    USING ((SELECT public.akun_role()) = 'admin') WITH CHECK ((SELECT public.akun_role()) = 'admin');

CREATE POLICY stok_lama_operator_read ON public.stok_seragam FOR SELECT TO authenticated
    USING ((SELECT public.akun_role()) IN ('admin','koordinator'));
CREATE POLICY stok_lama_admin_write ON public.stok_seragam FOR ALL TO authenticated
    USING ((SELECT public.akun_role()) = 'admin') WITH CHECK ((SELECT public.akun_role()) = 'admin');
CREATE POLICY stok_operator_read ON public.stok_item_seragam FOR SELECT TO authenticated
    USING ((SELECT public.akun_role()) IN ('admin','koordinator'));
CREATE POLICY stok_admin_write ON public.stok_item_seragam FOR ALL TO authenticated
    USING ((SELECT public.akun_role()) = 'admin') WITH CHECK ((SELECT public.akun_role()) = 'admin');
CREATE POLICY mutasi_operator_read ON public.mutasi_stok_seragam FOR SELECT TO authenticated
    USING ((SELECT public.akun_role()) IN ('admin','koordinator'));
CREATE POLICY mutasi_admin_write ON public.mutasi_stok_seragam FOR ALL TO authenticated
    USING ((SELECT public.akun_role()) = 'admin') WITH CHECK ((SELECT public.akun_role()) = 'admin');
CREATE POLICY penerima_operator_read ON public.seragam_penerima FOR SELECT TO authenticated
    USING ((SELECT public.akun_role()) IN ('admin','koordinator'));
CREATE POLICY penerima_admin_write ON public.seragam_penerima FOR ALL TO authenticated
    USING ((SELECT public.akun_role()) = 'admin') WITH CHECK ((SELECT public.akun_role()) = 'admin');
CREATE POLICY riwayat_seragam_operator_read ON public.seragam_riwayat FOR SELECT TO authenticated
    USING ((SELECT public.akun_role()) IN ('admin','koordinator'));
CREATE POLICY riwayat_merge_admin_read ON public.riwayat_merge_personel FOR SELECT TO authenticated
    USING ((SELECT public.akun_role()) = 'admin');

GRANT SELECT ON public.profil, public.proyek, public.master_relawan,
    public.log_absensi, public.proyek_ref, public.organisasi_kabupaten_map,
    public.kehadiran_historis, public.koreksi_kehadiran_batch,
    public.stok_seragam, public.stok_item_seragam, public.mutasi_stok_seragam,
    public.seragam_penerima, public.seragam_riwayat,
    public.riwayat_merge_personel TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.log_absensi TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.profil, public.proyek, public.master_relawan,
    public.proyek_ref, public.organisasi_kabupaten_map, public.kehadiran_historis,
    public.koreksi_kehadiran_batch, public.stok_seragam, public.stok_item_seragam,
    public.mutasi_stok_seragam, public.seragam_penerima TO authenticated;

COMMIT;

SELECT role, count(*)::integer AS jumlah
FROM public.profil
GROUP BY role
ORDER BY role;
