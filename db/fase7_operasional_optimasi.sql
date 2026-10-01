-- FASE 7: rincian proyek, perapian personel, dan peringatan ketidakhadiran
-- Jalankan setelah db/fase6_ranking_seragam.sql.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_log_absensi_nip_tanggal_lokasi
    ON public.log_absensi (nip, tanggal, lokasi);

-- Satu baris per personel dan proyek. View ini hanya untuk filter/rincian;
-- syarat 40 hari tetap dihitung oleh v_peringkat_personel pada level kategori.
CREATE OR REPLACE VIEW public.v_kehadiran_proyek_personel
WITH (security_invoker = true)
AS
WITH normal AS (
    SELECT
        l.nip,
        l.tanggal::date AS tanggal,
        CASE WHEN l.sesi = 'Siang' THEN 'Pagi' ELSE l.sesi END AS sesi,
        CASE l.lokasi
            WHEN 'Masjid Raya Fatchan Mubiina Chaddun ''Adhiima'
                THEN 'Masjid Raya Fatchan Mubiina Chaddun ''Adhiim'
            WHEN 'Monumen Semboyan'
                THEN 'Monumen Semboyan Sang Mursyid'
            WHEN 'Gapuro Syukur'
                THEN 'Gapura Syukur'
            ELSE COALESCE(NULLIF(trim(l.lokasi), ''), 'Lokasi belum diisi')
        END AS nama_proyek
    FROM public.log_absensi l
    WHERE l.nip IS NOT NULL
      AND trim(l.nip) <> ''
      AND l.tanggal IS NOT NULL
), classified AS (
    SELECT
        n.*,
        CASE
            WHEN n.nama_proyek IN (
                'Perpustakaan Tashawwuf',
                'Masjid Raya Fatchan Mubiina Chaddun ''Adhiim',
                'Monumen Semboyan Sang Mursyid',
                'Kanal Ta''at',
                'Gapura Syukur'
            ) THEN 'khususul_khusus'
            ELSE 'lainnya'
        END AS kategori
    FROM normal n
)
SELECT
    nip,
    kategori,
    nama_proyek,
    count(DISTINCT tanggal)::integer AS total_hari_proyek,
    count(DISTINCT (tanggal, sesi))::integer AS total_sesi_proyek,
    min(tanggal) AS hadir_pertama_proyek,
    max(tanggal) AS hadir_terakhir_proyek
FROM classified
GROUP BY nip, kategori, nama_proyek;

-- Satu baris per personel untuk direktori: jumlah hari, sesi, persentase,
-- tanggal pertama/terakhir, dan jumlah proyek yang pernah dihadiri.
CREATE OR REPLACE VIEW public.v_ringkasan_personel
WITH (security_invoker = true)
AS
WITH log_norm AS (
    SELECT
        l.nip,
        l.tanggal::date AS tanggal,
        CASE WHEN l.sesi = 'Siang' THEN 'Pagi' ELSE l.sesi END AS sesi,
        l.lokasi
    FROM public.log_absensi l
    WHERE l.nip IS NOT NULL
      AND trim(l.nip) <> ''
      AND l.tanggal IS NOT NULL
), program AS (
    SELECT
        count(DISTINCT tanggal)::integer AS total_hari_program,
        count(DISTINCT (tanggal, sesi))::integer AS total_sesi_program
    FROM log_norm
), per_person AS (
    SELECT
        nip,
        count(DISTINCT tanggal)::integer AS total_hari,
        count(DISTINCT (tanggal, sesi))::integer AS total_sesi,
        count(DISTINCT NULLIF(trim(lokasi), ''))::integer AS jumlah_proyek,
        min(tanggal) AS hadir_pertama,
        max(tanggal) AS hadir_terakhir
    FROM log_norm
    GROUP BY nip
)
SELECT
    m.nip,
    m.nama,
    m.jabatan,
    m.asal_organisasi,
    m.asal_daerah,
    m.kategori_wilayah,
    m.ukuran_seragam,
    m.catatan_seragam,
    COALESCE(p.total_hari, 0) AS total_hari,
    COALESCE(p.total_sesi, 0) AS total_sesi,
    COALESCE(p.jumlah_proyek, 0) AS jumlah_proyek,
    p.hadir_pertama,
    p.hadir_terakhir,
    CASE WHEN pr.total_hari_program = 0 THEN 0
         ELSE round(100.0 * COALESCE(p.total_hari, 0) / pr.total_hari_program, 1)
    END AS persentase_hari,
    CASE WHEN pr.total_sesi_program = 0 THEN 0
         ELSE round(100.0 * COALESCE(p.total_sesi, 0) / pr.total_sesi_program, 1)
    END AS persentase_sesi
FROM public.master_relawan m
CROSS JOIN program pr
LEFT JOIN per_person p ON p.nip = m.nip;

-- Status seragam dengan indikator operasional: sudah menerima tetapi >30 hari
-- tidak hadir. View lama tetap dipertahankan agar RPC fase 6 tidak berubah.
CREATE OR REPLACE VIEW public.v_status_seragam_operasional
WITH (security_invoker = true)
AS
SELECT
    s.*,
    (
        s.status_proses = 'sudah_diserahkan'
        AND s.tanggal_hadir_terakhir IS NOT NULL
        AND s.tanggal_hadir_terakhir <= current_date - 30
    ) AS tidak_hadir_30_hari,
    CASE
        WHEN s.status_proses = 'sudah_diserahkan'
         AND s.tanggal_hadir_terakhir IS NOT NULL
        THEN greatest(0, current_date - s.tanggal_hadir_terakhir)
        ELSE 0
    END::integer AS hari_tidak_hadir
FROM public.v_status_seragam s;

REVOKE ALL ON public.v_kehadiran_proyek_personel FROM anon;
REVOKE ALL ON public.v_ringkasan_personel FROM anon;
REVOKE ALL ON public.v_status_seragam_operasional FROM anon;
GRANT SELECT ON public.v_kehadiran_proyek_personel TO authenticated;
GRANT SELECT ON public.v_ringkasan_personel TO authenticated;
GRANT SELECT ON public.v_status_seragam_operasional TO authenticated;

COMMIT;

SELECT
    (SELECT count(*) FROM public.v_kehadiran_proyek_personel) AS baris_proyek_personel,
    (SELECT count(*) FROM public.v_ringkasan_personel) AS baris_ringkasan_personel,
    (SELECT count(*) FROM public.v_status_seragam_operasional WHERE tidak_hadir_30_hari) AS seragam_tidak_hadir_30_hari;
