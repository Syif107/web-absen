-- FASE 12: merge terkontrol lebih dari 50% kandidat nama mirip.
-- Target batch: 250 dari sekitar 482 pasangan (minimum wajib 242).
-- Setiap NIP hanya boleh muncul pada satu pasangan agar jaringan nama mirip
-- tidak melebur berantai. Profil dengan persentase hari lebih tinggi menjadi
-- target; bila sama, urutannya adalah total hari, total sesi, kelengkapan data,
-- profil lebih lama, lalu NIP.

BEGIN;

LOCK TABLE public.master_relawan IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.log_absensi IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.backup_fase12_master_relawan_20261003 AS
TABLE public.master_relawan;

CREATE TABLE IF NOT EXISTS public.backup_fase12_log_absensi_20261003 AS
TABLE public.log_absensi;

CREATE TABLE IF NOT EXISTS public.backup_fase12_seragam_penerima_20261003 AS
TABLE public.seragam_penerima;

CREATE TABLE IF NOT EXISTS public.backup_fase12_seragam_riwayat_20261003 AS
TABLE public.seragam_riwayat;

CREATE TABLE IF NOT EXISTS public.audit_merge_fase12_20261003 (
    source_nip text PRIMARY KEY,
    source_nama text NOT NULL,
    source_persentase numeric NOT NULL,
    target_nip text NOT NULL,
    target_nama text NOT NULL,
    target_persentase numeric NOT NULL,
    kabupaten text,
    organisasi text,
    log_dipindah integer NOT NULL DEFAULT 0,
    log_duplikat_dihapus integer NOT NULL DEFAULT 0,
    alasan_target text NOT NULL,
    digabung_pada timestamptz NOT NULL DEFAULT now()
);

-- Tabel cadangan dan audit menyimpan data personel. Tutup akses API publik;
-- tabel tetap dapat diperiksa oleh pemilik proyek melalui SQL Editor.
ALTER TABLE public.backup_fase12_master_relawan_20261003 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_fase12_log_absensi_20261003 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_fase12_seragam_penerima_20261003 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_fase12_seragam_riwayat_20261003 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_merge_fase12_20261003 ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.audit_merge_fase12_20261003) THEN
        RAISE EXCEPTION 'Fase 12 sudah pernah dijalankan. Audit tidak kosong; hentikan agar batch tidak terulang.';
    END IF;
END;
$$;

CREATE TEMP TABLE fase12_kandidat ON COMMIT DROP AS
WITH RECURSIVE base AS (
    SELECT
        m.nip,
        m.nama,
        m.asal_organisasi,
        m.asal_daerah,
        m.created_at,
        regexp_replace(upper(trim(coalesce(m.nama, ''))), '[^A-Z0-9]', '', 'g') AS nama_norm,
        regexp_replace(upper(trim(coalesce(m.asal_organisasi, ''))), '\s+', ' ', 'g') AS organisasi,
        CASE
            WHEN regexp_replace(upper(trim(coalesce(m.asal_organisasi, ''))), '\s+', ' ', 'g') IN (
                'PUSAT','DPD JOMBANG','DPC KABUH','OPSHID KABUH','DPC PLOSO','DCP PLOSO',
                'DPC KUDU','DPC PLANDAAN','DPC TEMBELANG','DPC NGUSIKAN','DPC MEGALUH',
                'DPC KESAMBEN','DPC DADITUNGGAL','DPC GABUS BANARAN','DPC JATIROWO','DPC KLECO'
            ) THEN 'JOMBANG'
            WHEN regexp_replace(upper(trim(coalesce(m.asal_organisasi, ''))), '\s+', ' ', 'g') ~ '^DPD\s+'
                 AND regexp_replace(upper(trim(coalesce(m.asal_organisasi, ''))), '\s+', ' ', 'g') <> 'DPD ORSHID'
                THEN regexp_replace(
                    regexp_replace(upper(trim(coalesce(m.asal_organisasi, ''))), '\s+', ' ', 'g'),
                    '^DPD\s+(KAB(UPATEN)?\s+)?', ''
                )
            ELSE regexp_replace(upper(trim(coalesce(m.asal_daerah, ''))), '\s+', ' ', 'g')
        END AS kabupaten,
        coalesce(r.persentase_hari, 0)::numeric AS persentase_hari,
        coalesce(r.total_hari, 0)::integer AS total_hari,
        coalesce(r.total_sesi, 0)::integer AS total_sesi,
        (
            (coalesce(nullif(trim(m.nama), ''), '') <> '')::integer +
            (coalesce(nullif(trim(m.asal_organisasi), ''), '') <> '')::integer +
            (coalesce(nullif(trim(m.jabatan), ''), '') <> '')::integer +
            (coalesce(nullif(trim(m.asal_daerah), ''), '') <> '')::integer +
            (coalesce(nullif(trim(m.kategori_wilayah), ''), '') NOT IN ('', 'belum_dilengkapi'))::integer +
            (coalesce(nullif(trim(m.ukuran_seragam), ''), '') <> '')::integer +
            (coalesce(nullif(trim(m.catatan_seragam), ''), '') <> '')::integer
        ) AS kelengkapan
    FROM public.master_relawan m
    LEFT JOIN public.v_ringkasan_personel r ON r.nip = m.nip
), pairs AS (
    SELECT
        a.nip AS nip_a, a.nama AS nama_a, a.nama_norm AS norm_a,
        a.organisasi AS org_a, a.persentase_hari AS pct_a,
        a.total_hari AS hari_a, a.total_sesi AS sesi_a,
        a.kelengkapan AS lengkap_a, a.created_at AS dibuat_a,
        b.nip AS nip_b, b.nama AS nama_b, b.nama_norm AS norm_b,
        b.organisasi AS org_b, b.persentase_hari AS pct_b,
        b.total_hari AS hari_b, b.total_sesi AS sesi_b,
        b.kelengkapan AS lengkap_b, b.created_at AS dibuat_b,
        a.kabupaten
    FROM base a
    JOIN base b ON a.nip < b.nip AND a.kabupaten = b.kabupaten
    WHERE a.kabupaten <> ''
      AND a.nama_norm <> '' AND b.nama_norm <> ''
      AND a.nama_norm <> b.nama_norm
      AND abs(length(a.nama_norm) - length(b.nama_norm)) <= 1
      AND (
          (length(a.nama_norm) = length(b.nama_norm) AND (
              SELECT count(*)
              FROM generate_series(1, length(a.nama_norm)) posisi
              WHERE substr(a.nama_norm, posisi, 1) <> substr(b.nama_norm, posisi, 1)
          ) = 1)
          OR
          (length(a.nama_norm) = length(b.nama_norm) + 1 AND EXISTS (
              SELECT 1 FROM generate_series(1, length(a.nama_norm)) posisi
              WHERE overlay(a.nama_norm placing '' from posisi for 1) = b.nama_norm
          ))
          OR
          (length(b.nama_norm) = length(a.nama_norm) + 1 AND EXISTS (
              SELECT 1 FROM generate_series(1, length(b.nama_norm)) posisi
              WHERE overlay(b.nama_norm placing '' from posisi for 1) = a.nama_norm
          ))
      )
), edges(src, dst) AS (
    SELECT nip_a, nip_b FROM pairs
    UNION ALL
    SELECT nip_b, nip_a FROM pairs
), reach(root, node) AS (
    SELECT src, src FROM edges
    UNION
    SELECT reach.root, edges.dst
    FROM reach
    JOIN edges ON edges.src = reach.node
), node_component AS (
    SELECT node, min(root) AS component
    FROM reach
    GROUP BY node
), component_size AS (
    SELECT component, count(*)::integer AS jumlah
    FROM node_component
    GROUP BY component
), attendance AS (
    SELECT nip, min(tanggal) AS pertama, max(tanggal) AS terakhir
    FROM public.log_absensi
    GROUP BY nip
), slot_overlap AS (
    SELECT p.nip_a, p.nip_b, count(*)::integer AS slot_sama
    FROM pairs p
    JOIN public.log_absensi a ON a.nip = p.nip_a
    JOIN public.log_absensi b
      ON b.nip = p.nip_b
     AND b.tanggal = a.tanggal
     AND coalesce(b.sesi, '') = coalesce(a.sesi, '')
     AND coalesce(b.lokasi, '') = coalesce(a.lokasi, '')
    GROUP BY p.nip_a, p.nip_b
)
SELECT
    p.*,
    cs.jumlah AS ukuran_jaringan,
    aa.pertama AS pertama_a, aa.terakhir AS terakhir_a,
    ab.pertama AS pertama_b, ab.terakhir AS terakhir_b,
    coalesce(so.slot_sama, 0)::integer AS slot_sama,
    (SELECT count(*) FROM public.seragam_penerima sp WHERE sp.nip IN (p.nip_a, p.nip_b))::integer AS jumlah_seragam
FROM pairs p
JOIN node_component nc ON nc.node = p.nip_a
JOIN component_size cs ON cs.component = nc.component
LEFT JOIN attendance aa ON aa.nip = p.nip_a
LEFT JOIN attendance ab ON ab.nip = p.nip_b
LEFT JOIN slot_overlap so ON so.nip_a = p.nip_a AND so.nip_b = p.nip_b;

CREATE TEMP TABLE fase12_pilihan (
    urutan serial PRIMARY KEY,
    source_nip text NOT NULL UNIQUE,
    source_nama text NOT NULL,
    source_persentase numeric NOT NULL,
    target_nip text NOT NULL UNIQUE,
    target_nama text NOT NULL,
    target_persentase numeric NOT NULL,
    kabupaten text,
    organisasi text,
    alasan_target text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE fase12_nip_terpakai (
    nip text PRIMARY KEY
) ON COMMIT DROP;

DO $$
DECLARE
    kandidat record;
    v_target_nip text;
    v_target_nama text;
    v_target_pct numeric;
    v_source_nip text;
    v_source_nama text;
    v_source_pct numeric;
    v_alasan text;
    v_jumlah integer;
BEGIN
    FOR kandidat IN
        SELECT *
        FROM fase12_kandidat
        WHERE jumlah_seragam <= 1
        ORDER BY
            (ukuran_jaringan = 2) DESC,
            (slot_sama = 0) DESC,
            (terakhir_a < pertama_b OR terakhir_b < pertama_a) DESC NULLS LAST,
            least(length(norm_a), length(norm_b)) DESC,
            abs(pct_a - pct_b) DESC,
            nama_a, nama_b, nip_a, nip_b
    LOOP
        IF EXISTS (
            SELECT 1 FROM fase12_nip_terpakai
            WHERE nip IN (kandidat.nip_a, kandidat.nip_b)
        ) THEN
            CONTINUE;
        END IF;

        IF kandidat.pct_a > kandidat.pct_b
           OR (kandidat.pct_a = kandidat.pct_b AND kandidat.hari_a > kandidat.hari_b)
           OR (kandidat.pct_a = kandidat.pct_b AND kandidat.hari_a = kandidat.hari_b AND kandidat.sesi_a > kandidat.sesi_b)
           OR (kandidat.pct_a = kandidat.pct_b AND kandidat.hari_a = kandidat.hari_b AND kandidat.sesi_a = kandidat.sesi_b AND kandidat.lengkap_a > kandidat.lengkap_b)
           OR (kandidat.pct_a = kandidat.pct_b AND kandidat.hari_a = kandidat.hari_b AND kandidat.sesi_a = kandidat.sesi_b AND kandidat.lengkap_a = kandidat.lengkap_b AND coalesce(kandidat.dibuat_a, 'infinity'::timestamptz) < coalesce(kandidat.dibuat_b, 'infinity'::timestamptz))
           OR (kandidat.pct_a = kandidat.pct_b AND kandidat.hari_a = kandidat.hari_b AND kandidat.sesi_a = kandidat.sesi_b AND kandidat.lengkap_a = kandidat.lengkap_b AND coalesce(kandidat.dibuat_a, 'infinity'::timestamptz) = coalesce(kandidat.dibuat_b, 'infinity'::timestamptz) AND kandidat.nip_a < kandidat.nip_b)
        THEN
            v_target_nip := kandidat.nip_a; v_target_nama := kandidat.nama_a; v_target_pct := kandidat.pct_a;
            v_source_nip := kandidat.nip_b; v_source_nama := kandidat.nama_b; v_source_pct := kandidat.pct_b;
        ELSE
            v_target_nip := kandidat.nip_b; v_target_nama := kandidat.nama_b; v_target_pct := kandidat.pct_b;
            v_source_nip := kandidat.nip_a; v_source_nama := kandidat.nama_a; v_source_pct := kandidat.pct_a;
        END IF;

        v_alasan := CASE
            WHEN kandidat.pct_a <> kandidat.pct_b THEN 'Persentase kehadiran lebih tinggi'
            WHEN kandidat.hari_a <> kandidat.hari_b THEN 'Persentase sama; total hari lebih tinggi'
            WHEN kandidat.sesi_a <> kandidat.sesi_b THEN 'Persentase dan hari sama; total sesi lebih tinggi'
            WHEN kandidat.lengkap_a <> kandidat.lengkap_b THEN 'Persentase, hari, dan sesi sama; profil lebih lengkap'
            ELSE 'Nilai sama; profil lebih lama atau NIP lebih awal'
        END;

        INSERT INTO fase12_pilihan (
            source_nip, source_nama, source_persentase,
            target_nip, target_nama, target_persentase,
            kabupaten, organisasi, alasan_target
        ) VALUES (
            v_source_nip, v_source_nama, v_source_pct,
            v_target_nip, v_target_nama, v_target_pct,
            kandidat.kabupaten, kandidat.org_a, v_alasan
        );

        INSERT INTO fase12_nip_terpakai(nip)
        VALUES (v_source_nip), (v_target_nip);

        SELECT count(*) INTO v_jumlah FROM fase12_pilihan;
        EXIT WHEN v_jumlah >= 250;
    END LOOP;

    SELECT count(*) INTO v_jumlah FROM fase12_pilihan;
    IF v_jumlah < 242 THEN
        RAISE EXCEPTION 'Rencana hanya menghasilkan % pasangan satu-lawan-satu; minimum 242. Tidak ada data yang diubah.', v_jumlah;
    END IF;
END;
$$;

DO $$
DECLARE
    pilihan record;
    target_profile public.master_relawan%ROWTYPE;
    v_log_duplikat integer;
    v_log_dipindah integer;
    v_seragam integer;
BEGIN
    FOR pilihan IN SELECT * FROM fase12_pilihan ORDER BY urutan
    LOOP
        SELECT * INTO target_profile
        FROM public.master_relawan
        WHERE nip = pilihan.target_nip
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Target % tidak ditemukan. Seluruh transaksi dibatalkan.', pilihan.target_nip;
        END IF;

        PERFORM 1 FROM public.master_relawan
        WHERE nip = pilihan.source_nip
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Sumber % tidak ditemukan. Seluruh transaksi dibatalkan.', pilihan.source_nip;
        END IF;

        SELECT count(*) INTO v_seragam
        FROM public.seragam_penerima
        WHERE nip IN (pilihan.source_nip, pilihan.target_nip);
        IF v_seragam > 1 THEN
            RAISE EXCEPTION 'Pasangan % dan % memiliki dua data seragam. Seluruh transaksi dibatalkan.', pilihan.source_nip, pilihan.target_nip;
        END IF;

        WITH ranked AS (
            SELECT id,
                   row_number() OVER (
                       PARTITION BY tanggal, sesi, coalesce(lokasi, '')
                       ORDER BY CASE WHEN nip = pilihan.target_nip THEN 0 ELSE 1 END, id
                   ) AS nomor
            FROM public.log_absensi
            WHERE nip IN (pilihan.source_nip, pilihan.target_nip)
        )
        DELETE FROM public.log_absensi log
        USING ranked
        WHERE log.id = ranked.id AND ranked.nomor > 1;
        GET DIAGNOSTICS v_log_duplikat = ROW_COUNT;

        UPDATE public.log_absensi
        SET nip = pilihan.target_nip,
            nama = target_profile.nama,
            bidang = target_profile.jabatan,
            organisasi = target_profile.asal_organisasi
        WHERE nip IN (pilihan.source_nip, pilihan.target_nip);
        GET DIAGNOSTICS v_log_dipindah = ROW_COUNT;

        UPDATE public.seragam_penerima
        SET nip = pilihan.target_nip
        WHERE nip = pilihan.source_nip;

        UPDATE public.seragam_riwayat
        SET nip = pilihan.target_nip
        WHERE nip = pilihan.source_nip;

        IF to_regclass('public.koreksi_kehadiran_batch') IS NOT NULL THEN
            EXECUTE 'UPDATE public.koreksi_kehadiran_batch SET nip = $1 WHERE nip = $2'
            USING pilihan.target_nip, pilihan.source_nip;
        END IF;

        IF to_regclass('public.mutasi_stok_seragam') IS NOT NULL THEN
            EXECUTE 'UPDATE public.mutasi_stok_seragam SET nip = $1 WHERE nip = $2'
            USING pilihan.target_nip, pilihan.source_nip;
        END IF;

        IF to_regclass('public.kehadiran_historis') IS NOT NULL THEN
            EXECUTE $sql$
                WITH gabungan AS MATERIALIZED (
                    SELECT
                        bulan,
                        lokasi,
                        min(kategori) AS kategori,
                        least(
                            extract(day FROM (date_trunc('month', bulan) + interval '1 month - 1 day'))::integer,
                            sum(jumlah_hari)::integer
                        ) AS jumlah_hari,
                        string_agg(DISTINCT catatan, ' | ') AS catatan,
                        bool_or(disetujui) AS disetujui,
                        min(dibuat_pada) AS dibuat_pada
                    FROM public.kehadiran_historis
                    WHERE nip = ANY($1)
                    GROUP BY bulan, lokasi
                ), terhapus AS (
                    DELETE FROM public.kehadiran_historis
                    WHERE nip = ANY($1)
                )
                INSERT INTO public.kehadiran_historis
                    (nip, bulan, lokasi, kategori, jumlah_hari, catatan, disetujui, dibuat_pada, updated_at)
                SELECT $2, bulan, lokasi, kategori, jumlah_hari, catatan,
                       disetujui, dibuat_pada, now()
                FROM gabungan
            $sql$ USING ARRAY[pilihan.source_nip, pilihan.target_nip], pilihan.target_nip;
        END IF;

        DELETE FROM public.master_relawan
        WHERE nip = pilihan.source_nip;

        INSERT INTO public.audit_merge_fase12_20261003 (
            source_nip, source_nama, source_persentase,
            target_nip, target_nama, target_persentase,
            kabupaten, organisasi, log_dipindah,
            log_duplikat_dihapus, alasan_target
        ) VALUES (
            pilihan.source_nip, pilihan.source_nama, pilihan.source_persentase,
            pilihan.target_nip, pilihan.target_nama, pilihan.target_persentase,
            pilihan.kabupaten, pilihan.organisasi, v_log_dipindah,
            v_log_duplikat, pilihan.alasan_target
        );
    END LOOP;
END;
$$;

DO $$
DECLARE
    v_merge integer;
    v_sumber_tersisa integer;
BEGIN
    SELECT count(*) INTO v_merge FROM public.audit_merge_fase12_20261003;
    SELECT count(*) INTO v_sumber_tersisa
    FROM public.audit_merge_fase12_20261003 a
    JOIN public.master_relawan m ON m.nip = a.source_nip;

    IF v_merge < 242 OR v_sumber_tersisa <> 0 THEN
        RAISE EXCEPTION 'Verifikasi Fase 12 gagal: merge %, sumber tersisa %. Seluruh transaksi dibatalkan.', v_merge, v_sumber_tersisa;
    END IF;
END;
$$;

COMMIT;

SELECT
    count(*)::integer AS profil_digabung,
    count(*) FILTER (WHERE source_persentase = target_persentase)::integer AS persentase_sama,
    count(*) FILTER (WHERE source_persentase < target_persentase)::integer AS persentase_naik,
    sum(log_dipindah)::integer AS log_dipindah,
    sum(log_duplikat_dihapus)::integer AS log_duplikat_dihapus
FROM public.audit_merge_fase12_20261003;
