-- =====================================================================
-- RELAWANSYNC V2 - FASE 23: PJ PROYEK TERBATAS
-- =====================================================================
-- Memastikan koordinator hanya dapat membaca personel dan kehadiran historis
-- yang terkait dengan lokasi proyek akun tersebut. Admin tetap tidak berubah.
-- Jalankan setelah Fase 22.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.akun_boleh_melihat_personel(p_nip text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE public.akun_role()
        WHEN 'admin' THEN true
        WHEN 'koordinator' THEN EXISTS (
            SELECT 1
            FROM public.log_absensi l
            WHERE l.nip = p_nip
              AND l.lokasi = public.akun_lokasi()
        )
        ELSE false
    END;
$$;

REVOKE ALL ON FUNCTION public.akun_boleh_melihat_personel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.akun_boleh_melihat_personel(text) TO authenticated;

DROP POLICY IF EXISTS master_operator_read ON public.master_relawan;
CREATE POLICY master_operator_read
ON public.master_relawan FOR SELECT TO authenticated
USING (public.akun_boleh_melihat_personel(nip));

DROP POLICY IF EXISTS historis_operator_read ON public.kehadiran_historis;
CREATE POLICY historis_operator_read
ON public.kehadiran_historis FOR SELECT TO authenticated
USING (
    public.akun_role() = 'admin'
    OR (
        public.akun_role() = 'koordinator'
        AND lokasi = public.akun_lokasi()
    )
);

DROP POLICY IF EXISTS stok_lama_operator_read ON public.stok_seragam;
DROP POLICY IF EXISTS stok_operator_read ON public.stok_item_seragam;
DROP POLICY IF EXISTS mutasi_operator_read ON public.mutasi_stok_seragam;
DROP POLICY IF EXISTS penerima_operator_read ON public.seragam_penerima;
DROP POLICY IF EXISTS riwayat_seragam_operator_read ON public.seragam_riwayat;

CREATE POLICY stok_lama_operator_read ON public.stok_seragam FOR SELECT TO authenticated
USING (public.akun_role() = 'admin');
CREATE POLICY stok_operator_read ON public.stok_item_seragam FOR SELECT TO authenticated
USING (public.akun_role() = 'admin');
CREATE POLICY mutasi_operator_read ON public.mutasi_stok_seragam FOR SELECT TO authenticated
USING (public.akun_role() = 'admin');
CREATE POLICY penerima_operator_read ON public.seragam_penerima FOR SELECT TO authenticated
USING (public.akun_role() = 'admin');
CREATE POLICY riwayat_seragam_operator_read ON public.seragam_riwayat FOR SELECT TO authenticated
USING (public.akun_role() = 'admin');

COMMIT;

SELECT policyname, tablename, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
      'master_relawan', 'kehadiran_historis', 'stok_seragam',
      'stok_item_seragam', 'mutasi_stok_seragam',
      'seragam_penerima', 'seragam_riwayat'
  )
ORDER BY tablename, policyname;
