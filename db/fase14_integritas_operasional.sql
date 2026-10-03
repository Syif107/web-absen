-- =====================================================================
-- RELAWANSYNC V2 - FASE 14: INTEGRITAS OPERASIONAL TANPA HAPUS DATA
-- =====================================================================
-- Tujuan:
--   1. Menyatukan sumber laporan pada log kanonik tanpa menghapus log lama.
--   2. Mencegah absensi ganda baru pada grain NIP+tanggal+sesi+lokasi.
--   3. Menjadikan zona_asal sebagai satu-satunya sumber aturan Zona 4.
--   4. Menyediakan RPC berhalaman untuk Peringkat dan Kontrol Seragam.
--   5. Mengaktifkan transaksi atomik Master baru + log absensi.
--
-- Aman dijalankan ulang. Migrasi tidak menghapus log_absensi.
-- Jalankan sebelum mengaktifkan FASE14_ENABLED dan FASE5_ENABLED di frontend.
-- =====================================================================

BEGIN;

-- Pertahankan dua personel Zona 4 lama ketika zona_asal belum pernah diisi.
UPDATE public.master_relawan
SET zona_asal = 'zona_4'
WHERE zona_asal IS NULL
  AND kategori_wilayah = 'zona_4';

-- Indeks pencarian untuk pemeriksaan slot. Bukan unique index karena duplikat
-- historis sengaja tetap disimpan pada tabel mentah.
CREATE INDEX IF NOT EXISTS idx_log_absensi_slot_operasional
    ON public.log_absensi (
        nip,
        tanggal,
        (CASE WHEN sesi = 'Siang' THEN 'Pagi' ELSE sesi END),
        (COALESCE(trim(lokasi), ''))
    );

-- Satu baris kanonik per NIP/nama lama + tanggal + sesi + lokasi.
-- Pagi mengalahkan label lama Siang; bila sama, baris terbaru dipakai.
CREATE OR REPLACE VIEW public.v_log_absensi_operasional
WITH (security_invoker = true)
AS
WITH ranked AS (
    SELECT
        l.*,
        CASE WHEN l.sesi = 'Siang' THEN 'Pagi' ELSE l.sesi END AS sesi_normal,
        row_number() OVER (
            PARTITION BY
                COALESCE(NULLIF(trim(l.nip), ''), 'NAMA:' || public.normalisasi_identitas(l.nama)),
                l.tanggal::date,
                CASE WHEN l.sesi = 'Siang' THEN 'Pagi' ELSE l.sesi END,
                COALESCE(trim(l.lokasi), '')
            ORDER BY CASE WHEN l.sesi = 'Pagi' THEN 0 ELSE 1 END, l.id DESC
        ) AS urutan_slot
    FROM public.log_absensi l
    WHERE l.tanggal IS NOT NULL
), canonical AS (
    SELECT * FROM ranked WHERE urutan_slot = 1
)
SELECT
    c.id,
    c.tanggal::date AS tanggal,
    c.sesi_normal AS sesi,
    c.lokasi,
    c.nip,
    COALESCE(m.nama, c.nama) AS nama,
    COALESCE(m.jabatan, c.bidang) AS bidang,
    COALESCE(m.asal_organisasi, c.organisasi) AS organisasi,
    (m.nip IS NOT NULL) AS terhubung,
    c.nama AS nama_sumber,
    c.bidang AS bidang_sumber,
    c.organisasi AS organisasi_sumber
FROM canonical c
LEFT JOIN public.master_relawan m ON m.nip = c.nip;

REVOKE ALL ON public.v_log_absensi_operasional FROM anon;
GRANT SELECT ON public.v_log_absensi_operasional TO authenticated;

-- Ringkasan kualitas agar masalah lama tetap terlihat oleh admin.
CREATE OR REPLACE VIEW public.v_audit_kualitas_absensi
WITH (security_invoker = true)
AS
WITH slots AS (
    SELECT
        COALESCE(NULLIF(trim(nip), ''), 'NAMA:' || public.normalisasi_identitas(nama)) AS identitas,
        tanggal::date AS tanggal,
        CASE WHEN sesi = 'Siang' THEN 'Pagi' ELSE sesi END AS sesi,
        COALESCE(trim(lokasi), '') AS lokasi,
        count(*)::integer AS jumlah
    FROM public.log_absensi
    WHERE tanggal IS NOT NULL
    GROUP BY 1,2,3,4
)
SELECT
    (SELECT count(*)::integer FROM public.log_absensi) AS baris_mentah,
    (SELECT count(*)::integer FROM public.v_log_absensi_operasional) AS baris_kanonik,
    (SELECT count(*)::integer FROM public.log_absensi l
      LEFT JOIN public.master_relawan m ON m.nip = l.nip
      WHERE NULLIF(trim(l.nip), '') IS NOT NULL AND m.nip IS NULL) AS log_yatim,
    (SELECT count(*)::integer FROM slots WHERE jumlah > 1) AS slot_duplikat,
    (SELECT COALESCE(sum(jumlah - 1), 0)::integer FROM slots WHERE jumlah > 1) AS baris_duplikat_berlebih;

REVOKE ALL ON public.v_audit_kualitas_absensi FROM anon;
GRANT SELECT ON public.v_audit_kualitas_absensi TO authenticated;

-- Pagar transaksi untuk perangkat bersamaan. Tidak membersihkan data lama;
-- hanya mencegah slot baru yang sama masuk kembali.
CREATE OR REPLACE FUNCTION public.cegah_absensi_ganda_baru()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_sesi text;
    v_key text;
BEGIN
    v_sesi := CASE WHEN NEW.sesi = 'Siang' THEN 'Pagi' ELSE trim(NEW.sesi) END;
    IF v_sesi NOT IN ('Pagi', 'Malam') THEN
        RAISE EXCEPTION 'Sesi harus Pagi atau Malam';
    END IF;
    NEW.sesi := v_sesi;
    NEW.nip := NULLIF(trim(NEW.nip), '');
    NEW.lokasi := trim(COALESCE(NEW.lokasi, ''));
    IF NEW.nip IS NULL OR NEW.tanggal IS NULL OR NEW.lokasi = '' THEN
        RAISE EXCEPTION 'NIP, tanggal, sesi, dan lokasi wajib diisi';
    END IF;

    v_key := NEW.nip || '|' || NEW.tanggal::text || '|' || NEW.sesi || '|' || NEW.lokasi;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

    IF EXISTS (
        SELECT 1
        FROM public.log_absensi l
        WHERE l.nip = NEW.nip
          AND l.tanggal::date = NEW.tanggal::date
          AND (CASE WHEN l.sesi = 'Siang' THEN 'Pagi' ELSE l.sesi END) = NEW.sesi
          AND COALESCE(trim(l.lokasi), '') = NEW.lokasi
          AND (TG_OP <> 'UPDATE' OR l.id <> NEW.id)
    ) THEN
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cegah_absensi_ganda_baru ON public.log_absensi;
CREATE TRIGGER trg_cegah_absensi_ganda_baru
BEFORE INSERT OR UPDATE OF nip, tanggal, sesi, lokasi ON public.log_absensi
FOR EACH ROW EXECUTE FUNCTION public.cegah_absensi_ganda_baru();

-- RPC atomik: master baru dan seluruh log disimpan dalam transaksi yang sama.
DROP FUNCTION IF EXISTS public.insert_absensi_batch(jsonb, boolean);
DROP FUNCTION IF EXISTS public.insert_absensi_batch(jsonb, boolean, jsonb);

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
    item jsonb;
    master_item jsonb;
    inserted integer := 0;
    skipped integer := 0;
    master_inserted integer := 0;
    master_skipped integer := 0;
    affected integer := 0;
    v_role text := 'admin';
    v_lokasi_akun text;
    v_tanggal date;
    v_sesi text;
    v_nama text;
    v_lokasi text;
    v_nip text;
    v_existing_name text;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;
    IF to_regprocedure('public.akun_role()') IS NOT NULL THEN
        EXECUTE 'SELECT public.akun_role(), public.akun_lokasi()' INTO v_role, v_lokasi_akun;
        IF v_role NOT IN ('admin', 'koordinator') THEN RAISE EXCEPTION 'Akun tidak memiliki akses'; END IF;
    END IF;
    IF p_logs IS NULL OR jsonb_typeof(p_logs) <> 'array' OR jsonb_array_length(p_logs) = 0 THEN
        RAISE EXCEPTION 'p_logs harus berupa array JSON yang tidak kosong';
    END IF;
    p_master_baru := COALESCE(p_master_baru, '[]'::jsonb);
    IF jsonb_typeof(p_master_baru) <> 'array' THEN RAISE EXCEPTION 'p_master_baru harus berupa array JSON'; END IF;

    FOR master_item IN SELECT value FROM jsonb_array_elements(p_master_baru) LOOP
        v_nip := trim(COALESCE(master_item->>'nip', ''));
        v_nama := upper(trim(COALESCE(master_item->>'nama', '')));
        IF v_nip = '' OR v_nama = '' THEN RAISE EXCEPTION 'NIP dan nama relawan baru wajib diisi'; END IF;
        IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_logs) e
            WHERE trim(COALESCE(e->>'nip', '')) = v_nip
        ) THEN RAISE EXCEPTION 'Master baru % tidak mempunyai log pada batch ini', v_nip; END IF;

        INSERT INTO public.master_relawan (nip, nama, jabatan, asal_organisasi)
        VALUES (
            v_nip, v_nama,
            COALESCE(NULLIF(trim(master_item->>'jabatan'), ''), 'Helper'),
            COALESCE(NULLIF(trim(master_item->>'asal_organisasi'), ''), 'Umum')
        ) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected = 1 THEN
            master_inserted := master_inserted + 1;
        ELSE
            SELECT upper(trim(nama)) INTO v_existing_name FROM public.master_relawan WHERE nip = v_nip;
            IF v_existing_name IS DISTINCT FROM v_nama THEN
                RAISE EXCEPTION 'Benturan NIP %: sudah dipakai personel lain', v_nip;
            END IF;
            master_skipped := master_skipped + 1;
        END IF;
    END LOOP;

    FOR item IN SELECT value FROM jsonb_array_elements(p_logs) LOOP
        v_tanggal := (item->>'tanggal')::date;
        v_sesi := CASE WHEN trim(COALESCE(item->>'sesi', '')) = 'Siang' THEN 'Pagi' ELSE trim(COALESCE(item->>'sesi', '')) END;
        v_nama := upper(trim(COALESCE(item->>'nama', '')));
        v_lokasi := trim(COALESCE(item->>'lokasi', ''));
        v_nip := trim(COALESCE(item->>'nip', ''));
        IF v_sesi NOT IN ('Pagi', 'Malam') OR v_nama = '' OR v_lokasi = '' OR v_nip = '' THEN
            RAISE EXCEPTION 'Tanggal, sesi Pagi/Malam, lokasi, NIP, dan nama wajib diisi';
        END IF;
        IF v_role = 'koordinator' AND v_lokasi IS DISTINCT FROM trim(COALESCE(v_lokasi_akun, '')) THEN
            RAISE EXCEPTION 'Koordinator hanya boleh mencatat lokasi %', v_lokasi_akun;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.master_relawan WHERE nip = v_nip) THEN
            RAISE EXCEPTION 'Master relawan dengan NIP % tidak ditemukan', v_nip;
        END IF;

        INSERT INTO public.log_absensi (tanggal, sesi, lokasi, nip, nama, bidang, organisasi)
        VALUES (
            v_tanggal, v_sesi, v_lokasi, v_nip, v_nama,
            COALESCE(NULLIF(trim(item->>'bidang'), ''), 'Helper'),
            COALESCE(NULLIF(trim(item->>'organisasi'), ''), 'Umum')
        );
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected = 1 THEN
            inserted := inserted + 1;
        ELSIF p_skip_duplikat THEN
            skipped := skipped + 1;
        ELSE
            RAISE EXCEPTION 'Absensi duplikat untuk % pada % %', v_nip, v_tanggal, v_sesi;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'inserted', inserted, 'skipped', skipped,
        'master_inserted', master_inserted, 'master_skipped', master_skipped
    );
END;
$$;

REVOKE ALL ON FUNCTION public.insert_absensi_batch(jsonb, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_absensi_batch(jsonb, boolean, jsonb) TO authenticated;

-- Jembatan untuk frontend lama yang masih mengirim dua parameter. Ini menjaga
-- situs produksi tetap dapat mencatat absensi selama jeda antara migrasi
-- database dan publikasi frontend baru.
CREATE OR REPLACE FUNCTION public.insert_absensi_batch(
    p_logs jsonb,
    p_skip_duplikat boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.insert_absensi_batch(p_logs, p_skip_duplikat, '[]'::jsonb);
$$;

REVOKE ALL ON FUNCTION public.insert_absensi_batch(jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_absensi_batch(jsonb, boolean) TO authenticated;

-- Overlay peringkat: zona_asal mengendalikan target 1 hari Zona 4.
CREATE OR REPLACE VIEW public.v_peringkat_personel_operasional_v2
WITH (security_invoker = true)
AS
WITH dasar AS (
    SELECT
        r.nip, r.nama, r.asal_organisasi, r.asal_daerah,
        r.kategori_wilayah, m.zona_asal, r.ukuran_seragam, r.kategori,
        r.total_hari, r.total_sesi, r.hari_90, r.sesi_90, r.minggu_aktif_12,
        r.hadir_pertama, r.hadir_terakhir, r.streak_saat_ini, r.streak_terpanjang,
        r.persentase_hari_90, r.persentase_sesi_90, r.indeks_keaktifan,
        r.tingkat_keaktifan, r.hari_historis,
        CASE WHEN m.zona_asal = 'zona_4' THEN 1 ELSE 40 END::integer AS target_hari,
        (r.total_hari >= CASE WHEN m.zona_asal = 'zona_4' THEN 1 ELSE 40 END) AS memenuhi_syarat,
        CASE
            WHEN r.total_hari >= CASE WHEN m.zona_asal = 'zona_4' THEN 1 ELSE 40 END
            THEN COALESCE(r.tanggal_memenuhi, r.hadir_pertama)
            ELSE NULL
        END AS tanggal_memenuhi,
        CASE WHEN m.zona_asal = 'zona_4' THEN 'zona_4' ELSE r.kategori END AS jalur_kelayakan
    FROM public.v_peringkat_personel_operasional r
    JOIN public.master_relawan m ON m.nip = r.nip
), ranked AS (
    SELECT d.*,
        CASE WHEN d.memenuhi_syarat THEN row_number() OVER (
            PARTITION BY d.kategori, d.memenuhi_syarat
            ORDER BY d.indeks_keaktifan DESC,
                     d.tanggal_memenuhi ASC NULLS LAST,
                     d.total_hari DESC, d.nip ASC
        )::integer END AS peringkat
    FROM dasar d
)
SELECT
    nip, nama, asal_organisasi, asal_daerah, kategori_wilayah, zona_asal,
    ukuran_seragam, kategori, total_hari, total_sesi, hari_90, sesi_90,
    minggu_aktif_12, hadir_pertama, hadir_terakhir, streak_saat_ini,
    streak_terpanjang, persentase_hari_90, persentase_sesi_90,
    indeks_keaktifan, memenuhi_syarat, tanggal_memenuhi, jalur_kelayakan,
    tingkat_keaktifan, peringkat, hari_historis, target_hari,
    total_hari::integer AS hari_menuju_syarat
FROM ranked;

CREATE OR REPLACE VIEW public.v_peringkat_personel_umum_v2
WITH (security_invoker = true)
AS
WITH actual AS (
    SELECT nip,
           count(DISTINCT tanggal)::integer AS hari_aktual,
           count(*)::integer AS total_sesi,
           min(tanggal) AS hadir_pertama,
           max(tanggal) AS hadir_terakhir
    FROM public.v_log_absensi_operasional
    WHERE terhubung
    GROUP BY nip
), kategori AS (
    SELECT nip,
           bool_or(memenuhi_syarat) AS memenuhi_syarat,
           min(tanggal_memenuhi) FILTER (WHERE memenuhi_syarat) AS tanggal_memenuhi,
           sum(hari_historis)::integer AS hari_historis,
           max(indeks_keaktifan) AS indeks_keaktifan,
           max(streak_saat_ini)::integer AS streak_saat_ini,
           max(streak_terpanjang)::integer AS streak_terpanjang,
           max(minggu_aktif_12)::integer AS minggu_aktif_12,
           max(hari_90)::integer AS hari_90,
           max(sesi_90)::integer AS sesi_90,
           max(persentase_hari_90) AS persentase_hari_90,
           max(persentase_sesi_90) AS persentase_sesi_90,
           max(total_hari)::integer AS hari_menuju_syarat
    FROM public.v_peringkat_personel_operasional_v2
    GROUP BY nip
), dasar AS (
    SELECT
        m.nip, m.nama, m.asal_organisasi, m.asal_daerah,
        m.kategori_wilayah, m.zona_asal, m.ukuran_seragam,
        'semua'::text AS kategori,
        (COALESCE(a.hari_aktual, 0) + COALESCE(k.hari_historis, 0))::integer AS total_hari,
        COALESCE(a.total_sesi, 0)::integer AS total_sesi,
        COALESCE(k.hari_90, 0)::integer AS hari_90,
        COALESCE(k.sesi_90, 0)::integer AS sesi_90,
        COALESCE(k.minggu_aktif_12, 0)::integer AS minggu_aktif_12,
        a.hadir_pertama, a.hadir_terakhir,
        COALESCE(k.streak_saat_ini, 0)::integer AS streak_saat_ini,
        COALESCE(k.streak_terpanjang, 0)::integer AS streak_terpanjang,
        COALESCE(k.persentase_hari_90, 0) AS persentase_hari_90,
        COALESCE(k.persentase_sesi_90, 0) AS persentase_sesi_90,
        COALESCE(k.indeks_keaktifan, 0) AS indeks_keaktifan,
        COALESCE(k.memenuhi_syarat, false) AS memenuhi_syarat,
        k.tanggal_memenuhi,
        CASE WHEN m.zona_asal = 'zona_4' THEN 'zona_4' ELSE 'semua' END AS jalur_kelayakan,
        CASE
            WHEN COALESCE(k.indeks_keaktifan, 0) >= 85 THEN 'Sangat Aktif'
            WHEN COALESCE(k.indeks_keaktifan, 0) >= 70 THEN 'Aktif'
            WHEN COALESCE(k.indeks_keaktifan, 0) >= 55 THEN 'Cukup Aktif'
            ELSE 'Keaktifan Rendah'
        END AS tingkat_keaktifan,
        COALESCE(k.hari_historis, 0)::integer AS hari_historis,
        CASE WHEN m.zona_asal = 'zona_4' THEN 1 ELSE 40 END::integer AS target_hari,
        COALESCE(k.hari_menuju_syarat, 0)::integer AS hari_menuju_syarat
    FROM public.master_relawan m
    LEFT JOIN actual a ON a.nip = m.nip
    LEFT JOIN kategori k ON k.nip = m.nip
), ranked AS (
    SELECT d.*,
        CASE WHEN d.memenuhi_syarat THEN row_number() OVER (
            PARTITION BY d.memenuhi_syarat
            ORDER BY d.indeks_keaktifan DESC,
                     d.tanggal_memenuhi ASC NULLS LAST,
                     d.hari_menuju_syarat DESC, d.nip ASC
        )::integer END AS peringkat
    FROM dasar d
)
SELECT
    nip, nama, asal_organisasi, asal_daerah, kategori_wilayah, zona_asal,
    ukuran_seragam, kategori, total_hari, total_sesi, hari_90, sesi_90,
    minggu_aktif_12, hadir_pertama, hadir_terakhir, streak_saat_ini,
    streak_terpanjang, persentase_hari_90, persentase_sesi_90,
    indeks_keaktifan, memenuhi_syarat, tanggal_memenuhi, jalur_kelayakan,
    tingkat_keaktifan, peringkat, hari_historis, target_hari, hari_menuju_syarat
FROM ranked;

REVOKE ALL ON public.v_peringkat_personel_operasional_v2 FROM anon;
REVOKE ALL ON public.v_peringkat_personel_umum_v2 FROM anon;
GRANT SELECT ON public.v_peringkat_personel_operasional_v2 TO authenticated;
GRANT SELECT ON public.v_peringkat_personel_umum_v2 TO authenticated;

CREATE OR REPLACE VIEW public.v_daftar_proyek_absensi
WITH (security_invoker = true)
AS
SELECT kategori, nama_proyek, count(DISTINCT nip)::integer AS jumlah_personel
FROM public.v_kehadiran_proyek_personel
GROUP BY kategori, nama_proyek;

REVOKE ALL ON public.v_daftar_proyek_absensi FROM anon;
GRANT SELECT ON public.v_daftar_proyek_absensi TO authenticated;

-- Status seragam memakai zona_asal, tetapi tetap menyimpan kategori_wilayah
-- untuk kompatibilitas audit data lama.
CREATE OR REPLACE VIEW public.v_status_seragam_set_v2
WITH (security_invoker = true)
AS
WITH eligible AS (
    SELECT * FROM (
        SELECT r.*,
               row_number() OVER (
                   PARTITION BY r.nip
                   ORDER BY CASE WHEN r.zona_asal = 'zona_4' THEN 0 ELSE 1 END,
                            r.tanggal_memenuhi ASC NULLS LAST,
                            r.indeks_keaktifan DESC
               ) AS pilihan
        FROM public.v_peringkat_personel_operasional_v2 r
        WHERE r.memenuhi_syarat
    ) x WHERE pilihan = 1
), last_attendance AS (
    SELECT nip, max(tanggal) AS tanggal_terakhir
    FROM public.v_log_absensi_operasional
    WHERE terhubung
    GROUP BY nip
), base AS (
    SELECT
        m.*,
        (
            (NULLIF(upper(trim(m.kabupaten_normalisasi)), '') IS NOT NULL AND upper(trim(m.kabupaten_normalisasi)) <> 'JOMBANG')
            OR m.kategori_wilayah IN ('luar_jombang', 'zona_4')
        ) AS luar_jombang
    FROM public.master_relawan m
)
SELECT
    m.nip, m.nama, m.asal_organisasi, m.asal_daerah,
    m.kabupaten_normalisasi AS kabupaten,
    m.kategori_wilayah, m.zona_asal, m.ukuran_seragam, m.luar_jombang,
    COALESCE(e.memenuhi_syarat, false) AS memenuhi_syarat,
    e.tanggal_memenuhi,
    CASE WHEN m.zona_asal = 'zona_4' THEN 'zona_4' ELSE e.kategori END AS jalur_kelayakan,
    e.indeks_keaktifan, e.peringkat,
    COALESCE(sp.status_proses,
        CASE WHEN e.memenuhi_syarat THEN 'memenuhi_syarat' ELSE 'belum_memenuhi' END
    ) AS status_proses,
    COALESCE(sp.ukuran_atasan, sp.ukuran_dibutuhkan, m.ukuran_seragam) AS ukuran_dibutuhkan,
    COALESCE(sp.kode_atasan, sp.kode_seragam) AS kode_seragam,
    CASE
        WHEN sp.status_penguasaan = 'dititipkan_kantor'
         AND m.luar_jombang
         AND la.tanggal_terakhir > sp.tanggal_status::date
            THEN 'perlu_diserahkan_kembali'
        ELSE COALESCE(sp.status_penguasaan, 'belum_memiliki')
    END AS status_penguasaan,
    (
        sp.status_penguasaan = 'dititipkan_kantor'
        AND m.luar_jombang
        AND la.tanggal_terakhir > sp.tanggal_status::date
    ) AS notifikasi_pengembalian,
    sp.tanggal_rencana, sp.tanggal_diserahkan, sp.tanggal_status,
    sp.aturan_disetujui, sp.data_lama, sp.catatan,
    (sp.nip IS NOT NULL) AS record_tersimpan,
    la.tanggal_terakhir AS tanggal_hadir_terakhir,
    (
        sp.status_proses = 'sudah_diserahkan'
        AND COALESCE(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date) IS NOT NULL
        AND COALESCE(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date) <= current_date - 30
    ) AS tidak_hadir_30_hari,
    CASE
        WHEN sp.status_proses = 'sudah_diserahkan'
         AND COALESCE(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date) IS NOT NULL
        THEN greatest(0, current_date - COALESCE(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date))
        ELSE 0
    END::integer AS hari_tidak_hadir,
    sp.ukuran_atasan, sp.ukuran_bawahan, sp.kode_atasan, sp.kode_bawahan
FROM base m
LEFT JOIN eligible e ON e.nip = m.nip
LEFT JOIN public.seragam_penerima sp ON sp.nip = m.nip
LEFT JOIN last_attendance la ON la.nip = m.nip;

REVOKE ALL ON public.v_status_seragam_set_v2 FROM anon;
GRANT SELECT ON public.v_status_seragam_set_v2 TO authenticated;

CREATE OR REPLACE FUNCTION public.daftar_peringkat_v2(
    p_proyek text DEFAULT 'semua',
    p_status text DEFAULT 'semua',
    p_cari text DEFAULT '',
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_rows jsonb;
    v_total integer;
    v_limit integer := greatest(1, least(COALESCE(p_limit, 50), 100));
    v_offset integer := greatest(0, COALESCE(p_offset, 0));
    v_project text := COALESCE(NULLIF(trim(p_proyek), ''), 'semua');
    v_search text := trim(COALESCE(p_cari, ''));
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;

    IF v_project = 'semua' THEN
        WITH filtered AS (
            SELECT * FROM public.v_peringkat_personel_umum_v2 r
            WHERE (v_search = '' OR r.nama ILIKE '%' || v_search || '%' OR r.nip ILIKE '%' || v_search || '%'
                   OR r.asal_organisasi ILIKE '%' || v_search || '%' OR COALESCE(r.asal_daerah, '') ILIKE '%' || v_search || '%')
              AND (p_status = 'semua'
                   OR (p_status = 'memenuhi' AND r.memenuhi_syarat)
                   OR (p_status = 'belum' AND NOT r.memenuhi_syarat)
                   OR (p_status = 'mendekati' AND NOT r.memenuhi_syarat AND r.target_hari = 40 AND r.hari_menuju_syarat BETWEEN 30 AND 39))
        ), paged AS (
            SELECT * FROM filtered
            ORDER BY memenuhi_syarat DESC, peringkat ASC NULLS LAST,
                     hari_menuju_syarat DESC, indeks_keaktifan DESC, nama ASC
            LIMIT v_limit OFFSET v_offset
        )
        SELECT (SELECT count(*)::integer FROM filtered),
               COALESCE((SELECT jsonb_agg(to_jsonb(paged)) FROM paged), '[]'::jsonb)
        INTO v_total, v_rows;
    ELSE
        WITH filtered AS (
            SELECT * FROM public.v_peringkat_personel_operasional_v2 r
            WHERE (
                    (v_project IN ('khususul_khusus', 'lainnya') AND r.kategori = v_project)
                    OR (v_project LIKE 'proyek:%' AND EXISTS (
                        SELECT 1 FROM public.v_kehadiran_proyek_personel kp
                        WHERE kp.nip = r.nip AND kp.kategori = r.kategori
                          AND kp.nama_proyek = substring(v_project FROM 8)
                    ))
                  )
              AND (v_search = '' OR r.nama ILIKE '%' || v_search || '%' OR r.nip ILIKE '%' || v_search || '%'
                   OR r.asal_organisasi ILIKE '%' || v_search || '%' OR COALESCE(r.asal_daerah, '') ILIKE '%' || v_search || '%')
              AND (p_status = 'semua'
                   OR (p_status = 'memenuhi' AND r.memenuhi_syarat)
                   OR (p_status = 'belum' AND NOT r.memenuhi_syarat)
                   OR (p_status = 'mendekati' AND NOT r.memenuhi_syarat AND r.target_hari = 40 AND r.total_hari BETWEEN 30 AND 39))
        ), paged AS (
            SELECT * FROM filtered
            ORDER BY memenuhi_syarat DESC, peringkat ASC NULLS LAST,
                     total_hari DESC, indeks_keaktifan DESC, nama ASC
            LIMIT v_limit OFFSET v_offset
        )
        SELECT (SELECT count(*)::integer FROM filtered),
               COALESCE((SELECT jsonb_agg(to_jsonb(paged)) FROM paged), '[]'::jsonb)
        INTO v_total, v_rows;
    END IF;

    RETURN jsonb_build_object(
        'rows', v_rows,
        'total', v_total,
        'kpi', (
            SELECT jsonb_build_object(
                'personel', count(*),
                'memenuhi', count(*) FILTER (WHERE memenuhi_syarat),
                'zona4', count(*) FILTER (WHERE zona_asal = 'zona_4'),
                'mendekati', count(*) FILTER (WHERE NOT memenuhi_syarat AND target_hari = 40 AND hari_menuju_syarat BETWEEN 30 AND 39),
                'zona_kosong', count(*) FILTER (WHERE zona_asal IS NULL)
            ) FROM public.v_peringkat_personel_umum_v2
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.daftar_peringkat_v2(text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daftar_peringkat_v2(text, text, text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.daftar_seragam_v2(
    p_proyek text DEFAULT 'semua',
    p_proses text DEFAULT 'semua',
    p_penguasaan text DEFAULT 'semua',
    p_cari text DEFAULT '',
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_rows jsonb;
    v_total integer;
    v_limit integer := greatest(1, least(COALESCE(p_limit, 50), 100));
    v_offset integer := greatest(0, COALESCE(p_offset, 0));
    v_project text := COALESCE(NULLIF(trim(p_proyek), ''), 'semua');
    v_search text := trim(COALESCE(p_cari, ''));
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;

    WITH filtered AS (
        SELECT * FROM public.v_status_seragam_set_v2 r
        WHERE (
                v_project = 'semua'
                OR (v_project IN ('khususul_khusus', 'lainnya') AND (
                    r.jalur_kelayakan = v_project OR EXISTS (
                        SELECT 1 FROM public.v_kehadiran_proyek_personel kp
                        WHERE kp.nip = r.nip AND kp.kategori = v_project
                    )
                ))
                OR (v_project LIKE 'proyek:%' AND EXISTS (
                    SELECT 1 FROM public.v_kehadiran_proyek_personel kp
                    WHERE kp.nip = r.nip AND kp.nama_proyek = substring(v_project FROM 8)
                ))
              )
          AND (p_proses = 'semua' OR r.status_proses = p_proses)
          AND (p_penguasaan = 'semua' OR r.status_penguasaan = p_penguasaan)
          AND (v_search = '' OR r.nama ILIKE '%' || v_search || '%' OR r.nip ILIKE '%' || v_search || '%'
               OR r.asal_organisasi ILIKE '%' || v_search || '%' OR COALESCE(r.asal_daerah, '') ILIKE '%' || v_search || '%'
               OR COALESCE(r.ukuran_atasan, '') ILIKE '%' || v_search || '%' OR COALESCE(r.ukuran_bawahan, '') ILIKE '%' || v_search || '%'
               OR COALESCE(r.kode_atasan, '') ILIKE '%' || v_search || '%' OR COALESCE(r.kode_bawahan, '') ILIKE '%' || v_search || '%')
    ), paged AS (
        SELECT * FROM filtered
        ORDER BY notifikasi_pengembalian DESC, tidak_hadir_30_hari DESC,
                 memenuhi_syarat DESC, peringkat ASC NULLS LAST, nama ASC
        LIMIT v_limit OFFSET v_offset
    )
    SELECT (SELECT count(*)::integer FROM filtered),
           COALESCE((SELECT jsonb_agg(to_jsonb(paged)) FROM paged), '[]'::jsonb)
    INTO v_total, v_rows;

    RETURN jsonb_build_object(
        'rows', v_rows,
        'total', v_total,
        'kpi', (
            SELECT jsonb_build_object(
                'memenuhi', count(*) FILTER (WHERE memenuhi_syarat),
                'direncanakan', count(*) FILTER (WHERE status_proses = 'direncanakan'),
                'menunggu', count(*) FILTER (WHERE status_proses = 'menunggu_stok'),
                'diserahkan', count(*) FILTER (WHERE status_proses = 'sudah_diserahkan'),
                'dititipkan', count(*) FILTER (WHERE status_penguasaan = 'dititipkan_kantor'),
                'perlu_kembali', count(*) FILTER (WHERE status_penguasaan = 'perlu_diserahkan_kembali'),
                'absen_lama', count(*) FILTER (WHERE tidak_hadir_30_hari)
            ) FROM public.v_status_seragam_set_v2
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.daftar_seragam_v2(text, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daftar_seragam_v2(text, text, text, text, integer, integer) TO authenticated;

COMMIT;

-- VERIFIKASI
SELECT
    to_regclass('public.v_log_absensi_operasional') IS NOT NULL AS log_kanonik,
    to_regprocedure('public.insert_absensi_batch(jsonb,boolean)') IS NOT NULL AS rpc_absensi_kompatibel,
    to_regprocedure('public.insert_absensi_batch(jsonb,boolean,jsonb)') IS NOT NULL AS rpc_absensi_atomik,
    to_regprocedure('public.daftar_peringkat_v2(text,text,text,integer,integer)') IS NOT NULL AS rpc_peringkat,
    to_regprocedure('public.daftar_seragam_v2(text,text,text,text,integer,integer)') IS NOT NULL AS rpc_seragam,
    (SELECT baris_mentah FROM public.v_audit_kualitas_absensi) AS baris_mentah,
    (SELECT baris_kanonik FROM public.v_audit_kualitas_absensi) AS baris_kanonik;
