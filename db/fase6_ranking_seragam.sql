-- ================================================================
-- RELAWANSYNC V2 - FASE 6: PERINGKAT, WILAYAH, DAN KONTROL SERAGAM
-- Tanggal rancangan: 2026-10-02
--
-- Migrasi ini bersifat aditif dan dapat dijalankan ulang. Data lama dicadangkan
-- sebelum perubahan nama sesi/lokasi dilakukan.
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- A. BACKUP DATA PRODUKSI SEBELUM NORMALISASI
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.backup_fase6_master_relawan_20261002 AS
TABLE public.master_relawan;

CREATE TABLE IF NOT EXISTS public.backup_fase6_log_absensi_20261002 AS
TABLE public.log_absensi;

ALTER TABLE public.backup_fase6_master_relawan_20261002 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_fase6_log_absensi_20261002 ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- B. PERLUAS MASTER PERSONEL
-- ----------------------------------------------------------------
ALTER TABLE public.master_relawan
    ADD COLUMN IF NOT EXISTS asal_daerah text,
    ADD COLUMN IF NOT EXISTS kategori_wilayah text NOT NULL DEFAULT 'belum_dilengkapi',
    ADD COLUMN IF NOT EXISTS ukuran_seragam text,
    ADD COLUMN IF NOT EXISTS catatan_seragam text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'master_relawan_kategori_wilayah_check'
          AND conrelid = 'public.master_relawan'::regclass
    ) THEN
        ALTER TABLE public.master_relawan
            ADD CONSTRAINT master_relawan_kategori_wilayah_check
            CHECK (kategori_wilayah IN (
                'belum_dilengkapi', 'jombang', 'luar_jombang', 'zona_4'
            ));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'master_relawan_ukuran_seragam_check'
          AND conrelid = 'public.master_relawan'::regclass
    ) THEN
        ALTER TABLE public.master_relawan
            ADD CONSTRAINT master_relawan_ukuran_seragam_check
            CHECK (
                ukuran_seragam IS NULL OR ukuran_seragam IN (
                    'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Khusus'
                )
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_master_relawan_kategori_wilayah
    ON public.master_relawan (kategori_wilayah);

-- ----------------------------------------------------------------
-- C. REFERENSI PROYEK DAN NORMALISASI DATA LAMA
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proyek_ref (
    kode        text PRIMARY KEY,
    nama        text NOT NULL UNIQUE,
    kategori    text NOT NULL CHECK (kategori IN ('khususul_khusus', 'lainnya')),
    aktif       boolean NOT NULL DEFAULT true,
    urutan      integer NOT NULL DEFAULT 999,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.proyek_ref (kode, nama, kategori, aktif, urutan) VALUES
    ('perpustakaan-tashawwuf', 'Perpustakaan Tashawwuf', 'khususul_khusus', true, 1),
    ('masjid-raya', 'Masjid Raya Fatchan Mubiina Chaddun ''Adhiim', 'khususul_khusus', true, 2),
    ('monumen-sang-mursyid', 'Monumen Semboyan Sang Mursyid', 'khususul_khusus', true, 3),
    ('kanal-taat', 'Kanal Ta''at', 'khususul_khusus', true, 4),
    ('gapura-syukur', 'Gapura Syukur', 'khususul_khusus', true, 5),
    ('kerja-bakti', 'Kerja Bakti', 'lainnya', true, 101),
    ('pembesian', 'Pembesian', 'lainnya', true, 102),
    ('paving', 'Paving', 'lainnya', true, 103),
    ('maqom-bapak-wali-talqin', 'Maqom Bapak Wali Talqin', 'lainnya', true, 104),
    ('muat-genteng', 'Muat Genteng', 'lainnya', true, 105),
    ('gudang-keramik', 'Gudang Keramik', 'lainnya', true, 106)
ON CONFLICT (kode) DO UPDATE SET
    nama = EXCLUDED.nama,
    kategori = EXCLUDED.kategori,
    aktif = EXCLUDED.aktif,
    urutan = EXCLUDED.urutan,
    updated_at = now();

-- Produksi lama menggunakan Siang. Mulai fase ini istilah resminya Pagi.
UPDATE public.log_absensi
SET sesi = 'Pagi'
WHERE sesi = 'Siang';

-- Samakan ejaan lama tanpa mengubah makna riwayat absensi.
UPDATE public.log_absensi
SET lokasi = CASE lokasi
    WHEN 'Masjid Raya Fatchan Mubiina Chaddun ''Adhiima'
        THEN 'Masjid Raya Fatchan Mubiina Chaddun ''Adhiim'
    WHEN 'Monumen Semboyan'
        THEN 'Monumen Semboyan Sang Mursyid'
    WHEN 'Gapuro Syukur'
        THEN 'Gapura Syukur'
    ELSE lokasi
END
WHERE lokasi IN (
    'Masjid Raya Fatchan Mubiina Chaddun ''Adhiima',
    'Monumen Semboyan',
    'Gapuro Syukur'
);

-- ----------------------------------------------------------------
-- D. STOK, STATUS PENERIMA, DAN RIWAYAT SERAGAM
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stok_seragam (
    ukuran            text PRIMARY KEY CHECK (ukuran IN ('S','M','L','XL','XXL','XXXL','Khusus')),
    jumlah_tersedia   integer NOT NULL DEFAULT 0 CHECK (jumlah_tersedia >= 0),
    catatan           text,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.stok_seragam (ukuran, jumlah_tersedia)
VALUES ('S',0),('M',0),('L',0),('XL',0),('XXL',0),('XXXL',0),('Khusus',0)
ON CONFLICT (ukuran) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.seragam_penerima (
    nip                       text PRIMARY KEY,
    jalur_kelayakan           text CHECK (
        jalur_kelayakan IS NULL OR jalur_kelayakan IN (
            'khususul_khusus', 'lainnya', 'zona_4'
        )
    ),
    status_proses             text NOT NULL DEFAULT 'belum_memenuhi' CHECK (
        status_proses IN (
            'belum_memenuhi', 'memenuhi_syarat', 'direncanakan',
            'menunggu_stok', 'siap_diserahkan', 'sudah_diserahkan'
        )
    ),
    ukuran_dibutuhkan         text CHECK (
        ukuran_dibutuhkan IS NULL OR ukuran_dibutuhkan IN (
            'S','M','L','XL','XXL','XXXL','Khusus'
        )
    ),
    kode_seragam              text,
    status_penguasaan         text NOT NULL DEFAULT 'belum_memiliki' CHECK (
        status_penguasaan IN (
            'belum_memiliki', 'dipegang_personel', 'dititipkan_kantor',
            'perlu_diserahkan_kembali', 'rusak_hilang', 'menunggu_penggantian'
        )
    ),
    tanggal_memenuhi          date,
    tanggal_rencana           date,
    tanggal_diserahkan        date,
    tanggal_status            timestamptz NOT NULL DEFAULT now(),
    aturan_disetujui          boolean NOT NULL DEFAULT false,
    data_lama                 boolean NOT NULL DEFAULT false,
    catatan                   text,
    updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_seragam_kode
    ON public.seragam_penerima (kode_seragam)
    WHERE kode_seragam IS NOT NULL AND trim(kode_seragam) <> '';

CREATE INDEX IF NOT EXISTS idx_seragam_penerima_status
    ON public.seragam_penerima (status_proses, status_penguasaan);

CREATE TABLE IF NOT EXISTS public.seragam_riwayat (
    id                  bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    nip                 text NOT NULL,
    status_proses       text,
    status_penguasaan   text,
    ukuran              text,
    kode_seragam        text,
    catatan             text,
    dibuat_pada         timestamptz NOT NULL DEFAULT now(),
    dibuat_oleh         uuid DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS idx_seragam_riwayat_nip_waktu
    ON public.seragam_riwayat (nip, dibuat_pada DESC);

-- ----------------------------------------------------------------
-- E. VIEW PERINGKAT
--    Satu tanggal maksimal satu hari per kategori; Pagi dan Malam tetap dua sesi.
-- ----------------------------------------------------------------
DROP VIEW IF EXISTS public.v_status_seragam;
DROP VIEW IF EXISTS public.v_peringkat_personel;

CREATE VIEW public.v_peringkat_personel
WITH (security_invoker = true)
AS
WITH log_norm AS (
    SELECT
        l.nip,
        l.tanggal::date AS tanggal,
        CASE WHEN l.sesi = 'Siang' THEN 'Pagi' ELSE l.sesi END AS sesi,
        CASE
            WHEN l.lokasi IN (
                'Perpustakaan Tashawwuf',
                'Masjid Raya Fatchan Mubiina Chaddun ''Adhiim',
                'Masjid Raya Fatchan Mubiina Chaddun ''Adhiima',
                'Monumen Semboyan Sang Mursyid',
                'Monumen Semboyan',
                'Kanal Ta''at',
                'Gapura Syukur',
                'Gapuro Syukur'
            ) THEN 'khususul_khusus'
            ELSE 'lainnya'
        END AS kategori
    FROM public.log_absensi l
    WHERE l.nip IS NOT NULL
      AND trim(l.nip) <> ''
      AND l.tanggal IS NOT NULL
),
person_days AS (
    SELECT DISTINCT nip, kategori, tanggal FROM log_norm
),
person_sessions AS (
    SELECT DISTINCT nip, kategori, tanggal, sesi FROM log_norm
),
program_days AS (
    SELECT
        kategori,
        tanggal,
        dense_rank() OVER (PARTITION BY kategori ORDER BY tanggal) AS day_seq
    FROM (SELECT DISTINCT kategori, tanggal FROM log_norm) d
),
person_day_seq AS (
    SELECT
        p.nip,
        p.kategori,
        p.tanggal,
        d.day_seq,
        d.day_seq - row_number() OVER (
            PARTITION BY p.nip, p.kategori ORDER BY d.day_seq
        ) AS grp
    FROM person_days p
    JOIN program_days d USING (kategori, tanggal)
),
streak_groups AS (
    SELECT
        nip,
        kategori,
        grp,
        count(*)::integer AS panjang,
        max(day_seq) AS seq_akhir
    FROM person_day_seq
    GROUP BY nip, kategori, grp
),
streaks AS (
    SELECT
        s.nip,
        s.kategori,
        max(s.panjang)::integer AS streak_terpanjang,
        COALESCE(max(s.panjang) FILTER (
            WHERE s.seq_akhir = (
                SELECT max(pd.day_seq) FROM program_days pd
                WHERE pd.kategori = s.kategori
            )
        ), 0)::integer AS streak_saat_ini
    FROM streak_groups s
    GROUP BY s.nip, s.kategori
),
numbered_days AS (
    SELECT
        nip,
        kategori,
        tanggal,
        row_number() OVER (PARTITION BY nip, kategori ORDER BY tanggal) AS hari_ke
    FROM person_days
),
fortieth AS (
    SELECT nip, kategori, min(tanggal) AS tanggal_ke_40
    FROM numbered_days
    WHERE hari_ke >= 40
    GROUP BY nip, kategori
),
person_totals AS (
    SELECT
        d.nip,
        d.kategori,
        count(*)::integer AS total_hari,
        min(d.tanggal) AS hadir_pertama,
        max(d.tanggal) AS hadir_terakhir,
        count(*) FILTER (WHERE d.tanggal >= current_date - 89)::integer AS hari_90
    FROM person_days d
    GROUP BY d.nip, d.kategori
),
session_totals AS (
    SELECT
        nip,
        kategori,
        count(*)::integer AS total_sesi,
        count(*) FILTER (WHERE tanggal >= current_date - 89)::integer AS sesi_90
    FROM person_sessions
    GROUP BY nip, kategori
),
week_totals AS (
    SELECT
        nip,
        kategori,
        count(DISTINCT date_trunc('week', tanggal)) FILTER (
            WHERE tanggal >= current_date - 83
        )::integer AS minggu_aktif_12
    FROM person_days
    GROUP BY nip, kategori
),
program_totals AS (
    SELECT
        kategori,
        count(DISTINCT tanggal) FILTER (WHERE tanggal >= current_date - 89)::integer AS hari_program_90,
        count(DISTINCT (tanggal, sesi)) FILTER (WHERE tanggal >= current_date - 89)::integer AS sesi_program_90,
        count(DISTINCT date_trunc('week', tanggal)) FILTER (
            WHERE tanggal >= current_date - 83
        )::integer AS minggu_program_12
    FROM log_norm
    GROUP BY kategori
),
base AS (
    SELECT
        m.nip,
        m.nama,
        m.asal_organisasi,
        m.asal_daerah,
        m.kategori_wilayah,
        m.ukuran_seragam,
        t.kategori,
        t.total_hari,
        COALESCE(st.total_sesi, 0) AS total_sesi,
        t.hari_90,
        COALESCE(st.sesi_90, 0) AS sesi_90,
        COALESCE(w.minggu_aktif_12, 0) AS minggu_aktif_12,
        t.hadir_pertama,
        t.hadir_terakhir,
        COALESCE(s.streak_saat_ini, 0) AS streak_saat_ini,
        COALESCE(s.streak_terpanjang, 0) AS streak_terpanjang,
        CASE
            WHEN p.hari_program_90 = 0 THEN 0
            ELSE round(100.0 * t.hari_90 / p.hari_program_90, 1)
        END AS persentase_hari_90,
        CASE
            WHEN p.sesi_program_90 = 0 THEN 0
            ELSE round(100.0 * COALESCE(st.sesi_90, 0) / p.sesi_program_90, 1)
        END AS persentase_sesi_90,
        round(100 * (
            0.40 * LEAST(1, t.hari_90::numeric / GREATEST(p.hari_program_90, 1)) +
            0.20 * LEAST(1, COALESCE(st.sesi_90, 0)::numeric / GREATEST(p.sesi_program_90, 1)) +
            0.20 * LEAST(1, COALESCE(w.minggu_aktif_12, 0)::numeric / GREATEST(p.minggu_program_12, 1)) +
            0.15 * LEAST(1, t.total_hari::numeric / 80) +
            0.05 * CASE
                WHEN current_date - t.hadir_terakhir <= 7 THEN 1
                WHEN current_date - t.hadir_terakhir <= 14 THEN 0.8
                WHEN current_date - t.hadir_terakhir <= 30 THEN 0.5
                ELSE 0
            END
        ), 1) AS indeks_keaktifan,
        CASE
            WHEN m.kategori_wilayah = 'zona_4' AND t.total_hari >= 1 THEN true
            WHEN t.total_hari >= 40 THEN true
            ELSE false
        END AS memenuhi_syarat,
        CASE
            WHEN m.kategori_wilayah = 'zona_4' THEN
                min(t.hadir_pertama) OVER (PARTITION BY m.nip)
            ELSE f.tanggal_ke_40
        END AS tanggal_memenuhi,
        CASE
            WHEN m.kategori_wilayah = 'zona_4' THEN 'zona_4'
            ELSE t.kategori
        END AS jalur_kelayakan
    FROM person_totals t
    JOIN public.master_relawan m ON m.nip = t.nip
    JOIN program_totals p ON p.kategori = t.kategori
    LEFT JOIN session_totals st
        ON st.nip = t.nip AND st.kategori = t.kategori
    LEFT JOIN week_totals w
        ON w.nip = t.nip AND w.kategori = t.kategori
    LEFT JOIN streaks s
        ON s.nip = t.nip AND s.kategori = t.kategori
    LEFT JOIN fortieth f
        ON f.nip = t.nip AND f.kategori = t.kategori
),
scored AS (
    SELECT
        b.*,
        CASE
            WHEN b.indeks_keaktifan >= 85 THEN 'Sangat Aktif'
            WHEN b.indeks_keaktifan >= 70 THEN 'Aktif'
            WHEN b.indeks_keaktifan >= 55 THEN 'Cukup Aktif'
            ELSE 'Keaktifan Rendah'
        END AS tingkat_keaktifan
    FROM base b
)
SELECT
    s.*,
    CASE WHEN s.memenuhi_syarat THEN
        row_number() OVER (
            PARTITION BY s.kategori, s.memenuhi_syarat
            ORDER BY
                s.indeks_keaktifan DESC,
                s.tanggal_memenuhi ASC NULLS LAST,
                s.total_hari DESC,
                s.nip ASC
        )::integer
    END AS peringkat
FROM scored s;

CREATE VIEW public.v_status_seragam
WITH (security_invoker = true)
AS
WITH eligible AS (
    SELECT * FROM (
        SELECT
            r.*,
            row_number() OVER (
                PARTITION BY r.nip
                ORDER BY
                    CASE WHEN r.jalur_kelayakan = 'zona_4' THEN 0 ELSE 1 END,
                    r.tanggal_memenuhi ASC NULLS LAST,
                    r.indeks_keaktifan DESC
            ) AS pilihan
        FROM public.v_peringkat_personel r
        WHERE r.memenuhi_syarat
    ) x
    WHERE pilihan = 1
),
last_attendance AS (
    SELECT nip, max(tanggal::date) AS tanggal_terakhir
    FROM public.log_absensi
    WHERE nip IS NOT NULL AND trim(nip) <> ''
    GROUP BY nip
)
SELECT
    m.nip,
    m.nama,
    m.asal_organisasi,
    m.asal_daerah,
    m.kategori_wilayah,
    m.ukuran_seragam,
    COALESCE(e.memenuhi_syarat, false) AS memenuhi_syarat,
    e.tanggal_memenuhi,
    e.jalur_kelayakan,
    e.indeks_keaktifan,
    e.peringkat,
    COALESCE(
        sp.status_proses,
        CASE WHEN e.memenuhi_syarat THEN 'memenuhi_syarat' ELSE 'belum_memenuhi' END
    ) AS status_proses,
    COALESCE(sp.ukuran_dibutuhkan, m.ukuran_seragam) AS ukuran_dibutuhkan,
    sp.kode_seragam,
    CASE
        WHEN sp.status_penguasaan = 'dititipkan_kantor'
         AND m.kategori_wilayah IN ('luar_jombang', 'zona_4')
         AND la.tanggal_terakhir > sp.tanggal_status::date
            THEN 'perlu_diserahkan_kembali'
        ELSE COALESCE(sp.status_penguasaan, 'belum_memiliki')
    END AS status_penguasaan,
    (
        sp.status_penguasaan = 'dititipkan_kantor'
        AND m.kategori_wilayah IN ('luar_jombang', 'zona_4')
        AND la.tanggal_terakhir > sp.tanggal_status::date
    ) AS notifikasi_pengembalian,
    sp.tanggal_rencana,
    sp.tanggal_diserahkan,
    sp.tanggal_status,
    sp.aturan_disetujui,
    sp.data_lama,
    sp.catatan,
    la.tanggal_terakhir AS tanggal_hadir_terakhir
FROM public.master_relawan m
LEFT JOIN eligible e ON e.nip = m.nip
LEFT JOIN public.seragam_penerima sp ON sp.nip = m.nip
LEFT JOIN last_attendance la ON la.nip = m.nip;

-- Simpan status dan pengurangan stok dalam satu transaksi server.
CREATE OR REPLACE FUNCTION public.simpan_status_seragam(
    p_nip text,
    p_status_proses text,
    p_ukuran text,
    p_status_penguasaan text,
    p_tanggal_rencana date DEFAULT NULL,
    p_tanggal_diserahkan date DEFAULT NULL,
    p_kode_seragam text DEFAULT NULL,
    p_catatan text DEFAULT NULL,
    p_aturan_disetujui boolean DEFAULT false,
    p_data_lama boolean DEFAULT false,
    p_kurangi_stok boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_lama public.seragam_penerima%ROWTYPE;
    v_status public.v_status_seragam%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesi pengguna tidak valid';
    END IF;

    SELECT * INTO v_status
    FROM public.v_status_seragam
    WHERE nip = p_nip;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Personel dengan NIP % tidak ditemukan', p_nip;
    END IF;

    IF p_status_proses = 'sudah_diserahkan' THEN
        IF p_ukuran IS NULL OR trim(p_ukuran) = '' THEN
            RAISE EXCEPTION 'Ukuran seragam wajib diisi sebelum penyerahan';
        END IF;
        IF p_tanggal_diserahkan IS NULL THEN
            RAISE EXCEPTION 'Tanggal penyerahan wajib diisi';
        END IF;
        IF p_status_penguasaan = 'belum_memiliki' THEN
            RAISE EXCEPTION 'Keberadaan seragam wajib dipilih setelah penyerahan';
        END IF;
        IF NOT p_data_lama AND NOT p_aturan_disetujui THEN
            RAISE EXCEPTION 'Ketentuan seragam wajib disetujui sebelum penyerahan';
        END IF;
        IF NOT p_data_lama AND NOT v_status.memenuhi_syarat THEN
            RAISE EXCEPTION 'Personel belum memenuhi syarat penerimaan seragam';
        END IF;
    END IF;

    SELECT * INTO v_lama
    FROM public.seragam_penerima
    WHERE nip = p_nip
    FOR UPDATE;

    IF p_status_proses = 'sudah_diserahkan'
       AND p_kurangi_stok
       AND (v_lama.nip IS NULL OR v_lama.status_proses <> 'sudah_diserahkan') THEN
        UPDATE public.stok_seragam
        SET jumlah_tersedia = jumlah_tersedia - 1
        WHERE ukuran = p_ukuran
          AND jumlah_tersedia > 0;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Stok ukuran % tidak tersedia', p_ukuran;
        END IF;
    END IF;

    INSERT INTO public.seragam_penerima (
        nip, jalur_kelayakan, status_proses, ukuran_dibutuhkan,
        kode_seragam, status_penguasaan, tanggal_memenuhi,
        tanggal_rencana, tanggal_diserahkan, tanggal_status,
        aturan_disetujui, data_lama, catatan
    ) VALUES (
        p_nip,
        v_status.jalur_kelayakan,
        p_status_proses,
        NULLIF(trim(p_ukuran), ''),
        NULLIF(trim(p_kode_seragam), ''),
        p_status_penguasaan,
        v_status.tanggal_memenuhi,
        p_tanggal_rencana,
        p_tanggal_diserahkan,
        now(),
        p_aturan_disetujui,
        p_data_lama,
        NULLIF(trim(p_catatan), '')
    )
    ON CONFLICT (nip) DO UPDATE SET
        jalur_kelayakan = EXCLUDED.jalur_kelayakan,
        status_proses = EXCLUDED.status_proses,
        ukuran_dibutuhkan = EXCLUDED.ukuran_dibutuhkan,
        kode_seragam = EXCLUDED.kode_seragam,
        status_penguasaan = EXCLUDED.status_penguasaan,
        tanggal_memenuhi = COALESCE(EXCLUDED.tanggal_memenuhi, public.seragam_penerima.tanggal_memenuhi),
        tanggal_rencana = EXCLUDED.tanggal_rencana,
        tanggal_diserahkan = EXCLUDED.tanggal_diserahkan,
        tanggal_status = now(),
        aturan_disetujui = EXCLUDED.aturan_disetujui,
        data_lama = EXCLUDED.data_lama,
        catatan = EXCLUDED.catatan;

    IF p_ukuran IS NOT NULL AND trim(p_ukuran) <> '' THEN
        UPDATE public.master_relawan
        SET ukuran_seragam = p_ukuran
        WHERE nip = p_nip;
    END IF;

    RETURN jsonb_build_object('ok', true, 'nip', p_nip);
END;
$$;

-- ----------------------------------------------------------------
-- F. AUDIT OTOMATIS SETIAP PERUBAHAN STATUS SERAGAM
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.catat_riwayat_seragam()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.seragam_riwayat (
        nip, status_proses, status_penguasaan, ukuran, kode_seragam, catatan
    ) VALUES (
        NEW.nip,
        NEW.status_proses,
        NEW.status_penguasaan,
        NEW.ukuran_dibutuhkan,
        NEW.kode_seragam,
        NEW.catatan
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_catat_riwayat_seragam ON public.seragam_penerima;
CREATE TRIGGER trg_catat_riwayat_seragam
AFTER INSERT OR UPDATE ON public.seragam_penerima
FOR EACH ROW EXECUTE FUNCTION public.catat_riwayat_seragam();

CREATE OR REPLACE FUNCTION public.set_updated_at_fase6()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proyek_ref_updated_at ON public.proyek_ref;
CREATE TRIGGER trg_proyek_ref_updated_at
BEFORE UPDATE ON public.proyek_ref
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_fase6();

DROP TRIGGER IF EXISTS trg_stok_seragam_updated_at ON public.stok_seragam;
CREATE TRIGGER trg_stok_seragam_updated_at
BEFORE UPDATE ON public.stok_seragam
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_fase6();

DROP TRIGGER IF EXISTS trg_seragam_penerima_updated_at ON public.seragam_penerima;
CREATE TRIGGER trg_seragam_penerima_updated_at
BEFORE UPDATE ON public.seragam_penerima
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_fase6();

-- ----------------------------------------------------------------
-- G. RLS DAN HAK AKSES
-- ----------------------------------------------------------------
ALTER TABLE public.proyek_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stok_seragam ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seragam_penerima ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seragam_riwayat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_proyek_ref" ON public.proyek_ref;
CREATE POLICY "authenticated_all_proyek_ref"
ON public.proyek_ref FOR ALL TO authenticated
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_all_stok_seragam" ON public.stok_seragam;
CREATE POLICY "authenticated_all_stok_seragam"
ON public.stok_seragam FOR ALL TO authenticated
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_all_seragam_penerima" ON public.seragam_penerima;
CREATE POLICY "authenticated_all_seragam_penerima"
ON public.seragam_penerima FOR ALL TO authenticated
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_read_seragam_riwayat" ON public.seragam_riwayat;
CREATE POLICY "authenticated_read_seragam_riwayat"
ON public.seragam_riwayat FOR SELECT TO authenticated
USING (true);

REVOKE ALL ON public.proyek_ref FROM anon;
REVOKE ALL ON public.stok_seragam FROM anon;
REVOKE ALL ON public.seragam_penerima FROM anon;
REVOKE ALL ON public.seragam_riwayat FROM anon;
REVOKE ALL ON public.v_peringkat_personel FROM anon;
REVOKE ALL ON public.v_status_seragam FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proyek_ref TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stok_seragam TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seragam_penerima TO authenticated;
GRANT SELECT ON public.seragam_riwayat TO authenticated;
GRANT SELECT ON public.v_peringkat_personel TO authenticated;
GRANT SELECT ON public.v_status_seragam TO authenticated;
REVOKE ALL ON FUNCTION public.simpan_status_seragam(
    text,text,text,text,date,date,text,text,boolean,boolean,boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simpan_status_seragam(
    text,text,text,text,date,date,text,text,boolean,boolean,boolean
) TO authenticated;

COMMIT;

-- Verifikasi cepat setelah migrasi:
SELECT
    (SELECT count(*) FROM public.master_relawan) AS jumlah_personel,
    (SELECT count(*) FROM public.log_absensi) AS jumlah_absensi,
    (SELECT count(*) FROM public.v_peringkat_personel) AS baris_peringkat,
    (SELECT count(*) FROM public.v_status_seragam WHERE memenuhi_syarat) AS memenuhi_seragam;
