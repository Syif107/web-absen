-- =====================================================================
-- READ-ONLY: AUDIT DUPLIKAT SEBELUM FASE 5
-- Tidak ada INSERT/UPDATE/DELETE dalam file ini.
-- =====================================================================

-- Duplikat untuk data yang mempunyai NIP.
SELECT
    tanggal,
    sesi,
    COALESCE(lokasi, '') AS lokasi,
    nip,
    count(*) AS jumlah,
    array_agg(id ORDER BY id) AS id_log
FROM public.log_absensi
WHERE nip IS NOT NULL AND trim(nip) <> ''
GROUP BY tanggal, sesi, COALESCE(lokasi, ''), nip
HAVING count(*) > 1
ORDER BY tanggal DESC, sesi, lokasi, nip;

-- Duplikat fallback untuk data lama tanpa NIP.
SELECT
    tanggal,
    sesi,
    COALESCE(lokasi, '') AS lokasi,
    upper(trim(nama)) AS nama_normal,
    count(*) AS jumlah,
    array_agg(id ORDER BY id) AS id_log
FROM public.log_absensi
WHERE nip IS NULL OR trim(nip) = ''
GROUP BY tanggal, sesi, COALESCE(lokasi, ''), upper(trim(nama))
HAVING count(*) > 1
ORDER BY tanggal DESC, sesi, lokasi, nama_normal;
