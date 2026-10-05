-- =====================================================================
-- RELAWANSYNC V2 - FASE 20: PENYERAGAMAN PERSONEL, ZONA, DAN SERAGAM
-- =====================================================================
-- Jalankan setelah Fase 19. Migrasi ini menjadikan satu kontrak data untuk
-- Master, Input, Dashboard, Statistik, Peringkat, Seragam, dan ekspor.
-- Data lama dicadangkan sebelum normalisasi. Tidak ada absensi yang dihapus.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.backup_fase20_master_relawan_20261005 AS
TABLE public.master_relawan;
CREATE TABLE IF NOT EXISTS public.backup_fase20_seragam_penerima_20261005 AS
TABLE public.seragam_penerima;
ALTER TABLE public.backup_fase20_master_relawan_20261005 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_fase20_seragam_penerima_20261005 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_fase20_master_relawan_20261005 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.backup_fase20_seragam_penerima_20261005 FROM PUBLIC, anon, authenticated;

ALTER TABLE public.master_relawan
    ADD COLUMN IF NOT EXISTS ukuran_bawahan_seragam text;

-- Satu resolver digunakan oleh trigger, RPC simpan, audit, dan migrasi data.
CREATE OR REPLACE FUNCTION public.wilayah_personel_terpadu(
    p_kabupaten text,
    p_asal_daerah text,
    p_organisasi text,
    p_zona_manual text DEFAULT NULL
)
RETURNS TABLE (
    kabupaten_baku text,
    provinsi_baku text,
    zona_baku text,
    kategori_baku text
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_org text := public.normalisasi_label(coalesce(p_organisasi, ''));
    v_kab text := nullif(public.normalisasi_label(coalesce(nullif(trim(p_kabupaten), ''), p_asal_daerah)), '');
    v_kab_map text;
    v_provinsi_map text;
    v_zona_map text;
    v_provinsi text;
    v_zona_daerah text;
    v_zona text;
    v_kategori text;
BEGIN
    SELECT nullif(public.normalisasi_label(o.kabupaten), ''),
           nullif(public.normalisasi_label(o.provinsi), ''), o.zona_asal
      INTO v_kab_map, v_provinsi_map, v_zona_map
    FROM public.organisasi_kabupaten_map o
    WHERE o.organisasi_key = v_org AND o.aktif
    LIMIT 1;

    IF v_kab IS NULL OR v_kab = 'BELUM DIISI' THEN
        v_kab := v_kab_map;
    END IF;
    IF (v_kab IS NULL OR v_kab = 'BELUM DIISI') AND v_org = 'PUSAT' THEN
        v_kab := 'JOMBANG';
    END IF;

    v_provinsi := coalesce(public.provinsi_dari_daerah(v_kab), v_provinsi_map);
    v_zona_daerah := public.zona_otomatis_dari_daerah(v_kab, NULL, v_provinsi);
    -- Kabupaten/kota yang dikenali selalu lebih kuat daripada pilihan lama.
    v_zona := coalesce(v_zona_daerah, v_zona_map, nullif(trim(p_zona_manual), ''),
                       public.zona_otomatis_dari_daerah(NULL, p_organisasi, NULL));

    IF v_zona = 'zona_4' THEN
        v_kategori := 'zona_4';
    ELSIF coalesce(v_kab, '') ~ '(^| )JOMBANG( |$)' THEN
        v_kategori := 'jombang';
    ELSIF v_kab IS NOT NULL AND v_kab <> 'BELUM DIISI' THEN
        v_kategori := 'luar_jombang';
    ELSIF v_org = 'PUSAT' THEN
        v_kategori := 'jombang';
    ELSIF v_zona IS NOT NULL THEN
        v_kategori := 'luar_jombang';
    ELSE
        v_kategori := 'belum_dilengkapi';
    END IF;

    RETURN QUERY SELECT nullif(v_kab, 'BELUM DIISI'), v_provinsi, v_zona, v_kategori;
END;
$$;

CREATE OR REPLACE FUNCTION public.terapkan_zona_personel_otomatis()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v record;
BEGIN
    SELECT * INTO v FROM public.wilayah_personel_terpadu(
        NEW.kabupaten_normalisasi, NEW.asal_daerah, NEW.asal_organisasi, NEW.zona_asal
    );
    NEW.kabupaten_normalisasi := v.kabupaten_baku;
    NEW.zona_asal := v.zona_baku;
    NEW.kategori_wilayah := v.kategori_baku;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_personel_zona_otomatis ON public.master_relawan;
CREATE TRIGGER trg_personel_zona_otomatis
BEFORE INSERT OR UPDATE OF asal_organisasi, asal_daerah, kabupaten_normalisasi,
    zona_asal, kategori_wilayah
ON public.master_relawan
FOR EACH ROW EXECUTE FUNCTION public.terapkan_zona_personel_otomatis();

-- Seragam operasional dan preferensi Master tetap mempunyai ukuran yang sama.
CREATE OR REPLACE FUNCTION public.sinkronkan_ukuran_seragam_master()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    UPDATE public.master_relawan
    SET ukuran_seragam = coalesce(nullif(trim(NEW.ukuran_atasan), ''), ukuran_seragam),
        ukuran_bawahan_seragam = coalesce(nullif(trim(NEW.ukuran_bawahan), ''), ukuran_bawahan_seragam)
    WHERE nip = NEW.nip;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sinkron_ukuran_seragam_master ON public.seragam_penerima;
CREATE TRIGGER trg_sinkron_ukuran_seragam_master
AFTER INSERT OR UPDATE OF ukuran_atasan, ukuran_bawahan
ON public.seragam_penerima
FOR EACH ROW EXECUTE FUNCTION public.sinkronkan_ukuran_seragam_master();

-- Rapikan data wilayah yang sudah ada menggunakan resolver yang sama.
WITH resolved AS (
    SELECT m.nip, w.*
    FROM public.master_relawan m
    CROSS JOIN LATERAL public.wilayah_personel_terpadu(
        m.kabupaten_normalisasi, m.asal_daerah, m.asal_organisasi, m.zona_asal
    ) w
)
UPDATE public.master_relawan m
SET kabupaten_normalisasi = r.kabupaten_baku,
    zona_asal = r.zona_baku,
    kategori_wilayah = r.kategori_baku
FROM resolved r
WHERE r.nip = m.nip
  AND (m.kabupaten_normalisasi IS DISTINCT FROM r.kabupaten_baku
    OR m.zona_asal IS DISTINCT FROM r.zona_baku
    OR m.kategori_wilayah IS DISTINCT FROM r.kategori_baku);

UPDATE public.master_relawan m
SET ukuran_seragam = coalesce(nullif(trim(sp.ukuran_atasan), ''), m.ukuran_seragam),
    ukuran_bawahan_seragam = coalesce(nullif(trim(sp.ukuran_bawahan), ''), m.ukuran_bawahan_seragam)
FROM public.seragam_penerima sp
WHERE sp.nip = m.nip
  AND (sp.ukuran_atasan IS NOT NULL OR sp.ukuran_bawahan IS NOT NULL);

-- Sumber profil tunggal untuk seluruh frontend.
CREATE OR REPLACE VIEW public.v_personel_terpadu_v3
WITH (security_invoker = true)
AS
SELECT r.*,
       m.ukuran_bawahan_seragam,
       coalesce(sp.ukuran_atasan, sp.ukuran_dibutuhkan, m.ukuran_seragam) AS ukuran_atasan_efektif,
       coalesce(sp.ukuran_bawahan, m.ukuran_bawahan_seragam) AS ukuran_bawahan_efektif,
       sp.kode_atasan, sp.kode_bawahan,
       sp.status_proses AS status_seragam,
       sp.status_penguasaan AS penguasaan_seragam,
       CASE m.zona_asal
           WHEN 'zona_1' THEN 'Zona 1 — Jawa Timur & Bali'
           WHEN 'zona_2' THEN 'Zona 2 — Jawa Tengah & DIY'
           WHEN 'zona_3' THEN 'Zona 3 — Jawa Barat, Jakarta & Banten'
           WHEN 'zona_4' THEN 'Zona 4 — Sumatera & Kalimantan'
           ELSE 'Zona belum diisi'
       END AS zona_label,
       CASE WHEN m.kategori_personel = 'khusus' THEN 'Khusus' ELSE 'Reguler' END AS jenis_personel_label
FROM public.v_ringkasan_personel r
JOIN public.master_relawan m ON m.nip = r.nip
LEFT JOIN public.seragam_penerima sp ON sp.nip = r.nip;

-- View seragam lama dipertahankan namanya agar router cepat tetap kompatibel,
-- tetapi kini membaca ukuran bawah Master dan kontrak zona terbaru.
CREATE OR REPLACE VIEW public.v_status_seragam_set_v2
WITH (security_invoker = true)
AS
WITH eligible AS (
    SELECT * FROM (
        SELECT r.*, row_number() OVER (
            PARTITION BY r.nip
            ORDER BY CASE WHEN r.zona_asal = 'zona_4' THEN 0 ELSE 1 END,
                     r.tanggal_memenuhi ASC NULLS LAST, r.indeks_keaktifan DESC
        ) AS pilihan
        FROM public.v_peringkat_personel_operasional_v2 r
        JOIN public.master_relawan mr ON mr.nip = r.nip AND mr.kategori_personel = 'reguler'
        WHERE r.memenuhi_syarat
    ) x WHERE pilihan = 1
), last_attendance AS (
    SELECT nip, max(tanggal) AS tanggal_terakhir
    FROM public.v_log_absensi_operasional WHERE terhubung GROUP BY nip
), base AS (
    SELECT m.*,
        ((NULLIF(upper(trim(m.kabupaten_normalisasi)), '') IS NOT NULL
          AND upper(trim(m.kabupaten_normalisasi)) <> 'JOMBANG')
          OR m.kategori_wilayah IN ('luar_jombang', 'zona_4')) AS luar_jombang
    FROM public.master_relawan m
)
SELECT
    m.nip, m.nama, m.asal_organisasi, m.asal_daerah,
    m.kabupaten_normalisasi AS kabupaten,
    m.kategori_wilayah, m.zona_asal, m.ukuran_seragam, m.luar_jombang,
    coalesce(e.memenuhi_syarat, false) AS memenuhi_syarat,
    e.tanggal_memenuhi,
    CASE WHEN m.zona_asal = 'zona_4' THEN 'zona_4' ELSE e.kategori END AS jalur_kelayakan,
    e.indeks_keaktifan, e.peringkat,
    coalesce(sp.status_proses, CASE WHEN e.memenuhi_syarat THEN 'memenuhi_syarat' ELSE 'belum_memenuhi' END) AS status_proses,
    coalesce(sp.ukuran_atasan, sp.ukuran_dibutuhkan, m.ukuran_seragam) AS ukuran_dibutuhkan,
    coalesce(sp.kode_atasan, sp.kode_seragam) AS kode_seragam,
    CASE WHEN sp.status_penguasaan = 'dititipkan_kantor' AND m.luar_jombang
              AND la.tanggal_terakhir > sp.tanggal_status::date
         THEN 'perlu_diserahkan_kembali'
         ELSE coalesce(sp.status_penguasaan, 'belum_memiliki') END AS status_penguasaan,
    (sp.status_penguasaan = 'dititipkan_kantor' AND m.luar_jombang
      AND la.tanggal_terakhir > sp.tanggal_status::date) AS notifikasi_pengembalian,
    sp.tanggal_rencana, sp.tanggal_diserahkan, sp.tanggal_status,
    sp.aturan_disetujui, sp.data_lama, sp.catatan,
    (sp.nip IS NOT NULL) AS record_tersimpan,
    la.tanggal_terakhir AS tanggal_hadir_terakhir,
    (sp.status_proses = 'sudah_diserahkan'
      AND coalesce(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date) IS NOT NULL
      AND coalesce(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date) <= current_date - 30) AS tidak_hadir_30_hari,
    CASE WHEN sp.status_proses = 'sudah_diserahkan'
              AND coalesce(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date) IS NOT NULL
         THEN greatest(0, current_date - coalesce(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date))
         ELSE 0 END::integer AS hari_tidak_hadir,
    coalesce(sp.ukuran_atasan, m.ukuran_seragam) AS ukuran_atasan,
    coalesce(sp.ukuran_bawahan, m.ukuran_bawahan_seragam) AS ukuran_bawahan,
    sp.kode_atasan, sp.kode_bawahan,
    m.kategori_personel, m.jabatan_khusus,
    (m.kategori_personel = 'khusus') AS pengecualian_aturan,
    sp.tanggal_efektif_status,
    (sp.tanggal_efektif_status > now()) AS status_terjadwal
FROM base m
LEFT JOIN eligible e ON e.nip = m.nip
LEFT JOIN public.seragam_penerima sp ON sp.nip = m.nip
LEFT JOIN last_attendance la ON la.nip = m.nip;

-- Tambah dan edit memakai RPC yang sama; trigger memastikan zona konsisten.
CREATE OR REPLACE FUNCTION public.simpan_personel_v3(
    p_nip text DEFAULT NULL,
    p_nama text DEFAULT NULL,
    p_jabatan text DEFAULT NULL,
    p_asal_organisasi text DEFAULT NULL,
    p_asal_daerah text DEFAULT NULL,
    p_kabupaten text DEFAULT NULL,
    p_kategori_wilayah text DEFAULT 'belum_dilengkapi',
    p_zona_asal text DEFAULT NULL,
    p_ukuran_atasan text DEFAULT NULL,
    p_ukuran_bawahan text DEFAULT NULL,
    p_catatan_seragam text DEFAULT NULL,
    p_kategori_personel text DEFAULT 'reguler',
    p_jabatan_khusus text DEFAULT NULL,
    p_alasan_khusus text DEFAULT NULL,
    p_buat_baru boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_nip text := nullif(trim(p_nip), '');
BEGIN
    IF NOT public.fase17_admin() THEN RAISE EXCEPTION 'Hanya admin yang boleh menyimpan personel'; END IF;
    IF nullif(trim(p_nama), '') IS NULL THEN RAISE EXCEPTION 'Nama wajib diisi'; END IF;
    IF coalesce(p_kategori_personel, 'reguler') NOT IN ('reguler','khusus') THEN
        RAISE EXCEPTION 'Kategori personel tidak valid';
    END IF;

    IF p_buat_baru THEN
        IF v_nip IS NULL THEN
            v_nip := 'REL-MANUAL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
        END IF;
        IF EXISTS (SELECT 1 FROM public.master_relawan WHERE nip = v_nip) THEN
            RAISE EXCEPTION 'NIP / ID sudah digunakan';
        END IF;
        INSERT INTO public.master_relawan (
            nip, nama, jabatan, asal_organisasi, asal_daerah, kabupaten_normalisasi,
            kategori_wilayah, zona_asal, ukuran_seragam, ukuran_bawahan_seragam,
            catatan_seragam, kategori_personel, jabatan_khusus, alasan_khusus
        ) VALUES (
            v_nip, upper(trim(p_nama)), coalesce(nullif(trim(p_jabatan), ''), 'BELUM DIISI'),
            upper(trim(coalesce(p_asal_organisasi, 'BELUM DIISI'))), nullif(trim(p_asal_daerah), ''),
            nullif(upper(trim(p_kabupaten)), ''), coalesce(nullif(trim(p_kategori_wilayah), ''), 'belum_dilengkapi'),
            nullif(trim(p_zona_asal), ''), nullif(trim(p_ukuran_atasan), ''), nullif(trim(p_ukuran_bawahan), ''),
            nullif(trim(p_catatan_seragam), ''), coalesce(p_kategori_personel, 'reguler'),
            nullif(trim(p_jabatan_khusus), ''), nullif(trim(p_alasan_khusus), '')
        );
    ELSE
        IF v_nip IS NULL OR NOT EXISTS (SELECT 1 FROM public.master_relawan WHERE nip = v_nip) THEN
            RAISE EXCEPTION 'Personel yang akan diedit tidak ditemukan';
        END IF;
        UPDATE public.master_relawan SET
            nama = upper(trim(p_nama)),
            jabatan = coalesce(nullif(trim(p_jabatan), ''), 'BELUM DIISI'),
            asal_organisasi = upper(trim(coalesce(p_asal_organisasi, 'BELUM DIISI'))),
            asal_daerah = nullif(trim(p_asal_daerah), ''),
            kabupaten_normalisasi = nullif(upper(trim(p_kabupaten)), ''),
            kategori_wilayah = coalesce(nullif(trim(p_kategori_wilayah), ''), 'belum_dilengkapi'),
            zona_asal = nullif(trim(p_zona_asal), ''),
            ukuran_seragam = nullif(trim(p_ukuran_atasan), ''),
            ukuran_bawahan_seragam = nullif(trim(p_ukuran_bawahan), ''),
            catatan_seragam = nullif(trim(p_catatan_seragam), ''),
            kategori_personel = coalesce(p_kategori_personel, 'reguler'),
            jabatan_khusus = CASE WHEN p_kategori_personel = 'khusus' THEN nullif(trim(p_jabatan_khusus), '') ELSE NULL END,
            alasan_khusus = CASE WHEN p_kategori_personel = 'khusus' THEN nullif(trim(p_alasan_khusus), '') ELSE NULL END
        WHERE nip = v_nip;
    END IF;
    RETURN jsonb_build_object('ok', true, 'nip', v_nip, 'baru', p_buat_baru);
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_relawan_terpadu_v3(
    p_nips text[], p_target_nip text, p_profile jsonb, p_alasan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_hasil jsonb;
BEGIN
    v_hasil := public.merge_relawan_tercatat(p_nips, p_target_nip, p_profile, p_alasan);
    UPDATE public.master_relawan
    SET ukuran_bawahan_seragam = nullif(trim(p_profile->>'ukuran_bawahan_seragam'), ''),
        -- Fungsi merge lama hanya menulis asal_daerah. Tulis juga kabupaten
        -- kanonis agar trigger zona tidak mempertahankan kabupaten target lama.
        kabupaten_normalisasi = nullif(public.normalisasi_label(p_profile->>'asal_daerah'), '')
    WHERE nip = p_target_nip;
    RETURN v_hasil;
END;
$$;

CREATE OR REPLACE FUNCTION public.detail_personel_v3(p_nip text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_profile jsonb; v_projects jsonb; v_attendance jsonb; v_uniform jsonb;
BEGIN
    IF NOT public.fase17_admin() THEN RAISE EXCEPTION 'Hanya admin yang boleh melihat detail lengkap'; END IF;
    SELECT to_jsonb(r) INTO v_profile FROM public.v_personel_terpadu_v3 r WHERE r.nip = p_nip;
    IF v_profile IS NULL THEN RAISE EXCEPTION 'Personel tidak ditemukan'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.hadir_pertama_proyek, k.nama_proyek), '[]'::jsonb)
    INTO v_projects FROM public.v_kehadiran_proyek_personel k WHERE k.nip = p_nip;
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.tanggal DESC, x.sesi), '[]'::jsonb)
    INTO v_attendance FROM (
        SELECT tanggal, sesi, lokasi FROM public.v_log_absensi_operasional
        WHERE nip = p_nip AND terhubung ORDER BY tanggal DESC, sesi LIMIT 250
    ) x;
    SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.dibuat_pada DESC), '[]'::jsonb)
    INTO v_uniform FROM (SELECT * FROM public.seragam_riwayat WHERE nip = p_nip ORDER BY dibuat_pada DESC LIMIT 100) s;
    RETURN jsonb_build_object('profile', v_profile, 'projects', v_projects,
                              'attendance', v_attendance, 'uniform_history', v_uniform);
END;
$$;

CREATE OR REPLACE VIEW public.v_audit_konsistensi_personel_v3
WITH (security_invoker = true)
AS
SELECT m.nip, m.nama, m.asal_organisasi, m.kabupaten_normalisasi,
       m.zona_asal, w.zona_baku AS zona_seharusnya,
       m.kategori_wilayah, w.kategori_baku AS kategori_seharusnya,
       m.ukuran_seragam, m.ukuran_bawahan_seragam,
       sp.ukuran_atasan, sp.ukuran_bawahan,
       (m.zona_asal IS NOT DISTINCT FROM w.zona_baku
        AND m.kategori_wilayah IS NOT DISTINCT FROM w.kategori_baku
        AND (sp.ukuran_atasan IS NULL OR m.ukuran_seragam IS NOT DISTINCT FROM sp.ukuran_atasan)
        AND (sp.ukuran_bawahan IS NULL OR m.ukuran_bawahan_seragam IS NOT DISTINCT FROM sp.ukuran_bawahan)) AS konsisten
FROM public.master_relawan m
CROSS JOIN LATERAL public.wilayah_personel_terpadu(
    m.kabupaten_normalisasi, m.asal_daerah, m.asal_organisasi, m.zona_asal
) w
LEFT JOIN public.seragam_penerima sp ON sp.nip = m.nip;

REVOKE ALL ON public.v_personel_terpadu_v3, public.v_audit_konsistensi_personel_v3 FROM PUBLIC, anon;
GRANT SELECT ON public.v_personel_terpadu_v3, public.v_audit_konsistensi_personel_v3 TO authenticated;
REVOKE ALL ON FUNCTION public.wilayah_personel_terpadu(text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.simpan_personel_v3(text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.merge_relawan_terpadu_v3(text[],text,jsonb,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.detail_personel_v3(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wilayah_personel_terpadu(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.simpan_personel_v3(text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_relawan_terpadu_v3(text[],text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detail_personel_v3(text) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';

SELECT
    count(*) AS total_personel,
    count(*) FILTER (WHERE kategori_personel = 'reguler') AS reguler,
    count(*) FILTER (WHERE kategori_personel = 'khusus') AS khusus,
    count(*) FILTER (WHERE zona_asal IS NULL) AS zona_belum_diisi,
    (SELECT count(*) FROM public.v_audit_konsistensi_personel_v3 WHERE NOT konsisten) AS tidak_konsisten
FROM public.master_relawan;
