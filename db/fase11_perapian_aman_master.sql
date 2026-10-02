-- FASE 11: perapian aman Master Data dan pemulihan relasi kehadiran
-- Dapat dijalankan setelah Fase 9. Tidak bergantung pada kolom Fase 10.
-- Prinsip:
--   1. Selalu membuat backup sebelum mengubah data.
--   2. Hanya membakukan penulisan yang tidak mengubah identitas.
--   3. Kehadiran yatim hanya ditautkan bila nama + organisasi
--      menghasilkan tepat satu profil dan tidak berbenturan dengan log target.
--   4. Tidak menghapus log, tidak menggabungkan nama mirip, dan tidak
--      menghapus profil Master.

BEGIN;

CREATE TABLE IF NOT EXISTS public.backup_fase11_master_relawan_20261002 AS
TABLE public.master_relawan;

CREATE TABLE IF NOT EXISTS public.backup_fase11_log_absensi_20261002 AS
TABLE public.log_absensi;

ALTER TABLE public.backup_fase11_master_relawan_20261002 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_fase11_log_absensi_20261002 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_fase11_master_relawan_20261002 FROM anon, authenticated;
REVOKE ALL ON public.backup_fase11_log_absensi_20261002 FROM anon, authenticated;

-- Nama dan organisasi memakai huruf besar agar pencarian, urutan, dan filter
-- konsisten. Alias di bawah hanya membetulkan spasi/typo yang tidak ambigu.
UPDATE public.master_relawan
SET
    nama = regexp_replace(upper(trim(coalesce(nama, ''))), '\s+', ' ', 'g'),
    asal_organisasi = CASE regexp_replace(upper(trim(coalesce(asal_organisasi, ''))), '\s+', ' ', 'g')
        WHEN 'DCP PLOSO' THEN 'DPC PLOSO'
        WHEN 'MQ12' THEN 'MQ 12'
        WHEN 'MQ13' THEN 'MQ 13'
        WHEN 'IMQ25' THEN 'IMQ 25'
        ELSE regexp_replace(upper(trim(coalesce(asal_organisasi, ''))), '\s+', ' ', 'g')
    END,
    jabatan = CASE
        WHEN regexp_replace(upper(trim(coalesce(jabatan, ''))), '\s*[/]\s*', '/', 'g')
             IN ('PJ', 'ADMIN', 'PJ/ADMIN', 'ADMIN/PJ')
            THEN 'PJ / Admin'
        ELSE regexp_replace(trim(coalesce(jabatan, '')), '\s+', ' ', 'g')
    END
WHERE
    coalesce(nama, '') <> regexp_replace(upper(trim(coalesce(nama, ''))), '\s+', ' ', 'g')
    OR coalesce(asal_organisasi, '') <> CASE regexp_replace(upper(trim(coalesce(asal_organisasi, ''))), '\s+', ' ', 'g')
        WHEN 'DCP PLOSO' THEN 'DPC PLOSO'
        WHEN 'MQ12' THEN 'MQ 12'
        WHEN 'MQ13' THEN 'MQ 13'
        WHEN 'IMQ25' THEN 'IMQ 25'
        ELSE regexp_replace(upper(trim(coalesce(asal_organisasi, ''))), '\s+', ' ', 'g')
    END
    OR coalesce(jabatan, '') <> CASE
        WHEN regexp_replace(upper(trim(coalesce(jabatan, ''))), '\s*[/]\s*', '/', 'g')
             IN ('PJ', 'ADMIN', 'PJ/ADMIN', 'ADMIN/PJ')
            THEN 'PJ / Admin'
        ELSE regexp_replace(trim(coalesce(jabatan, '')), '\s+', ' ', 'g')
    END;

WITH master_norm AS (
    SELECT
        nip,
        regexp_replace(upper(trim(coalesce(nama, ''))), '[^A-Z0-9]', '', 'g') AS nama_norm,
        regexp_replace(upper(trim(coalesce(asal_organisasi, ''))), '\s+', ' ', 'g') AS org_norm
    FROM public.master_relawan
), orphan AS (
    SELECT
        l.id,
        regexp_replace(upper(trim(coalesce(l.nama, ''))), '[^A-Z0-9]', '', 'g') AS nama_norm,
        regexp_replace(upper(trim(coalesce(l.organisasi, ''))), '\s+', ' ', 'g') AS org_norm
    FROM public.log_absensi l
    LEFT JOIN public.master_relawan m ON m.nip = l.nip
    WHERE m.nip IS NULL
), candidates AS (
    SELECT
        o.id,
        m.nip AS target_nip
    FROM orphan o
    JOIN master_norm m
      ON m.nama_norm = o.nama_norm
     AND m.org_norm = o.org_norm
    WHERE o.nama_norm <> '' AND o.org_norm <> ''
), unique_best AS (
    SELECT id, min(target_nip) AS target_nip
    FROM candidates
    GROUP BY id
    HAVING count(*) = 1
)
-- Pemulihan ini sengaja melewati baris yang sudah mempunyai kehadiran target
-- pada tanggal, sesi, dan lokasi yang sama. Baris bentrok tetap utuh di tabel
-- utama serta backup untuk tinjauan manual.
UPDATE public.log_absensi l
SET nip = p.target_nip
FROM unique_best p
WHERE l.id = p.id
  AND NOT EXISTS (
      SELECT 1
      FROM public.log_absensi existing
      WHERE existing.id <> l.id
        AND existing.nip = p.target_nip
        AND existing.tanggal = l.tanggal
        AND coalesce(existing.sesi, '') = coalesce(l.sesi, '')
        AND coalesce(existing.lokasi, '') = coalesce(l.lokasi, '')
  );

COMMIT;

-- Verifikasi: perapian tidak dianggap selesai bila angka yatim meningkat atau
-- masih ada penulisan dasar yang belum konsisten.
SELECT
    (SELECT count(*) FROM public.master_relawan) AS total_master,
    (SELECT count(*)
       FROM public.log_absensi l
       LEFT JOIN public.master_relawan m ON m.nip = l.nip
      WHERE m.nip IS NULL) AS log_yatim_tersisa,
    (SELECT count(*)
       FROM public.master_relawan
      WHERE coalesce(nama, '') <> regexp_replace(upper(trim(coalesce(nama, ''))), '\s+', ' ', 'g')) AS nama_belum_rapi,
    (SELECT count(*)
       FROM public.master_relawan
      WHERE coalesce(asal_organisasi, '') <> regexp_replace(upper(trim(coalesce(asal_organisasi, ''))), '\s+', ' ', 'g')) AS organisasi_belum_rapi;
