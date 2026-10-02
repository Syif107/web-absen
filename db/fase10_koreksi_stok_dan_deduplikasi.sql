-- FASE 10: koreksi kehadiran, stok set atasan+bawahan, peringkat umum,
-- dan pemetaan organisasi ke kabupaten.
-- Jalankan setelah Fase 9. Migrasi ini tidak melakukan merge personel.
BEGIN;

CREATE TABLE IF NOT EXISTS public.backup_fase10_master_relawan_20261002 AS
TABLE public.master_relawan;
CREATE TABLE IF NOT EXISTS public.backup_fase10_log_absensi_20261002 AS
TABLE public.log_absensi;
CREATE TABLE IF NOT EXISTS public.backup_fase10_seragam_penerima_20261002 AS
TABLE public.seragam_penerima;

ALTER TABLE public.backup_fase10_master_relawan_20261002 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_fase10_log_absensi_20261002 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_fase10_seragam_penerima_20261002 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_fase10_master_relawan_20261002 FROM anon, authenticated;
REVOKE ALL ON public.backup_fase10_log_absensi_20261002 FROM anon, authenticated;
REVOKE ALL ON public.backup_fase10_seragam_penerima_20261002 FROM anon, authenticated;

-- -----------------------------------------------------------------
-- A. NORMALISASI IDENTITAS DAN KABUPATEN
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalisasi_identitas(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT regexp_replace(upper(trim(coalesce(p_text, ''))), '[^[:alnum:]]+', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.normalisasi_label(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT regexp_replace(upper(trim(coalesce(p_text, ''))), '\s+', ' ', 'g');
$$;

CREATE TABLE IF NOT EXISTS public.organisasi_kabupaten_map (
    organisasi_key  text PRIMARY KEY,
    organisasi_asli text NOT NULL,
    kabupaten       text NOT NULL,
    catatan         text,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- DPC berikut adalah kecamatan/desa di Kabupaten Jombang berdasarkan daftar
-- organisasi produksi yang diperiksa. Label organisasi asli tetap disimpan.
INSERT INTO public.organisasi_kabupaten_map
    (organisasi_key, organisasi_asli, kabupaten, catatan)
VALUES
    ('PUSAT', 'PUSAT', 'JOMBANG', 'PUSAT tetap organisasi tersendiri'),
    ('DPD JOMBANG', 'DPD JOMBANG', 'JOMBANG', NULL),
    ('DPC KABUH', 'DPC KABUH', 'JOMBANG', 'Kecamatan'),
    ('OPSHID KABUH', 'OPSHID KABUH', 'JOMBANG', 'Kecamatan'),
    ('DPC PLOSO', 'DPC PLOSO', 'JOMBANG', 'Kecamatan'),
    ('DCP PLOSO', 'DCP PLOSO', 'JOMBANG', 'Typo DPC PLOSO'),
    ('DPC KUDU', 'DPC KUDU', 'JOMBANG', 'Kecamatan'),
    ('DPC PLANDAAN', 'DPC PLANDAAN', 'JOMBANG', 'Kecamatan'),
    ('DPC TEMBELANG', 'DPC TEMBELANG', 'JOMBANG', 'Kecamatan'),
    ('DPC NGUSIKAN', 'DPC NGUSIKAN', 'JOMBANG', 'Kecamatan'),
    ('DPC MEGALUH', 'DPC MEGALUH', 'JOMBANG', 'Kecamatan'),
    ('DPC KESAMBEN', 'DPC KESAMBEN', 'JOMBANG', 'Kecamatan'),
    ('DPC DADITUNGGAL', 'DPC DADITUNGGAL', 'JOMBANG', 'Desa'),
    ('DPC GABUS BANARAN', 'DPC GABUS BANARAN', 'JOMBANG', 'Desa'),
    ('DPC JATIROWO', 'DPC JATIROWO', 'JOMBANG', 'Desa'),
    ('DPC KLECO', 'DPC KLECO', 'JOMBANG', 'Desa')
ON CONFLICT (organisasi_key) DO UPDATE SET
    kabupaten = EXCLUDED.kabupaten,
    catatan = EXCLUDED.catatan,
    updated_at = now();

-- DPD umumnya sudah menyebut kabupaten/kota. Baris nonwilayah ditolak agar
-- label seperti DPD ORSHID tidak dianggap sebagai kabupaten.
INSERT INTO public.organisasi_kabupaten_map
    (organisasi_key, organisasi_asli, kabupaten, catatan)
SELECT DISTINCT
    public.normalisasi_label(asal_organisasi),
    public.normalisasi_label(asal_organisasi),
    regexp_replace(
        public.normalisasi_label(asal_organisasi),
        '^DPD\s+(KAB(?:UPATEN)?\s+)?',
        '',
        'i'
    ),
    'Diturunkan dari label DPD; dapat dikoreksi admin'
FROM public.master_relawan
WHERE public.normalisasi_label(asal_organisasi) ~ '^DPD\s+'
  AND public.normalisasi_label(asal_organisasi) NOT IN ('DPD ORSHID')
ON CONFLICT (organisasi_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.kabupaten_dari_organisasi(p_organisasi text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT m.kabupaten
    FROM public.organisasi_kabupaten_map m
    WHERE m.organisasi_key = public.normalisasi_label(p_organisasi)
    LIMIT 1;
$$;

ALTER TABLE public.master_relawan
    ADD COLUMN IF NOT EXISTS kabupaten_normalisasi text;

UPDATE public.master_relawan m
SET kabupaten_normalisasi = public.kabupaten_dari_organisasi(m.asal_organisasi)
WHERE public.kabupaten_dari_organisasi(m.asal_organisasi) IS NOT NULL
  AND coalesce(m.kabupaten_normalisasi, '')
      IS DISTINCT FROM public.kabupaten_dari_organisasi(m.asal_organisasi);

CREATE INDEX IF NOT EXISTS idx_master_relawan_kabupaten
    ON public.master_relawan (kabupaten_normalisasi);

CREATE OR REPLACE VIEW public.v_kandidat_duplikat_personel
WITH (security_invoker = true)
AS
SELECT
    public.normalisasi_identitas(m.nama) AS nama_key,
    public.normalisasi_label(m.kabupaten_normalisasi) AS kabupaten_key,
    count(*)::integer AS jumlah_profil,
    array_agg(m.nip ORDER BY m.nip) AS daftar_nip
FROM public.master_relawan m
WHERE public.normalisasi_identitas(m.nama) <> ''
  AND public.normalisasi_label(m.kabupaten_normalisasi) <> ''
GROUP BY 1, 2
HAVING count(*) > 1;

-- Dibuat sebelum ringkasan agar total hari historis dapat langsung terlihat
-- pada direktori personel. Tanggal pasti tetap dipisahkan dari kredit historis.
CREATE TABLE IF NOT EXISTS public.kehadiran_historis (
    id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    nip             text NOT NULL,
    bulan           date NOT NULL,
    lokasi          text NOT NULL,
    kategori        text NOT NULL CHECK (kategori IN ('khususul_khusus', 'lainnya')),
    jumlah_hari     integer NOT NULL CHECK (jumlah_hari > 0 AND jumlah_hari <= 31),
    catatan         text NOT NULL,
    disetujui       boolean NOT NULL DEFAULT true,
    dibuat_pada     timestamptz NOT NULL DEFAULT now(),
    dibuat_oleh     uuid DEFAULT auth.uid(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (nip, bulan, lokasi)
);

-- Ringkasan personel Fase 7 ditambah kabupaten tanpa mengubah grain satu NIP.
CREATE OR REPLACE VIEW public.v_ringkasan_personel
WITH (security_invoker = true)
AS
WITH log_norm AS (
    SELECT l.nip, l.tanggal::date AS tanggal,
           CASE WHEN l.sesi = 'Siang' THEN 'Pagi' ELSE l.sesi END AS sesi,
           l.lokasi
    FROM public.log_absensi l
    WHERE l.nip IS NOT NULL AND trim(l.nip) <> '' AND l.tanggal IS NOT NULL
), program AS (
    SELECT count(DISTINCT tanggal)::integer AS total_hari_program,
           count(DISTINCT (tanggal, sesi))::integer AS total_sesi_program
    FROM log_norm
), per_person AS (
    SELECT nip,
           count(DISTINCT tanggal)::integer AS total_hari,
           count(DISTINCT (tanggal, sesi))::integer AS total_sesi,
           count(DISTINCT NULLIF(trim(lokasi), ''))::integer AS jumlah_proyek,
           min(tanggal) AS hadir_pertama,
           max(tanggal) AS hadir_terakhir
    FROM log_norm
    GROUP BY nip
), historis AS (
    SELECT nip, sum(jumlah_hari)::integer AS hari_historis
    FROM public.kehadiran_historis
    WHERE disetujui
    GROUP BY nip
)
SELECT m.nip, m.nama, m.jabatan, m.asal_organisasi, m.asal_daerah,
       m.kategori_wilayah, m.ukuran_seragam,
       m.catatan_seragam,
       (COALESCE(p.total_hari, 0) + COALESCE(h.hari_historis, 0))::integer AS total_hari,
       COALESCE(p.total_sesi, 0) AS total_sesi,
       COALESCE(p.jumlah_proyek, 0) AS jumlah_proyek,
       p.hadir_pertama, p.hadir_terakhir,
       CASE WHEN pr.total_hari_program = 0 THEN 0
            ELSE round(100.0 * COALESCE(p.total_hari, 0) / pr.total_hari_program, 1)
       END AS persentase_hari,
       CASE WHEN pr.total_sesi_program = 0 THEN 0
            ELSE round(100.0 * COALESCE(p.total_sesi, 0) / pr.total_sesi_program, 1)
       END AS persentase_sesi,
       m.kabupaten_normalisasi,
       COALESCE(h.hari_historis, 0)::integer AS hari_historis
FROM public.master_relawan m
CROSS JOIN program pr
LEFT JOIN per_person p ON p.nip = m.nip
LEFT JOIN historis h ON h.nip = m.nip;

-- -----------------------------------------------------------------
-- B. KOREKSI KEHADIRAN DAN KREDIT HISTORIS TANPA TANGGAL
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.koreksi_kehadiran_batch (
    id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    nip             text NOT NULL,
    lokasi          text NOT NULL,
    perubahan       jsonb NOT NULL,
    catatan         text NOT NULL,
    dibuat_pada     timestamptz NOT NULL DEFAULT now(),
    dibuat_oleh     uuid DEFAULT auth.uid()
);

CREATE OR REPLACE FUNCTION public.kategori_lokasi_proyek(p_lokasi text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN coalesce(p_lokasi, '') IN (
            'Perpustakaan Tashawwuf',
            'Masjid Raya Fatchan Mubiina Chaddun ''Adhiim',
            'Masjid Raya Fatchan Mubiina Chaddun ''Adhiima',
            'Monumen Semboyan Sang Mursyid', 'Monumen Semboyan',
            'Kanal Ta''at', 'Gapura Syukur', 'Gapuro Syukur'
        ) THEN 'khususul_khusus'
        ELSE 'lainnya'
    END;
$$;

CREATE OR REPLACE FUNCTION public.simpan_koreksi_kehadiran(
    p_nip text,
    p_lokasi text,
    p_perubahan jsonb,
    p_catatan text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_master public.master_relawan%ROWTYPE;
    v_item jsonb;
    v_tanggal date;
    v_sesi text;
    v_hadir boolean;
    v_tambah integer := 0;
    v_hapus integer := 0;
    v_terhapus integer := 0;
    v_role text;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;
    IF to_regprocedure('public.akun_role()') IS NOT NULL THEN
        EXECUTE 'SELECT public.akun_role()' INTO v_role;
        IF coalesce(v_role, '') <> 'admin' THEN
            RAISE EXCEPTION 'Hanya admin yang boleh mengoreksi kehadiran';
        END IF;
    END IF;
    IF nullif(trim(p_catatan), '') IS NULL THEN
        RAISE EXCEPTION 'Alasan koreksi wajib diisi';
    END IF;
    IF nullif(trim(p_lokasi), '') IS NULL THEN
        RAISE EXCEPTION 'Lokasi proyek wajib diisi';
    END IF;
    IF jsonb_typeof(p_perubahan) <> 'array' OR jsonb_array_length(p_perubahan) = 0 THEN
        RAISE EXCEPTION 'Daftar perubahan kehadiran kosong';
    END IF;

    SELECT * INTO v_master FROM public.master_relawan WHERE nip = p_nip;
    IF NOT FOUND THEN RAISE EXCEPTION 'Personel tidak ditemukan'; END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_perubahan)
    LOOP
        v_tanggal := (v_item->>'tanggal')::date;
        v_sesi := CASE WHEN v_item->>'sesi' = 'Siang' THEN 'Pagi' ELSE v_item->>'sesi' END;
        v_hadir := coalesce((v_item->>'hadir')::boolean, false);
        IF v_tanggal IS NULL OR v_tanggal > current_date THEN
            RAISE EXCEPTION 'Tanggal koreksi tidak valid';
        END IF;
        IF v_sesi NOT IN ('Pagi', 'Malam') THEN
            RAISE EXCEPTION 'Sesi koreksi harus Pagi atau Malam';
        END IF;

        IF v_hadir THEN
            INSERT INTO public.log_absensi
                (tanggal, sesi, lokasi, nip, nama, bidang, organisasi)
            VALUES
                (v_tanggal, v_sesi, trim(p_lokasi), v_master.nip,
                 v_master.nama, v_master.jabatan, v_master.asal_organisasi)
            ON CONFLICT DO NOTHING;
            IF FOUND THEN v_tambah := v_tambah + 1; END IF;
        ELSE
            DELETE FROM public.log_absensi
            WHERE nip = v_master.nip
              AND tanggal::date = v_tanggal
              AND CASE WHEN sesi = 'Siang' THEN 'Pagi' ELSE sesi END = v_sesi
              AND coalesce(lokasi, '') = trim(p_lokasi);
            GET DIAGNOSTICS v_terhapus = ROW_COUNT;
            v_hapus := v_hapus + v_terhapus;
        END IF;
    END LOOP;

    INSERT INTO public.koreksi_kehadiran_batch (nip, lokasi, perubahan, catatan)
    VALUES (v_master.nip, trim(p_lokasi), p_perubahan, trim(p_catatan));

    RETURN jsonb_build_object('ok', true, 'ditambahkan', v_tambah, 'dihapus', v_hapus);
END;
$$;

CREATE OR REPLACE FUNCTION public.simpan_kehadiran_historis(
    p_nip text,
    p_bulan date,
    p_lokasi text,
    p_jumlah_hari integer,
    p_catatan text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;
    IF to_regprocedure('public.akun_role()') IS NOT NULL THEN
        EXECUTE 'SELECT public.akun_role()' INTO v_role;
        IF coalesce(v_role, '') <> 'admin' THEN
            RAISE EXCEPTION 'Hanya admin yang boleh mencatat kehadiran historis';
        END IF;
    END IF;
    IF p_bulan IS NULL OR p_bulan > current_date THEN RAISE EXCEPTION 'Bulan tidak valid'; END IF;
    IF p_jumlah_hari IS NULL OR p_jumlah_hari < 1
       OR p_jumlah_hari > extract(day FROM (date_trunc('month', p_bulan) + interval '1 month - 1 day'))::integer THEN
        RAISE EXCEPTION 'Jumlah hari historis melebihi jumlah hari pada bulan tersebut';
    END IF;
    IF nullif(trim(p_lokasi), '') IS NULL THEN RAISE EXCEPTION 'Lokasi proyek wajib diisi'; END IF;
    IF nullif(trim(p_catatan), '') IS NULL THEN
        RAISE EXCEPTION 'Sumber atau alasan pencatatan historis wajib diisi';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.master_relawan WHERE nip = p_nip) THEN
        RAISE EXCEPTION 'Personel tidak ditemukan';
    END IF;

    INSERT INTO public.kehadiran_historis
        (nip, bulan, lokasi, kategori, jumlah_hari, catatan, disetujui)
    VALUES
        (p_nip, date_trunc('month', p_bulan)::date, trim(p_lokasi),
         public.kategori_lokasi_proyek(p_lokasi), p_jumlah_hari,
         trim(p_catatan), true)
    ON CONFLICT (nip, bulan, lokasi) DO UPDATE SET
        kategori = EXCLUDED.kategori,
        jumlah_hari = EXCLUDED.jumlah_hari,
        catatan = EXCLUDED.catatan,
        disetujui = true,
        updated_at = now();

    RETURN jsonb_build_object('ok', true, 'nip', p_nip);
END;
$$;

-- Kredit historis menambah hari kumulatif, tetapi tidak mengubah sesi,
-- persentase 90 hari, atau streak karena tanggal pastinya tidak diketahui.
CREATE OR REPLACE VIEW public.v_peringkat_personel_operasional
WITH (security_invoker = true)
AS
WITH kredit AS (
    SELECT nip, kategori, sum(jumlah_hari)::integer AS hari_historis,
           min(bulan) AS bulan_pertama_historis
    FROM public.kehadiran_historis
    WHERE disetujui
    GROUP BY nip, kategori
), kombinasi AS (
    SELECT nip, kategori FROM public.v_peringkat_personel
    UNION
    SELECT nip, kategori FROM kredit
), gabung AS (
    SELECT
        m.nip, m.nama, m.asal_organisasi, m.asal_daerah,
        m.kategori_wilayah, m.ukuran_seragam, c.kategori,
        coalesce(r.total_hari, 0)::integer AS total_hari_aktual,
        coalesce(r.total_sesi, 0)::integer AS total_sesi,
        coalesce(r.hari_90, 0)::integer AS hari_90,
        coalesce(r.sesi_90, 0)::integer AS sesi_90,
        coalesce(r.minggu_aktif_12, 0)::integer AS minggu_aktif_12,
        r.hadir_pertama, r.hadir_terakhir,
        coalesce(r.streak_saat_ini, 0)::integer AS streak_saat_ini,
        coalesce(r.streak_terpanjang, 0)::integer AS streak_terpanjang,
        coalesce(r.persentase_hari_90, 0) AS persentase_hari_90,
        coalesce(r.persentase_sesi_90, 0) AS persentase_sesi_90,
        coalesce(r.indeks_keaktifan, 0) AS indeks_keaktifan,
        coalesce(k.hari_historis, 0) AS hari_historis,
        (coalesce(r.total_hari, 0) + coalesce(k.hari_historis, 0))::integer AS total_hari_kelayakan,
        CASE
            WHEN m.kategori_wilayah = 'zona_4'
             AND coalesce(r.total_hari, 0) + coalesce(k.hari_historis, 0) >= 1 THEN true
            WHEN coalesce(r.total_hari, 0) + coalesce(k.hari_historis, 0) >= 40 THEN true
            ELSE false
        END AS memenuhi_operasional,
        CASE
            WHEN coalesce(r.memenuhi_syarat, false) THEN r.tanggal_memenuhi
            WHEN coalesce(r.total_hari, 0) + coalesce(k.hari_historis, 0) >=
                 CASE WHEN m.kategori_wilayah = 'zona_4' THEN 1 ELSE 40 END
            THEN coalesce(k.bulan_pertama_historis, r.hadir_pertama)
            ELSE NULL
        END AS tanggal_memenuhi_operasional,
        CASE WHEN m.kategori_wilayah = 'zona_4' THEN 'zona_4' ELSE c.kategori END AS jalur_kelayakan,
        CASE
            WHEN coalesce(r.indeks_keaktifan, 0) >= 85 THEN 'Sangat Aktif'
            WHEN coalesce(r.indeks_keaktifan, 0) >= 70 THEN 'Aktif'
            WHEN coalesce(r.indeks_keaktifan, 0) >= 55 THEN 'Cukup Aktif'
            ELSE 'Keaktifan Rendah'
        END AS tingkat_keaktifan
    FROM kombinasi c
    JOIN public.master_relawan m ON m.nip = c.nip
    LEFT JOIN public.v_peringkat_personel r
      ON r.nip = c.nip AND r.kategori = c.kategori
    LEFT JOIN kredit k ON k.nip = c.nip AND k.kategori = c.kategori
), nilai AS (
    SELECT g.*,
           CASE WHEN g.memenuhi_operasional THEN
               row_number() OVER (
                   PARTITION BY g.kategori, g.memenuhi_operasional
                   ORDER BY g.indeks_keaktifan DESC,
                            g.tanggal_memenuhi_operasional ASC NULLS LAST,
                            g.total_hari_kelayakan DESC, g.nip ASC
               )::integer
           END AS peringkat_operasional
    FROM gabung g
)
SELECT
    n.nip, n.nama, n.asal_organisasi, n.asal_daerah,
    n.kategori_wilayah, n.ukuran_seragam, n.kategori,
    n.total_hari_kelayakan AS total_hari,
    n.total_sesi, n.hari_90, n.sesi_90, n.minggu_aktif_12,
    n.hadir_pertama, n.hadir_terakhir,
    n.streak_saat_ini, n.streak_terpanjang,
    n.persentase_hari_90, n.persentase_sesi_90,
    n.indeks_keaktifan, n.memenuhi_operasional AS memenuhi_syarat,
    n.tanggal_memenuhi_operasional AS tanggal_memenuhi,
    n.jalur_kelayakan, n.tingkat_keaktifan,
    n.peringkat_operasional AS peringkat,
    n.hari_historis
FROM nilai n;

CREATE OR REPLACE VIEW public.v_peringkat_personel_umum
WITH (security_invoker = true)
AS
WITH actual AS (
    SELECT l.nip,
           count(DISTINCT l.tanggal::date)::integer AS hari_aktual,
           count(DISTINCT (l.tanggal::date, CASE WHEN l.sesi = 'Siang' THEN 'Pagi' ELSE l.sesi END))::integer AS total_sesi,
           min(l.tanggal::date) AS hadir_pertama,
           max(l.tanggal::date) AS hadir_terakhir
    FROM public.log_absensi l
    WHERE l.nip IS NOT NULL AND trim(l.nip) <> '' AND l.tanggal IS NOT NULL
    GROUP BY l.nip
), kategori AS (
    SELECT r.nip,
           bool_or(r.memenuhi_syarat) AS memenuhi_syarat,
           min(r.tanggal_memenuhi) FILTER (WHERE r.memenuhi_syarat) AS tanggal_memenuhi,
           sum(r.hari_historis)::integer AS hari_historis,
           max(r.indeks_keaktifan) AS indeks_keaktifan,
           max(r.streak_saat_ini)::integer AS streak_saat_ini,
           max(r.streak_terpanjang)::integer AS streak_terpanjang,
           max(r.minggu_aktif_12)::integer AS minggu_aktif_12,
           max(r.persentase_hari_90) AS persentase_hari_90,
           max(r.persentase_sesi_90) AS persentase_sesi_90,
           max(r.total_hari)::integer AS hari_menuju_syarat
    FROM public.v_peringkat_personel_operasional r
    GROUP BY r.nip
), dasar AS (
    SELECT m.nip, m.nama, m.asal_organisasi, m.asal_daerah,
           m.kategori_wilayah, m.ukuran_seragam,
           'semua'::text AS kategori,
           (coalesce(a.hari_aktual, 0) + coalesce(k.hari_historis, 0))::integer AS total_hari,
           coalesce(a.total_sesi, 0)::integer AS total_sesi,
           coalesce(k.memenuhi_syarat, false) AS memenuhi_syarat,
           k.tanggal_memenuhi,
           coalesce(k.indeks_keaktifan, 0) AS indeks_keaktifan,
           coalesce(k.streak_saat_ini, 0) AS streak_saat_ini,
           coalesce(k.streak_terpanjang, 0) AS streak_terpanjang,
           coalesce(k.minggu_aktif_12, 0) AS minggu_aktif_12,
           coalesce(k.persentase_hari_90, 0) AS persentase_hari_90,
           coalesce(k.persentase_sesi_90, 0) AS persentase_sesi_90,
           a.hadir_pertama, a.hadir_terakhir,
           coalesce(k.hari_historis, 0)::integer AS hari_historis,
           coalesce(k.hari_menuju_syarat, 0)::integer AS hari_menuju_syarat,
           CASE
               WHEN coalesce(k.indeks_keaktifan, 0) >= 85 THEN 'Sangat Aktif'
               WHEN coalesce(k.indeks_keaktifan, 0) >= 70 THEN 'Aktif'
               WHEN coalesce(k.indeks_keaktifan, 0) >= 55 THEN 'Cukup Aktif'
               ELSE 'Keaktifan Rendah'
           END AS tingkat_keaktifan
    FROM public.master_relawan m
    LEFT JOIN actual a ON a.nip = m.nip
    LEFT JOIN kategori k ON k.nip = m.nip
), nilai AS (
    SELECT d.*,
           CASE WHEN d.memenuhi_syarat THEN
               row_number() OVER (
                   PARTITION BY d.memenuhi_syarat
                   ORDER BY d.indeks_keaktifan DESC,
                            d.tanggal_memenuhi ASC NULLS LAST,
                            d.total_hari DESC, d.nip ASC
               )::integer
           END AS peringkat
    FROM dasar d
)
SELECT * FROM nilai;

-- -----------------------------------------------------------------
-- C. STOK SERAGAM SET: ATASAN DAN BAWAHAN
-- -----------------------------------------------------------------
ALTER TABLE public.seragam_penerima
    ADD COLUMN IF NOT EXISTS ukuran_atasan text,
    ADD COLUMN IF NOT EXISTS ukuran_bawahan text,
    ADD COLUMN IF NOT EXISTS kode_atasan text,
    ADD COLUMN IF NOT EXISTS kode_bawahan text;

UPDATE public.seragam_penerima
SET ukuran_atasan = coalesce(ukuran_atasan, ukuran_dibutuhkan),
    kode_atasan = coalesce(kode_atasan, kode_seragam)
WHERE ukuran_atasan IS NULL OR kode_atasan IS NULL;

CREATE TABLE IF NOT EXISTS public.stok_item_seragam (
    jenis             text NOT NULL CHECK (jenis IN ('atasan', 'bawahan')),
    ukuran            text NOT NULL,
    jumlah_tersedia   integer NOT NULL DEFAULT 0 CHECK (jumlah_tersedia >= 0),
    catatan           text,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (jenis, ukuran)
);

INSERT INTO public.stok_item_seragam (jenis, ukuran, jumlah_tersedia, catatan)
SELECT 'atasan', ukuran, jumlah_tersedia, 'Saldo awal dari stok lama'
FROM public.stok_seragam
ON CONFLICT (jenis, ukuran) DO NOTHING;

INSERT INTO public.stok_item_seragam (jenis, ukuran, jumlah_tersedia)
SELECT 'bawahan', ukuran, 0
FROM unnest(ARRAY['20','22','24','26','28','30','32','34','36','38','40','Khusus']) ukuran
ON CONFLICT (jenis, ukuran) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mutasi_stok_seragam (
    id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    jenis           text NOT NULL CHECK (jenis IN ('atasan', 'bawahan')),
    ukuran          text NOT NULL,
    tipe            text NOT NULL CHECK (tipe IN (
        'saldo_awal', 'masuk', 'keluar_penyerahan',
        'koreksi_tambah', 'koreksi_kurang', 'retur_permanen', 'rusak_hilang'
    )),
    jumlah          integer NOT NULL CHECK (jumlah >= 0),
    perubahan       integer NOT NULL,
    saldo_setelah   integer NOT NULL CHECK (saldo_setelah >= 0),
    nip             text,
    catatan         text,
    dibuat_pada     timestamptz NOT NULL DEFAULT now(),
    dibuat_oleh     uuid DEFAULT auth.uid()
);

INSERT INTO public.mutasi_stok_seragam
    (jenis, ukuran, tipe, jumlah, perubahan, saldo_setelah, catatan)
SELECT s.jenis, s.ukuran, 'saldo_awal', s.jumlah_tersedia,
       s.jumlah_tersedia, s.jumlah_tersedia, 'Migrasi saldo awal Fase 10'
FROM public.stok_item_seragam s
WHERE NOT EXISTS (
    SELECT 1 FROM public.mutasi_stok_seragam m
    WHERE m.jenis = s.jenis AND m.ukuran = s.ukuran
);

CREATE OR REPLACE FUNCTION public.catat_mutasi_stok_seragam(
    p_jenis text,
    p_ukuran text,
    p_tipe text,
    p_jumlah integer,
    p_catatan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_perubahan integer;
    v_saldo integer;
    v_role text;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;
    IF to_regprocedure('public.akun_role()') IS NOT NULL THEN
        EXECUTE 'SELECT public.akun_role()' INTO v_role;
        IF coalesce(v_role, '') <> 'admin' THEN
            RAISE EXCEPTION 'Hanya admin yang boleh mengubah stok';
        END IF;
    END IF;
    IF p_jenis NOT IN ('atasan', 'bawahan') THEN RAISE EXCEPTION 'Jenis seragam tidak valid'; END IF;
    IF nullif(trim(p_ukuran), '') IS NULL THEN RAISE EXCEPTION 'Ukuran wajib diisi'; END IF;
    IF p_tipe NOT IN ('masuk','koreksi_tambah','koreksi_kurang','retur_permanen','rusak_hilang') THEN
        RAISE EXCEPTION 'Jenis transaksi stok tidak valid';
    END IF;
    IF p_jumlah IS NULL OR p_jumlah <= 0 THEN RAISE EXCEPTION 'Jumlah harus lebih dari nol'; END IF;

    v_perubahan := CASE
        WHEN p_tipe IN ('masuk','koreksi_tambah','retur_permanen') THEN p_jumlah
        ELSE -p_jumlah
    END;

    INSERT INTO public.stok_item_seragam (jenis, ukuran, jumlah_tersedia)
    VALUES (p_jenis, trim(p_ukuran), 0)
    ON CONFLICT (jenis, ukuran) DO NOTHING;

    UPDATE public.stok_item_seragam
    SET jumlah_tersedia = jumlah_tersedia + v_perubahan,
        updated_at = now()
    WHERE jenis = p_jenis AND ukuran = trim(p_ukuran)
      AND jumlah_tersedia + v_perubahan >= 0
    RETURNING jumlah_tersedia INTO v_saldo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stok tidak mencukupi'; END IF;

    INSERT INTO public.mutasi_stok_seragam
        (jenis, ukuran, tipe, jumlah, perubahan, saldo_setelah, catatan)
    VALUES
        (p_jenis, trim(p_ukuran), p_tipe, p_jumlah, v_perubahan,
         v_saldo, nullif(trim(p_catatan), ''));
    RETURN jsonb_build_object('ok', true, 'saldo', v_saldo);
END;
$$;

CREATE OR REPLACE FUNCTION public.simpan_status_seragam_set(
    p_nip text,
    p_status_proses text,
    p_ukuran_atasan text,
    p_ukuran_bawahan text,
    p_status_penguasaan text,
    p_tanggal_rencana date DEFAULT NULL,
    p_tanggal_diserahkan date DEFAULT NULL,
    p_kode_atasan text DEFAULT NULL,
    p_kode_bawahan text DEFAULT NULL,
    p_catatan text DEFAULT NULL,
    p_aturan_disetujui boolean DEFAULT false,
    p_data_lama boolean DEFAULT false,
    p_kurangi_stok boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text;
    v_memenuhi boolean := false;
    v_tanggal_memenuhi date;
    v_jalur text;
    v_lama public.seragam_penerima%ROWTYPE;
    v_saldo_atas integer;
    v_saldo_bawah integer;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;
    IF to_regprocedure('public.akun_role()') IS NOT NULL THEN
        EXECUTE 'SELECT public.akun_role()' INTO v_role;
        IF coalesce(v_role, '') <> 'admin' THEN RAISE EXCEPTION 'Hanya admin yang boleh mengelola seragam'; END IF;
    END IF;

    SELECT r.memenuhi_syarat, r.tanggal_memenuhi,
           CASE WHEN r.kategori_wilayah = 'zona_4' THEN 'zona_4' ELSE r.kategori END
    INTO v_memenuhi, v_tanggal_memenuhi, v_jalur
    FROM public.v_peringkat_personel_operasional r
    WHERE r.nip = p_nip AND r.memenuhi_syarat
    ORDER BY CASE WHEN r.kategori_wilayah = 'zona_4' THEN 0 ELSE 1 END,
             r.tanggal_memenuhi NULLS LAST
    LIMIT 1;

    IF p_status_proses = 'sudah_diserahkan' THEN
        IF nullif(trim(p_ukuran_atasan), '') IS NULL THEN RAISE EXCEPTION 'Ukuran atasan wajib diisi'; END IF;
        IF NOT p_data_lama AND nullif(trim(p_ukuran_bawahan), '') IS NULL THEN RAISE EXCEPTION 'Ukuran bawahan wajib diisi'; END IF;
        IF p_tanggal_diserahkan IS NULL THEN RAISE EXCEPTION 'Tanggal penyerahan wajib diisi'; END IF;
        IF p_status_penguasaan = 'belum_memiliki' THEN RAISE EXCEPTION 'Keberadaan seragam wajib dipilih'; END IF;
        IF NOT p_data_lama AND NOT p_aturan_disetujui THEN RAISE EXCEPTION 'Ketentuan seragam wajib disetujui'; END IF;
        IF NOT p_data_lama AND NOT coalesce(v_memenuhi, false) THEN RAISE EXCEPTION 'Personel belum memenuhi syarat'; END IF;
    END IF;

    SELECT * INTO v_lama FROM public.seragam_penerima WHERE nip = p_nip FOR UPDATE;

    IF p_status_proses = 'sudah_diserahkan' AND p_kurangi_stok
       AND (v_lama.nip IS NULL OR v_lama.status_proses <> 'sudah_diserahkan') THEN
        UPDATE public.stok_item_seragam SET jumlah_tersedia = jumlah_tersedia - 1, updated_at = now()
        WHERE jenis = 'atasan' AND ukuran = trim(p_ukuran_atasan) AND jumlah_tersedia > 0
        RETURNING jumlah_tersedia INTO v_saldo_atas;
        IF NOT FOUND THEN RAISE EXCEPTION 'Stok atasan ukuran % tidak tersedia', p_ukuran_atasan; END IF;

        UPDATE public.stok_item_seragam SET jumlah_tersedia = jumlah_tersedia - 1, updated_at = now()
        WHERE jenis = 'bawahan' AND ukuran = trim(p_ukuran_bawahan) AND jumlah_tersedia > 0
        RETURNING jumlah_tersedia INTO v_saldo_bawah;
        IF NOT FOUND THEN RAISE EXCEPTION 'Stok bawahan ukuran % tidak tersedia', p_ukuran_bawahan; END IF;

        INSERT INTO public.mutasi_stok_seragam
            (jenis, ukuran, tipe, jumlah, perubahan, saldo_setelah, nip, catatan)
        VALUES
            ('atasan', trim(p_ukuran_atasan), 'keluar_penyerahan', 1, -1, v_saldo_atas, p_nip, p_catatan),
            ('bawahan', trim(p_ukuran_bawahan), 'keluar_penyerahan', 1, -1, v_saldo_bawah, p_nip, p_catatan);
    END IF;

    INSERT INTO public.seragam_penerima (
        nip, jalur_kelayakan, status_proses, ukuran_dibutuhkan, kode_seragam,
        ukuran_atasan, ukuran_bawahan, kode_atasan, kode_bawahan,
        status_penguasaan, tanggal_memenuhi, tanggal_rencana,
        tanggal_diserahkan, tanggal_status, aturan_disetujui, data_lama, catatan
    ) VALUES (
        p_nip, v_jalur, p_status_proses, nullif(trim(p_ukuran_atasan), ''),
        nullif(trim(p_kode_atasan), ''), nullif(trim(p_ukuran_atasan), ''),
        nullif(trim(p_ukuran_bawahan), ''), nullif(trim(p_kode_atasan), ''),
        nullif(trim(p_kode_bawahan), ''), p_status_penguasaan,
        v_tanggal_memenuhi, p_tanggal_rencana, p_tanggal_diserahkan, now(),
        p_aturan_disetujui, p_data_lama, nullif(trim(p_catatan), '')
    )
    ON CONFLICT (nip) DO UPDATE SET
        jalur_kelayakan = EXCLUDED.jalur_kelayakan,
        status_proses = EXCLUDED.status_proses,
        ukuran_dibutuhkan = EXCLUDED.ukuran_dibutuhkan,
        kode_seragam = EXCLUDED.kode_seragam,
        ukuran_atasan = EXCLUDED.ukuran_atasan,
        ukuran_bawahan = EXCLUDED.ukuran_bawahan,
        kode_atasan = EXCLUDED.kode_atasan,
        kode_bawahan = EXCLUDED.kode_bawahan,
        status_penguasaan = EXCLUDED.status_penguasaan,
        tanggal_memenuhi = coalesce(EXCLUDED.tanggal_memenuhi, public.seragam_penerima.tanggal_memenuhi),
        tanggal_rencana = EXCLUDED.tanggal_rencana,
        tanggal_diserahkan = EXCLUDED.tanggal_diserahkan,
        tanggal_status = now(), aturan_disetujui = EXCLUDED.aturan_disetujui,
        data_lama = EXCLUDED.data_lama, catatan = EXCLUDED.catatan;

    UPDATE public.master_relawan
    SET ukuran_seragam = nullif(trim(p_ukuran_atasan), '')
    WHERE nip = p_nip AND nullif(trim(p_ukuran_atasan), '') IS NOT NULL;

    RETURN jsonb_build_object('ok', true, 'nip', p_nip);
END;
$$;

CREATE OR REPLACE VIEW public.v_status_seragam_set
WITH (security_invoker = true)
AS
WITH eligible AS (
    SELECT * FROM (
        SELECT r.*,
               row_number() OVER (
                   PARTITION BY r.nip
                   ORDER BY CASE WHEN r.kategori_wilayah = 'zona_4' THEN 0 ELSE 1 END,
                            r.tanggal_memenuhi ASC NULLS LAST,
                            r.indeks_keaktifan DESC
               ) AS pilihan
        FROM public.v_peringkat_personel_operasional r
        WHERE r.memenuhi_syarat
    ) x
    WHERE pilihan = 1
), last_attendance AS (
    SELECT nip, max(tanggal::date) AS tanggal_terakhir
    FROM public.log_absensi
    WHERE nip IS NOT NULL AND trim(nip) <> ''
    GROUP BY nip
)
SELECT
    m.nip, m.nama, m.asal_organisasi, m.asal_daerah,
    m.kategori_wilayah, m.ukuran_seragam,
    coalesce(e.memenuhi_syarat, false) AS memenuhi_syarat,
    e.tanggal_memenuhi,
    CASE WHEN m.kategori_wilayah = 'zona_4' THEN 'zona_4' ELSE e.kategori END AS jalur_kelayakan,
    e.indeks_keaktifan, e.peringkat,
    coalesce(sp.status_proses,
        CASE WHEN e.memenuhi_syarat THEN 'memenuhi_syarat' ELSE 'belum_memenuhi' END
    ) AS status_proses,
    coalesce(sp.ukuran_atasan, sp.ukuran_dibutuhkan, m.ukuran_seragam) AS ukuran_dibutuhkan,
    coalesce(sp.kode_atasan, sp.kode_seragam) AS kode_seragam,
    CASE
        WHEN sp.status_penguasaan = 'dititipkan_kantor'
         AND m.kategori_wilayah IN ('luar_jombang', 'zona_4')
         AND la.tanggal_terakhir > sp.tanggal_status::date
            THEN 'perlu_diserahkan_kembali'
        ELSE coalesce(sp.status_penguasaan, 'belum_memiliki')
    END AS status_penguasaan,
    (
        sp.status_penguasaan = 'dititipkan_kantor'
        AND m.kategori_wilayah IN ('luar_jombang', 'zona_4')
        AND la.tanggal_terakhir > sp.tanggal_status::date
    ) AS notifikasi_pengembalian,
    sp.tanggal_rencana, sp.tanggal_diserahkan, sp.tanggal_status,
    sp.aturan_disetujui, sp.data_lama, sp.catatan,
    la.tanggal_terakhir AS tanggal_hadir_terakhir,
    (
        sp.status_proses = 'sudah_diserahkan'
        AND coalesce(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date) IS NOT NULL
        AND coalesce(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date) <= current_date - 30
    ) AS tidak_hadir_30_hari,
    CASE
        WHEN sp.status_proses = 'sudah_diserahkan'
         AND coalesce(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date) IS NOT NULL
        THEN greatest(0, current_date - coalesce(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date))
        ELSE 0
    END::integer AS hari_tidak_hadir,
    sp.ukuran_atasan, sp.ukuran_bawahan,
    sp.kode_atasan, sp.kode_bawahan
FROM public.master_relawan m
LEFT JOIN eligible e ON e.nip = m.nip
LEFT JOIN public.seragam_penerima sp ON sp.nip = m.nip
LEFT JOIN last_attendance la ON la.nip = m.nip;

ALTER TABLE public.seragam_riwayat
    ADD COLUMN IF NOT EXISTS ukuran_atasan text,
    ADD COLUMN IF NOT EXISTS ukuran_bawahan text,
    ADD COLUMN IF NOT EXISTS kode_atasan text,
    ADD COLUMN IF NOT EXISTS kode_bawahan text;

CREATE OR REPLACE FUNCTION public.catat_riwayat_seragam()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.seragam_riwayat (
        nip, status_proses, status_penguasaan, ukuran, kode_seragam, catatan,
        ukuran_atasan, ukuran_bawahan, kode_atasan, kode_bawahan
    ) VALUES (
        NEW.nip, NEW.status_proses, NEW.status_penguasaan,
        NEW.ukuran_dibutuhkan, NEW.kode_seragam, NEW.catatan,
        NEW.ukuran_atasan, NEW.ukuran_bawahan, NEW.kode_atasan, NEW.kode_bawahan
    );
    RETURN NEW;
END;
$$;

-- Fase 9 diperluas agar merge setelah Fase 10 juga memindahkan kredit historis,
-- audit koreksi, dan referensi mutasi stok. Tidak ada merge yang dijalankan oleh
-- migrasi ini; fungsi hanya dipakai setelah admin memilih dan mengonfirmasi.
CREATE OR REPLACE FUNCTION public.merge_relawan_manual(
    p_nips text[],
    p_target_nip text,
    p_profile jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_nips text[];
    v_found integer := 0;
    v_deleted_logs integer := 0;
    v_updated_logs integer := 0;
    v_deleted_profiles integer := 0;
    v_uniform_count integer := 0;
    v_role text;
    v_nama text;
    v_organisasi text;
    v_jabatan text;
    v_asal_daerah text;
    v_kabupaten text;
    v_kategori_wilayah text;
    v_ukuran text;
    v_catatan text;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;
    IF to_regprocedure('public.akun_role()') IS NOT NULL THEN
        EXECUTE 'SELECT public.akun_role()' INTO v_role;
        IF coalesce(v_role, '') <> 'admin' THEN
            RAISE EXCEPTION 'Hanya admin yang boleh melakukan merge manual';
        END IF;
    END IF;

    SELECT array_agg(nip ORDER BY nip) INTO v_nips
    FROM (
        SELECT DISTINCT trim(value) AS nip
        FROM unnest(coalesce(p_nips, ARRAY[]::text[])) AS item(value)
        WHERE value IS NOT NULL AND trim(value) <> ''
    ) pilihan;

    IF coalesce(array_length(v_nips, 1), 0) < 2 THEN
        RAISE EXCEPTION 'Pilih sedikitnya dua profil untuk digabung';
    END IF;
    IF p_target_nip IS NULL OR NOT (p_target_nip = ANY(v_nips)) THEN
        RAISE EXCEPTION 'ID utama harus termasuk dalam profil yang dipilih';
    END IF;

    PERFORM 1 FROM public.master_relawan WHERE nip = ANY(v_nips) FOR UPDATE;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found <> array_length(v_nips, 1) THEN
        RAISE EXCEPTION 'Sebagian profil tidak ditemukan. Muat ulang Master Data lalu pilih kembali';
    END IF;

    v_nama := upper(trim(coalesce(p_profile->>'nama', '')));
    v_organisasi := trim(coalesce(p_profile->>'asal_organisasi', ''));
    v_jabatan := trim(coalesce(p_profile->>'jabatan', ''));
    v_asal_daerah := nullif(trim(coalesce(p_profile->>'asal_daerah', '')), '');
    v_kabupaten := nullif(public.normalisasi_label(p_profile->>'kabupaten_normalisasi'), '');
    IF v_kabupaten IS NULL THEN
        v_kabupaten := coalesce(
            public.kabupaten_dari_organisasi(v_organisasi),
            nullif(public.normalisasi_label(v_asal_daerah), '')
        );
    END IF;
    v_kategori_wilayah := coalesce(nullif(trim(p_profile->>'kategori_wilayah'), ''), 'belum_dilengkapi');
    v_ukuran := nullif(trim(coalesce(p_profile->>'ukuran_seragam', '')), '');
    v_catatan := nullif(trim(coalesce(p_profile->>'catatan_seragam', '')), '');

    IF v_nama = '' OR v_organisasi = '' THEN RAISE EXCEPTION 'Nama akhir dan asal organisasi wajib diisi'; END IF;
    IF public.normalisasi_label(v_organisasi) = 'PUSAT' THEN v_kategori_wilayah := 'jombang'; END IF;
    IF regexp_replace(upper(v_jabatan), '\s*/\s*', '/', 'g') IN ('PJ','ADMIN','PJ/ADMIN','ADMIN/PJ') THEN
        v_jabatan := 'PJ / Admin';
    END IF;
    IF v_kategori_wilayah NOT IN ('belum_dilengkapi','jombang','luar_jombang','zona_4') THEN
        RAISE EXCEPTION 'Kategori wilayah tidak valid';
    END IF;
    IF v_ukuran IS NOT NULL AND v_ukuran NOT IN ('S','M','L','XL','XXL','XXXL','Khusus') THEN
        RAISE EXCEPTION 'Ukuran seragam tidak valid';
    END IF;

    SELECT count(*) INTO v_uniform_count
    FROM public.seragam_penerima WHERE nip = ANY(v_nips);
    IF v_uniform_count > 1 THEN
        RAISE EXCEPTION 'Merge dihentikan: lebih dari satu profil memiliki data Kontrol Seragam. Rapikan status seragam terlebih dahulu';
    END IF;

    WITH ranked AS (
        SELECT id,
               row_number() OVER (
                   PARTITION BY tanggal, sesi, coalesce(lokasi, '')
                   ORDER BY CASE WHEN nip = p_target_nip THEN 0 ELSE 1 END, id
               ) AS urutan
        FROM public.log_absensi
        WHERE nip = ANY(v_nips)
    )
    DELETE FROM public.log_absensi log
    USING ranked
    WHERE log.id = ranked.id AND ranked.urutan > 1;
    GET DIAGNOSTICS v_deleted_logs = ROW_COUNT;

    UPDATE public.log_absensi
    SET nip = p_target_nip, nama = v_nama, bidang = v_jabatan, organisasi = v_organisasi
    WHERE nip = ANY(v_nips);
    GET DIAGNOSTICS v_updated_logs = ROW_COUNT;

    -- Gabungkan kredit bulan/lokasi yang sama dan batasi pada jumlah hari kalender.
    WITH gabungan AS MATERIALIZED (
        SELECT bulan, lokasi,
               public.kategori_lokasi_proyek(lokasi) AS kategori,
               least(
                   extract(day FROM (date_trunc('month', bulan) + interval '1 month - 1 day'))::integer,
                   sum(jumlah_hari)::integer
               ) AS jumlah_hari,
               string_agg(DISTINCT catatan, ' | ') AS catatan,
               bool_or(disetujui) AS disetujui,
               min(dibuat_pada) AS dibuat_pada
        FROM public.kehadiran_historis
        WHERE nip = ANY(v_nips)
        GROUP BY bulan, lokasi
    ), terhapus AS (
        DELETE FROM public.kehadiran_historis WHERE nip = ANY(v_nips)
        RETURNING id
    )
    INSERT INTO public.kehadiran_historis
        (nip, bulan, lokasi, kategori, jumlah_hari, catatan, disetujui, dibuat_pada, updated_at)
    SELECT p_target_nip, bulan, lokasi, kategori, jumlah_hari, catatan,
           disetujui, dibuat_pada, now()
    FROM gabungan;

    UPDATE public.koreksi_kehadiran_batch SET nip = p_target_nip WHERE nip = ANY(v_nips);
    UPDATE public.mutasi_stok_seragam SET nip = p_target_nip WHERE nip = ANY(v_nips);
    UPDATE public.seragam_penerima SET nip = p_target_nip
    WHERE nip = ANY(v_nips) AND nip <> p_target_nip;
    UPDATE public.seragam_riwayat SET nip = p_target_nip
    WHERE nip = ANY(v_nips) AND nip <> p_target_nip;

    UPDATE public.master_relawan
    SET nama = v_nama,
        asal_organisasi = v_organisasi,
        jabatan = v_jabatan,
        asal_daerah = v_asal_daerah,
        kabupaten_normalisasi = v_kabupaten,
        kategori_wilayah = v_kategori_wilayah,
        ukuran_seragam = v_ukuran,
        catatan_seragam = v_catatan
    WHERE nip = p_target_nip;

    DELETE FROM public.master_relawan
    WHERE nip = ANY(v_nips) AND nip <> p_target_nip;
    GET DIAGNOSTICS v_deleted_profiles = ROW_COUNT;

    RETURN jsonb_build_object(
        'target_nip', p_target_nip,
        'target_nama', v_nama,
        'profil_digabung', v_deleted_profiles,
        'log_dipindah', v_updated_logs,
        'log_duplikat_dihapus', v_deleted_logs
    );
END;
$$;

-- -----------------------------------------------------------------
-- D. RLS, HAK AKSES, DAN AUDIT
-- -----------------------------------------------------------------
ALTER TABLE public.organisasi_kabupaten_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kehadiran_historis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.koreksi_kehadiran_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stok_item_seragam ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mutasi_stok_seragam ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fase10_authenticated_read_org_map" ON public.organisasi_kabupaten_map;
CREATE POLICY "fase10_authenticated_read_org_map" ON public.organisasi_kabupaten_map
FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "fase10_authenticated_read_historis" ON public.kehadiran_historis;
CREATE POLICY "fase10_authenticated_read_historis" ON public.kehadiran_historis
FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "fase10_authenticated_read_koreksi" ON public.koreksi_kehadiran_batch;
CREATE POLICY "fase10_authenticated_read_koreksi" ON public.koreksi_kehadiran_batch
FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "fase10_authenticated_read_stok" ON public.stok_item_seragam;
CREATE POLICY "fase10_authenticated_read_stok" ON public.stok_item_seragam
FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "fase10_authenticated_read_mutasi" ON public.mutasi_stok_seragam;
CREATE POLICY "fase10_authenticated_read_mutasi" ON public.mutasi_stok_seragam
FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.organisasi_kabupaten_map, public.kehadiran_historis,
    public.koreksi_kehadiran_batch, public.stok_item_seragam,
    public.mutasi_stok_seragam FROM anon;
GRANT SELECT ON public.organisasi_kabupaten_map, public.kehadiran_historis,
    public.koreksi_kehadiran_batch, public.stok_item_seragam,
    public.mutasi_stok_seragam TO authenticated;
GRANT SELECT ON public.v_kandidat_duplikat_personel,
    public.v_peringkat_personel_operasional, public.v_peringkat_personel_umum,
    public.v_status_seragam_set TO authenticated;

REVOKE ALL ON FUNCTION public.simpan_koreksi_kehadiran(text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.simpan_kehadiran_historis(text,date,text,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.catat_mutasi_stok_seragam(text,text,text,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.simpan_status_seragam_set(text,text,text,text,text,date,date,text,text,text,boolean,boolean,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_relawan_manual(text[],text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simpan_koreksi_kehadiran(text,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.simpan_kehadiran_historis(text,date,text,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catat_mutasi_stok_seragam(text,text,text,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.simpan_status_seragam_set(text,text,text,text,text,date,date,text,text,text,boolean,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_relawan_manual(text[],text,jsonb) TO authenticated;

DO $$
BEGIN
    IF to_regprocedure('public.catat_audit_perubahan()') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trg_fase10_audit_historis ON public.kehadiran_historis';
        EXECUTE 'CREATE TRIGGER trg_fase10_audit_historis
                 AFTER INSERT OR UPDATE OR DELETE ON public.kehadiran_historis
                 FOR EACH ROW EXECUTE FUNCTION public.catat_audit_perubahan()';
    END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT
    (SELECT count(*) FROM public.organisasi_kabupaten_map) AS pemetaan_organisasi,
    (SELECT count(*) FROM public.master_relawan WHERE kabupaten_normalisasi IS NOT NULL) AS personel_terpetakan,
    (SELECT count(*) FROM public.v_kandidat_duplikat_personel) AS kelompok_duplikat_identik,
    (SELECT count(*) FROM public.stok_item_seragam WHERE jenis = 'atasan') AS ukuran_atasan,
    (SELECT count(*) FROM public.stok_item_seragam WHERE jenis = 'bawahan') AS ukuran_bawahan;
